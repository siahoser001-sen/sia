// ============================================================
//  informe-didactico.controller.js — MySQL
//  Informe didáctico del curso (ROADMAP D9): promedio total del
//  curso, materias de mejor a peor, horas/semana y horas al año
//  (franjas del horario × semanas del ciclo, D6), fallas históricas
//  por materia y resumen de asistencia diaria del curso. Lo usa el director
//  del curso (o admin/superadmin)
//  como documento de análisis pedagógico.
// ============================================================

const PDFDocument = require('pdfkit');
const pool = require('../config/db');
const { obtenerCiclo } = require('../utils/ciclo.util');
const {
  condicionMateriaEnGrupo,
  parametrosMateriaEnGrupo,
} = require('../utils/materias-curso.util');
const {
  obtenerResumenAsistenciaDia,
  totalizarResumenAsistenciaDia,
} = require('../services/asistencia-dia.service');

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

async function puedeVerInforme(req, grupo) {
  if (!grupo) return false;
  if (req.usuario.rol === 'superadmin') return true;
  if (req.usuario.rol === 'admin') return grupo.institucion_id === req.usuario.institucion_id;
  if (req.usuario.rol === 'docente') return grupo.director_id === req.usuario.id;
  return false;
}

// Devuelve el año lectivo pedido o el de mayor anio_lectivo creado.
async function resolverAnio(institucionId, anioQuery) {
  if (anioQuery) return Number(anioQuery);
  const [max] = await pool.query(
    `SELECT MAX(anio_lectivo) AS anio FROM periodos_academicos WHERE institucion_id = ?`,
    [institucionId]
  );
  return max.length && max[0].anio !== null ? max[0].anio : new Date().getFullYear();
}

function promedioSimple(lista) {
  if (!lista.length) return null;
  return Number((lista.reduce((a, b) => a + b, 0) / lista.length).toFixed(2));
}

function promedioPonderado(rows) {
  if (!rows.length) return null;
  let ponderada = 0, pesos = 0;
  for (const n of rows) {
    ponderada += (Number(n.valor) / Number(n.valor_max)) * Number(n.peso_pct);
    pesos += Number(n.peso_pct);
  }
  return pesos > 0 ? Number(((ponderada / pesos) * 10).toFixed(2)) : null;
}

