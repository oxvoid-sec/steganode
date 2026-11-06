import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { PNG } from 'pngjs';
import { encode, decode, HEADER_PIXELS, shuffledPayloadPixels, testing } from '../src/stegzip.js';
import { crc32 } from '../src/crc32.js';

const execFile = promisify(execFileCallback);

// npm.cmd cannot be launched directly with execFile on Windows. npm test supplies
// the path to its JavaScript entry point, which we launch with the current Node.
function runNpm(args, options) {
  return process.env.npm_execpath
    ? execFile(process.execPath, [process.env.npm_execpath, ...args], options)
    : execFile('npm', args, options);
}

function makeZip(dataLength = 7000) {
  const name = Buffer.from('payload.txt');
  const data = Buffer.alloc(dataLength, 0x5a);
  const checksum = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(checksum, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(checksum, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12);
  end.writeUInt32LE(local.length + name.length + data.length, 16);
  return Buffer.concat([local, name, data, central, name, end]);
}

async function fixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stegzip-test-'));
  const zip = makeZip();
  const zipPath = path.join(dir, 'source.zip');
  await fs.writeFile(zipPath, zip);
  const carriers = [];
  for (let n = 0; n < 2; n++) {
    const png = new PNG({ width: 110, height: 110 });
    for (let i = 0; i < png.data.length; i += 4) {
      png.data[i] = (i / 4 + n * 17) & 0xff;
      png.data[i + 1] = 130;
      png.data[i + 2] = 210;
      png.data[i + 3] = 255;
    }
    const carrier = path.join(dir, `cover-${n}.png`);
    await fs.writeFile(carrier, PNG.sync.write(png));
    carriers.push(carrier);
  }
  return { dir, zip, zipPath, carriers };
}

test('encode et decode fidelement un ZIP sur plusieurs PNG, meme dans le desordre', async (t) => {
  const f = await fixture();
  t.after(() => fs.rm(f.dir, { recursive: true, force: true }));
  const encoded = await encode({ zipPath: f.zipPath, carrierPaths: f.carriers, outputDir: path.join(f.dir, 'encoded'), password: 'correct horse battery staple' });
  assert.equal(encoded.outputPaths.length, 2);
  const restored = path.join(f.dir, 'restored.zip');
  await decode({ imagePaths: [...encoded.outputPaths].reverse(), outputPath: restored, password: 'correct horse battery staple' });
  assert.deepEqual(await fs.readFile(restored), f.zip);
});

test('les alias npm optimize, restore et analyze fonctionnent ensemble', async (t) => {
  const f = await fixture();
  t.after(() => fs.rm(f.dir, { recursive: true, force: true }));
  const outputDir = path.join(f.dir, 'npm-processed');
  const restored = path.join(f.dir, 'npm-restored.zip');
  const options = { env: { ...process.env, STEGZIP_PASSWORD: 'test-npm-secret' } };
  const encoded = await runNpm(['run', 'optimize', '--', '-i', f.zipPath, '-c', f.dir, '-o', outputDir], options);
  assert.match(encoded.stderr, /Traitement des images: 2\/2 \(100 %\)/);
  const decoded = await runNpm(['run', 'restore', '--', '-i', outputDir, '-o', restored, '--quiet'], options);
  assert.doesNotMatch(decoded.stderr, /Traitement des images:/);
  assert.deepEqual(await fs.readFile(restored), f.zip);
  const { stdout } = await runNpm(['run', '--silent', 'analyze', '--', '-i', outputDir], options);
  const metadata = JSON.parse(stdout);
  assert.equal(metadata.length, 2);
  assert.equal(metadata[0].originalBytes, f.zip.length);
});

test('rejette un mauvais mot de passe sans creer de sortie', async (t) => {
  const f = await fixture();
  t.after(() => fs.rm(f.dir, { recursive: true, force: true }));
  const encoded = await encode({ zipPath: f.zipPath, carrierPaths: f.carriers, outputDir: path.join(f.dir, 'encoded'), password: 'secret' });
  const output = path.join(f.dir, 'must-not-exist.zip');
  await assert.rejects(
    decode({ imagePaths: encoded.outputPaths, outputPath: output, password: 'incorrect' }),
    /authentification impossible/
  );
  await assert.rejects(fs.access(output));
});

