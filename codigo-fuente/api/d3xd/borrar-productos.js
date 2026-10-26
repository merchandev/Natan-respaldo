const { checkAuth, sb, parseBody } = require('./_lib');

// Nota de seguridad: nunca se borra físicamente el producto (para no perder fotos
// ni el historial). "Eliminar" se implementa como desactivar (active=false), igual
// que en la sincronización por CSV del panel admin.

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ status: false, message: 'Método no permitido' });
  if (!checkAuth(req, res)) return;

  const body = parseBody(req)[0] || {};
  const wpcode = body.wpcode ? String(body.wpcode).trim() : '';

  try {
    if (wpcode) {
      await sb(`natan_products?codigo=eq.${encodeURIComponent(wpcode)}&active=eq.true`, {
        method: 'PATCH',
        body: JSON.stringify({ active: false }),
      });
      return res.status(200).json({ status: true, message: `Producto ${wpcode} desactivado.` });
    }

    // Sin wpcode: desactiva todos los productos que vienen de D3xD (tienen código).
    // No toca productos agregados manualmente sin código.
    await sb(`natan_products?codigo=not.is.null&active=eq.true`, {
      method: 'PATCH',
      body: JSON.stringify({ active: false }),
    });
    res.status(200).json({ status: true, message: 'Catálogo de productos con código D3xD desactivado.' });
  } catch (e) {
    res.status(500).json({ status: false, message: 'Error al eliminar productos', error: e.message });
  }
};
