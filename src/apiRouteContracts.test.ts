import assert from 'node:assert/strict';
import test from 'node:test';
import {
  apiContractProofSatisfied,
  assertImplementsApiRoutes,
  describeUnsafeExpressRoutePattern,
  enforceApiImplementationContracts,
  extractApiRouteContracts,
  rejectBuildOutputEdits,
  hasStaticUiServe,
  hasZipSlipProtection,
  rejectEphemeralProjectPersistence,
  rejectMissingHttp4xxHonesty,
  rejectMissingStaticUiServe,
  rejectPlaceholderServerImplementation,
  rejectShallowAnalysisImplementation,
  rejectUnsafeExpressRoutePatterns,
  rejectUploadIgnoringEnvDataDir,
  rejectUploadWithoutPersistence,
  rejectZipSlipVulnerableUpload,
  selectRequiredApiRouteContracts,
  suggestSafeExpressRouteRewrite,
  usesEnvDataDir
} from './apiRouteContracts.js';

test('extracts and seals InspectorCode client upload/analysis routes (G2m)', () => {
  const discovered = extractApiRouteContracts([
    {
      path: 'client/src/hooks/useFileUpload.ts',
      content: `xhr.open('POST', '/api/projects/upload', true);`
    },
    {
      path: 'client/src/hooks/useAnalysis.ts',
      content: `
        fetch(\`/api/analysis/\${projectId}\`);
        apiRequest('POST', \`/api/analysis/start/\${projectId}\`, {});
      `
    },
    {
      path: 'client/src/pages/RecentProjects.tsx',
      content: `queryKey: ['/api/projects/recent']`
    },
    {
      path: 'client/src/pages/Dashboard.tsx',
      content: `fetch(\`/api/projects/save/\${projectId}\`, { method: 'POST' })`
    }
  ]);
  assert.ok(discovered.some((route) => route.includes('/api/projects/upload')));
  assert.ok(discovered.some((route) => route.includes('/api/analysis')));

  const required = selectRequiredApiRouteContracts(
    'Make InspectorCode run locally end to end so a user can upload a ZIP project',
    discovered
  );
  for (const route of [
    '/api/health',
    '/api/projects/upload',
    '/api/projects/save',
    '/api/projects/recent',
    '/api/analysis/start',
    '/api/analysis'
  ]) {
    assert.ok(required.includes(route), `missing ${route} in ${required.join(',')}`);
  }
});

test('operational route selection drops unrelated API families (G2ae)', () => {
  const required = selectRequiredApiRouteContracts(
    'Make InspectorCode run locally end to end so a user can upload a ZIP project and analyze files',
    [
      '/api/projects/upload',
      '/api/analysis/start',
      '/api/analysis',
      '/api/projects/save',
      '/api/projects/recent',
      '/api/api-keys',
      '/api/knowledge-base/harvest',
      '/api/projects/download'
    ]
  );
  assert.ok(required.includes('/api/projects/upload'));
  assert.ok(required.includes('/api/analysis/start'));
  assert.equal(required.includes('/api/api-keys'), false);
  assert.equal(required.includes('/api/knowledge-base/harvest'), false);
  assert.equal(required.includes('/api/projects/download'), false);
});

test('rejects 501 placeholder server stubs that invent /api/analyze', () => {
  const stub = `
import express from 'express';
const app = express();
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
// Placeholder for ZIP upload and analysis route
app.post('/api/analyze', (req, res) => {
  // TODO: Implement ZIP upload handling
  res.status(501).json({ error: 'Not Implemented' });
});
export default app;
`;
  assert.throws(
    () => rejectPlaceholderServerImplementation({ relPath: 'server/index.ts', content: stub }),
    /EDIT_PLACEHOLDER_REJECTED/
  );
  assert.throws(
    () => enforceApiImplementationContracts(
      [{ relPath: 'server/index.ts', content: stub }],
      ['/api/health', '/api/projects/upload', '/api/analysis/start', '/api/analysis']
    ),
    /EDIT_PLACEHOLDER_REJECTED|EDIT_API_CONTRACT_INCOMPLETE/
  );
});

