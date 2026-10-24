import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync, backup } from 'node:sqlite';
import { applyDatabaseMigrations } from '../dist/database/database.js';
import { DATABASE_SCHEMA_VERSION } from '../dist/database/schema.js';

if (!process.argv[2]) throw new Error('Usage: node tools/verify-legacy-copy.mjs <existing-legacy-database>');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.resolve(process.argv[2]);
const output = path.join(root, '.jc/readiness', `legacy-${randomUUID()}`);
await fs.mkdir(output, { recursive: true });
const destination = path.join(output, 'joecoder.sqlite3');
const original = new DatabaseSync(source, { readOnly: true });
try { await backup(original, destination); } finally { original.close(); }
const db = new DatabaseSync(destination);
const quote = value => '"' + value.replaceAll('"', '""') + '"';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const report = { source, destination, checks: {}, passed: false };
try {
  const beforeVersion = db.prepare('PRAGMA user_version').get().user_version;
  report.beforeVersion = beforeVersion;
  if (beforeVersion >= DATABASE_SCHEMA_VERSION) throw new Error('Source does not require migration; this would not prove legacy migration.');
  const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
  const fingerprints = tables.map(({ name }) => {
    const columns = db.prepare(`PRAGMA table_info(${quote(name)})`).all().map(c => c.name);
    const rows = db.prepare(`SELECT ${columns.map(quote).join(',')} FROM ${quote(name)}`).all();
    return { name, columns, rows: rows.length, hash: hash(rows.map(r => JSON.stringify(r)).sort()) };
  });
  function unchanged(includeMigrations = true) {
    return fingerprints.filter(t => includeMigrations || t.name !== 'schema_migrations').every(t => {
      const rows = db.prepare(`SELECT ${t.columns.map(quote).join(',')} FROM ${quote(t.name)}`).all();
      return rows.length === t.rows && hash(rows.map(r => JSON.stringify(r)).sort()) === t.hash;
    });
  }
  const schemaBefore = hash(db.prepare('SELECT type,name,sql FROM sqlite_schema ORDER BY name').all());
  let rejected = false;
  try { applyDatabaseMigrations(db, () => { throw new Error('READINESS_INJECTED_MIGRATION_FAILURE'); }); }
  catch (error) { if (error.message.includes('READINESS_INJECTED_MIGRATION_FAILURE')) rejected = true; else throw error; }
  report.checks.failedMigrationRolledBack = rejected && unchanged() && db.prepare('PRAGMA user_version').get().user_version === beforeVersion && hash(db.prepare('SELECT type,name,sql FROM sqlite_schema ORDER BY name').all()) === schemaBefore;
  if (!report.checks.failedMigrationRolledBack) throw new Error('Failed migration changed original logical state.');
  applyDatabaseMigrations(db);
  report.afterVersion = db.prepare('PRAGMA user_version').get().user_version;
  report.checks.allOriginalDataPreserved = unchanged(false);
  report.checks.integrity = db.prepare('PRAGMA quick_check').get().quick_check === 'ok';
  report.checks.foreignKeys = db.prepare('PRAGMA foreign_key_check').all().length === 0;
  report.tables = fingerprints.map(({ columns, ...value }) => value);
  report.passed = report.afterVersion === DATABASE_SCHEMA_VERSION && Object.values(report.checks).every(Boolean);
  process.exitCode = report.passed ? 0 : 1;
} catch (error) { report.error = error.message; process.exitCode = 1; }
finally {
  db.close();
  await fs.writeFile(path.join(output, 'result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ output, passed: report.passed, beforeVersion: report.beforeVersion, afterVersion: report.afterVersion, checks: report.checks, error: report.error }, null, 2));
}
