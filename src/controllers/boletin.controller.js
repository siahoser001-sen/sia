// ============================================================
//  boletin.controller.js — MySQL
//  Genera el boletín (PDF) de UN estudiante para un periodo puntual,
//  lo guarda como un archivo más (tabla `archivos`, tipo 'boletin')
//  y deja el registro en `boletines` (historial: cada generación es
//  una fila nueva, no se sobreescribe la anterior).
//
//  Permiso: admin/superadmin de la institución, el docente director
//  del curso, o cualquier docente que dicte una materia en ese curso
//  (el ROADMAP pedía el botón "visible para director de curso y para
//  el profesor" — se interpretó como cualquier docente del curso, no
//  solo el director; más amplio que resumen.controller.js).
// ============================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PDFDocument = require('pdfkit');
const pool = require('../config/db');
const {
  condicionMateriaEnGrupo,
  parametrosMateriaEnGrupo,
  materiasConDocentesDeGrupo,
} = require('../utils/materias-curso.util');
const {
  obtenerResumenAsistenciaDia,
  totalizarResumenAsistenciaDia,
} = require('../services/asistencia-dia.service');

const CARPETA_BOLETINES = path.join(__dirname, '../../storage/boletines');

// ---- datos base y permisos -----------------------------------

async function datosGrupo(grupoId) {
  const [rows] = await pool.query(
    `SELECT g.id, g.nombre AS grupo_nombre, g.director_id,
            gr.nombre AS grado_nombre, gr.institucion_id
     FROM grupos g JOIN grados gr ON gr.id = g.grado_id
     WHERE g.id = ?`,
    [grupoId]
  );
  return rows.length ? rows[0] : null;
}

async function puedeGestionarBoletin(req, grupo) {
  if (!grupo) return false;
  if (req.usuario.rol === 'superadmin') return true;
  if (req.usuario.rol === 'admin') return grupo.institucion_id === req.usuario.institucion_id;
  if (req.usuario.rol === 'docente') {
    if (grupo.director_id === req.usuario.id) return true;
    const asignaciones = await materiasConDocentesDeGrupo(pool, grupo.id);
    return asignaciones.some(m => m.docente_id === req.usuario.id);
  }
  return false;
}

// Una persona solo puede consultar los datos de un estudiante si es el
// propio estudiante (rol estudiante) o el acudiente vinculado a él.
async function _puedeVerEstudiante(req, estudianteId) {
  if (req.usuario.rol === 'estudiante') return req.usuario.id === estudianteId;
  if (req.usuario.rol === 'acudiente') {
    const [rows] = await pool.query(
      `SELECT 1 FROM acudientes_estudiantes
       WHERE acudiente_id = ? AND estudiante_id = ? LIMIT 1`,
      [req.usuario.id, estudianteId]
    );
    return rows.length > 0;
  }
  return false;
}

// Si no mandan periodo_id, se usa el periodo marcado activo de la
// institución (mismo criterio que el resto del sistema).
async function resolverPeriodoId(periodoIdBody, institucionId) {
  if (periodoIdBody) return periodoIdBody;
  const [rows] = await pool.query(
    `SELECT id FROM periodos_academicos WHERE institucion_id = ? AND activo = TRUE LIMIT 1`,
    [institucionId]
  );
  return rows.length ? rows[0].id : null;
}

async function datosPeriodo(periodoId) {
  const [rows] = await pool.query(
    `SELECT nombre, anio_lectivo, fecha_inicio, fecha_fin FROM periodos_academicos WHERE id = ?`,
    [periodoId]
  );
  return rows.length ? rows[0] : null;
}

function promedioDesdeNotas(rows) {
  if (!rows.length) return null;
  let ponderada = 0, pesos = 0;
  for (const n of rows) {
    ponderada += (Number(n.valor) / Number(n.valor_max)) * Number(n.peso_pct);
    pesos += Number(n.peso_pct);
  }
  return pesos > 0 ? Number(((ponderada / pesos) * 10).toFixed(2)) : null;
}

// ---- arma todos los datos que va a llevar el PDF ---------------

