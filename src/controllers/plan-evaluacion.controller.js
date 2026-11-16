// ============================================================
//  plan-evaluacion.controller.js — MySQL
//  Plan de evaluación por materia y periodo (actividades con % de
//  peso) + hoja de calificación tipo "hoja de cálculo".
//
//  Reglas de negocio confirmadas por el usuario (2026-08-17):
//  - El plan se define POR PERIODO (puede cambiar cada bimestre).
//  - La suma de pesos puede quedar por debajo de 100% (el resto queda
//    "pendiente" en la UI). Si un ítem nuevo/editado hace que la suma
//    se pase de 100%, el backend lo rechaza — mismo criterio que
//    notas.controller.js usa con el peso_pct de una nota individual.
//  - Editar/eliminar un ítem con notas ya cargadas SE PERMITE. El
//    backend manda cuántas notas tiene cada ítem (conteo_notas) para
//    que el frontend muestre una advertencia antes de guardar/borrar.
//  - Gestionar el plan (crear/editar/eliminar ítems, ver la hoja):
//    docente asignado a la materia en el curso, o admin/superadmin.
//  - Calificar (guardar una celda): solo el docente que dicta ESA
//    materia EN ESE periodo puntual, o admin/superadmin.
//  - Las celdas se guardan como filas normales de `notas`
//    (plan_item_id apuntando al ítem). El resto del sistema
//    (resumen.controller.js, boletin.controller.js) calcula promedios
//    leyendo solo valor/valor_max/peso_pct/materia_id/periodo_id, así
//    que estas notas se integran automáticamente sin tocar ese código.
// ============================================================

const pool = require('../config/db');
const { randomUUID } = require('crypto');
const path = require('path');
const fs = require('fs');
const {
  condicionDocenteEnGrupo,
  parametrosDocenteEnGrupo,
  condicionMateriaEnGrupo,
  parametrosMateriaEnGrupo,
  materiaPerteneceAlGrupo,
  docenteAsignadoEnGrupo,
  gruposDocenteMateria,
  materiasConDocentesDeGrupo,
} = require('../utils/materias-curso.util');
const { normalizarFechaHora } = require('../utils/tareas-entrega.util');
const tareasController = require('./tareas.controller');
const { notificarReporte } = require('../services/reporte-update.service');

// Trae la materia + su grupo_id + institucion_id, o null si no existe.
async function _datosMateria(materiaId) {
  const [rows] = await pool.query(
    `SELECT m.id, m.grupo_id, m.institucion_id
     FROM materias m WHERE m.id = ?`,
    [materiaId]
  );
  return rows.length ? rows[0] : null;
}

// Gestionar el plan: docente asignado a la materia en el curso, o
// admin/superadmin de la institución de esa materia.
async function _puedeGestionarPlan(req, materia, grupoId = null) {
  if (!materia) return false;
  if (grupoId && !(await materiaPerteneceAlGrupo(pool, materia.id, grupoId))) return false;
  if (req.usuario.rol === 'superadmin') return true;
  if (req.usuario.rol === 'admin') return materia.institucion_id === req.usuario.institucion_id;
  if (req.usuario.rol === 'docente') {
    if (grupoId && await _esDirectorGrupo(req.usuario.id, grupoId)) return true;
    if (grupoId) return docenteAsignadoEnGrupo(pool, materia.id, req.usuario.id, grupoId);
    return (await gruposDocenteMateria(pool, materia.id, req.usuario.id)).length > 0;
  }
  return false;
}

async function _puedeVerPlan(req, materia, grupoId = null) {
  return _puedeGestionarPlan(req, materia, grupoId);
}

// Calificar: solo el docente que dicta ESA materia EN ESE periodo
// puntual, o admin/superadmin.
async function _puedeCalificar(req, materiaId, periodoId, grupoId = null) {
  if (req.usuario.rol === 'superadmin') return true;
  if (req.usuario.rol === 'admin') return true; // institución ya se valida antes de llamar
  if (req.usuario.rol === 'docente') {
    if (grupoId) return docenteAsignadoEnGrupo(pool, materiaId, req.usuario.id, grupoId, periodoId);
    return (await gruposDocenteMateria(pool, materiaId, req.usuario.id, periodoId)).length > 0;
  }
  return false;
}

async function _esDirectorGrupo(docenteId, grupoId, conn = pool) {
  if (!docenteId || !grupoId) return false;
  const [rows] = await conn.query(
    `SELECT 1 FROM grupos WHERE id = ? AND director_id = ? LIMIT 1`,
    [grupoId, docenteId]
  );
  return rows.length > 0;
}

