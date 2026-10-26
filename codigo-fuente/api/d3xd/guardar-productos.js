const { checkAuth, sb, sbAll, parseBody, logSync, bulkUpdateProducts, detectarMoneda, tasaParaLote, tasaNominal, registrarCuerpoRaro, leerRegistros, registrarCuerpoCrudo } = require('./_lib');

// Homologa el departamento que mande D3xD a una de las 12 categorías fijas
// de la tienda — mismo criterio que admin.html normalizeCategory(), para
// que no se creen categorías sueltas ("reloj", "sarten", "nevera"...) que
// no aparecen en el filtro de la tienda.
const CAT_KEYWORDS = [
  ['celulares', ['celular', 'telefono', 'smartphone', 'movil']],
  ['tablets', ['tablet']],
  ['laptops', ['laptop', 'notebook', 'chromebook', ' pc', 'computador']],
  ['audio', ['audio', 'corneta', 'audifono', 'auricular', 'parlante', 'bocina']],
  ['relojes', ['reloj', 'smartwatch', 'watch']],
  ['televisores', ['television', 'televisor', /(^|\s)tv(\s|$)/]],
  ['camaras', ['camara']],
  ['perfumes', ['perfume', 'fragancia', 'colonia']],
  ['ropa', ['ropa', 'vestimenta', 'calzado', 'zapato', 'camisa', 'franela', 'pantalon', 'textil']],
  ['redes', ['red', 'router', 'modem', 'repetidor', 'access point', 'switch']],
  ['impresoras', ['impresora', 'tinta', 'toner']],
  ['electrodomesticos', ['electrodomestico', 'cocina', 'lavadora', 'nevera', 'freidora', 'licuadora', 'sarten', 'plancha', 'ventilador', 'dispensador', 'olla', 'sandwichera', 'microonda', 'congelador', 'fabricador']],
];
function normalizeCategory(raw) {
  const t = (raw || '').toString().toLowerCase().trim();
  if (!t) return 'accesorios';
  for (const [slug, keywords] of CAT_KEYWORDS) {
    for (const kw of keywords) {
      if (kw instanceof RegExp ? kw.test(t) : t.includes(kw)) return slug;
    }
  }
  return 'accesorios';
}

