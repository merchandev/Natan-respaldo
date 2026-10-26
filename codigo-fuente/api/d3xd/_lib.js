// Helpers compartidos por los endpoints de integración D3xD.
// No es una ruta pública: Vercel ignora archivos que empiezan con "_".

const SUPABASE_URL = process.env.SUPABASE_URL;
// El servidor usa la clave de servicio (salta RLS): la clave pública va a
// quedar solo con permisos de lectura/pedidos para la tienda. Si la de
// servicio no está configurada, cae a la pública para no romper el sync.
const SUPABASE_ANON_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

function mask(s) {
  if (!s) return '(vacío)';
  if (s.length <= 12) return `${s.length} chars: "${s}"`;
  return `${s.length} chars: "${s.slice(0, 6)}...${s.slice(-6)}"`;
}

function checkAuth(req, res) {
  // Acepta "Bearer <token>" o el token crudo, por si el cliente D3xD no manda el prefijo.
  const rawAuth = req.headers['authorization'] || req.headers['x-api-key'] || '';
  const token = rawAuth.replace(/^Bearer\s+/i, '').trim();
  const expected = process.env.D3XD_API_TOKEN || '';

  if (!token || token !== expected) {
    console.log('[d3xd-auth-fail]', JSON.stringify({
      path: req.url,
      headersRecibidos: Object.keys(req.headers),
      authorizationCruda: mask(rawAuth),
      tokenExtraido: mask(token),
      tokenEsperado: mask(expected),
    }));
    res.status(401).json({ status: false, message: 'Token de autorización inválido o ausente.' });
    return false;
  }
  return true;
}

async function sb(path, options = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`Supabase ${r.status}: ${text}`);
  }
  const ct = r.headers.get('content-type') || '';
  return ct.includes('application/json') ? r.json() : null;
}