async function armarDatosBoletin(estudianteId, grupoId, periodoId) {
  const [estudianteRows] = await pool.query(
    `SELECT id, nombres, apellidos, tipo_documento, numero_documento
     FROM usuarios WHERE id = ?`,
    [estudianteId]
  );
  if (!estudianteRows.length) return null;
  const estudiante = estudianteRows[0];

  const [institucionRows] = await pool.query(
    `SELECT i.nombre AS institucion_nombre, i.municipio, i.departamento,
            g.nombre AS grupo_nombre, gr.nombre AS grado_nombre
     FROM grupos g
     JOIN grados gr ON gr.id = g.grado_id
     JOIN instituciones i ON i.id = gr.institucion_id
     WHERE g.id = ?`,
    [grupoId]
  );
  const institucion = institucionRows[0];

  const periodo = await datosPeriodo(periodoId);

  const [materias] = await pool.query(
    `SELECT m.id, m.nombre, a.nombre AS area_nombre
     FROM materias m JOIN areas a ON a.id = m.area_id
     WHERE ${condicionMateriaEnGrupo()} AND m.activa = TRUE
     ORDER BY a.nombre, m.nombre`,
    parametrosMateriaEnGrupo(grupoId)
  );

  const [notas] = await pool.query(
    `SELECT materia_id, valor, valor_max, peso_pct FROM notas
     WHERE estudiante_id = ? AND periodo_id = ?
       AND materia_id IN (SELECT m.id FROM materias m WHERE ${condicionMateriaEnGrupo()})`,
    [estudianteId, periodoId, ...parametrosMateriaEnGrupo(grupoId)]
  );
  const notasPorMateria = {};
  for (const n of notas) (notasPorMateria[n.materia_id] ||= []).push(n);

  let sqlFallas = `
    SELECT materia_id, COUNT(*) AS fallas FROM asistencia
    WHERE estudiante_id = ? AND estado = 'ausente'
      AND materia_id IN (SELECT m.id FROM materias m WHERE ${condicionMateriaEnGrupo()})`;
  const paramsFallas = [estudianteId, ...parametrosMateriaEnGrupo(grupoId)];
  if (periodo) {
    sqlFallas += ` AND fecha BETWEEN ? AND ?`;
    paramsFallas.push(periodo.fecha_inicio, periodo.fecha_fin);
  }
  sqlFallas += ` GROUP BY materia_id`;
  const [fallasRows] = await pool.query(sqlFallas, paramsFallas);
  const fallasPorMateria = {};
  for (const f of fallasRows) fallasPorMateria[f.materia_id] = f.fallas;

  const desglose = materias.map(m => ({
    materia_id: m.id,
    materia_nombre: m.nombre,
    area_nombre: m.area_nombre,
    promedio: promedioDesdeNotas(notasPorMateria[m.id] || []),
    fallas: fallasPorMateria[m.id] || 0,
  }));

  const conPromedio = desglose.filter(d => d.promedio !== null);
  const promedioGeneral = conPromedio.length
    ? Number((conPromedio.reduce((a, d) => a + d.promedio, 0) / conPromedio.length).toFixed(2))
    : null;
  const fallasTotales = desglose.reduce((a, d) => a + d.fallas, 0);
  const asistenciaCurso = totalizarResumenAsistenciaDia(
    await obtenerResumenAsistenciaDia(grupoId, periodo.fecha_inicio, periodo.fecha_fin, estudianteId)
  );

  return {
    estudiante,
    institucion,
    periodo,
    materias: desglose,
    promedio_general: promedioGeneral,
    fallas_totales: fallasTotales,
    asistencia_curso: asistenciaCurso,
  };
}

// ---- informe ANUAL (D8) ----------------------------------------------
// Recorre TODOS los periodos del año y arma el promedio de cada materia
// combinando las notas del curso actual con el snapshot de `notas_periodo_cierre`
// (D7: periodos cursados en el curso anterior antes de un traslado).
// Identidad de materia entre cursos: por NOMBRE (regla decidida en D7).

