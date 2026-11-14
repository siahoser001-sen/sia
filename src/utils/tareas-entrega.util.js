// ============================================================
//  tareas-entrega.util.js — Reglas compartidas por las entregas
//  de tareas y sus archivos (tareas.controller.js y
//  tareas-entrega-archivos.controller.js).
// ============================================================

const pool = require('../config/db');
const {
  materiaPerteneceAlGrupo,
  docenteAsignadoEnGrupo,
} = require('./materias-curso.util');

const MAX_ARCHIVOS_ENTREGA = 5;

function soloFecha(valor) {
  if (!valor) return null;
  if (valor instanceof Date) return valor.toISOString().slice(0, 10);
  return String(valor).slice(0, 10);
}

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

async function obtenerTarea(tareaId) {
  const [rows] = await pool.query(`SELECT * FROM tareas WHERE id = ? LIMIT 1`, [tareaId]);
  return rows.length ? rows[0] : null;
}

async function obtenerPeriodo(periodoId) {
  if (!periodoId) return null;
  const [rows] = await pool.query(
    `SELECT id, nombre, anio_lectivo, fecha_inicio, fecha_fin
     FROM periodos_academicos WHERE id = ? LIMIT 1`,
    [periodoId]
  );
  return rows.length ? rows[0] : null;
}

function periodoAbierto(periodo, hoy = hoyISO()) {
  if (!periodo) return false;
  return hoy >= soloFecha(periodo.fecha_inicio) && hoy <= soloFecha(periodo.fecha_fin);
}

async function estudianteMatriculado(estudianteId, grupoId) {
  const [rows] = await pool.query(
    `SELECT 1 FROM matriculas
     WHERE estudiante_id = ? AND grupo_id = ? AND estado = 'activa' LIMIT 1`,
    [estudianteId, grupoId]
  );
  return rows.length > 0;
}

// Mismo criterio que _puedeVerTareas de tareas.controller.js:
// admin/superadmin de la institución, docente asignado a la materia
// en el curso de la tarea o director de ese curso.
async function puedeVerEntregas(usuario, tarea) {
  const [rows] = await pool.query(
    `SELECT m.id, m.institucion_id FROM materias m WHERE m.id = ? LIMIT 1`,
    [tarea.materia_id]
  );
  if (!rows.length) return false;
  const materia = rows[0];
  if (usuario.rol === 'superadmin') return true;
  if (usuario.rol === 'admin') return materia.institucion_id === usuario.institucion_id;
  if (usuario.rol === 'docente') {
    const [director] = await pool.query(
      `SELECT 1 FROM grupos WHERE id = ? AND director_id = ? LIMIT 1`,
      [tarea.grupo_id, usuario.id]
    );
    if (director.length) return true;
    if (!(await materiaPerteneceAlGrupo(pool, materia.id, tarea.grupo_id))) return false;
    return docenteAsignadoEnGrupo(pool, materia.id, usuario.id, tarea.grupo_id);
  }
  return false;
}

function normalizarArchivo(row) {
  return {
    id: row.id,
    nombre_original: row.nombre_original,
    mime_type: row.mime_type,
    extension: String(row.nombre_original || '').split('.').pop().toLowerCase(),
    tamanio_bytes: row.tamanio_bytes,
    creado_en: row.creado_en,
    url: `/api/tareas/${row.tarea_id}/entrega/archivos/${row.id}`,
  };
}

// Archivos de una entrega concreta.
async function archivosDeEntrega(entregaId) {
  const [rows] = await pool.query(
    `SELECT ea.archivo_id AS id, ar.nombre_original, ar.mime_type, ar.tamanio_bytes,
            ea.creado_en, e.tarea_id
     FROM entregas_archivos ea
     JOIN archivos ar ON ar.id = ea.archivo_id
     JOIN entregas_tareas e ON e.id = ea.entrega_id
     WHERE ea.entrega_id = ?
     ORDER BY ea.creado_en ASC`,
    [entregaId]
  );
  return rows.map(normalizarArchivo);
}

// Archivos de todas las entregas de una tarea, agrupados por estudiante.
async function archivosPorTarea(tareaId) {
  const [rows] = await pool.query(
    `SELECT e.estudiante_id, ea.archivo_id AS id, ar.nombre_original, ar.mime_type,
            ar.tamanio_bytes, ea.creado_en, e.tarea_id
     FROM entregas_tareas e
     JOIN entregas_archivos ea ON ea.entrega_id = e.id
     JOIN archivos ar ON ar.id = ea.archivo_id
     WHERE e.tarea_id = ?
     ORDER BY ea.creado_en ASC`,
    [tareaId]
  );
  const mapa = {};
  for (const row of rows) {
    if (!mapa[row.estudiante_id]) mapa[row.estudiante_id] = [];
    mapa[row.estudiante_id].push(normalizarArchivo(row));
  }
  return mapa;
}

// Archivos del estudiante en todas las tareas publicadas de su curso,
// agrupados por tarea (una sola consulta para el listado del estudiante).
async function archivosPorEstudianteGrupo(estudianteId, grupoId) {
  const [rows] = await pool.query(
    `SELECT e.tarea_id, ea.archivo_id AS id, ar.nombre_original, ar.mime_type,
            ar.tamanio_bytes, ea.creado_en
     FROM entregas_tareas e
     JOIN entregas_archivos ea ON ea.entrega_id = e.id
     JOIN archivos ar ON ar.id = ea.archivo_id
     JOIN tareas t ON t.id = e.tarea_id
     WHERE e.estudiante_id = ? AND t.grupo_id = ?
     ORDER BY ea.creado_en ASC`,
    [estudianteId, grupoId]
  );
  const mapa = {};
  for (const row of rows) {
    if (!mapa[row.tarea_id]) mapa[row.tarea_id] = [];
    mapa[row.tarea_id].push(normalizarArchivo(row));
  }
  return mapa;
}

async function contarArchivosEntrega(entregaId, conn = pool) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS total FROM entregas_archivos WHERE entrega_id = ?`,
    [entregaId]
  );
  return Number(rows[0]?.total || 0);
}

module.exports = {
  MAX_ARCHIVOS_ENTREGA,
  soloFecha,
  hoyISO,
  obtenerTarea,
  obtenerPeriodo,
  periodoAbierto,
  estudianteMatriculado,
  puedeVerEntregas,
  archivosDeEntrega,
  archivosPorTarea,
  archivosPorEstudianteGrupo,
  contarArchivosEntrega,
};
