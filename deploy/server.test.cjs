const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
process.env.SUPABASE_URL = 'https://database.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.D3XD_API_TOKEN = 'test-token-for-isolated-tests-only';
const nativeFetch = global.fetch;
const writes = [];
global.fetch = async (url, options = {}) => {
  assert.ok(String(url).startsWith('https://database.invalid/'), 'La prueba no debe contactar servicios reales');
  if (options.body) writes.push({ url: String(url), body: JSON.parse(options.body) });
  if (options.method === 'HEAD') return new Response(null, { headers: { 'Content-Range': '0-0/3324' } });
  return new Response(JSON.stringify([]), { headers: { 'Content-Type': 'application/json' } });
};
const { createServer } = require('./server.cjs');
test('Compatibilidad VPS con los endpoints originales', async t => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => { global.fetch = nativeFetch; server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const request = (url, options) => nativeFetch(base + url, options);
  await t.test('HTML original intacto y rutas sin extensión', async () => {
    for (const route of ['/', '/admin', '/estado', '/manual', '/informe']) {
      const name = route === '/' ? 'index' : route.slice(1);
      const result = await request(route); assert.equal(result.status, 200);
      assert.equal(await result.text(), fs.readFileSync(path.join(__dirname, '../codigo-fuente', name + '.html'), 'utf8'));
    }
    assert.equal((await request('/admin/', { redirect: 'manual' })).status, 308);
    const head = await request('/favicon.png', { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal(await head.text(), '');
  });
  await t.test('Archivos privados y auxiliares inaccesibles', async () => {
    for (const route of ['/.env', '/.git/config', '/package.json', '/basededatos/esquema_completo.sql', '/datos/datos_natan.sql', '/respaldo-cifrado/manifest.json', '/api/d3xd/_lib', '/api/bnc/_client.js', '/img/%2e%2e%5c.env', '/push%20pull%20up.json']) {
      assert.equal((await request(route)).status, 404, route);
    }
  });
  await t.test('Rutas PHP de D3xD y autenticación', async () => {
    assert.equal((await request('/api_d3xd/check_status.php')).status, 405);
    assert.equal((await request('/api_d3xd/check_status.php', { method: 'POST' })).status, 401);
    const response = await request('/api_d3xd/check_status.php', { method: 'POST', headers: { Authorization: `Bearer ${process.env.D3XD_API_TOKEN}` } });
    const result = await response.json(); assert.equal(result.status, true); assert.equal(result.detalles.tablas.productos_registrados, 3324);
  });
  await t.test('D3xD mantiene el parser crudo tolerante a coma final', async () => {
    const response = await request('/api_d3xd/productos.php', { method: 'POST', headers: { Authorization: `Bearer ${process.env.D3XD_API_TOKEN}`, 'Content-Type': 'application/json' }, body: '[{"wpcode":"TEST-001","wdesc":"Producto prueba","wprice":"20","wexiste":"1",}]' });
    assert.equal(response.status, 200); const result = await response.json(); assert.equal(result.nuevos, 1);
    assert.ok(writes.some(write => write.url.endsWith('/natan_products') && write.body[0]?.codigo === 'TEST-001'));
  });
  await t.test('BNC conserva restricciones originales', async () => {
    assert.equal((await request('/api/bnc/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
    assert.equal((await request('/api/bnc/saldo', { method: 'POST' })).status, 401);
    assert.equal((await request('/api/bnc/enviar-p2p', { method: 'POST' })).status, 503);
    assert.equal((await request('/api/bnc/cobrar-c2p', { method: 'POST' })).status, 503);
    assert.equal((await request('/api/bnc/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{broken' })).status, 400);
  });
  await t.test('Configuración de otro Supabase sin reescribir archivos', async () => {
    process.env.FRONTEND_SUPABASE_URL = 'https://replacement.invalid';
    process.env.FRONTEND_SUPABASE_ANON_KEY = 'public-test-key';
    try {
      const html = await (await request('/')).text(); assert.ok(html.includes('const SUPABASE_URL = "https://replacement.invalid"'));
      assert.ok(html.includes('const SUPABASE_KEY = "public-test-key"'));
      assert.ok(fs.readFileSync(path.join(__dirname, '../codigo-fuente/index.html'), 'utf8').includes("const SUPABASE_URL = 'https://lhqskltrsqhwcdvnfljy.supabase.co'"));
    } finally { delete process.env.FRONTEND_SUPABASE_URL; delete process.env.FRONTEND_SUPABASE_ANON_KEY; }
  });
});
