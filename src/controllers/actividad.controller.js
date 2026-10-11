// ============================================================
//  actividad.controller.js — Actividad reciente del sistema
//  Combina dos fuentes reales (sin inventar una tabla nueva):
//    - solicitudes_instituciones (aprobadas / rechazadas)
//    - comunicados globales publicados
//  y las devuelve ya ordenadas por fecha, más recientes primero.
// ============================================================

const pool = require('../config/db');

exports.obtenerActividad = async (req, res) => {
  try {
    const [solicitudes] = await pool.query(
      `SELECT nombre, estado, revisado_at AS fecha
       FROM solicitudes_instituciones
       WHERE estado IN ('aprobada','rechazada') AND revisado_at IS NOT NULL
       ORDER BY revisado_at DESC
       LIMIT 10`
    );

    const [comunicados] = await pool.query(
      `SELECT titulo, tipo, created_at AS fecha
       FROM comunicados
       WHERE institucion_id IS NULL AND publicado = TRUE
       ORDER BY created_at DESC
       LIMIT 10`
    );

    const eventos = [
      ...solicitudes.map(s => ({
        tipo:  s.estado === 'aprobada' ? 'institucion_aprobada' : 'institucion_rechazada',
        texto: s.estado === 'aprobada'
          ? `Institución "${s.nombre}" aprobada`
          : `Solicitud de "${s.nombre}" rechazada`,
        fecha: s.fecha,
      })),
      ...comunicados.map(c => ({
        tipo:  'comunicado',
        texto: `Comunicado publicado: "${c.titulo}"`,
        fecha: c.fecha,
      })),
    ];

    eventos.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

    return res.json({ ok: true, actividad: eventos.slice(0, 10) });
  } catch (err) {
    console.error('obtenerActividad error:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor.' });
  }
};
