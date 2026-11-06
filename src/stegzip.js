import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual
} from 'node:crypto';
import { promisify } from 'node:util';
import { PNG } from 'pngjs';
import { crc32 } from './crc32.js';

const scrypt = promisify(scryptCallback);
const MAGIC = Buffer.from('STEGZIP1', 'ascii');
const VERSION = 1;
export const HEADER_SIZE = 104;
export const HEADER_PIXELS = Math.ceil((HEADER_SIZE * 8) / 3);
const TAG_LENGTH = 16;
const SCRYPT = Object.freeze({ N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });

function assertPassword(password) {
  if (typeof password !== 'string' || password.length === 0) throw new Error('le mot de passe ne peut pas etre vide');
}

async function deriveKey(password, salt, params = SCRYPT) {
  assertPassword(password);
  if (params.N < 16384 || params.N > 1048576 || (params.N & (params.N - 1)) !== 0) {
    throw new Error('parametres scrypt non valides');
  }
  return scrypt(password, salt, 32, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem: Math.max(64 * 1024 * 1024, 128 * params.N * params.r + 1024 * 1024)
  });
}

function pngCapacity(png) {
  const pixels = png.width * png.height;
  return Math.floor(Math.max(0, pixels - HEADER_PIXELS) * 3 / 8);
}

function encodeHeader(fields) {
  const header = Buffer.alloc(HEADER_SIZE);
  MAGIC.copy(header, 0);
  header.writeUInt8(VERSION, 8);
  header.writeUInt16BE(HEADER_SIZE, 9);
  header.writeUInt8(0, 11);
  fields.setId.copy(header, 12);
  fields.salt.copy(header, 28);
  fields.iv.copy(header, 44);
  header.writeUInt16BE(fields.imageIndex, 56);
  header.writeUInt16BE(fields.imageCount, 58);
  header.writeUInt32BE(fields.chunkLength, 60);
  header.writeBigUInt64BE(BigInt(fields.totalPayloadLength), 64);
  header.writeBigUInt64BE(BigInt(fields.originalSize), 72);
  header.writeUInt32BE(fields.scrypt.N, 80);
  header.writeUInt32BE(fields.scrypt.r, 84);
  header.writeUInt32BE(fields.scrypt.p, 88);
  header.writeUInt8(TAG_LENGTH, 92);
  header.writeUInt32BE(crc32(header.subarray(0, 100)), 100);
  return header;
}

export function decodeHeader(header) {
  if (header.length !== HEADER_SIZE) throw new Error('en-tete incomplet');
  if (!timingSafeEqual(header.subarray(0, 8), MAGIC)) throw new Error('image non reconnue (signature absente)');
  if (header.readUInt8(8) !== VERSION) throw new Error(`version non prise en charge: ${header.readUInt8(8)}`);
  if (header.readUInt16BE(9) !== HEADER_SIZE) throw new Error('taille d’en-tete non valide');
  if (header.readUInt32BE(100) !== crc32(header.subarray(0, 100))) throw new Error('en-tete corrompu');

  const imageIndex = header.readUInt16BE(56);
  const imageCount = header.readUInt16BE(58);
  const chunkLength = header.readUInt32BE(60);
  const totalPayloadLength = Number(header.readBigUInt64BE(64));
  const originalSize = Number(header.readBigUInt64BE(72));
  if (!Number.isSafeInteger(totalPayloadLength) || !Number.isSafeInteger(originalSize)) throw new Error('fichier trop volumineux');
  if (imageCount < 1 || imageIndex >= imageCount) throw new Error('index d’image non valide');
  if (header.readUInt8(92) !== TAG_LENGTH) throw new Error('taille de tag non prise en charge');
  return {
    setId: Buffer.from(header.subarray(12, 28)),
    salt: Buffer.from(header.subarray(28, 44)),
    iv: Buffer.from(header.subarray(44, 56)),
    imageIndex,
    imageCount,
    chunkLength,
    totalPayloadLength,
    originalSize,
    scrypt: { N: header.readUInt32BE(80), r: header.readUInt32BE(84), p: header.readUInt32BE(88) }
  };
}

function writeBits(png, bytes, pixelIndices) {
  if (bytes.length === 0) return;
  let bit = 0;
  const totalBits = bytes.length * 8;
  for (const pixel of pixelIndices) {
    const base = pixel * 4;
    for (let channel = 0; channel < 3 && bit < totalBits; channel++, bit++) {
      const value = (bytes[bit >>> 3] >>> (7 - (bit & 7))) & 1;
      png.data[base + channel] = (png.data[base + channel] & 0xfe) | value;
    }
    if (bit === totalBits) break;
  }
  if (bit !== totalBits) throw new Error('image trop petite pour les donnees');
}

