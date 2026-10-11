// ============================================================
//  asistencia.controller.js — MySQL
//  Registro diario de asistencia por materia, con upsert
//  (un docente puede corregir la asistencia del mismo día).
// ============================================================

const pool = require('../config/db');
const { randomUUID } = require('crypto');

const ESTADOS_VALIDOS = ['presente', 'ausente', 'tarde', 'excusado'];

// ────────────────────────────────────────────────────────────
//  POST /api/asistencia  (docente)
//  body: { materia_id, fecha, registros: [{ estudiante_id, estado, observacion? }] }
//  Registro masivo — un docente pasa lista completa de una vez.
// ────────────────────────────────────────────────────────────
exports.registrarMasivo = async (req, res) => {
  const { materia_id, fecha, registros } = req.body;

  if (!materia_id || !fecha || !Array.isArray(registros) || registros.length === 0) {
    return res.status(400).json({ ok: false, mensaje: 'materia_id, fecha y registros[] son obligatorios.' });
  }
  for (const r of registros) {
    if (!r.estudiante_id || !ESTADOS_VALIDOS.includes(r.estado)) {
      return res.status(400).json({
        ok: false,
        mensaje: `Cada registro necesita estudiante_id y un estado válido (${ESTADOS_VALIDOS.join(', ')}).`,
      });
    }
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [dicta] = await conn.query(
      `SELECT DISTINCT grupo_id FROM docentes_materias WHERE docente_id = ? AND materia_id = ?`,
      [req.usuario.id, materia_id]
    );
    if (!dicta.length) {
      await conn.rollback();
      return res.status(403).json({ ok: false, mensaje: 'No dictas esta materia.' });
    }
    const grupoIds = dicta.map((d) => d.grupo_id);

    const [matriculados] = await conn.query(
      `SELECT estudiante_id FROM matriculas WHERE grupo_id IN (?) AND estado = 'activa'`,
      [grupoIds]
    );
    const idsValidos = new Set(matriculados.map((m) => m.estudiante_id));

    const invalidos = registros.filter((r) => !idsValidos.has(r.estudiante_id));
    if (invalidos.length) {
      await conn.rollback();
      return res.status(400).json({
        ok: false,
        mensaje: 'Algunos estudiantes no están matriculados activos en tus grupos de esta materia.',
        estudiantes_invalidos: invalidos.map((r) => r.estudiante_id),
      });
    }

    // Una sola sentencia multi-fila con upsert en lugar de un INSERT por
    // estudiante: para un curso de 30+ estudiantes esto reduce 30+ round-trips
    // a la BD a uno solo (menos CPU/red del servidor de BD y del backend).
    const placeholders = registros.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(', ');
    const params = [];
    for (const r of registros) {
      params.push(randomUUID(), r.estudiante_id, materia_id, req.usuario.id, fecha, r.estado, r.observacion || null);
    }
    await conn.query(
      `INSERT INTO asistencia (id, estudiante_id, materia_id, docente_id, fecha, estado, observacion)
       VALUES ${placeholders}
       ON DUPLICATE KEY UPDATE
         estado = VALUES(estado),
         observacion = VALUES(observacion),
         docente_id = VALUES(docente_id)`,
      params
    );

    await conn.commit();
    return res.status(201).json({ ok: true, mensaje: `Asistencia registrada para ${registros.length} estudiante(s).` });

  } catch (err) {
    await conn.rollback();
    console.error('registrarMasivo asistencia:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  } finally {
    conn.release();
  }
};

// ────────────────────────────────────────────────────────────
//  GET /api/asistencia/materia/:materiaId?fecha=YYYY-MM-DD  (docente dueño, admin)
// ────────────────────────────────────────────────────────────
exports.obtenerPorFecha = async (req, res) => {
  const { materiaId } = req.params;
  const { fecha } = req.query;

  if (!fecha) {
    return res.status(400).json({ ok: false, mensaje: 'El parámetro fecha es obligatorio (YYYY-MM-DD).' });
  }

  try {
    if (req.usuario.rol === 'docente') {
      const [dicta] = await pool.query(
        `SELECT 1 FROM docentes_materias WHERE docente_id = ? AND materia_id = ?`,
        [req.usuario.id, materiaId]
      );
      if (!dicta.length) {
        return res.status(403).json({ ok: false, mensaje: 'No dictas esta materia.' });
      }
    }

    const [rows] = await pool.query(
      `SELECT a.id, a.estado, a.observacion, u.id AS estudiante_id, u.nombres, u.apellidos
       FROM asistencia a
       JOIN usuarios u ON u.id = a.estudiante_id
       WHERE a.materia_id = ? AND a.fecha = ?
       ORDER BY u.apellidos, u.nombres`,
      [materiaId, fecha]
    );
    return res.json({ ok: true, total: rows.length, asistencia: rows });
  } catch (err) {
    console.error('obtenerPorFecha:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// ────────────────────────────────────────────────────────────
//  GET /api/asistencia/estudiante/:estudianteId?materia_id=&desde=&hasta=
//  admin/superadmin, docente (dueño materia), acudiente (su hijo), estudiante (self)
// ────────────────────────────────────────────────────────────
exports.historialEstudiante = async (req, res) => {
  const { estudianteId } = req.params;
  const { materia_id, desde, hasta } = req.query;
  const { rol, id: usuarioId } = req.usuario;

  try {
    if (rol === 'estudiante' && usuarioId !== estudianteId) {
      return res.status(403).json({ ok: false, mensaje: 'No puedes ver la asistencia de otro estudiante.' });
    }
    if (rol === 'acudiente') {
      const [rel] = await pool.query(
        `SELECT 1 FROM acudientes_estudiantes WHERE acudiente_id = ? AND estudiante_id = ?`,
        [usuarioId, estudianteId]
      );
      if (!rel.length) {
        return res.status(403).json({ ok: false, mensaje: 'No eres acudiente registrado de este estudiante.' });
      }
    }
    if (rol === 'docente' && materia_id) {
      const [dicta] = await pool.query(
        `SELECT 1 FROM docentes_materias WHERE docente_id = ? AND materia_id = ?`,
        [usuarioId, materia_id]
      );
      if (!dicta.length) {
        return res.status(403).json({ ok: false, mensaje: 'No dictas esta materia.' });
      }
    }

    let sql = `SELECT id, materia_id, fecha, estado, observacion FROM asistencia WHERE estudiante_id = ?`;
    const params = [estudianteId];
    if (materia_id) { sql += ` AND materia_id = ?`; params.push(materia_id); }
    if (desde)      { sql += ` AND fecha >= ?`;      params.push(desde); }
    if (hasta)      { sql += ` AND fecha <= ?`;      params.push(hasta); }
    sql += ` ORDER BY fecha DESC`;

    const [rows] = await pool.query(sql, params);
    return res.json({ ok: true, total: rows.length, asistencia: rows });
  } catch (err) {
    console.error('historialEstudiante:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// ────────────────────────────────────────────────────────────
//  GET /api/asistencia/resumen/:estudianteId/materia/:materiaId
//  Conteo por estado + % de asistencia (presente+tarde sobre el total).
// ────────────────────────────────────────────────────────────
exports.resumenEstudiante = async (req, res) => {
  const { estudianteId, materiaId } = req.params;
  const { rol, id: usuarioId } = req.usuario;

  try {
    // Mismas reglas de autorización que historialEstudiante
    if (rol === 'estudiante' && usuarioId !== estudianteId) {
      return res.status(403).json({ ok: false, mensaje: 'No puedes ver la asistencia de otro estudiante.' });
    }
    if (rol === 'acudiente') {
      const [rel] = await pool.query(
        `SELECT 1 FROM acudientes_estudiantes WHERE acudiente_id = ? AND estudiante_id = ?`,
        [usuarioId, estudianteId]
      );
      if (!rel.length) {
        return res.status(403).json({ ok: false, mensaje: 'No eres acudiente registrado de este estudiante.' });
      }
    }
    if (rol === 'docente') {
      const [dicta] = await pool.query(
        `SELECT 1 FROM docentes_materias WHERE docente_id = ? AND materia_id = ?`,
        [usuarioId, materiaId]
      );
      if (!dicta.length) {
        return res.status(403).json({ ok: false, mensaje: 'No dictas esta materia.' });
      }
    }

    const [rows] = await pool.query(
      `SELECT estado, COUNT(*) AS total FROM asistencia
       WHERE estudiante_id = ? AND materia_id = ?
       GROUP BY estado`,
      [estudianteId, materiaId]
    );

    const conteo = { presente: 0, ausente: 0, tarde: 0, excusado: 0 };
    let totalClases = 0;
    for (const r of rows) {
      conteo[r.estado] = r.total;
      totalClases += r.total;
    }
    const porcentaje = totalClases > 0
      ? Number((((conteo.presente + conteo.tarde) / totalClases) * 100).toFixed(1))
      : null;

    return res.json({ ok: true, total_clases: totalClases, conteo, porcentaje_asistencia: porcentaje });
  } catch (err) {
    console.error('resumenEstudiante:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};