test('detecte une corruption du contenu chiffre', async (t) => {
  const f = await fixture();
  t.after(() => fs.rm(f.dir, { recursive: true, force: true }));
  const password = 'secret';
  const encoded = await encode({ zipPath: f.zipPath, carrierPaths: f.carriers, outputDir: path.join(f.dir, 'encoded'), password });
  const target = encoded.outputPaths[0];
  const png = PNG.sync.read(await fs.readFile(target));
  const header = testing.extractHeader(png);
  const key = await testing.deriveKey(password, header.salt, header.scrypt);
  const pixels = shuffledPayloadPixels(png, key, header.setId, header.imageIndex);
  assert.ok(pixels[0] >= HEADER_PIXELS);
  png.data[pixels[0] * 4] ^= 1;
  await fs.writeFile(target, PNG.sync.write(png));
  await assert.rejects(
    decode({ imagePaths: encoded.outputPaths, outputPath: path.join(f.dir, 'corrupt.zip'), password }),
    /authentification impossible/
  );
});

test('detecte une corruption de l’en-tete avant le dechiffrement', async (t) => {
  const f = await fixture();
  t.after(() => fs.rm(f.dir, { recursive: true, force: true }));
  const encoded = await encode({ zipPath: f.zipPath, carrierPaths: f.carriers, outputDir: path.join(f.dir, 'encoded'), password: 'secret' });
  const png = PNG.sync.read(await fs.readFile(encoded.outputPaths[0]));
  // Pixel 100 se trouve dans les metadonnees, apres la signature magique.
  png.data[100 * 4] ^= 1;
  await fs.writeFile(encoded.outputPaths[0], PNG.sync.write(png));
  await assert.rejects(
    decode({ imagePaths: encoded.outputPaths, outputPath: path.join(f.dir, 'corrupt.zip'), password: 'secret' }),
    /en-tete corrompu/
  );
});

test('le CLI encode et decode avec la syntaxe documentee', async (t) => {
  const f = await fixture();
  t.after(() => fs.rm(f.dir, { recursive: true, force: true }));
  const cli = path.resolve('bin/stegzip.js');
  const encodedDir = path.join(f.dir, 'cli-encoded');
  const restored = path.join(f.dir, 'cli-restored.zip');
  await execFile(process.execPath, [cli, 'encode', '-i', f.zipPath, '-c', ...f.carriers, '-o', encodedDir, '-p', 'cli-secret']);
  await execFile(process.execPath, [cli, 'decode', '-i', path.join(encodedDir, 'carrier-002.steg.png'), path.join(encodedDir, 'carrier-001.steg.png'), '-o', restored, '-p', 'cli-secret']);
  assert.deepEqual(await fs.readFile(restored), f.zip);
});

test('le nouveau decodeur lit une image generee par la version precedente', async (t) => {
  const f = await fixture();
  t.after(() => fs.rm(f.dir, { recursive: true, force: true }));
  const legacy = JSON.parse(await fs.readFile(new URL('./fixtures/legacy.json', import.meta.url), 'utf8'));
  const image = path.join(f.dir, 'legacy.png');
  const output = path.join(f.dir, 'legacy.zip');
  await fs.writeFile(image, Buffer.from(legacy.png, 'base64'));
  await decode({ imagePaths: [image], outputPath: output, password: legacy.password });
  assert.deepEqual(await fs.readFile(output), Buffer.from(legacy.zip, 'base64'));
});