async function armarDatosInformeAnual(estudianteId, grupoId, anioLectivo) {
  const [estudianteRows] = await pool.query(
    `SELECT id, nombres, apellidos, tipo_documento, numero_documento
     FROM usuarios WHERE id = ?`,
    [estudianteId]
  );
  if (!estudianteRows.length) return null;
  const estudiante = estudianteRows[0];

  const [institucionRows] = await pool.query(
    `SELECT i.id AS institucion_id, i.nombre AS institucion_nombre, i.municipio, i.departamento,
            g.nombre AS grupo_nombre, gr.nombre AS grado_nombre
     FROM grupos g
     JOIN grados gr ON gr.id = g.grado_id
     JOIN instituciones i ON i.id = gr.institucion_id
     WHERE g.id = ?`,
    [grupoId]
  );
  if (!institucionRows.length) return null;
  const institucion = institucionRows[0];

  const [yearPeriodos] = await pool.query(
    `SELECT id, nombre, fecha_inicio, fecha_fin FROM periodos_academicos
     WHERE institucion_id = ? AND anio_lectivo = ?
     ORDER BY numero_periodo`,
    [institucion.institucion_id, anioLectivo]
  );
  if (!yearPeriodos.length) {
    return {
      estudiante,
      institucion,
      anio_lectivo: anioLectivo,
      periodos: [],
      materias: [],
      promedio_general: null,
      fallas_totales: 0,
      asistencia_curso: { asistio: 0, falta: 0, tarde: 0, justificada: 0, total: 0 },
    };
  }
  const periodoIds = yearPeriodos.map(p => p.id);

  const [materias] = await pool.query(
    `SELECT m.id, m.nombre, a.nombre AS area_nombre
     FROM materias m JOIN areas a ON a.id = m.area_id
     WHERE ${condicionMateriaEnGrupo()} AND m.activa = TRUE
     ORDER BY a.nombre, m.nombre`,
    parametrosMateriaEnGrupo(grupoId)
  );
  const matIds = materias.map(m => m.id);
  const nombresMaterias = materias.map(m => m.nombre);

  let notas = [];
  if (matIds.length && periodoIds.length) {
    [notas] = await pool.query(
      `SELECT materia_id, periodo_id, valor, valor_max, peso_pct FROM notas
       WHERE estudiante_id = ?
         AND materia_id IN (${matIds.map(() => '?').join(',')})
         AND periodo_id IN (${periodoIds.map(() => '?').join(',')})`,
      [estudianteId, ...matIds, ...periodoIds]
    );
  }
  const notasPorPeriodoMateria = {};
  for (const n of notas) {
    const key = `${n.periodo_id}|${n.materia_id}`;
    if (!notasPorPeriodoMateria[key]) notasPorPeriodoMateria[key] = [];
    notasPorPeriodoMateria[key].push(n);
  }

  // Snapshot de los periodos del curso anterior (D7).
  let snapshot = [];
  if (nombresMaterias.length && periodoIds.length) {
    [snapshot] = await pool.query(
      `SELECT periodo_id, materia_nombre, promedio_periodo FROM notas_periodo_cierre
       WHERE estudiante_id = ? AND anio_lectivo = ?
         AND periodo_id IN (${periodoIds.map(() => '?').join(',')})
         AND materia_nombre IN (${nombresMaterias.map(() => '?').join(',')})`,
      [estudianteId, anioLectivo, ...periodoIds, ...nombresMaterias]
    );
  }
  const snapshotPorPeriodo = {};
  for (const s of snapshot) {
    if (!snapshotPorPeriodo[s.periodo_id]) snapshotPorPeriodo[s.periodo_id] = {};
    snapshotPorPeriodo[s.periodo_id][s.materia_nombre] = Number(s.promedio_periodo);
  }

  // Promedio por materia/periodo: nota actual si existe, si no el snapshot.
  const desglose = materias.map(m => {
    const periodosMateria = yearPeriodos.map(p => {
      let promedio = null;
      const rows = notasPorPeriodoMateria[`${p.id}|${m.id}`];
      if (rows && rows.length) {
        const calc = promedioDesdeNotas(rows);
        promedio = calc;
      } else if (snapshotPorPeriodo[p.id] && snapshotPorPeriodo[p.id][m.nombre] !== undefined) {
        promedio = snapshotPorPeriodo[p.id][m.nombre];
      }
      return { nombre: p.nombre, promedio: promedio === null ? null : Number(promedio) };
    });
    const conValor = periodosMateria.filter(pp => pp.promedio !== null);
    const promedioAnual = conValor.length
      ? Number((conValor.reduce((a, pp) => a + pp.promedio, 0) / conValor.length).toFixed(2))
      : null;
    return {
      materia_nombre: m.nombre,
      area_nombre: m.area_nombre,
      periodos: periodosMateria,
      promedio: promedioAnual,
      fallas: 0, // se llena abajo
    };
  });

  // Fallas por materia dentro del rango del año (solo materias del curso actual).
  if (matIds.length) {
    const desde = yearPeriodos[0].fecha_inicio;
    const hasta = yearPeriodos[yearPeriodos.length - 1].fecha_fin;
    const [fallas] = await pool.query(
      `SELECT materia_id, COUNT(*) AS total FROM asistencia
       WHERE estudiante_id = ? AND estado = 'ausente'
         AND fecha BETWEEN ? AND ?
         AND materia_id IN (${matIds.map(() => '?').join(',')})
       GROUP BY materia_id`,
      [estudianteId, desde, hasta, ...matIds]
    );
    const fallasPorMateria = {};
    for (const f of fallas) fallasPorMateria[f.materia_id] = f.total;
    for (const d of desglose) {
      const m = materias.find(mm => mm.nombre === d.materia_nombre);
      d.fallas = fallasPorMateria[m ? m.id : ''] || 0;
    }
  }

  const conPromedio = desglose.filter(d => d.promedio !== null);
  const promedioGeneral = conPromedio.length
    ? Number((conPromedio.reduce((a, d) => a + d.promedio, 0) / conPromedio.length).toFixed(2))
    : null;
  const fallasTotales = desglose.reduce((a, d) => a + d.fallas, 0);
  const asistenciaCurso = totalizarResumenAsistenciaDia(
    await obtenerResumenAsistenciaDia(
      grupoId,
      yearPeriodos[0].fecha_inicio,
      yearPeriodos[yearPeriodos.length - 1].fecha_fin,
      estudianteId
    )
  );

  return {
    estudiante,
    institucion,
    anio_lectivo: anioLectivo,
    periodos: yearPeriodos.map(p => ({ id: p.id, nombre: p.nombre })),
    materias: desglose,
    promedio_general: promedioGeneral,
    fallas_totales: fallasTotales,
    asistencia_curso: asistenciaCurso,
  };
}

