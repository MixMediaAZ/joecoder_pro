import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// Dedicated local connection file; existing process settings take precedence.
const file = fileURLToPath(new URL('../.powerrouter.env', import.meta.url));
if (fs.existsSync(file)) {
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^(JC_POWERROUTER_URL|JC_POWERROUTER_KEY|JC_POWERROUTER_PROJECT)=(.*)$/);
    const [, name, rawValue] = match || [];
    if (!name || rawValue === undefined || process.env[name]) continue;
    const raw = rawValue.trim();
    process.env[name] = raw.startsWith('"') ? JSON.parse(raw) : raw;
  }
}
