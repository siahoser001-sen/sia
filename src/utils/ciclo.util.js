// ============================================================
//  ciclo.util.js
//  Ciclo lectivo DERIVADO de los periodos académicos (ROADMAP D6):
//  no hay tabla nueva; el ciclo es el rango [MIN(fecha_inicio),
//  MAX(fecha_fin)] de los periodos del año (el activo, o el de mayor
//  anio_lectivo si no hay ninguno activo).
// ============================================================

const pool = require('../config/db');

const MS_DIA = 24 * 60 * 60 * 1000;

// Normaliza un DATE de MySQL (Date o string) a 'YYYY-MM-DD'.
function soloFecha(valor) {
  if (!valor) return null;
  if (valor instanceof Date) return valor.toISOString().slice(0, 10);
  return String(valor).slice(0, 10);
}

// Devuelve { anio_lectivo, fecha_inicio, fecha_fin, semanas } o null.
async function obtenerCiclo(institucionId, anioLectivo = null) {
  let anio = anioLectivo ? Number(anioLectivo) : null;

  if (!anio) {
    const [act] = await pool.query(
      `SELECT anio_lectivo FROM periodos_academicos
       WHERE institucion_id = ? AND activo = TRUE LIMIT 1`,
      [institucionId]
    );
    if (act.length) anio = act[0].anio_lectivo;
    else {
      const [max] = await pool.query(
        `SELECT MAX(anio_lectivo) AS anio FROM periodos_academicos WHERE institucion_id = ?`,
        [institucionId]
      );
      anio = max[0] ? max[0].anio : null;
    }
  }
  if (!anio) return null;

  const [rows] = await pool.query(
    `SELECT MIN(fecha_inicio) AS fecha_inicio, MAX(fecha_fin) AS fecha_fin
     FROM periodos_academicos
     WHERE institucion_id = ? AND anio_lectivo = ?`,
    [institucionId, anio]
  );
  if (!rows.length || !rows[0].fecha_inicio) return null;

  const fecha_inicio = soloFecha(rows[0].fecha_inicio);
  const fecha_fin    = soloFecha(rows[0].fecha_fin);
  const dias = Math.round((new Date(fecha_fin) - new Date(fecha_inicio)) / MS_DIA) + 1;
  const semanas = Math.max(1, Math.round(dias / 7));

  return { anio_lectivo: Number(anio), fecha_inicio, fecha_fin, semanas };
}

module.exports = { obtenerCiclo, soloFecha };
