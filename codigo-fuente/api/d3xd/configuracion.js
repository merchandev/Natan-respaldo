const { checkAuth, sb, parseBody } = require('./_lib');

// "Actualización de Parámetros" de D3xD (manual §7.1, configuracion.php):
// el sistema manda su configuración de monedas y tasas de cambio. Se toma la
// tasa Bs/USD que usa D3xD y se convierte en la tasa única de la web —
// así el precio en USD y en Bs queda idéntico al del sistema, y la tasa se
// actualiza en un solo lugar (D3xD) en vez de tener que cambiarla también en
// el panel cada vez.
//
// D3xD manda: { wmone_main, wmone_a, wmone_b, wexchang_a, wexchang_b }.
// No documenta cuál de los dos factores es Bs/USD, así que se elige el que
// tenga pinta de tasa Bs/USD (un factor < 1 sería USD/Bs y se invierte).

function comoTasaBsPorUsd(v) {
  const n = parseFloat(v);
  if (!isFinite(n) || n <= 0) return null;
  const t = n < 1 ? 1 / n : n;
  return t >= 10 && t <= 1e7 ? Math.round(t * 100) / 100 : null;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ status: false, message: 'Método no permitido' });
  if (!checkAuth(req, res)) return;

  const body = parseBody(req)[0] || {};
  // D3xD manda wexchang_a = tasa BCV (moneda A = Bs) y wexchang_b = otra
  // tasa (moneda B, p. ej. 945.65). La de la web es SIEMPRE la A; la B solo
  // se usa si la A no viene o no es válida.
  const tasa = comoTasaBsPorUsd(body.wexchang_a) || comoTasaBsPorUsd(body.wexchang_b) || null;

  try {
    const rows = [{ key: 'd3xd_last_config', value: JSON.stringify({ at: new Date().toISOString(), payload: body, tasa_detectada: tasa }) }];
    if (tasa) {
      rows.push({ key: 'd3xd_exchange_rate', value: String(tasa) });
      rows.push({ key: 'bcv_rate', value: String(tasa) }); // la web entera (Bs en tienda, pedidos) sigue la tasa del sistema
    }
    await sb('natan_settings', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify(rows),
    });

    if (!tasa) {
      return res.status(200).json({ status: true, message: 'Configuración recibida, pero no se encontró una tasa Bs/USD válida en wexchang_a/wexchang_b.', tasa: null });
    }
    res.status(200).json({ status: true, message: `Configuración recibida. Tasa de cambio aplicada en la web: ${tasa}`, tasa });
  } catch (e) {
    console.error('[d3xd-configuracion]', e.message);
    res.status(500).json({ status: false, message: 'Error al guardar configuración', error: e.message });
  }
};
