/**
 * Envuelve un controlador async para que, si lanza una excepción no
 * capturada, caiga automáticamente en manejadorErrores.js (vía next(err))
 * en vez de tumbar el proceso o quedar como una promesa rechazada silenciosa.
 *
 * Uso (OPCIONAL, para controladores nuevos que quieras escribir sin
 * try/catch manual):
 *
 *   const asyncHandler = require('../utils/asyncHandler');
 *   exports.miAccion = asyncHandler(async (req, res) => {
 *     const [rows] = await pool.query('...');
 *     res.json({ ok: true, rows });
 *   });
 *
 * Los controladores existentes que YA tienen try/catch (docente.controller.js,
 * academico.controller.js, etc.) no necesitan cambiar — siguen funcionando
 * igual. Esto es solo para código nuevo hacia adelante.
 */
function asyncHandler(fn) {
  return function (req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = asyncHandler;
