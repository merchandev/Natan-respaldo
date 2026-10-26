const crypto = require('crypto');
const { buildEnvelope, decryptValue } = require('./_crypto');

const SUPABASE_URL = process.env.SUPABASE_URL;
// Clave de servicio en el servidor (salta RLS); la pública queda solo para la tienda.
const SUPABASE_ANON_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const BNC_BASE_URL = process.env.BNC_BASE_URL || 'https://servicios.bncenlinea.com:16500/api';
const CLIENT_GUID = process.env.BNC_CLIENT_GUID;
const MASTER_KEY = process.env.BNC_MASTER_KEY;

// La WorkingKey diaria se guarda en natan_settings, y esa tabla la lee la
// tienda pública con la misma clave anon — guardarla en texto plano la
// dejaba legible por cualquiera. Se cifra en reposo con AES-256-GCM usando
// una clave derivada del MasterKey (que solo existe en el servidor).
const WK_KEK = MASTER_KEY ? crypto.createHash('sha256').update('natan-bnc-wk-kek:' + MASTER_KEY).digest() : null;

function sellarWorkingKey(wk) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', WK_KEK, iv);
  const ct = Buffer.concat([c.update(String(wk), 'utf8'), c.final()]);
  return 'enc1:' + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}

function abrirWorkingKey(sellada) {
  if (!sellada || !String(sellada).startsWith('enc1:')) return null; // valor legado en claro o vacío: no se acepta
  try {
    const buf = Buffer.from(String(sellada).slice(5), 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', WK_KEK, buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
  } catch (e) { return null; }
}

// Autoriza de dos formas:
//  1) el token interno del servidor (solo lo usa /api/status, nunca el navegador);
//  2) la sesión de Supabase Auth de un usuario que esté en natan_admins.
// Devuelve el admin ({ email, rol }) o null. Con `rolesPermitidos` se puede
// exigir rol 'admin' (p. ej. para mover dinero).
async function checkInternalAuth(req, res, rolesPermitidos = ['admin', 'operador']) {
  const auth = req.headers['authorization'] || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) { res.status(401).json({ status: false, message: 'No autorizado.' }); return null; }

  if (process.env.BNC_INTERNAL_TOKEN && token === process.env.BNC_INTERNAL_TOKEN) {
    return { email: 'servidor', rol: 'servidor' };
  }

  try {
    // Valida el JWT contra Supabase Auth (no se confía en decodificarlo localmente).
    const u = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
    });
    if (!u.ok) throw new Error('sesión inválida');
    const user = await u.json();
    const email = String(user.email || '').toLowerCase();
    if (!email) throw new Error('sin email');
    const rows = await sb(`natan_admins?select=email,rol&email=ilike.${encodeURIComponent(email)}`);
    const admin = rows && rows[0];
    if (!admin || !rolesPermitidos.includes(admin.rol)) {
      res.status(403).json({ status: false, message: 'Tu usuario no tiene permiso para esta operación.' });
      return null;
    }
    return admin;
  } catch (e) {
    res.status(401).json({ status: false, message: 'No autorizado.' });
    return null;
  }
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
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text().catch(() => '')}`);
  const ct = r.headers.get('content-type') || '';
  return ct.includes('application/json') ? r.json() : null;
}

// Venezuela no observa horario de verano: UTC-4 fijo.
function veFechaHoy() {
  return new Date(Date.now() - 4 * 3600 * 1000).toISOString().slice(0, 10);
}

async function logon() {
  const envelope = buildEnvelope(CLIENT_GUID, { ClientGUID: CLIENT_GUID }, MASTER_KEY);
  const r = await fetch(`${BNC_BASE_URL}/Auth/LogOn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  });
  const json = await r.json();
  if (json.status !== 'OK' || !json.value) {
    throw new Error('LogOn BNC falló: ' + (json.message || JSON.stringify(json)));
  }
  const { WorkingKey } = decryptValue(json.value, MASTER_KEY);

  const rows = await sb('natan_settings', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify([
      { key: 'bnc_working_key', value: sellarWorkingKey(WorkingKey) },
      { key: 'bnc_working_key_date', value: veFechaHoy() },
    ]),
  });
  return WorkingKey;
}

async function getWorkingKey(forceRefresh = false) {
  if (!forceRefresh) {
    const rows = await sb('natan_settings?select=key,value&key=in.(bnc_working_key,bnc_working_key_date)');
    const map = {};
    (rows || []).forEach(r => { map[r.key] = r.value; });
    const wk = abrirWorkingKey(map.bnc_working_key);
    if (wk && map.bnc_working_key_date === veFechaHoy()) {
      return wk;
    }
  }
  return logon();
}

// Llama un endpoint de negocio de BNC (todo excepto LogOn), maneja el ciclo
// de vida de la WorkingKey y reintenta una vez si el banco pide refrescarla (RWK).
async function callBNC(endpoint, bodyObj, { retry = true } = {}) {
  const workingKey = await getWorkingKey();
  const envelope = buildEnvelope(CLIENT_GUID, bodyObj, workingKey);
  const r = await fetch(`${BNC_BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  });
  const json = await r.json().catch(() => null);

  if (!json) {
    return { ok: false, httpStatus: r.status, status: 'KO', message: 'Respuesta no JSON del banco', data: null };
  }

  if (json.message && /RWK/i.test(json.message) && retry) {
    await getWorkingKey(true);
    return callBNC(endpoint, bodyObj, { retry: false });
  }

  let data = null;
  if (json.value) {
    try { data = decryptValue(json.value, workingKey); } catch (e) { /* value puede no ser JSON en errores */ }
  }

  return { ok: r.ok && json.status === 'OK', httpStatus: r.status, status: json.status, message: json.message, data };
}

module.exports = { callBNC, getWorkingKey, checkInternalAuth };
