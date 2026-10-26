const { callBNC, checkInternalAuth } = require('./_client');

// Verifica un pago recibido por transferencia/depósito usando la referencia
// que el cliente escribió al pagar — reemplaza la revisión manual del comprobante.
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ status: false, message: 'Método no permitido' });
  if (!(await checkInternalAuth(req, res))) return;

  const { accountNumber, clientID, reference, amount, dateMovement } = req.body || {};
  if (!accountNumber || !clientID || !reference || amount === undefined) {
    return res.status(400).json({ status: false, message: 'Faltan campos: accountNumber, clientID, reference, amount' });
  }

  try {
    const result = await callBNC('/Position/Validate', {
      AccountNumber: accountNumber,
      ClientID: clientID,
      Reference: String(reference),
      Amount: Number(amount),
      DateMovement: dateMovement || new Date().toISOString().slice(0, 10),
      ChildClientID: '',
      BranchID: '',
    });
    res.status(200).json(result);
  } catch (e) {
    res.status(500).json({ status: false, message: 'Error al validar con BNC', error: e.message });
  }
};
