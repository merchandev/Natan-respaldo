// Receptor de notificaciones PUSH de BNC — AMBIENTE DE DESARROLLO.
// BNC exige que la URL de desarrollo sea distinta a la de producción. Esta
// ruta usa la misma autenticación, pero NO toca pedidos reales ni la bandeja
// de notificaciones que revisa el equipo — solo confirma recepción y deja
// registro para poder verificar que la certificación de BNC está probando
// bien, sin mezclar datos de prueba con datos reales de ventas.
const SUPABASE_URL = process.env.SUPABASE_URL;
// Clave de servicio en el servidor (salta RLS); la pública queda solo para la tienda.
const SUPABASE_ANON_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

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
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ status: false, message: 'Método no permitido' });

  const apiKey = req.headers['x-api-key'] || '';
  if (!apiKey || apiKey !== process.env.BNC_WEBHOOK_API_KEY) {
    return res.status(401).send('Credenciales inválidas o encabezado de autorización ausente/mal formado.');
  }

  try {
    await sb('natan_settings', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify([{
        key: 'bnc_webhook_dev_last_ping',
        value: JSON.stringify({ at: new Date().toISOString(), payload: req.body || {} }),
      }]),
    });
  } catch (e) {
    console.error('[bnc-webhook-dev] error al registrar ping:', e.message);
    // Igual respondemos 200: ya recibimos el evento.
  }

  res.status(200).json({ received: true, ambiente: 'desarrollo' });
};
