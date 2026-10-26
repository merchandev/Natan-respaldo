const { checkAuth, sbAll, parseBody, logSync, bulkUpdateProducts, detectarMoneda, tasaParaLote, tasaNominal, registrarCuerpoRaro, leerRegistros, registrarCuerpoCrudo } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ status: false, message: 'Método no permitido' });
  if (!checkAuth(req, res)) return;

  // Cuerpo leído en crudo (ver leerRegistros): tolera JSON no estricto del POS.
  const lectura = await leerRegistros(req);
  const records = lectura.registros;
  if (records.length === 0) {
    await registrarCuerpoCrudo('actualizar_precios_stock.php', lectura);
    return res.status(400).json({ status: false, message: 'Se requiere al menos un producto con wpcode.' });
  }

  try {
    // Se trae TODO el catálogo con código (activo e inactivo) y se compara en
    // memoria — un código con coma o comillas rompía el filtro
    // codigo=in.("a","b") de PostgREST y tumbaba el endpoint entero con 500
    // en cada sincronización. Incluir los inactivos es necesario porque un
    // CSV puede haber desactivado un producto que D3xD sigue vendiendo en la
    // tienda física — si D3xD lo sigue reportando aquí cada 10 minutos, es
    // la prueba de que sigue vivo, así que se reactiva al encontrarlo.
    const existing = await sbAll('natan_products?select=id,codigo,active,price&codigo=not.is.null');
    const existingByCode = {};
    const precioUsdPorCodigo = {};
    (existing || []).forEach(p => { if (p.codigo) { existingByCode[p.codigo] = p; precioUsdPorCodigo[p.codigo] = parseFloat(p.price) || 0; } });
    const moneda = detectarMoneda(records, precioUsdPorCodigo);

    // D3xD manda wprice en bolívares (así lo confirma su propio CSV: "Precio 1
    // Bs."), pero natan_products.price se maneja en USD. Sin esta conversión
    // el precio se guardaba 700x más alto de lo real (ej. un mouse de $30
    // quedaba en $22,901).
    // Se convierte con la MISMA tasa que usó D3xD para calcular esos Bs
    // (la manda por configuracion.php). Así el USD queda idéntico al del
    // sistema aunque la tasa BCV del panel sea otra. Si D3xD nunca ha
    // mandado su tasa, se usa la del panel.
    const bcvRate = await tasaNominal();
    // Si el lote viene en Bs y no hay tasa válida, NO se tocan los precios
    // (solo stock): dividir entre 1 guardaba bolívares como dólares.
    const preciosBloqueados = moneda.moneda === 'Bs' && !bcvRate;
    // Lote en Bs comparado con los USD guardados → la mediana Bs/USD es la
    // tasa efectiva con la que D3xD calculó esos Bs (cambió su tasa a 813,73
    // pero siguió mandando Bs a 787,51). Se divide entre esa, no entre la
    // nominal, para que el USD quede exacto. tasaParaLote() exige >=20
    // comparables y +-15% de la nominal; si no, usa la nominal.
    const divisor = bcvRate ? tasaParaLote(moneda, bcvRate) : null;

    let noEncontrados = 0, errores = 0, reactivados = 0;
    const updates = [];

    for (const r of records) {
      const wpcode = String(r.wpcode).trim();
      const match = existingByCode[wpcode];
      if (!match) { noEncontrados++; continue; }

      const exististe = r.wexiste !== undefined && r.wexiste !== null ? Number(r.wexiste) : undefined;
      const payload = { id: match.id };
      const precioValido = r.wprice !== undefined && isFinite(parseFloat(r.wprice)) && parseFloat(r.wprice) > 0;
      if (precioValido && !preciosBloqueados) {
        const precio = parseFloat(r.wprice);
        // Si el lote viene en Bs y D3xD manda en wref su precio de referencia
        // en USD (wprice/wref ≈ tasa), se usa ese USD tal cual: queda exacto
        // aunque los Bs de D3xD estén calculados con una tasa vieja.
        const ref = parseFloat(r.wref);
        const razon = ref > 0 ? precio / ref : 0;
        const usd = moneda.moneda === 'Bs'
          ? (razon >= 50 && razon <= 5000 ? ref : precio / divisor)
          : precio;
        payload.price = Math.round(usd * 100) / 100;
      }
      if (exististe !== undefined) {
        payload.stock_maturin = exististe;
        payload.sede = exististe > 0 ? ['maturin'] : [];
      }
      // Solo reactiva si de verdad hay existencia — si no, un producto que
      // alguien desactivó manualmente porque se agotó volvía a aparecer solo
      // en el siguiente ciclo (cada 10 min) aunque D3xD lo siguiera
      // reportando en 0.
      if (match.active === false && exististe > 0) {
        payload.active = true;
        reactivados++;
      }
      if (Object.keys(payload).length === 1) continue; // solo el id, nada que actualizar
      updates.push(payload);
    }

    let actualizados = 0;
    try {
      await bulkUpdateProducts(updates);
      actualizados = updates.length;
    } catch (e) {
      console.error('[d3xd-actualizar-precios-stock] bulk update falló:', e.message);
      errores = updates.length;
    }

    await logSync('actualizar_precios_stock.php', { ok: true, recibidos: records.length, actualizados, reactivados, no_encontrados: noEncontrados, errores, moneda: moneda.moneda, moneda_criterio: moneda.criterio, moneda_razon: moneda.razon, moneda_n: moneda.n, tasa_usada: divisor, tasa_nominal: bcvRate, precios_bloqueados: preciosBloqueados });
    res.status(200).json({
      status: true,
      message: `${actualizados} productos actualizados.`,
      actualizados,
      reactivados,
      no_encontrados: noEncontrados,
      errores,
    });
  } catch (e) {
    console.error('[d3xd-actualizar-precios-stock]', e.message);
    await logSync('actualizar_precios_stock.php', { ok: false, error: e.message });
    res.status(500).json({ status: false, message: 'Error al actualizar precios/stock', error: e.message });
  }
};
