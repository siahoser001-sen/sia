// ============================================================
//  tareas.controller.js — MySQL
//  Asignación de tareas por materia/curso/periodo (tabla `tareas`)
//  y entregas de los estudiantes (tabla `entregas_tareas`, con
//  estado, calificación y feedback del docente).
//
//  Reglas de negocio:
//  - Crear/editar/eliminar una tarea: cualquier co-docente de la
//    materia (en cualquier periodo) o admin/superadmin de la
//    institución.
//  - Ver las tareas de una materia: además de lo anterior, el
//    docente director del curso al que pertenece (aunque no la
//    dicte) — mismo criterio de vista que el plan de evaluación.
//  - Un estudiante ve y entrega sus propias tareas: listar sus
//    tareas y registrar su entrega (estado `entregada`/`tarde`
//    según la fecha límite).
//  - Revisar/calificar una entrega: el co-docente de la materia o
//    admin/superadmin. El director puede verlas pero no calificar
//    (mismo criterio que guardar una celda en la hoja).
// ============================================================

const pool = require('../config/db');
const { randomUUID } = require('crypto');
const { crearNotificacion, crearNotificacionLote } = require('../services/notificacion.service');

// Trae la materia + su grupo_id + institucion_id, o null si no existe.
async function _datosMateria(materiaId) {
  const [rows] = await pool.query(
    `SELECT m.id, m.grupo_id, gr.institucion_id
     FROM materias m
     JOIN grados gr ON gr.id = m.grado_id
     WHERE m.id = ?`,
    [materiaId]
  );
  return rows.length ? rows[0] : null;
}

// Ver tareas de una materia: co-docente (cualquier periodo), el
// director del curso aunque no la dicte, o admin/superadmin.
async function _puedeVerTareas(req, materia) {
  if (!materia) return false;
  if (req.usuario.rol === 'superadmin') return true;
  if (req.usuario.rol === 'admin') return materia.institucion_id === req.usuario.institucion_id;
  if (req.usuario.rol === 'docente') {
    const [dicta] = await pool.query(
      `SELECT 1 FROM docentes_materias WHERE materia_id = ? AND docente_id = ? LIMIT 1`,
      [materia.id, req.usuario.id]
    );
    if (dicta.length > 0) return true;
    const [director] = await pool.query(
      `SELECT 1 FROM grupos WHERE id = ? AND director_id = ? LIMIT 1`,
      [materia.grupo_id, req.usuario.id]
    );
    return director.length > 0;
  }
  return false;
}

// Gestionar tareas (crear/editar/eliminar), calificar entregas:
// co-docente de la materia (cualquier periodo) o admin/superadmin.
async function _puedeGestionar(req, materia) {
  if (!materia) return false;
  if (req.usuario.rol === 'superadmin') return true;
  if (req.usuario.rol === 'admin') return materia.institucion_id === req.usuario.institucion_id;
  if (req.usuario.rol === 'docente') {
    const [rows] = await pool.query(
      `SELECT 1 FROM docentes_materias WHERE materia_id = ? AND docente_id = ? LIMIT 1`,
      [materia.id, req.usuario.id]
    );
    return rows.length > 0;
  }
  return false;
}

// Verifica que la materia exista y pertenezca a la institución del
// usuario (o que sea superadmin).
async function _materiaDeLaInstitucion(req, materiaId) {
  const materia = await _datosMateria(materiaId);
  if (!materia) return null;
  if (req.usuario.rol !== 'superadmin' && materia.institucion_id !== req.usuario.institucion_id) return null;
  return materia;
}

// Mismo criterio de "periodo activo" que el resto del sistema.
async function _resolverPeriodoId(periodoIdRecibido, institucionId) {
  if (periodoIdRecibido) return periodoIdRecibido;
  const [rows] = await pool.query(
    `SELECT id FROM periodos_academicos WHERE institucion_id = ? AND activo = TRUE LIMIT 1`,
    [institucionId]
  );
  return rows.length ? rows[0].id : null;
}

