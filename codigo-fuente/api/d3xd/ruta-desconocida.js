const { checkAuth, logSync } = require('./_lib');

// Cualquier /api_d3xd/<algo>.php que no tenga ruta propia cae aquí. Antes
// esas llamadas morían en Vercel con un 403 genérico y sin dejar rastro, así
// que no había forma de saber qué ruta estaba pidiendo realmente D3xD. Se
// registra solo la ruta, el método y los nombres de los headers (nunca
// valores ni el cuerpo) y se responde en el formato del API.
// Solo se registra si trae el token válido: así el registro refleja lo que
// pide D3xD de verdad y no ruido de terceros (y no se escribe en Supabase
// por cada petición anónima).
module.exports = async (req, res) => {
  if (!checkAuth(req, res)) return;
  const ruta = String(req.url || '').split('?')[0].slice(0, 200);
  await logSync(ruta, {
    ok: false,
    metodo: req.method,
    headers: Object.keys(req.headers || {}).slice(0, 40),
    elementos: Array.isArray(req.body) ? req.body.length : null,
  }, 'd3xd_ruta_desconocida');
  res.status(404).json({ status: false, message: `Endpoint no implementado: ${ruta}` });
};
