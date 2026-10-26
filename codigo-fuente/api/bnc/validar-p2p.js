const { callBNC, checkInternalAuth } = require('./_client');

// Verifica un pago móvil (P2P) usando teléfono + banco + últimos 4 dígitos de referencia.
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ status: false, message: 'Método no permitido' });
  if (!(await checkInternalAuth(req, res))) return;

  const { accountNumber, bankCode, phoneNumber, clientID, reference, amount, requestDate } = req.body || {};
  if (!accountNumber || !bankCode || !phoneNumber || !clientID || !reference || amount === undefined) {
    return res.status(400).json({ status: false, message: 'Faltan campos: accountNumber, bankCode, phoneNumber, clientID, reference, amount' });
  }

  try {
    const result = await callBNC('/Position/ValidateP2P', {
      AccountNumber: accountNumber,
      BankCode: Number(bankCode),
      PhoneNumber: phoneNumber,
      ClientID: clientID,
      Reference: String(reference),
      RequestDate: requestDate || new Date().toISOString().slice(0, 19),
      Amount: Number(amount),
      ChildClientID: '',
      BranchID: '',
    });
    res.status(200).json(result);
  } catch (e) {
    res.status(500).json({ status: false, message: 'Error al validar P2P con BNC', error: e.message });
  }
};
