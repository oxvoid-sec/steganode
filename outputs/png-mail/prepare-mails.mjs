#!/usr/bin/env node
import { promises as fs, constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// This utility only prepares local folders. It never sends any email.
const [input, output, rawLimit = '17'] = process.argv.slice(2);
if (!input || !output) {
  console.error('Usage: node prepare-mails.mjs <dossier-PNG-encodes> <nouveau-dossier-lots> [limite-Mio=17]');
  process.exit(1);
}
const limit = Math.floor(Number(rawLimit) * 1024 * 1024);
if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error('Limite de taille invalide');
const creditPath = fileURLToPath(new URL('./CREDITS.txt', import.meta.url));
const credits = await fs.readFile(creditPath);
const entries = await fs.readdir(input, { withFileTypes: true });
const files = [];
for (const entry of entries.filter((e) => e.isFile() && /\.png$/i.test(e.name))) {
  const source = path.resolve(input, entry.name);
  const size = (await fs.stat(source)).size;
  if (size + credits.length > limit) throw new Error(`${entry.name} depasse la limite: aucune copie effectuee. Ne redimensionnez pas une image encodee.`);
  files.push({ source, name: entry.name, bytes: size });
}
if (!files.length) throw new Error('Aucun PNG trouve');
const groups = [];
for (const file of files.sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name))) {
  let group = groups.find((g) => g.bytes + file.bytes <= limit);
  if (!group) { group = { bytes: credits.length, files: [] }; groups.push(group); }
  group.files.push(file);
  group.bytes += file.bytes;
}
// Refuse an existing destination, to avoid mixing an earlier set with a new one.
await fs.mkdir(output, { recursive: false });
const manifest = [];
for (let index = 0; index < groups.length; index++) {
  const group = groups[index];
  const name = `mail-${String(index + 1).padStart(3, '0')}`;
  const directory = path.join(output, name);
  await fs.mkdir(directory);
  await fs.copyFile(creditPath, path.join(directory, 'CREDITS.txt'), constants.COPYFILE_EXCL);
  for (const file of group.files) {
    await fs.copyFile(file.source, path.join(directory, file.name), constants.COPYFILE_EXCL);
  }
  manifest.push({ folder: name, attachmentBytes: group.bytes, images: group.files.map((f) => f.name) });
  console.log(`${name}: ${group.files.length} image(s), ${(group.bytes / 1048576).toFixed(2)} Mio de pieces jointes`);
}
await fs.writeFile(path.join(output, 'lots.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
console.log(`${files.length} PNG repartis en ${groups.length} mails. Aucun message envoye.`);
