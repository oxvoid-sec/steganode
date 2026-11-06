#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { encode, decode, inspectImages } from '../src/stegzip.js';

const HELP = `stegzip - cacher un ZIP chiffre dans des images PNG

Usage:
  stegzip encode -i archive.zip -c image1.png image2.png -o dossier [--password secret]
  stegzip decode -i image1.steg.png image2.steg.png -o archive.zip [--password secret]
  stegzip inspect -i image1.steg.png image2.steg.png

Options:
  -i, --input <fichier(s)>   ZIP (encode) ou PNG steganographiques (decode/inspect)
  -c, --carriers <png...>   Images PNG porteuses pour encode
  -o, --output <chemin>     Dossier de sortie (encode) ou fichier ZIP (decode)
  -p, --password <secret>   Mot de passe; sinon STEGZIP_PASSWORD ou saisie interactive
  -q, --quiet               Masquer la progression
  -h, --help                Afficher cette aide

Conseil: evitez --password dans un terminal partage; utilisez la saisie interactive ou
la variable d'environnement STEGZIP_PASSWORD.
`;

function fail(message, code = 1) {
  console.error(`Erreur: ${message}`);
  process.exitCode = code;
}

async function expandImagePaths(paths) {
  const result = [];
  for (const item of paths) {
    if ((await fs.stat(item)).isDirectory()) {
      const entries = await fs.readdir(item, { withFileTypes: true });
      result.push(...entries.filter((entry) => entry.isFile() && /\.png$/i.test(entry.name))
        .map((entry) => path.join(item, entry.name)).sort());
    } else result.push(item);
  }
  return result;
}

async function getPassword(explicit, confirmation = false) {
  if (explicit) return explicit;
  if (process.env.STEGZIP_PASSWORD) return process.env.STEGZIP_PASSWORD;
  if (!input.isTTY) throw new Error('mot de passe absent (utilisez --password ou STEGZIP_PASSWORD)');

  const hiddenQuestion = async (prompt) => {
    if (typeof input.setRawMode !== 'function') {
      const rl = createInterface({ input, output });
      try { return await rl.question(prompt); } finally { rl.close(); }
    }
    output.write(prompt);
    input.setRawMode(true);
    input.resume();
    return new Promise((resolve, reject) => {
      let answer = '';
      const cleanup = () => {
        input.off('data', onData);
        input.setRawMode(false);
        input.pause();
        output.write('\n');
      };
      const onData = (chunk) => {
        for (const char of chunk.toString('utf8')) {
          if (char === '\r' || char === '\n') { cleanup(); resolve(answer); return; }
          if (char === '\u0003') { cleanup(); reject(new Error('operation annulee')); return; }
          if (char === '\u007f' || char === '\b') answer = answer.slice(0, -1);
          else if (char >= ' ') answer += char;
        }
      };
      input.on('data', onData);
    });
  };

  try {
    const password = await hiddenQuestion('Mot de passe: ');
    if (!password) throw new Error('le mot de passe ne peut pas etre vide');
    if (confirmation) {
      const repeated = await hiddenQuestion('Confirmez le mot de passe: ');
      if (password !== repeated) throw new Error('les mots de passe ne correspondent pas');
    }
    return password;
  } catch (error) { throw error; }
}

async function main() {
  const command = process.argv[2];
  if (!command || command === '-h' || command === '--help') {
    console.log(HELP);
    return;
  }

  const { values, positionals } = parseArgs({
    args: process.argv.slice(3),
    allowPositionals: true,
    strict: true,
    options: {
      input: { type: 'string', short: 'i', multiple: true },
      carriers: { type: 'string', short: 'c', multiple: true },
      output: { type: 'string', short: 'o' },
      password: { type: 'string', short: 'p' },
      quiet: { type: 'boolean', short: 'q' },
      help: { type: 'boolean', short: 'h' }
    }
  });

  if (values.help) {
    console.log(HELP);
    return;
  }

  const onProgress = values.quiet ? undefined : ({ stage, current, total }) => {
    const labels = { scan: 'Verification des images', encrypt: 'Preparation', images: 'Traitement des images', decrypt: 'Restauration et verification' };
    console.error(`${labels[stage] ?? stage}: ${current}/${total} (${Math.floor(current * 100 / total)} %)`);
  };

  // Multiple values after -i/-c are accepted as positionals for convenient shell use.
  if (command === 'encode') {
    const zipPath = values.input?.[0];
    const carriers = await expandImagePaths([...(values.carriers ?? []), ...positionals]);
    if (!zipPath || carriers.length === 0 || !values.output) {
      throw new Error('encode exige --input, --carriers et --output');
    }
    const password = await getPassword(values.password, true);
    const result = await encode({ zipPath, carrierPaths: carriers, outputDir: values.output, password, onProgress });
    console.log(`OK: ${result.bytes} octets proteges dans ${result.outputPaths.length} image(s).`);
    for (const path of result.outputPaths) console.log(path);
    return;
  }

  if (command === 'decode') {
    const images = await expandImagePaths([...(values.input ?? []), ...positionals]);
    if (images.length === 0 || !values.output) throw new Error('decode exige --input et --output');
    const password = await getPassword(values.password);
    const result = await decode({ imagePaths: images, outputPath: values.output, password, onProgress });
    console.log(`OK: ZIP restaure (${result.bytes} octets): ${result.outputPath}`);
    return;
  }

  if (command === 'inspect') {
    const images = await expandImagePaths([...(values.input ?? []), ...positionals]);
    if (images.length === 0) throw new Error('inspect exige --input');
    const info = await inspectImages(images);
    console.log(JSON.stringify(info, null, 2));
    return;
  }

  throw new Error(`commande inconnue: ${command}`);
}

main().catch((error) => fail(error.message));
