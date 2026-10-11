const pool = require('../config/db');
const { randomUUID } = require('crypto');

/**
 * Inserta un registro en logs_errores. Nunca debe lanzar una excepción
 * hacia arriba: si falla el logging, se registra en consola y se sigue,
 * para no tumbar la petición original que ya estaba fallando.
 */
async function registrarError({
  modulo,
  tipo_error,
  mensaje,
  stack = null,
  metodo_http = null,
  ruta = null,
  status_code = null,
  usuario_id = null,
  institucion_id = null,
}) {
  try {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO logs_errores
        (id, modulo, tipo_error, mensaje, stack, metodo_http, ruta, status_code, usuario_id, institucion_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, modulo, tipo_error, mensaje, stack, metodo_http, ruta, status_code, usuario_id, institucion_id]
    );
  } catch (err) {
    console.error('[logs_errores] No se pudo registrar el error:', err.message);
  }
}

module.exports = registrarError;