function readBits(png, byteLength, pixelIndices) {
  if (byteLength === 0) return Buffer.alloc(0);
  const output = Buffer.alloc(byteLength);
  let bit = 0;
  const totalBits = byteLength * 8;
  for (const pixel of pixelIndices) {
    const base = pixel * 4;
    for (let channel = 0; channel < 3 && bit < totalBits; channel++, bit++) {
      output[bit >>> 3] |= (png.data[base + channel] & 1) << (7 - (bit & 7));
    }
    if (bit === totalBits) break;
  }
  if (bit !== totalBits) throw new Error('image tronquee');
  return output;
}

function sequentialPixels(count) {
  return { *[Symbol.iterator]() { for (let i = 0; i < count; i++) yield i; } };
}

function makePrng(seed) {
  const state = new Uint32Array(4);
  for (let i = 0; i < 4; i++) state[i] = seed.readUInt32LE(i * 4);
  if ((state[0] | state[1] | state[2] | state[3]) === 0) state[0] = 1;
  const rotate = (x, k) => ((x << k) | (x >>> (32 - k))) >>> 0;
  return () => {
    const result = Math.imul(rotate(Math.imul(state[1], 5), 7), 9) >>> 0;
    const t = state[1] << 9;
    state[2] ^= state[0]; state[3] ^= state[1]; state[1] ^= state[2]; state[0] ^= state[3];
    state[2] ^= t; state[3] = rotate(state[3], 11);
    return result;
  };
}

export function shuffledPayloadPixels(png, key, setId, imageIndex) {
  const context = Buffer.alloc(18);
  setId.copy(context, 0);
  context.writeUInt16BE(imageIndex, 16);
  const seed = createHmac('sha256', key).update('stegzip-pixel-order-v1').update(context).digest().subarray(0, 16);
  const count = png.width * png.height - HEADER_PIXELS;
  const pixels = new Uint32Array(count);
  for (let i = 0; i < count; i++) pixels[i] = i + HEADER_PIXELS;
  const random = makePrng(seed);
  for (let i = count - 1; i > 0; i--) {
    // Multiplication-and-shift maps a uint32 uniformly enough for visual distribution.
    const j = Number((BigInt(random()) * BigInt(i + 1)) >> 32n);
    const tmp = pixels[i]; pixels[i] = pixels[j]; pixels[j] = tmp;
  }
  return pixels;
}

async function readPng(filePath) {
  try {
    return PNG.sync.read(await fs.readFile(filePath));
  } catch (error) {
    throw new Error(`PNG illisible (${filePath}): ${error.message}`);
  }
}

async function readExactly(handle, length, position) {
  const bytes = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const { bytesRead } = await handle.read(bytes, offset, length - offset, position + offset);
    if (!bytesRead) throw new Error('fichier tronque pendant la lecture');
    offset += bytesRead;
  }
  return bytes;
}

// Read only IHDR during capacity planning, without inflating the image.
async function readDimensions(filePath) {
  const handle = await fs.open(filePath, 'r');
  try {
    const bytes = await readExactly(handle, 33, 0);
    if (!bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) ||
        bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR' ||
        crc32(bytes.subarray(12, 29)) !== bytes.readUInt32BE(29)) {
      throw new Error(`en-tete PNG invalide: ${filePath}`);
    }
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    if (!width || !height || width * height > 0xffffffff) throw new Error('dimensions PNG non prises en charge');
    return { width, height };
  } finally {
    await handle.close();
  }
}

async function embedImage(filePath, outputPath, chunk, fields, key, dimensions) {
  const png = await readPng(filePath);
  if (png.width !== dimensions.width || png.height !== dimensions.height) throw new Error('image modifiee pendant le traitement');
  writeBits(png, encodeHeader(fields), sequentialPixels(HEADER_PIXELS));
  if (chunk.length) writeBits(png, chunk, shuffledPayloadPixels(png, key, fields.setId, fields.imageIndex));
  await fs.writeFile(outputPath, PNG.sync.write(png, { colorType: 6 }));
}

async function imageRecord(filePath) {
  const png = await readPng(filePath);
  return { filePath, header: extractHeader(png), capacity: pngCapacity(png), width: png.width, height: png.height };
}

async function extractChunk(record, key) {
  const png = await readPng(record.filePath);
  const current = extractHeader(png);
  if (png.width !== record.width || png.height !== record.height ||
      !encodeHeader(current).equals(encodeHeader(record.header))) throw new Error('image modifiee pendant le traitement');
  return current.chunkLength ? readBits(png, current.chunkLength,
    shuffledPayloadPixels(png, key, current.setId, current.imageIndex)) : Buffer.alloc(0);
}

