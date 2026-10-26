const { checkAuth, sbAll, parseBody } = require('./_lib');

function toD3xD(p) {
  const specMap = {};
  (p.specs || []).forEach(([k, v]) => { specMap[k] = v; });
  return {
    wpcode:      p.codigo || '',
    wdesc:       p.name || '',
    wdepart:     p.cat || '',
    wsubdepart:  specMap['Clasificación'] || '',
    wclasifica:  specMap['Clasificación'] || '',
    wmarca:      p.brand || '',
    wprice:      p.price || 0,
    wprice2: 0, wprice3: 0, wprice4: 0,
    wexiste:     (p.stock_maturin || 0) + (p.stock_temblador || 0),
    wtax:        0,
    wdetails:    specMap['Detalles'] || '',
    wref:        specMap['Referencia'] || '',
    wgarantia:   specMap['Garantía'] || '',
  };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ status: false, message: 'Método no permitido' });
  if (!checkAuth(req, res)) return;

  const body = parseBody(req)[0] || {};
  const q = body.q !== undefined && body.q !== null ? String(body.q).trim() : '';
  const t = body.t !== undefined ? Number(body.t) : null;

  // Sin límite fijo: sbAll pagina, así D3xD recibe el catálogo completo
  // (con limit=1000 solo veía los primeros mil productos).
  let query = 'natan_products?select=codigo,name,cat,brand,price,stock_maturin,stock_temblador,specs&active=eq.true&codigo=not.is.null&order=id';

  if (q) {
    if (t === 0) query += `&codigo=ilike.*${encodeURIComponent(q)}*`;
    else if (t === 2) query += `&cat=ilike.*${encodeURIComponent(q)}*`;
    else if (t === 4) query += `&stock_maturin=gte.${encodeURIComponent(q)}`;
    else query += `&or=(name.ilike.*${encodeURIComponent(q)}*,description.ilike.*${encodeURIComponent(q)}*)`;
  }

  try {
    const rows = await sbAll(query);
    const data = (rows || []).map(toD3xD);
    res.status(200).json({ status: true, count: data.length, data });
  } catch (e) {
    res.status(500).json({ status: false, message: 'Error al consultar productos', error: e.message });
  }
};
