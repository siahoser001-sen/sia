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
const path = require('path');
const fs = require('fs');
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
  normalizarFechaHora,
  fechaLimitePasada,
  soloFecha,
  hoyISO,
  obtenerPeriodo,
  periodoAbierto,
  estudianteMatriculado,
  puedeVerEntregas,
  limpiarArchivosTemporales,
} = require('../utils/tareas-entrega.util');

const RAIZ_ENTREGAS = path.resolve(__dirname, '../../storage_privado/entregas-tareas');

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
    const [director] = await pool.query(
      `SELECT 1 FROM grupos WHERE id = ? AND director_id = ? LIMIT 1`,
      [grupoId, req.usuario.id]
    );
    if (director.length) return true;
    if (grupoId) return docenteAsignadoEnGrupo(pool, materia.id, req.usuario.id, grupoId);
    return (await gruposDocenteMateria(pool, materia.id, req.usuario.id)).length > 0;
  }
  return false;
}

function _valorBooleano(valor, predeterminado) {
  if (valor === undefined || valor === null || valor === '') return predeterminado;
  return valor === true || valor === 1 || valor === '1' || valor === 'true';
}

async function _puedeGestionar(req, materia, grupoId = null) {
  return _puedeVerTareas(req, materia, grupoId);
}

async function emitirActualizacionPlanMateria(io, materiaId, grupoId, datos = {}) {
  if (!io || !materiaId || !grupoId) return;
  const [asignaciones] = await pool.query(
    `SELECT id FROM docentes_materias WHERE materia_id = ? AND grupo_id = ?`,
    [materiaId, grupoId]
  );
  for (const asignacion of asignaciones) {
    io.to(`materia:${asignacion.id}`).emit('plan-evaluacion:update', {
      materia_id: materiaId,
      grupo_id: grupoId,
      ...datos,
    });
  }
}

async function eliminarActividadEnTransaccion(conn, planItemId) {
  const [tareas] = await conn.query(
    `SELECT id, archivo_id FROM tareas WHERE plan_item_id = ? FOR UPDATE`,
    [planItemId]
  );
  const tarea = tareas[0] || null;
  const archivoIds = new Set(tarea?.archivo_id ? [tarea.archivo_id] : []);
  if (tarea) {
    const [entregas] = await conn.query(
      `SELECT archivo_id FROM entregas_tareas
       WHERE tarea_id = ? AND archivo_id IS NOT NULL FOR UPDATE`,
      [tarea.id]
    );
    const [archivosEntrega] = await conn.query(
      `SELECT ea.archivo_id
       FROM entregas_archivos ea
       JOIN entregas_tareas e ON e.id = ea.entrega_id
       WHERE e.tarea_id = ? FOR UPDATE`,
      [tarea.id]
    );
    for (const entrega of entregas) archivoIds.add(entrega.archivo_id);
    for (const archivo of archivosEntrega) archivoIds.add(archivo.archivo_id);
  }

  const ids = [...archivoIds];
  let archivos = [];
  if (ids.length) {
    [archivos] = await conn.query(
      `SELECT id, ruta_storage FROM archivos WHERE id IN (${ids.map(() => '?').join(',')})`,
      ids
    );
  }
  await conn.query(`DELETE FROM notas WHERE plan_item_id = ?`, [planItemId]);
  await conn.query(`DELETE FROM tareas WHERE plan_item_id = ?`, [planItemId]);
  if (ids.length) {
    await conn.query(
      `DELETE FROM archivos WHERE id IN (${ids.map(() => '?').join(',')})`,
      ids
    );
  }
  await conn.query(`DELETE FROM plan_evaluacion_items WHERE id = ?`, [planItemId]);
  return archivos.map(archivo => archivo.ruta_storage).filter(Boolean);
}

async function limpiarArchivosBorrados(rutas) {
  for (const rutaStorage of rutas) {
    const ruta = path.resolve(__dirname, '../..', rutaStorage);
    if (!ruta.startsWith(`${RAIZ_ENTREGAS}${path.sep}`)) {
      throw new Error('La ruta de un archivo asociado está fuera del almacenamiento de entregas.');
    }
    try {
      await fs.promises.unlink(ruta);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.error('No se pudo borrar un archivo de actividad:', err.message);
        throw new Error('No se pudieron eliminar todos los archivos asociados a la actividad.');
      }
    }
  }
}

