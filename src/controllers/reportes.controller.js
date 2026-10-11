// ============================================================
//  reportes.controller.js — MySQL
//  "Reporte del estudiante" (expediente) de 3 páginas:
//    1) Datos del estudiante + resumen académico (materias con
//       promedio y fallas en el periodo activo).
//    2) Compromisos  (observación + compromiso, estado,
//       seguimiento, fechas).
//    3) Observaciones cronológicas (académica / comportamiento /
//       positiva / general).
//    4) Páginas personalizadas (punto 4): bloques de texto y cuadros
//       (CRUD /estudiante/:estudianteId/paginas) que entran en la
//       exportación completa.
//
//  Además genera las salidas impresas del punto 3:
//    GET /api/reportes/estudiante/:estudianteId/imprimir
//      ?formato=pdf|word  & paginas=1|2|3|todas|<id de página personalizada>
//    - PDF con pdfkit junto con un PDF combinado (todas las páginas
//      con membrete, número de página y pie).
//    - Word como documento HTML apto para Word (application/msword).
//
//  Permisos finos (dependen de los datos, por eso se validan aquí):
//    • Ver/imprimir: admin/superadmin de la institución, docente con
//      acceso al curso del estudiante (director del grupo o que dicta
//      una materia de ese grupo), o el propio estudiante / acudiente
//      vinculado.
//    • Gestionar (crear/editar/eliminar compromisos y observaciones):
//      admin/superadmin de la institución o docente con acceso al
//      curso del estudiante. Estudiante y acudiente solo leen.
// ============================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PDFDocument = require('pdfkit');
const pool = require('../config/db');
const { randomUUID } = require('crypto');

// ── Helpers ─────────────────────────────────────────────────

async function datosEstudianteBasico(estudianteId) {
  const [rows] = await pool.query(
    `SELECT id, institucion_id, nombres, apellidos, tipo_documento,
            numero_documento, email, telefono, direccion,
            fecha_nacimiento, genero, foto_url
     FROM usuarios WHERE id = ?`,
    [estudianteId]
  );
  return rows.length ? rows[0] : null;
}

// Docente con acceso al estudiante: director de su grupo activo o
// docente que dicta al menos una materia de ese grupo.
async function accesoDocenteAlEstudiante(req, estudianteId) {
  const [rows] = await pool.query(
    `SELECT 1
     FROM matriculas mt JOIN grupos g ON g.id = mt.grupo_id
     WHERE mt.estudiante_id = ? AND mt.estado = 'activa'
       AND (g.director_id = ?
            OR EXISTS (SELECT 1 FROM docentes_materias dm
                       WHERE dm.grupo_id = g.id AND dm.docente_id = ?))
     LIMIT 1`,
    [estudianteId, req.usuario.id, req.usuario.id]
  );
  return rows.length > 0;
}

async function puedeVerEstudiante(req, estudianteId, est) {
  if (!est) return false;
  if (req.usuario.rol === 'superadmin') return true;
  if (req.usuario.rol === 'admin') return est.institucion_id === req.usuario.institucion_id;
  if (req.usuario.rol === 'docente') return accesoDocenteAlEstudiante(req, estudianteId);
  if (req.usuario.rol === 'estudiante') return estudianteId === req.usuario.id;
  const [rows] = await pool.query(
    `SELECT 1 FROM acudientes_estudiantes WHERE acudiente_id = ? AND estudiante_id = ? LIMIT 1`,
    [req.usuario.id, estudianteId]
  );
  return rows.length > 0;
}

async function puedeGestionarEstudiante(req, estudianteId, est) {
  if (!est) return false;
  if (req.usuario.rol === 'superadmin') return true;
  if (req.usuario.rol === 'admin') return est.institucion_id === req.usuario.institucion_id;
  if (req.usuario.rol === 'docente') return accesoDocenteAlEstudiante(req, estudianteId);
  return false;
}

// Devuelve { est, puedeVer, puedeGestionar } o { error }.
async function prepararContexto(req, estudianteId) {
  const est = await datosEstudianteBasico(estudianteId);
  if (!est) return { error: { status: 404, mensaje: 'No existe ese estudiante.' } };
  const puedeVer = await puedeVerEstudiante(req, estudianteId, est);
  if (!puedeVer) {
    return { error: { status: 403, mensaje: 'No tienes permiso para ver el reporte de este estudiante.' } };
  }
  return { est, puedeVer, puedeGestionar: await puedeGestionarEstudiante(req, estudianteId, est) };
}

function promedioDesdeNotas(rows) {
  // rows: [{ valor, valor_max, peso_pct }]
  if (!rows.length) return { promedio: null, pesos: 0 };
  let ponderada = 0, pesos = 0;
  for (const n of rows) {
    ponderada += (Number(n.valor) / Number(n.valor_max)) * Number(n.peso_pct);
    pesos += Number(n.peso_pct);
  }
  return { promedio: pesos > 0 ? Number(((ponderada / pesos) * 10).toFixed(2)) : null, pesos };
}

// Periodo marcado como activo de la institución (mismo criterio que
// notas/resumen/plan-de-evaluación).
async function resolverPeriodoReporte(institucionId) {
  const [rows] = await pool.query(
    `SELECT id FROM periodos_academicos WHERE institucion_id = ? AND activo = TRUE LIMIT 1`,
    [institucionId]
  );
  return rows.length ? rows[0].id : null;
}

async function datosPeriodo(periodoId) {
  if (!periodoId) return null;
  const [rows] = await pool.query(
    `SELECT id, nombre, anio_lectivo, fecha_inicio, fecha_fin FROM periodos_academicos WHERE id = ?`,
    [periodoId]
  );
  return rows.length ? rows[0] : null;
}

// Reúne TODOS los datos que pintan el reporte (página 1) y que también
// usan los formatos de impresión. Devuelve null si no existe el estudiante.
async function reunirDatosReporte(estudianteId) {
  const est = await datosEstudianteBasico(estudianteId);
  if (!est) return null;

  const [instRows] = await pool.query(
    `SELECT nombre, codigo_dane, logo_url FROM instituciones WHERE id = ?`,
    [est.institucion_id]
  );
  const institucion = instRows.length ? instRows[0] : { nombre: null, codigo_dane: null, logo_url: null };

  const [matriculasRows] = await pool.query(
    `SELECT mt.id, mt.grupo_id, mt.anio_lectivo, mt.fecha_ingreso, mt.estado,
            g.nombre AS grupo_nombre, gr.nombre AS grado_nombre
     FROM matriculas mt
     JOIN grupos g ON g.id = mt.grupo_id
     JOIN grados gr ON gr.id = g.grado_id
     WHERE mt.estudiante_id = ? AND mt.estado = 'activa'
     ORDER BY mt.anio_lectivo DESC
     LIMIT 1`,
    [estudianteId]
  );
  const matricula = matriculasRows.length ? matriculasRows[0] : null;

  let director = null;
  if (matricula && matricula.grupo_id) {
    const [dirRows] = await pool.query(
      `SELECT u.id, u.nombres, u.apellidos, u.email, u.telefono
       FROM grupos g
       JOIN usuarios u ON u.id = g.director_id
       WHERE g.id = ?`,
      [matricula.grupo_id]
    );
    director = dirRows.length ? dirRows[0] : null;
  }

  const periodoId = await resolverPeriodoReporte(est.institucion_id);
  const periodo = await datosPeriodo(periodoId);
  const anioLectivo = matricula ? matricula.anio_lectivo : (periodo ? periodo.anio_lectivo : new Date().getFullYear());

  // Materias del curso del estudiante: las del grupo + las generales de
  // la institución que estén asignadas a ESTE curso vía docentes_materias.
  let materias = [];
  if (matricula) {
    const [mRows] = await pool.query(
      `SELECT m.id AS materia_id, m.nombre AS materia_nombre, a.nombre AS area_nombre, a.color_hex
       FROM materias m
       JOIN areas a ON a.id = m.area_id
       WHERE m.activa = TRUE
         AND (m.grupo_id = ?
              OR (m.grado_id IS NULL AND m.institucion_id = ?
                  AND EXISTS (SELECT 1 FROM docentes_materias dm
                              WHERE dm.materia_id = m.id AND dm.grupo_id = ?)))
       ORDER BY a.nombre, m.nombre`,
      [matricula.grupo_id, est.institucion_id, matricula.grupo_id]
    );
    materias = mRows;
  }

  const idsMaterias = materias.map(m => m.materia_id);
  let notas = [], fallasRows = [], asistenciaRows = [];

  if (idsMaterias.length && matricula) {
    const inMaterias = idsMaterias.map(() => '?').join(', ');

    const [nRows] = await pool.query(
      `SELECT materia_id, valor, valor_max, peso_pct FROM notas
       WHERE estudiante_id = ? AND periodo_id = ?
         AND materia_id IN (${inMaterias})`,
      [estudianteId, periodoId, ...idsMaterias]
    );
    notas = nRows;

    const rango = periodo && periodo.fecha_inicio ? [periodo.fecha_inicio, periodo.fecha_fin] : null;
    let sqlFallas = `
      SELECT materia_id, COUNT(*) AS fallas FROM asistencia
      WHERE estudiante_id = ? AND estado = 'ausente'
        AND materia_id IN (${inMaterias})`;
    const paramsFallas = [estudianteId, ...idsMaterias];
    if (rango) {
      sqlFallas += ' AND fecha BETWEEN ? AND ?';
      paramsFallas.push(...rango);
    }
    sqlFallas += ' GROUP BY materia_id';
    const [fRows] = await pool.query(sqlFallas, paramsFallas);
    fallasRows = fRows;

    let sqlAsis = `
      SELECT estado, COUNT(*) AS total FROM asistencia
      WHERE estudiante_id = ? AND materia_id IN (${inMaterias})`;
    const paramsAsis = [estudianteId, ...idsMaterias];
    if (rango) {
      sqlAsis += ' AND fecha BETWEEN ? AND ?';
      paramsAsis.push(...rango);
    }
    sqlAsis += ' GROUP BY estado';
    const [aRows] = await pool.query(sqlAsis, paramsAsis);
    asistenciaRows = aRows;
  }

  const notasPorMateria = {};
  for (const n of notas) (notasPorMateria[n.materia_id] ||= []).push(n);
  const fallasPorMateria = {};
  for (const f of fallasRows) fallasPorMateria[f.materia_id] = f.fallas;
  const asisMap = {};
  for (const a of asistenciaRows) asisMap[a.estado] = a.total;

  const materiasRes = materias.map(m => {
    const { promedio } = promedioDesdeNotas(notasPorMateria[m.materia_id] || []);
    return {
      materia_id: m.materia_id,
      materia_nombre: m.materia_nombre,
      area_nombre: m.area_nombre,
      color_hex: m.color_hex,
      promedio,
      fallas: fallasPorMateria[m.materia_id] || 0,
    };
  });

  // Regla de negocio: promedio general = promedio simple de los promedios
  // por materia (todas pesan igual).
  const conPromedio = materiasRes.filter(m => m.promedio !== null);
  const promedioGeneral = conPromedio.length
    ? Number((conPromedio.reduce((a, m) => a + m.promedio, 0) / conPromedio.length).toFixed(2))
    : null;

  const [acuRows] = await pool.query(
    `SELECT u.id, u.nombres, u.apellidos, u.email, u.telefono, ae.parentesco,
            ae.es_principal
     FROM acudientes_estudiantes ae
     JOIN usuarios u ON u.id = ae.acudiente_id
     WHERE ae.estudiante_id = ?
     ORDER BY ae.es_principal DESC, ae.acudiente_id
     LIMIT 1`,
    [estudianteId]
  );
  const acudiente = acuRows.length ? acuRows[0] : null;

  const [compRows] = await pool.query(
    `SELECT COUNT(*) AS total, COALESCE(SUM(estado = 'pendiente'), 0) AS pendientes
     FROM reporte_compromisos WHERE estudiante_id = ?`,
    [estudianteId]
  );
  const [obsRows] = await pool.query(
    `SELECT COUNT(*) AS total FROM reporte_observaciones WHERE estudiante_id = ?`,
    [estudianteId]
  );

  return {
    estudiante: est,
    institucion,
    matricula: matricula
      ? {
          grupo_id: matricula.grupo_id,
          grupo_nombre: matricula.grupo_nombre,
          grado_nombre: matricula.grado_nombre,
          anio_lectivo: matricula.anio_lectivo,
          fecha_ingreso: matricula.fecha_ingreso,
        }
      : null,
    periodo: {
      id: periodoId,
      nombre: periodo ? periodo.nombre : null,
      anio_lectivo: anioLectivo,
      descripcion: periodo ? `${periodo.nombre} — ${anioLectivo}` : 'Sin periodo activo',
    },
    materias: materiasRes,
    promedio_general: promedioGeneral,
    asistencia: {
      presentes: asisMap['presente'] || 0,
      retardos: asisMap['tarde'] || 0,
      faltas: asisMap['ausente'] || 0,
      justificadas: asisMap['excusado'] || 0,
    },
    director,
    acudiente,
    compromisos: { total: compRows[0].total, pendientes: compRows[0].pendientes },
    observaciones_total: obsRows[0].total,
  };
}

