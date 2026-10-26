// Endpoint público de diagnóstico — sin datos sensibles, solo para demostrar
// que los servidores de integración (D3xD y BNC) responden correctamente.
// No requiere autenticación porque no expone tokens ni datos de clientes.

// Clave de servicio en el servidor (salta RLS); la pública queda solo para la tienda.
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

async function checkD3xD() {
  const start = Date.now();
  try {
    const r = await fetch('https://natanelectronics.com/api_d3xd/check_status.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.D3XD_API_TOKEN },
      body: JSON.stringify({}),
    });
    const json = await r.json();
    return { ok: r.ok && json.status === true, httpStatus: r.status, ms: Date.now() - start, response: json };
  } catch (e) {
    return { ok: false, httpStatus: null, ms: Date.now() - start, response: { error: e.message } };
  }
}

async function checkBNC() {
  const start = Date.now();
  try {
    const r = await fetch('https://natanelectronics.com/api/bnc/tasa-bcv', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.BNC_INTERNAL_TOKEN },
      body: JSON.stringify({}),
    });
    const json = await r.json();
    return { ok: r.ok && json.ok === true, httpStatus: r.status, ms: Date.now() - start, response: json };
  } catch (e) {
    return { ok: false, httpStatus: null, ms: Date.now() - start, response: { error: e.message } };
  }
}

async function getSetting(key) {
  try {
    const r = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/natan_settings?select=value&key=eq.${key}`,
      { headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY } }
    );
    const rows = await r.json();
    return rows && rows[0] ? JSON.parse(rows[0].value) : null;
  } catch (e) {
    return null;
  }
}

module.exports = async (req, res) => {
  const [d3xd, bnc, d3xdLastSync, d3xdLastCheckStatus, bcvRateRaw, d3xdRateRaw, d3xdLastConfig] = await Promise.all([
    checkD3xD(), checkBNC(), getSetting('d3xd_last_sync'), getSetting('d3xd_last_check_status'),
    getSetting('bcv_rate'), getSetting('d3xd_exchange_rate'), getSetting('d3xd_last_config'),
  ]);
  // Huella del token interno vigente en este despliegue (solo 8 hex del
  // SHA-256; no revela el token) — sirve para confirmar que una rotación
  // de la variable de entorno realmente aplicó en producción.
  const tokenHuella = require('crypto').createHash('sha256').update(process.env.BNC_INTERNAL_TOKEN || '').digest('hex').slice(0, 8);
  const _h = v => require('crypto').createHash('sha256').update(v || '').digest('hex').slice(0, 8);
  const webhookKeyHuella = _h(process.env.BNC_WEBHOOK_API_KEY);
  res.status(200).json({
    checkedAt: new Date().toISOString(),
    tokenHuella,
    webhookKeyHuella,
    d3xd,
    bnc,
    d3xdLastSync,
    d3xdLastCheckStatus,
    tasas: {
      web: parseFloat(bcvRateRaw) || null,
      d3xd: parseFloat(d3xdRateRaw) || null,
      d3xdEnviadaEl: d3xdLastConfig && d3xdLastConfig.at ? d3xdLastConfig.at : null,
    },
  });
};