async function _sumaPesoPlan(conn, materiaId, periodoId, excluirItemId = null, grupoId = null, planCurso = false) {
  let sql;
  let params;
  if (planCurso && grupoId) {
    sql = `SELECT COALESCE(SUM(pi.peso_pct), 0) AS total
           FROM plan_evaluacion_items pi
           JOIN materias m ON m.id = pi.materia_id
           WHERE pi.periodo_id = ? AND ${condicionMateriaEnGrupo('m')}`;
    params = [periodoId, ...parametrosMateriaEnGrupo(grupoId)];
  } else {
    sql = `SELECT COALESCE(SUM(peso_pct), 0) AS total FROM plan_evaluacion_items
           WHERE materia_id = ? AND periodo_id = ?`;
    params = [materiaId, periodoId];
  }
  if (excluirItemId) {
    sql += planCurso && grupoId ? ` AND pi.id != ?` : ` AND id != ?`;
    params.push(excluirItemId);
  }
  const [[{ total }]] = await conn.query(sql, params);
  return Number(total);
}

async function _bloquearPlan(conn, materiaId, grupoId = null, planCurso = false) {
  if (planCurso && grupoId) {
    await conn.query(`SELECT id FROM grupos WHERE id = ? FOR UPDATE`, [grupoId]);
    return;
  }
  await conn.query(`SELECT id FROM materias WHERE id = ? FOR UPDATE`, [materiaId]);
}

function _pesoValido(peso) {
  if (peso === null || peso === undefined || peso === '') return false;
  const numero = Number(peso);
  return Number.isFinite(numero) && numero > 0 && numero <= 100;
}

function _valorBooleano(valor) {
  return valor === true || valor === 1 || valor === '1' || valor === 'true';
}

function _limpiarArchivoTemporal(file) {
  if (!file?.path) return;
  fs.promises.unlink(file.path).catch(err => {
    if (err.code !== 'ENOENT') console.error('No se pudo limpiar el archivo temporal de actividad:', err.message);
  });
}

// Verifica que la materia exista y pertenezca a la institución del
// usuario (o que sea superadmin). Devuelve la materia o null.
async function _materiaDeLaInstitucion(req, materiaId) {
  const materia = await _datosMateria(materiaId);
  if (!materia) return null;
  if (req.usuario.rol !== 'superadmin' && materia.institucion_id !== req.usuario.institucion_id) return null;
  return materia;
}

// El rol 'docente' no tiene acceso a GET /api/academico/periodos (solo
// admin/superadmin), así que el plan de evaluación NO le pide elegir
// periodo desde el frontend: si no llega periodo_id, se resuelve solo
// al periodo marcado `activo` de la institución de la materia (mismo
// criterio usado en resumen.controller.js y al asignar docentes a
// materias). No hay todavía forma de ver/editar el plan de un periodo
// ya cerrado desde la UI — ver "Qué falta" en el ROADMAP.
async function _resolverPeriodoId(periodoIdRecibido, institucionId) {
  if (periodoIdRecibido) return periodoIdRecibido;
  const [rows] = await pool.query(
    `SELECT id FROM periodos_academicos WHERE institucion_id = ? AND activo = TRUE LIMIT 1`,
    [institucionId]
  );
  return rows.length ? rows[0].id : null;
}

