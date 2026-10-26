// DESHABILITADO (25-sep-2026). Este endpoint ejecuta cobros C2P reales y
// estaba protegido solo por BNC_INTERNAL_TOKEN, que se entregaba al navegador
// dentro de admin.html. Se deja apagado hasta que el panel tenga
// autenticación real de operador en el servidor (sesión, roles, idempotencia,
// auditoría). La lógica original está en el historial de git.
module.exports = async (req, res) => {
  res.status(503).json({ status: false, message: 'Cobro C2P deshabilitado: pendiente de autenticación de operador en el servidor.' });
};
