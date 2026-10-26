const { callBNC, checkInternalAuth } = require('./_client');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ status: false, message: 'Método no permitido' });
  if (!(await checkInternalAuth(req, res))) return;

  try {
    const result = await callBNC('/Services/BCVRates', {});
    res.status(200).json(result);
  } catch (e) {
    res.status(500).json({ status: false, message: 'Error al consultar tasa BCV en BNC', error: e.message });
  }
};