async function armarDatos(grupo, anio) {
  const [institucion] = await pool.query(
    `SELECT i.nombre AS institucion_nombre, i.municipio, i.departamento
     FROM instituciones i WHERE i.id = ?`,
    [grupo.institucion_id]
  );
  const inst = institucion.length ? institucion[0] : { institucion_nombre: 'Institución', municipio: null, departamento: null };

  const [periodos] = await pool.query(
    `SELECT id, nombre, fecha_inicio, fecha_fin FROM periodos_academicos
     WHERE institucion_id = ? AND anio_lectivo = ?
     ORDER BY numero_periodo`,
    [grupo.institucion_id, anio]
  );
  if (!periodos.length) return null;
  const periodoIds = periodos.map(p => p.id);
  const desde = periodos[0].fecha_inicio;
  const hasta = periodos[periodos.length - 1].fecha_fin;

  const [materias] = await pool.query(
    `SELECT m.id, m.nombre, a.nombre AS area_nombre, a.color_hex
     FROM materias m JOIN areas a ON a.id = m.area_id
     WHERE ${condicionMateriaEnGrupo()} AND m.activa = TRUE
     ORDER BY a.nombre, m.nombre`,
    parametrosMateriaEnGrupo(grupo.id)
  );
  const matIds = materias.map(m => m.id);

  // Notas (cualquier estudiante del curso) → promedio por materia.
  let notas = [];
  if (matIds.length && periodoIds.length) {
    [notas] = await pool.query(
      `SELECT n.estudiante_id, n.materia_id, n.periodo_id, n.valor, n.valor_max, n.peso_pct
       FROM notas n
       WHERE n.materia_id IN (${matIds.map(() => '?').join(',')})
         AND n.periodo_id IN (${periodoIds.map(() => '?').join(',')})`,
      [...matIds, ...periodoIds]
    );
  }
  const porKey = {};
  for (const n of notas) {
    const key = `${n.materia_id}|${n.estudiante_id}|${n.periodo_id}`;
    if (!porKey[key]) porKey[key] = [];
    porKey[key].push(n);
  }
  const promediosPorMateria = {}; // materia_id -> [promedios de estudiante×periodo]
  for (const key of Object.keys(porKey)) {
    const prom = promedioPonderado(porKey[key]);
    if (prom === null) continue;
    const materiaId = key.split('|')[0];
    if (!promediosPorMateria[materiaId]) promediosPorMateria[materiaId] = [];
    promediosPorMateria[materiaId].push(prom);
  }

  // Horas/semana desde el horario (una franja = una hora semanal).
  let horas = {};
  if (matIds.length) {
    const [franjas] = await pool.query(
      `SELECT materia_id, COUNT(*) AS tot FROM horarios
       WHERE grupo_id = ? AND materia_id IN (${matIds.map(() => '?').join(',')})
       GROUP BY materia_id`,
      [grupo.id, ...matIds]
    );
    for (const f of franjas) horas[f.materia_id] = f.tot;
  }

  // Fallas totales por materia dentro del año.
  let fallas = {};
  if (matIds.length) {
    const [fallasRows] = await pool.query(
      `SELECT materia_id, COUNT(*) AS tot FROM asistencia
       WHERE estado = 'ausente' AND fecha BETWEEN ? AND ?
         AND materia_id IN (${matIds.map(() => '?').join(',')})
       GROUP BY materia_id`,
      [desde, hasta, ...matIds]
    );
    for (const f of fallasRows) fallas[f.materia_id] = f.tot;
  }

  const ciclo = await obtenerCiclo(grupo.institucion_id, anio);
  const semanas = ciclo ? ciclo.semanas : 0;

  const materia = materias.map(m => {
    const lista = promediosPorMateria[m.id] || [];
    const horasSemana = horas[m.id] || 0;
    return {
      materia_id: m.id,
      materia_nombre: m.nombre,
      area_nombre: m.area_nombre,
      color_hex: m.color_hex,
      promedio: promedioSimple(lista),
      horas_semana: horasSemana,
      horas_anio: horasSemana ? horasSemana * semanas : 0,
      fallas: fallas[m.id] || 0,
    };
  }).sort((a, b) => (b.promedio ?? -1) - (a.promedio ?? -1));

  const conPromedio = materia.filter(m => m.promedio !== null);
  const promedioCurso = promedioSimple(conPromedio.map(m => m.promedio));
  const fallasTotales = materia.reduce((a, m) => a + m.fallas, 0);
  const asistenciaCurso = totalizarResumenAsistenciaDia(
    await obtenerResumenAsistenciaDia(grupo.id, desde, hasta)
  );
  const horasTotalesAnio = materia.reduce((a, m) => a + m.horas_anio, 0);

  return {
    institucion: inst,
    grupo: { id: grupo.id, grupo_nombre: grupo.grupo_nombre, grado_nombre: grupo.grado_nombre },
    anio_lectivo: anio,
    semanas: semanas,
    total_estudiantes_matriculados: null, // se llena en el controller si hace falta
    materias: materia,
    promedio_curso: promedioCurso,
    fallas_totales: fallasTotales,
    asistencia_curso: asistenciaCurso,
    horas_totales_anio: horasTotalesAnio,
  };
}

