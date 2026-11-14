const pool = require('../config/db');

async function obtenerResumenAsistenciaDia(grupoId, desde, hasta, estudianteId = null) {
  let sql = `
    SELECT estudiante_id, estado, COUNT(*) AS total
    FROM asistencia_dia
    WHERE grupo_id = ?`;
  const params = [grupoId];
  if (desde) {
    sql += ' AND fecha >= ?';
    params.push(desde);
  }
  if (hasta) {
    sql += ' AND fecha <= ?';
    params.push(hasta);
  }
  if (estudianteId) {
    sql += ' AND estudiante_id = ?';
    params.push(estudianteId);
  }
  sql += ' GROUP BY estudiante_id, estado';

  const [rows] = await pool.query(sql, params);
  const resumen = {};
  for (const row of rows) {
    const estudiante = resumen[row.estudiante_id] ||= {
      asistio: 0,
      falta: 0,
      tarde: 0,
      justificada: 0,
    };
    estudiante[row.estado] = Number(row.total);
  }
  return resumen;
}

function totalizarResumenAsistenciaDia(resumen) {
  const total = { asistio: 0, falta: 0, tarde: 0, justificada: 0 };
  for (const estudiante of Object.values(resumen)) {
    for (const estado of Object.keys(total)) {
      total[estado] += estudiante[estado] || 0;
    }
  }
  total.total = total.asistio + total.falta + total.tarde + total.justificada;
  return total;
}

module.exports = { obtenerResumenAsistenciaDia, totalizarResumenAsistenciaDia };
