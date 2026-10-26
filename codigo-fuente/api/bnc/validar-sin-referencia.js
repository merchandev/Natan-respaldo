const { callBNC, checkInternalAuth } = require('./_client');

// Busca un pago móvil por teléfono+banco+fecha, sin conocer la referencia exacta.
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ status: false, message: 'Método no permitido' });
  if (!(await checkInternalAuth(req, res))) return;

  const { accountNumber, bankCode, phoneNumber, clientID, amount, requestDate } = req.body || {};
  if (!accountNumber || !bankCode || !phoneNumber || !clientID) {
    return res.status(400).json({ status: false, message: 'Faltan campos: accountNumber, bankCode, phoneNumber, clientID' });
  }

  try {
    const result = await callBNC('/Position/ValidateExistence', {
      AccountNumber: accountNumber,
      Amount: amount !== undefined ? Number(amount) : undefined,
      BankCode: Number(bankCode),
      ClientID: clientID,
      PhoneNumber: phoneNumber,
      RequestDate: requestDate || new Date().toISOString().slice(0, 19),
      ChildClientID: '',
      BranchID: '',
    });
    res.status(200).json(result);
  } catch (e) {
    res.status(500).json({ status: false, message: 'Error al validar con BNC', error: e.message });
  }
};