exports.emitirActualizacionPlanMateria = emitirActualizacionPlanMateria;
exports.eliminarActividadEnTransaccion = eliminarActividadEnTransaccion;
exports.limpiarArchivosBorrados = limpiarArchivosBorrados;

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
// Las reglas de fecha/periodo viven en tareas-entrega.util.js
// (soloFecha, hoyISO, obtenerPeriodo, periodoAbierto) para no
// duplicarlas entre los controladores de tareas.

// Publica automáticamente los borradores cuyo periodo ya abrió y avisa a
// los estudiantes del curso (mismo mensaje que al asignar una tarea).
async function _promoverBorradores(institucionId) {
  const hoy = hoyISO();
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
    const fechaTxt = new Date(soloFecha(t.fecha_entrega) + 'T00:00:00').toLocaleDateString('es-CO');
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
      `SELECT t.id, t.plan_item_id, t.titulo, t.descripcion, t.fecha_asig,
              DATE_FORMAT(t.fecha_entrega, '%Y-%m-%d %H:%i:%s') AS fecha_entrega,
              t.valor_max, t.estado, t.permitir_tardias, t.recibir_entregas,
              t.archivo_id, a.nombre_original AS archivo_nombre,
              pi.peso_pct,
              (SELECT COUNT(*) FROM entregas_tareas e WHERE e.tarea_id = t.id AND e.estado <> 'pendiente') AS con_entrega,
              (SELECT COUNT(*) FROM entregas_tareas e WHERE e.tarea_id = t.id) AS total_entregas
       FROM tareas t
       LEFT JOIN archivos a ON a.id = t.archivo_id
       LEFT JOIN plan_evaluacion_items pi ON pi.id = t.plan_item_id
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
  const {
    materia_id, titulo, descripcion, fecha_entrega, valor_max,
    plan_item_id, permitir_tardias, recibir_entregas,
  } = req.body;
  const grupo_body = req.body.grupo_id || null;
  let { periodo_id } = req.body;
  if (!materia_id || !titulo || !fecha_entrega || !plan_item_id) {
    await limpiarArchivosTemporales(req.file);
    return res.status(400).json({ ok: false, mensaje: 'Crea la tarea desde una actividad del plan con porcentaje asignado.' });
  }
  const fechaEntrega = normalizarFechaHora(fecha_entrega);
  if (!fechaEntrega) {
    await limpiarArchivosTemporales(req.file);
    return res.status(400).json({ ok: false, mensaje: 'La fecha y hora límite no son válidas.' });
  }

  let conn;
  let archivoGuardado = false;
  try {
    const materia = await _materiaDeLaInstitucion(req, materia_id);
    if (!materia) return res.status(404).json({ ok: false, mensaje: 'Materia no encontrada.' });

    if (fechaLimitePasada(fechaEntrega)) {
      return res.status(400).json({ ok: false, mensaje: 'La fecha y hora límite no pueden estar en el pasado.' });
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

    let planItem = null;
    if (plan_item_id) {
      const [items] = await pool.query(
        `SELECT id, materia_id, periodo_id, nombre, peso_pct FROM plan_evaluacion_items WHERE id = ? LIMIT 1`,
        [plan_item_id]
      );
      if (!items.length || items[0].materia_id !== materia_id || items[0].periodo_id !== periodo_id) {
        return res.status(400).json({ ok: false, mensaje: 'La actividad no pertenece a esta materia y periodo.' });
      }
      planItem = items[0];
      if (planItem.peso_pct === null) {
        return res.status(409).json({ ok: false, mensaje: 'Asigna un porcentaje a esta actividad antes de crear su entrega.' });
      }
      const [tareasVinculadas] = await pool.query(
        `SELECT id FROM tareas WHERE plan_item_id = ? LIMIT 1`,
        [plan_item_id]
      );
      if (tareasVinculadas.length) {
        return res.status(409).json({ ok: false, mensaje: 'Esta actividad ya tiene una tarea creada.' });
      }
    }

    const periodo = await obtenerPeriodo(periodo_id);
    if (!periodo) {
      return res.status(404).json({ ok: false, mensaje: 'Periodo académico no encontrado.' });
    }
    // Si el periodo no está abierto HOY, la tarea queda como borrador (D6).
    const abierta = periodoAbierto(periodo, hoyISO());
    const estado  = abierta ? 'publicada' : 'borrador';
    const tituloActividad = planItem ? planItem.nombre : titulo.trim();

    const id = randomUUID();
    conn = await pool.getConnection();
    await conn.beginTransaction();
    await conn.query(
      `INSERT INTO tareas
         (id, docente_id, materia_id, grupo_id, periodo_id, plan_item_id, titulo, descripcion,
          valor_max, fecha_entrega, estado, permitir_tardias, recibir_entregas)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, req.usuario.id, materia_id, grupoId, periodo_id, plan_item_id || null,
        tituloActividad, descripcion || null,
        valor_max != null ? Number(valor_max) : 10.0,
        fechaEntrega, estado,
        _valorBooleano(permitir_tardias, true),
        _valorBooleano(recibir_entregas, true),
      ]
    );
    if (req.file) {
      const archivoId = randomUUID();
      await conn.query(
        `INSERT INTO archivos
           (id, subido_por, tipo, nombre_original, nombre_storage, ruta_storage,
            mime_type, tamanio_bytes, es_publico, ref_grupo_id, descripcion)
         VALUES (?, ?, 'tarea_entregada', ?, ?, ?, ?, ?, FALSE, ?, ?)`,
        [
          archivoId, req.usuario.id, req.file.originalname, req.file.filename,
          path.relative(path.join(__dirname, '../..'), req.file.path),
          req.file.mimetype, req.file.size, grupoId,
          `Material de la actividad "${tituloActividad}"`,
        ]
      );
      await conn.query(`UPDATE tareas SET archivo_id = ? WHERE id = ?`, [archivoId, id]);
    }
    await conn.commit();
    archivoGuardado = Boolean(req.file);
    await emitirActualizacionPlanMateria(req.app.get('io'), materia_id, grupoId, { tarea_id: id });

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
      const fechaEntregaTxt = new Date(`${fechaEntrega.slice(0, 10)}T00:00:00`).toLocaleDateString('es-CO');
      await crearNotificacionLote({
        destinatarios: destinatarios.map(r => r.id),
        tipo:          'tarea_asignada',
        titulo:        `Nueva tarea: ${tituloActividad}`,
        mensaje:       `Se asignó la tarea "${tituloActividad}" en #nombreinstitucion. Entrégala antes del ${fechaEntregaTxt}.`,
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
          texto: `📋 Nueva actividad de ${materia.nombre}: "${tituloActividad}". Fecha de entrega: ${fechaEntregaTxt}.`,
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
      plan_item_id: planItem?.id || null,
    });
  } catch (err) {
    if (conn) await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY' && plan_item_id) {
      return res.status(409).json({ ok: false, mensaje: 'Esta actividad ya tiene una tarea creada.' });
    }
    console.error('crear tareas:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  } finally {
    if (conn) conn.release();
    if (req.file && !archivoGuardado) await limpiarArchivosTemporales(req.file);
  }
};

