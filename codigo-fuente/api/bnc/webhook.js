// Receptor de notificaciones PUSH de BNC (pago recibido en la cuenta de Natan).
// Nota: Vercel no garantiza que el código siga corriendo después de responder
// en una función serverless de Node — el guardado en Supabase se hace ANTES
// de responder (es rápido, un par de llamadas REST) para no perder ninguna
// notificación, en vez de confiar en trabajo "en segundo plano" tras el 200.
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
  const ct = r.headers.get('content-type') || '';
  return ct.includes('application/json') ? r.json() : null;
}

async function intentarEmparejar(n) {
  // Coincide por los últimos 4 dígitos de la referencia que el cliente
  // escribió al pagar, sobre pedidos aún pendientes.
  const ref4 = String(n.OriginBankReference || n.DestinyBankReference || '').slice(-4);
  if (!ref4) return null;

  const orders = await sb(`natan_orders?select=id,ref,items,status&status=eq.Pendiente&ref=ilike.*${ref4}`);
  if (!orders || orders.length !== 1) return null; // ambiguo o sin match: se deja para revisión manual

  return orders[0].id;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ status: false, message: 'Método no permitido' });

  const apiKey = req.headers['x-api-key'] || '';
  if (!apiKey || apiKey !== process.env.BNC_WEBHOOK_API_KEY) {
    return res.status(401).send('Credenciales inválidas o encabezado de autorización ausente/mal formado.');
  }

  const n = req.body || {};

  try {
    const matchedOrderId = await intentarEmparejar(n);

    await sb('natan_bnc_notifications', {
      method: 'POST',
      body: JSON.stringify([{
        payment_type: n.PaymentType || null,
        origin_bank_reference: n.OriginBankReference || null,
        destiny_bank_reference: n.DestinyBankReference || null,
        origin_bank_code: n.OriginBankCode || null,
        amount: n.Amount ? Number(n.Amount) : null,
        currency_code: n.CurrencyCode || null,
        tx_date: n.Date || null,
        tx_hour: n.Hour || null,
        commerce_id: n.CommerceID || null,
        client_phone: n.ClientPhone || null,
        concept: n.Concept || null,
        debtor_account: n.DebtorAccount || null,
        debtor_id: n.DebtorID || null,
        raw_payload: n,
        matched_order_id: matchedOrderId,
        match_status: matchedOrderId ? 'sugerido' : 'sin_match',
      }]),
    });
  } catch (e) {
    console.error('[bnc-webhook] error al guardar notificación:', e.message);
    // Igual respondemos 200: ya recibimos el evento, no queremos que BNC lo
    // reintente infinitamente por un error nuestro de guardado.
  }

  res.status(200).json({ received: true });
};
