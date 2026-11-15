const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const pool = require('../config/db');
const { notificarReporte } = require('../services/reporte-update.service');
const { obtenerTotalesAsistenciaDia } = require('../services/asistencia-dia.service');

const ESTADOS_VALIDOS = ['asistio', 'falta', 'tarde', 'justificada'];
const MAX_TAMANO_ARCHIVO = 5 * 1024 * 1024;
const TIPOS_ARCHIVO_ASISTENCIA = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

async function datosGrupo(grupoId) {
  const [rows] = await pool.query(
    `SELECT g.id, g.director_id, gr.institucion_id
     FROM grupos g JOIN grados gr ON gr.id = g.grado_id
     WHERE g.id = ?`,
    [grupoId]
  );
  return rows.length ? rows[0] : null;
}

async function docentePerteneceAlGrupo(usuario, grupo) {
  const [asignaciones] = await pool.query(
    `SELECT 1
     FROM docentes_materias dm
     JOIN materias m ON m.id = dm.materia_id
     WHERE dm.docente_id = ?
       AND (
         dm.grupo_id = ?
         OR (
           dm.grupo_id IS NULL
           AND (
             m.grupo_id = ?
             OR EXISTS (
               SELECT 1 FROM materias_curso mc
               WHERE mc.materia_id = dm.materia_id AND mc.grupo_id = ?
             )
           )
         )
       )
     LIMIT 1`,
    [usuario.id, grupo.id, grupo.id, grupo.id]
  );
  return asignaciones.length > 0;
}

async function puedeVerGrupo(usuario, grupo) {
  if (!grupo) return false;
  if (usuario.rol === 'superadmin') return true;
  if (['admin', 'coordinador'].includes(usuario.rol)) {
    return grupo.institucion_id === usuario.institucion_id;
  }
  if (usuario.rol === 'docente') {
    return grupo.director_id === usuario.id || docentePerteneceAlGrupo(usuario, grupo);
  }
  return false;
}

async function estaVinculadoComoAcudiente(acudienteId, estudianteId, grupoId) {
  const [rows] = await pool.query(
    `SELECT 1
     FROM acudientes_estudiantes ae
     JOIN matriculas mt ON mt.estudiante_id = ae.estudiante_id
       AND mt.grupo_id = ? AND mt.estado = 'activa'
     WHERE ae.acudiente_id = ? AND ae.estudiante_id = ?
     LIMIT 1`,
    [grupoId, acudienteId, estudianteId]
  );
  return rows.length > 0;
}

async function estaMatriculado(estudianteId, grupoId) {
  const [rows] = await pool.query(
    `SELECT 1 FROM matriculas
     WHERE estudiante_id = ? AND grupo_id = ? AND estado = 'activa'
     LIMIT 1`,
    [estudianteId, grupoId]
  );
  return rows.length > 0;
}

async function puedeVerAsistencia(usuario, grupo, estudianteId = null) {
  if (await puedeVerGrupo(usuario, grupo)) return true;
  if (usuario.rol === 'estudiante') {
    return (!estudianteId || estudianteId === usuario.id)
      && await estaMatriculado(usuario.id, grupo.id);
  }
  if (usuario.rol === 'acudiente') {
    if (estudianteId) {
      return estaVinculadoComoAcudiente(usuario.id, estudianteId, grupo.id);
    }
    const [rows] = await pool.query(
      `SELECT 1
       FROM acudientes_estudiantes ae
       JOIN matriculas mt ON mt.estudiante_id = ae.estudiante_id
         AND mt.grupo_id = ? AND mt.estado = 'activa'
       WHERE ae.acudiente_id = ?
       LIMIT 1`,
      [grupo.id, usuario.id]
    );
    return rows.length > 0;
  }
  return false;
}

async function idsEstudiantesVisibles(usuario, grupo) {
  if (usuario.rol === 'estudiante') {
    return await estaMatriculado(usuario.id, grupo.id) ? [usuario.id] : [];
  }
  if (usuario.rol === 'acudiente') {
    const [rows] = await pool.query(
      `SELECT DISTINCT mt.estudiante_id
       FROM acudientes_estudiantes ae
       JOIN matriculas mt ON mt.estudiante_id = ae.estudiante_id
         AND mt.grupo_id = ? AND mt.estado = 'activa'
       WHERE ae.acudiente_id = ?`,
      [grupo.id, usuario.id]
    );
    return rows.map(row => row.estudiante_id);
  }
  return null;
}

