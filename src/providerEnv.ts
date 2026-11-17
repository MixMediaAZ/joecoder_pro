import fs from 'node:fs';
import { parseEnv } from 'node:util';

// Only provider settings are loaded; shell variables take precedence.
const file = new URL('../.env', import.meta.url);
if (fs.existsSync(file)) {
  for (const [name, value] of Object.entries(parseEnv(fs.readFileSync(file, 'utf8')))) {
    if (/^(DEEPSEEK_API_KEY|REPLICATE_API_TOKEN|REPLICATE_API_KEY|JC_CLOUD_PROVIDER|JC_DEEPSEEK_[A-Z_]+|JC_REPLICATE_[A-Z_]+)$/.test(name)
      && process.env[name] === undefined) process.env[name] = value;
  }
}
