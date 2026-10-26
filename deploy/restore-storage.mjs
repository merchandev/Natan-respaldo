// Uso: node --env-file=.env deploy/restore-storage.mjs RUTA_A_FOTOS/natan-products
// Ejecutar únicamente contra el Supabase NUEVO, después de restaurar el SQL.
import fs from 'node:fs';
import path from 'node:path';
const root = process.argv[2];
const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!root || !url || !key) throw new Error('Se requieren carpeta de fotos, SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY');
const types = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.gif': 'image/gif' };
const headers = { apikey: key, Authorization: `Bearer ${key}` };
let bucket = await fetch(`${url}/storage/v1/bucket/natan-products`, { headers });
if (!bucket.ok) {
  if (bucket.status !== 404 && bucket.status !== 400) throw new Error(`No se pudo consultar Storage: HTTP ${bucket.status}`);
  bucket = await fetch(`${url}/storage/v1/bucket`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'natan-products', name: 'natan-products', public: true }) });
  if (!bucket.ok) throw new Error(`No se pudo crear el bucket: HTTP ${bucket.status}`);
}
let count = 0;
for (const entry of fs.readdirSync(root, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile()) continue;
  const filename = path.join(entry.parentPath, entry.name);
  const relative = path.relative(root, filename).split(path.sep).map(encodeURIComponent).join('/');
  const response = await fetch(`${url}/storage/v1/object/natan-products/${relative}`, {
    method: 'POST', headers: { ...headers, 'Content-Type': types[path.extname(entry.name).toLowerCase()] || 'application/octet-stream', 'x-upsert': 'true' }, body: fs.readFileSync(filename)
  });
  if (!response.ok) throw new Error(`Error al subir foto ${count + 1}: HTTP ${response.status}`);
  count++; if (count % 100 === 0) console.log(`${count} fotos restauradas`);
}
console.log(`Restauración completada: ${count} archivos`);