// ---- genera el PDF en memoria (Buffer) --------------------------

function generarPdfBoletin(datos, observaciones) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'letter' });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Encabezado institucional
    doc.fontSize(16).font('Helvetica-Bold').text(datos.institucion.institucion_nombre, { align: 'center' });
    const ubicacion = [datos.institucion.municipio, datos.institucion.departamento].filter(Boolean).join(', ');
    if (ubicacion) {
      doc.fontSize(10).font('Helvetica').text(ubicacion, { align: 'center' });
    }
    doc.moveDown(0.5);
    doc.fontSize(14).font('Helvetica-Bold').text('Boletín de calificaciones', { align: 'center' });
    doc.moveDown();

    // Datos del estudiante y del periodo
    doc.fontSize(11).font('Helvetica');
    doc.text(`Estudiante: ${datos.estudiante.nombres} ${datos.estudiante.apellidos}`);
    doc.text(`Documento: ${datos.estudiante.tipo_documento} ${datos.estudiante.numero_documento}`);
    doc.text(`Curso: ${datos.institucion.grado_nombre} - ${datos.institucion.grupo_nombre}`);
    doc.text(`Periodo: ${datos.periodo.nombre} (${datos.periodo.anio_lectivo})`);
    doc.text(`Del ${datos.periodo.fecha_inicio.toLocaleDateString?.('es-CO') || datos.periodo.fecha_inicio} al ${datos.periodo.fecha_fin.toLocaleDateString?.('es-CO') || datos.periodo.fecha_fin}`);
    doc.moveDown();

    // Tabla de materias
    const colX = { materia: 50, area: 230, promedio: 380, fallas: 460 };
    let y = doc.y;
    doc.font('Helvetica-Bold').fontSize(10);
    doc.text('Materia', colX.materia, y, { width: 170 });
    doc.text('Área', colX.area, y, { width: 140 });
    doc.text('Promedio', colX.promedio, y, { width: 70 });
    doc.text('Fallas materia', colX.fallas, y, { width: 75 });
    doc.moveDown(0.3);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#cccccc').stroke();
    doc.moveDown(0.3);

    doc.font('Helvetica').fontSize(10);
    for (const m of datos.materias) {
      y = doc.y;
      doc.text(m.materia_nombre, colX.materia, y, { width: 170 });
      doc.text(m.area_nombre, colX.area, y, { width: 140 });
      doc.text(m.promedio !== null ? String(m.promedio) : '—', colX.promedio, y, { width: 70 });
      doc.text(String(m.fallas), colX.fallas, y, { width: 60 });
      doc.moveDown(0.4);
    }

    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#cccccc').stroke();
    doc.moveDown(0.5);

    doc.font('Helvetica-Bold').fontSize(11);
    doc.text(`Promedio general: ${datos.promedio_general !== null ? datos.promedio_general : '—'}`);
    doc.text(`Fallas históricas por materia: ${datos.fallas_totales}`);
    doc.text(
      `Asistencia diaria del curso: asistió ${datos.asistencia_curso.asistio}, tarde ${datos.asistencia_curso.tarde}, falta ${datos.asistencia_curso.falta}, justificada ${datos.asistencia_curso.justificada}`
    );

    if (observaciones) {
      doc.moveDown();
      doc.font('Helvetica-Bold').fontSize(11).text('Observaciones:');
      doc.font('Helvetica').fontSize(10).text(observaciones, { width: 495 });
    }

    doc.moveDown(2);
    doc.fontSize(8).fillColor('gray')
      .text(`Generado el ${new Date().toLocaleString('es-CO')}`, { align: 'right' });

    doc.end();
  });
}