// Cuenta filas sin traerlas (HEAD + Prefer: count=exact) — evita el límite
// de 1000 filas de una consulta normal y es mucho más liviano que traer
// todo solo para contar.
async function sbCount(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'HEAD',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      Prefer: 'count=exact',
    },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text().catch(() => '')}`);
  const range = r.headers.get('content-range') || '';
  const total = range.split('/')[1];
  return total && total !== '*' ? parseInt(total, 10) : 0;
}

// Supabase limita cada consulta REST a 1000 filas (db.max_rows) sin avisar
// con error — simplemente devuelve las primeras 1000 y calla. Con más de
// 1000 productos activos eso dejaba la mitad del catálogo invisible para
// las comparaciones de duplicados. Esta función pagina con el header Range
// hasta traer todo.
async function sbAll(path) {
  const PAGE = 1000;
  let offset = 0;
  let all = [];
  while (true) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Range: `${offset}-${offset + PAGE - 1}`,
      },
    });
    if (!r.ok && r.status !== 206) {
      throw new Error(`Supabase ${r.status}: ${await r.text().catch(() => '')}`);
    }
    const page = await r.json();
    all = all.concat(page);
    if (page.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

// Actualiza muchos productos en una sola petición HTTP (vía la función SQL
// bulk_update_products) en vez de una petición PATCH por producto. La sync
// automática de D3xD llegó a actualizar >1800 productos por corrida, cada
// 5 minutos — eso solo explica varios millones de peticiones al mes.
async function bulkUpdateProducts(updates) {
  if (!updates.length) return;
  const BATCH = 500;
  for (let i = 0; i < updates.length; i += BATCH) {
    await sb('rpc/bulk_update_products', {
      method: 'POST',
      body: JSON.stringify({ updates: updates.slice(i, i + BATCH) }),
    });
  }
}

// D3xD no siempre manda el cuerpo como el manual (un arreglo JSON plano): el
// botón "Actualizar todos los productos" llegó con un formato que dejaba 0
// productos. Se aceptan las variantes razonables: arreglo, objeto suelto,
// objeto que envuelve el arreglo (productos/data/items/...), JSON como texto
// y formulario con el JSON dentro de un campo.
function _desenvolver(b) {
  if (Array.isArray(b)) return b;
  if (b && typeof b === 'object') {
    for (const k of ['productos', 'products', 'data', 'items', 'records', 'registros', 'lista', 'json', 'datos']) {
      if (b[k] !== undefined) { const r = _desenvolver(typeof b[k] === 'string' ? _intentarJSON(b[k]) : b[k]); if (r.length) return r; }
    }
    const arr = Object.values(b).find(v => Array.isArray(v) && v.length && typeof v[0] === 'object');
    if (arr) return arr;
    const unicoTexto = Object.keys(b).length === 1 ? _intentarJSON(Object.keys(b)[0]) : null; // form-urlencoded con el JSON como clave
    if (unicoTexto) { const r = _desenvolver(unicoTexto); if (r.length) return r; }
    return [b];
  }
  if (typeof b === 'string') { const j = _intentarJSON(b); return j ? _desenvolver(j) : []; }
  return [];
}
function _intentarJSON(s) {
  if (typeof s !== 'string') return null;
  const t = s.trim().replace(/^﻿/, '');
  if (!t || !/^[\[{]/.test(t)) return null;
  try { return JSON.parse(t); } catch (e) { return null; }
}
function parseBody(req) {
  return _desenvolver(req.body);
}

// Lee el cuerpo CRUDO sin pasar por el lector JSON de Vercel. Si D3xD manda
// Content-Type: application/json pero el texto no es JSON estricto, Vercel
// responde 400 por su cuenta antes de ejecutar el endpoint (así murió el botón
// "Actualizar todos los productos"). Aquí se intenta: JSON directo, luego
// reparaciones comunes (BOM, comas finales, números con coma decimal) y luego
// formulario. Devuelve { registros, crudo, contentType }.
async function leerRegistros(req) {
  const chunks = [];
  try { for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)); } catch (e) {}
  const buf = Buffer.concat(chunks);
  if (!buf.length) {
    // Red de seguridad: si la plataforma ya había consumido el stream, se usa
    // el cuerpo que ella parseó (camino anterior, que ya funcionaba).
    let b; try { b = req.body; } catch (e) { b = undefined; }
    const registros = _desenvolver(b).filter(r => r && r.wpcode);
    return { registros, crudo: typeof b === 'string' ? b : JSON.stringify(b === undefined ? null : b), contentType: req.headers['content-type'] || null };
  }
  let texto = buf.toString('utf8');
  if (texto.includes('�')) texto = buf.toString('latin1'); // Windows-1252/latin1 desde el POS
  texto = texto.replace(/^﻿/, '').trim();

  const intentos = [
    t => t,
    t => t.replace(/,\s*([\]}])/g, '$1'), // comas finales
    t => t.replace(/:\s*(-?\d+),(\d+)(\s*[,}\]])/g, ':$1.$2$3'), // "wprice": 3181,58 → 3181.58
  ];
  let registros = [];
  for (const f of intentos) {
    const j = _intentarJSON(f(texto));
    if (j) { registros = _desenvolver(j); if (registros.length) break; }
  }
  let errorJSON = null;
  if (!registros.length && /^[\[{]/.test(texto)) {
    try { JSON.parse(texto); } catch (e) {
      const m = /position (\d+)/.exec(e.message); const pos = m ? +m[1] : null;
      errorJSON = { mensaje: e.message, posicion: pos, contexto: pos !== null ? texto.slice(Math.max(0, pos - 120), pos + 60) : null };
    }
    registros = _extraerPorCampos(texto);
  }
  if (!registros.length && texto && !/^[\[{]/.test(texto)) {
    try {
      const params = new URLSearchParams(texto);
      const obj = {}; for (const [k, v] of params) obj[k] = v;
      registros = _desenvolver(obj);
    } catch (e) {}
  }
  return { registros: registros.filter(r => r && r.wpcode), crudo: texto, contentType: req.headers['content-type'] || null, errorJSON };
}

// Lector de respaldo para el JSON "casi válido" del POS: el programa de D3xD
// no escapa las comillas dentro de los textos (p. ej. TELEVISOR 32"), y una
// sola comilla suelta invalida el catálogo completo. Como sus campos siempre
// se llaman w<algo> y siempre van entre comillas, se extrae cada valor hasta
// la comilla que va seguida del siguiente campo w... o del cierre del objeto.
function _extraerPorCampos(texto) {
  const re = /"(w[a-z0-9_]+)"\s*:\s*"([\s\S]*?)"(?=\s*,\s*"w[a-z0-9_]+"\s*:|\s*}\s*(?:,\s*{|]|$))/g;
  const out = [];
  let actual = null, m;
  while ((m = re.exec(texto))) {
    const [, k, v] = m;
    if (k === 'wpcode') { if (actual && actual.wpcode) out.push(actual); actual = {}; }
    if (actual) actual[k] = v.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  if (actual && actual.wpcode) out.push(actual);
  return out;
}

async function registrarCuerpoCrudo(endpoint, lectura, extra = {}) {
  await logSync(endpoint, {
    ok: false, motivo: 'cuerpo sin productos reconocibles',
    content_type: lectura.contentType, largo: lectura.crudo.length,
    inicio: lectura.crudo.slice(0, 700), fin: lectura.crudo.slice(-200), error_json: lectura.errorJSON || null, ...extra,
  }, 'd3xd_cuerpo_raro');
}

// Cuando un endpoint no encuentra productos en el cuerpo, se guarda la
// "forma" de lo que llegó (tipo, claves, largo, primeros caracteres) para
// poder ajustar el receptor sin adivinar. Nunca se guarda el token.
async function registrarCuerpoRaro(endpoint, req) {
  const b = req.body;
  const muestra = typeof b === 'string' ? b.slice(0, 600) : JSON.stringify(b === undefined ? null : b).slice(0, 600);
  await logSync(endpoint, {
    ok: false, motivo: 'cuerpo sin productos reconocibles',
    content_type: req.headers['content-type'] || null,
    content_length: req.headers['content-length'] || null,
    tipo: Array.isArray(b) ? 'array' : typeof b,
    claves: b && typeof b === 'object' && !Array.isArray(b) ? Object.keys(b).slice(0, 20) : null,
    muestra,
  }, 'd3xd_cuerpo_raro');
}

// Deja constancia de la última vez que D3xD realmente llamó a un endpoint
// de negocio (no check_status) y qué pasó — así se puede confirmar que está
// sincronizando de verdad sin depender de revisar logs de Vercel cada vez.
async function logSync(endpoint, meta, settingsKey = 'd3xd_last_sync') {
  try {
    await sb('natan_settings', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify([{ key: settingsKey, value: JSON.stringify({ endpoint, at: new Date().toISOString(), ...meta }) }]),
    });
  } catch (e) { /* nunca debe tumbar la respuesta real por esto */ }
}

// D3xD no siempre manda wprice en la misma moneda: el actualizador
// automático manda bolívares, pero el botón manual manda lo que esté
// seleccionado en su lista de productos (USD). Dividir siempre entre la
// tasa dejó un iPhone de $2.434 en $2,57. Se detecta la moneda del lote:
//  1) si viene wref numérico (D3xD manda ahí el precio de referencia en
//     USD), la razón wprice/wref dice si wprice es Bs (~tasa) o USD (~1);
//  2) si no, se compara contra el precio USD que ya tiene el producto;
//  3) si no hay con qué comparar, por magnitud (mediana en Bs es de miles).
function mediana(arr) {
  const s = arr.filter(v => isFinite(v) && v > 0).sort((a, b) => a - b);
  return s.length ? { valor: s[Math.floor(s.length / 2)], n: s.length } : null;
}
// Devuelve { moneda, criterio, razon, n }: n = cuántos productos sirvieron
// para el cálculo. Con pocos (un lote de 1–2 productos) la mediana no es
// confiable como "tasa efectiva" — el que llama decide con n.
// El criterio wref solo manda si cubre una parte significativa del lote: un
// único wref numérico no puede decidir la moneda de 2.000 productos.
function detectarMoneda(records, precioUsdPorCodigo = {}) {
  const minRef = Math.max(3, Math.ceil(records.length * 0.3));
  const porRef = mediana(records.map(r => parseFloat(r.wprice) / parseFloat(r.wref)));
  if (porRef && porRef.n >= minRef) {
    return { moneda: porRef.valor >= 50 ? 'Bs' : 'USD', criterio: 'wref', razonRaw: porRef.valor, razon: Math.round(porRef.valor * 100) / 100, n: porRef.n };
  }

  const porStored = mediana(records.map(r => {
    const p = precioUsdPorCodigo[String(r.wpcode || '').trim()];
    return p > 0 ? parseFloat(r.wprice) / p : NaN;
  }));
  if (porStored) return { moneda: porStored.valor >= 50 ? 'Bs' : 'USD', criterio: 'precio_guardado', razonRaw: porStored.valor, razon: Math.round(porStored.valor * 100) / 100, n: porStored.n };

  const m = mediana(records.map(r => parseFloat(r.wprice)));
  return { moneda: m && m.valor >= 1500 ? 'Bs' : 'USD', criterio: 'magnitud', razonRaw: m ? m.valor : null, razon: m ? m.valor : null, n: m ? m.n : 0 };
}

// Tasa a usar para convertir un lote en Bs: la efectiva que revela el lote
// (mediana Bs/USD guardado, sin redondear) solo si hay suficientes productos
// comparables y no se aleja más de 15% de la nominal; si no, la nominal.
function tasaParaLote(moneda, tasaNominal) {
  const r = moneda.razonRaw || moneda.razon;
  const ok = moneda.moneda === 'Bs' && moneda.criterio === 'precio_guardado' && moneda.n >= 20
    && r >= tasaNominal * 0.85 && r <= tasaNominal * 1.15;
  return ok ? r : tasaNominal;
}

// Tasa nominal Bs/USD guardada (la que mandó D3xD, si no la del panel).
// Devuelve null si no hay ninguna válida: en ese caso un lote en Bs NO debe
// convertirse (dividir entre 1 guardaba bolívares como si fueran dólares).
async function tasaNominal() {
  const rows = await sb("natan_settings?select=key,value&key=in.(d3xd_exchange_rate,bcv_rate)");
  const map = {}; (rows || []).forEach(r => { map[r.key] = parseFloat(r.value); });
  const t = map.d3xd_exchange_rate || map.bcv_rate;
  return isFinite(t) && t >= 10 ? t : null;
}

module.exports = { checkAuth, sb, sbAll, sbCount, parseBody, logSync, bulkUpdateProducts, detectarMoneda, tasaParaLote, tasaNominal, registrarCuerpoRaro, leerRegistros, registrarCuerpoCrudo };
