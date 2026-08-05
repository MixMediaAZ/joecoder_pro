import fs from 'node:fs/promises';

const app = await fs.readFile('public/app.js', 'utf8');
const bootstrap = await fs.readFile('public/bootstrap.html', 'utf8');
const appHtml = await fs.readFile('public/app.html', 'utf8');
const bootstrapScript = await fs.readFile('public/bootstrap.js', 'utf8');

new Function(app);

const inlineScripts = [...bootstrap.matchAll(/<script>([\s\S]*?)<\/script>/gi)];
if (inlineScripts.length !== 0) {
  throw new Error('Inline bootstrap scripts are forbidden by the runtime CSP');
}
new Function(bootstrapScript);
if (!bootstrap.includes('<script src="/bootstrap.js"></script>')) {
  throw new Error('bootstrap.html does not load the verified external script');
}

if (!appHtml.includes('<script src="/app.js"></script>')) {
  throw new Error('app.html does not load the verified browser application script');
}
if (app.includes('sessionStorage') || bootstrap.includes('sessionStorage') || bootstrapScript.includes('sessionStorage')) {
  throw new Error('Browser credential storage is forbidden');
}
if (app.includes('Bearer')) {
  throw new Error('Bearer credentials are forbidden in the browser application');
}

console.log('Browser assets parse successfully and contain no persisted credentials.');