function generarPdfInformeAnual(datos, observaciones) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'letter' });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Encabezado institucional
    doc.fontSize(16).font('Helvetica-Bold').text(datos.institucion.institucion_nombre, { align: 'center' });
    const ubicacion = [datos.institucion.municipio, datos.institucion.departamento].filter(Boolean).join(', ');
    if (ubicacion) doc.fontSize(10).font('Helvetica').text(ubicacion, { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(14).font('Helvetica-Bold').text('Informe anual de calificaciones', { align: 'center' });
    doc.moveDown();

    // Datos del estudiante
    doc.fontSize(11).font('Helvetica');
    doc.text(`Estudiante: ${datos.estudiante.nombres} ${datos.estudiante.apellidos}`);
    doc.text(`Documento: ${datos.estudiante.tipo_documento} ${datos.estudiante.numero_documento}`);
    doc.text(`Curso: ${datos.institucion.grado_nombre} - ${datos.institucion.grupo_nombre}`);
    doc.text(`Año lectivo: ${datos.anio_lectivo} · Periodos: ${datos.periodos.map(p => p.nombre).join(', ') || 'Ninguno'}`);
    doc.moveDown();

    // Tabla: Materia | Área | (una columna por periodo) | Prom | Fallas
    const colsPeriodo = datos.periodos.map(p => p.nombre);
    const wMateria = 130, wArea = 95, wProm = 55, wFalla = 42;
    const wPer = Math.min(48, Math.floor((545 - wMateria - wArea - wProm - wFalla) / Math.max(colsPeriodo.length, 1)));
    let y = doc.y;
    doc.font('Helvetica-Bold').fontSize(9);
    let x = 50;
    const escribirHeader = (txt, w, al) => { doc.text(txt, x, y, { width: w, align: al || 'left' }); x += w; };
    escribirHeader('Materia', wMateria);
    escribirHeader('Área', wArea);
    for (const c of colsPeriodo) escribirHeader(String(c).slice(0, 10), wPer, 'center');
    escribirHeader('Promedio', wProm, 'center');
    escribirHeader('Fallas materia', wFalla, 'center');
    doc.moveDown(0.3);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#cccccc').stroke();
    doc.moveDown(0.3);

    doc.font('Helvetica').fontSize(9);
    for (const m of datos.materias) {
      y = doc.y;
      x = 50;
      const nombre = m.materia_nombre.length > 28 ? m.materia_nombre.slice(0, 27) + '…' : m.materia_nombre;
      doc.text(nombre, x, y, { width: wMateria }); x += wMateria;
      doc.text(m.area_nombre, x, y, { width: wArea }); x += wArea;
      for (const pp of m.periodos) {
        doc.text(pp.promedio !== null ? String(pp.promedio) : '—', x, y, { width: wPer, align: 'center' }); x += wPer;
      }
      doc.text(m.promedio !== null ? String(m.promedio) : '—', x, y, { width: wProm, align: 'center' }); x += wProm;
      doc.text(String(m.fallas), x, y, { width: wFalla, align: 'center' });
      doc.moveDown(0.4);
    }

    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#cccccc').stroke();
    doc.moveDown(0.5);

    doc.font('Helvetica-Bold').fontSize(11);
    doc.text(`Promedio anual: ${datos.promedio_general !== null ? datos.promedio_general : '—'}`);
    doc.text(`Fallas históricas por materia: ${datos.fallas_totales}`);
    doc.text(
      `Asistencia diaria del curso: asistió ${datos.asistencia_curso.asistio}, tarde ${datos.asistencia_curso.tarde}, falta ${datos.asistencia_curso.falta}, justificada ${datos.asistencia_curso.justificada}`
    );

    if (observaciones) {
      doc.moveDown();
      doc.font('Helvetica-Bold').fontSize(11).text('Observaciones:');
      doc.font('Helvetica').fontSize(10).text(observaciones, { width: 495 });
    }

    doc.moveDown(2);
    doc.fontSize(8).fillColor('gray')
      .text(`Generado el ${new Date().toLocaleString('es-CO')}`, { align: 'right' });

    doc.end();
  });
}

