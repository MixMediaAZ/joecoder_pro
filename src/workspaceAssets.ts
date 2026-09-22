import express from 'express';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

// Exported Next pages contain hydration scripts. Hash their exact bytes rather
// than granting arbitrary inline script execution to the workspace.
export async function workspaceAssets(root: string): Promise<express.Router> {
  const router = express.Router();
  const hashes = new Set<string>();
  async function scan(directory: string): Promise<void> {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) { if (entry.name !== '_next') await scan(file); }
      else if (entry.name.endsWith('.html')) {
        const html = await fs.readFile(file, 'utf8');
        for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
          if (!/\bsrc\s*=/.test(match[1] || '') && match[2]) {
            hashes.add(`'sha256-${createHash('sha256').update(match[2]).digest('base64')}'`);
          }
        }
      }
    }
  }
  try { await scan(root); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  router.use((_req, res, next) => {
    res.setHeader('Content-Security-Policy', [
      "default-src 'self'", `script-src 'self' ${[...hashes].join(' ')}`,
      "style-src 'self' 'unsafe-inline'", "img-src 'self' data:",
      "connect-src 'self'", "frame-src http://localhost:* http://127.0.0.1:*", "object-src 'none'", "base-uri 'self'", "frame-ancestors 'self'"
    ].join('; '));
    next();
  });
  router.use(express.static(root));
  return router;
}