// ────────────────────────────────────────────────────────────
//  GET /api/tareas/materia/:materiaId?periodo_id=
//  Tareas de una materia (para el modal de un docente/director).
// ────────────────────────────────────────────────────────────
exports.listarPorMateria = async (req, res) => {
  const { materiaId } = req.params;
  try {
    const materia = await _materiaDeLaInstitucion(req, materiaId);
    if (!materia) return res.status(404).json({ ok: false, mensaje: 'Materia no encontrada.' });
    if (!(await _puedeVerTareas(req, materia))) {
      return res.status(403).json({ ok: false, mensaje: 'No tienes permiso para ver las tareas de esta materia.' });
    }
    const periodoId = await _resolverPeriodoId(req.query.periodo_id, materia.institucion_id);
    if (!periodoId) {
      return res.status(409).json({ ok: false, mensaje: 'No hay ningún periodo académico activo ni creado. Pide al administrador que cree uno.' });
    }

    const [tareas] = await pool.query(
      `SELECT t.id, t.titulo, t.descripcion, t.fecha_asig, t.fecha_entrega, t.valor_max,
              (SELECT COUNT(*) FROM entregas_tareas e WHERE e.tarea_id = t.id AND e.estado <> 'pendiente') AS con_entrega,
              (SELECT COUNT(*) FROM entregas_tareas e WHERE e.tarea_id = t.id) AS total_entregas
       FROM tareas t
       WHERE t.materia_id = ? AND t.periodo_id = ?
       ORDER BY t.fecha_entrega ASC, t.created_at ASC`,
      [materiaId, periodoId]
    );

    return res.json({ ok: true, periodo_id: periodoId, tareas });
  } catch (err) {
    console.error('listarPorMateria tareas:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// ────────────────────────────────────────────────────────────
//  POST /api/tareas   { materia_id, titulo, descripcion?, fecha_entrega, valor_max? }
//  `fecha_asig` = hoy. `periodo_id` se resuelve al activo si no llega.
// ────────────────────────────────────────────────────────────
exports.crear = async (req, res) => {
  const { materia_id, titulo, descripcion, fecha_entrega, valor_max } = req.body;
  let { periodo_id } = req.body;
  if (!materia_id || !titulo || !fecha_entrega) {
    return res.status(400).json({ ok: false, mensaje: 'materia_id, titulo y fecha_entrega son obligatorios.' });
  }

  try {
    const materia = await _materiaDeLaInstitucion(req, materia_id);
    if (!materia) return res.status(404).json({ ok: false, mensaje: 'Materia no encontrada.' });
    if (!(await _puedeGestionar(req, materia))) {
      return res.status(403).json({ ok: false, mensaje: 'No tienes permiso para asignar tareas en esta materia.' });
    }

    if (new Date(fecha_entrega) < new Date(new Date().toDateString())) {
      return res.status(400).json({ ok: false, mensaje: 'La fecha de entrega no puede ser anterior a hoy.' });
    }

    periodo_id = await _resolverPeriodoId(periodo_id, materia.institucion_id);
    if (!periodo_id) {
      return res.status(409).json({ ok: false, mensaje: 'No hay ningún periodo académico activo ni creado. Pide al administrador que cree uno.' });
    }

    const id = randomUUID();
    await pool.query(
      `INSERT INTO tareas (id, docente_id, materia_id, grupo_id, periodo_id, titulo, descripcion, valor_max, fecha_entrega)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, req.usuario.id, materia_id, materia.grupo_id, periodo_id,
        titulo.trim(), descripcion || null,
        valor_max != null ? Number(valor_max) : 10.0,
        fecha_entrega,
      ]
    );

    // Aviso a los estudiantes matriculados activos del grupo (punto 6).
    const [destinatarios] = await pool.query(
      `SELECT estudiante_id AS id
       FROM matriculas
       WHERE grupo_id = ? AND estado = 'activa'`,
      [materia.grupo_id]
    );
    const [instRows] = await pool.query(
      `SELECT nombre FROM instituciones WHERE id = ? LIMIT 1`,
      [materia.institucion_id]
    );
    const fechaEntregaTxt = new Date(fecha_entrega + 'T00:00:00').toLocaleDateString('es-CO');
    await crearNotificacionLote({
      destinatarios: destinatarios.map(r => r.id),
      tipo:          'tarea_asignada',
      titulo:        `Nueva tarea: ${titulo.trim()}`,
      mensaje:       `Se asignó la tarea "${titulo.trim()}" en #nombreinstitucion. Entrégala antes del ${fechaEntregaTxt}.`,
      ref_id:        id,
      ref_tabla:     'tareas',
      institucion_nombre: instRows[0]?.nombre || null,
    });

    // La tarjeta "Mis tareas" del estudiante se refresca en vivo (punto 4).
    const io = req.app.get('io');
    if (io) for (const est of destinatarios) io.to(`usuario:${est.id}`).emit('tareas:update', { tarea_id: id });

    return res.status(201).json({ ok: true, mensaje: 'Tarea asignada.', id, periodo_id });
  } catch (err) {
    console.error('crear tareas:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// ────────────────────────────────────────────────────────────
//  PUT /api/tareas/:id   { titulo?, descripcion?, fecha_entrega?, valor_max? }
// ────────────────────────────────────────────────────────────
exports.actualizar = async (req, res) => {
  const { id } = req.params;
  const { titulo, descripcion, fecha_entrega, valor_max } = req.body;
  try {
    const [tarRows] = await pool.query(`SELECT * FROM tareas WHERE id = ?`, [id]);
    if (!tarRows.length) return res.status(404).json({ ok: false, mensaje: 'Tarea no encontrada.' });
    const tarea = tarRows[0];

    const materia = await _materiaDeLaInstitucion(req, tarea.materia_id);
    if (!materia || !(await _puedeGestionar(req, materia))) {
      return res.status(403).json({ ok: false, mensaje: 'No tienes permiso para editar esta tarea.' });
    }

    if (fecha_entrega !== undefined && new Date(fecha_entrega) < new Date(new Date().toDateString())) {
      return res.status(400).json({ ok: false, mensaje: 'La fecha de entrega no puede ser anterior a hoy.' });
    }

    await pool.query(
      `UPDATE tareas
       SET titulo = COALESCE(?, titulo),
           descripcion = COALESCE(?, descripcion),
           fecha_entrega = COALESCE(?, fecha_entrega),
           valor_max = COALESCE(?, valor_max)
       WHERE id = ?`,
      [
        titulo !== undefined ? titulo.trim() : null,
        descripcion !== undefined ? descripcion : null,
        fecha_entrega || null,
        valor_max !== undefined ? Number(valor_max) : null,
        id,
      ]
    );
    return res.json({ ok: true, mensaje: 'Tarea actualizada.' });
  } catch (err) {
    console.error('actualizar tareas:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// ────────────────────────────────────────────────────────────
//  DELETE /api/tareas/:id
// ────────────────────────────────────────────────────────────
exports.eliminar = async (req, res) => {
  const { id } = req.params;
  try {
    const [tarRows] = await pool.query(`SELECT * FROM tareas WHERE id = ?`, [id]);
    if (!tarRows.length) return res.status(404).json({ ok: false, mensaje: 'Tarea no encontrada.' });
    const tarea = tarRows[0];

    const materia = await _materiaDeLaInstitucion(req, tarea.materia_id);
    if (!materia || !(await _puedeGestionar(req, materia))) {
      return res.status(403).json({ ok: false, mensaje: 'No tienes permiso para eliminar esta tarea.' });
    }

    await pool.query(`DELETE FROM tareas WHERE id = ?`, [id]);
    return res.json({ ok: true, mensaje: 'Tarea eliminada.' });
  } catch (err) {
    console.error('eliminar tareas:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// ────────────────────────────────────────────────────────────
//  GET /api/tareas/estudiante
//  Tareas de las materias del grupo del estudiante, con su entrega
//  (estado, nota, feedback). El grupo activo del estudiante se
//  resuelve igual que en resumen.controller.js.
// ────────────────────────────────────────────────────────────
exports.listarPorEstudiante = async (req, res) => {
  const estudianteId = req.usuario.id;
  try {
    const [matriculas] = await pool.query(
      `SELECT grupo_id FROM matriculas WHERE estudiante_id = ? AND estado = 'activa' LIMIT 1`,
      [estudianteId]
    );
    if (!matriculas.length) return res.json({ ok: true, tareas: [] });
    const grupoId = matriculas[0].grupo_id;

    const [tareas] = await pool.query(
      `SELECT t.id, t.materia_id, m.nombre AS materia, t.titulo, t.descripcion,
              t.fecha_asig, t.fecha_entrega, t.valor_max,
              e.id AS entrega_id, e.estado, e.calificacion, e.feedback_doc, e.fecha_entrega AS fec_entrega
       FROM tareas t
       JOIN materias m ON m.id = t.materia_id
       LEFT JOIN entregas_tareas e ON e.tarea_id = t.id AND e.estudiante_id = ?
       WHERE t.grupo_id = ?
       ORDER BY t.fecha_entrega ASC, t.created_at ASC`,
      [estudianteId, grupoId]
    );

    return res.json({ ok: true, tareas });
  } catch (err) {
    console.error('listarPorEstudiante tareas:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// ────────────────────────────────────────────────────────────
//  POST /api/tareas/:id/entrega   { comentario? }
//  El estudiante marca entregada su tarea (si ya pasó la fecha
//  límite, queda como `tarde`). Idempotente: upsert por
//  (tarea_id, estudiante_id).
// ────────────────────────────────────────────────────────────
exports.entregar = async (req, res) => {
  const { id } = req.params;
  const { comentario } = req.body;
  try {
    const [tarRows] = await pool.query(`SELECT * FROM tareas WHERE id = ?`, [id]);
    if (!tarRows.length) return res.status(404).json({ ok: false, mensaje: 'Tarea no encontrada.' });
    const tarea = tarRows[0];

    const [matriculas] = await pool.query(
      `SELECT 1 FROM matriculas WHERE estudiante_id = ? AND grupo_id = ? AND estado = 'activa'`,
      [req.usuario.id, tarea.grupo_id]
    );
    if (!matriculas.length) {
      return res.status(403).json({ ok: false, mensaje: 'No estás matriculado activo en el curso de esta tarea.' });
    }

    const ahora = new Date();
    const limite = new Date(tarea.fecha_entrega + 'T23:59:59');
    const estado = ahora > limite ? 'tarde' : 'entregada';

    await pool.query(
      `INSERT INTO entregas_tareas (id, tarea_id, estudiante_id, comentario, estado, fecha_entrega)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE comentario = VALUES(comentario),
         estado = IF(estado = 'calificada', estado, VALUES(estado)),
         fecha_entrega = VALUES(fecha_entrega)`,
      [randomUUID(), id, req.usuario.id, comentario || null, estado, ahora]
    );

    return res.json({ ok: true, mensaje: 'Tarea entregada.', estado });
  } catch (err) {
    console.error('entregar tareas:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// ────────────────────────────────────────────────────────────
//  GET /api/tareas/:id/entregas
//  Entregas de una tarea + lista de estudiantes del curso (para el
//  docente ver quién no ha entregado). Acceso: ver tareas.
// ────────────────────────────────────────────────────────────
exports.listarEntregas = async (req, res) => {
  const { id } = req.params;
  try {
    const [tarRows] = await pool.query(`SELECT * FROM tareas WHERE id = ?`, [id]);
    if (!tarRows.length) return res.status(404).json({ ok: false, mensaje: 'Tarea no encontrada.' });
    const tarea = tarRows[0];

    const materia = await _materiaDeLaInstitucion(req, tarea.materia_id);
    if (!materia || !(await _puedeVerTareas(req, materia))) {
      return res.status(403).json({ ok: false, mensaje: 'No tienes permiso para ver las entregas de esta tarea.' });
    }

    const [estudiantes] = await pool.query(
      `SELECT u.id, u.nombres, u.apellidos
       FROM matriculas mt JOIN usuarios u ON u.id = mt.estudiante_id
       WHERE mt.grupo_id = ? AND mt.estado = 'activa'
       ORDER BY u.apellidos, u.nombres`,
      [tarea.grupo_id]
    );

    const [entregas] = await pool.query(
      `SELECT e.estudiante_id, e.estado, e.calificacion, e.feedback_doc, e.comentario, e.fecha_entrega
       FROM entregas_tareas e
       WHERE e.tarea_id = ?`,
      [id]
    );
    const mapa = {};
    for (const en of entregas) mapa[en.estudiante_id] = en;

    const filas = estudiantes.map(e => {
      const d = mapa[e.id] || {};
      return {
        estudiante_id: e.id,
        nombres: e.nombres,
        apellidos: e.apellidos,
        estado: d.estado || 'pendiente',
        calificacion: d.calificacion ?? null,
        feedback_doc: d.feedback_doc ?? null,
        comentario: d.comentario ?? null,
        fecha_entrega: d.fecha_entrega ?? null,
      };
    });

    return res.json({ ok: true, tarea, filas });
  } catch (err) {
    console.error('listarEntregas tareas:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// ────────────────────────────────────────────────────────────
//  PUT /api/tareas/entrega/:id   { estudiante_id, calificacion?, feedback_doc? }
//  El docente revisa la entrega de un estudiante: pone nota y
//  feedback y marca la entrega como `calificada`. Acceso: gestionar.
// ────────────────────────────────────────────────────────────
exports.calificarEntrega = async (req, res) => {
  const { id } = req.params;
  const { estudiante_id, calificacion, feedback_doc } = req.body;
  try {
    const [tarRows] = await pool.query(`SELECT * FROM tareas WHERE id = ?`, [id]);
    if (!tarRows.length) return res.status(404).json({ ok: false, mensaje: 'Tarea no encontrada.' });
    const tarea = tarRows[0];

    const materia = await _materiaDeLaInstitucion(req, tarea.materia_id);
    if (!materia || !(await _puedeGestionar(req, materia))) {
      return res.status(403).json({ ok: false, mensaje: 'No tienes permiso para calificar esta tarea.' });
    }
    if (!estudiante_id) {
      return res.status(400).json({ ok: false, mensaje: 'Falta el estudiante.' });
    }

    if (calificacion !== null && calificacion !== undefined) {
      const v = Number(calificacion);
      if (Number.isNaN(v) || v < 0 || v > Number(tarea.valor_max)) {
        return res.status(400).json({ ok: false, mensaje: `La calificación debe estar entre 0 y ${tarea.valor_max}.` });
      }
    }

    await pool.query(
      `INSERT INTO entregas_tareas (id, tarea_id, estudiante_id, estado, calificacion, feedback_doc, fecha_entrega)
       VALUES (?, ?, ?, 'calificada', ?, ?, NULL)
       ON DUPLICATE KEY UPDATE estado = 'calificada', calificacion = COALESCE(?, calificacion), feedback_doc = ?`,
      [
        randomUUID(), id, estudiante_id,
        calificacion !== null && calificacion !== undefined ? Number(calificacion) : null,
        feedback_doc || null,
        calificacion !== null && calificacion !== undefined ? Number(calificacion) : null,
        feedback_doc || null,
      ]
    );

    // Aviso al estudiante de que su entrega fue calificada (punto 6).
    const nota = calificacion !== null && calificacion !== undefined ? Number(calificacion) : null;
    const notaTxt = nota !== null ? ` con calificación de ${nota} sobre ${tarea.valor_max}` : '';

    await crearNotificacion({
      destinatario: estudiante_id,
      tipo:          'entrega_calificada',
      titulo:        `Tu entrega fue calificada: ${tarea.titulo}`,
      mensaje:       `Calificaron tu entrega de "${tarea.titulo}"${notaTxt}.`,
      ref_id:        id,
      ref_tabla:     'entregas_tareas',
    });

    // La tarjeta "Mis tareas" del estudiante se refresca en vivo (punto 4).
    const io = req.app.get('io');
    if (io) io.to(`usuario:${estudiante_id}`).emit('tareas:update', { tarea_id: id });

    return res.json({ ok: true, mensaje: 'Entrega calificada.' });
  } catch (err) {
    console.error('calificarEntrega tareas:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};
