import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'INVENTARIO.json'), 'utf8'));
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
let scripts = 0;
for (const file of manifest.sourceFiles) {
  const content = fs.readFileSync(path.join(root, file.path));
  if (content.length !== file.bytes || sha(content) !== file.sha256) throw new Error('El original cambió: ' + file.path);
  if (file.path.endsWith('.js')) { new vm.Script(content.toString('utf8'), { filename: file.path }); scripts++; }
  if (file.path.endsWith('.html')) {
    for (const match of content.toString('utf8').matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      if (/\bsrc\s*=|application\/ld\+json|application\/json/i.test(match[1]) || !match[2].trim()) continue;
      new vm.Script(match[2], { filename: file.path }); scripts++;
    }
  }
}
const encrypted = JSON.parse(fs.readFileSync(path.join(root, 'respaldo-cifrado/manifest.json'), 'utf8'));
for (const part of encrypted.parts) {
  const content = fs.readFileSync(path.join(root, 'respaldo-cifrado', part.file));
  if (content.length !== part.bytes || sha(content) !== part.sha256) throw new Error('Parte cifrada dañada: ' + part.file);
}
console.log(`Verificados: ${manifest.sourceFiles.length} archivos originales, ${scripts} scripts y ${encrypted.parts.length} partes cifradas.`);
