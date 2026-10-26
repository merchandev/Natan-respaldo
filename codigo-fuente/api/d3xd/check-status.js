const { checkAuth, sbCount, logSync } = require('./_lib');

// Formato PHP date("Y-m-d H:i:s"), igual al check_status.php de referencia de D3xD.
function timestampPHP() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ status: false, message: 'Método no permitido' });
  if (!checkAuth(req, res)) return;

  try {
    const prodCount = await sbCount('natan_products?select=id&codigo=not.is.null&active=eq.true');
    await logSync('check_status.php', { ok: true, productos_registrados: prodCount }, 'd3xd_last_check_status');

    // Misma forma exacta que devuelve el check_status.php de referencia que
    // pasó D3xD — su cliente esperaba las claves anidadas (detalles.*), no
    // la respuesta plana que teníamos antes (de ahí el "clave no encontrada
    // en el diccionario"). Se mantienen además los alias planos por si
    // alguna otra parte de su app sí los lee.
    res.status(200).json({
      status: true,
      timestamp: timestampPHP(),
      detalles: {
        base_de_datos: {
          estado: 'Conectado',
          servidor: 'OK',
        },
        tablas: {
          productos_registrados: prodCount,
          estado: 'Tablas accesibles',
        },
        servidor_archivos: {
          carpeta_uploads: 'Escribible',
          espacio_libre: 'N/A (almacenamiento administrado)',
        },
        entorno: {
          php_version: 'N/A (Node.js serverless)',
          max_upload_size: '10 MB',
          post_max_size: '10 MB',
        },
      },
      // Alias planos, por compatibilidad con la forma anterior.
      success: true, ok: true,
      message: 'API D3XD activa y conexion a BD exitosa',
      mensaje: 'API D3XD activa y conexion a BD exitosa',
      database: 'OK', db: 'OK', conectado: true, connected: true,
    });
  } catch (e) {
    res.status(200).json({
      status: false,
      timestamp: timestampPHP(),
      detalles: {
        error_critico: e.message,
      },
      success: false, ok: false,
      message: 'API activa pero sin conexión a base de datos',
      mensaje: 'API activa pero sin conexión a base de datos',
      database: 'ERROR', db: 'ERROR', conectado: false, connected: false,
      error: e.message,
    });
  }
};