async function consultarCompromisos(estudianteId) {
  const [rows] = await pool.query(
    `SELECT rc.id, rc.motivo, rc.observacion, rc.compromiso, rc.estado,
            rc.fecha_compromiso, rc.fecha_limite, rc.fecha_cumplido,
            rc.seguimiento, rc.created_at, rc.rol_creador,
            u.nombres AS creador_nombres, u.apellidos AS creador_apellidos
     FROM reporte_compromisos rc
     JOIN usuarios u ON u.id = rc.creado_por
     WHERE rc.estudiante_id = ?
     ORDER BY (rc.estado = 'pendiente') DESC, rc.fecha_compromiso ASC, rc.created_at DESC`,
    [estudianteId]
  );
  return rows;
}

async function consultarObservaciones(estudianteId) {
  const [rows] = await pool.query(
    `SELECT ro.id, ro.tipo, ro.observacion, ro.created_at, ro.rol_creador,
            u.nombres AS creador_nombres, u.apellidos AS creador_apellidos
     FROM reporte_observaciones ro
     JOIN usuarios u ON u.id = ro.creado_por
     WHERE ro.estudiante_id = ?
     ORDER BY ro.created_at DESC`,
    [estudianteId]
  );
  return rows;
}

// Formateo compartido entre PDF y Word.
function fechaTexto(v) {
  if (v === null || v === undefined || v === '') return '—';
  if (v instanceof Date && !isNaN(v.getTime())) return v.toLocaleDateString('es-CO');
  if (typeof v === 'string') {
    const d = new Date(v.length === 10 ? v + 'T00:00:00' : v);
    return isNaN(d.getTime()) ? v : d.toLocaleDateString('es-CO');
  }
  return String(v);
}

function fechaHoraTexto(v) {
  if (v === null || v === undefined || v === '') return '—';
  const d = v instanceof Date ? v : new Date(v);
  if (!isNaN(d.getTime())) {
    return d.toLocaleDateString('es-CO') + ' · ' + d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
  }
  return String(v);
}

function generoTexto(g) {
  return { M: 'Masculino', F: 'Femenino', O: 'Otro' }[g] || g || '—';
}

function escHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function slug(s) {
  const base = (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const limpio = base.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
  return limpio || 'estudiante';
}

const ETIQUETA_TIPO_OBS = { academica: 'Académica', comportamiento: 'Comportamiento', positiva: 'Positiva', general: 'General' };
const TIPOS_OBSERVACION = ['academica', 'comportamiento', 'positiva', 'general'];

// ── Bloques de páginas personalizadas (punto 4) ────────────────
// Modelo JSON (contenido_json):
//   { tipo:'titulo',  nivel:1|2|3, texto, alineacion:'left|center|right',
//     negrita, cursiva, color }
//   { tipo:'parrafo', texto, alineacion, tamano:'pequeno|normal|grande',
//     negrita, cursiva, color }
//   { tipo:'lista',   items:[...], ordenada, alineacion, tamano, color }
//   { tipo:'tabla',   filas, columnas, celdas:[{v, a, c}] (raya mayor),
//     fondo, bordes }
const TIPOS_BLOQUE = new Set(['titulo', 'parrafo', 'lista', 'tabla', 'caja', 'linea', 'cuadro_num']);
const ALINEACIONES_BLOQUE = new Set(['left', 'center', 'right']);
const TAMANOS_TEXTO = { pequeno: 1, normal: 2, grande: 3 };

function esColorHex(v) {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
}

function textoBloque(v, max) {
  if (v === null || v === undefined) return '';
  return String(v).slice(0, max || 5000);
}

function clampNum(x, min, max) {
  const n = Math.floor(Number(x));
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function sanitizarBloques(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter(b => b && typeof b === 'object' && TIPOS_BLOQUE.has(b.tipo)).map(b => {
    const base = {
      tipo: b.tipo,
      alineacion: ALINEACIONES_BLOQUE.has(b.alineacion) ? b.alineacion : 'left',
      color: esColorHex(b.color) ? b.color : '#111827',
    };
    if (b.tipo === 'titulo') {
      base.nivel = clampNum(b.nivel, 1, 3);
      base.texto = textoBloque(b.texto, 600);
      base.negrita = !!b.negrita;
      base.cursiva = !!b.cursiva;
    } else if (b.tipo === 'parrafo') {
      base.tamano = TAMANOS_TEXTO[b.tamano] ? b.tamano : 'normal';
      base.texto = textoBloque(b.texto, 5000);
      base.negrita = !!b.negrita;
      base.cursiva = !!b.cursiva;
    } else if (b.tipo === 'lista') {
      base.tamano = TAMANOS_TEXTO[b.tamano] ? b.tamano : 'normal';
      base.ordenada = !!b.ordenada;
      base.items = (Array.isArray(b.items) ? b.items : [])
        .map(x => textoBloque(x, 1000)).slice(0, 50);
    } else if (b.tipo === 'tabla') {
      base.filas = clampNum(b.filas, 1, 20);
      base.columnas = clampNum(b.columnas, 1, 10);
      base.fondo = esColorHex(b.fondo) ? b.fondo : '#ffffff';
      base.bordes = esColorHex(b.bordes) ? b.bordes : '#d1d5db';
      const arr = Array.isArray(b.celdas) ? b.celdas : [];
      base.celdas = [];
      for (let i = 0; i < base.filas * base.columnas; i++) {
        const c = arr[i] && typeof arr[i] === 'object' ? arr[i] : {};
        base.celdas.push({
          v: textoBloque(c.v, 1000),
          a: c.a === 'center' || c.a === 'right' ? c.a : 'left',
          c: esColorHex(c.c) ? c.c : '#111827',
        });
      }
    } else if (b.tipo === 'caja') {
      base.tamano = TAMANOS_TEXTO[b.tamano] ? b.tamano : 'normal';
      base.texto = textoBloque(b.texto, 3000);
      base.fondo = esColorHex(b.fondo) ? b.fondo : '#f3f4f6';
      base.negrita = !!b.negrita;
      base.cursiva = !!b.cursiva;
    } else if (b.tipo === 'linea') {
      base.color = esColorHex(b.color) ? b.color : '#9ca3af';
      base.grosor = clampNum(b.grosor, 1, 6);
    } else if (b.tipo === 'cuadro_num') {
      base.numero = textoBloque(b.numero, 20);
      base.texto = textoBloque(b.texto, 200);
      base.color = esColorHex(b.color) ? b.color : '#111827';
    }
    return base;
  });
}

function parseContenido(json) {
  if (!json) return [];
  let raw = json;
  if (typeof json === 'string') {
    try { raw = JSON.parse(json); } catch (e) { return []; }
  }
  return sanitizarBloques(raw);
}

// ────────────────────────────────────────────────────────────
//  GET /api/reportes/estudiante/:estudianteId
//  Página 1 del reporte: datos + resumen académico (materias del
//  curso con promedio y fallas en el periodo activo), asistencia,
//  acudiente principal y conteos de compromisos/observaciones.
// ────────────────────────────────────────────────────────────
exports.obtenerReporte = async (req, res) => {
  const { estudianteId } = req.params;

  try {
    const ctx = await prepararContexto(req, estudianteId);
    if (ctx.error) return res.status(ctx.error.status).json({ ok: false, mensaje: ctx.error.mensaje });

    const datos = await reunirDatosReporte(estudianteId);
    if (!datos) return res.status(404).json({ ok: false, mensaje: 'No existe ese estudiante.' });

    const e = datos.estudiante;
    return res.json({
      ok: true,
      puede_gestionar: ctx.puedeGestionar,
      estudiante: {
        id: e.id,
        nombres: e.nombres,
        apellidos: e.apellidos,
        tipo_documento: e.tipo_documento,
        numero_documento: e.numero_documento,
        email: e.email,
        telefono: e.telefono,
        direccion: e.direccion,
        fecha_nacimiento: e.fecha_nacimiento,
        genero: e.genero,
        foto_url: e.foto_url,
      },
      institucion: datos.institucion,
      matricula: datos.matricula,
      director: datos.director,
      periodo: datos.periodo,
      materias: datos.materias,
      promedio_general: datos.promedio_general,
      asistencia: datos.asistencia,
      acudiente: datos.acudiente,
      compromisos: datos.compromisos,
      observaciones_total: datos.observaciones_total,
    });
  } catch (err) {
    console.error('obtenerReporte:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// ── Compromisos (página 2) ─────────────────────────────────

exports.listarCompromisos = async (req, res) => {
  const { estudianteId } = req.params;
  try {
    const ctx = await prepararContexto(req, estudianteId);
    if (ctx.error) return res.status(ctx.error.status).json({ ok: false, mensaje: ctx.error.mensaje });

    const compromisos = await consultarCompromisos(estudianteId);
    return res.json({ ok: true, compromisos });
  } catch (err) {
    console.error('listarCompromisos:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

exports.crearCompromiso = async (req, res) => {
  const { estudianteId } = req.params;
  try {
    const ctx = await prepararContexto(req, estudianteId);
    if (ctx.error) return res.status(ctx.error.status).json({ ok: false, mensaje: ctx.error.mensaje });
    if (!ctx.puedeGestionar) {
      return res.status(403).json({ ok: false, mensaje: 'Solo el admin o un docente con acceso al curso puede registrar compromisos.' });
    }

    const { motivo, observacion, compromiso, fecha_compromiso, fecha_limite } = req.body;
    if (!motivo || !String(motivo).trim()) {
      return res.status(400).json({ ok: false, mensaje: 'El motivo es obligatorio.' });
    }
    if (!compromiso || !String(compromiso).trim()) {
      return res.status(400).json({ ok: false, mensaje: 'El compromiso es obligatorio.' });
    }

    const id = randomUUID();
    const hoy = new Date().toISOString().slice(0, 10);
    await pool.query(
      `INSERT INTO reporte_compromisos
         (id, institucion_id, estudiante_id, creado_por, rol_creador,
          motivo, observacion, compromiso, estado, fecha_compromiso, fecha_limite)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pendiente', ?, ?)`,
      [
        id,
        ctx.est.institucion_id,
        estudianteId,
        req.usuario.id,
        req.usuario.rol,
        String(motivo).trim(),
        observacion ? String(observacion).trim() : null,
        String(compromiso).trim(),
        fecha_compromiso || hoy,
        fecha_limite || null,
      ]
    );
    return res.json({ ok: true, id, mensaje: 'Compromiso registrado.' });
  } catch (err) {
    console.error('crearCompromiso:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

exports.actualizarCompromiso = async (req, res) => {
  const { estudianteId, id } = req.params;
  try {
    const ctx = await prepararContexto(req, estudianteId);
    if (ctx.error) return res.status(ctx.error.status).json({ ok: false, mensaje: ctx.error.mensaje });
    if (!ctx.puedeGestionar) {
      return res.status(403).json({ ok: false, mensaje: 'Solo el admin o un docente con acceso al curso puede editar compromisos.' });
    }

    const [existRows] = await pool.query(
      `SELECT estado FROM reporte_compromisos WHERE id = ? AND estudiante_id = ?`,
      [id, estudianteId]
    );
    if (!existRows.length) return res.status(404).json({ ok: false, mensaje: 'No existe ese compromiso.' });

    const { motivo, observacion, compromiso, estado, fecha_compromiso, fecha_limite, seguimiento } = req.body;
    const campos = [], params = [];

    if (motivo !== undefined) { campos.push('motivo = ?'); params.push(String(motivo).trim()); }
    if (observacion !== undefined) { campos.push('observacion = ?'); params.push(observacion ? String(observacion).trim() : null); }
    if (compromiso !== undefined) { campos.push('compromiso = ?'); params.push(String(compromiso).trim()); }
    if (fecha_compromiso !== undefined) { campos.push('fecha_compromiso = ?'); params.push(fecha_compromiso || null); }
    if (fecha_limite !== undefined) { campos.push('fecha_limite = ?'); params.push(fecha_limite || null); }
    if (seguimiento !== undefined) { campos.push('seguimiento = ?'); params.push(seguimiento ? String(seguimiento).trim() : null); }

    if (estado !== undefined) {
      const nuevo = String(estado) === 'cumplido' ? 'cumplido' : 'pendiente';
      campos.push('estado = ?');
      params.push(nuevo);
      if (nuevo === 'cumplido') {
        campos.push('fecha_cumplido = COALESCE(fecha_cumplido, CURDATE())');
      } else {
        campos.push('fecha_cumplido = NULL');
      }
    }

    if (!campos.length) {
      return res.status(400).json({ ok: false, mensaje: 'No hay campos para actualizar.' });
    }

    await pool.query(
      `UPDATE reporte_compromisos SET ${campos.join(', ')} WHERE id = ? AND estudiante_id = ?`,
      [...params, id, estudianteId]
    );
    return res.json({ ok: true, mensaje: 'Compromiso actualizado.' });
  } catch (err) {
    console.error('actualizarCompromiso:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

exports.eliminarCompromiso = async (req, res) => {
  const { estudianteId, id } = req.params;
  try {
    const ctx = await prepararContexto(req, estudianteId);
    if (ctx.error) return res.status(ctx.error.status).json({ ok: false, mensaje: ctx.error.mensaje });
    if (!ctx.puedeGestionar) {
      return res.status(403).json({ ok: false, mensaje: 'Solo el admin o un docente con acceso al curso puede eliminar compromisos.' });
    }
    await pool.query(
      `DELETE FROM reporte_compromisos WHERE id = ? AND estudiante_id = ?`,
      [id, estudianteId]
    );
    return res.json({ ok: true, mensaje: 'Compromiso eliminado.' });
  } catch (err) {
    console.error('eliminarCompromiso:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// ── Observaciones (página 3) ───────────────────────────────

exports.listarObservaciones = async (req, res) => {
  const { estudianteId } = req.params;
  try {
    const ctx = await prepararContexto(req, estudianteId);
    if (ctx.error) return res.status(ctx.error.status).json({ ok: false, mensaje: ctx.error.mensaje });

    const observaciones = await consultarObservaciones(estudianteId);
    return res.json({ ok: true, observaciones });
  } catch (err) {
    console.error('listarObservaciones:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

exports.crearObservacion = async (req, res) => {
  const { estudianteId } = req.params;
  try {
    const ctx = await prepararContexto(req, estudianteId);
    if (ctx.error) return res.status(ctx.error.status).json({ ok: false, mensaje: ctx.error.mensaje });
    if (!ctx.puedeGestionar) {
      return res.status(403).json({ ok: false, mensaje: 'Solo el admin o un docente con acceso al curso puede registrar observaciones.' });
    }

    const { tipo, observacion } = req.body;
    if (!observacion || !String(observacion).trim()) {
      return res.status(400).json({ ok: false, mensaje: 'La observación es obligatoria.' });
    }
    const tipoFinal = TIPOS_OBSERVACION.includes(tipo) ? tipo : 'general';

    const id = randomUUID();
    await pool.query(
      `INSERT INTO reporte_observaciones
         (id, institucion_id, estudiante_id, creado_por, rol_creador, tipo, observacion)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        ctx.est.institucion_id,
        estudianteId,
        req.usuario.id,
        req.usuario.rol,
        tipoFinal,
        String(observacion).trim(),
      ]
    );
    return res.json({ ok: true, id, mensaje: 'Observación registrada.' });
  } catch (err) {
    console.error('crearObservacion:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

exports.actualizarObservacion = async (req, res) => {
  const { estudianteId, id } = req.params;
  try {
    const ctx = await prepararContexto(req, estudianteId);
    if (ctx.error) return res.status(ctx.error.status).json({ ok: false, mensaje: ctx.error.mensaje });
    if (!ctx.puedeGestionar) {
      return res.status(403).json({ ok: false, mensaje: 'Solo el admin o un docente con acceso al curso puede editar observaciones.' });
    }

    const [existRows] = await pool.query(
      `SELECT id FROM reporte_observaciones WHERE id = ? AND estudiante_id = ?`,
      [id, estudianteId]
    );
    if (!existRows.length) return res.status(404).json({ ok: false, mensaje: 'No existe esa observación.' });

    const { tipo, observacion } = req.body;
    const campos = [], params = [];

    if (tipo !== undefined) {
      campos.push('tipo = ?');
      params.push(TIPOS_OBSERVACION.includes(tipo) ? tipo : 'general');
    }
    if (observacion !== undefined) {
      if (!String(observacion).trim()) {
        return res.status(400).json({ ok: false, mensaje: 'La observación no puede quedar vacía.' });
      }
      campos.push('observacion = ?');
      params.push(String(observacion).trim());
    }

    if (!campos.length) {
      return res.status(400).json({ ok: false, mensaje: 'No hay campos para actualizar.' });
    }

    await pool.query(
      `UPDATE reporte_observaciones SET ${campos.join(', ')} WHERE id = ? AND estudiante_id = ?`,
      [...params, id, estudianteId]
    );
    return res.json({ ok: true, mensaje: 'Observación actualizada.' });
  } catch (err) {
    console.error('actualizarObservacion:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

exports.eliminarObservacion = async (req, res) => {
  const { estudianteId, id } = req.params;
  try {
    const ctx = await prepararContexto(req, estudianteId);
    if (ctx.error) return res.status(ctx.error.status).json({ ok: false, mensaje: ctx.error.mensaje });
    if (!ctx.puedeGestionar) {
      return res.status(403).json({ ok: false, mensaje: 'Solo el admin o un docente con acceso al curso puede eliminar observaciones.' });
    }
    await pool.query(
      `DELETE FROM reporte_observaciones WHERE id = ? AND estudiante_id = ?`,
      [id, estudianteId]
    );
    return res.json({ ok: true, mensaje: 'Observación eliminada.' });
  } catch (err) {
    console.error('eliminarObservacion:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// ── Páginas personalizadas (punto 4) ─────────────────────────

async function consultarPaginas(estudianteId) {
  const [rows] = await pool.query(
    `SELECT id, titulo, orden, contenido_json
     FROM reporte_paginas_personalizadas
     WHERE estudiante_id = ?
     ORDER BY orden ASC, created_at ASC`,
    [estudianteId]
  );
  return rows.map(r => ({
    id: r.id,
    nombre: r.titulo,
    orden: r.orden,
    contenido: parseContenido(r.contenido_json),
  }));
}

async function consultarPagina(estudianteId, id) {
  const [rows] = await pool.query(
    `SELECT id, titulo, orden, contenido_json
     FROM reporte_paginas_personalizadas
     WHERE id = ? AND estudiante_id = ?`,
    [id, estudianteId]
  );
  if (!rows.length) return null;
  const r = rows[0];
  return { id: r.id, nombre: r.titulo, orden: r.orden, contenido: parseContenido(r.contenido_json) };
}

exports.listarPaginas = async (req, res) => {
  const { estudianteId } = req.params;
  try {
    const ctx = await prepararContexto(req, estudianteId);
    if (ctx.error) return res.status(ctx.error.status).json({ ok: false, mensaje: ctx.error.mensaje });

    const paginas = await consultarPaginas(estudianteId);
    return res.json({ ok: true, paginas });
  } catch (err) {
    console.error('listarPaginas:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

exports.crearPagina = async (req, res) => {
  const { estudianteId } = req.params;
  try {
    const ctx = await prepararContexto(req, estudianteId);
    if (ctx.error) return res.status(ctx.error.status).json({ ok: false, mensaje: ctx.error.mensaje });
    if (!ctx.puedeGestionar) {
      return res.status(403).json({ ok: false, mensaje: 'Solo el admin o un docente con acceso al curso puede administrar páginas personalizadas.' });
    }

    const titulo = String(req.body.titulo || '').trim().slice(0, 120);
    if (!titulo) return res.status(400).json({ ok: false, mensaje: 'El título de la página es obligatorio.' });
    const contenido = sanitizarBloques(req.body.contenido);

    let orden = Number(req.body.orden);
    if (!Number.isFinite(orden)) {
      const [mx] = await pool.query(
        `SELECT COALESCE(MAX(orden), 0) + 1 AS sig FROM reporte_paginas_personalizadas WHERE estudiante_id = ?`,
        [estudianteId]
      );
      orden = mx[0].sig;
    }

    const id = randomUUID();
    await pool.query(
      `INSERT INTO reporte_paginas_personalizadas
         (id, institucion_id, estudiante_id, creado_por, titulo, contenido_json, orden)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, ctx.est.institucion_id, estudianteId, req.usuario.id, titulo, JSON.stringify(contenido), orden]
    );
    return res.json({ ok: true, id, mensaje: 'Página creada.' });
  } catch (err) {
    console.error('crearPagina:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

exports.actualizarPagina = async (req, res) => {
  const { estudianteId, id } = req.params;
  try {
    const ctx = await prepararContexto(req, estudianteId);
    if (ctx.error) return res.status(ctx.error.status).json({ ok: false, mensaje: ctx.error.mensaje });
    if (!ctx.puedeGestionar) {
      return res.status(403).json({ ok: false, mensaje: 'Solo el admin o un docente con acceso al curso puede administrar páginas personalizadas.' });
    }

    const exist = await consultarPagina(estudianteId, id);
    if (!exist) return res.status(404).json({ ok: false, mensaje: 'No existe esa página.' });

    const campos = [], params = [];
    if (req.body.titulo !== undefined) {
      const t = String(req.body.titulo).trim();
      if (!t) return res.status(400).json({ ok: false, mensaje: 'El título no puede quedar vacío.' });
      campos.push('titulo = ?');
      params.push(t.slice(0, 120));
    }
    if (req.body.orden !== undefined) {
      const o = Number(req.body.orden);
      if (!Number.isFinite(o)) return res.status(400).json({ ok: false, mensaje: 'El orden debe ser un número.' });
      campos.push('orden = ?');
      params.push(o);
    }
    if (req.body.contenido !== undefined) {
      campos.push('contenido_json = ?');
      params.push(JSON.stringify(sanitizarBloques(req.body.contenido)));
    }

    if (!campos.length) return res.status(400).json({ ok: false, mensaje: 'No hay campos para actualizar.' });

    await pool.query(
      `UPDATE reporte_paginas_personalizadas SET ${campos.join(', ')} WHERE id = ? AND estudiante_id = ?`,
      [...params, id, estudianteId]
    );
    return res.json({ ok: true, mensaje: 'Página actualizada.' });
  } catch (err) {
    console.error('actualizarPagina:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

exports.eliminarPagina = async (req, res) => {
  const { estudianteId, id } = req.params;
  try {
    const ctx = await prepararContexto(req, estudianteId);
    if (ctx.error) return res.status(ctx.error.status).json({ ok: false, mensaje: ctx.error.mensaje });
    if (!ctx.puedeGestionar) {
      return res.status(403).json({ ok: false, mensaje: 'Solo el admin o un docente con acceso al curso puede administrar páginas personalizadas.' });
    }
    await pool.query(
      `DELETE FROM reporte_paginas_personalizadas WHERE id = ? AND estudiante_id = ?`,
      [id, estudianteId]
    );
    return res.json({ ok: true, mensaje: 'Página eliminada.' });
  } catch (err) {
    console.error('eliminarPagina:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// ────────────────────────────────────────────────────────────
//  IMPRESIÓN / DESCARGA (punto 3)
//  GET /api/reportes/estudiante/:estudianteId/imprimir
//    ?formato=pdf|word  & paginas=1|2|3|todas
//  PDF: páginas individuales o combinadas (todas) con membrete,
//  número de página y pie. Word: documento HTML (.doc) con las
//  secciones pedidas y los estilos embebidos.
// ────────────────────────────────────────────────────────────

const PDF_CONTENIDO_X = 50;
const PDF_CONTENIDO_ANCHO = 512; // letter 612 − 2×50
const PDF_CONTENIDO_DER = PDF_CONTENIDO_X + PDF_CONTENIDO_ANCHO;

function pdfEncabezado(doc, datos) {
  const i = datos.institucion;
  doc.font('Helvetica-Bold').fontSize(15).fillColor('#111827')
    .text(i.nombre || 'Institución', { align: 'center' });
  if (i.codigo_dane) {
    doc.font('Helvetica').fontSize(9).fillColor('#6b7280')
      .text('DANE: ' + i.codigo_dane, { align: 'center' });
  }
  doc.moveDown(0.35);
  doc.font('Helvetica-Bold').fontSize(13.5).fillColor('#1e3a8a')
    .text('REPORTE ESTUDIANTIL', { align: 'center' });
  doc.moveDown(0.2);
  const e = datos.estudiante, m = datos.matricula;
  doc.font('Helvetica').fontSize(9).fillColor('#4b5563')
    .text(
      `${e.nombres} ${e.apellidos} · ${e.tipo_documento || ''} ${e.numero_documento || ''}` +
      (m ? ` · ${m.grado_nombre} ${m.grupo_nombre}` : ''),
      { align: 'center' }
    );
  doc.moveDown(0.5);
  doc.moveTo(PDF_CONTENIDO_X, doc.y).lineTo(PDF_CONTENIDO_DER, doc.y).lineWidth(1.2).strokeColor('#1f2937').stroke();
  doc.moveDown(0.6);
}

function pdfTitulo(doc, num, texto) {
  doc.font('Helvetica-Bold').fontSize(11.5).fillColor('#111827')
    .text(`${num}. ${texto}`);
  doc.moveDown(0.35);
}

function pdfCampo(doc, label, valor) {
  doc.font('Helvetica').fontSize(10).fillColor('#6b7280').text(`${label}: `, PDF_CONTENIDO_X, doc.y, { continued: true });
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#111827').text(String(valor), { width: 440 });
  doc.moveDown(0.4);
}

// Tabla simple: headers = [{ label, w, align }]; filas = [ [celdas...] ].
function pdfTabla(doc, headers, filas) {
  const altoHeader = 20;
  let y = doc.y;

  doc.rect(PDF_CONTENIDO_X, y, PDF_CONTENIDO_ANCHO, altoHeader).fill('#f3f4f6');
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#6b7280');
  let xCursor = PDF_CONTENIDO_X;
  for (const h of headers) {
    doc.text(h.label, xCursor, y + 6, { width: h.w, align: h.align || 'left' });
    xCursor += h.w;
  }
  y += altoHeader;
  doc.moveTo(PDF_CONTENIDO_X, y).lineTo(PDF_CONTENIDO_DER, y).lineWidth(1).strokeColor('#d1d5db').stroke();
  y += 4;

  doc.font('Helvetica').fontSize(9.5).fillColor('#111827');
  for (const fila of filas) {
    let alto = 16;
    const celdas = [];
    xCursor = PDF_CONTENIDO_X;
    headers.forEach((h, idx) => {
      const txt = String(fila[idx] !== null && fila[idx] !== undefined ? fila[idx] : '—');
      const altoTxt = doc.heightOfString(txt, { width: h.w });
      if (altoTxt > alto) alto = altoTxt;
      celdas.push({ txt, x: xCursor, w: h.w, align: h.align || 'left' });
      xCursor += h.w;
    });
    celdas.forEach(c => doc.text(c.txt, c.x, y, { width: c.w, align: c.align }));
    y += alto + 4;
    doc.moveTo(PDF_CONTENIDO_X, y - 4).lineTo(PDF_CONTENIDO_DER, y - 4).lineWidth(0.5).strokeColor('#e5e7eb').stroke();
  }
  doc.y = y + 2;
}

function pdfTarjeta(doc, titulo, detalle) {
  // detalle: [ [label, valor], ... ]
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#1e3a8a').text(titulo);
  doc.moveDown(0.2);
  doc.font('Helvetica').fontSize(9);
  for (const [lbl, val] of detalle) {
    if (val === null || val === undefined || val === '') continue;
    doc.fillColor('#6b7280').text(`${lbl}: `, PDF_CONTENIDO_X, doc.y, { continued: true });
    doc.font('Helvetica-Bold').fillColor('#111827').text(String(val), { width: 440 });
    doc.font('Helvetica').moveDown(0.3);
  }
  doc.moveDown(0.4);
}

function pdfSeccion1(doc, datos) {
  const e = datos.estudiante, m = datos.matricula;

  pdfTitulo(doc, 1, 'Datos del estudiante');
  pdfCampo(doc, 'Documento', `${e.tipo_documento || ''} ${e.numero_documento || ''}`);
  pdfCampo(doc, 'Fecha de nacimiento', fechaTexto(e.fecha_nacimiento));
  pdfCampo(doc, 'Género', generoTexto(e.genero));
  pdfCampo(doc, 'Matrícula', m ? `Año ${m.anio_lectivo} · ${m.grado_nombre} ${m.grupo_nombre} (desde ${fechaTexto(m.fecha_ingreso)})` : 'Sin matrícula activa');
  if (datos.director) {
    const d = datos.director;
    pdfCampo(doc, 'Director de curso', `${d.nombres || ''} ${d.apellidos || ''}${d.telefono ? ` · ${d.telefono}` : ''}`.trim() || '—');
  } else {
    pdfCampo(doc, 'Director de curso', m ? 'No definido' : '—');
  }
  pdfCampo(doc, 'Correo', e.email || '—');
  pdfCampo(doc, 'Teléfono', e.telefono || '—');
  pdfCampo(doc, 'Dirección', e.direccion || '—');
  doc.moveDown(0.3);

  pdfTitulo(doc, 2, `Resumen académico — ${datos.periodo.descripcion}`);
  const filas = datos.materias.map(x => [
    x.area_nombre,
    x.materia_nombre,
    x.promedio !== null ? x.promedio.toFixed(2) : '—',
    String(x.fallas),
  ]);
  if (!filas.length) {
    pdfCampo(doc, 'Materias', m ? 'Sin materias para este curso.' : 'El estudiante no tiene matrícula activa.');
  } else {
    pdfTabla(doc, [
      { label: 'Área', w: 170 }, { label: 'Materia', w: 192 },
      { label: 'Promedio', w: 75, align: 'center' }, { label: 'Fallas', w: 75, align: 'center' },
    ], filas);
  }

  doc.moveDown(0.4);
  pdfCampo(doc, 'Promedio general', datos.promedio_general !== null ? datos.promedio_general.toFixed(2) : '—');
  pdfCampo(doc, 'Asistencia del periodo', `Presentes: ${datos.asistencia.presentes} · Retardos: ${datos.asistencia.retardos} · Fallas: ${datos.asistencia.faltas} · Justificadas: ${datos.asistencia.justificadas}`);

  doc.moveDown(0.3);
  pdfTitulo(doc, 3, 'Acudiente');
  if (datos.acudiente) {
    const a = datos.acudiente;
    pdfCampo(doc, 'Nombre', `${a.nombres} ${a.apellidos}`);
    pdfCampo(doc, 'Parentesco', a.parentesco || '—');
    pdfCampo(doc, 'Teléfono', a.telefono || '—');
    pdfCampo(doc, 'Correo', a.email || '—');
  } else {
    pdfCampo(doc, 'Acudiente', 'Sin acudiente vinculado');
  }

  doc.moveDown(0.3);
  pdfTitulo(doc, 4, 'Expediente');
  pdfCampo(doc, 'Compromisos', `${datos.compromisos.total} registrados (${datos.compromisos.pendientes} pendientes)`);
  pdfCampo(doc, 'Observaciones', String(datos.observaciones_total));
}

function pdfSeccion2(doc, compromisos) {
  pdfTitulo(doc, 1, 'Compromisos');
  if (!compromisos.length) {
    pdfCampo(doc, 'Compromisos', 'No hay compromisos registrados.');
    return;
  }
  doc.font('Helvetica').fontSize(9).fillColor('#6b7280')
    .text('Registro académico o de convivencia que compromete al estudiante a mejorar un desempeño o comportamiento puntual.');
  doc.moveDown(0.5);
  for (const c of compromisos) {
    const detalle = [
      ['Motivo', c.motivo],
      ['Estado', c.estado === 'cumplido' ? 'Cumplido' : 'Pendiente'],
      ['Fecha', fechaTexto(c.fecha_compromiso)],
      ['Fecha límite', c.fecha_limite ? fechaTexto(c.fecha_limite) : null],
      ['Fecha de cumplimiento', c.fecha_cumplido ? fechaTexto(c.fecha_cumplido) : null],
      ['Observación', c.observacion],
      ['Compromiso', c.compromiso],
      ['Seguimiento', c.seguimiento],
      ['Registrado por', `${c.creador_nombres} ${c.creador_apellidos} (${fechaHoraTexto(c.created_at)})`],
    ];
    pdfTarjeta(doc, `● ${c.motivo} — ${c.estado === 'cumplido' ? 'Cumplido' : 'Pendiente'}`, detalle);
  }
}

function pdfSeccion3(doc, observaciones) {
  pdfTitulo(doc, 1, 'Observaciones');
  if (!observaciones.length) {
    pdfCampo(doc, 'Observaciones', 'No hay observaciones registradas.');
    return;
  }
  doc.font('Helvetica').fontSize(9).fillColor('#6b7280')
    .text('Historial cronológico de observaciones académicas, de comportamiento y positivas.');
  doc.moveDown(0.5);
  for (const o of observaciones) {
    const etiqueta = ETIQUETA_TIPO_OBS[o.tipo] || o.tipo;
    const detalle = [
      ['Tipo', etiqueta],
      ['Registrada por', `${o.creador_nombres} ${o.creador_apellidos} (${fechaHoraTexto(o.created_at)})`],
      ['Observación', o.observacion],
    ];
    pdfTarjeta(doc, `● ${etiqueta}`, detalle);
  }
}

// Ronda C5: hoja con un solo registro, con el formato que usa la página.
function pdfSeccionCompromiso(doc, c) {
  pdfTitulo(doc, 1, 'Compromiso');
  const estado = c.estado === 'cumplido' ? 'Cumplido' : 'Pendiente';
  const detalle = [
    ['Motivo', c.motivo],
    ['Estado', estado],
    ['Fecha', fechaTexto(c.fecha_compromiso)],
    ['Fecha límite', c.fecha_limite ? fechaTexto(c.fecha_limite) : null],
    ['Fecha de cumplimiento', c.fecha_cumplido ? fechaTexto(c.fecha_cumplido) : null],
    ['Observación', c.observacion],
    ['Compromiso', c.compromiso],
    ['Seguimiento', c.seguimiento],
    ['Registrado por', `${c.creador_nombres} ${c.creador_apellidos} (${fechaHoraTexto(c.created_at)})`],
  ];
  pdfTarjeta(doc, `● ${c.motivo} — ${estado}`, detalle);
}

function pdfSeccionObservacion(doc, o) {
  pdfTitulo(doc, 1, 'Observación');
  const etiqueta = ETIQUETA_TIPO_OBS[o.tipo] || o.tipo;
  const detalle = [
    ['Tipo', etiqueta],
    ['Registrada por', `${o.creador_nombres} ${o.creador_apellidos} (${fechaHoraTexto(o.created_at)})`],
    ['Observación', o.observacion],
  ];
  pdfTarjeta(doc, `● ${etiqueta}`, detalle);
}

// Cuadro/tabla de la página personalizada: grilla con bordes,
// fondo, celdas editables y alineación por celda.
function pdfTablaLibre(doc, b) {
  const cols = b.columnas, filas = b.filas;
  const anchoCol = PDF_CONTENIDO_ANCHO / cols;
  const pad = 5;
  let y = doc.y;
  for (let r = 0; r < filas; r++) {
    let alto = 20;
    for (let c = 0; c < cols; c++) {
      const cel = b.celdas[r * cols + c] || { v: '', a: 'left', c: '#111827' };
      const t = String(cel.v || '');
      if (t) {
        const h = doc.heightOfString(t, { width: anchoCol - pad * 2 });
        if (h + pad * 2 > alto) alto = h + pad * 2;
      }
    }
    doc.save();
    if (b.fondo && b.fondo !== '#ffffff') {
      doc.rect(PDF_CONTENIDO_X, y, PDF_CONTENIDO_ANCHO, alto).fill(b.fondo);
    }
    for (let c = 0; c < cols; c++) {
      const cel = b.celdas[r * cols + c] || { v: '', a: 'left', c: '#111827' };
      const x = PDF_CONTENIDO_X + c * anchoCol;
      doc.font('Helvetica').fontSize(9.5).fillColor(cel.c || '#111827')
        .text(String(cel.v || ''), x + pad, y + pad, { width: anchoCol - pad * 2, align: cel.a || 'left' });
    }
    doc.restore();
    doc.lineWidth(0.8).strokeColor(b.bordes || '#d1d5db');
    for (let c = 0; c <= cols; c++) {
      const x = PDF_CONTENIDO_X + c * anchoCol;
      doc.moveTo(x, y).lineTo(x, y + alto).stroke();
    }
    doc.moveTo(PDF_CONTENIDO_X, y).lineTo(PDF_CONTENIDO_DER, y).stroke();
    doc.moveTo(PDF_CONTENIDO_X, y + alto).lineTo(PDF_CONTENIDO_DER, y + alto).stroke();
    y += alto;
  }
  doc.y = y + 5;
}

function pdfRenderBloque(doc, b) {
  const al = b.alineacion || 'left';
  if (b.tipo === 'titulo') {
    const tam = b.nivel === 1 ? 16 : b.nivel === 2 ? 13 : 11.5;
    let f = b.negrita ? 'Helvetica-Bold' : 'Helvetica';
    if (b.cursiva) f = b.negrita ? 'Helvetica-BoldOblique' : 'Helvetica-Oblique';
    doc.font(f).fontSize(tam).fillColor(b.color || '#111827')
      .text(String(b.texto || ''), { align: al });
    doc.moveDown(0.35);
  } else if (b.tipo === 'parrafo') {
    const tam = b.tamano === 'pequeno' ? 8.5 : b.tamano === 'grande' ? 12.5 : 10.5;
    let f = b.negrita ? 'Helvetica-Bold' : 'Helvetica';
    if (b.cursiva) f = b.negrita ? 'Helvetica-BoldOblique' : 'Helvetica-Oblique';
    doc.font(f).fontSize(tam).fillColor(b.color || '#111827')
      .text(String(b.texto || ''), { align: al });
    doc.moveDown(0.4);
  } else if (b.tipo === 'lista') {
    const items = (b.items || []).filter(x => x !== '');
    const tam = b.tamano === 'pequeno' ? 8.5 : b.tamano === 'grande' ? 12 : 10.2;
    const f = b.negrita ? 'Helvetica-Bold' : 'Helvetica';
    doc.font(f).fontSize(tam).fillColor(b.color || '#111827');
    items.forEach((it, i) => {
      const marca = b.ordenada ? (i + 1) + '. ' : '•  ';
      doc.text(marca + it, { align: al });
      doc.moveDown(0.15);
    });
    doc.moveDown(0.3);
  } else if (b.tipo === 'tabla') {
    pdfTablaLibre(doc, b);
  } else if (b.tipo === 'caja') {
    const tam = b.tamano === 'pequeno' ? 8.5 : b.tamano === 'grande' ? 12 : 10.5;
    const f = b.negrita ? 'Helvetica-Bold' : 'Helvetica';
    const txt = String(b.texto || '');
    const y0 = doc.y;
    const alto = txt ? doc.heightOfString(txt, { width: PDF_CONTENIDO_ANCHO - 24, align: al }) + 18 : 18;
    doc.save()
      .rect(PDF_CONTENIDO_X, y0, PDF_CONTENIDO_ANCHO, alto)
      .fill(b.fondo || '#f3f4f6')
      .restore();
    if (txt) {
      doc.font(f).fontSize(tam).fillColor(b.color || '#111827')
        .text(txt, PDF_CONTENIDO_X + 12, y0 + 9, { width: PDF_CONTENIDO_ANCHO - 24, align: al });
    }
    doc.y = y0 + alto + 8;
  } else if (b.tipo === 'linea') {
    doc.moveTo(PDF_CONTENIDO_X, doc.y).lineTo(PDF_CONTENIDO_DER, doc.y)
      .lineWidth(b.grosor || 2).strokeColor(b.color || '#9ca3af').stroke();
    doc.moveDown(0.65);
  } else if (b.tipo === 'cuadro_num') {
    const num = String(b.numero || '').trim();
    const txt = String(b.texto || '');
    const anchoNum = num ? doc.widthOfString(num, { font: 'Helvetica-Bold', fontSize: 15 }) + 16 : 0;
    const anchoTxt = txt ? doc.widthOfString(txt, { font: 'Helvetica', fontSize: 10 }) + 8 : 0;
    const ancho = Math.min(PDF_CONTENIDO_ANCHO, anchoNum + anchoTxt) || 24;
    const alto = 22;
    doc.save()
      .rect(PDF_CONTENIDO_X, doc.y, ancho, alto)
      .fill(b.color || '#111827')
      .restore();
    if (num) doc.font('Helvetica-Bold').fontSize(15).fillColor('#ffffff').text(num, PDF_CONTENIDO_X + 8, doc.y + 4.5);
    if (txt) doc.font('Helvetica').fontSize(10).fillColor('#ffffff').text(txt, PDF_CONTENIDO_X + anchoNum + 4, doc.y + 7, { width: Math.max(20, ancho - anchoNum - 8) });
    doc.y = doc.y + alto + 8;
  }
}

// Página personalizada: nombre + bloques tal como quedarán impresos.
function pdfSeccionPagina(doc, pagina) {
  doc.font('Helvetica-Bold').fontSize(13).fillColor('#111827')
    .text(pagina.nombre || 'Página personalizada');
  doc.moveDown(0.3);
  doc.moveTo(PDF_CONTENIDO_X, doc.y).lineTo(PDF_CONTENIDO_DER, doc.y)
    .lineWidth(1).strokeColor('#9ca3af').stroke();
  doc.moveDown(0.5);
  for (const b of (pagina.contenido || [])) pdfRenderBloque(doc, b);
}

// Arma la lista de secciones a imprimir según el parámetro paginas:
// '1' | '2' | '3' | 'todas' | <id de página personalizada> — o una lista
// separada por comas de referencias: '1', '2', '3', 'pg:<id página>',
// 'c:<id compromiso>', 'o:<id observación>' (Ronda C5).
function seleccionSecciones(paginasParam, paginas, compromisos, observaciones) {
  if (paginasParam === 'todas') {
    const s = [{ ref: '1' }, { ref: '2' }, { ref: '3' }];
    for (const p of paginas) s.push({ ref: 'pg', pagina: p });
    return s;
  }

  const refs = String(paginasParam || '').split(',');
  if (refs.length > 1 || /^(c|o|pg):/.test(paginasParam)) {
    const s = [];
    for (const parte of refs) {
      const ref = parte.trim();
      if (ref === '1' || ref === '2' || ref === '3') s.push({ ref });
      else if (ref.startsWith('pg:')) {
        const p = (paginas || []).find(x => x.id === ref.slice(3));
        if (p) s.push({ ref: 'pg', pagina: p });
      } else if (ref.startsWith('c:')) {
        const c = (compromisos || []).find(x => x.id === ref.slice(2));
        if (c) s.push({ ref: 'c', compromiso: c });
      } else if (ref.startsWith('o:')) {
        const o = (observaciones || []).find(x => x.id === ref.slice(2));
        if (o) s.push({ ref: 'o', observacion: o });
      } else {
        const p = (paginas || []).find(x => x.id === ref);
        if (p) s.push({ ref: 'pg', pagina: p });
      }
    }
    return s.length ? s : [{ ref: '1' }];
  }

  if (paginasParam === '1' || paginasParam === '2' || paginasParam === '3') {
    return [{ ref: paginasParam }];
  }
  const p = (paginas || []).find(x => x.id === paginasParam);
  return p ? [{ ref: 'pg', pagina: p }] : [{ ref: '1' }];
}

function generarPdfReporte(datos, compromisos, observaciones, secciones) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'letter', bufferPages: true });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    secciones.forEach((s, idx) => {
      if (idx > 0) doc.addPage();
      pdfEncabezado(doc, datos);
      if (s.ref === '1') pdfSeccion1(doc, datos);
      else if (s.ref === '2') pdfSeccion2(doc, compromisos);
      else if (s.ref === '3') pdfSeccion3(doc, observaciones);
      else if (s.ref === 'pg') pdfSeccionPagina(doc, s.pagina);
      else if (s.ref === 'c') pdfSeccionCompromiso(doc, s.compromiso);
      else if (s.ref === 'o') pdfSeccionObservacion(doc, s.observacion);
    });

    // Pie con número de página en todas las hojas.
    const rango = doc.bufferedPageRange();
    for (let i = rango.start; i < rango.start + rango.count; i++) {
      doc.switchToPage(i);
      const alto = doc.page.height;
      doc.font('Helvetica').fontSize(8).fillColor('#9ca3af');
      doc.text(
        `Página ${i + 1} de ${rango.count}`,
        PDF_CONTENIDO_X, alto - 42, { width: PDF_CONTENIDO_ANCHO, align: 'right' }
      );
      doc.text(
        `Reporte estudiantil · ${datos.estudiante.nombres} ${datos.estudiante.apellidos} · Generado el ${fechaHoraTexto(new Date())}`,
        PDF_CONTENIDO_X, alto - 55, { width: PDF_CONTENIDO_ANCHO, align: 'left' }
      );
    }

    doc.end();
  });
}

function wordMembretes(datos, pila) {
  const e = datos.estudiante, m = datos.matricula;
  return `<div class="membrete">
    <div class="mi-nombre">${escHtml(datos.institucion.nombre || 'Institución')}</div>
    ${datos.institucion.codigo_dane ? `<div class="mi-dane">DANE: ${escHtml(datos.institucion.codigo_dane)}</div>` : ''}
    <div class="mi-titulo">REPORTE ESTUDIANTIL</div>
    <div class="mi-sub">${escHtml(e.nombres)} ${escHtml(e.apellidos)} · ${escHtml(e.tipo_documento || '')} ${escHtml(e.numero_documento || '')}${m ? ` · ${escHtml(m.grado_nombre)} ${escHtml(m.grupo_nombre)}` : ''}</div>
    ${pila}</div>`;
}

function wordCampo(label, valor) {
  return `<div class="campo"><span class="k">${escHtml(label)}</span><span class="v">${escHtml(valor)}</span></div>`;
}

function wordSeccion1(datos) {
  const e = datos.estudiante, m = datos.matricula;
  let html = '<h2>1. Datos del estudiante</h2><div class="datos">';
  html += wordCampo('Documento', `${e.tipo_documento || ''} ${e.numero_documento || ''}`);
  html += wordCampo('Fecha de nacimiento', fechaTexto(e.fecha_nacimiento));
  html += wordCampo('Género', generoTexto(e.genero));
  html += wordCampo('Matrícula', m ? `Año ${m.anio_lectivo} · ${m.grado_nombre} ${m.grupo_nombre} (desde ${fechaTexto(m.fecha_ingreso)})` : 'Sin matrícula activa');
  if (datos.director) {
    const d = datos.director;
    html += wordCampo('Director de curso', `${d.nombres || ''} ${d.apellidos || ''}${d.telefono ? ` · ${d.telefono}` : ''}`.trim() || '—');
  } else {
    html += wordCampo('Director de curso', m ? 'No definido' : '—');
  }
  html += wordCampo('Correo', e.email || '—');
  html += wordCampo('Teléfono', e.telefono || '—');
  html += wordCampo('Dirección', e.direccion || '—');
  html += '</div>';

  html += `<h2>2. Resumen académico — ${escHtml(datos.periodo.descripcion)}</h2>`;
  if (!datos.materias.length) {
    html += `<p class="sin">${m ? 'Sin materias para este curso.' : 'El estudiante no tiene matrícula activa.'}</p>`;
  } else {
    html += '<table><thead><tr><th>Área</th><th>Materia</th><th class="c">Promedio</th><th class="c">Fallas</th></tr></thead><tbody>';
    for (const x of datos.materias) {
      html += `<tr><td>${escHtml(x.area_nombre)}</td><td>${escHtml(x.materia_nombre)}</td>` +
        `<td class="c">${x.promedio !== null ? x.promedio.toFixed(2) : '—'}</td><td class="c">${x.fallas}</td></tr>`;
    }
    html += '</tbody></table>';
  }

  html += '<div class="resumen">';
  html += wordCampo('Promedio general', datos.promedio_general !== null ? datos.promedio_general.toFixed(2) : '—');
  html += wordCampo('Asistencia', `Presentes: ${datos.asistencia.presentes} · Retardos: ${datos.asistencia.retardos} · Fallas: ${datos.asistencia.faltas} · Justificadas: ${datos.asistencia.justificadas}`);
  html += '</div>';

  html += '<h2>3. Acudiente</h2><div class="datos">';
  if (datos.acudiente) {
    const a = datos.acudiente;
    html += wordCampo('Nombre', `${a.nombres} ${a.apellidos}`);
    html += wordCampo('Parentesco', a.parentesco || '—');
    html += wordCampo('Teléfono', a.telefono || '—');
    html += wordCampo('Correo', a.email || '—');
  } else {
    html += wordCampo('Acudiente', 'Sin acudiente vinculado');
  }
  html += '</div>';

  html += '<h2>4. Expediente</h2><div class="datos">';
  html += wordCampo('Compromisos', `${datos.compromisos.total} registrados (${datos.compromisos.pendientes} pendientes)`);
  html += wordCampo('Observaciones', String(datos.observaciones_total));
  html += '</div>';
  return html;
}

function wordSeccion2(compromisos) {
  let html = '<h2>1. Compromisos</h2>';
  if (!compromisos.length) return html + '<p class="sin">No hay compromisos registrados.</p>';
  html += '<p class="intr">Registro académico o de convivencia que compromete al estudiante a mejorar un desempeño o comportamiento puntual.</p>';
  for (const c of compromisos) {
    html += '<div class="tarjeta">';
    html += `<div class="tt">${escHtml(c.motivo)} <span class="est ${c.estado === 'cumplido' ? 'ok' : 'pen'}">${c.estado === 'cumplido' ? 'Cumplido' : 'Pendiente'}</span></div>`;
    html += wordCampo('Fecha', fechaTexto(c.fecha_compromiso));
    if (c.fecha_limite) html += wordCampo('Fecha límite', fechaTexto(c.fecha_limite));
    if (c.fecha_cumplido) html += wordCampo('Fecha de cumplimiento', fechaTexto(c.fecha_cumplido));
    if (c.observacion) html += wordCampo('Observación', c.observacion);
    html += wordCampo('Compromiso', c.compromiso);
    if (c.seguimiento) html += wordCampo('Seguimiento', c.seguimiento);
    html += wordCampo('Registrado por', `${c.creador_nombres} ${c.creador_apellidos} (${fechaHoraTexto(c.created_at)})`);
    html += '</div>';
  }
  return html;
}

function wordSeccion3(observaciones) {
  let html = '<h2>1. Observaciones</h2>';
  if (!observaciones.length) return html + '<p class="sin">No hay observaciones registradas.</p>';
  html += '<p class="intr">Historial cronológico de observaciones académicas, de comportamiento y positivas.</p>';
  for (const o of observaciones) {
    const etiqueta = ETIQUETA_TIPO_OBS[o.tipo] || o.tipo;
    html += '<div class="tarjeta">';
    html += `<div class="tt">Observación <span class="est lbl">${escHtml(etiqueta)}</span></div>`;
    html += wordCampo('Registrada por', `${o.creador_nombres} ${o.creador_apellidos} (${fechaHoraTexto(o.created_at)})`);
    html += `<div class="obs">${escHtml(o.observacion)}</div>`;
    html += '</div>';
  }
  return html;
}

// Ronda C5: hoja Word con un solo registro, mismo formato de su página.
function wordTarjetaCompromiso(c) {
  let html = '<div class="tarjeta">';
  html += `<div class="tt">${escHtml(c.motivo)} <span class="est ${c.estado === 'cumplido' ? 'ok' : 'pen'}">${c.estado === 'cumplido' ? 'Cumplido' : 'Pendiente'}</span></div>`;
  html += wordCampo('Fecha', fechaTexto(c.fecha_compromiso));
  if (c.fecha_limite) html += wordCampo('Fecha límite', fechaTexto(c.fecha_limite));
  if (c.fecha_cumplido) html += wordCampo('Fecha de cumplimiento', fechaTexto(c.fecha_cumplido));
  if (c.observacion) html += wordCampo('Observación', c.observacion);
  html += wordCampo('Compromiso', c.compromiso);
  if (c.seguimiento) html += wordCampo('Seguimiento', c.seguimiento);
  html += wordCampo('Registrado por', `${c.creador_nombres} ${c.creador_apellidos} (${fechaHoraTexto(c.created_at)})`);
  return html + '</div>';
}

function wordTarjetaObservacion(o) {
  const etiqueta = ETIQUETA_TIPO_OBS[o.tipo] || o.tipo;
  let html = '<div class="tarjeta">';
  html += `<div class="tt">Observación <span class="est lbl">${escHtml(etiqueta)}</span></div>`;
  html += wordCampo('Registrada por', `${o.creador_nombres} ${o.creador_apellidos} (${fechaHoraTexto(o.created_at)})`);
  html += `<div class="obs">${escHtml(o.observacion)}</div>`;
  return html + '</div>';
}

function wordBloqueHTML(b) {
  const al = b.alineacion || 'left';
  const col = b.color || '#111827';
  if (b.tipo === 'titulo') {
    const n = b.nivel === 3 ? 3 : b.nivel === 1 ? 1 : 2;
    const est = `text-align:${al};color:${col};${b.negrita ? 'font-weight:bold;' : ''}${b.cursiva ? 'font-style:italic;' : ''}`;
    return `<h${n} style="${est}">${escHtml(b.texto || '')}</h${n}>`;
  }
  if (b.tipo === 'parrafo') {
    const tam = b.tamano === 'pequeno' ? '9pt' : b.tamano === 'grande' ? '13pt' : '11pt';
    const est = `text-align:${al};color:${col};font-size:${tam};${b.negrita ? 'font-weight:bold;' : ''}${b.cursiva ? 'font-style:italic;' : ''}`;
    return `<p style="${est}">${escHtml(b.texto || '')}</p>`;
  }
  if (b.tipo === 'lista') {
    const tag = b.ordenada ? 'ol' : 'ul';
    const tam = b.tamano === 'pequeno' ? '9pt' : b.tamano === 'grande' ? '12pt' : '10.5pt';
    const items = (b.items || []).filter(x => x !== '').map(x => `<li>${escHtml(x)}</li>`).join('');
    return `<${tag} style="text-align:${al};color:${col};font-size:${tam};">${items}</${tag}>`;
  }
  if (b.tipo === 'tabla') {
    const ancho = Math.floor(100 / Math.max(1, b.columnas));
    let h = `<table style="border-collapse:collapse;width:100%;background:${b.fondo || '#ffffff'}"><tbody>`;
    for (let r = 0; r < b.filas; r++) {
      h += '<tr>';
      for (let c = 0; c < b.columnas; c++) {
        const cel = b.celdas[r * b.columnas + c] || { v: '', a: 'left', c: '#111827' };
        h += `<td style="border:1px solid ${b.bordes || '#d1d5db'};padding:4px 6px;width:${ancho}%;text-align:${cel.a || 'left'};color:${cel.c || '#111827'};">${escHtml(cel.v || '')}</td>`;
      }
      h += '</tr>';
    }
    return h + '</tbody></table>';
  }
  if (b.tipo === 'caja') {
    const tam = b.tamano === 'pequeno' ? '9pt' : b.tamano === 'grande' ? '12pt' : '11pt';
    return `<div style="background:${b.fondo || '#f3f4f6'};padding:10px 12px;border-radius:6px;text-align:${al};color:${col};font-size:${tam};${b.negrita ? 'font-weight:bold;' : ''}${b.cursiva ? 'font-style:italic;' : ''}">${escHtml(b.texto || '')}</div>`;
  }
  if (b.tipo === 'linea') {
    return `<hr style="border:none;border-top:${b.grosor || 2}px solid ${col};margin:10px 0;" />`;
  }
  if (b.tipo === 'cuadro_num') {
    const num = escHtml(b.numero || '');
    const txt = escHtml(b.texto || '');
    return `<span style="display:inline-block;background:${col};color:#ffffff;border-radius:6px;padding:5px 12px;font-size:11pt;font-weight:bold;">${num ? `<span style="margin-right:6px;">${num}</span>` : ''}${txt}</span>`;
  }
  return '';
}

function wordSeccionPagina(pagina) {
  let html = `<h2 style="color:#374151;">Página adicional · ${escHtml(pagina.nombre || 'Personalizada')}</h2>`;
  for (const b of (pagina.contenido || [])) html += wordBloqueHTML(b);
  return html;
}

function generarHtmlWord(datos, compromisos, observaciones, secciones) {
  let cuerpo = '';
  for (const s of secciones) {
    if (s.ref === '1') cuerpo += wordSeccion1(datos);
    else if (s.ref === '2') cuerpo += wordSeccion2(compromisos);
    else if (s.ref === '3') cuerpo += wordSeccion3(observaciones);
    else if (s.ref === 'pg') cuerpo += wordSeccionPagina(s.pagina);
    else if (s.ref === 'c') cuerpo += wordTarjetaCompromiso(s.compromiso);
    else if (s.ref === 'o') cuerpo += wordTarjetaObservacion(s.observacion);
  }

  const estilo = `
    body { font-family: Arial, sans-serif; color: #111827; font-size: 12pt; }
    .membrete { border-bottom: 3px double #1f2937; text-align: center; padding-bottom: 12px; margin-bottom: 16px; }
    .mi-nombre { font-weight: bold; font-size: 15pt; }
    .mi-titulo { font-weight: bold; font-size: 13pt; color: #1e3a8a; margin-top: 4px; }
    .mi-dane, .mi-sub { color: #6b7280; font-size: 10pt; }
    h2 { font-size: 12pt; color: #111827; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; margin: 18px 0 8px; }
    .datos { margin: 4px 0 8px; }
    .campo { margin-bottom: 4px; }
    .campo .k { color: #6b7280; font-weight: bold; display: inline-block; min-width: 170px; }
    .campo .v { color: #111827; }
    table { border-collapse: collapse; width: 100%; font-size: 11pt; margin: 6px 0; }
    th, td { border: 1px solid #d1d5db; padding: 5px 8px; text-align: left; }
    th { background: #f3f4f6; color: #6b7280; }
    td.c, th.c { text-align: center; }
    .resumen { background: #f9fafb; border: 1px solid #e5e7eb; padding: 8px 12px; margin: 8px 0; }
    .tarjeta { border: 1px solid #e5e7eb; padding: 8px 12px; margin: 8px 0; }
    .tt { font-weight: bold; color: #1e3a8a; margin-bottom: 6px; }
    .intr { color: #6b7280; font-size: 10pt; margin: 0 0 8px; }
    .sin { color: #9ca3af; font-style: italic; }
    .est { font-size: 9pt; padding: 1px 8px; border-radius: 10px; }
    .ok { background: #d1fae5; color: #065f46; }
    .pen { background: #fef3c7; color: #92400e; }
    .lbl { background: #e5e7eb; color: #374151; }
    .obs { margin-top: 4px; white-space: pre-wrap; }
    .pie { margin-top: 24px; text-align: right; color: #9ca3af; font-size: 9pt; }`;

  return `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8" />
<title>Reporte estudiantil</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->
<style>${estilo}</style>
</head>
<body>
${wordMembretes(datos, cuerpo)}
<div class="pie">Reporte estudiantil · ${escHtml(datos.estudiante.nombres)} ${escHtml(datos.estudiante.apellidos)} · Generado el ${fechaHoraTexto(new Date())}</div>
</body>
</html>`;
}

exports.imprimir = async (req, res) => {
  const { estudianteId } = req.params;
  const formato = req.query.formato === 'word' ? 'word' : 'pdf';
  const paginasParam = String(req.query.paginas || 'todas');

  try {
    const ctx = await prepararContexto(req, estudianteId);
    if (ctx.error) return res.status(ctx.error.status).json({ ok: false, mensaje: ctx.error.mensaje });

    const datos = await reunirDatosReporte(estudianteId);
    if (!datos) return res.status(404).json({ ok: false, mensaje: 'No existe ese estudiante.' });

    const compromisos = await consultarCompromisos(estudianteId);
    const observaciones = await consultarObservaciones(estudianteId);
    const paginas = await consultarPaginas(estudianteId);
    const secciones = seleccionSecciones(paginasParam, paginas, compromisos, observaciones);

    const nombreBase = `reporte_${slug(datos.estudiante.apellidos)}_${slug(datos.estudiante.nombres)}`;

    if (formato === 'word') {
      const html = generarHtmlWord(datos, compromisos, observaciones, secciones);
      res.setHeader('Content-Type', 'application/msword');
      res.setHeader('Content-Disposition', `attachment; filename="${nombreBase}.doc"`);
      return res.send(html);
    }

    const pdfBuffer = await generarPdfReporte(datos, compromisos, observaciones, secciones);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${nombreBase}.pdf"`);
    return res.send(pdfBuffer);
  } catch (err) {
    console.error('imprimir:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// ════════════════════════════════════════════════════════════════
//  Punto 6 — Certificados y constancias (PDF firmados)
//  GET /api/reportes/estudiante/:estudianteId/certificado/:tipo
//  tipos: estudio | notas | paz_y_salvo. Genera el PDF, lo guarda en
//  storage/certificados (mismo patrón de boletines) y registra cada
//  expedición en `certificados` (historial + consecutivo correlativo
//  por institución) para re-descarga.
//  La firma sale de instituciones (nombre_firma/cargo_firma/
//  documento_firma); si no está configurada se usa el admin que
//  genera. El paz y salvo es académico: bloquea si hay compromisos
//  pendientes u observaciones académicas/comportamentales sin resolver
//  en el año lectivo vigente.
// ════════════════════════════════════════════════════════════════

const CARPETA_CERTIFICADOS = path.join(__dirname, '../../storage/certificados');

const CERTIFICADOS_TITULO = {
  estudio: 'CONSTANCIA DE ESTUDIO',
  notas: 'CERTIFICADO DE NOTAS',
  paz_y_salvo: 'PAZ Y SALVO ACADÉMICO',
};
const CERTIFICADOS_DESCRIPCION = {
  estudio: 'Constancia de estudio',
  notas: 'Certificado de notas',
  paz_y_salvo: 'Paz y salvo académico',
};
const TIPOS_CERTIFICADO = new Set(Object.keys(CERTIFICADOS_TITULO));

function padConsecutivo(n) {
  return String(n).padStart(6, '0');
}

async function datosInstitucionCompleta(institucionId) {
  const [rows] = await pool.query(
    `SELECT id, nombre, codigo_dane, logo_url, direccion, municipio,
            departamento, telefono, email_institucional,
            nombre_firma, cargo_firma, documento_firma
     FROM instituciones WHERE id = ?`,
    [institucionId]
  );
  return rows.length ? rows[0] : null;
}

async function matriculaActivaEstudiante(estudianteId) {
  const [rows] = await pool.query(
    `SELECT mt.grupo_id, mt.anio_lectivo, mt.fecha_ingreso,
            g.nombre AS grupo_nombre, gr.nombre AS grado_nombre
     FROM matriculas mt
     JOIN grupos g ON g.id = mt.grupo_id
     JOIN grados gr ON gr.id = g.grado_id
     WHERE mt.estudiante_id = ? AND mt.estado = 'activa'
     ORDER BY mt.anio_lectivo DESC
     LIMIT 1`,
    [estudianteId]
  );
  return rows.length ? rows[0] : null;
}

// Firma que sale en el documento: la configurada en la institución, o
// la del usuario autenticado (admin/superadmin/docente) que la genera.
async function resolverFirma(institucionId, usuarioId) {
  const inst = await datosInstitucionCompleta(institucionId);
  const [meRows] = await pool.query(
    `SELECT nombres, apellidos, tipo_documento, numero_documento FROM usuarios WHERE id = ?`,
    [usuarioId]
  );
  const u = meRows.length ? meRows[0] : {};
  const nombre = (inst && inst.nombre_firma) || `${u.nombres || ''} ${u.apellidos || ''}`.trim();
  const documento = (inst && inst.documento_firma)
    || (u.tipo_documento ? `${u.tipo_documento} ${u.numero_documento}` : '');
  return { nombre, cargo: (inst && inst.cargo_firma) || '', documento };
}

// Paz y salvo académico: pendientes de compromisos + observaciones
// académicas/comportamentales del año vigente (no hay campo de estado
// en reporte_observaciones; se consideran resueltas las de tipo
// positiva/general y las de otros años).
async function pendientesPazYSalvo(estudianteId, anioLectivo) {
  const [compRows] = await pool.query(
    `SELECT COUNT(*) AS total FROM reporte_compromisos
     WHERE estudiante_id = ? AND estado = 'pendiente'`,
    [estudianteId]
  );
  const [obsRows] = await pool.query(
    `SELECT COUNT(*) AS total FROM reporte_observaciones
     WHERE estudiante_id = ? AND YEAR(created_at) = ? AND tipo IN ('academica','comportamiento')`,
    [estudianteId, anioLectivo]
  );
  return { compromisos: Number(compRows[0].total), observaciones: Number(obsRows[0].total) };
}

// Siguiente consecutivo de la institución (dentro de la transacción:
// la lectura con FOR UPDATE encola las expediciones concurrentes).
async function siguienteConsecutivo(conn, institucionId) {
  const [rows] = await conn.query(
    `SELECT COALESCE(MAX(consecutivo), 0) AS ultimo FROM certificados
     WHERE institucion_id = ? FOR UPDATE`,
    [institucionId]
  );
  return Number(rows[0].ultimo) + 1;
}

function generarPdfCertificado(d) {
  const doc = new PDFDocument({ margin: 50, size: 'letter', bufferPages: true });
  const chunks = [];
  doc.on('data', c => chunks.push(c));

  const i = d.institucion, e = d.estudiante;

  // ── Logo (si existe y se puede leer) ──
  if (d.logoAbsoluto) {
    try {
      const img = doc.openImage(d.logoAbsoluto);
      const ancho = Math.min(78, img.width);
      const alto = (img.height / img.width) * ancho;
      doc.image(d.logoAbsoluto, (doc.page.width - ancho) / 2, 50, { width: ancho });
      doc.y = 50 + alto + 18;
    } catch (err) {
      doc.y = 84;
    }
  } else {
    doc.y = 84;
  }

  // ── Membrete ──
  doc.font('Helvetica-Bold').fontSize(15).fillColor('#111827')
    .text(i.nombre || 'Institución', { align: 'center' });
  if (i.codigo_dane) {
    doc.font('Helvetica').fontSize(9).fillColor('#6b7280')
      .text('DANE: ' + i.codigo_dane, { align: 'center' });
  }
  if (i.municipio || i.departamento) {
    doc.font('Helvetica').fontSize(9).fillColor('#6b7280')
      .text(['Sede', i.municipio, i.departamento].filter(Boolean).join(' · '), { align: 'center' });
  }
  doc.moveDown(0.5);
  doc.moveTo(50, doc.y).lineTo(562, doc.y).lineWidth(1.6).strokeColor('#1e3a8a').stroke();
  doc.moveDown(0.6);

  // ── Título ──
  doc.font('Helvetica-Bold').fontSize(13.5).fillColor('#1e3a8a')
    .text(d.titulo, { align: 'center' });
  doc.moveDown(0.6);

  // ── Consecutivo y fecha de expedición ──
  doc.font('Helvetica').fontSize(9).fillColor('#4b5563')
    .text(`Consecutivo Nº ${d.consecutivo}`, 50, doc.y, { continued: true });
  doc.text(`   ·   Expedido el ${fechaTexto(d.fechaExpedicion)}`, { align: 'right' });
  doc.moveDown(1.1);

  // ── Cuerpo ──
  const cuerpo = (doc, txt) => {
    doc.font('Helvetica').fontSize(10.5).fillColor('#111827').text(txt, {
      align: 'justify',
      lineGap: 4,
      indent: 18,
    });
    doc.moveDown(0.8);
  };

  if (d.tipo === 'estudio') {
    const m = d.matricula;
    cuerpo(doc, `El (la) suscrito(a) ${d.firma.nombre}, ${d.firma.cargo}, de ${i.nombre}, certifica que ${e.nombres} ${e.apellidos}, identificado(a) con ${e.tipo_documento} No. ${e.numero_documento}, se encuentra matriculado(a) y cursando ${m ? `${m.grado_nombre} ${m.grupo_nombre}` : 'un grado de esta institución'} en el año lectivo ${d.anioLectivo}${m && m.fecha_ingreso ? `, con fecha de ingreso ${fechaTexto(m.fecha_ingreso)}` : ''}.`);
    cuerpo(doc, 'La presente constancia se expide a solicitud del interesado(a) para los fines que considere pertinentes.');
  } else if (d.tipo === 'notas') {
    cuerpo(doc, `El (la) suscrito(a) ${d.firma.nombre}, ${d.firma.cargo}, de ${i.nombre}, certifica que ${e.nombres} ${e.apellidos}, identificado(a) con ${e.tipo_documento} No. ${e.numero_documento}, obtuvo durante el periodo ${d.periodo.nombre} del año lectivo ${d.periodo.anio_lectivo} los siguientes resultados académicos:`);

    if (d.materias.length) {
      const tipos = d.tiposNota;
      const headersNota = tipos.length > 6
        ? [{ label: 'Materia', w: 200 }, { label: 'Promedio', w: 80, align: 'center' }]
        : [{ label: 'Materia', w: 160 - (tipos.length * 8) }].concat(
            tipos.map(t => ({ label: t, w: 52 })),
            [{ label: 'Promedio', w: 64, align: 'center' }]
          );
      const filas = d.materias.map(x => {
        const celdas = [x.materia_nombre];
        if (tipos.length > 6) {
          celdas.push(x.promedio !== null ? x.promedio.toFixed(2) : '—');
        } else {
          for (const t of tipos) {
            const n = (x.notas || []).find(v => v.tipo_nota === t);
            celdas.push(n ? String(n.valor) : '—');
          }
          celdas.push(x.promedio !== null ? x.promedio.toFixed(2) : '—');
        }
        return celdas;
      });
      pdfTabla(doc, headersNota, filas);
      doc.moveDown(0.3);
      doc.font('Helvetica').fontSize(9).fillColor('#6b7280')
        .text('Notas expresadas sobre la escala configurada (por defecto 10.00). Promedio por materia ponderado por el peso de cada evaluación.', { align: 'center' });
      doc.moveDown(0.4);
      cuerpo(doc, `Promedio general del periodo: ${d.promedio_general !== null ? d.promedio_general.toFixed(2) + ' sobre 10' : 'sin notas registradas'}.`);
    } else {
      cuerpo(doc, 'No hay notas registradas para este estudiante en el periodo señalado.');
    }
  } else if (d.tipo === 'paz_y_salvo') {
    cuerpo(doc, `El (la) suscrito(a) ${d.firma.nombre}, ${d.firma.cargo}, de ${i.nombre}, certifica que ${e.nombres} ${e.apellidos}, identificado(a) con ${e.tipo_documento} No. ${e.numero_documento}, se encuentra a PAZ Y SALVO académico con la institución a la fecha de expedición de la presente, por no registrar compromisos pendientes ni observaciones sin resolver.`);
    cuerpo(doc, `La presente se expide el día ${fechaTexto(d.fechaExpedicion)} para los fines legales pertinentes.`);
  }

  // ── Firma ──
  doc.moveDown(3);
  if (d.firma.nombre) {
    doc.moveTo(50 + 140, doc.y).lineTo(50 + 372, doc.y).lineWidth(1).strokeColor('#374151').stroke();
  }
  doc.moveDown(1.6);
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#111827').text(d.firma.nombre || '—', { align: 'center' });
  doc.font('Helvetica').fontSize(10).fillColor('#4b5563').text(d.firma.cargo || '', { align: 'center' });
  if (d.firma.documento) {
    doc.font('Helvetica').fontSize(9.5).fillColor('#6b7280').text('C.C. ' + d.firma.documento, { align: 'center' });
  }
  if (d.firma.nombre) {
    doc.font('Helvetica-Oblique').fontSize(8.5).fillColor('#9ca3af')
      .text('(firma manuscrita)', { align: 'center' });
  }

  // ── Pie en todas las páginas ──
  const total = doc.bufferedPageRange().count;
  for (let p = 0; p < total; p++) {
    doc.switchToPage(p);
    const alto = doc.page.height;
    doc.font('Helvetica').fontSize(8.5).fillColor('#9ca3af')
      .text('Documento generado por SIA · ' + fechaHoraTexto(new Date()) + (d.tipo ? ' · ' : ''),
        PDF_CONTENIDO_X, alto - 40, { width: PDF_CONTENIDO_ANCHO, align: 'center' });
    doc.text('Página ' + (p + 1) + ' de ' + total,
      PDF_CONTENIDO_X, alto - 55, { width: PDF_CONTENIDO_ANCHO, align: 'center' });
  }

  doc.end();
  return new Promise(resolve => doc.on('end', () => resolve(Buffer.concat(chunks))));
}

// Detalle de notas por materia y periodo (para el certificado de notas).
// materiabas: [{ materia_id, materia_nombre }] (en el orden que se pintan).
async function detalleNotasPorMateria(estudianteId, materiabas, periodoId) {
  const idsMaterias = materiabas.map(m => m.materia_id);
  if (!idsMaterias.length || !periodoId) return { materias: [], tiposNota: [] };
  const inM = idsMaterias.map(() => '?').join(', ');
  const [rows] = await pool.query(
    `SELECT n.materia_id, n.tipo_nota, n.valor, n.valor_max, n.peso_pct, m.nombre AS materia_nombre
     FROM notas n JOIN materias m ON m.id = n.materia_id
     WHERE n.estudiante_id = ? AND n.periodo_id = ? AND n.materia_id IN (${inM})
     ORDER BY n.materia_id, n.tipo_nota, n.created_at, n.id`,
    [estudianteId, periodoId, ...idsMaterias]
  );
  const porMateria = {};
  const tiposOrden = [];
  for (const r of rows) {
    (porMateria[r.materia_id] ||= []).push(r);
    if (!tiposOrden.includes(r.tipo_nota)) tiposOrden.push(r.tipo_nota);
  }
  const materias = materiabas.map(x => {
    const notas = porMateria[x.materia_id] || [];
    const { promedio } = promedioDesdeNotas(notas);
    return { materia_id: x.materia_id, materia_nombre: x.materia_nombre, notas, promedio };
  });
  return { materias, tiposNota: tiposOrden };
}

// ── GET /api/reportes/estudiante/:estudianteId/certificados ─────
// Historial de certificados expedidos + configuración de firma actual
// (para editar). Lo puede ver quien ve el reporte; la firma solo es
// editable por un admin de la institución.
exports.historialCertificados = async (req, res) => {
  const { estudianteId } = req.params;
  try {
    const ctx = await prepararContexto(req, estudianteId);
    if (ctx.error) return res.status(ctx.error.status).json({ ok: false, mensaje: ctx.error.mensaje });

    const inst = await datosInstitucionCompleta(ctx.est.institucion_id);
    const firma = {
      nombre_firma: (inst && inst.nombre_firma) || '',
      cargo_firma: (inst && inst.cargo_firma) || '',
      documento_firma: (inst && inst.documento_firma) || '',
    };
    const editable = req.usuario.rol === 'admin' && !!req.usuario.institucion_id;

    const [rows] = await pool.query(
      `SELECT c.id, c.tipo, c.consecutivo, c.anio_lectivo, c.created_at,
              u.nombres AS generado_por_nombres, u.apellidos AS generado_por_apellidos
       FROM certificados c JOIN usuarios u ON u.id = c.generado_por
       WHERE c.estudiante_id = ?
       ORDER BY c.created_at DESC, c.consecutivo DESC`,
      [estudianteId]
    );

    return res.json({
      ok: true,
      total: rows.length,
      firma,
      editable,
      certificados: rows.map(r => ({
        id: r.id,
        tipo: r.tipo,
        tipo_titulo: CERTIFICADOS_DESCRIPCION[r.tipo] || r.tipo,
        consecutivo: padConsecutivo(r.consecutivo),
        anio_lectivo: r.anio_lectivo,
        created_at: r.created_at,
        generado_por: `${r.generado_por_nombres} ${r.generado_por_apellidos}`,
        descarga_url: `/api/reportes/certificados/${r.id}/descargar`,
      })),
    });
  } catch (err) {
    console.error('historialCertificados:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// ── GET /api/reportes/estudiante/:estudianteId/certificado/:tipo ─
// Genera el certificado, lo guarda como archivo y lo registra en el
// historial. Solo quien puede gestionar el expediente lo expide.
exports.certificado = async (req, res) => {
  const { estudianteId, tipo } = req.params;
  try {
    if (!TIPOS_CERTIFICADO.has(tipo)) {
      return res.status(400).json({ ok: false, mensaje: 'Tipo de certificado inválido. Usa estudio, notas o paz_y_salvo.' });
    }

    const ctx = await prepararContexto(req, estudianteId);
    if (ctx.error) return res.status(ctx.error.status).json({ ok: false, mensaje: ctx.error.mensaje });
    if (!ctx.puedeGestionar) {
      return res.status(403).json({ ok: false, mensaje: 'No tienes permiso para expedir certificados de este estudiante.' });
    }
    const est = ctx.est;

    const matricula = await matriculaActivaEstudiante(estudianteId);
    const anioLectivo = matricula ? matricula.anio_lectivo : new Date().getFullYear();

    if (tipo === 'paz_y_salvo') {
      const pend = await pendientesPazYSalvo(estudianteId, anioLectivo);
      const motivos = [];
      if (pend.compromisos > 0) motivos.push(`${pend.compromisos} compromiso(s) pendiente(s)`);
      if (pend.observaciones > 0) motivos.push(`${pend.observaciones} observación(es) académica(s)/de comportamiento sin resolver`);
      if (motivos.length) {
        return res.status(409).json({
          ok: false,
          mensaje: 'No se puede expedir el paz y salvo: el estudiante tiene ' + motivos.join(' y ') + '.',
        });
      }
    }

    const datos = await reunirDatosReporte(estudianteId);
    if (!datos) return res.status(404).json({ ok: false, mensaje: 'No existe ese estudiante.' });

    const institucion = await datosInstitucionCompleta(est.institucion_id);
    if (!institucion) return res.status(404).json({ ok: false, mensaje: 'La institución del estudiante no existe.' });

    let detalle = { materias: [], tiposNota: [] };
    if (tipo === 'notas') {
      detalle = await detalleNotasPorMateria(estudianteId,
        datos.materias.map(x => ({ materia_id: x.materia_id, materia_nombre: x.materia_nombre })),
        datos.periodo.id);
    }

    const firma = await resolverFirma(est.institucion_id, req.usuario.id);
    const logoAbsoluto = institucion.logo_url ? path.join(__dirname, '../..', institucion.logo_url) : null;

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const consecutivo = await siguienteConsecutivo(conn, est.institucion_id);

      const pdfDatos = {
        institucion,
        estudiante: est,
        matricula,
        periodo: datos.periodo,
        firma,
        tipo,
        titulo: CERTIFICADOS_TITULO[tipo],
        consecutivo: padConsecutivo(consecutivo),
        fechaExpedicion: new Date(),
        anioLectivo,
        logoAbsoluto,
        materias: detalle.materias,
        tiposNota: detalle.tiposNota,
        promedio_general: datos.promedio_general,
      };
      const pdfBuffer = await generarPdfCertificado(pdfDatos);

      fs.mkdirSync(CARPETA_CERTIFICADOS, { recursive: true });
      const nombreStorage = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.pdf`;
      fs.writeFileSync(path.join(CARPETA_CERTIFICADOS, nombreStorage), pdfBuffer);

      const nombreOriginal = `certificado_${slug(est.apellidos)}_${tipo}.pdf`;
      const descripcionArchivo = `${CERTIFICADOS_DESCRIPCION[tipo]} · ${est.nombres} ${est.apellidos} · Consecutivo ${padConsecutivo(consecutivo)}`;

      const archivoId = randomUUID();
      await conn.query(
        `INSERT INTO archivos
           (id, subido_por, tipo, nombre_original, nombre_storage, ruta_storage, mime_type, tamanio_bytes, es_publico, ref_grupo_id, descripcion)
         VALUES (?, ?, 'certificado', ?, ?, ?, 'application/pdf', ?, 0, ?, ?)`,
        [archivoId, req.usuario.id, nombreOriginal, nombreStorage, `/storage/certificados/${nombreStorage}`, pdfBuffer.length, matricula ? matricula.grupo_id : null, descripcionArchivo]
      );

      const certificadoId = randomUUID();
      await conn.query(
        `INSERT INTO certificados (id, institucion_id, estudiante_id, tipo, consecutivo, anio_lectivo, generado_por, archivo_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [certificadoId, est.institucion_id, estudianteId, tipo, consecutivo, anioLectivo, req.usuario.id, archivoId]
      );

      await conn.commit();
      return res.status(201).json({
        ok: true,
        mensaje: `${CERTIFICADOS_DESCRIPCION[tipo]} generado (consecutivo ${padConsecutivo(consecutivo)}).`,
        certificado_id: certificadoId,
        consecutivo: padConsecutivo(consecutivo),
        descarga_url: `/api/reportes/certificados/${certificadoId}/descargar`,
      });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error('certificado:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// ── GET /api/reportes/certificados/:id/descargar ────────────────
// Re-descarga de un certificado ya expedido. Quien puede ver el
// reporte (estudiante, acudiente, docente, admin) lo puede descargar.
exports.descargarCertificado = async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await pool.query(
      `SELECT c.estudiante_id, a.ruta_storage, a.nombre_original
       FROM certificados c JOIN archivos a ON a.id = c.archivo_id
       WHERE c.id = ?`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ ok: false, mensaje: 'Certificado no encontrado.' });

    const cert = rows[0];
    const ctx = await prepararContexto(req, cert.estudiante_id);
    if (ctx.error) return res.status(ctx.error.status).json({ ok: false, mensaje: ctx.error.mensaje });
    if (!ctx.puedeVer) {
      return res.status(403).json({ ok: false, mensaje: 'No tienes permiso para descargar este certificado.' });
    }

    const rutaAbsoluta = path.join(__dirname, '../..', cert.ruta_storage);
    return res.download(rutaAbsoluta, cert.nombre_original);
  } catch (err) {
    console.error('descargarCertificado:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// ── PUT /api/reportes/certificados/firma ────────────────────────
// Configura quién firma los certificados de la institución del admin.
exports.actualizarFirma = async (req, res) => {
  const institucionId = req.usuario.institucion_id;
  if (!institucionId) {
    return res.status(400).json({ ok: false, mensaje: 'Tu cuenta no pertenece a una institución.' });
  }

  const nombre_firma = (req.body.nombre_firma || '').toString().trim() || null;
  const cargo_firma = (req.body.cargo_firma || '').toString().trim() || null;
  const documento_firma = (req.body.documento_firma || '').toString().trim() || null;

  if (nombre_firma && nombre_firma.length > 150) {
    return res.status(400).json({ ok: false, mensaje: 'El nombre de quien firma es muy largo.' });
  }
  if (cargo_firma && cargo_firma.length > 120) {
    return res.status(400).json({ ok: false, mensaje: 'El cargo es muy largo.' });
  }
  if (documento_firma && documento_firma.length > 20) {
    return res.status(400).json({ ok: false, mensaje: 'El documento de identidad es muy largo.' });
  }

  try {
    await pool.query(
      `UPDATE instituciones SET nombre_firma = ?, cargo_firma = ?, documento_firma = ? WHERE id = ?`,
      [nombre_firma, cargo_firma, documento_firma, institucionId]
    );
    return res.json({ ok: true, mensaje: 'Datos de firma actualizados.' });
  } catch (err) {
    console.error('actualizarFirma:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};