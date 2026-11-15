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
//  - Ver tareas, entregas y calificar: docente asignado a la materia
//    en el curso de la actividad, o admin/superadmin.
//  - Un estudiante ve y entrega sus propias tareas: listar sus
//    tareas y registrar su entrega (estado `entregada`/`tarde`
//    según la fecha límite).
// ============================================================

const pool = require('../config/db');
const { randomUUID } = require('crypto');
const { crearNotificacion, crearNotificacionLote } = require('../services/notificacion.service');
const { notificarReporte } = require('../services/reporte-update.service');
const { publicarMensajeSistema } = require('../services/chat-curso.service'); // Ronda F (F5)
const {
  materiaPerteneceAlGrupo,
  docenteAsignadoEnGrupo,
  gruposDocenteMateria,
} = require('../utils/materias-curso.util');
const {
  archivosPorEstudianteGrupo,
  archivosPorTarea,
} = require('../utils/tareas-entrega.util');

// Trae la materia + su grupo_id + institucion_id, o null si no existe.
// OJO: las materias GENERALES (Ronda E) tienen grado_id NULL, por eso se
// usa materias.institucion_id en vez del JOIN con grados — si no, crear
// tareas sobre una materia general devolvía 404 "Materia no encontrada".
async function _datosMateria(materiaId) {
  const [rows] = await pool.query(
    `SELECT m.id, m.nombre, m.grupo_id, m.institucion_id
     FROM materias m
     WHERE m.id = ?`,
    [materiaId]
  );
  return rows.length ? rows[0] : null;
}

// Ver y gestionar tareas exige asignación docente en el curso de la tarea.
async function _puedeVerTareas(req, materia, grupoId = null) {
  if (!materia) return false;
  if (grupoId && !(await materiaPerteneceAlGrupo(pool, materia.id, grupoId))) return false;
  if (req.usuario.rol === 'superadmin') return true;
  if (req.usuario.rol === 'admin') return materia.institucion_id === req.usuario.institucion_id;
  if (req.usuario.rol === 'docente') {
    if (grupoId) return docenteAsignadoEnGrupo(pool, materia.id, req.usuario.id, grupoId);
    return (await gruposDocenteMateria(pool, materia.id, req.usuario.id)).length > 0;
  }
  return false;
}