test('rejects /api/analyze substitute when upload contract is sealed', () => {
  const fake = `
import express from 'express';
const app = express();
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
app.post('/api/analyze', (_req, res) => res.json({ projectId: 'x' }));
export default app;
`;
  assert.throws(
    () => enforceApiImplementationContracts(
      [{ relPath: 'server/index.ts', content: fake }],
      ['/api/health', '/api/projects/upload', '/api/analysis/start']
    ),
    /EDIT_API_CONTRACT_INCOMPLETE/
  );
});

test('apiContractProofSatisfied denies build-only verification when routes are sealed', () => {
  assert.equal(
    apiContractProofSatisfied(
      {
        status: 'passed',
        items: [{ command: 'npm run build', passed: true }]
      },
      ['/api/projects/upload']
    ).ok,
    false
  );
  assert.equal(
    apiContractProofSatisfied(
      {
        status: 'passed',
        items: [
          { command: 'npm run build', passed: true },
          { command: 'api-route-smoke', passed: true, outputTail: ['ok'] }
        ]
      },
      ['/api/projects/upload']
    ).ok,
    true
  );
});

test('rejects bare /api/analysis/start without :projectId param (G2w oracle R4)', () => {
  const bare = `
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
const app = express();
const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
app.post('/api/projects/upload', async (_req, res) => {
  await fs.mkdir(dataDir, { recursive: true });
  res.json({ projectId: '1' });
});
app.post('/api/projects/save', (_req, res) => res.json({ ok: true }));
app.get('/api/projects/recent', (_req, res) => res.json([]));
app.post('/api/analysis/start', (_req, res) => res.json({ projectId: '1' }));
app.post('/api/analysis', (_req, res) => res.json({ findings: [] }));
export default app;
`;
  assert.throws(
    () => assertImplementsApiRoutes(bare, [
      '/api/health',
      '/api/projects/upload',
      '/api/projects/save',
      '/api/projects/recent',
      '/api/analysis/start',
      '/api/analysis'
    ]),
    /EDIT_API_CONTRACT_INCOMPLETE.*analysis\/start/
  );
});

test('accepts a server entry that implements the sealed client routes', () => {
  const real = `
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
const app = express();
const dataDir = process.env.DATA_DIR || process.env.INSPECTORCODE_DATA_DIR || process.env.JC_DATA_DIR || path.join(process.cwd(), 'data');
const recentPath = path.join(dataDir, 'recent_projects.json');
function loadRecent() {
  try { return JSON.parse(fs.readFileSync(recentPath, 'utf-8')); } catch { return []; }
}
function saveRecent(rows) { fs.writeFileSync(recentPath, JSON.stringify(rows)); }
async function extractSafe(zipBuffer, targetDir) {
  const zip = await JSZip.loadAsync(zipBuffer);
  const root = path.resolve(targetDir);
  for (const [relativePath, file] of Object.entries(zip.files)) {
    if (file.dir) continue;
    if (relativePath.includes('..') || path.isAbsolute(relativePath)) {
      throw Object.assign(new Error('zip-slip'), { status: 400 });
    }
    const resolved = path.resolve(targetDir, relativePath);
    const rel = path.relative(root, resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw Object.assign(new Error('zip-slip'), { status: 400 });
    }
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, await file.async('nodebuffer'));
  }
}
function analyze(projectId) {
  const root = path.join(dataDir, projectId);
  if (!fs.existsSync(root)) return { error: 'not found' };
  const files = [];
  const findings = [];
  function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else {
        files.push(full);
        const content = fs.readFileSync(full, 'utf-8');
        if (/\\beval\\b|oracle-seeded-eval/.test(content)) {
          findings.push({ severity: 'high', message: 'dynamic code execution via eval', file: name });
        }
      }
    }
  }
  walk(root);
  return { projectId, files, findings, totalFiles: files.length, status: 'completed' };
}
app.use(express.static(path.join(process.cwd(), 'dist', 'public')));
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
app.post('/api/projects/upload', async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'missing file' });
  const id = '1';
  const dest = path.join(dataDir, id);
  try {
    await fs.promises.mkdir(dest, { recursive: true });
    await extractSafe(Buffer.from(''), dest);
  } catch {
    return res.status(400).json({ error: 'invalid or unsafe archive' });
  }
  await fs.promises.writeFile(path.join(dest, 'marker.txt'), 'ok');
  res.json({ projectId: id });
});
app.post('/api/projects/save/:id', (req, res) => {
  const rows = loadRecent();
  rows.push({ id: req.params.id, name: 'saved' });
  saveRecent(rows);
  res.json({ ok: true });
});
app.get('/api/projects/recent', (_req, res) => res.json(loadRecent()));
app.post('/api/analysis/start/:id', (req, res) => {
  const result = analyze(req.params.id);
  if (result.error) return res.status(404).json(result);
  res.json(result);
});
app.get('/api/analysis/:id', (req, res) => {
  const result = analyze(req.params.id);
  if (result.error) return res.status(404).json(result);
  res.json(result);
});
export default app;
`;
  assert.ok(hasZipSlipProtection(real));
  assert.ok(hasStaticUiServe(real));
  assert.doesNotThrow(() => assertImplementsApiRoutes(real, [
    '/api/health',
    '/api/projects/upload',
    '/api/projects/save',
    '/api/projects/recent',
    '/api/analysis/start',
    '/api/analysis'
  ]));
  assert.equal(
    enforceApiImplementationContracts(
      [{ relPath: 'server/index.ts', content: real }],
      ['/api/health', '/api/projects/upload', '/api/projects/save', '/api/projects/recent', '/api/analysis/start', '/api/analysis']
    ).length,
    1
  );
});