function buildSpecs(r) {
  const specs = [];
  if (r.wpcode)     specs.push(['Código', String(r.wpcode).trim()]);
  if (r.wclasifica) specs.push(['Clasificación', String(r.wclasifica).trim()]);
  if (r.wref)       specs.push(['Referencia', String(r.wref).trim()]);
  if (r.wgarantia)  specs.push(['Garantía', String(r.wgarantia).trim()]);
  if (r.wdetails)   specs.push(['Detalles', String(r.wdetails).trim()]);
  return specs;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ status: false, message: 'Método no permitido' });
  if (!checkAuth(req, res)) return;

  // Cuerpo leído en crudo (ver leerRegistros): tolera JSON no estricto del POS.
  const lectura = await leerRegistros(req);
  const records = lectura.registros;
  if (records.length === 0) {
    await registrarCuerpoCrudo('guardar_productos.php', lectura);
    return res.status(400).json({ status: false, message: 'Se requiere al menos un producto con wpcode.' });
  }

  try {
    // Se trae TODO el catálogo (activos e inactivos, código + nombre) y se
    // compara en memoria. El código de D3xD resultó NO ser estable — el mismo
    // producto puede salir con un código distinto en cada exportación — así
    // que se usa como primer criterio, pero si no coincide se cae a comparar
    // por nombre exacto para no duplicar el mismo producto una y otra vez.
    // Buscar solo entre los activos tampoco sirve: un producto desactivado
    // que D3xD vuelve a traer no se reconocía y se creaba un duplicado nuevo
    // en vez de reactivar el original (con su foto y datos ya cargados).
    const existing = await sbAll('natan_products?select=id,codigo,name,active,img,created_at,price,specs');
    const existingByCode = {};
    const existingByName = {};

    // D3xD nunca manda fotos — si un producto no existe (se borró antes, o
    // es la primera vez que D3xD lo trae) pero ya conocíamos su foto por
    // código, se le reconecta en vez de crearlo sin imagen.
    const photoBackups = await sbAll('natan_product_photos?select=codigo,img');
    const photoByCodigo = {};
    (photoBackups || []).forEach(p => { photoByCodigo[p.codigo] = p.img; });
    // Si hay varias filas con el mismo nombre (duplicados viejos), se
    // prefiere siempre la que tiene foto, luego la que ya está activa, luego
    // la más antigua — para no reactivar/actualizar al azar una copia sin
    // foto mientras la buena queda huérfana.
    const isBetter = (a, b) => {
      const aImg = !!(a.img), bImg = !!(b.img);
      if (aImg !== bImg) return aImg;
      if (a.active !== b.active) return a.active;
      return new Date(a.created_at) < new Date(b.created_at);
    };
    (existing || []).forEach(p => {
      if (p.codigo && (!existingByCode[p.codigo] || isBetter(p, existingByCode[p.codigo]))) {
        existingByCode[p.codigo] = p;
      }
      const key = p.name.trim().toLowerCase();
      if (!existingByName[key] || isBetter(p, existingByName[key])) {
        existingByName[key] = p;
      }
    });
    // Productos creados a mano en el panel guardaban el código solo en la
    // ficha (specs "Código") y no en la columna — D3xD no los reconocía y
    // creaba un duplicado con el mismo código (caso Compaq Ryzen 5, 8-oct).
    // Segundo pase: si ningún producto tiene ese código en la columna, se
    // usa el de la ficha.
    (existing || []).forEach(p => {
      if (p.codigo || !Array.isArray(p.specs)) return;
      const s = p.specs.find(x => Array.isArray(x) && x[0] === 'Código' && x[1]);
      const cod = s && String(s[1]).trim();
      if (!cod) return;
      const actual = existingByCode[cod];
      if (!actual || (!actual.codigo && isBetter(p, actual))) existingByCode[cod] = p;
    });

    // D3xD manda wprice en bolívares (así lo confirma su propio CSV: "Precio
    // 1 Bs."), pero natan_products.price se maneja en USD. Sin esta
    // conversión el precio se guardaba ~700x más alto de lo real.
    // Misma tasa que usó D3xD para calcular esos Bs (llega por
    // configuracion.php); si nunca la ha mandado, la del panel.
    const bcvRate = await tasaNominal();

    const precioUsdPorCodigo = {};
    (existing || []).forEach(p => { if (p.codigo) precioUsdPorCodigo[p.codigo] = parseFloat(p.price) || 0; });
    const moneda = detectarMoneda(records, precioUsdPorCodigo);
    // Lote en Bs sin tasa válida: no se tocan precios (dividir entre 1
    // guardaba bolívares como dólares). Un producto nuevo entra con precio 0
    // y queda visible como "consultar" hasta la próxima sincronización.
    const preciosBloqueados = moneda.moneda === 'Bs' && !bcvRate;
    // Lote en Bs comparado con los USD guardados → la mediana Bs/USD es la
    // tasa efectiva con la que D3xD calculó esos Bs; se divide entre esa (y
    // no entre la nominal) para que el USD quede exacto aunque D3xD tenga
    // sus Bs calculados con una tasa vieja.
    const divisor = bcvRate ? tasaParaLote(moneda, bcvRate) : null;

    const toInsert = [];
    const toUpdate = [];

    for (const r of records) {
      const wpcode = String(r.wpcode).trim();
      const wdescLower = (r.wdesc || '').trim().toLowerCase();
      const exististe = r.wexiste !== undefined && r.wexiste !== null ? Number(r.wexiste) : 0;
      const _wp = parseFloat(r.wprice);
      const priceBs = (r.wprice !== undefined && isFinite(_wp) && _wp > 0 && !preciosBloqueados) ? _wp : undefined;
      const payload = {
        codigo:          wpcode,
        name:            (r.wdesc || '').trim() || wpcode,
        description:     (r.wdesc || '').trim(),
        cat:             normalizeCategory(r.wdepart),
        brand:           (r.wmarca || '').toString().trim(),
        // Lote en Bs + wref numérico con wprice/wref ≈ tasa → wref es el USD
        // de referencia de D3xD y se usa directo (exacto aunque sus Bs estén
        // con tasa vieja). Si no, se divide entre la tasa; si el lote ya
        // viene en USD, se usa tal cual.
        price:           priceBs !== undefined ? Math.round((moneda.moneda === 'Bs'
                           ? ((parseFloat(r.wref) > 0 && priceBs / parseFloat(r.wref) >= 50 && priceBs / parseFloat(r.wref) <= 5000) ? parseFloat(r.wref) : priceBs / divisor)
                           : priceBs) * 100) / 100 : undefined,
        stock_maturin:   exististe,
        sede:            exististe > 0 ? ['maturin'] : [],
        specs:           buildSpecs(r),
      };

      const match = existingByCode[wpcode] || (wdescLower && existingByName[wdescLower]);
      if (match && match.id === null) continue; // repetido dentro del mismo lote
      if (match) {
        // Solo reactiva si de verdad hay existencia — evita que un producto
        // desactivado manualmente por agotado vuelva a aparecer solo porque
        // D3xD lo sigue reportando en 0.
        if (match.active === false && exististe > 0) payload.active = true;
        toUpdate.push({ id: match.id, payload });
      } else {
        // Si el mismo código viene dos veces en el lote, la segunda vez
        // actualiza en vez de insertar otra fila (el código es único).
        const pendiente = { id: null, codigo: wpcode, active: true };
        existingByCode[wpcode] = pendiente;
        toInsert.push({
          ...payload,
          price: payload.price || 0,
          img: photoByCodigo[wpcode] || '', stars: 5, reviews: 0, active: true,
          images: [], colors: [], variants: [], featured: false,
          stock_temblador: 0,
        });
      }
    }

    let inserted = 0, updated = 0, reactivated = 0, errores = 0;

    for (let i = 0; i < toInsert.length; i += 50) {
      const batch = toInsert.slice(i, i + 50);
      try {
        await sb('natan_products', { method: 'POST', body: JSON.stringify(batch) });
        inserted += batch.length;
      } catch (e) { errores += batch.length; }
    }

    try {
      await bulkUpdateProducts(toUpdate.map(({ id, payload }) => ({ id, ...payload })));
      updated = toUpdate.length;
      reactivated = toUpdate.filter(u => u.payload.active === true).length;
    } catch (e) {
      console.error('[d3xd-guardar-productos] bulk update falló:', e.message);
      errores += toUpdate.length;
    }

    await logSync('guardar_productos.php', { ok: true, recibidos: records.length, nuevos: inserted, actualizados: updated, reactivados: reactivated, errores, moneda: moneda.moneda, moneda_criterio: moneda.criterio, moneda_razon: moneda.razon, moneda_n: moneda.n, tasa_usada: divisor, tasa_nominal: bcvRate, precios_bloqueados: preciosBloqueados });
    res.status(200).json({
      status: true,
      message: `Sincronización completada: ${inserted} nuevos, ${updated} actualizados${reactivated ? `, ${reactivated} reactivados` : ''}.`,
      nuevos: inserted,
      actualizados: updated,
      reactivados: reactivated,
      errores,
    });
  } catch (e) {
    console.error('[d3xd-guardar-productos]', e.message);
    await logSync('guardar_productos.php', { ok: false, error: e.message });
    res.status(500).json({ status: false, message: 'Error al sincronizar productos', error: e.message });
  }
};
