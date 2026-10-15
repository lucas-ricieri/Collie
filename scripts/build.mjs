import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import './generate-notices.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await build({
  absWorkingDir: root,
  entryPoints: ['renderer/app.js'],
  outfile: 'renderer/app.bundle.js',
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: ['chrome130'],
  minify: true,
  sourcemap: false,
  legalComments: 'eof',
  logLevel: 'info'
});