// ────────────────────────────────────────────────────────────
//  GET /api/plan-evaluacion/materia/:materiaId?periodo_id=
// ────────────────────────────────────────────────────────────
exports.listarItems = async (req, res) => {
  const { materiaId } = req.params;

  try {
    const materia = await _materiaDeLaInstitucion(req, materiaId);
    if (!materia) return res.status(404).json({ ok: false, mensaje: 'Materia no encontrada.' });
    if (!(await _puedeVerPlan(req, materia, req.query.grupo_id || materia.grupo_id))) {
      return res.status(403).json({ ok: false, mensaje: 'No tienes permiso para ver el plan de esta materia.' });
    }

    const periodoId = await _resolverPeriodoId(req.query.periodo_id, materia.institucion_id);
    if (!periodoId) {
      return res.status(409).json({ ok: false, mensaje: 'No hay ningún periodo académico activo ni creado. Pide al administrador que cree uno.' });
    }

    const [items] = await pool.query(
      `SELECT pi.id, pi.nombre, pi.peso_pct, pi.orden,
              t.id AS tarea_id, t.descripcion AS tarea_descripcion,
              DATE_FORMAT(t.fecha_entrega, '%Y-%m-%d %H:%i:%s') AS fecha_entrega,
              t.valor_max, t.estado AS tarea_estado,
              t.permitir_tardias, t.recibir_entregas,
              a.id AS archivo_id, a.nombre_original AS archivo_nombre,
              (SELECT COUNT(*) FROM entregas_tareas e
               WHERE e.tarea_id = t.id AND e.estado <> 'pendiente') AS con_entrega,
              (SELECT COUNT(*) FROM entregas_tareas e WHERE e.tarea_id = t.id) AS total_entregas,
              (SELECT COUNT(*) FROM notas n WHERE n.plan_item_id = pi.id) AS conteo_notas
       FROM plan_evaluacion_items pi
       LEFT JOIN tareas t ON t.plan_item_id = pi.id
       LEFT JOIN archivos a ON a.id = t.archivo_id
       WHERE pi.materia_id = ? AND pi.periodo_id = ?
       ORDER BY pi.orden ASC, pi.created_at ASC`,
      [materiaId, periodoId]
    );
    const planCurso = req.usuario.rol === 'docente' && await _esDirectorGrupo(req.usuario.id, req.query.grupo_id || materia.grupo_id);
    const suma = await _sumaPesoPlan(
      pool,
      materiaId,
      periodoId,
      null,
      req.query.grupo_id || materia.grupo_id,
      planCurso
    );

    return res.json({
      ok: true,
      periodo_id: periodoId,
      items,
      plan_scope: planCurso ? 'curso' : 'materia',
      suma_actual: Number(suma.toFixed(2)),
      pendiente: Number((100 - suma).toFixed(2)),
    });
  } catch (err) {
    console.error('listarItems plan-evaluacion:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// ────────────────────────────────────────────────────────────
//  POST /api/plan-evaluacion   { materia_id, periodo_id, nombre, peso_pct, orden? }
// ────────────────────────────────────────────────────────────
exports.crearItem = async (req, res) => {
  const { materia_id, nombre, peso_pct, orden } = req.body;
  let { periodo_id } = req.body;
  if (!materia_id || !nombre || !_pesoValido(peso_pct)) {
    return res.status(400).json({ ok: false, mensaje: 'materia_id, nombre y peso_pct son obligatorios.' });
  }

  let conn;
  try {
    const materia = await _materiaDeLaInstitucion(req, materia_id);
    if (!materia) return res.status(404).json({ ok: false, mensaje: 'Materia no encontrada.' });
    const grupoId = req.body.grupo_id || materia.grupo_id;
    if (!(await _puedeGestionarPlan(req, materia, grupoId))) {
      return res.status(403).json({ ok: false, mensaje: 'No tienes permiso para editar el plan de esta materia.' });
    }

    periodo_id = await _resolverPeriodoId(periodo_id, materia.institucion_id);
    if (!periodo_id) {
      return res.status(409).json({ ok: false, mensaje: 'No hay ningún periodo académico activo ni creado. Pide al administrador que cree uno.' });
    }

    const planCurso = req.usuario.rol === 'docente' && await _esDirectorGrupo(req.usuario.id, grupoId);
    conn = await pool.getConnection();
    await conn.beginTransaction();
    await _bloquearPlan(conn, materia_id, grupoId, planCurso);
    const sumaActual = await _sumaPesoPlan(conn, materia_id, periodo_id, null, grupoId, planCurso);
    if (sumaActual + Number(peso_pct) > 100) {
      await conn.rollback();
      return res.status(400).json({
        ok: false,
        mensaje: `El plan ya usa ${sumaActual}%. Baja el porcentaje o elimina una actividad antes de agregar otra.`,
      });
    }

    const id = randomUUID();
    await conn.query(
      `INSERT INTO plan_evaluacion_items (id, materia_id, periodo_id, nombre, peso_pct, orden)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, materia_id, periodo_id, nombre.trim(), peso_pct, orden || 0]
    );
    await conn.commit();
    await tareasController.emitirActualizacionPlanMateria(
      req.app.get('io'),
      materia_id,
      grupoId,
      { actividad_id: id }
    );
    return res.status(201).json({ ok: true, mensaje: 'Actividad agregada al plan.', id, periodo_id });
  } catch (err) {
    if (conn) await conn.rollback();
    if (err.errno === 3819 || /chk_plan_peso_pct/.test(err.message || '')) {
      return res.status(400).json({ ok: false, mensaje: 'El peso no cumple las reglas de validación.' });
    }
    console.error('crearItem plan-evaluacion:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  } finally {
    if (conn) conn.release();
  }
};

// ────────────────────────────────────────────────────────────
//  PUT /api/plan-evaluacion/:id   edición del ítem y su tarea asociada
// ────────────────────────────────────────────────────────────
exports.actualizarItem = async (req, res) => {
  const { id } = req.params;
  const body = req.body || {};
  const { nombre, peso_pct } = body;
  const pesoActualizado = peso_pct === undefined || peso_pct === null
    ? peso_pct
    : Number(Number(peso_pct).toFixed(2));
  if (nombre !== undefined && (typeof nombre !== 'string' || !nombre.trim() || nombre.trim().length > 150)) {
    _limpiarArchivoTemporal(req.file);
    return res.status(400).json({ ok: false, mensaje: 'El nombre debe tener entre 1 y 150 caracteres.' });
  }
  if (peso_pct !== undefined && peso_pct !== null && !_pesoValido(peso_pct)) {
    _limpiarArchivoTemporal(req.file);
    return res.status(400).json({ ok: false, mensaje: 'peso_pct debe estar entre 1 y 100.' });
  }
  if (body.descripcion !== undefined
    && (typeof body.descripcion !== 'string' || body.descripcion.length > 5000)) {
    _limpiarArchivoTemporal(req.file);
    return res.status(400).json({ ok: false, mensaje: 'La descripción no puede superar 5000 caracteres.' });
  }
  const fechaEntrega = body.fecha_entrega === undefined
    ? undefined
    : normalizarFechaHora(body.fecha_entrega);
  if (body.fecha_entrega !== undefined && !fechaEntrega) {
    _limpiarArchivoTemporal(req.file);
    return res.status(400).json({ ok: false, mensaje: 'La fecha y hora límite no son válidas.' });
  }
  if (fechaEntrega && new Date(fechaEntrega.replace(' ', 'T')).getTime() < Date.now()) {
    _limpiarArchivoTemporal(req.file);
    return res.status(400).json({ ok: false, mensaje: 'La fecha y hora límite no pueden estar en el pasado.' });
  }

  let conn;
  let transaccionActiva = false;
  let archivoGuardado = false;
  let archivosAntiguos = [];
  try {
    const [itemRows] = await pool.query(`SELECT * FROM plan_evaluacion_items WHERE id = ?`, [id]);
    if (!itemRows.length) return res.status(404).json({ ok: false, mensaje: 'Actividad no encontrada.' });
    const item = itemRows[0];

    const materia = await _materiaDeLaInstitucion(req, item.materia_id);
    if (!materia || !(await _puedeGestionarPlan(req, materia, req.query.grupo_id || materia.grupo_id))) {
      return res.status(403).json({ ok: false, mensaje: 'No tienes permiso para editar el plan de esta materia.' });
    }

    const grupoId = req.query.grupo_id || materia.grupo_id;
    const [tareaInicial] = await pool.query(`SELECT * FROM tareas WHERE plan_item_id = ? LIMIT 1`, [id]);
    const tieneCamposTarea = body.descripcion !== undefined || body.fecha_entrega !== undefined
      || body.permitir_tardias !== undefined || body.recibir_entregas !== undefined
      || body.quitar_archivo !== undefined || Boolean(req.file);
    if (!tareaInicial.length && tieneCamposTarea) {
      _limpiarArchivoTemporal(req.file);
      return res.status(409).json({ ok: false, mensaje: 'Crea primero la tarea para editar su descripción, fecha y archivo.' });
    }

    const planCurso = req.usuario.rol === 'docente' && await _esDirectorGrupo(req.usuario.id, grupoId);
    conn = await pool.getConnection();
    await conn.beginTransaction();
    transaccionActiva = true;
    await _bloquearPlan(conn, item.materia_id, grupoId, planCurso);
    const [itemsBloqueados] = await conn.query(
      `SELECT id, materia_id, periodo_id, nombre, peso_pct
       FROM plan_evaluacion_items WHERE id = ? FOR UPDATE`,
      [id]
    );
    if (!itemsBloqueados.length) {
      await conn.rollback();
      transaccionActiva = false;
      return res.status(404).json({ ok: false, mensaje: 'Actividad no encontrada.' });
    }
    const itemBloqueado = itemsBloqueados[0];
    const [tareas] = await conn.query(`SELECT * FROM tareas WHERE plan_item_id = ? FOR UPDATE`, [id]);
    const tarea = tareas[0] || null;
    if (!tarea && tieneCamposTarea) {
      await conn.rollback();
      transaccionActiva = false;
      return res.status(409).json({ ok: false, mensaje: 'La tarea vinculada ya no existe; vuelve a cargar la actividad.' });
    }

    if (peso_pct !== undefined) {
      if (pesoActualizado === null) {
        const [notas] = await conn.query(`SELECT 1 FROM notas WHERE plan_item_id = ? LIMIT 1`, [id]);
        if (notas.length) {
          await conn.rollback();
          transaccionActiva = false;
          return res.status(409).json({ ok: false, mensaje: 'No se puede dejar sin porcentaje una actividad que ya tiene notas.' });
        }
      }
      const sumaActual = await _sumaPesoPlan(conn, itemBloqueado.materia_id, itemBloqueado.periodo_id, id, grupoId, planCurso);
      if (pesoActualizado !== null && sumaActual + pesoActualizado > 100) {
        await conn.rollback();
        transaccionActiva = false;
        return res.status(400).json({
          ok: false,
          mensaje: `El plan ya usa ${sumaActual}%. Baja el porcentaje o elimina una actividad antes de guardar.`,
        });
      }
    }

    if (tarea) {
      let archivoId = tarea.archivo_id;
      if (req.file) {
        const nuevoArchivoId = randomUUID();
        await conn.query(
          `INSERT INTO archivos
             (id, subido_por, tipo, nombre_original, nombre_storage, ruta_storage,
              mime_type, tamanio_bytes, es_publico, ref_grupo_id, descripcion)
           VALUES (?, ?, 'tarea_entregada', ?, ?, ?, ?, ?, FALSE, ?, ?)`,
          [
            nuevoArchivoId, req.usuario.id, req.file.originalname, req.file.filename,
            path.relative(path.join(__dirname, '../..'), req.file.path),
            req.file.mimetype, req.file.size, tarea.grupo_id,
            `Material de la actividad "${nombre === undefined ? item.nombre : nombre.trim()}"`,
          ]
        );
        archivoId = nuevoArchivoId;
      } else if (_valorBooleano(body.quitar_archivo)) {
        archivoId = null;
      }

      const camposTarea = {
        descripcion: body.descripcion === undefined ? tarea.descripcion : (body.descripcion.trim() || null),
        fecha_entrega: fechaEntrega === undefined ? tarea.fecha_entrega : fechaEntrega,
        permitir_tardias: body.permitir_tardias === undefined
          ? tarea.permitir_tardias
          : _valorBooleano(body.permitir_tardias),
        recibir_entregas: body.recibir_entregas === undefined
          ? tarea.recibir_entregas
          : _valorBooleano(body.recibir_entregas),
      };
      await conn.query(
        `UPDATE tareas SET titulo = ?, descripcion = ?, fecha_entrega = ?,
           permitir_tardias = ?, recibir_entregas = ?, archivo_id = ?
         WHERE id = ?`,
        [
          nombre === undefined ? tarea.titulo : nombre.trim(),
          camposTarea.descripcion,
          camposTarea.fecha_entrega,
          camposTarea.permitir_tardias,
          camposTarea.recibir_entregas,
          archivoId,
          tarea.id,
        ]
      );
      if (tarea.archivo_id && tarea.archivo_id !== archivoId) {
        const [archivos] = await conn.query(
          `SELECT ruta_storage FROM archivos WHERE id = ? FOR UPDATE`,
          [tarea.archivo_id]
        );
        if (archivos.length) {
          archivosAntiguos.push(archivos[0].ruta_storage);
          await conn.query(`DELETE FROM archivos WHERE id = ?`, [tarea.archivo_id]);
        }
      }
    }

    await conn.query(
      `UPDATE plan_evaluacion_items
       SET nombre = COALESCE(?, nombre), peso_pct = ?
       WHERE id = ?`,
      [nombre ? nombre.trim() : null, pesoActualizado === undefined ? itemBloqueado.peso_pct : pesoActualizado, id]
    );
    if (nombre !== undefined) {
      await conn.query(
        `UPDATE notas SET tipo_nota = ?, descripcion = ? WHERE plan_item_id = ?`,
        [nombre.trim().slice(0, 60), nombre.trim(), id]
      );
    }

    // Si cambió el peso, las notas ya cargadas de este ítem deben quedar
    // con el mismo peso_pct nuevo (para que el promedio no quede
    // calculado con un peso viejo).
    if (pesoActualizado !== undefined) {
      await conn.query(`UPDATE notas SET peso_pct = ? WHERE plan_item_id = ?`, [pesoActualizado, id]);
    }

    await conn.commit();
    transaccionActiva = false;
    archivoGuardado = Boolean(req.file);
    await tareasController.emitirActualizacionPlanMateria(
      req.app.get('io'),
      item.materia_id,
      (tarea && tarea.grupo_id) || grupoId,
      { actividad_id: id }
    );
    await tareasController.limpiarArchivosBorrados(archivosAntiguos);
    return res.json({ ok: true, mensaje: 'Actividad actualizada.' });
  } catch (err) {
    if (conn && transaccionActiva) await conn.rollback();
    console.error('actualizarItem plan-evaluacion:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  } finally {
    if (conn) conn.release();
    if (req.file && !archivoGuardado) _limpiarArchivoTemporal(req.file);
  }
};

// ────────────────────────────────────────────────────────────
//  DELETE /api/plan-evaluacion/:id
//  Borra la actividad, su tarea, entregas, notas y archivos asociados.
// ────────────────────────────────────────────────────────────
exports.eliminarItem = async (req, res) => {
  const { id } = req.params;
  let conn;
  let transaccionActiva = false;
  let archivosBorrados = [];
  try {
    const [itemRows] = await pool.query(`SELECT * FROM plan_evaluacion_items WHERE id = ?`, [id]);
    if (!itemRows.length) return res.status(404).json({ ok: false, mensaje: 'Actividad no encontrada.' });
    const item = itemRows[0];

    const materia = await _materiaDeLaInstitucion(req, item.materia_id);
    const grupoId = req.query.grupo_id || materia?.grupo_id || null;
    if (req.usuario.rol !== 'docente' || !materia
      || !(await _puedeGestionarPlan(req, materia, grupoId))) {
      return res.status(403).json({ ok: false, mensaje: 'No tienes permiso para eliminar actividades de esta materia.' });
    }

    conn = await pool.getConnection();
    await conn.beginTransaction();
    transaccionActiva = true;
    await _bloquearPlan(conn, item.materia_id, grupoId, await _esDirectorGrupo(req.usuario.id, grupoId));
    const [itemBloqueado] = await conn.query(
      `SELECT id FROM plan_evaluacion_items WHERE id = ? FOR UPDATE`,
      [id]
    );
    if (!itemBloqueado.length) {
      await conn.rollback();
      transaccionActiva = false;
      return res.status(404).json({ ok: false, mensaje: 'Actividad no encontrada.' });
    }
    const [tarea] = await conn.query(
      `SELECT grupo_id FROM tareas WHERE plan_item_id = ? FOR UPDATE`,
      [id]
    );
    archivosBorrados = await tareasController.eliminarActividadEnTransaccion(conn, id);
    await conn.commit();
    transaccionActiva = false;
    await tareasController.emitirActualizacionPlanMateria(
      req.app.get('io'),
      item.materia_id,
      tarea[0]?.grupo_id || grupoId,
      { actividad_id: id, eliminada: true }
    );
    await tareasController.limpiarArchivosBorrados(archivosBorrados);
    return res.json({
      ok: true,
      mensaje: 'Actividad, entregas, notas y archivos eliminados.',
    });
  } catch (err) {
    if (conn && transaccionActiva) await conn.rollback();
    console.error('eliminarItem plan-evaluacion:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  } finally {
    if (conn) conn.release();
  }
};

// ────────────────────────────────────────────────────────────
//  GET /api/plan-evaluacion/materia/:materiaId/hoja?periodo_id=
//  Hoja de calificación: ítems como columnas, estudiantes matriculados
//  activos del grupo como filas, valor de cada celda (o null si está
//  vacía) y el promedio ya calculado por fila.
// ────────────────────────────────────────────────────────────
exports.hojaCalificacion = async (req, res) => {
  const { materiaId } = req.params;

  try {
    const materia = await _materiaDeLaInstitucion(req, materiaId);
    if (!materia) return res.status(404).json({ ok: false, mensaje: 'Materia no encontrada.' });
    const grupoId = req.query.grupo_id || materia.grupo_id;
    if (!(await _puedeVerPlan(req, materia, grupoId))) {
      return res.status(403).json({ ok: false, mensaje: 'No tienes permiso para ver esta hoja de calificación.' });
    }
    if (!grupoId) return res.status(400).json({ ok: false, mensaje: 'grupo_id es obligatorio para esta materia.' });
    if (!(await materiaPerteneceAlGrupo(pool, materia.id, grupoId))) {
      return res.status(404).json({ ok: false, mensaje: 'La materia no pertenece a ese curso.' });
    }

    const periodoId = await _resolverPeriodoId(req.query.periodo_id, materia.institucion_id);
    if (!periodoId) {
      return res.status(409).json({ ok: false, mensaje: 'No hay ningún periodo académico activo ni creado. Pide al administrador que cree uno.' });
    }

    const [configuracion] = await pool.query(
      `SELECT nota_minima_aprobacion FROM configuracion WHERE institucion_id = ?`,
      [materia.institucion_id]
    );
    if (!configuracion.length) {
      return res.status(409).json({ ok: false, mensaje: 'No existe configuración para esta institución.' });
    }
    const notaMinimaAprobacion = Number(configuracion[0].nota_minima_aprobacion);

    const [items] = await pool.query(
      `SELECT id, nombre, peso_pct, orden FROM plan_evaluacion_items
       WHERE materia_id = ? AND periodo_id = ? AND peso_pct IS NOT NULL
       ORDER BY orden ASC, created_at ASC`,
      [materiaId, periodoId]
    );

    const [estudiantes] = await pool.query(
      `SELECT u.id, u.nombres, u.apellidos
       FROM matriculas mt JOIN usuarios u ON u.id = mt.estudiante_id
       WHERE mt.grupo_id = ? AND mt.estado = 'activa'
       ORDER BY u.apellidos, u.nombres`,
      [grupoId]
    );

    const [notas] = await pool.query(
      `SELECT plan_item_id, estudiante_id, valor, valor_max FROM notas
       WHERE materia_id = ? AND periodo_id = ? AND plan_item_id IS NOT NULL`,
      [materiaId, periodoId]
    );
    const celdas = {}; // `${estudiante_id}|${item_id}` -> { valor, valor_max }
    for (const n of notas) {
      celdas[`${n.estudiante_id}|${n.plan_item_id}`] = { valor: Number(n.valor), valor_max: Number(n.valor_max) };
    }

    const pesoTotalPlan = items.reduce((total, it) => total + Number(it.peso_pct), 0);
    const planCompleto = Math.abs(pesoTotalPlan - 100) < 0.001;
    const filas = estudiantes.map(e => {
      const valores = {};
      let ponderada = 0, pesos = 0, sumaPonderada = 0, pesoPendiente = 0;
      for (const it of items) {
        const peso = Number(it.peso_pct);
        const celda = celdas[`${e.id}|${it.id}`];
        valores[it.id] = celda ? celda.valor : null;
        if (celda) {
          ponderada += (celda.valor / celda.valor_max) * peso;
          sumaPonderada += peso * celda.valor;
          pesos += peso;
        } else {
          pesoPendiente += peso;
        }
      }
      const promedio = pesos > 0 ? Number(((ponderada / pesos) * 10).toFixed(2)) : null;
      const minimoNecesario = pesoPendiente > 0
        ? (notaMinimaAprobacion * 100 - sumaPonderada) / pesoPendiente
        : null;
      let estado;
      if (!planCompleto) estado = 'plan_incompleto';
      else if (pesoPendiente === 0) estado = 'completo';
      else if (minimoNecesario <= 0) estado = 'aprobado';
      else if (minimoNecesario > 10) estado = 'imposible';
      else estado = 'en_juego';

      return {
        estudiante_id: e.id,
        nombres: e.nombres,
        apellidos: e.apellidos,
        valores,
        promedio,
        acumulado: Number((sumaPonderada / 100).toFixed(2)),
        peso_pendiente: Number(pesoPendiente.toFixed(2)),
        minimo_necesario: minimoNecesario === null ? null : Number(minimoNecesario.toFixed(2)),
        estado,
      };
    });

    return res.json({
      ok: true,
      periodo_id: periodoId,
      nota_minima_aprobacion: notaMinimaAprobacion,
      items,
      filas,
    });
  } catch (err) {
    console.error('hojaCalificacion plan-evaluacion:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// ────────────────────────────────────────────────────────────
//  PUT /api/plan-evaluacion/celda   { plan_item_id, estudiante_id, valor }
//  valor vacío/null → borra la nota de esa celda (una celda vacía no
//  es lo mismo que un 0). Solo el docente que dicta la materia EN ESE
//  periodo, o admin/superadmin.
// ────────────────────────────────────────────────────────────
exports.guardarCelda = async (req, res) => {
  const { plan_item_id, estudiante_id, valor } = req.body;
  if (!plan_item_id || !estudiante_id) {
    return res.status(400).json({ ok: false, mensaje: 'plan_item_id y estudiante_id son obligatorios.' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [itemRows] = await conn.query(`SELECT * FROM plan_evaluacion_items WHERE id = ?`, [plan_item_id]);
    if (!itemRows.length) {
      await conn.rollback();
      return res.status(404).json({ ok: false, mensaje: 'Actividad del plan no encontrada.' });
    }
    const item = itemRows[0];

    const [materiaRows] = await conn.query(
      `SELECT m.id, m.grupo_id, m.institucion_id
       FROM materias m WHERE m.id = ?`,
      [item.materia_id]
    );
    const materia = materiaRows.length ? materiaRows[0] : null;
    if (!materia || (req.usuario.rol !== 'superadmin' && materia.institucion_id !== req.usuario.institucion_id)) {
      await conn.rollback();
      return res.status(404).json({ ok: false, mensaje: 'Materia no encontrada.' });
    }
    const grupoId = req.body.grupo_id || materia.grupo_id;
    if (!grupoId) {
      await conn.rollback();
      return res.status(400).json({ ok: false, mensaje: 'grupo_id es obligatorio para esta materia.' });
    }
    if (!(await materiaPerteneceAlGrupo(conn, item.materia_id, grupoId))) {
      await conn.rollback();
      return res.status(404).json({ ok: false, mensaje: 'La materia no pertenece a ese curso.' });
    }
    if (item.peso_pct === null) {
      await conn.rollback();
      return res.status(409).json({ ok: false, mensaje: 'Esta actividad no tiene porcentaje y no admite calificación desde el plan.' });
    }
    if (!(await _puedeCalificar(req, item.materia_id, item.periodo_id, grupoId))) {
      await conn.rollback();
      return res.status(403).json({ ok: false, mensaje: 'No dictas esta materia en este periodo.' });
    }

    const [matriculado] = await conn.query(
      `SELECT id FROM matriculas WHERE estudiante_id = ? AND grupo_id = ? AND estado = 'activa'`,
      [estudiante_id, grupoId]
    );
    if (!matriculado.length) {
      await conn.rollback();
      return res.status(404).json({ ok: false, mensaje: 'El estudiante no está matriculado activo en el curso de esta materia.' });
    }

    // Celda vacía = borra la nota (no es lo mismo que dejarla en 0).
    if (valor === null || valor === undefined || valor === '') {
      await conn.query(`DELETE FROM notas WHERE plan_item_id = ? AND estudiante_id = ?`, [plan_item_id, estudiante_id]);
      await conn.commit();
      await notificarReporte(req.app.get('io'), estudiante_id, { motivo: 'nota', plan_item_id });
      await tareasController.emitirActualizacionPlanMateria(
        req.app.get('io'),
        item.materia_id,
        grupoId,
        { actividad_id: plan_item_id }
      );
      return res.json({ ok: true, mensaje: 'Celda vaciada.', valor: null });
    }

    const valorNum = Number(valor);
    if (Number.isNaN(valorNum) || valorNum < 0 || valorNum > 10) {
      await conn.rollback();
      return res.status(400).json({ ok: false, mensaje: 'El valor debe estar entre 0 y 10.' });
    }

    // Docente que queda registrado en la nota: el mismo que califica si
    // es un docente; si es admin/superadmin calificando, se usa el
    // docente asignado a la materia en ese periodo (para no dejar
    // docente_id apuntando a una cuenta admin en el historial).
    let docenteId = req.usuario.rol === 'docente' ? req.usuario.id : null;
    if (!docenteId) {
      const [dRows] = await conn.query(
        `SELECT dm.docente_id FROM docentes_materias dm
         JOIN materias m ON m.id = dm.materia_id
         WHERE dm.materia_id = ? AND dm.periodo_id = ?
           AND ${condicionDocenteEnGrupo()}
         LIMIT 1`,
        [item.materia_id, item.periodo_id, ...parametrosDocenteEnGrupo(grupoId)]
      );
      docenteId = dRows.length ? dRows[0].docente_id : req.usuario.id;
    }

    // Un solo INSERT ... ON DUPLICATE KEY UPDATE gracias al UNIQUE
    // (plan_item_id, estudiante_id) de la migración 15 — así cada celda
    // se guarda o actualiza sin importar si ya existía.
    await conn.query(
      `INSERT INTO notas
        (id, estudiante_id, materia_id, periodo_id, docente_id, tipo_nota, valor, valor_max, peso_pct, plan_item_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, 10.00, ?, ?)
       ON DUPLICATE KEY UPDATE valor = VALUES(valor), docente_id = VALUES(docente_id), peso_pct = VALUES(peso_pct)`,
      [randomUUID(), estudiante_id, item.materia_id, item.periodo_id, docenteId, item.nombre.slice(0, 60), valorNum, item.peso_pct, plan_item_id]
    );

    await conn.commit();

    await notificarReporte(req.app.get('io'), estudiante_id, {
      motivo: 'nota',
      materia_id: item.materia_id,
      plan_item_id,
    });
    await tareasController.emitirActualizacionPlanMateria(
      req.app.get('io'),
      item.materia_id,
      grupoId,
      { actividad_id: plan_item_id }
    );

    return res.json({ ok: true, mensaje: 'Celda guardada.', valor: valorNum });
  } catch (err) {
    await conn.rollback();
    if (err.errno === 3819 || /chk_valor|chk_peso/.test(err.message || '')) {
      return res.status(400).json({ ok: false, mensaje: 'El valor no cumple las reglas de validación.' });
    }
    console.error('guardarCelda plan-evaluacion:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  } finally {
    conn.release();
  }
};

// ────────────────────────────────────────────────────────────
//  GET /api/plan-evaluacion/materias-curso/:grupoId
//  Materias activas del curso. Acceso: admin/superadmin de la institución
//  o docente asignado a alguna materia de ese grupo.
// ────────────────────────────────────────────────────────────
exports.listarMateriasDeCurso = async (req, res) => {
  const { grupoId } = req.params;

  try {
    const [grupos] = await pool.query(
      `SELECT g.id, gr.institucion_id
       FROM grupos g JOIN grados gr ON gr.id = g.grado_id
       WHERE g.id = ?`,
      [grupoId]
    );
    const grupo = grupos.length ? grupos[0] : null;
    if (!grupo) return res.status(404).json({ ok: false, mensaje: 'Curso no encontrado.' });

    const esAdmin = req.usuario.rol === 'superadmin'
      || (req.usuario.rol === 'admin' && grupo.institucion_id === req.usuario.institucion_id);
    const asignaciones = await materiasConDocentesDeGrupo(pool, grupoId);
    const propias = req.usuario.rol === 'docente'
      ? asignaciones.filter(m => m.docente_id === req.usuario.id)
      : asignaciones;
    if (!esAdmin && !propias.length) {
      return res.status(403).json({ ok: false, mensaje: 'No tienes permiso para ver las materias de este curso.' });
    }

    const visibles = esAdmin ? asignaciones : propias;
    const porMateria = new Map();
    for (const asignacion of visibles) {
      if (!porMateria.has(asignacion.materia_id)) {
        porMateria.set(asignacion.materia_id, {
          id: asignacion.materia_id,
          nombre: asignacion.materia,
          docentes: new Set(),
        });
      }
      if (asignacion.docente_id) porMateria.get(asignacion.materia_id).docentes.add(asignacion.docente_id);
    }
    const materias = [...porMateria.values()]
      .map(m => ({ id: m.id, nombre: m.nombre, tiene_docente: m.docentes.size }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

    return res.json({ ok: true, materias });
  } catch (err) {
    console.error('listarMateriasDeCurso plan-evaluacion:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};
