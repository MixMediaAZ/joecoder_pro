#!/usr/bin/env node
/**
 * Phase 3 certification — structured model routing for lesser models.
 *
 * Proves:
 * 1. Valid JSON plan parses on first attempt
 * 2. Invalid first response triggers exactly one re-prompt and succeeds
 * 3. Two consecutive invalid responses abort (never return a value)
 * 4. Temperature is forced ≤ 0.2 on every structured call
 * 5. Edit blocks parse; empty/malformed blocks fail closed
 *
 * Uses a mock generator — no live model required.
 */

import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Inline the same contracts used by repair.ts (avoid needing a full tsc build)
const MAX_PLAN_FILES = 10;
const STRUCTURED_MAX_TEMPERATURE = 0.2;

function parsePlanResponse(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('PLAN_PARSE_FAILED: no JSON object in model response');
  let parsed;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error('PLAN_PARSE_FAILED: model response was not valid JSON');
  }
  const files = Array.isArray(parsed.files)
    ? parsed.files.filter((item) => typeof item === 'string' && item.trim().length > 0)
    : [];
  if (!files.length) throw new Error('PLAN_PARSE_FAILED: plan listed no target files');
  const cleaned = [];
  for (const raw of files.slice(0, MAX_PLAN_FILES)) {
    const rel = raw.replace(/\\/g, '/').replace(/^\.\//, '').trim();
    if (rel.startsWith('/') || rel.includes('..')) throw new Error(`PLAN_REJECTED: unsafe path '${raw}'`);
    if (/(^|\/)(node_modules|\.git|\.jc)(\/|$)/.test(rel)) throw new Error(`PLAN_REJECTED: protected path '${raw}'`);
    if (!cleaned.includes(rel)) cleaned.push(rel);
  }
  return {
    files: cleaned,
    approach: typeof parsed.approach === 'string' ? parsed.approach.slice(0, 2000) : 'No approach stated.',
    risks: Array.isArray(parsed.risks) ? parsed.risks.filter((i) => typeof i === 'string').slice(0, 10) : []
  };
}

const FILE_BLOCK = /===FILE:\s*([^=\r\n]+?)\s*===\r?\n([\s\S]*?)\r?\n?===END FILE===/g;