test('rejects zip-slip upload extract without path guard (oracle R7)', () => {
  const slip = `
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
const app = express();
const dataDir = process.env.DATA_DIR || process.env.JC_DATA_DIR;
app.use(express.static(path.join(process.cwd(), 'dist', 'public')));
async function extractZipToDirectory(zipBuffer, targetDir) {
  const zip = await JSZip.loadAsync(zipBuffer);
  for (const [relativePath, file] of Object.entries(zip.files)) {
    if (!file.dir) {
      const filePath = path.join(targetDir, relativePath);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, await file.async('nodebuffer'));
    }
  }
}
app.post('/api/projects/upload', async (_req, res) => {
  await extractZipToDirectory(Buffer.from(''), path.join(dataDir, '1'));
  res.json({ projectId: '1' });
});
export default app;
`;
  assert.equal(hasZipSlipProtection(slip), false);
  assert.throws(
    () => rejectZipSlipVulnerableUpload(
      { relPath: 'server/index.ts', content: slip },
      ['/api/projects/upload']
    ),
    /EDIT_ZIP_SLIP_UNPROTECTED/
  );
});

test('distant path.resolve+startsWith does not count as zip-slip protection', () => {
  const distant = `
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
const other = path.resolve('/tmp/x');
if (!other.startsWith('/tmp')) throw new Error('unrelated');
async function extractZipToDirectory(zipBuffer, targetDir) {
  const zip = await JSZip.loadAsync(zipBuffer);
  for (const [relativePath, file] of Object.entries(zip.files)) {
    if (!file.dir) fs.writeFileSync(path.join(targetDir, relativePath), await file.async('nodebuffer'));
  }
}
app.post('/api/projects/upload', async (_req, res) => {
  await extractZipToDirectory(Buffer.from(''), '/data/1');
  res.status(400);
  res.json({ projectId: '1' });
});
`;
  assert.equal(hasZipSlipProtection(distant), false);
});

test('comment mentioning zip-slip without a real guard does not pass', () => {
  const commented = `
async function extractZipToDirectory(zipBuffer, targetDir) {
  const zip = await JSZip.loadAsync(zipBuffer);
  // zip-slip / path traversal protection
  for (const [relativePath, file] of Object.entries(zip.files)) {
    if (!file.dir) fs.writeFileSync(path.join(targetDir, relativePath), await file.async('nodebuffer'));
  }
}
`;
  assert.equal(hasZipSlipProtection(commented), false);
});

test('bare express.static(public) is not enough for R5 UI serve', () => {
  assert.equal(
    hasStaticUiServe(`
      import express from 'express';
      const app = express();
      app.use(express.static('public'));
      app.post('/api/projects/upload', () => {});
    `),
    false
  );
  assert.ok(
    hasStaticUiServe(`
      import express from 'express';
      import path from 'node:path';
      const app = express();
      app.use(express.static(path.join(process.cwd(), 'dist', 'public')));
    `)
  );
});