test('gere un tag GCM a cheval sur deux images et un fragment vide', async (t) => {
  const f = await fixture();
  t.after(() => fs.rm(f.dir, { recursive: true, force: true }));
  const capacity = testing.pngCapacity({ width: 110, height: 110 });
  const zip = makeZip(capacity - 8 - 120);
  assert.equal(zip.length, capacity - 8);
  await fs.writeFile(f.zipPath, zip);
  const events = [];
  const result = await encode({ zipPath: f.zipPath, carrierPaths: [...f.carriers, f.carriers[0]],
    outputDir: path.join(f.dir, 'split'), password: 'split', onProgress: (event) => events.push(event) });
  assert.equal(testing.extractHeader(PNG.sync.read(await fs.readFile(result.outputPaths[2]))).chunkLength, 0);
  const restored = path.join(f.dir, 'split.zip');
  await decode({ imagePaths: result.outputPaths.reverse(), outputPath: restored, password: 'split' });
  assert.deepEqual(await fs.readFile(restored), zip);
  assert.deepEqual(events.filter((e) => e.stage === 'images').map((e) => e.current), [0, 1, 2, 3]);
});

test('un echec preserve une destination existante et nettoie les fichiers temporaires', async (t) => {
  const f = await fixture();
  t.after(() => fs.rm(f.dir, { recursive: true, force: true }));
  const result = await encode({ zipPath: f.zipPath, carrierPaths: f.carriers,
    outputDir: path.join(f.dir, 'encoded'), password: 'correct' });
  const target = path.join(f.dir, 'existing.zip');
  await fs.writeFile(target, 'contenu existant');
  await assert.rejects(decode({ imagePaths: result.outputPaths, outputPath: target, password: 'wrong' }), /authentification impossible/);
  assert.equal(await fs.readFile(target, 'utf8'), 'contenu existant');
  assert.equal((await fs.readdir(f.dir)).filter((name) => name.startsWith('.image-tools-')).length, 0);
});

test('capacite insuffisante et jeu incomplet sont rejetes', async (t) => {
  const f = await fixture();
  t.after(() => fs.rm(f.dir, { recursive: true, force: true }));
  const outputDir = path.join(f.dir, 'insufficient');
  await assert.rejects(encode({ zipPath: f.zipPath, carrierPaths: [f.carriers[0]], outputDir, password: 'secret' }), /capacite insuffisante/);
  await assert.rejects(fs.access(outputDir));
  const result = await encode({ zipPath: f.zipPath, carrierPaths: f.carriers, outputDir: path.join(f.dir, 'encoded'), password: 'secret' });
  await assert.rejects(decode({ imagePaths: [result.outputPaths[0]], outputPath: path.join(f.dir, 'missing.zip'), password: 'secret' }), /jeu incomplet/);
});

test('grand ZIP de 85 147 Ko sur 14 PNG de 4096 pixels', { skip: process.env.IMAGE_TOOLS_LARGE_TEST !== '1' }, async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'image-tools-large-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'large.zip');
  await fs.writeFile(source, makeZip(85147 * 1024 - 120));
  const cover = path.join(dir, 'cover.png');
  const createCover = async () => {
    const png = new PNG({ width: 4096, height: 4096 });
    png.data.fill(255);
    await fs.writeFile(cover, PNG.sync.write(png));
  };
  await createCover();
  const onProgress = ({ stage, current, total }) => console.error(`[large] ${stage}: ${current}/${total}`);
  const encoded = await encode({ zipPath: source, carrierPaths: Array(14).fill(cover),
    outputDir: path.join(dir, 'encoded'), password: 'large-test', onProgress });
  const restored = path.join(dir, 'restored.zip');
  await decode({ imagePaths: encoded.outputPaths.reverse(), outputPath: restored, password: 'large-test', onProgress });
  const hash = async (file) => {
    const digest = createHash('sha256');
    for await (const chunk of createReadStream(file)) digest.update(chunk);
    return digest.digest('hex');
  };
  assert.equal(await hash(source), await hash(restored));
  assert.equal((await fs.stat(restored)).size, 85147 * 1024);
  t.diagnostic(`RSS maximal du processus: ${Math.round(process.resourceUsage().maxRSS / 1024)} Mio`);
});