// ────────────────────────────────────────────────────────────
//  PUT /api/tareas/:id   { titulo?, descripcion?, fecha_entrega?, valor_max? }
// ────────────────────────────────────────────────────────────
exports.actualizar = async (req, res) => {
  const { id } = req.params;
  const { titulo, descripcion, fecha_entrega, valor_max, permitir_tardias, recibir_entregas } = req.body;
  try {
    const [tarRows] = await pool.query(`SELECT * FROM tareas WHERE id = ?`, [id]);
    if (!tarRows.length) return res.status(404).json({ ok: false, mensaje: 'Tarea no encontrada.' });
    const tarea = tarRows[0];

    const materia = await _materiaDeLaInstitucion(req, tarea.materia_id);
    if (!materia || !(await _puedeGestionar(req, materia, tarea.grupo_id))) {
      return res.status(403).json({ ok: false, mensaje: 'No tienes permiso para editar esta tarea.' });
    }

    const fechaEntrega = fecha_entrega === undefined ? undefined : normalizarFechaHora(fecha_entrega);
    if (fecha_entrega !== undefined && !fechaEntrega) {
      return res.status(400).json({ ok: false, mensaje: 'La fecha y hora límite no son válidas.' });
    }
    if (fechaEntrega && fechaLimitePasada(fechaEntrega)) {
      return res.status(400).json({ ok: false, mensaje: 'La fecha y hora límite no pueden estar en el pasado.' });
    }

    await pool.query(
      `UPDATE tareas
       SET titulo = COALESCE(?, titulo),
           descripcion = COALESCE(?, descripcion),
           fecha_entrega = COALESCE(?, fecha_entrega),
           valor_max = COALESCE(?, valor_max),
           permitir_tardias = COALESCE(?, permitir_tardias),
           recibir_entregas = COALESCE(?, recibir_entregas)
       WHERE id = ?`,
      [
        titulo !== undefined ? titulo.trim() : null,
        descripcion !== undefined ? descripcion : null,
        fechaEntrega || null,
        valor_max !== undefined ? Number(valor_max) : null,
        permitir_tardias !== undefined ? _valorBooleano(permitir_tardias, true) : null,
        recibir_entregas !== undefined ? _valorBooleano(recibir_entregas, true) : null,
        id,
      ]
    );
    await emitirActualizacionPlanMateria(req.app.get('io'), materia.id, tarea.grupo_id, { tarea_id: id });
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

    const archivo = tarea.archivo_id
      ? (await pool.query(`SELECT ruta_storage FROM archivos WHERE id = ? LIMIT 1`, [tarea.archivo_id]))[0][0]
      : null;
    await pool.query(`DELETE FROM tareas WHERE id = ?`, [id]);
    if (tarea.archivo_id) {
      await pool.query(`DELETE FROM archivos WHERE id = ?`, [tarea.archivo_id]);
      if (archivo?.ruta_storage) {
        const ruta = path.resolve(__dirname, '../..', archivo.ruta_storage);
        if (ruta.startsWith(`${RAIZ_ENTREGAS}${path.sep}`)) await limpiarArchivosTemporales({ path: ruta });
      }
    }
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
    const io = req.app.get('io');
    await emitirActualizacionPlanMateria(io, tarea.materia_id, tarea.grupo_id, { tarea_id: id });

    const [destinatarios] = await pool.query(
      `SELECT estudiante_id AS id FROM matriculas WHERE grupo_id = ? AND estado = 'activa'`,
      [tarea.grupo_id]
    );
    const [instRows] = await pool.query(
      `SELECT nombre FROM instituciones WHERE id = ? LIMIT 1`,
      [materia.institucion_id]
    );
    const fechaEntregaTxt = new Date(soloFecha(tarea.fecha_entrega) + 'T00:00:00').toLocaleDateString('es-CO');
    await crearNotificacionLote({
      destinatarios: destinatarios.map(r => r.id),
      tipo:          'tarea_asignada',
      titulo:        `Nueva tarea: ${tarea.titulo}`,
      mensaje:       `Se asignó la tarea "${tarea.titulo}" en #nombreinstitucion. Entrégala antes del ${fechaEntregaTxt}.`,
      ref_id:        id,
      ref_tabla:     'tareas',
      institucion_nombre: instRows[0]?.nombre || null,
    });

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
              t.fecha_asig,
              DATE_FORMAT(t.fecha_entrega, '%Y-%m-%d %H:%i:%s') AS fecha_entrega,
              DATE_FORMAT(t.fecha_entrega, '%Y-%m-%d %H:%i:%s') AS fecha_limite,
              pi.peso_pct,
              t.valor_max, t.estado AS tarea_estado,
              t.permitir_tardias, t.recibir_entregas,
              t.archivo_id AS material_id,
              a.nombre_original AS material_nombre,
              a.mime_type AS material_mime,
              a.tamanio_bytes AS material_tamanio,
              a.created_at AS material_creado,
              e.id AS entrega_id, COALESCE(e.estado, 'pendiente') AS estado,
              COALESCE(e.entrega_tarde, FALSE) AS entrega_tarde,
              e.calificacion, e.calificacion AS nota,
              e.feedback_doc, e.feedback_doc AS feedback,
              e.comentario, e.fecha_entrega AS fec_entrega
       FROM tareas t
       JOIN materias m ON m.id = t.materia_id
       LEFT JOIN plan_evaluacion_items pi ON pi.id = t.plan_item_id
       LEFT JOIN archivos a ON a.id = t.archivo_id
       LEFT JOIN entregas_tareas e ON e.tarea_id = t.id AND e.estudiante_id = ?
       WHERE t.grupo_id = ? AND t.estado = 'publicada' ${filtroMateria}
       ORDER BY t.fecha_entrega ASC, t.created_at ASC`,
      params
    );

    const archivosPorTareaMap = await archivosPorEstudianteGrupo(estudianteId, grupoId);
    for (const tarea of tareas) {
      tarea.archivos = archivosPorTareaMap[tarea.id] || [];
      // Material que subió el docente a la actividad (tareas.archivo_id).
      // console.log temporal: verificar cuántos archivos del profesor devuelve por actividad.
      console.log('[DEBUG listarPorEstudiante] tarea_id=%s material=%s archivos_entrega=%s', tarea.id, tarea.material_id ? 'si' : 'no', Array.isArray(tarea.archivos) ? tarea.archivos.length : 0);
      tarea.material = tarea.material_id
        ? {
            id: tarea.material_id,
            nombre_original: tarea.material_nombre,
            mime_type: tarea.material_mime,
            tamanio_bytes: tarea.material_tamanio,
            creado_en: tarea.material_creado,
            url: `/api/tareas/${tarea.id}/archivo`,
          }
        : null;
      delete tarea.material_id;
      delete tarea.material_nombre;
      delete tarea.material_mime;
      delete tarea.material_tamanio;
      delete tarea.material_creado;
    }

    return res.json({ ok: true, tareas });
  } catch (err) {
    console.error('listarPorEstudiante tareas:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// GET /api/tareas/:id/archivo[?vista=1]
// Material que subió el docente a la actividad. Sin `vista` se
// descarga; con `vista=1` se abre en el navegador. Lo puede ver el
// estudiante matriculado activo en el curso de esa materia, el
// docente asignado/director y admin/superadmin de la institución.
exports.descargarArchivoActividad = async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await pool.query(
      `SELECT t.materia_id, t.grupo_id, t.estado, ar.nombre_original, ar.ruta_storage, ar.mime_type
       FROM tareas t
       JOIN archivos ar ON ar.id = t.archivo_id
       WHERE t.id = ? LIMIT 1`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ ok: false, mensaje: 'Archivo de actividad no encontrado.' });
    const tarea = rows[0];
    if (req.usuario.rol === 'estudiante') {
      if (tarea.estado !== 'publicada') {
        return res.status(404).json({ ok: false, mensaje: 'Archivo de actividad no encontrado.' });
      }
      if (!(await estudianteMatriculado(req.usuario.id, tarea.grupo_id))) {
        return res.status(403).json({ ok: false, mensaje: 'No tienes permiso para ver este archivo.' });
      }
    } else if (!(await puedeVerEntregas(req.usuario, { materia_id: tarea.materia_id, grupo_id: tarea.grupo_id }))) {
      return res.status(403).json({ ok: false, mensaje: 'No tienes permiso para ver este archivo.' });
    }

    const ruta = path.resolve(__dirname, '../..', tarea.ruta_storage);
    if (!ruta.startsWith(`${RAIZ_ENTREGAS}${path.sep}`)) {
      console.error('Ruta del material de actividad fuera de su carpeta.');
      return res.status(500).json({ ok: false, mensaje: 'No se pudo abrir el archivo.' });
    }
    const alFallar = err => {
      if (!err) return;
      console.error('descargar archivo de actividad:', err.message);
      if (!res.headersSent) {
        res.status(err.code === 'ENOENT' ? 404 : 500).json({
          ok: false,
          mensaje: err.code === 'ENOENT' ? 'Archivo no encontrado.' : 'No se pudo abrir el archivo.',
        });
      }
    };

    const vista = ['1', 'true', 'inline', 'vista'].includes(String(req.query.vista || '').toLowerCase());
    if (vista) {
      res.setHeader('Content-Type', tarea.mime_type || 'application/octet-stream');
      res.setHeader(
        'Content-Disposition',
        `inline; filename*=UTF-8''${encodeURIComponent(tarea.nombre_original || 'archivo')}`
      );
      return res.sendFile(ruta, alFallar);
    }
    return res.download(ruta, tarea.nombre_original, alFallar);
  } catch (err) {
    console.error('descargarArchivoActividad tareas:', err.message);
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
    const periodo = await obtenerPeriodo(tarea.periodo_id);
    const hoy = hoyISO();
    const abierto = periodoAbierto(periodo, hoy);
    if (tarea.estado !== 'publicada' && !abierto) {
      return res.status(409).json({ ok: false, mensaje: 'Esta tarea todavía no está publicada.' });
    }
    const tardia = fechaLimitePasada(tarea.fecha_entrega);
    if (!tarea.recibir_entregas) {
      return res.status(409).json({ ok: false, mensaje: 'El docente cerró la recepción de entregas para esta actividad.' });
    }
    if (tardia && !tarea.permitir_tardias) {
      return res.status(409).json({ ok: false, mensaje: 'La fecha límite ya pasó y esta actividad no admite entregas tardías.' });
    }
    const finPeriodo = periodo ? soloFecha(periodo.fecha_fin) : null;
    if (finPeriodo && hoy > finPeriodo && !tardia) {
      return res.status(409).json({ ok: false, mensaje: 'El periodo de esta tarea ya cerró; no se pueden registrar entregas.' });
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
    const estado = tardia ? 'tarde' : 'entregada';

    await pool.query(
      `INSERT INTO entregas_tareas (id, tarea_id, estudiante_id, comentario, estado, entrega_tarde, fecha_entrega)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE comentario = VALUES(comentario),
         entrega_tarde = IF(estado = 'calificada', entrega_tarde, VALUES(entrega_tarde)),
         estado = IF(estado = 'calificada', estado, VALUES(estado)),
         fecha_entrega = VALUES(fecha_entrega)`,
      [randomUUID(), id, req.usuario.id, comentario || null, estado, tardia, ahora]
    );
    await emitirActualizacionPlanMateria(req.app.get('io'), tarea.materia_id, tarea.grupo_id, { tarea_id: id });

    return res.json({ ok: true, mensaje: 'Tarea entregada.', estado, entrega_tarde: tardia });
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
      `SELECT e.estudiante_id, e.estado, e.entrega_tarde,
              e.calificacion, e.feedback_doc, e.comentario, e.fecha_entrega
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
        entrega_tarde: Boolean(Number(d.entrega_tarde)),
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
  let conn;
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

    conn = await pool.getConnection();
    await conn.beginTransaction();
    await conn.query(
      `INSERT INTO entregas_tareas (id, tarea_id, estudiante_id, estado, entrega_tarde, calificacion, feedback_doc, fecha_entrega)
       VALUES (?, ?, ?, 'calificada', FALSE, ?, ?, NULL)
       ON DUPLICATE KEY UPDATE estado = 'calificada', calificacion = COALESCE(?, calificacion), feedback_doc = ?`,
      [
        randomUUID(), id, estudiante_id,
        calificacion !== null && calificacion !== undefined ? Number(calificacion) : null,
        feedback_doc || null,
        calificacion !== null && calificacion !== undefined ? Number(calificacion) : null,
        feedback_doc || null,
      ]
    );

    if (calificacion !== null && calificacion !== undefined && tarea.plan_item_id) {
      const [items] = await conn.query(
        `SELECT nombre, peso_pct FROM plan_evaluacion_items WHERE id = ? LIMIT 1`,
        [tarea.plan_item_id]
      );
      const item = items[0];
      if (item && item.peso_pct !== null) {
        await conn.query(
          `INSERT INTO notas
             (id, estudiante_id, materia_id, periodo_id, docente_id, tipo_nota, descripcion,
              valor, valor_max, peso_pct, plan_item_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE valor = VALUES(valor), valor_max = VALUES(valor_max),
             docente_id = VALUES(docente_id), peso_pct = VALUES(peso_pct)`,
          [
            randomUUID(), estudiante_id, tarea.materia_id, tarea.periodo_id,
            tarea.docente_id, item.nombre.slice(0, 60), tarea.titulo,
            Number(calificacion), Number(tarea.valor_max), Number(item.peso_pct), tarea.plan_item_id,
          ]
        );
      }
    }
    await conn.commit();

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
    await emitirActualizacionPlanMateria(io, tarea.materia_id, tarea.grupo_id, { tarea_id: id });

    // La calificación de una entrega también aparece en el reporte.
    await notificarReporte(io, estudiante_id, { motivo: 'entrega', ref_id: id });

    return res.json({ ok: true, mensaje: 'Entrega calificada.' });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error('calificarEntrega tareas:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  } finally {
    if (conn) conn.release();
  }
};