test('accepts DATA_DIR JSON persistence without recent_projects filename (R6)', () => {
  const durable = `
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
const app = express();
const dataDir = process.env.DATA_DIR || process.env.JC_DATA_DIR;
const store = path.join(dataDir, 'meta.json');
function load() { try { return JSON.parse(fs.readFileSync(store, 'utf-8')); } catch { return []; } }
function save(rows) { fs.writeFileSync(store, JSON.stringify(rows)); }
app.post('/api/projects/save/:id', (req, res) => { const rows = load(); rows.push({ id: req.params.id }); save(rows); res.json({ ok: true }); });
app.get('/api/projects/recent', (_req, res) => res.json(load()));
export default app;
`;
  assert.doesNotThrow(() => rejectEphemeralProjectPersistence(
    { relPath: 'server/index.ts', content: durable },
    ['/api/projects/save', '/api/projects/recent']
  ));
});

test('rejects analysis/upload without honest HTTP 4xx (oracle R8)', () => {
  const soft = `
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
const app = express();
const dataDir = process.env.DATA_DIR || process.env.JC_DATA_DIR;
app.post('/api/projects/upload', (_req, res) => res.json({ error: 'missing file', projectId: null }));
app.get('/api/analysis/:id', (_req, res) => res.json({ error: 'missing' }));
app.post('/api/analysis/start/:id', (_req, res) => res.json({ error: 'missing' }));
export default app;
`;
  assert.throws(
    () => rejectMissingHttp4xxHonesty(
      { relPath: 'server/index.ts', content: soft },
      ['/api/projects/upload', '/api/analysis']
    ),
    /EDIT_HTTP_4XX_REQUIRED/
  );
});

test('analysis status(404) alone does not satisfy upload 4xx honesty', () => {
  const analysisOnly404 = `
import express from 'express';
const app = express();
app.post('/api/projects/upload', (_req, res) => res.json({ projectId: '1' }));
app.get('/api/analysis/:id', (_req, res) => res.status(404).json({ error: 'missing' }));
app.post('/api/analysis/start/:id', (_req, res) => res.status(404).json({ error: 'missing' }));
`;
  assert.throws(
    () => rejectMissingHttp4xxHonesty(
      { relPath: 'server/index.ts', content: analysisOnly404 },
      ['/api/projects/upload', '/api/analysis']
    ),
    /status\(400\|413\|415\|422\)/
  );
});

test('rejects API-only server without static UI serve (oracle R5)', () => {
  const apiOnly = `
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
const app = express();
const dataDir = process.env.DATA_DIR || process.env.JC_DATA_DIR;
const recentPath = path.join(dataDir, 'recent_projects.json');
function loadRecent() { try { return JSON.parse(fs.readFileSync(recentPath, 'utf-8')); } catch { return []; } }
function saveRecent(rows) { fs.writeFileSync(recentPath, JSON.stringify(rows)); }
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
app.post('/api/projects/upload', async (_req, res) => {
  const dest = path.join(dataDir, '1');
  fs.mkdirSync(dest, { recursive: true });
  const zip = await JSZip.loadAsync(Buffer.from(''));
  for (const [relativePath, file] of Object.entries(zip.files)) {
    if (relativePath.includes('..')) continue;
    const resolved = path.resolve(dest, relativePath);
    if (!resolved.startsWith(path.resolve(dest))) continue;
    if (!file.dir) fs.writeFileSync(resolved, await file.async('nodebuffer'));
  }
  res.json({ projectId: '1' });
});
app.post('/api/projects/save/:id', (req, res) => { saveRecent([{ id: req.params.id }]); res.json({ ok: true }); });
app.get('/api/projects/recent', (_req, res) => res.json(loadRecent()));
app.post('/api/analysis/start/:id', (_req, res) => res.json({ findings: [{ message: 'eval' }], files: [1,2,3], totalFiles: 3 }));
app.get('/api/analysis/:id', (_req, res) => res.json({ findings: [{ message: 'eval' }], files: [1,2,3], totalFiles: 3 }));
export default app;
`;
  // analysis shallow also needs readFile utf-8 scan — this fixture is for static UI only
  assert.throws(
    () => rejectMissingStaticUiServe(
      { relPath: 'server/index.ts', content: apiOnly },
      ['/api/projects/upload', '/api/analysis']
    ),
    /EDIT_STATIC_UI_REQUIRED/
  );
  assert.equal(hasStaticUiServe(apiOnly), false);
});

