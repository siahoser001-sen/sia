// ============================================================
//  tareas-entrega-archivos.controller.js — Archivos de las
//  entregas de tareas (tabla puente `entregas_archivos`).
//
//  Reglas:
//  - Solo el estudiante dueño de la entrega sube/quita archivos.
//  - Máximo 5 archivos por entrega (cada uno hasta UPLOAD_MAX_MB).
//  - Una entrega calificada ya no se modifica.
//  - Descarga: el estudiante dueño o el docente asignado a la
//    materia en el curso de la tarea (admin/superadmin también).
// ============================================================

const path   = require('path');
const fs     = require('fs');
const { randomUUID } = require('crypto');
const pool   = require('../config/db');
const {
  MAX_ARCHIVOS_ENTREGA,
  obtenerTarea,
  obtenerPeriodo,
  periodoAbierto,
  hoyISO,
  soloFecha,
  estudianteMatriculado,
  puedeVerEntregas,
  archivosDeEntrega,
  contarArchivosEntrega,
} = require('../utils/tareas-entrega.util');

const RAIZ_ENTREGAS = path.resolve(__dirname, '../../storage_privado/entregas-tareas');

async function limpiarArchivosTemporales(files = []) {
  for (const file of files) {
    if (!file?.path) continue;
    try {
      await fs.promises.unlink(file.path);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.error('No se pudo limpiar el archivo temporal de entrega:', err.message);
      }
    }
  }
}

function rutaRelativaProyecto(rutaAbsoluta) {
  return path.relative(path.join(__dirname, '../..'), rutaAbsoluta);
}

