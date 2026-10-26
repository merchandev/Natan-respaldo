const { callBNC, checkInternalAuth } = require('./_client');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ status: false, message: 'Método no permitido' });
  if (!(await checkInternalAuth(req, res))) return;

  const { clientID } = req.body || {};
  if (!clientID) return res.status(400).json({ status: false, message: 'Falta clientID' });

  try {
    const result = await callBNC('/Position/Current', { ClientID: clientID, ChildClientID: '', BranchID: '' });
    res.status(200).json(result);
  } catch (e) {
    res.status(500).json({ status: false, message: 'Error al consultar saldo en BNC', error: e.message });
  }
};
