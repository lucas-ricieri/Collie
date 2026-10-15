import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
let output = 'COLLIE — AVISOS E LICENÇAS DE TERCEIROS\n\nAs bibliotecas mantêm suas respectivas licenças. Os textos abaixo vêm das dependências instaladas; a distribuição Electron contém também seus próprios avisos.\nA imagem do border collie foi fornecida pelo usuário.\n';
for (const [relative, info] of Object.entries(lock.packages)) {
  if (!relative || info.dev || info.devOptional) continue;
  const folder = path.join(root, relative);
  if (!fs.existsSync(folder)) continue;
  const metadata = JSON.parse(fs.readFileSync(path.join(folder, 'package.json'), 'utf8'));
  const licenseFile = fs.readdirSync(folder).find(name => /^licen[cs]e(?:\..*)?$/i.test(name));
  output += `\n${'='.repeat(72)}\n${metadata.name}@${metadata.version}\nLicença declarada: ${metadata.license || 'ver pacote'}\n`;
  if (licenseFile) output += `\n${fs.readFileSync(path.join(folder, licenseFile), 'utf8')}\n`;
}
fs.writeFileSync(path.join(root, 'THIRD_PARTY_LICENSES.txt'), output.split('\n').map(line => line.trimEnd()).join('\n').trimEnd() + '\n');
