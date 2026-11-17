import express from 'express';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

// Exported Next pages contain hydration scripts. Hash their exact bytes rather
// than granting arbitrary inline script execution to the workspace.
export async function workspaceAssets(root: string): Promise<express.Router> {
  const router = express.Router();
  const absoluteRoot = path.resolve(root);
  const policy = (hashes: Set<string>) => [
      "default-src 'self'", `script-src 'self' ${[...hashes].join(' ')}`,
      "style-src 'self' 'unsafe-inline'", "img-src 'self' data:",
      "connect-src 'self'", "frame-src http://localhost:* http://127.0.0.1:*", "object-src 'none'", "base-uri 'self'", "frame-ancestors 'self'"
    ].join('; ');
  router.use(async (req, res, next) => {
    res.setHeader('Content-Security-Policy', policy(new Set()));
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    let requested: string;
    try { requested = decodeURIComponent(req.path); }
    catch { res.status(400).send('Invalid workspace path'); return; }
    const file = path.resolve(absoluteRoot, '.' + requested + (requested.endsWith('/') ? 'index.html' : ''));
    const relative = path.relative(absoluteRoot, file);
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
      res.status(403).send('Invalid workspace path'); return;
    }
    if (!file.endsWith('.html')) return next();
    try {
      // Read once: the policy and response must describe the same build, even if
      // a frontend rebuild replaces the export while the server remains running.
      const html = await fs.readFile(file, 'utf8');
      const hashes = new Set<string>();
      for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
        if (!/\bsrc\s*=/i.test(match[1] || '') && match[2]) {
          hashes.add(`'sha256-${createHash('sha256').update(match[2]).digest('base64')}'`);
        }
      }
      res.setHeader('Content-Security-Policy', policy(hashes));
      res.setHeader('Cache-Control', 'no-store');
      res.type('html').send(html);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return next(error);
    }
    next();
  });
  router.use(express.static(root));
  return router;
}
