const { checkAuth, sb, parseBody } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ status: false, message: 'Método no permitido' });
  if (!checkAuth(req, res)) return;

  const body = parseBody(req)[0] || {};
  const widpedido = body.widpedido ? String(body.widpedido).trim() : '';

  try {
    let query = 'natan_orders?select=id,cliente,tel,cedula,items,status,sede';
    query += widpedido
      ? `&id=eq.${encodeURIComponent(widpedido)}`
      : `&synced_to_pos=eq.false&status=neq.Cancelado`;

    const orders = await sb(query);

    // Buscar el código de cada producto vendido (guardado como id interno en el pedido)
    const productIds = new Set();
    (orders || []).forEach(o => (o.items || []).forEach(it => { if (it.id) productIds.add(it.id); }));

    let codeById = {};
    if (productIds.size > 0) {
      const rows = await sb(`natan_products?select=id,codigo&id=in.(${[...productIds].join(',')})`);
      (rows || []).forEach(p => { codeById[p.id] = p.codigo || ''; });
    }

    const data = (orders || []).map(o => {
      const items = (o.items || []).map(it => {
        const qty = Number(it.qty) || 1;
        const unitPrice = qty ? (Number(it.price) || 0) / qty : Number(it.price) || 0;
        return {
          wpcode: (it.id && codeById[it.id]) || '',
          wpqty: qty,
          wprice: Math.round(unitPrice * 100) / 100,
        };
      });
      const total_pedido = items.reduce((s, it) => s + it.wpqty * it.wprice, 0);
      return {
        widpedido: o.id,
        wcicust: o.cedula || '',
        wnamecust: o.cliente || '',
        wdircust: '', // no se recolecta dirección en el checkout web actualmente
        wphonecust: o.tel || '',
        wseal: '',
        wemailcust: '',
        items,
        total_pedido: Math.round(total_pedido * 100) / 100,
      };
    });

    res.status(200).json({ status: true, count: data.length, data });
  } catch (e) {
    res.status(500).json({ status: false, message: 'Error al consultar pedidos', error: e.message });
  }
};
