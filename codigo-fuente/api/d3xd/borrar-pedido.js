const { checkAuth, sb, parseBody } = require('./_lib');

// Nota: no se borra el pedido de verdad (se perdería del historial del cliente y
// del panel admin). "Eliminar" se implementa como marcar synced_to_pos=true, que
// lo saca de futuras respuestas de consultar_pedidos.php — mismo efecto para D3xD
// (no se vuelve a descargar), sin perder el registro de la venta en Natan.

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ status: false, message: 'Método no permitido' });
  if (!checkAuth(req, res)) return;

  const body = parseBody(req)[0] || {};
  const widpedido = body.widpedido ? String(body.widpedido).trim() : '';

  try {
    if (widpedido) {
      await sb(`natan_orders?id=eq.${encodeURIComponent(widpedido)}`, {
        method: 'PATCH',
        body: JSON.stringify({ synced_to_pos: true }),
      });
      return res.status(200).json({ status: true, message: `Pedido ${widpedido} marcado como descargado.` });
    }

    await sb(`natan_orders?synced_to_pos=eq.false&status=neq.Cancelado`, {
      method: 'PATCH',
      body: JSON.stringify({ synced_to_pos: true }),
    });
    res.status(200).json({ status: true, message: 'Todos los pedidos pendientes marcados como descargados.' });
  } catch (e) {
    res.status(500).json({ status: false, message: 'Error al marcar pedidos', error: e.message });
  }
};
