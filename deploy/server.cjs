'use strict';
// Adaptador VPS. Los archivos de codigo-fuente se conservan byte por byte.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const ROOT = path.resolve(process.env.SITE_DIR || path.join(__dirname, '..', 'codigo-fuente'));
const rewrites = JSON.parse(fs.readFileSync(path.join(ROOT, 'push pull up.json'), 'utf8')).rewrites;
const routes = new Map();
for (const family of ['d3xd', 'bnc']) {
  for (const name of fs.readdirSync(path.join(ROOT, 'api', family))) {
    if (!name.startsWith('_') && name.endsWith('.js')) {
      routes.set(`/api/${family}/${name.slice(0, -3)}`, path.join(ROOT, 'api', family, name));
    }
  }
}
routes.set('/api/status', path.join(ROOT, 'api/status.js'));
const rawRoutes = new Set(['/api/d3xd/guardar-productos', '/api/d3xd/actualizar-precios-stock']);
const mime = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8' };
const publicFiles = new Set(fs.readdirSync(ROOT).filter(f => /\.(html|png|jpg|jpeg|webp|svg|ico)$/.test(f)));
publicFiles.add('robots.txt');
publicFiles.add('sitemap.xml');

async function readBody(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16 * 1024 * 1024) { const err = new Error('Cuerpo demasiado grande'); err.status = 413; throw err; }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function decorate(res) {
  res.status = code => { res.statusCode = code; return res; };
  res.json = body => { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(body)); return res; };
  res.send = body => { res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.end(String(body)); return res; };
}
function frontendConfig(html) {
  const url = process.env.FRONTEND_SUPABASE_URL;
  const key = process.env.FRONTEND_SUPABASE_ANON_KEY;
  if (!url && !key) return html;
  if (!url || !key) throw new Error('Faltan las dos variables FRONTEND_SUPABASE_*');
  // Solo sustituye configuración en la respuesta; no escribe el HTML original.
  const literal = value => JSON.stringify(value).replace(/</g, '\\u003c');
  return html.replace(/const SUPABASE_URL = '[^']*'/, () => `const SUPABASE_URL = ${literal(url)}`)
    .replace(/const SUPABASE_KEY = '[^']*'/, () => `const SUPABASE_KEY = ${literal(key)}`);
}
function createServer() {
  return http.createServer(async (req, res) => {
    decorate(res);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      const url = new URL(req.url, 'http://localhost');
      let pathname;
      try { pathname = decodeURIComponent(url.pathname); } catch { return res.status(400).send('Ruta inválida'); }
      if (pathname.includes('\\') || pathname.includes('\0') || pathname.split('/').some(p => p.startsWith('.'))) return res.status(404).send('No encontrado');
      if (pathname === '/healthz') return res.json({ ok: true, service: 'natan-vps' });
      if (pathname.endsWith('/') && pathname !== '/') {
        res.statusCode = 308; res.setHeader('Location', url.pathname.slice(0, -1) + url.search); return res.end();
      }
      const alias = rewrites.find(r => r.source === pathname);
      const route = alias ? alias.destination : pathname.startsWith('/api_d3xd/') ? '/api/d3xd/ruta-desconocida' : pathname.replace(/\.js$/, '');
      if (routes.has(route)) {
        const buffer = await readBody(req);
        // Conserva el flujo crudo de D3xD para su parser tolerante a JSON irregular.
        let apiReq = req;
        if (rawRoutes.has(route)) {
          apiReq = Readable.from(buffer.length ? [buffer] : []);
          Object.assign(apiReq, { method: req.method, url: req.url, headers: req.headers });
        } else {
          const contentType = (req.headers['content-type'] || '').split(';')[0];
          if (buffer.length && contentType === 'application/json') {
            try { apiReq.body = JSON.parse(buffer.toString('utf8')); } catch { return res.status(400).json({ error: 'JSON inválido' }); }
          } else if (contentType === 'application/x-www-form-urlencoded') apiReq.body = Object.fromEntries(new URLSearchParams(buffer.toString('utf8')));
          else apiReq.body = buffer.length ? buffer.toString('utf8') : {};
        }
        apiReq.query = Object.fromEntries(url.searchParams);
        await require(routes.get(route))(apiReq, res);
        if (!res.writableEnded) res.end();
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).send('Método no permitido');
      let relative = pathname === '/' ? 'index.html' : pathname.slice(1);
      if (!path.extname(relative)) relative += '.html';
      const image = /^img\/[^/]+\.(png|jpg|jpeg|webp|svg|ico)$/.test(relative);
      if (!publicFiles.has(relative) && !image) return res.status(404).send('No encontrado');
      const filename = path.join(ROOT, relative);
      if (!fs.existsSync(filename) || !fs.statSync(filename).isFile()) return res.status(404).send('No encontrado');
      res.setHeader('Content-Type', mime[path.extname(filename)] || 'application/octet-stream');
      if (filename.endsWith('.html')) {
        const content = Buffer.from(frontendConfig(fs.readFileSync(filename, 'utf8')));
        res.setHeader('Cache-Control', 'no-cache'); res.setHeader('Content-Length', content.length);
        return res.end(req.method === 'HEAD' ? undefined : content);
      }
      res.setHeader('Content-Length', fs.statSync(filename).size);
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(filename).on('error', () => res.destroy()).pipe(res);
    } catch (error) {
      console.error('[vps]', error.status || 500, error.name);
      if (!res.headersSent) res.status(error.status || 500).json({ error: error.status === 413 ? 'Cuerpo demasiado grande' : 'Error del servidor' });
      else res.destroy();
    }
  });
}
if (require.main === module) {
  const server = createServer();
  server.requestTimeout = 120000; server.headersTimeout = 15000;
  server.listen(Number(process.env.PORT || 3000), '0.0.0.0', () => console.log('Natan VPS listo'));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
}
module.exports = { createServer, frontendConfig };
