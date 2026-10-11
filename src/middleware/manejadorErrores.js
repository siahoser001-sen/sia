const registrarError = require('../utils/registrarError');

/**
 * Middleware de error de Express (4 argumentos = Express lo reconoce
 * automáticamente como manejador de errores). Debe registrarse SIEMPRE
 * al final de app.js, después de montar todas las rutas.
 *
 * Nota sobre Express 4: esto captura errores lanzados de forma síncrona
 * o pasados explícitamente con next(err). Los controladores actuales del
 * SIA ya hacen try/catch y responden ellos mismos (ver docente.controller.js),
 * así que este middleware es la RED DE SEGURIDAD para lo que se escape de
 * ahí — JSON mal formado en el body, errores de middlewares, rutas no
 * contempladas, etc. No reemplaza el try/catch de los controladores.
 */
function manejadorErrores(err, req, res, next) {
  const modulo = req.baseUrl ? req.baseUrl.replace('/api/', '') : 'desconocido';
  const usuario_id = req.usuario?.id || null;
  const institucion_id = req.usuario?.institucion_id || null;
  const status = err.status || err.statusCode || 500;

  registrarError({
    modulo,
    tipo_error: err.name || 'Error',
    mensaje: err.message,
    stack: err.stack,
    metodo_http: req.method,
    ruta: req.originalUrl,
    status_code: status,
    usuario_id,
    institucion_id,
  });

  if (res.headersSent) return next(err);

  // Nunca se expone err.message tal cual al cliente: puede contener
  // rutas del servidor, nombres de tablas o detalles internos. Solo se
  // muestra el mensaje del error si quien lo lanzó lo marcó como seguro
  // para exponer (err.expose, como hace el parser JSON de Express), y
  // para los 500 siempre un mensaje genérico.
  const mensajeExponible = status >= 400 && status < 500 && err.expose
    ? err.message
    : 'Ocurrió un error inesperado.';
  res.status(status).json({
    ok: false,
    mensaje: status === 500 ? 'Ocurrió un error interno. Intenta de nuevo.' : mensajeExponible,
  });
}

module.exports = manejadorErrores;