function extractHeader(png) {
  if (png.width * png.height < HEADER_PIXELS) throw new Error('image trop petite pour contenir un en-tete');
  return decodeHeader(readBits(png, HEADER_SIZE, sequentialPixels(HEADER_PIXELS)));
}

function publicAad(setId, salt, iv, totalPayloadLength, originalSize, imageCount, scryptParams) {
  const aad = Buffer.alloc(16 + 16 + 12 + 8 + 8 + 2 + 12);
  let offset = 0;
  for (const part of [setId, salt, iv]) { part.copy(aad, offset); offset += part.length; }
  aad.writeBigUInt64BE(BigInt(totalPayloadLength), offset); offset += 8;
  aad.writeBigUInt64BE(BigInt(originalSize), offset); offset += 8;
  aad.writeUInt16BE(imageCount, offset); offset += 2;
  aad.writeUInt32BE(scryptParams.N, offset); offset += 4;
  aad.writeUInt32BE(scryptParams.r, offset); offset += 4;
  aad.writeUInt32BE(scryptParams.p, offset);
  return aad;
}

export async function encode({ zipPath, carrierPaths, outputDir, password, onProgress = () => {} }) {
  assertPassword(password);
  if (!Array.isArray(carrierPaths) || carrierPaths.length === 0) throw new Error('aucune image porteuse');
  if (carrierPaths.length > 65535) throw new Error('trop d’images');
  const source = await fs.open(zipPath, 'r');
  let originalSize;
  try {
    originalSize = (await source.stat()).size;
    if (originalSize < 2 || (await readExactly(source, 2, 0)).toString('ascii') !== 'PK') {
      throw new Error('le fichier d’entree ne semble pas etre un ZIP');
    }
  } finally { await source.close(); }
  const dimensions = [];
  onProgress({ stage: 'scan', current: 0, total: carrierPaths.length });
  for (let i = 0; i < carrierPaths.length; i++) {
    dimensions.push(await readDimensions(carrierPaths[i]));
    onProgress({ stage: 'scan', current: i + 1, total: carrierPaths.length });
  }
  const capacities = dimensions.map(pngCapacity);
  if (capacities.some((capacity) => capacity <= 0)) throw new Error('une image porteuse est trop petite');
  const payloadLength = originalSize + TAG_LENGTH;
  const totalCapacity = capacities.reduce((sum, value) => sum + value, 0);
  if (totalCapacity < payloadLength) {
    throw new Error(`capacite insuffisante: ${totalCapacity} octets disponibles, ${payloadLength} requis`);
  }

  const setId = randomBytes(16);
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveKey(password, salt);
  const aad = publicAad(setId, salt, iv, payloadLength, originalSize, carrierPaths.length, SCRYPT);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_LENGTH });
  cipher.setAAD(aad);
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'image-tools-'));
  const encryptedPath = path.join(tempDir, 'payload');
  const outputPaths = [];
  try {
    onProgress({ stage: 'encrypt', current: 0, total: 1 });
    await pipeline(createReadStream(zipPath), cipher, createWriteStream(encryptedPath, { flags: 'wx', mode: 0o600 }));
    await fs.appendFile(encryptedPath, cipher.getAuthTag());
    if ((await fs.stat(encryptedPath)).size !== payloadLength) throw new Error('ZIP modifie pendant le traitement');
    onProgress({ stage: 'encrypt', current: 1, total: 1 });
    await fs.mkdir(outputDir, { recursive: true });
    const handle = await fs.open(encryptedPath, 'r');
    try {
      let offset = 0;
      onProgress({ stage: 'images', current: 0, total: carrierPaths.length });
      for (let index = 0; index < carrierPaths.length; index++) {
        const chunkLength = Math.min(capacities[index], payloadLength - offset);
        const chunk = await readExactly(handle, chunkLength, offset);
        offset += chunkLength;
        const outputPath = path.resolve(outputDir, `carrier-${String(index + 1).padStart(3, '0')}.steg.png`);
        await embedImage(carrierPaths[index], outputPath, chunk, {
          setId, salt, iv, imageIndex: index, imageCount: carrierPaths.length,
          chunkLength, totalPayloadLength: payloadLength, originalSize, scrypt: SCRYPT
        }, key, dimensions[index]);
        outputPaths.push(outputPath);
        onProgress({ stage: 'images', current: index + 1, total: carrierPaths.length });
      }
    } finally { await handle.close(); }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
  return { bytes: originalSize, outputPaths };
}