// ────────────────────────────────────────────────────────────
//  POST /api/boletines/estudiante/:estudianteId/generar
//  body: { grupo_id, periodo_id? , observaciones? }
// ────────────────────────────────────────────────────────────
exports.generarBoletin = async (req, res) => {
  const { estudianteId } = req.params;
  const { grupo_id, periodo_id, observaciones } = req.body;

  if (!grupo_id) {
    return res.status(400).json({ ok: false, mensaje: 'Falta grupo_id.' });
  }

  try {
    const grupo = await datosGrupo(grupo_id);
    if (!(await puedeGestionarBoletin(req, grupo))) {
      return res.status(403).json({ ok: false, mensaje: 'No tienes permiso para generar el boletín de este curso.' });
    }

    const [matriculado] = await pool.query(
      `SELECT 1 FROM matriculas WHERE estudiante_id = ? AND grupo_id = ? AND estado = 'activa'`,
      [estudianteId, grupo_id]
    );
    if (!matriculado.length) {
      return res.status(404).json({ ok: false, mensaje: 'Ese estudiante no está matriculado activo en este curso.' });
    }

    const periodoId = await resolverPeriodoId(periodo_id, grupo.institucion_id);
    if (!periodoId) {
      return res.status(409).json({ ok: false, mensaje: 'No hay ningún periodo académico activo ni creado. Crea uno primero.' });
    }

    const datos = await armarDatosBoletin(estudianteId, grupo_id, periodoId);
    if (!datos) {
      return res.status(404).json({ ok: false, mensaje: 'Estudiante no encontrado.' });
    }

    const pdfBuffer = await generarPdfBoletin(datos, observaciones || null);

    fs.mkdirSync(CARPETA_BOLETINES, { recursive: true });
    const nombreStorage = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.pdf`;
    fs.writeFileSync(path.join(CARPETA_BOLETINES, nombreStorage), pdfBuffer);

    const nombreOriginal = `boletin_${datos.estudiante.apellidos}_${datos.periodo.nombre}.pdf`.replace(/\s+/g, '_');
    const descripcionArchivo = `Boletín de ${datos.estudiante.nombres} ${datos.estudiante.apellidos} — periodo ${datos.periodo.nombre}`;

    const archivoId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO archivos
         (id, subido_por, tipo, nombre_original, nombre_storage, ruta_storage, mime_type, tamanio_bytes, es_publico, ref_grupo_id, descripcion)
       VALUES (?, ?, 'boletin', ?, ?, ?, 'application/pdf', ?, 0, ?, ?)`,
      [archivoId, req.usuario.id, nombreOriginal, nombreStorage, `/storage/boletines/${nombreStorage}`, pdfBuffer.length, grupo_id, descripcionArchivo]
    );

    const boletinId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO boletines (id, estudiante_id, grupo_id, periodo_id, generado_por, archivo_id, observaciones)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [boletinId, estudianteId, grupo_id, periodoId, req.usuario.id, archivoId, observaciones || null]
    );

    return res.status(201).json({
      ok: true,
      boletin_id: boletinId,
      descarga_url: `/api/boletines/${boletinId}/descargar`,
    });
  } catch (err) {
    console.error('generarBoletin:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// ────────────────────────────────────────────────────────────
//  POST /api/boletines/estudiante/:estudianteId/generar-anual
//  Informe de TODO el año (D8): promedio anual por materia combinando el
//  snapshot de D7 (periodos del curso anterior). Lo pueden generar el
//  admin/superadmin, el director o docente del curso, el propio
//  estudiante (self) y el acudiente de ese estudiante (su hijo).
//  body: { grupo_id?, anio_lectivo?, observaciones? }
//  - Si no mandan grupo_id, se usa la matrícula activa del estudiante.
//  - Si no mandan anio_lectivo, el de esa matrícula.
// ────────────────────────────────────────────────────────────
exports.generarInformeAnual = async (req, res) => {
  const { estudianteId } = req.params;
  const { grupo_id, anio_lectivo, observaciones } = req.body;

  try {
    const estudiante = await pool.query(`SELECT id FROM usuarios WHERE id = ?`, [estudianteId]);
    if (!estudiante[0].length) {
      return res.status(404).json({ ok: false, mensaje: 'Estudiante no encontrado.' });
    }

    // Matrícula activa (grupo + año por defecto) si no especifican
    // el grupo. Para el estudiante o acudiente SIEMPRE se usa la propia
    // (no pueden pedir el informe de otro curso).
    let grupoSeleccionado = grupo_id || null;
    let anioSeleccionado = anio_lectivo || null;

    const [matricula] = await pool.query(
      `SELECT mt.grupo_id, mt.anio_lectivo
       FROM matriculas mt
       JOIN grupos g ON g.id = mt.grupo_id
       JOIN grados gr ON gr.id = g.grado_id
       WHERE mt.estudiante_id = ? AND mt.estado = 'activa'
         AND gr.institucion_id = COALESCE(?, (SELECT institucion_id FROM usuarios WHERE id = ?))
       ORDER BY mt.created_at DESC LIMIT 1`,
      [estudianteId, req.usuario.institucion_id, req.usuario.id]
    );

    const esStaff = req.usuario.rol === 'admin' || req.usuario.rol === 'superadmin' || req.usuario.rol === 'docente';
    const esSelfOHijo = await _puedeVerEstudiante(req, estudianteId);
    if (!esStaff && !esSelfOHijo) {
      return res.status(403).json({ ok: false, mensaje: 'No tienes permiso para generar este informe.' });
    }

    if (!esStaff) {
      // Estudiante/acudiente: solo el grupo activo del estudiante.
      if (!matricula.length) {
        return res.status(404).json({ ok: false, mensaje: 'El estudiante no tiene una matrícula activa.' });
      }
      grupoSeleccionado = matricula[0].grupo_id;
      anioSeleccionado = anioSeleccionado === null ? matricula[0].anio_lectivo : anioSeleccionado;
    } else {
      if (!grupoSeleccionado) {
        if (!matricula.length) {
          return res.status(404).json({ ok: false, mensaje: 'El estudiante no tiene una matrícula activa.' });
        }
        grupoSeleccionado = matricula[0].grupo_id;
      }
      if (anioSeleccionado === null) anioSeleccionado = matricula.length ? matricula[0].anio_lectivo : null;
    }

    const grupo = await datosGrupo(grupoSeleccionado);
    if (!grupo) {
      return res.status(404).json({ ok: false, mensaje: 'Curso no encontrado.' });
    }

    // Para el staff aplican los permisos del curso; para el estudiante/
    // acudiente ya validamos el vínculo arriba.
    if (esStaff && !(await puedeGestionarBoletin(req, grupo))) {
      return res.status(403).json({ ok: false, mensaje: 'No tienes permiso para generar el informe anual de este curso.' });
    }

    // Año por defecto = el de la institución (último periodo creado).
    if (!anioSeleccionado) {
      const [per] = await pool.query(
        `SELECT MAX(anio_lectivo) AS anio FROM periodos_academicos WHERE institucion_id = ?`,
        [grupo.institucion_id]
      );
      anioSeleccionado = per.length && per[0].anio !== null ? per[0].anio : new Date().getFullYear();
    }

    const datos = await armarDatosInformeAnual(estudianteId, grupoSeleccionado, anioSeleccionado);
    if (!datos) {
      return res.status(404).json({ ok: false, mensaje: 'No se pudieron armar los datos del informe.' });
    }
    if (!datos.periodos.length) {
      return res.status(409).json({ ok: false, mensaje: `No hay periodos académicos creados para el año ${anioSeleccionado}.` });
    }

    const pdfBuffer = await generarPdfInformeAnual(datos, observaciones || null);

    fs.mkdirSync(CARPETA_BOLETINES, { recursive: true });
    const nombreStorage = `${Date.now()}-informe-anual-${crypto.randomBytes(6).toString('hex')}.pdf`;
    fs.writeFileSync(path.join(CARPETA_BOLETINES, nombreStorage), pdfBuffer);

    const nombreOriginal = `informe_anual_${datos.estudiante.apellidos}_${anioSeleccionado}.pdf`.replace(/\s+/g, '_');
    const descripcionArchivo = `Informe anual ${anioSeleccionado} — ${datos.estudiante.nombres} ${datos.estudiante.apellidos}`;

    const archivoId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO archivos
         (id, subido_por, tipo, nombre_original, nombre_storage, ruta_storage, mime_type, tamanio_bytes, es_publico, ref_grupo_id, descripcion)
       VALUES (?, ?, 'boletin', ?, ?, ?, 'application/pdf', ?, 0, ?, ?)`,
      [archivoId, req.usuario.id, nombreOriginal, nombreStorage, `/storage/boletines/${nombreStorage}`, pdfBuffer.length, grupoSeleccionado, descripcionArchivo]
    );

    const boletinId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO boletines (id, estudiante_id, grupo_id, periodo_id, tipo, anio_lectivo, generado_por, archivo_id, observaciones)
       VALUES (?, ?, ?, NULL, 'anual', ?, ?, ?, ?, ?)`,
      [boletinId, estudianteId, grupoSeleccionado, anioSeleccionado, req.usuario.id, archivoId, observaciones || null]
    );

    return res.status(201).json({
      ok: true,
      boletin_id: boletinId,
      descarga_url: `/api/boletines/${boletinId}/descargar`,
    });
  } catch (err) {
    console.error('generarInformeAnual:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// ────────────────────────────────────────────────────────────
//  GET /api/boletines/estudiante/:estudianteId?grupo_id=
//  Historial de boletines ya generados para ese estudiante en ese curso.
// ────────────────────────────────────────────────────────────
exports.historialEstudiante = async (req, res) => {
  const { estudianteId } = req.params;
  const { grupo_id } = req.query;

  try {
    let grupoId = grupo_id || null;
    if (!grupoId) {
      const [matricula] = await pool.query(
        `SELECT grupo_id FROM matriculas
         WHERE estudiante_id = ? AND estado = 'activa'
         ORDER BY created_at DESC LIMIT 1`,
        [estudianteId]
      );
      if (!matricula.length) {
        return res.status(404).json({ ok: false, mensaje: 'El estudiante no tiene una matrícula activa.' });
      }
      grupoId = matricula[0].grupo_id;
    }

    const grupo = await datosGrupo(grupoId);
    const puedeStaff = await puedeGestionarBoletin(req, grupo);
    const puedeSelfHijo = await _puedeVerEstudiante(req, estudianteId);
    if (!puedeStaff && !puedeSelfHijo) {
      return res.status(403).json({ ok: false, mensaje: 'No tienes permiso para ver el historial de este estudiante.' });
    }

    const [rows] = await pool.query(
      `SELECT b.id, b.tipo, b.anio_lectivo, b.periodo_id, p.nombre AS periodo_nombre,
              b.observaciones, b.created_at,
              u.nombres AS generado_por_nombres, u.apellidos AS generado_por_apellidos
       FROM boletines b
       LEFT JOIN periodos_academicos p ON p.id = b.periodo_id
       JOIN usuarios u ON u.id = b.generado_por
       WHERE b.estudiante_id = ? AND b.grupo_id = ?
       ORDER BY b.created_at DESC`,
      [estudianteId, grupoId]
    );

    return res.json({
      ok: true,
      total: rows.length,
      boletines: rows.map(r => ({ ...r, descarga_url: `/api/boletines/${r.id}/descargar` })),
    });
  } catch (err) {
    console.error('historialEstudiante:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// ────────────────────────────────────────────────────────────
//  GET /api/boletines/:id/descargar
// ────────────────────────────────────────────────────────────
exports.descargarBoletin = async (req, res) => {
  const { id } = req.params;

  try {
    const [rows] = await pool.query(
      `SELECT b.grupo_id, b.estudiante_id, a.ruta_storage, a.nombre_original
       FROM boletines b JOIN archivos a ON a.id = b.archivo_id
       WHERE b.id = ?`,
      [id]
    );
    if (!rows.length) {
      return res.status(404).json({ ok: false, mensaje: 'Boletín no encontrado.' });
    }
    const boletin = rows[0];

    const grupo = await datosGrupo(boletin.grupo_id);
    const puedeStaff = await puedeGestionarBoletin(req, grupo);
    const puedeSelfHijo = await _puedeVerEstudiante(req, boletin.estudiante_id);
    if (!puedeStaff && !puedeSelfHijo) {
      return res.status(403).json({ ok: false, mensaje: 'No tienes permiso para descargar este boletín.' });
    }

    const rutaAbsoluta = path.join(__dirname, '../..', boletin.ruta_storage);
    return res.download(rutaAbsoluta, boletin.nombre_original);
  } catch (err) {
    console.error('descargarBoletin:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};