test('rejects in-memory save/recent without durable DATA_DIR writes (oracle R6)', () => {
  const ephemeral = `
import express from 'express';
const app = express();
const dataDir = process.env.DATA_DIR || process.env.JC_DATA_DIR;
const recent = [];
app.post('/api/projects/save/:id', (req, res) => { recent.push({ id: req.params.id }); res.json({ ok: true }); });
app.get('/api/projects/recent', (_req, res) => res.json(recent));
export default app;
`;
  assert.throws(
    () => rejectEphemeralProjectPersistence(
      { relPath: 'server/index.ts', content: ephemeral },
      ['/api/projects/save', '/api/projects/recent']
    ),
    /EDIT_PERSISTENCE_EPHEMERAL/
  );
});

test('rejects count-only analysis without eval findings scan (G2x oracle R4)', () => {
  const shallow = `
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
const app = express();
const dataDir = process.env.DATA_DIR || process.env.JC_DATA_DIR;
// Helper: Analyze project files (simulated for now, but uses real file system)
function analyzeProject(projectId) {
  const projectDir = path.join(dataDir, projectId);
  let totalFiles = 0;
  function countFiles(dirPath) {
    for (const file of fs.readdirSync(dirPath)) {
      const fullPath = path.join(dirPath, file);
      if (fs.statSync(fullPath).isDirectory()) countFiles(fullPath);
      else totalFiles++;
    }
  }
  countFiles(projectDir);
  return { projectId, totalFiles, status: 'completed' };
}
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
app.post('/api/projects/upload', async (_req, res) => {
  await fs.promises.mkdir(dataDir, { recursive: true });
  res.json({ projectId: '1' });
});
app.post('/api/analysis/start/:id', (req, res) => res.json(analyzeProject(req.params.id)));
app.get('/api/analysis/:id', (req, res) => res.json(analyzeProject(req.params.id)));
export default app;
`;
  assert.throws(
    () => rejectShallowAnalysisImplementation(
      { relPath: 'server/index.ts', content: shallow },
      ['/api/analysis/start', '/api/analysis']
    ),
    /EDIT_ANALYSIS_SHALLOW|EDIT_PLACEHOLDER_REJECTED/
  );
  assert.throws(
    () => enforceApiImplementationContracts(
      [{ relPath: 'server/index.ts', content: shallow }],
      ['/api/health', '/api/projects/upload', '/api/analysis/start', '/api/analysis']
    ),
    /EDIT_ANALYSIS_SHALLOW|EDIT_PLACEHOLDER_REJECTED/
  );
});

test('rejects upload handlers that ignore env DATA_DIR (G2o hardcoded ./data)', () => {
  const hardcoded = `
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
const app = express();
const dataDir = path.join(process.cwd(), 'data');
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
app.post('/api/projects/upload', async (_req, res) => {
  const id = crypto.randomUUID();
  await fs.mkdir(path.join(dataDir, id), { recursive: true });
  await JSZip.loadAsync(Buffer.from(''));
  await fs.writeFile(path.join(dataDir, id, 'src/smoke.js'), 'ok');
  res.json({ projectId: id });
});
export default app;
`;
  assert.equal(usesEnvDataDir(hardcoded), false);
  assert.throws(
    () => rejectUploadIgnoringEnvDataDir(
      { relPath: 'server/index.ts', content: hardcoded },
      ['/api/projects/upload']
    ),
    /EDIT_UPLOAD_DATA_DIR_REQUIRED/
  );
  assert.throws(
    () => enforceApiImplementationContracts(
      [{ relPath: 'server/index.ts', content: hardcoded }],
      ['/api/health', '/api/projects/upload', '/api/analysis/start']
    ),
    /EDIT_UPLOAD_DATA_DIR_REQUIRED/
  );
});

