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
    const [rows] = await pool.query(
      `SELECT 1 FROM docentes_materias dm JOIN materias m ON m.id = dm.materia_id
       WHERE m.grupo_id = ? AND dm.docente_id = ? LIMIT 1`,
      [grupo.id, req.usuario.id]
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
     WHERE m.grupo_id = ? AND m.activa = TRUE
     ORDER BY a.nombre, m.nombre`,
    [grupoId]
  );

  const [notas] = await pool.query(
    `SELECT materia_id, valor, valor_max, peso_pct FROM notas
     WHERE estudiante_id = ? AND periodo_id = ?
       AND materia_id IN (SELECT id FROM materias WHERE grupo_id = ?)`,
    [estudianteId, periodoId, grupoId]
  );
  const notasPorMateria = {};
  for (const n of notas) (notasPorMateria[n.materia_id] ||= []).push(n);

  let sqlFallas = `
    SELECT materia_id, COUNT(*) AS fallas FROM asistencia
    WHERE estudiante_id = ? AND estado = 'ausente'
      AND materia_id IN (SELECT id FROM materias WHERE grupo_id = ?)`;
  const paramsFallas = [estudianteId, grupoId];
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

  return {
    estudiante,
    institucion,
    periodo,
    materias: desglose,
    promedio_general: promedioGeneral,
    fallas_totales: fallasTotales,
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
    doc.text('Fallas', colX.fallas, y, { width: 60 });
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
    doc.text(`Fallas totales del periodo: ${datos.fallas_totales}`);

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
//  GET /api/boletines/estudiante/:estudianteId?grupo_id=
//  Historial de boletines ya generados para ese estudiante en ese curso.
// ────────────────────────────────────────────────────────────
exports.historialEstudiante = async (req, res) => {
  const { estudianteId } = req.params;
  const { grupo_id } = req.query;

  if (!grupo_id) {
    return res.status(400).json({ ok: false, mensaje: 'Falta grupo_id.' });
  }

  try {
    const grupo = await datosGrupo(grupo_id);
    if (!(await puedeGestionarBoletin(req, grupo))) {
      return res.status(403).json({ ok: false, mensaje: 'No tienes permiso para ver el historial de este curso.' });
    }

    const [rows] = await pool.query(
      `SELECT b.id, b.periodo_id, p.nombre AS periodo_nombre, p.anio_lectivo,
              b.observaciones, b.created_at,
              u.nombres AS generado_por_nombres, u.apellidos AS generado_por_apellidos
       FROM boletines b
       JOIN periodos_academicos p ON p.id = b.periodo_id
       JOIN usuarios u ON u.id = b.generado_por
       WHERE b.estudiante_id = ? AND b.grupo_id = ?
       ORDER BY b.created_at DESC`,
      [estudianteId, grupo_id]
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
      `SELECT b.grupo_id, a.ruta_storage, a.nombre_original
       FROM boletines b JOIN archivos a ON a.id = b.archivo_id
       WHERE b.id = ?`,
      [id]
    );
    if (!rows.length) {
      return res.status(404).json({ ok: false, mensaje: 'Boletín no encontrado.' });
    }
    const boletin = rows[0];

    const grupo = await datosGrupo(boletin.grupo_id);
    if (!(await puedeGestionarBoletin(req, grupo))) {
      return res.status(403).json({ ok: false, mensaje: 'No tienes permiso para descargar este boletín.' });
    }

    const rutaAbsoluta = path.join(__dirname, '../..', boletin.ruta_storage);
    return res.download(rutaAbsoluta, boletin.nombre_original);
  } catch (err) {
    console.error('descargarBoletin:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};