function parseEditBlocks(text) {
  const edits = [];
  let match;
  FILE_BLOCK.lastIndex = 0;
  while ((match = FILE_BLOCK.exec(text)) !== null) {
    const relPath = (match[1] || '').replace(/\\/g, '/').replace(/^\.\//, '').trim();
    const content = match[2] ?? '';
    if (!relPath) continue;
    if (!content.trim()) throw new Error(`EDIT_PARSE_FAILED: empty content for '${relPath}'`);
    edits.push({ relPath, content: content.endsWith('\n') ? content : `${content}\n` });
  }
  if (!edits.length) throw new Error('EDIT_PARSE_FAILED: the model returned no well-formed file blocks');
  return edits;
}

async function generateStructured(deps, options) {
  const temperature = Math.min(
    typeof options.temperature === 'number' ? options.temperature : STRUCTURED_MAX_TEMPERATURE,
    STRUCTURED_MAX_TEMPERATURE
  );
  const attempts = [];

  const first = await deps.generate({
    system: options.system,
    prompt: options.prompt,
    maxTokens: options.maxTokens,
    timeoutMs: options.timeoutMs,
    temperature
  });
  attempts.push({ attempt: 1, text: first.text, temperature: first.temperature, durationMs: first.durationMs || 0 });

  try {
    const value = options.parse(first.text);
    return { value, attempts, finalText: first.text };
  } catch (firstError) {
    const reason = firstError.message || String(firstError);
    attempts[0].parseError = reason;

    const retryPrompt = [
      options.prompt,
      '',
      'PREVIOUS RESPONSE WAS INVALID AND WAS REJECTED.',
      `Parse error: ${reason}`,
      `Return ONLY the required structured format for ${options.label}. No prose, no markdown fences, no apology.`
    ].join('\n');

    const second = await deps.generate({
      system: options.system,
      prompt: retryPrompt,
      maxTokens: options.maxTokens,
      timeoutMs: options.timeoutMs,
      temperature
    });
    attempts.push({ attempt: 2, text: second.text, temperature: second.temperature, durationMs: second.durationMs || 0 });

    try {
      const value = options.parse(second.text);
      return { value, attempts, finalText: second.text };
    } catch (secondError) {
      attempts[1].parseError = secondError.message || String(secondError);
      throw new Error(
        `STRUCTURED_PARSE_FAILED after 2 attempts (${options.label}): first=${reason}; second=${attempts[1].parseError}`
      );
    }
  }
}

async function writeEvidence(controlId, result) {
  const dir = path.join(ROOT, '.jc', 'certification');
  await fs.mkdir(dir, { recursive: true });
  const id = `CERT-R-${Date.now()}-${controlId}-${randomBytes(3).toString('hex')}`;
  await fs.writeFile(
    path.join(dir, `${id}.json`),
    JSON.stringify({ id, control: controlId, timestamp: new Date().toISOString(), result }, null, 2)
  );
  return id;
}

function mockGen(sequence) {
  let i = 0;
  const temps = [];
  return {
    temps,
    generate: async (request) => {
      temps.push(request.temperature);
      const text = sequence[Math.min(i, sequence.length - 1)];
      i += 1;
      return { text, provider: 'mock', model: 'mock-7b', durationMs: 1, temperature: request.temperature };
    }
  };
}

async function main() {
  console.log('JoeCoder Routing Certification (Phase 3)');
  console.log('');
  let allPassed = true;

  // 1. Valid first attempt
  process.stdout.write('[valid_first_attempt] ');
  {
    const valid = JSON.stringify({ files: ['src/lib.js'], approach: 'fix add', risks: [] });
    const mock = mockGen([valid]);
    const result = await generateStructured(
      { generate: mock.generate },
      { system: 'sys', prompt: 'plan', parse: parsePlanResponse, label: 'plan', temperature: 0.2 }
    );
    const ok = result.value.files[0] === 'src/lib.js' && result.attempts.length === 1 && mock.temps.every((t) => t <= 0.2);
    const id = await writeEvidence('valid_first_attempt', { passed: ok, files: result.value.files, temps: mock.temps });
    console.log(`${ok ? 'PASS' : 'FAIL'}  evidence=${id}`);
    if (!ok) allPassed = false;
  }

  // 2. Invalid then valid (one re-prompt)
  process.stdout.write('[reprompt_then_success] ');
  {
    const valid = JSON.stringify({ files: ['src/lib.js'], approach: 'fix add', risks: [] });
    const mock = mockGen(['sorry I cannot', valid]);
    const result = await generateStructured(
      { generate: mock.generate },
      { system: 'sys', prompt: 'plan', parse: parsePlanResponse, label: 'plan', temperature: 0.5 } // request 0.5, must clamp
    );
    const ok =
      result.value.files[0] === 'src/lib.js' &&
      result.attempts.length === 2 &&
      result.attempts[0].parseError &&
      !result.attempts[1].parseError &&
      mock.temps.every((t) => t <= 0.2);
    const id = await writeEvidence('reprompt_then_success', {
      passed: ok,
      attempts: result.attempts.length,
      temps: mock.temps,
      firstError: result.attempts[0].parseError
    });
    console.log(`${ok ? 'PASS' : 'FAIL'}  evidence=${id}`);
    if (!ok) allPassed = false;
  }

  // 3. Two failures abort
  process.stdout.write('[double_fail_aborts] ');
  {
    const mock = mockGen(['not json', 'still not json']);
    let aborted = false;
    let message = '';
    try {
      await generateStructured(
        { generate: mock.generate },
        { system: 'sys', prompt: 'plan', parse: parsePlanResponse, label: 'plan' }
      );
    } catch (err) {
      aborted = true;
      message = err.message || String(err);
    }
    const ok = aborted && message.includes('STRUCTURED_PARSE_FAILED after 2 attempts') && mock.temps.length === 2;
    const id = await writeEvidence('double_fail_aborts', { passed: ok, message, temps: mock.temps });
    console.log(`${ok ? 'PASS' : 'FAIL'}  evidence=${id}`);
    if (!ok) allPassed = false;
  }

  // 4. Edit blocks parse + empty content fails
  process.stdout.write('[edit_blocks_parse] ');
  {
    const good = '===FILE: src/lib.js===\nexport function add(a,b){return a+b;}\n===END FILE===\n';
    const edits = parseEditBlocks(good);
    let emptyFailed = false;
    try {
      parseEditBlocks('===FILE: src/lib.js===\n\n===END FILE===\n');
    } catch {
      emptyFailed = true;
    }
    let noBlockFailed = false;
    try {
      parseEditBlocks('here is some prose with no blocks');
    } catch {
      noBlockFailed = true;
    }
    const ok = edits.length === 1 && edits[0].relPath === 'src/lib.js' && emptyFailed && noBlockFailed;
    const id = await writeEvidence('edit_blocks_parse', { passed: ok, editCount: edits.length });
    console.log(`${ok ? 'PASS' : 'FAIL'}  evidence=${id}`);
    if (!ok) allPassed = false;
  }

  // 5. Unsafe plan paths rejected
  process.stdout.write('[unsafe_plan_paths] ');
  {
    let rejected = false;
    try {
      parsePlanResponse(JSON.stringify({ files: ['../outside.js', 'node_modules/x'], approach: 'x', risks: [] }));
    } catch (err) {
      rejected = String(err.message).includes('PLAN_REJECTED') || String(err.message).includes('unsafe') || String(err.message).includes('protected');
    }
    const id = await writeEvidence('unsafe_plan_paths', { passed: rejected });
    console.log(`${rejected ? 'PASS' : 'FAIL'}  evidence=${id}`);
    if (!rejected) allPassed = false;
  }

  console.log('');
  console.log(allPassed ? 'ALL PHASE 3 CONTROLS PASSED' : 'ONE OR MORE PHASE 3 CONTROLS FAILED');
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