function sameBuffer(a, b) {
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function decode({ imagePaths, outputPath, password, onProgress = () => {} }) {
  assertPassword(password);
  if (!Array.isArray(imagePaths) || imagePaths.length === 0) throw new Error('aucune image fournie');
  const records = [];
  onProgress({ stage: 'scan', current: 0, total: imagePaths.length });
  for (let i = 0; i < imagePaths.length; i++) {
    records.push(await imageRecord(imagePaths[i]));
    onProgress({ stage: 'scan', current: i + 1, total: imagePaths.length });
  }
  const first = records[0].header;
  if (records.length !== first.imageCount) throw new Error(`jeu incomplet: ${records.length} image(s) fournie(s), ${first.imageCount} attendue(s)`);
  for (const record of records) {
    const h = record.header;
    if (!sameBuffer(h.setId, first.setId) || !sameBuffer(h.salt, first.salt) || !sameBuffer(h.iv, first.iv) ||
        h.imageCount !== first.imageCount || h.totalPayloadLength !== first.totalPayloadLength ||
        h.originalSize !== first.originalSize || h.scrypt.N !== first.scrypt.N || h.scrypt.r !== first.scrypt.r || h.scrypt.p !== first.scrypt.p) {
      throw new Error('les images ne font pas partie du meme jeu');
    }
    if (h.chunkLength > record.capacity) throw new Error(`longueur de fragment invalide dans ${record.filePath}`);
  }
  records.sort((a, b) => a.header.imageIndex - b.header.imageIndex);
  for (let i = 0; i < records.length; i++) {
    if (records[i].header.imageIndex !== i) throw new Error('image manquante ou dupliquee');
  }

  if (records.reduce((sum, record) => sum + record.header.chunkLength, 0) !== first.totalPayloadLength ||
      first.totalPayloadLength !== first.originalSize + TAG_LENGTH || first.originalSize < 2) {
    throw new Error('donnees incompletes ou corrompues');
  }
  const key = await deriveKey(password, first.salt, first.scrypt);
  const aad = publicAad(first.setId, first.salt, first.iv, first.totalPayloadLength, first.originalSize, first.imageCount, first.scrypt);
  const target = path.resolve(outputPath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  // Same filesystem as the destination so publishing is a rename after authentication.
  const tempDir = await fs.mkdtemp(path.join(path.dirname(target), '.image-tools-'));
  const encryptedPath = path.join(tempDir, 'payload');
  const plainPath = path.join(tempDir, 'result');
  try {
    const handle = await fs.open(encryptedPath, 'wx', 0o600);
    let tag;
    try {
      onProgress({ stage: 'images', current: 0, total: records.length });
      for (let i = 0; i < records.length; i++) {
        await handle.writeFile(await extractChunk(records[i], key));
        onProgress({ stage: 'images', current: i + 1, total: records.length });
      }
    } finally { await handle.close(); }
    const reader = await fs.open(encryptedPath, 'r');
    try { tag = await readExactly(reader, TAG_LENGTH, first.originalSize); }
    finally { await reader.close(); }
    const decipher = createDecipheriv('aes-256-gcm', key, first.iv, { authTagLength: TAG_LENGTH });
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    let authenticationError;
    decipher.on('error', (error) => { authenticationError = error; });
    onProgress({ stage: 'decrypt', current: 0, total: 1 });
    try {
      await pipeline(createReadStream(encryptedPath, { end: first.originalSize - 1 }), decipher,
        createWriteStream(plainPath, { flags: 'wx', mode: 0o600 }));
    } catch (error) {
      if (error === authenticationError && /authenticat|decrypt/i.test(error.message)) {
        throw new Error('authentification impossible: mauvais mot de passe ou donnees corrompues');
      }
      throw error;
    }
    const result = await fs.open(plainPath, 'r');
    try {
      if ((await result.stat()).size !== first.originalSize ||
          (await readExactly(result, 2, 0)).toString('ascii') !== 'PK') throw new Error('contenu restaure non valide');
    } finally { await result.close(); }
    await fs.rename(plainPath, target);
    onProgress({ stage: 'decrypt', current: 1, total: 1 });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
  return { bytes: first.originalSize, outputPath: target };
}

export async function inspectImages(imagePaths) {
  const records = [];
  for (const filePath of imagePaths) {
    const png = await readPng(filePath);
    const h = extractHeader(png);
    records.push({
      file: path.resolve(filePath), setId: h.setId.toString('hex'), index: h.imageIndex + 1,
      count: h.imageCount, chunkBytes: h.chunkLength, encryptedBytes: h.totalPayloadLength,
      originalBytes: h.originalSize, dimensions: `${png.width}x${png.height}`
    });
  }
  return records.sort((a, b) => a.index - b.index);
}

export const testing = { deriveKey, extractHeader, readBits, writeBits, pngCapacity };
