import assert from 'node:assert/strict';
import test from 'node:test';
import {
  declaredPackageNames,
  declaredUploadHelperPackages,
  extractBarePackageNames,
  rejectUndeclaredPackageImports,
  undeclaredPackageImportsInSource
} from './packageImportPolicy.js';

test('extracts bare and scoped package names and ignores relatives/builtins', () => {
  const source = `
import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '@neondatabase/serverless';
import local from './local.js';
import fs from 'node:fs';
const dyn = await import('cors');
require('path');
`;
  assert.deepEqual(extractBarePackageNames(source), [
    '@neondatabase/serverless',
    'cors',
    'express',
    'uuid'
  ]);
});

test('JSDoc import() type hints are not treated as runtime package imports', () => {
  const source = `/** @type {import('postcss-load-config').Config} */
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
`;
  assert.deepEqual(extractBarePackageNames(source), []);
});

test('rejects undeclared imports unless package.json edit adds them', () => {
  const packageJson = JSON.stringify({
    name: 'app',
    dependencies: { express: '^4.0.0' }
  }, null, 2);
  assert.throws(
    () => rejectUndeclaredPackageImports([{
      relPath: 'server/index.ts',
      content: "import { v4 as uuidv4 } from 'uuid';\nexport const id = uuidv4();\n"
    }], packageJson),
    /EDIT_UNDECLARED_PACKAGE_IMPORT.*uuid/
  );

  const allowed = rejectUndeclaredPackageImports([
    {
      relPath: 'package.json',
      content: JSON.stringify({
        name: 'app',
        dependencies: { express: '^4.0.0', uuid: '^11.0.0' }
      }, null, 2)
    },
    {
      relPath: 'server/index.ts',
      content: "import { v4 as uuidv4 } from 'uuid';\nexport const id = uuidv4();\n"
    }
  ], packageJson);
  assert.equal(allowed.length, 2);

  const declared = declaredPackageNames(packageJson);
  assert.deepEqual(undeclaredPackageImportsInSource("import x from 'uuid';\n", declared), ['uuid']);
  assert.deepEqual(undeclaredPackageImportsInSource("import express from 'express';\n", declared), []);
});

test('undeclared upload imports hint at declared jszip/multer helpers (G2p)', () => {
  const packageJson = JSON.stringify({
    name: 'inspector',
    dependencies: { express: '^5.0.0', jszip: '^3.10.1', multer: '^2.0.0' }
  }, null, 2);
  assert.deepEqual(declaredUploadHelperPackages(packageJson), ['jszip', 'multer']);
  assert.throws(
    () => rejectUndeclaredPackageImports([{
      relPath: 'server/index.ts',
      content: "import unzipper from 'unzipper';\nimport archiver from 'archiver';\nexport {}\n"
    }], packageJson),
    /EDIT_UNDECLARED_PACKAGE_IMPORT[\s\S]*jszip[\s\S]*multer/
  );
});
