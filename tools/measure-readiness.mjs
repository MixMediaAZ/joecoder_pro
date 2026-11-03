import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { performSurvey } from '../dist/survey.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtimeDirectory = path.resolve(process.argv[2] || path.join(root, '.jc/readiness/runtime-20260909'));
const runtime = JSON.parse(await fs.readFile(path.join(runtimeDirectory, 'server-runtime.json'), 'utf8'));
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(runtime.baseUrl)) throw new Error('A loopback runtime is required.');
const output = path.join(root, '.jc/readiness', `measurements-${Date.now()}.json`);
const measurements = { recordedAt: new Date().toISOString(), baseUrl: runtime.baseUrl,
  machine: { cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, ramBytes: os.totalmem(), freeRamBytes: os.freemem(), node: process.version },
  context: 'Warm HTTP samples; UI usability and cold startup are separate measurements.', http: [], surveys: [] };
for (const route of ['/health', '/workspace/']) {
  const durations = [];
  for (let i = 0; i < 30; i++) {
    const started = performance.now();
    const response = await fetch(runtime.baseUrl + route, { signal: AbortSignal.timeout(5000) });
    await response.arrayBuffer();
    if (!response.ok) throw new Error(`${route}: ${response.status}`);
    durations.push(performance.now() - started);
  }
  const sorted = [...durations].sort((a, b) => a - b);
  measurements.http.push({ route, samples: durations, p50Ms: sorted[14], p95Ms: sorted[28], maxMs: sorted[29] });
}
for (let i = 0; i < 3; i++) {
  const started = performance.now();
  const survey = await performSurvey(path.join(root, 'acceptance-fixtures'), 8, 5000, AbortSignal.timeout(30000));
  measurements.surveys.push({ durationMs: performance.now() - started, summary: survey.summary, status: survey.status });
}
await fs.writeFile(output, JSON.stringify(measurements, null, 2));
console.log(JSON.stringify({ output, http: measurements.http.map(({ samples, ...summary }) => summary), surveys: measurements.surveys }, null, 2));