test('rejects theater upload that returns projectId without extract/write', () => {
  const theater = `
import express from 'express';
const app = express();
const dataDir = process.env.DATA_DIR || process.env.JC_DATA_DIR;
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
app.post('/api/projects/upload', (_req, res) => res.json({ projectId: 'theater-1' }));
export default app;
`;
  assert.throws(
    () => rejectUploadWithoutPersistence(
      { relPath: 'server/index.ts', content: theater },
      ['/api/projects/upload']
    ),
    /EDIT_UPLOAD_PERSISTENCE_REQUIRED/
  );
});

test('rejects Express 4 wildcards that crash Express 5 path-to-regexp (G2r)', () => {
  assert.ok(describeUnsafeExpressRoutePattern('/api/projects/file/:id/*'));
  assert.ok(describeUnsafeExpressRoutePattern('/api/projects/file/:id/(.*)'));
  assert.ok(describeUnsafeExpressRoutePattern('/api/projects/file/:id/:path*'));
  assert.equal(describeUnsafeExpressRoutePattern('/api/projects/file/:id/:path'), null);
  assert.equal(describeUnsafeExpressRoutePattern('/api/projects/file/:id/{*path}'), null);
  assert.equal(describeUnsafeExpressRoutePattern('/api/projects/file/:id/*path'), null);
  assert.equal(describeUnsafeExpressRoutePattern('/api/projects/file'), null);
  assert.match(
    suggestSafeExpressRouteRewrite('/api/projects/file/:id/*') || '',
    /req\.query\.projectId/
  );

  const legacy = `
import express from 'express';
const app = express();
const dataDir = process.env.DATA_DIR || process.env.JC_DATA_DIR;
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
app.get('/api/projects/file/:id/*', (_req, res) => res.send('x'));
app.post('/api/projects/upload', async (_req, res) => {
  await import('node:fs/promises').then((fs) => fs.mkdir(dataDir, { recursive: true }));
  res.json({ projectId: '1' });
});
export default app;
`;
  assert.throws(
    () => rejectUnsafeExpressRoutePatterns({ relPath: 'server/index.ts', content: legacy }),
    /EDIT_EXPRESS_ROUTE_INVALID.*req\.query\.projectId/
  );
  assert.throws(
    () => enforceApiImplementationContracts(
      [{ relPath: 'server/index.ts', content: legacy }],
      ['/api/health', '/api/projects/upload']
    ),
    /EDIT_EXPRESS_ROUTE_INVALID/
  );

  // Client-matching query-string route + named params are accepted (no bare splat).
  const clientSafe = `
import express from 'express';
const app = express();
const dataDir = process.env.DATA_DIR || process.env.JC_DATA_DIR;
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
app.get('/api/projects/file', (req, res) => {
  const projectId = String(req.query.projectId || '');
  const rel = String(req.query.path || '');
  res.type('text').send([dataDir, projectId, rel].join('/'));
});
app.get('/api/projects/file/:projectId/:filePath', (_req, res) => res.send('x'));
app.post('/api/projects/upload', async (_req, res) => {
  await import('node:fs/promises').then((fs) => fs.mkdir(dataDir, { recursive: true }));
  res.json({ projectId: '1' });
});
export default app;
`;
  assert.doesNotThrow(
    () => rejectUnsafeExpressRoutePatterns({ relPath: 'server/index.ts', content: clientSafe })
  );
});

test('rejects model edits that target toolchain build output (G2v dist/index.js)', () => {
  assert.throws(
    () => rejectBuildOutputEdits({ relPath: 'dist/index.js', content: 'export default {};\n' }),
    /EDIT_BUILD_OUTPUT_REJECTED/
  );
  assert.throws(
    () => enforceApiImplementationContracts(
      [{ relPath: 'dist/index.js', content: 'app.get("/api/health", () => {});\n' }],
      ['/api/health']
    ),
    /EDIT_BUILD_OUTPUT_REJECTED/
  );
  assert.doesNotThrow(() => rejectBuildOutputEdits({
    relPath: 'server/index.ts',
    content: 'export default {};\n'
  }));
});