async function obtenerClase(claseId, grupoId, fecha) {
  const [rows] = await pool.query(
    `SELECT h.id AS clase_id, h.grupo_id, h.materia_id, h.docente_id,
            h.dia_semana, h.hora_inicio, h.hora_fin,
            m.nombre AS materia_nombre
     FROM horarios h
     JOIN materias m ON m.id = h.materia_id
     WHERE h.id = ? AND h.grupo_id = ?
       AND h.dia_semana = WEEKDAY(?) + 1`,
    [claseId, grupoId, fecha]
  );
  return rows.length ? rows[0] : null;
}

function puedeEditarClase(usuario, clase) {
  return usuario.rol === 'docente'
    && String(clase.docente_id || '') === String(usuario.id);
}

function fechaValida(fecha) {
  if (typeof fecha !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return false;
  const parsed = new Date(`${fecha}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === fecha;
}

async function eliminarArchivoTemporal(file) {
  if (!file?.path) return;
  try {
    await fs.promises.unlink(file.path);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('No se pudo limpiar el archivo temporal de asistencia:', err.message);
    }
  }
}

exports.listarMes = async (req, res) => {
  const { grupo_id: grupoId, mes } = req.query;
  if (typeof grupoId !== 'string' || !grupoId
    || typeof mes !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) {
    return res.status(400).json({ ok: false, mensaje: 'grupo_id y mes=YYYY-MM son obligatorios.' });
  }

  try {
    const grupo = await datosGrupo(grupoId);
    if (!grupo) return res.status(404).json({ ok: false, mensaje: 'Curso no encontrado.' });

    if (!(await puedeVerAsistencia(req.usuario, grupo))) {
      return res.status(403).json({ ok: false, mensaje: 'No tienes permiso para consultar la asistencia de este curso.' });
    }
    const estudianteIds = await idsEstudiantesVisibles(req.usuario, grupo);
    if (estudianteIds && estudianteIds.length === 0) {
      return res.status(403).json({ ok: false, mensaje: 'No tienes estudiantes activos en este curso.' });
    }

    const [anio, mesNumero] = mes.split('-').map(Number);
    const totalDias = new Date(Date.UTC(anio, mesNumero, 0)).getUTCDate();
    const dias = Array.from({ length: totalDias }, (_, indice) =>
      `${mes}-${String(indice + 1).padStart(2, '0')}`
    );
    const [bloques] = await pool.query(
      `SELECT h.id AS bloque_id, h.dia_semana, h.materia_id,
              TIME_FORMAT(h.hora_inicio, '%H:%i') AS hora_inicio,
              TIME_FORMAT(h.hora_fin, '%H:%i') AS hora_fin,
              m.nombre AS materia_nombre, h.docente_id
       FROM horarios h
       JOIN materias m ON m.id = h.materia_id
       WHERE h.grupo_id = ?
       ORDER BY h.dia_semana, h.hora_inicio, m.nombre`,
      [grupoId]
    );
    const clasesPorDia = Object.fromEntries(dias.map(fecha => [fecha, []]));
    for (const fecha of dias) {
      const diaJS = new Date(`${fecha}T00:00:00.000Z`).getUTCDay();
      const diaSemana = diaJS === 0 ? 7 : diaJS;
      clasesPorDia[fecha] = bloques
        .filter(bloque => Number(bloque.dia_semana) === diaSemana)
        .map(bloque => ({
          bloque_id: bloque.bloque_id,
          materia_id: bloque.materia_id,
          materia_nombre: bloque.materia_nombre,
          hora_inicio: bloque.hora_inicio,
          hora_fin: bloque.hora_fin,
          editable: puedeEditarClase(req.usuario, bloque),
        }));
    }

    let filtroEstudiantes = '';
    const paramsEstudiantes = [grupoId];
    if (estudianteIds) {
      filtroEstudiantes = ` AND mt.estudiante_id IN (${estudianteIds.map(() => '?').join(',')})`;
      paramsEstudiantes.push(...estudianteIds);
    }
    const [estudiantes] = await pool.query(
      `SELECT DISTINCT u.id, CONCAT_WS(' ', u.nombres, u.apellidos) AS nombre
       FROM matriculas mt
       JOIN usuarios u ON u.id = mt.estudiante_id
       WHERE mt.grupo_id = ? AND mt.estado = 'activa'${filtroEstudiantes}
       ORDER BY u.apellidos, u.nombres`,
      paramsEstudiantes
    );
    const idsCurso = estudiantes.map(estudiante => estudiante.id);
    const filasRegistros = idsCurso.length
      ? (await pool.query(
        `SELECT estudiante_id, DATE_FORMAT(fecha, '%Y-%m-%d') AS fecha,
                clase_id AS bloque_id, estado, motivo AS justificacion_texto,
                archivo_url AS justificacion_archivo
         FROM asistencia_dia
         WHERE grupo_id = ?
           AND fecha >= ? AND fecha < DATE_ADD(?, INTERVAL 1 MONTH)
           AND estudiante_id IN (${idsCurso.map(() => '?').join(',')})
         ORDER BY fecha, estudiante_id, clase_id`,
        [grupoId, dias[0], `${mes}-01`, ...idsCurso]
      ))[0]
      : [];
    const registros = filasRegistros.map(registro => ({
      estudiante_id: registro.estudiante_id,
      fecha: registro.fecha,
      bloque_id: registro.bloque_id,
      estado: registro.estado,
      justificacion_texto: registro.justificacion_texto,
      justificacion_archivo: registro.justificacion_archivo,
    }));

    return res.json({ dias, estudiantes, clases_por_dia: clasesPorDia, registros });
  } catch (err) {
    console.error('listarMes asistencia-dia:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

exports.listarTotales = async (req, res) => {
  const { grupo_id: grupoId, mes, anio } = req.query;
  const mesValido = typeof mes === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(mes);
  const anioValido = typeof anio === 'string' && /^\d{4}$/.test(anio);
  if (typeof grupoId !== 'string' || !grupoId || mesValido === anioValido) {
    return res.status(400).json({ ok: false, mensaje: 'Indica grupo_id y solo mes=YYYY-MM o anio=YYYY.' });
  }

  try {
    const grupo = await datosGrupo(grupoId);
    if (!grupo) return res.status(404).json({ ok: false, mensaje: 'Curso no encontrado.' });
    if (!(await puedeVerAsistencia(req.usuario, grupo))) {
      return res.status(403).json({ ok: false, mensaje: 'No tienes permiso para consultar la asistencia de este curso.' });
    }

    const estudianteIds = await idsEstudiantesVisibles(req.usuario, grupo);
    if (estudianteIds && estudianteIds.length === 0) {
      return res.status(403).json({ ok: false, mensaje: 'No tienes estudiantes activos en este curso.' });
    }
    let desde;
    let hasta;
    if (mesValido) {
      const [anioMes, mesNumero] = mes.split('-').map(Number);
      desde = `${mes}-01`;
      hasta = `${mes}-${String(new Date(Date.UTC(anioMes, mesNumero, 0)).getUTCDate()).padStart(2, '0')}`;
    } else {
      desde = `${anio}-01-01`;
      hasta = `${anio}-12-31`;
    }

    const filtroEstudiantes = estudianteIds
      ? ` AND mt.estudiante_id IN (${estudianteIds.map(() => '?').join(',')})`
      : '';
    const parametrosEstudiantes = [grupoId, ...(estudianteIds || [])];
    const [estudiantes] = await pool.query(
      `SELECT DISTINCT u.id AS estudiante_id
       FROM matriculas mt
       JOIN usuarios u ON u.id = mt.estudiante_id
       WHERE mt.grupo_id = ? AND mt.estado = 'activa'${filtroEstudiantes}`,
      parametrosEstudiantes
    );
    const totales = await obtenerTotalesAsistenciaDia(
      grupoId,
      desde,
      hasta,
      estudianteIds
    );
    const porEstudiante = new Map(totales.map(total => [total.estudiante_id, total]));
    return res.json(estudiantes.map(({ estudiante_id: estudianteId }) => ({
      estudiante_id: estudianteId,
      asistencias: porEstudiante.get(estudianteId)?.asistencias || 0,
      fallas: porEstudiante.get(estudianteId)?.fallas || 0,
      retrasos: porEstudiante.get(estudianteId)?.retrasos || 0,
      justificados: porEstudiante.get(estudianteId)?.justificados || 0,
    })));
  } catch (err) {
    console.error('listarTotales asistencia-dia:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

exports.guardarCelda = async (req, res) => {
  const {
    grupo_id: grupoId,
    bloque_id: bloqueId,
    estudiante_id: estudianteId,
    fecha,
    estado,
    justificacion,
  } = req.body;
  if (typeof grupoId !== 'string' || !grupoId
    || typeof bloqueId !== 'string' || !bloqueId
    || typeof estudianteId !== 'string' || !estudianteId
    || !fechaValida(fecha) || !ESTADOS_VALIDOS.includes(estado)) {
    return res.status(400).json({ ok: false, mensaje: 'grupo_id, fecha, bloque_id, estudiante_id y estado válido son obligatorios.' });
  }
  if (justificacion !== undefined && justificacion !== null
    && typeof justificacion !== 'string'
    && (typeof justificacion !== 'object' || typeof justificacion.texto !== 'string')) {
    return res.status(400).json({ ok: false, mensaje: 'La justificación debe ser texto o incluir un campo texto.' });
  }

  try {
    const grupo = await datosGrupo(grupoId);
    if (!grupo) return res.status(404).json({ ok: false, mensaje: 'Curso no encontrado.' });
    const clase = await obtenerClase(bloqueId, grupoId, fecha);
    if (!clase) {
      return res.status(403).json({ ok: false, mensaje: 'El bloque no pertenece a una materia asignada al docente logueado.' });
    }
    if (!(await puedeEditarClase(req.usuario, clase))) {
      return res.status(403).json({ ok: false, mensaje: 'El bloque no pertenece a una materia asignada al docente logueado.' });
    }
    if (!(await estaMatriculado(estudianteId, grupoId))) {
      return res.status(404).json({ ok: false, mensaje: 'El estudiante no está matriculado activo en este curso.' });
    }

    const textoJustificacion = typeof justificacion === 'string'
      ? justificacion
      : justificacion?.texto;
    const motivoFinal = estado === 'justificada' && typeof textoJustificacion === 'string'
      ? textoJustificacion.trim() || null
      : null;
    await pool.query(
      `INSERT INTO asistencia_dia
         (id, institucion_id, grupo_id, estudiante_id, fecha, clase_id, estado, motivo, registrado_por)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         estado = VALUES(estado),
         motivo = VALUES(motivo),
         archivo_url = CASE WHEN VALUES(estado) = 'justificada' THEN archivo_url ELSE NULL END,
         archivo_nombre = CASE WHEN VALUES(estado) = 'justificada' THEN archivo_nombre ELSE NULL END,
         registrado_por = VALUES(registrado_por),
         updated_at = CURRENT_TIMESTAMP`,
      [randomUUID(), grupo.institucion_id, grupoId, estudianteId, fecha, bloqueId, estado, motivoFinal, req.usuario.id]
    );

    await notificarReporte(req.app.get('io'), estudianteId, { motivo: 'asistencia', grupo_id: grupoId, fecha });

    return res.json({
      ok: true,
      mensaje: 'Asistencia guardada.',
      registro: {
        grupo_id: grupoId,
        bloque_id: bloqueId,
        estudiante_id: estudianteId,
        fecha,
        estado,
        justificacion_texto: motivoFinal,
      },
    });
  } catch (err) {
    console.error('guardarCelda asistencia-dia:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

exports.subirArchivo = async (req, res) => {
  const {
    grupo_id: grupoId,
    bloque_id: bloqueIdBody,
    clase_id: claseIdLegacy,
    estudiante_id: estudianteId,
    fecha,
  } = req.body;
  const bloqueId = bloqueIdBody || claseIdLegacy;
  if (!req.file) {
    return res.status(400).json({ ok: false, mensaje: 'Debes adjuntar un archivo.' });
  }
  if (req.file.size > MAX_TAMANO_ARCHIVO || !TIPOS_ARCHIVO_ASISTENCIA.has(req.file.mimetype)) {
    await eliminarArchivoTemporal(req.file);
    return res.status(400).json({ ok: false, mensaje: 'El soporte debe ser PDF, JPG, PNG, WebP, DOC o DOCX y no superar 5 MB.' });
  }
  if (typeof grupoId !== 'string' || !grupoId
    || typeof bloqueId !== 'string' || !bloqueId
    || typeof estudianteId !== 'string' || !estudianteId
    || !fechaValida(fecha)) {
    await eliminarArchivoTemporal(req.file);
    return res.status(400).json({ ok: false, mensaje: 'La celda de asistencia es inválida.' });
  }

  let conn;
  try {
    const grupo = await datosGrupo(grupoId);
    if (!grupo) {
      await eliminarArchivoTemporal(req.file);
      return res.status(404).json({ ok: false, mensaje: 'Curso no encontrado.' });
    }
    const clase = await obtenerClase(bloqueId, grupoId, fecha);
    if (!clase) {
      await eliminarArchivoTemporal(req.file);
      return res.status(404).json({ ok: false, mensaje: 'La clase no pertenece a ese curso o no corresponde a la fecha.' });
    }
    if (!(await puedeEditarClase(req.usuario, clase))) {
      await eliminarArchivoTemporal(req.file);
      return res.status(403).json({ ok: false, mensaje: 'Solo el docente asignado a esta clase puede adjuntar soportes.' });
    }

    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [celdas] = await conn.query(
      `SELECT id, estado FROM asistencia_dia
       WHERE grupo_id = ? AND estudiante_id = ? AND fecha = ? AND clase_id = ?
       FOR UPDATE`,
      [grupoId, estudianteId, fecha, bloqueId]
    );
    if (!celdas.length || celdas[0].estado !== 'justificada') {
      await conn.rollback();
      await eliminarArchivoTemporal(req.file);
      return res.status(409).json({ ok: false, mensaje: 'Primero marca la celda como justificada.' });
    }
    if (!(await estaMatriculado(estudianteId, grupoId))) {
      await conn.rollback();
      await eliminarArchivoTemporal(req.file);
      return res.status(404).json({ ok: false, mensaje: 'El estudiante no está matriculado activo en este curso.' });
    }

    const archivoId = randomUUID();
    const rutaStorage = path.relative(
      path.join(__dirname, '../..'),
      path.join(__dirname, '../../storage_privado/asistencia-dia', path.basename(req.file.filename))
    );
    const archivoUrl = `/api/asistencia-dia/archivo/${archivoId}`;
    await conn.query(
      `INSERT INTO archivos
         (id, subido_por, tipo, nombre_original, nombre_storage, ruta_storage,
          mime_type, tamanio_bytes, es_publico, ref_grupo_id, descripcion)
       VALUES (?, ?, 'otro', ?, ?, ?, ?, ?, FALSE, ?, ?)`,
      [
        archivoId,
        req.usuario.id,
        req.file.originalname,
        req.file.filename,
        rutaStorage,
        req.file.mimetype,
        req.file.size,
        grupoId,
        `Soporte de asistencia justificada (${fecha})`,
      ]
    );
    await conn.query(
      `UPDATE asistencia_dia
       SET archivo_url = ?, archivo_nombre = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [archivoUrl, req.file.originalname, celdas[0].id]
    );
    await conn.commit();

    await notificarReporte(req.app.get('io'), estudianteId, { motivo: 'asistencia', grupo_id: grupoId, fecha });

    return res.status(201).json({
      ok: true,
      mensaje: 'Soporte adjuntado.',
      archivo_url: archivoUrl,
      archivo_nombre: req.file.originalname,
    });
  } catch (err) {
    if (conn) await conn.rollback();
    await eliminarArchivoTemporal(req.file);
    console.error('subirArchivo asistencia-dia:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'No se pudo guardar el soporte.' });
  } finally {
    if (conn) conn.release();
  }
};

exports.abrirArchivo = async (req, res) => {
  try {
    const archivoUrl = `/api/asistencia-dia/archivo/${req.params.archivoId}`;
    const [archivos] = await pool.query(
      `SELECT ar.id, ar.nombre_original, ar.ruta_storage,
              ad.grupo_id, ad.estudiante_id, ad.clase_id
       FROM archivos ar
       JOIN asistencia_dia ad ON ad.archivo_url = ? AND ad.estado = 'justificada'
       WHERE ar.id = ?`,
      [archivoUrl, req.params.archivoId]
    );
    if (!archivos.length) {
      return res.status(404).json({ ok: false, mensaje: 'Archivo no encontrado.' });
    }

    const archivo = archivos[0];
    const grupo = await datosGrupo(archivo.grupo_id);
    const autorizado = await puedeVerAsistencia(
      req.usuario,
      grupo,
      archivo.estudiante_id
    );
    if (!autorizado) {
      return res.status(403).json({ ok: false, mensaje: 'No tienes permiso para abrir este soporte.' });
    }

    const raiz = path.resolve(__dirname, '../../storage_privado/asistencia-dia');
    const ruta = path.resolve(__dirname, '../..', archivo.ruta_storage);
    if (!ruta.startsWith(`${raiz}${path.sep}`)) {
      console.error('Ruta privada de soporte de asistencia fuera de su carpeta.');
      return res.status(500).json({ ok: false, mensaje: 'No se pudo abrir el soporte.' });
    }
    return res.download(ruta, archivo.nombre_original, err => {
      if (err) {
        console.error('abrirArchivo asistencia-dia:', err.message);
        if (!res.headersSent) {
          res.status(err.code === 'ENOENT' ? 404 : 500).json({
            ok: false,
            mensaje: err.code === 'ENOENT' ? 'Archivo no encontrado.' : 'No se pudo abrir el soporte.',
          });
        }
      }
    });
  } catch (err) {
    console.error('abrirArchivo asistencia-dia:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};