// ────────────────────────────────────────────────────────────
//  GET /api/informe-didactico/curso/:grupoId?anio_lectivo=
//  Datos en JSON del informe didáctico.
// ────────────────────────────────────────────────────────────
exports.informeDidactico = async (req, res) => {
  const { grupoId } = req.params;

  try {
    const grupo = await datosGrupo(grupoId);
    if (!(await puedeVerInforme(req, grupo))) {
      return res.status(403).json({ ok: false, mensaje: 'No tienes permiso para ver el informe didáctico de este curso.' });
    }

    const anio = await resolverAnio(grupo.institucion_id, req.query.anio_lectivo);
    if (!anio) {
      return res.status(409).json({ ok: false, mensaje: 'Tu institución todavía no tiene periodos académicos creados.' });
    }

    const datos = await armarDatos(grupo, anio);
    if (!datos) {
      return res.status(409).json({ ok: false, mensaje: `No hay periodos académicos creados para el año ${anio}.` });
    }

    const [matriculados] = await pool.query(
      `SELECT COUNT(*) AS total FROM matriculas WHERE grupo_id = ? AND estado = 'activa'`,
      [grupoId]
    );
    datos.total_estudiantes_matriculados = matriculados[0].total;

    return res.json({ ok: true, ...datos });
  } catch (err) {
    console.error('informeDidactico:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

function generarPdf(datos) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'letter' });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(16).font('Helvetica-Bold').text(datos.institucion.institucion_nombre, { align: 'center' });
    const ubicacion = [datos.institucion.municipio, datos.institucion.departamento].filter(Boolean).join(', ');
    if (ubicacion) doc.fontSize(10).font('Helvetica').text(ubicacion, { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(14).font('Helvetica-Bold').text('Informe didáctico del curso', { align: 'center' });
    doc.moveDown();

    doc.fontSize(11).font('Helvetica');
    doc.text(`Curso: ${datos.grupo.grado_nombre} - ${datos.grupo.grupo_nombre}`);
    doc.text(`Año lectivo: ${datos.anio_lectivo} · Semanas del ciclo: ${datos.semanas}`);
    doc.text(`Estudiantes matriculados: ${datos.total_estudiantes_matriculados ?? 0}`);
    doc.moveDown();

    const wRank = 30, wMateria = 150, wArea = 100, wProm = 60, wHs = 52, wHa = 52, wFl = 45;
    let y = doc.y;
    doc.font('Helvetica-Bold').fontSize(9);
    let x = 50;
    const hdr = (txt, w, al) => { doc.text(txt, x, y, { width: w, align: al || 'left' }); x += w; };
    hdr('#', wRank);
    hdr('Materia', wMateria);
    hdr('Área', wArea);
    hdr('Promedio', wProm, 'center');
    hdr('Hrs/sem', wHs, 'center');
    hdr('Hrs/año', wHa, 'center');
    hdr('Fallas materia', wFl, 'center');
    doc.moveDown(0.3);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#cccccc').stroke();
    doc.moveDown(0.3);

    doc.font('Helvetica').fontSize(9);
    datos.materias.forEach((m, i) => {
      y = doc.y;
      x = 50;
      const nombre = m.materia_nombre.length > 30 ? m.materia_nombre.slice(0, 29) + '…' : m.materia_nombre;
      doc.text(String(i + 1), x, y, { width: wRank }); x += wRank;
      doc.text(nombre, x, y, { width: wMateria }); x += wMateria;
      doc.text(m.area_nombre, x, y, { width: wArea }); x += wArea;
      doc.text(m.promedio !== null ? String(m.promedio) : '—', x, y, { width: wProm, align: 'center' }); x += wProm;
      doc.text(String(m.horas_semana), x, y, { width: wHs, align: 'center' }); x += wHs;
      doc.text(String(m.horas_anio), x, y, { width: wHa, align: 'center' }); x += wHa;
      doc.text(String(m.fallas), x, y, { width: wFl, align: 'center' });
      doc.moveDown(0.4);
    });

    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#cccccc').stroke();
    doc.moveDown(0.5);

    doc.font('Helvetica-Bold').fontSize(11);
    doc.text(`Promedio total del curso: ${datos.promedio_curso !== null ? datos.promedio_curso : '—'}`);
    doc.text(`Fallas históricas por materia: ${datos.fallas_totales}`);
    doc.text(
      `Asistencia diaria del curso: asistió ${datos.asistencia_curso.asistio}, tarde ${datos.asistencia_curso.tarde}, falta ${datos.asistencia_curso.falta}, justificada ${datos.asistencia_curso.justificada}`
    );
    doc.text(`Horas de clase totales al año: ${datos.horas_totales_anio}`);

    doc.moveDown(2);
    doc.fontSize(8).fillColor('gray')
      .text(`Generado el ${new Date().toLocaleString('es-CO')}`, { align: 'right' });

    doc.end();
  });
}

// ────────────────────────────────────────────────────────────
//  GET /api/informe-didactico/curso/:grupoId/imprimir?anio_lectivo=
//  Descarga directa del PDF (no se guarda en el historial).
// ────────────────────────────────────────────────────────────
exports.imprimirInformeDidactico = async (req, res) => {
  const { grupoId } = req.params;

  try {
    const grupo = await datosGrupo(grupoId);
    if (!(await puedeVerInforme(req, grupo))) {
      return res.status(403).json({ ok: false, mensaje: 'No tienes permiso para ver el informe didáctico de este curso.' });
    }

    const anio = await resolverAnio(grupo.institucion_id, req.query.anio_lectivo);
    if (!anio) {
      return res.status(409).json({ ok: false, mensaje: 'Tu institución todavía no tiene periodos académicos creados.' });
    }

    const datos = await armarDatos(grupo, anio);
    if (!datos) {
      return res.status(409).json({ ok: false, mensaje: `No hay periodos académicos creados para el año ${anio}.` });
    }

    const [matriculados] = await pool.query(
      `SELECT COUNT(*) AS total FROM matriculas WHERE grupo_id = ? AND estado = 'activa'`,
      [grupoId]
    );
    datos.total_estudiantes_matriculados = matriculados[0].total;

    const pdfBuffer = await generarPdf(datos);
    const nombre = `informe_didactico_${datos.grupo.grado_nombre}_${datos.grupo.grupo_nombre}_${anio}.pdf`.replace(/\s+/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
    return res.send(pdfBuffer);
  } catch (err) {
    console.error('imprimirInformeDidactico:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};