async function _puedeGestionar(req, materia, grupoId = null) {
  return _puedeVerTareas(req, materia, grupoId);
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

// ── Ciclo lectivo / límites (D6) ─────────────────────────────
// Normaliza un DATE de MySQL (Date o string) a 'YYYY-MM-DD'.
function _soloFecha(valor) {
  if (!valor) return null;
  if (valor instanceof Date) return valor.toISOString().slice(0, 10);
  return String(valor).slice(0, 10);
}
function _hoyISO() { return new Date().toISOString().slice(0, 10); }

// Periodo con sus fechas (para saber si está abierto).
async function _obtenerPeriodo(periodoId) {
  const [rows] = await pool.query(
    `SELECT id, nombre, anio_lectivo, fecha_inicio, fecha_fin
     FROM periodos_academicos WHERE id = ? LIMIT 1`,
    [periodoId]
  );
  return rows.length ? rows[0] : null;
}
function _periodoAbierto(periodo, hoyISO) {
  if (!periodo) return false;
  return hoyISO >= _soloFecha(periodo.fecha_inicio) && hoyISO <= _soloFecha(periodo.fecha_fin);
}

// Publica automáticamente los borradores cuyo periodo ya abrió y avisa a
// los estudiantes del curso (mismo mensaje que al asignar una tarea).
async function _promoverBorradores(institucionId) {
  const hoy = _hoyISO();
  const [rows] = await pool.query(
    `SELECT t.id, t.titulo, t.grupo_id, t.fecha_entrega
     FROM tareas t
     JOIN materias m ON m.id = t.materia_id
     JOIN grados gr  ON gr.id = m.grado_id
     JOIN periodos_academicos p ON p.id = t.periodo_id
     WHERE t.estado = 'borrador' AND gr.institucion_id = ?
       AND ? BETWEEN p.fecha_inicio AND p.fecha_fin`,
    [institucionId, hoy]
  );
  if (!rows.length) return;

  const ids = rows.map(r => r.id);
  await pool.query(
    `UPDATE tareas SET estado = 'publicada' WHERE id IN (${ids.map(() => '?').join(',')})`,
    ids
  );

  const [instRows] = await pool.query(`SELECT nombre FROM instituciones WHERE id = ? LIMIT 1`, [institucionId]);
  const instNombre = instRows[0]?.nombre || null;

  for (const t of rows) {
    const [dest] = await pool.query(
      `SELECT estudiante_id AS id FROM matriculas WHERE grupo_id = ? AND estado = 'activa'`,
      [t.grupo_id]
    );
    if (!dest.length) continue;
    const fechaTxt = new Date(_soloFecha(t.fecha_entrega) + 'T00:00:00').toLocaleDateString('es-CO');
    await crearNotificacionLote({
      destinatarios: dest.map(d => d.id),
      tipo: 'tarea_asignada',
      titulo: `Nueva tarea: ${t.titulo}`,
      mensaje: `Se asignó la tarea "${t.titulo}" en #nombreinstitucion. Entrégala antes del ${fechaTxt}.`,
      ref_id: t.id, ref_tabla: 'tareas', institucion_nombre: instNombre,
    });
  }
}

// ────────────────────────────────────────────────────────────
//  GET /api/tareas/materia/:materiaId?periodo_id=
//  Tareas de una materia (para el modal del docente asignado).
// ────────────────────────────────────────────────────────────
exports.listarPorMateria = async (req, res) => {
  const { materiaId } = req.params;
  let grupoId = req.query.grupo_id || null;
  try {
    const materia = await _materiaDeLaInstitucion(req, materiaId);
    if (!materia) return res.status(404).json({ ok: false, mensaje: 'Materia no encontrada.' });
    grupoId = grupoId || materia.grupo_id || null;
    if (!grupoId && req.usuario.rol === 'docente') {
      const grupos = await gruposDocenteMateria(pool, materia.id, req.usuario.id);
      if (grupos.length > 1) {
        return res.status(400).json({ ok: false, mensaje: 'Indica el curso para consultar las tareas de esta materia.' });
      }
      grupoId = grupos[0] || null;
    }
    if (!(await _puedeVerTareas(req, materia, grupoId))) {
      return res.status(403).json({ ok: false, mensaje: 'No tienes permiso para ver las tareas de esta materia.' });
    }
    await _promoverBorradores(materia.institucion_id);
    const periodoId = await _resolverPeriodoId(req.query.periodo_id, materia.institucion_id);
    if (!periodoId) {
      return res.status(409).json({ ok: false, mensaje: 'No hay ningún periodo académico activo ni creado. Pide al administrador que cree uno.' });
    }

    const [tareas] = await pool.query(
      `SELECT t.id, t.titulo, t.descripcion, t.fecha_asig, t.fecha_entrega, t.valor_max, t.estado,
              (SELECT COUNT(*) FROM entregas_tareas e WHERE e.tarea_id = t.id AND e.estado <> 'pendiente') AS con_entrega,
              (SELECT COUNT(*) FROM entregas_tareas e WHERE e.tarea_id = t.id) AS total_entregas
       FROM tareas t
       WHERE t.materia_id = ? AND t.periodo_id = ? ${grupoId ? 'AND t.grupo_id = ?' : ''}
       ORDER BY t.fecha_entrega ASC, t.created_at ASC`,
      grupoId ? [materiaId, periodoId, grupoId] : [materiaId, periodoId]
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
  const grupo_body = req.body.grupo_id || null;
  let { periodo_id } = req.body;
  if (!materia_id || !titulo || !fecha_entrega) {
    return res.status(400).json({ ok: false, mensaje: 'materia_id, titulo y fecha_entrega son obligatorios.' });
  }

  try {
    const materia = await _materiaDeLaInstitucion(req, materia_id);
    if (!materia) return res.status(404).json({ ok: false, mensaje: 'Materia no encontrada.' });

    if (new Date(fecha_entrega) < new Date(new Date().toDateString())) {
      return res.status(400).json({ ok: false, mensaje: 'La fecha de entrega no puede ser anterior a hoy.' });
    }

    periodo_id = await _resolverPeriodoId(periodo_id, materia.institucion_id);
    if (!periodo_id) {
      return res.status(409).json({ ok: false, mensaje: 'No hay ningún periodo académico activo ni creado. Pide al administrador que cree uno.' });
    }

    // Grupo de la actividad. Las materias GENERALES (Ronda E) tienen
    // materias.grupo_id NULL: el grupo se resuelve por la asignación
    // docente↔materia↔curso (docentes_materias.grupo_id).
    let grupoId = grupo_body || materia.grupo_id || null;
    if (materia.grupo_id && grupo_body && materia.grupo_id !== grupo_body) {
      return res.status(400).json({ ok: false, mensaje: 'Esa materia pertenece a otro curso.' });
    }
    if (!grupoId) {
      const grupos = req.usuario.rol === 'docente'
        ? await gruposDocenteMateria(pool, materia_id, req.usuario.id)
        : [];
      if (grupos.length === 1) {
        grupoId = grupos[0];
      } else if (grupos.length > 1) {
        return res.status(400).json({
          ok: false,
          mensaje: 'Esta materia se dicta en varios cursos. Indica a qué curso pertenece la actividad.',
        });
      } else {
        return res.status(400).json({ ok: false, mensaje: 'No dictas esta materia en ningún curso.' });
      }
    }
    if (!(await _puedeGestionar(req, materia, grupoId))) {
      return res.status(403).json({ ok: false, mensaje: 'No tienes permiso para asignar tareas en esta materia.' });
    }

    const periodo = await _obtenerPeriodo(periodo_id);
    if (!periodo) {
      return res.status(404).json({ ok: false, mensaje: 'Periodo académico no encontrado.' });
    }
    // Si el periodo no está abierto HOY, la tarea queda como borrador (D6).
    const abierta = _periodoAbierto(periodo, _hoyISO());
    const estado  = abierta ? 'publicada' : 'borrador';

    const id = randomUUID();
    await pool.query(
      `INSERT INTO tareas (id, docente_id, materia_id, grupo_id, periodo_id, titulo, descripcion, valor_max, fecha_entrega, estado)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, req.usuario.id, materia_id, grupoId, periodo_id,
        titulo.trim(), descripcion || null,
        valor_max != null ? Number(valor_max) : 10.0,
        fecha_entrega, estado,
      ]
    );

    // Solo se avisa (y se muestra al estudiante) si la tarea nace publicada.
    if (abierta) {
      const [destinatarios] = await pool.query(
        `SELECT estudiante_id AS id
         FROM matriculas
         WHERE grupo_id = ? AND estado = 'activa'`,
        [grupoId]
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

      // Chat del curso (Ronda F, F5): el sistema avisa de la actividad creada.
      if (grupoId) {
        await publicarMensajeSistema(grupoId, {
          evento: 'actividad_creada',
          texto: `📋 Nueva actividad de ${materia.nombre}: "${titulo.trim()}". Fecha de entrega: ${fechaEntregaTxt}.`,
        });
      }
    }

    return res.status(201).json({
      ok: true,
      mensaje: abierta
        ? 'Tarea asignada.'
        : 'Tarea guardada como borrador: el periodo no está abierto. Se publicará al abrirlo (o publícala ya con el botón Publicar).',
      id,
      periodo_id,
      estado,
    });
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
    if (!materia || !(await _puedeGestionar(req, materia, tarea.grupo_id))) {
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
    if (!materia || !(await _puedeGestionar(req, materia, tarea.grupo_id))) {
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
//  PUT /api/tareas/:id/publicar
//  Publica manualmente un borrador (antes de que abra el periodo)
//  y avisa a los estudiantes del curso.
// ────────────────────────────────────────────────────────────
exports.publicar = async (req, res) => {
  const { id } = req.params;
  try {
    const [tarRows] = await pool.query(`SELECT * FROM tareas WHERE id = ?`, [id]);
    if (!tarRows.length) return res.status(404).json({ ok: false, mensaje: 'Tarea no encontrada.' });
    const tarea = tarRows[0];

    const materia = await _materiaDeLaInstitucion(req, tarea.materia_id);
    if (!materia || !(await _puedeGestionar(req, materia, tarea.grupo_id))) {
      return res.status(403).json({ ok: false, mensaje: 'No tienes permiso para publicar esta tarea.' });
    }

    if (tarea.estado === 'publicada') {
      return res.json({ ok: true, mensaje: 'La tarea ya estaba publicada.', estado: 'publicada' });
    }

    await pool.query(`UPDATE tareas SET estado = 'publicada' WHERE id = ?`, [id]);

    const [destinatarios] = await pool.query(
      `SELECT estudiante_id AS id FROM matriculas WHERE grupo_id = ? AND estado = 'activa'`,
      [tarea.grupo_id]
    );
    const [instRows] = await pool.query(
      `SELECT nombre FROM instituciones WHERE id = ? LIMIT 1`,
      [materia.institucion_id]
    );
    const fechaEntregaTxt = new Date(_soloFecha(tarea.fecha_entrega) + 'T00:00:00').toLocaleDateString('es-CO');
    await crearNotificacionLote({
      destinatarios: destinatarios.map(r => r.id),
      tipo:          'tarea_asignada',
      titulo:        `Nueva tarea: ${tarea.titulo}`,
      mensaje:       `Se asignó la tarea "${tarea.titulo}" en #nombreinstitucion. Entrégala antes del ${fechaEntregaTxt}.`,
      ref_id:        id,
      ref_tabla:     'tareas',
      institucion_nombre: instRows[0]?.nombre || null,
    });

    const io = req.app.get('io');
    if (io) for (const est of destinatarios) io.to(`usuario:${est.id}`).emit('tareas:update', { tarea_id: id });

    // Chat del curso (Ronda F, F5): el sistema avisa que la actividad se publicó.
    if (tarea.grupo_id) {
      await publicarMensajeSistema(tarea.grupo_id, {
        evento: 'actividad_creada',
        texto: `📋 Actividad publicada de ${materia.nombre}: "${tarea.titulo}". Fecha de entrega: ${fechaEntregaTxt}.`,
      });
    }

    return res.json({ ok: true, mensaje: 'Tarea publicada.', estado: 'publicada' });
  } catch (err) {
    console.error('publicar tarea:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// ────────────────────────────────────────────────────────────
//  GET /api/tareas/estudiante?materia=<id>
//  Tareas de las materias del grupo del estudiante, con su entrega
//  (estado propio, nota, feedback y archivos subidos). El grupo
//  activo del estudiante se resuelve igual que en resumen.controller.js.
// ────────────────────────────────────────────────────────────
exports.listarPorEstudiante = async (req, res) => {
  const estudianteId = req.usuario.id;
  const materiaFiltro = req.query.materia || null;
  try {
    const [matriculas] = await pool.query(
      `SELECT grupo_id FROM matriculas WHERE estudiante_id = ? AND estado = 'activa' LIMIT 1`,
      [estudianteId]
    );
    if (!matriculas.length) return res.json({ ok: true, tareas: [] });
    const grupoId = matriculas[0].grupo_id;

    // Publica los borradores cuyo periodo ya abrió (D6).
    await _promoverBorradores(req.usuario.institucion_id);

    const filtroMateria = materiaFiltro ? 'AND t.materia_id = ?' : '';
    const params = materiaFiltro
      ? [estudianteId, grupoId, materiaFiltro]
      : [estudianteId, grupoId];

    const [tareas] = await pool.query(
      `SELECT t.id, t.materia_id, m.nombre AS materia, t.titulo, t.descripcion,
              t.fecha_asig, t.fecha_entrega, t.fecha_entrega AS fecha_limite,
              t.valor_max, t.estado AS tarea_estado,
              e.id AS entrega_id, COALESCE(e.estado, 'pendiente') AS estado,
              e.calificacion, e.calificacion AS nota,
              e.feedback_doc, e.feedback_doc AS feedback,
              e.comentario, e.fecha_entrega AS fec_entrega
       FROM tareas t
       JOIN materias m ON m.id = t.materia_id
       LEFT JOIN entregas_tareas e ON e.tarea_id = t.id AND e.estudiante_id = ?
       WHERE t.grupo_id = ? AND t.estado = 'publicada' ${filtroMateria}
       ORDER BY t.fecha_entrega ASC, t.created_at ASC`,
      params
    );

    const archivosPorTareaMap = await archivosPorEstudianteGrupo(estudianteId, grupoId);
    for (const tarea of tareas) {
      tarea.archivos = archivosPorTareaMap[tarea.id] || [];
    }

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

    // D6: no se entrega si la tarea aún no está publicada o si el periodo cerró.
    const periodo = await _obtenerPeriodo(tarea.periodo_id);
    const hoy = _hoyISO();
    const abierto = _periodoAbierto(periodo, hoy);
    if (tarea.estado !== 'publicada' && !abierto) {
      return res.status(409).json({ ok: false, mensaje: 'Esta tarea todavía no está publicada.' });
    }
    const finPeriodo = periodo ? _soloFecha(periodo.fecha_fin) : null;
    if (finPeriodo && hoy > finPeriodo) {
      return res.status(409).json({ ok: false, mensaje: 'El periodo de esta tarea ya cerró; no se pueden registrar más entregas.' });
    }

    // Una entrega calificada queda inmutable (ni comentario ni estado).
    const [previas] = await pool.query(
      `SELECT estado FROM entregas_tareas WHERE tarea_id = ? AND estudiante_id = ? LIMIT 1`,
      [id, req.usuario.id]
    );
    if (previas.length && previas[0].estado === 'calificada') {
      return res.status(409).json({ ok: false, mensaje: 'La entrega ya está calificada; no se puede modificar.' });
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
    if (!materia || !(await _puedeVerTareas(req, materia, tarea.grupo_id))) {
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
    const archivosMapa = await archivosPorTarea(id);

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
        archivos: archivosMapa[e.id] || [],
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
    if (!materia || !(await _puedeGestionar(req, materia, tarea.grupo_id))) {
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

    // La calificación de una entrega también aparece en el reporte.
    await notificarReporte(io, estudiante_id, { motivo: 'entrega', ref_id: id });

    return res.json({ ok: true, mensaje: 'Entrega calificada.' });
  } catch (err) {
    console.error('calificarEntrega tareas:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};
