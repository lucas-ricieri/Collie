import './build.mjs';
import { packager } from '@electron/packager';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appPaths = await packager({
  dir: root,
  name: 'Collie',
  executableName: 'Collie',
  platform: 'win32',
  arch: 'x64',
  out: path.join(root, 'releases'),
  overwrite: true,
  asar: true,
  prune: true,
  icon: path.join(root, 'assets', 'icon.ico'),
  appCopyright: 'Collie — projeto independente',
  win32metadata: { CompanyName: 'Collie', FileDescription: 'Collie — Editor Markdown', ProductName: 'Collie' },
  ignore: [/^\/(?:releases|work|tests|outputs|\.git)(?:\/|$)/, /^\/renderer\/app\.js$/, /^\/scripts(?:\/|$)/]
});
for (const appPath of appPaths) console.log(`Aplicativo Windows: ${appPath}`);
