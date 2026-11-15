const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const pool = require('../config/db');
const { notificarReporte } = require('../services/reporte-update.service');

const ESTADOS_VALIDOS = ['asistio', 'falta', 'tarde', 'justificada'];

async function datosGrupo(grupoId) {
  const [rows] = await pool.query(
    `SELECT g.id, g.director_id, gr.institucion_id
     FROM grupos g JOIN grados gr ON gr.id = g.grado_id
     WHERE g.id = ?`,
    [grupoId]
  );
  return rows.length ? rows[0] : null;
}

async function puedeGestionarGrupo(usuario, grupo) {
  if (!grupo || usuario.rol !== 'docente') return false;
  if (grupo.director_id === usuario.id) return true;

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

async function estaMatriculado(estudianteId, grupoId) {
  const [rows] = await pool.query(
    `SELECT 1 FROM matriculas
     WHERE estudiante_id = ? AND grupo_id = ? AND estado = 'activa'
     LIMIT 1`,
    [estudianteId, grupoId]
  );
  return rows.length > 0;
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

    let estudianteId = null;
    if (req.usuario.rol === 'estudiante') {
      estudianteId = req.usuario.id;
      if (!(await estaMatriculado(estudianteId, grupoId))) {
        return res.status(403).json({ ok: false, mensaje: 'Solo puedes consultar la asistencia de tu curso actual.' });
      }
    } else if (!(await puedeGestionarGrupo(req.usuario, grupo))) {
      return res.status(403).json({ ok: false, mensaje: 'No tienes permiso para consultar la asistencia de este curso.' });
    }

    const desde = `${mes}-01`;
    const [estudiantes] = await pool.query(
      `SELECT DISTINCT u.id AS estudiante_id, u.nombres, u.apellidos
       FROM matriculas mt
       JOIN usuarios u ON u.id = mt.estudiante_id
       WHERE mt.grupo_id = ? AND mt.estado = 'activa'
         AND (? IS NULL OR mt.estudiante_id = ?)
       ORDER BY u.apellidos, u.nombres`,
      [grupoId, estudianteId, estudianteId]
    );
    const [registros] = await pool.query(
      `SELECT estudiante_id, DATE_FORMAT(fecha, '%Y-%m-%d') AS fecha,
              estado, motivo, archivo_url, archivo_nombre, updated_at
       FROM asistencia_dia
       WHERE grupo_id = ?
         AND fecha >= ? AND fecha < DATE_ADD(?, INTERVAL 1 MONTH)
         AND (? IS NULL OR estudiante_id = ?)`,
      [grupoId, desde, desde, estudianteId, estudianteId]
    );

    const registrosPorEstudiante = {};
    for (const registro of registros) {
      (registrosPorEstudiante[registro.estudiante_id] ||= {})[registro.fecha] = registro;
    }

    return res.json({
      ok: true,
      grupo_id: grupoId,
      mes,
      estudiantes: estudiantes.map(estudiante => ({
        ...estudiante,
        registros: registrosPorEstudiante[estudiante.estudiante_id] || {},
      })),
    });
  } catch (err) {
    console.error('listarMes asistencia-dia:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

exports.guardarCelda = async (req, res) => {
  const { grupo_id: grupoId, estudiante_id: estudianteId, fecha, estado, motivo } = req.body;
  if (typeof grupoId !== 'string' || !grupoId
    || typeof estudianteId !== 'string' || !estudianteId
    || !fechaValida(fecha) || !ESTADOS_VALIDOS.includes(estado)) {
    return res.status(400).json({ ok: false, mensaje: 'grupo_id, estudiante_id, fecha y estado válido son obligatorios.' });
  }
  if (motivo !== undefined && motivo !== null && typeof motivo !== 'string') {
    return res.status(400).json({ ok: false, mensaje: 'El motivo debe ser texto.' });
  }

  try {
    const grupo = await datosGrupo(grupoId);
    if (!grupo) return res.status(404).json({ ok: false, mensaje: 'Curso no encontrado.' });
    if (!(await puedeGestionarGrupo(req.usuario, grupo))) {
      return res.status(403).json({ ok: false, mensaje: 'No tienes permiso para editar la asistencia de este curso.' });
    }
    if (!(await estaMatriculado(estudianteId, grupoId))) {
      return res.status(404).json({ ok: false, mensaje: 'El estudiante no está matriculado activo en este curso.' });
    }

    const motivoFinal = estado === 'justificada' && typeof motivo === 'string'
      ? motivo.trim() || null
      : null;
    await pool.query(
      `INSERT INTO asistencia_dia
         (id, institucion_id, grupo_id, estudiante_id, fecha, estado, motivo, registrado_por)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         estado = VALUES(estado),
         motivo = VALUES(motivo),
         archivo_url = CASE WHEN VALUES(estado) = 'justificada' THEN archivo_url ELSE NULL END,
         archivo_nombre = CASE WHEN VALUES(estado) = 'justificada' THEN archivo_nombre ELSE NULL END,
         registrado_por = VALUES(registrado_por),
         updated_at = CURRENT_TIMESTAMP`,
      [randomUUID(), grupo.institucion_id, grupoId, estudianteId, fecha, estado, motivoFinal, req.usuario.id]
    );

    await notificarReporte(req.app.get('io'), estudianteId, { motivo: 'asistencia', grupo_id: grupoId, fecha });

    return res.json({
      ok: true,
      mensaje: 'Asistencia guardada.',
      registro: { grupo_id: grupoId, estudiante_id: estudianteId, fecha, estado, motivo: motivoFinal },
    });
  } catch (err) {
    console.error('guardarCelda asistencia-dia:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

exports.subirArchivo = async (req, res) => {
  const { grupo_id: grupoId, estudiante_id: estudianteId, fecha } = req.body;
  if (!req.file) {
    return res.status(400).json({ ok: false, mensaje: 'Debes adjuntar un archivo.' });
  }
  if (typeof grupoId !== 'string' || !grupoId
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
    if (!(await puedeGestionarGrupo(req.usuario, grupo))) {
      await eliminarArchivoTemporal(req.file);
      return res.status(403).json({ ok: false, mensaje: 'No tienes permiso para adjuntar soportes en este curso.' });
    }

    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [celdas] = await conn.query(
      `SELECT id, estado FROM asistencia_dia
       WHERE grupo_id = ? AND estudiante_id = ? AND fecha = ?
       FOR UPDATE`,
      [grupoId, estudianteId, fecha]
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
              ad.grupo_id, ad.estudiante_id
       FROM archivos ar
       JOIN asistencia_dia ad ON ad.archivo_url = ? AND ad.estado = 'justificada'
       WHERE ar.id = ?`,
      [archivoUrl, req.params.archivoId]
    );
    if (!archivos.length) {
      return res.status(404).json({ ok: false, mensaje: 'Archivo no encontrado.' });
    }

    const archivo = archivos[0];
    let autorizado = false;
    if (req.usuario.rol === 'estudiante') {
      autorizado = archivo.estudiante_id === req.usuario.id
        && await estaMatriculado(req.usuario.id, archivo.grupo_id);
    } else {
      const grupo = await datosGrupo(archivo.grupo_id);
      autorizado = await puedeGestionarGrupo(req.usuario, grupo);
    }
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
