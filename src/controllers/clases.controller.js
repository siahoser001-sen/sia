const pool = require('../config/db');
const { randomUUID, randomBytes } = require('crypto');
const { publicarMensajeSistema } = require('../services/chat-curso.service'); // Ronda F (F5)
const {
  condicionDocenteDictaMateriaEnGrupo,
  materiasConDocentesDeGrupo,
} = require('../utils/materias-curso.util');

// ── GET /api/clases/mis-materias (docente) ─────────────────────
// Devuelve las materias que dicta el docente logueado, con su
// docente_materia_id (necesario para iniciar/consultar llamadas).
exports.misMateriasDocente = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT dm.id AS docente_materia_id, g.id AS grupo_id, m.id AS materia_id, m.nombre AS materia, g.nombre AS grupo,
              gr.nombre AS grado, dm.periodo_id
       FROM docentes_materias dm
       JOIN materias m ON m.id = dm.materia_id
       JOIN grupos   g ON ${condicionDocenteDictaMateriaEnGrupo('dm', 'm', 'g.id')}
       JOIN grados   gr ON gr.id = g.grado_id
       WHERE dm.docente_id = ? AND m.activa = TRUE
       ORDER BY gr.orden, g.nombre, m.nombre`,
      [req.usuario.id]
    );
    return res.json({ ok: true, materias: rows });
  } catch (err) {
    console.error('misMateriasDocente error:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// ── GET /api/clases/mis-materias-estudiante (estudiante) ──────
// Devuelve las materias del estudiante según su matrícula activa
// del grupo actual, con docente opcional para cada materia del curso.
exports.misMateriasEstudiante = async (req, res) => {
  try {
    const [matriculas] = await pool.query(
      `SELECT grupo_id FROM matriculas
       WHERE estudiante_id = ? AND estado = 'activa'
       LIMIT 1`,
      [req.usuario.id]
    );
    if (!matriculas.length) {
      return res.json({ ok: true, materias: [], curso: null, companeros: [], planItems: [] });
    }

    const grupoId = matriculas[0].grupo_id;
    const [rows, cursos, companeros] = await Promise.all([
      materiasConDocentesDeGrupo(pool, grupoId),
      pool.query(
        `SELECT g.id AS grupo_id, g.nombre AS grupo, gr.nombre AS grado,
                CONCAT_WS(' ', director.nombres, director.apellidos) AS director
         FROM grupos g
         JOIN grados gr ON gr.id = g.grado_id
         LEFT JOIN usuarios director ON director.id = g.director_id
         WHERE g.id = ?`,
        [grupoId]
      ).then(([resultado]) => resultado),
      pool.query(
        `SELECT DISTINCT u.id, CONCAT_WS(' ', u.nombres, u.apellidos) AS nombre
         FROM matriculas mt
         JOIN usuarios u ON u.id = mt.estudiante_id
         WHERE mt.grupo_id = ? AND mt.estado = 'activa'
           AND mt.estudiante_id <> ?
         ORDER BY nombre`,
        [grupoId, req.usuario.id]
      ).then(([resultado]) => resultado),
    ]);
    const materiasIds = [...new Set(rows.map(materia => materia.materia_id))];
    const planItems = materiasIds.length
      ? (await pool.query(
        `SELECT pi.id, pi.materia_id, m.nombre AS materia, pi.nombre,
                pi.peso_pct, pi.orden
         FROM plan_evaluacion_items pi
         JOIN materias m ON m.id = pi.materia_id
         WHERE pi.materia_id IN (${materiasIds.map(() => '?').join(',')})
           AND pi.periodo_id IN (
             SELECT pa.id
             FROM periodos_academicos pa
             JOIN grados gr ON gr.institucion_id = pa.institucion_id
             JOIN grupos g ON g.grado_id = gr.id
             WHERE g.id = ? AND pa.activo = TRUE
           )
         ORDER BY m.nombre, pi.orden, pi.created_at`,
        [...materiasIds, grupoId]
      ))[0]
      : [];
    return res.json({
      ok: true,
      materias: rows,
      curso: cursos[0] || null,
      companeros,
      planItems,
    });
  } catch (err) {
    console.error('misMateriasEstudiante error:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// ── GET /api/clases/:docenteMateriaId/estado-llamada ──────────
// Cualquier rol matriculado/asignado a la materia puede consultarlo.
exports.estadoLlamada = async (req, res) => {
  const { docenteMateriaId } = req.params;
  try {
    const [rows] = await pool.query(
      `SELECT id, sala_jitsi, iniciada_at
       FROM sesiones_clase
       WHERE docente_materia_id = ? AND estado = 'activa'
       ORDER BY iniciada_at DESC LIMIT 1`,
      [docenteMateriaId]
    );
    if (!rows.length) {
      return res.json({ ok: true, activa: false });
    }
    return res.json({
      ok: true,
      activa: true,
      sesion_id: rows[0].id,
      sala: rows[0].sala_jitsi,
      url: `https://meet.jit.si/${rows[0].sala_jitsi}`,
      iniciada_at: rows[0].iniciada_at,
    });
  } catch (err) {
    console.error('estadoLlamada error:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// ── POST /api/clases/:docenteMateriaId/iniciar-llamada (docente) ─
exports.iniciarLlamada = async (req, res) => {
  const { docenteMateriaId } = req.params;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Verificar que la materia sea del docente que hace la petición
    const [dm] = await conn.query(
      `SELECT dm.id, dm.grupo_id, m.nombre AS materia
         FROM docentes_materias dm
         JOIN materias m ON m.id = dm.materia_id
        WHERE dm.id = ? AND dm.docente_id = ?`,
      [docenteMateriaId, req.usuario.id]
    );
    if (!dm.length) {
      await conn.rollback();
      return res.status(403).json({ ok: false, mensaje: 'Esta materia no te pertenece.' });
    }

    // Evitar doble sesión activa para la misma materia
    const [activas] = await conn.query(
      `SELECT id FROM sesiones_clase WHERE docente_materia_id = ? AND estado = 'activa'`,
      [docenteMateriaId]
    );
    if (activas.length) {
      await conn.rollback();
      return res.status(409).json({ ok: false, mensaje: 'Ya hay una llamada activa para esta materia.' });
    }

    const id = randomUUID();
    const sala = `SIA-${docenteMateriaId}-${randomBytes(3).toString('hex')}`.replace(/[^a-zA-Z0-9-]/g, '-');

    await conn.query(
      `INSERT INTO sesiones_clase (id, docente_materia_id, estado, sala_jitsi, iniciada_por)
       VALUES (?, ?, 'activa', ?, ?)`,
      [id, docenteMateriaId, sala, req.usuario.id]
    );

    await conn.commit();

    // Chat del curso (Ronda F, F5): el sistema comparte el código de la
    // videollamada y el enlace directo en el chat del grupo.
    if (dm[0].grupo_id) {
      const url = `https://meet.jit.si/${sala}`;
      await publicarMensajeSistema(dm[0].grupo_id, {
        evento: 'videollamada',
        texto: `🎥 El profesor inició una videollamada de ${dm[0].materia}. Entra con el código ${sala}.`,
        datos: { sala, url },
      });
    }

    // Notificar en vivo a todos los conectados a esta materia
    const io = req.app.get('io');
    if (io) {
      io.to(`materia:${docenteMateriaId}`).emit('llamada-iniciada', {
        docente_materia_id: docenteMateriaId,
        sesion_id: id,
        sala,
        url: `https://meet.jit.si/${sala}`,
      });
    }

    return res.status(201).json({ ok: true, sesion_id: id, sala, url: `https://meet.jit.si/${sala}` });

  } catch (err) {
    await conn.rollback();
    console.error('iniciarLlamada error:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  } finally {
    conn.release();
  }
};

// ── POST /api/clases/:docenteMateriaId/finalizar-llamada (docente) ─
exports.finalizarLlamada = async (req, res) => {
  const { docenteMateriaId } = req.params;
  try {
    // Materia y grupo, para avisar en el chat del curso (Ronda F, F5).
    const [info] = await pool.query(
      `SELECT dm.grupo_id, m.nombre AS materia
         FROM docentes_materias dm
         JOIN materias m ON m.id = dm.materia_id
        WHERE dm.id = ?`,
      [docenteMateriaId]
    );

    const [result] = await pool.query(
      `UPDATE sesiones_clase
       SET estado = 'finalizada', finalizada_at = NOW()
       WHERE docente_materia_id = ? AND estado = 'activa' AND iniciada_por = ?`,
      [docenteMateriaId, req.usuario.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ ok: false, mensaje: 'No hay llamada activa tuya para esta materia.' });
    }

    if (info.length && info[0].grupo_id) {
      await publicarMensajeSistema(info[0].grupo_id, {
        evento: 'videollamada',
        texto: `⏹ La videollamada de ${info[0].materia} ha terminado.`,
      });
    }

    const io = req.app.get('io');
    if (io) {
      io.to(`materia:${docenteMateriaId}`).emit('llamada-finalizada', {
        docente_materia_id: docenteMateriaId,
      });
    }

    return res.json({ ok: true, mensaje: 'Llamada finalizada.' });

  } catch (err) {
    console.error('finalizarLlamada error:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};
