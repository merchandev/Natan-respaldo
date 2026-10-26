import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import readline from 'node:readline';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const sha = data => crypto.createHash('sha256').update(data).digest('hex');
function walk(root, prefix = '') {
  return fs.readdirSync(path.join(root, prefix), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    const name = path.posix.join(prefix, entry.name);
    if (entry.isSymbolicLink()) throw new Error('No se admiten enlaces simbólicos');
    return entry.isDirectory() ? walk(root, name) : [name];
  });
}
function safePath(root, name) {
  if (name.includes('\\') || name.includes('\0') || name.includes(':') || name.startsWith('/') || name.split('/').some(p => p === '..' || p === '.' || !p)) throw new Error('Ruta de respaldo inválida');
  const resolved = path.resolve(root, ...name.split('/'));
  if (!resolved.startsWith(path.resolve(root) + path.sep)) throw new Error('Ruta fuera del destino');
  return resolved;
}
function loadKey(filename) {
  const key = Buffer.from(fs.readFileSync(filename, 'utf8').trim(), 'base64');
  if (key.length !== 32) throw new Error('La clave debe contener 32 bytes en base64');
  return key;
}
export async function pack(source, output, keyFile) {
  if (fs.existsSync(output) || fs.existsSync(keyFile)) throw new Error('El destino o la clave ya existen');
  const names = ['datos', 'Entrega final Natan Electronics - copia'].flatMap(dir => walk(source, dir));
  const key = crypto.randomBytes(32), iv = crypto.randomBytes(12);
  fs.writeFileSync(keyFile, key.toString('base64') + '\n', { flag: 'wx', mode: 0o600 });
  fs.mkdirSync(output, { recursive: true });
  const parts = []; const maxSize = 45 * 1024 * 1024;
  let fd, size = 0, hash, file;
  function openPart() {
    file = `natan-${String(parts.length + 1).padStart(3, '0')}.enc`;
    fd = fs.openSync(path.join(output, file), 'wx'); size = 0; hash = crypto.createHash('sha256');
  }
  function closePart() {
    if (fd !== undefined) { fs.closeSync(fd); fd = undefined; parts.push({ file, bytes: size, sha256: hash.digest('hex') }); }
  }
  let bytes = 0;
  async function* records() {
    for (const name of names) {
      const data = fs.readFileSync(path.join(source, name)); bytes += data.length;
      yield JSON.stringify({ path: name, bytes: data.length, sha256: sha(data), data: data.toString('base64') }) + '\n';
    }
  }
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const sink = new Writable({
    write(chunk, encoding, cb) {
      try {
        let offset = 0;
        while (offset < chunk.length) {
          if (fd === undefined) openPart();
          const piece = chunk.subarray(offset, offset + Math.min(maxSize - size, chunk.length - offset));
          fs.writeSync(fd, piece); hash.update(piece); size += piece.length; offset += piece.length;
          if (size === maxSize) closePart();
        }
        cb();
      } catch (error) { cb(error); }
    },
    final(cb) { try { closePart(); cb(); } catch (error) { cb(error); } }
  });
  await pipeline(Readable.from(records()), zlib.createGzip({ level: 6 }), cipher, sink);
  const manifest = { format: 'natan-jsonl-gzip-aes256gcm-v1', files: names.length, originalBytes: bytes, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), parts };
  fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify({ files: names.length, originalBytes: bytes, encryptedParts: parts.length }));
}
export async function unpack(input, keyFile, output) {
  if (fs.existsSync(output)) throw new Error('El destino debe ser nuevo para no sobrescribir datos');
  const manifest = JSON.parse(fs.readFileSync(path.join(input, 'manifest.json'), 'utf8'));
  if (manifest.format !== 'natan-jsonl-gzip-aes256gcm-v1') throw new Error('Formato desconocido');
  const temporary = path.resolve(output + '.decrypted.gz');
  const decipher = crypto.createDecipheriv('aes-256-gcm', loadKey(keyFile), Buffer.from(manifest.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(manifest.tag, 'base64'));
  async function* chunks() {
    for (const part of manifest.parts) {
      const file = safePath(input, part.file); const hash = crypto.createHash('sha256'); let size = 0;
      for await (const chunk of fs.createReadStream(file)) { hash.update(chunk); size += chunk.length; yield chunk; }
      if (size !== part.bytes || hash.digest('hex') !== part.sha256) throw new Error('Parte de respaldo dañada: ' + part.file);
    }
  }
  // Autentica todo el cifrado ANTES de extraer el primer archivo.
  let createdTemp = false;
  try {
    const fd = fs.openSync(temporary, 'wx', 0o600); createdTemp = true;
    await pipeline(Readable.from(chunks()), decipher, fs.createWriteStream(temporary, { fd }));
    fs.mkdirSync(output, { recursive: true, mode: 0o700 });
    const stream = fs.createReadStream(temporary).pipe(zlib.createGunzip());
    const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
    let count = 0, bytes = 0;
    for await (const line of lines) {
      const record = JSON.parse(line), data = Buffer.from(record.data, 'base64');
      if (data.length !== record.bytes || sha(data) !== record.sha256) throw new Error('Archivo de respaldo dañado');
      const dest = safePath(output, record.path);
      fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 });
      fs.writeFileSync(dest, data, { flag: 'wx', mode: 0o600 }); count++; bytes += data.length;
    }
    if (count !== manifest.files || bytes !== manifest.originalBytes) throw new Error('Respaldo incompleto');
    console.log(JSON.stringify({ restoredFiles: count, restoredBytes: bytes }));
  } finally { if (createdTemp) fs.unlinkSync(temporary); }
}
const [command, ...args] = process.argv.slice(2);
if (command) {
  try {
    if (args.length !== 3) throw new Error('Uso: node deploy/backup.mjs pack ORIGEN SALIDA ARCHIVO_CLAVE | unpack RESPALDO ARCHIVO_CLAVE DESTINO');
    if (command === 'pack') await pack(...args);
    else if (command === 'unpack') await unpack(...args);
    else throw new Error('Comando desconocido');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