// ────────────────────────────────────────────────────────────
//  POST /api/tareas/:id/entrega/archivos
//  multipart/form-data, campo `archivos` (hasta 5). Registra la
//  entrega si aún no existe (estado entregada/tarde, igual que
//  POST /:id/entrega) y asocia cada archivo a la entrega.
// ────────────────────────────────────────────────────────────
exports.subir = async (req, res) => {
  const { id } = req.params;
  const archivos = req.files || [];

  if (!archivos.length) {
    return res.status(400).json({ ok: false, mensaje: 'Selecciona al menos un archivo.' });
  }

  let conn;
  try {
    const tarea = await obtenerTarea(id);
    if (!tarea) {
      await limpiarArchivosTemporales(archivos);
      return res.status(404).json({ ok: false, mensaje: 'Tarea no encontrada.' });
    }
    if (!(await estudianteMatriculado(req.usuario.id, tarea.grupo_id))) {
      await limpiarArchivosTemporales(archivos);
      return res.status(403).json({ ok: false, mensaje: 'No estás matriculado activo en el curso de esta tarea.' });
    }

    // Mismas reglas de periodo que POST /:id/entrega.
    const periodo = await obtenerPeriodo(tarea.periodo_id);
    const hoy = hoyISO();
    const abierto = periodoAbierto(periodo, hoy);
    if (tarea.estado !== 'publicada' && !abierto) {
      await limpiarArchivosTemporales(archivos);
      return res.status(409).json({ ok: false, mensaje: 'Esta tarea todavía no está publicada.' });
    }
    const fechaLimite = soloFecha(tarea.fecha_entrega);
    const tardia = hoy > fechaLimite;
    if (!tarea.recibir_entregas) {
      await limpiarArchivosTemporales(archivos);
      return res.status(409).json({ ok: false, mensaje: 'El docente cerró la recepción de entregas para esta actividad.' });
    }
    if (tardia && !tarea.permitir_tardias) {
      await limpiarArchivosTemporales(archivos);
      return res.status(409).json({ ok: false, mensaje: 'La fecha límite ya pasó y esta actividad no admite entregas tardías.' });
    }
    const finPeriodo = periodo ? soloFecha(periodo.fecha_fin) : null;
    if (finPeriodo && hoy > finPeriodo && !tardia) {
      await limpiarArchivosTemporales(archivos);
      return res.status(409).json({ ok: false, mensaje: 'El periodo de esta tarea ya cerró; no se pueden registrar entregas.' });
    }

    const ahora = new Date();
    const estado = tardia ? 'tarde' : 'entregada';

    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [entregas] = await conn.query(
      `SELECT id, estado, entrega_tarde FROM entregas_tareas
       WHERE tarea_id = ? AND estudiante_id = ?
       FOR UPDATE`,
      [id, req.usuario.id]
    );

    let entregaId;
    if (entregas.length) {
      if (entregas[0].estado === 'calificada') {
        await conn.rollback();
        await limpiarArchivosTemporales(archivos);
        return res.status(409).json({ ok: false, mensaje: 'La entrega ya está calificada; no se puede modificar.' });
      }
      entregaId = entregas[0].id;
      await conn.query(
        `UPDATE entregas_tareas
         SET estado = ?, entrega_tarde = ?, fecha_entrega = ?
         WHERE id = ?`,
        [estado, tardia, ahora, entregaId]
      );
    } else {
      entregaId = randomUUID();
      await conn.query(
        `INSERT INTO entregas_tareas (id, tarea_id, estudiante_id, estado, entrega_tarde, fecha_entrega)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [entregaId, id, req.usuario.id, estado, tardia, ahora]
      );
    }

    const existentes = await contarArchivosEntrega(entregaId, conn);
    if (existentes + archivos.length > MAX_ARCHIVOS_ENTREGA) {
      await conn.rollback();
      await limpiarArchivosTemporales(archivos);
      return res.status(409).json({
        ok: false,
        mensaje: `Cada entrega admite máximo ${MAX_ARCHIVOS_ENTREGA} archivos. Ya tienes ${existentes}.`,
      });
    }

    for (const file of archivos) {
      const archivoId = randomUUID();
      await conn.query(
        `INSERT INTO archivos
           (id, subido_por, tipo, nombre_original, nombre_storage, ruta_storage,
            mime_type, tamanio_bytes, es_publico, ref_grupo_id, descripcion)
         VALUES (?, ?, 'tarea_entregada', ?, ?, ?, ?, ?, FALSE, ?, ?)`,
        [
          archivoId,
          req.usuario.id,
          file.originalname,
          file.filename,
          rutaRelativaProyecto(file.path),
          file.mimetype,
          file.size,
          tarea.grupo_id,
          `Entrega de la tarea "${tarea.titulo}"`,
        ]
      );
      await conn.query(
        `INSERT INTO entregas_archivos (id, entrega_id, archivo_id) VALUES (?, ?, ?)`,
        [randomUUID(), entregaId, archivoId]
      );
    }

    await conn.commit();

    const io = req.app.get('io');
    if (io) io.to(`usuario:${req.usuario.id}`).emit('tareas:update', { tarea_id: id });

    const lista = await archivosDeEntrega(entregaId);
    return res.status(201).json({
      ok: true,
      mensaje: archivos.length === 1 ? 'Archivo subido.' : 'Archivos subidos.',
      estado,
      entrega_id: entregaId,
      archivos: lista,
    });
  } catch (err) {
    if (conn) await conn.rollback();
    await limpiarArchivosTemporales(archivos);
    console.error('subir archivos entrega:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'No se pudieron guardar los archivos de la entrega.' });
  } finally {
    if (conn) conn.release();
  }
};

// ────────────────────────────────────────────────────────────
//  DELETE /api/tareas/:id/entrega/archivos/:archivoId
//  Quita un archivo de la entrega propia mientras no esté
//  calificada. Borra el registro de `archivos` y el binario.
// ────────────────────────────────────────────────────────────
exports.eliminar = async (req, res) => {
  const { id, archivoId } = req.params;
  let conn;
  try {
    const [rows] = await pool.query(
      `SELECT ea.id AS puente_id, ar.ruta_storage,
              e.id AS entrega_id, e.estado, e.estudiante_id
       FROM entregas_archivos ea
       JOIN archivos ar ON ar.id = ea.archivo_id
       JOIN entregas_tareas e ON e.id = ea.entrega_id
       WHERE e.tarea_id = ? AND ea.archivo_id = ?`,
      [id, archivoId]
    );
    if (!rows.length) {
      return res.status(404).json({ ok: false, mensaje: 'Archivo no encontrado en esta entrega.' });
    }
    const archivo = rows[0];
    if (archivo.estudiante_id !== req.usuario.id) {
      return res.status(403).json({ ok: false, mensaje: 'No puedes quitar archivos de otra entrega.' });
    }
    if (archivo.estado === 'calificada') {
      return res.status(409).json({ ok: false, mensaje: 'La entrega ya está calificada; no se puede modificar.' });
    }

    conn = await pool.getConnection();
    await conn.beginTransaction();
    await conn.query(`DELETE FROM entregas_archivos WHERE id = ?`, [archivo.puente_id]);
    await conn.query(`DELETE FROM archivos WHERE id = ?`, [archivoId]);
    await conn.commit();

    const ruta = archivo.ruta_storage
      ? path.resolve(__dirname, '../..', archivo.ruta_storage)
      : null;
    if (ruta && ruta.startsWith(`${RAIZ_ENTREGAS}${path.sep}`)) {
      try {
        await fs.promises.unlink(ruta);
      } catch (err) {
        if (err.code !== 'ENOENT') {
          console.error('No se pudo borrar el binario de la entrega:', err.message);
        }
      }
    }

    const io = req.app.get('io');
    if (io) io.to(`usuario:${req.usuario.id}`).emit('tareas:update', { tarea_id: id });

    return res.json({ ok: true, mensaje: 'Archivo quitado de la entrega.' });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error('eliminar archivo entrega:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'No se pudo quitar el archivo.' });
  } finally {
    if (conn) conn.release();
  }
};

// ────────────────────────────────────────────────────────────
//  GET /api/tareas/:id/entrega/archivos/:archivoId
//  Descarga autenticada: estudiante dueño o docente de la
//  materia en ese curso (admin/superadmin de la institución).
// ────────────────────────────────────────────────────────────
exports.descargar = async (req, res) => {
  const { id, archivoId } = req.params;
  try {
    const [rows] = await pool.query(
      `SELECT ar.id, ar.nombre_original, ar.ruta_storage,
              e.estudiante_id, t.id AS tarea_id, t.materia_id, t.grupo_id
       FROM entregas_archivos ea
       JOIN archivos ar ON ar.id = ea.archivo_id
       JOIN entregas_tareas e ON e.id = ea.entrega_id
       JOIN tareas t ON t.id = e.tarea_id
       WHERE t.id = ? AND ea.archivo_id = ?`,
      [id, archivoId]
    );
    if (!rows.length) {
      return res.status(404).json({ ok: false, mensaje: 'Archivo no encontrado.' });
    }
    const archivo = rows[0];

    let autorizado = false;
    if (req.usuario.rol === 'estudiante') {
      autorizado = archivo.estudiante_id === req.usuario.id;
    } else {
      autorizado = await puedeVerEntregas(req.usuario, {
        materia_id: archivo.materia_id,
        grupo_id: archivo.grupo_id,
      });
    }
    if (!autorizado) {
      return res.status(403).json({ ok: false, mensaje: 'No tienes permiso para descargar este archivo.' });
    }

    const ruta = path.resolve(__dirname, '../..', archivo.ruta_storage);
    if (!ruta.startsWith(`${RAIZ_ENTREGAS}${path.sep}`)) {
      console.error('Ruta de archivo de entrega fuera de su carpeta.');
      return res.status(500).json({ ok: false, mensaje: 'No se pudo abrir el archivo.' });
    }

    return res.download(ruta, archivo.nombre_original, err => {
      if (err) {
        console.error('descargar archivo entrega:', err.message);
        if (!res.headersSent) {
          res.status(err.code === 'ENOENT' ? 404 : 500).json({
            ok: false,
            mensaje: err.code === 'ENOENT' ? 'Archivo no encontrado.' : 'No se pudo abrir el archivo.',
          });
        }
      }
    });
  } catch (err) {
    console.error('descargar archivo entrega:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};
