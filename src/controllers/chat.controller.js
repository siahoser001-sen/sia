// ============================================================
//  chat.controller.js — Centro de mensajería (estilo Messenger)
//  Tablas: chats, chat_mensajes, chat_config (migración 22) y
//  chat_mensajes_ocultos (migración 42).
//
//  Reglas de negocio (matriz de contactos):
//   - superadmin ↔ institución: un canal por institución
//     (tipo 'institucion'). Solo la superadministración abre esos
//     canales; ningún docente/estudiante/acudiente lo contacta.
//   - admin ↔ usuarios de su institución (docente/estudiante/
//     acudiente) y admin ↔ admin de otra institución: chats 1:1
//     (tipo 'personal', par canónico para no duplicar).
//   - docente ↔ estudiantes de sus clases (docentes_materias) o
//     los grupos que dirige (grupos.director_id). Puede iniciar
//     chat con el admin solo si la institución activó
//     `permitir_mensajes_abiertos`.
//   - estudiante ↔ únicamente los docentes que le dictan clase o
//     su director de curso. No se habla con compañeros ni admin.
//   - acudiente ↔ únicamente los docentes que le dictan a su
//     acudido (acudientes_estudiantes + matrícula activa).
//   - Cualquier participante puede bloquear un chat; solo el que
//     bloqueó puede desbloquearlo. En un chat bloqueado nadie envía.
//   - Tiempo real: socket.io a la sala `usuario:{id}` de cada
//     participante, evento `chat:update { chat_id }`.
// ============================================================

const pool = require('../config/db');
const { randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');
const asyncHandler = require('../utils/asyncHandler');
const {
  condicionMateriaEnGrupo,
  condicionDocenteEnGrupo,
} = require('../utils/materias-curso.util');

const RAIZ_PROYECTO = path.resolve(__dirname, '../..');
const CARPETA_CHAT = path.join(RAIZ_PROYECTO, 'storage_privado', 'chat');
const EXTENSIONES_AUDIO = new Set(['.webm', '.ogg', '.mp4', '.mp3', '.wav']);

// ── Helpers ─────────────────────────────────────────────────
function parCanonico(a, b) {
  return a < b ? [a, b] : [b, a];
}

async function eliminarTemporal(file) {
  if (!file || !file.path) return;
  try {
    await fs.promises.unlink(file.path);
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('No se pudo limpiar adjunto temporal:', err.message);
  }
}

function rutaRelativaProyecto(ruta) {
  return path.relative(RAIZ_PROYECTO, ruta).split(path.sep).join('/');
}

function tipoChatArchivo(file) {
  return EXTENSIONES_AUDIO.has(path.extname(file.originalname).toLowerCase()) ? 'audio' : 'archivo';
}

function normalizarBusqueda(texto) {
  return String(texto || '')
    .toLocaleLowerCase('es-CO')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

async function resultadoChatPropio(me, consulta) {
  const q = normalizarBusqueda(consulta);
  const alias = ['tu', 'notas personales'].some(a => a.includes(q) || q.includes(a));
  if (!alias) {
    const [rows] = await pool.query(
      `SELECT nombres, apellidos, numero_documento, email
       FROM usuarios WHERE id = ? LIMIT 1`,
      [me.id]
    );
    if (!rows.length) return null;
    const valores = [
      rows[0].nombres,
      rows[0].apellidos,
      `${rows[0].nombres} ${rows[0].apellidos}`,
      rows[0].numero_documento,
      rows[0].email,
    ];
    if (!valores.some(v => normalizarBusqueda(v).includes(q))) return null;
  }
  return {
    id: me.id,
    nombre: 'Tú (notas personales)',
    sub: 'Notas personales',
    tipo: 'personal',
  };
}

function incluirChatPropio(resultados, propio) {
  return propio ? [propio, ...resultados] : resultados;
}

async function superadminId() {
  const [rows] = await pool.query(
    `SELECT id FROM usuarios WHERE rol = 'superadmin' AND activo = TRUE ORDER BY created_at ASC LIMIT 1`
  );
  return rows.length ? rows[0].id : null;
}

async function adminDeInstitucion(institucionId) {
  const [rows] = await pool.query(
    `SELECT id FROM usuarios WHERE rol = 'admin' AND institucion_id = ? AND activo = TRUE ORDER BY created_at ASC LIMIT 1`,
    [institucionId]
  );
  return rows.length ? rows[0].id : null;
}

function esParticipante(chat, usuario) {
  if (chat.tipo === 'personal') return chat.ente_a === usuario.id || chat.ente_b === usuario.id;
  if (chat.tipo === 'institucion') {
    if (usuario.rol === 'superadmin') return chat.ente_a === usuario.id;
    return usuario.rol === 'admin' && chat.institucion_id === usuario.institucion_id;
  }
  return false;
}

async function idsParticipantes(chat) {
  if (chat.tipo === 'personal') {
    return [...new Set([chat.ente_a, chat.ente_b].filter(Boolean))];
  }
  if (chat.tipo === 'institucion') {
    const supId = await superadminId();
    const adminId = await adminDeInstitucion(chat.institucion_id);
    return [...new Set([supId, adminId].filter(Boolean))];
  }
  return [];
}

async function participantesChat(chat, excluirId = null) {
  return (await idsParticipantes(chat)).filter(id => id !== excluirId);
}

function esChatDeGrupo(chat) {
  return ['curso', 'materia'].includes(chat.tipo)
    || (!chat.ente_a && !chat.ente_b && Boolean(chat.grupo_id));
}

async function contextoGrupoChat(chat) {
  if (chat.grupo_id) {
    return {
      grupoId: chat.grupo_id,
      docenteMateriaId: chat.docente_materia_id || null,
      materiaId: chat.materia_id || null,
    };
  }
  if (chat.docente_materia_id) {
    const [rows] = await pool.query(
      `SELECT grupo_id, materia_id FROM docentes_materias WHERE id = ? LIMIT 1`,
      [chat.docente_materia_id]
    );
    if (rows.length) {
      return {
        grupoId: rows[0].grupo_id,
        docenteMateriaId: chat.docente_materia_id,
        materiaId: rows[0].materia_id || null,
      };
    }
  }
  if (chat.materia_id) {
    const [rows] = await pool.query(
      `SELECT grupo_id, id FROM docentes_materias WHERE materia_id = ? LIMIT 1`,
      [chat.materia_id]
    );
    if (rows.length) {
      return {
        grupoId: rows[0].grupo_id,
        docenteMateriaId: rows[0].id,
        materiaId: chat.materia_id,
      };
    }
  }
  return null;
}

async function usuarioEnGrupo(contexto, usuario) {
  const params = [];
  let filtroMateria = '';
  if (contexto.docenteMateriaId) {
    filtroMateria = 'AND dm.id = ?';
    params.push(contexto.docenteMateriaId);
  } else if (contexto.materiaId) {
    filtroMateria = 'AND dm.materia_id = ?';
    params.push(contexto.materiaId);
  }
  params.push(
    contexto.grupoId,
    usuario.id,
    usuario.id,
    usuario.id,
    usuario.id,
    usuario.rol,
    usuario.rol,
    usuario.institucion_id
  );
  const [rows] = await pool.query(
    `SELECT 1
       FROM grupos g
       JOIN grados gr ON gr.id = g.grado_id
       LEFT JOIN matriculas mt
         ON mt.grupo_id = g.id AND mt.estado = 'activa'
       LEFT JOIN acudientes_estudiantes ae
         ON ae.estudiante_id = mt.estudiante_id
       LEFT JOIN docentes_materias dm
         ON dm.grupo_id = g.id ${filtroMateria}
      WHERE g.id = ?
        AND (
          g.director_id = ?
          OR dm.docente_id = ?
          OR mt.estudiante_id = ?
          OR ae.acudiente_id = ?
          OR ? = 'superadmin'
          OR (? = 'admin' AND gr.institucion_id = ?)
        )
      LIMIT 1`,
    params
  );
  return rows.length > 0;
}

async function esParticipanteChat(chat, usuario) {
  if (esParticipante(chat, usuario)) return true;
  if (!esChatDeGrupo(chat)) return false;
  const contexto = await contextoGrupoChat(chat);
  if (!contexto) return false;
  return usuarioEnGrupo(contexto, usuario);
}

async function salasEventoChat(chat) {
  if (chat.tipo === 'personal' || chat.tipo === 'institucion') {
    return (await idsParticipantes(chat)).map(id => `usuario:${id}`);
  }
  if (esChatDeGrupo(chat)) {
    const contexto = await contextoGrupoChat(chat);
    return contexto ? [`curso:${contexto.grupoId}`] : [];
  }
  return [];
}

async function configAbierto(institucionId) {
  if (!institucionId) return false;
  const [rows] = await pool.query(
    `SELECT permitir_mensajes_abiertos FROM chat_config WHERE institucion_id = ? LIMIT 1`,
    [institucionId]
  );
  return rows.length ? !!rows[0].permitir_mensajes_abiertos : false;
}

// ── Matriz de contactos (quiénes aparecen en la búsqueda) ────
// Estudiante: docentes que le dictan clase o su director de curso.
async function docentesDeEstudiante(estudianteId, like) {
  const [rows] = await pool.query(
    `SELECT DISTINCT u.id, u.nombres, u.apellidos, u.numero_documento,
            MAX(CASE WHEN g.director_id = u.id THEN 1 ELSE 0 END) AS es_director
     FROM matriculas mt
     JOIN grupos g ON g.id = mt.grupo_id
     JOIN materias m ON m.activa = TRUE AND ${condicionMateriaEnGrupo('m', 'g.id')}
     JOIN docentes_materias dm ON dm.materia_id = m.id
       AND ${condicionDocenteEnGrupo('dm', 'm', 'g.id')}
     JOIN usuarios u ON u.id = dm.docente_id AND u.rol = 'docente' AND u.activo = TRUE
     WHERE mt.estudiante_id = ? AND mt.estado = 'activa'
       AND (u.nombres LIKE ? OR u.apellidos LIKE ? OR CONCAT(u.nombres, ' ', u.apellidos) LIKE ? OR u.numero_documento LIKE ?)
     GROUP BY u.id, u.nombres, u.apellidos, u.numero_documento
     UNION
     SELECT DISTINCT u.id, u.nombres, u.apellidos, u.numero_documento, 1 AS es_director
     FROM matriculas mt
     JOIN grupos g ON g.id = mt.grupo_id
     JOIN usuarios u ON u.id = g.director_id AND u.rol = 'docente' AND u.activo = TRUE
     WHERE mt.estudiante_id = ? AND mt.estado = 'activa'
       AND (u.nombres LIKE ? OR u.apellidos LIKE ? OR CONCAT(u.nombres, ' ', u.apellidos) LIKE ? OR u.numero_documento LIKE ?)
     ORDER BY nombres LIMIT 20`,
    [estudianteId, like, like, like, like, estudianteId, like, like, like, like]
  );
  return rows;
}

// Acudiente: docentes que le dictan clase a su(s) acudido(s).
async function docentesDeAcudido(acudienteId, like) {
  const [rows] = await pool.query(
    `SELECT DISTINCT u.id, u.nombres, u.apellidos, u.numero_documento,
            MAX(CASE WHEN g.director_id = u.id THEN 1 ELSE 0 END) AS es_director
     FROM acudientes_estudiantes ae
     JOIN matriculas mt ON mt.estudiante_id = ae.estudiante_id AND mt.estado = 'activa'
     JOIN grupos g ON g.id = mt.grupo_id
     JOIN materias m ON m.activa = TRUE AND ${condicionMateriaEnGrupo('m', 'g.id')}
     JOIN docentes_materias dm ON dm.materia_id = m.id
       AND ${condicionDocenteEnGrupo('dm', 'm', 'g.id')}
     JOIN usuarios u ON u.id = dm.docente_id AND u.rol = 'docente' AND u.activo = TRUE
     WHERE ae.acudiente_id = ?
       AND (u.nombres LIKE ? OR u.apellidos LIKE ? OR CONCAT(u.nombres, ' ', u.apellidos) LIKE ? OR u.numero_documento LIKE ?)
     GROUP BY u.id, u.nombres, u.apellidos, u.numero_documento
     UNION
     SELECT DISTINCT u.id, u.nombres, u.apellidos, u.numero_documento, 1 AS es_director
     FROM acudientes_estudiantes ae
     JOIN matriculas mt ON mt.estudiante_id = ae.estudiante_id AND mt.estado = 'activa'
     JOIN grupos g ON g.id = mt.grupo_id
     JOIN usuarios u ON u.id = g.director_id AND u.rol = 'docente' AND u.activo = TRUE
     WHERE ae.acudiente_id = ?
       AND (u.nombres LIKE ? OR u.apellidos LIKE ? OR CONCAT(u.nombres, ' ', u.apellidos) LIKE ? OR u.numero_documento LIKE ?)
     ORDER BY nombres LIMIT 20`,
    [acudienteId, like, like, like, like, acudienteId, like, like, like, like]
  );
  return rows;
}

// Docente: estudiantes de las materias que dicta o de los grupos que dirige.
async function estudiantesDeDocente(docenteId, like) {
  const [rows] = await pool.query(
    `SELECT DISTINCT u.id, u.nombres, u.apellidos, u.numero_documento
     FROM docentes_materias dm
     JOIN matriculas mt ON mt.grupo_id = dm.grupo_id AND mt.estado = 'activa'
     JOIN usuarios u ON u.id = mt.estudiante_id AND u.rol = 'estudiante' AND u.activo = TRUE
     WHERE dm.docente_id = ?
       AND (u.nombres LIKE ? OR u.apellidos LIKE ? OR CONCAT(u.nombres, ' ', u.apellidos) LIKE ? OR u.numero_documento LIKE ?)
     UNION
     SELECT DISTINCT u.id, u.nombres, u.apellidos, u.numero_documento
     FROM grupos g
     JOIN matriculas mt ON mt.grupo_id = g.id AND mt.estado = 'activa'
     JOIN usuarios u ON u.id = mt.estudiante_id AND u.rol = 'estudiante' AND u.activo = TRUE
     WHERE g.director_id = ?
       AND (u.nombres LIKE ? OR u.apellidos LIKE ? OR CONCAT(u.nombres, ' ', u.apellidos) LIKE ? OR u.numero_documento LIKE ?)
     ORDER BY nombres LIMIT 20`,
    [docenteId, like, like, like, like, docenteId, like, like, like, like]
  );
  return rows;
}

// ¿`docenteId` le dicta o dirige a `estudianteId`?
async function docenteDictaAlEstudiante(docenteId, estudianteId) {
  const [[{ c }]] = await pool.query(
    `SELECT COUNT(*) AS c FROM (
       SELECT e.id FROM matriculas mt
       JOIN grupos g ON g.id = mt.grupo_id
       JOIN materias m ON m.activa = TRUE AND ${condicionMateriaEnGrupo('m', 'g.id')}
       JOIN docentes_materias dm ON dm.materia_id = m.id
         AND ${condicionDocenteEnGrupo('dm', 'm', 'g.id')}
       JOIN usuarios e ON e.id = mt.estudiante_id AND e.activo = TRUE
       WHERE mt.estado = 'activa' AND dm.docente_id = ? AND e.id = ?
       UNION
       SELECT e.id FROM grupos g
       JOIN matriculas mt ON mt.grupo_id = g.id AND mt.estado = 'activa'
       JOIN usuarios e ON e.id = mt.estudiante_id AND e.activo = TRUE
       WHERE g.director_id = ? AND e.id = ?
     ) x`,
    [docenteId, estudianteId, docenteId, estudianteId]
  );
  return Number(c) > 0;
}

// ¿`docenteId` le dicta a algún acudido de `acudienteId`?
async function docenteDictaAlAcudido(docenteId, acudienteId) {
  const [[{ c }]] = await pool.query(
    `SELECT COUNT(*) AS c FROM (
       SELECT u.id FROM acudientes_estudiantes ae
       JOIN matriculas mt ON mt.estudiante_id = ae.estudiante_id AND mt.estado = 'activa'
       JOIN grupos g ON g.id = mt.grupo_id
       JOIN materias m ON m.activa = TRUE AND ${condicionMateriaEnGrupo('m', 'g.id')}
       JOIN docentes_materias dm ON dm.materia_id = m.id
         AND ${condicionDocenteEnGrupo('dm', 'm', 'g.id')}
       JOIN usuarios u ON u.id = dm.docente_id AND u.rol = 'docente' AND u.activo = TRUE
       WHERE ae.acudiente_id = ? AND u.id = ?
       UNION
       SELECT u.id FROM acudientes_estudiantes ae
       JOIN matriculas mt ON mt.estudiante_id = ae.estudiante_id AND mt.estado = 'activa'
       JOIN grupos g ON g.id = mt.grupo_id
       JOIN usuarios u ON u.id = g.director_id AND u.rol = 'docente' AND u.activo = TRUE
       WHERE ae.acudiente_id = ? AND u.id = ?
     ) x`,
    [acudienteId, docenteId, acudienteId, docenteId]
  );
  return Number(c) > 0;
}

// Valida a quién puede abrir un chat personal `me`.
async function validarDestino(me, enteId) {
  if (typeof enteId !== 'string' || !enteId) return { ok: false, mensaje: 'Destino inválido.' };
  if (enteId === me.id) return { ok: true };
  if (enteId.length !== 36) return { ok: false, mensaje: 'Destino inválido.' };

if (me.rol === 'superadmin') {
    const [u] = await pool.query(
      `SELECT rol FROM usuarios WHERE id = ? AND activo = TRUE LIMIT 1`,
      [enteId]
    );
    if (!u.length) return { ok: false, mensaje: 'Usuario no encontrado.' };
    if (u[0].rol === 'admin' || u[0].rol === 'docente') return { ok: true };
    return { ok: false, mensaje: 'La superadministración solo chatea con administradores o docentes.' };
  }

  const [u] = await pool.query(
    `SELECT id, rol, institucion_id FROM usuarios WHERE id = ? AND activo = TRUE LIMIT 1`,
    [enteId]
  );
  if (!u.length) return { ok: false, mensaje: 'Usuario no encontrado.' };
  const t = u[0];

  if (me.rol === 'admin') {
    if (t.rol === 'admin') {
      // admin ↔ admin: solo entre instituciones distintas.
      if (t.institucion_id && t.institucion_id !== me.institucion_id) return { ok: true };
      return { ok: false, mensaje: 'Solo puedes chatear con administradores de otras instituciones.' };
    }
    if (t.institucion_id === me.institucion_id && ['docente', 'estudiante', 'acudiente'].includes(t.rol)) {
      return { ok: true };
    }
    return { ok: false, mensaje: 'Ese usuario no pertenece a tu institución.' };
  }

  if (me.rol === 'docente') {
    const adminId = await adminDeInstitucion(me.institucion_id);
    if (adminId === enteId) {
      const abierto = await configAbierto(me.institucion_id);
      return abierto
        ? { ok: true }
        : { ok: false, mensaje: 'Espera a que el administrador te escriba primero.' };
    }
    if (t.rol !== 'estudiante' || t.institucion_id !== me.institucion_id) {
      return { ok: false, mensaje: 'Solo puedes escribir a tus estudiantes o a la administración.' };
    }
    const loTiene = await docenteDictaAlEstudiante(me.id, enteId);
    return loTiene
      ? { ok: true }
      : { ok: false, mensaje: 'Solo puedes escribir a tus estudiantes de clase.' };
  }

  if (me.rol === 'estudiante') {
    if (t.rol !== 'docente' || t.institucion_id !== me.institucion_id) {
      return { ok: false, mensaje: 'Solo puedes escribir a tus docentes de curso.' };
    }
    const loDicta = await docenteDictaAlEstudiante(enteId, me.id);
    return loDicta
      ? { ok: true }
      : { ok: false, mensaje: 'Solo puedes escribir a tus docentes de curso.' };
  }

  if (me.rol === 'acudiente') {
    if (t.rol !== 'docente' || t.institucion_id !== me.institucion_id) {
      return { ok: false, mensaje: 'Solo puedes escribir a los docentes de tu acudido.' };
    }
    const loDicta = await docenteDictaAlAcudido(enteId, me.id);
    return loDicta
      ? { ok: true }
      : { ok: false, mensaje: 'Solo puedes escribir a los docentes de tu acudido.' };
  }

  return { ok: false, mensaje: 'Tu rol no puede abrir chats personales.' };
}

// Contraparte de un chat para el usuario actual (para mostrar
// en la lista de conversaciones y en el encabezado del chat).
async function counterpart(chat, me) {
  if (chat.tipo === 'institucion') {
    if (me.rol === 'superadmin') {
      const [inst] = await pool.query(
        `SELECT nombre, nit, municipio FROM instituciones WHERE id = ? LIMIT 1`,
        [chat.institucion_id || chat.ente_b]
      );
      return {
        nombre: inst.length ? inst[0].nombre : 'Institución',
        sub: inst.length ? (inst[0].nit || inst[0].municipio || '') : '',
        label: 'institución',
      };
    }
    const [sup] = await pool.query(
      `SELECT nombres, apellidos FROM usuarios WHERE id = ? LIMIT 1`,
      [chat.ente_a]
    );
    return {
      nombre: `${sup.length ? sup[0].nombres : 'Soporte'} SIA`,
      sub: 'Superadministración',
      label: 'Soporte SIA',
    };
  }
  if (chat.ente_a === me.id && chat.ente_b === me.id) {
    return {
      nombre: 'Tú (notas personales)',
      sub: 'Notas personales',
      label: 'Notas personales',
    };
  }
  const otroId = chat.ente_a === me.id ? chat.ente_b : chat.ente_a;
  const [u] = await pool.query(
    `SELECT nombres, apellidos, rol, numero_documento, email FROM usuarios WHERE id = ? LIMIT 1`,
    [otroId]
  );
  if (!u.length) return { nombre: 'Usuario', sub: '', label: '' };
  const rolNombre = { docente: 'Docente', estudiante: 'Estudiante', acudiente: 'Acudiente', admin: 'Administrador' }[u[0].rol] || u[0].rol;
  return {
    nombre: `${u[0].nombres} ${u[0].apellidos}`,
    sub: `${rolNombre} · ${u[0].numero_documento}`,
    label: rolNombre,
  };
}

async function detalleConversacion(chat, me) {
  const contraparte = await counterpart(chat, me);
  const [last] = await pool.query(
    `SELECT cm.texto, cm.tipo, cm.transcripcion, cm.remitente_id, cm.created_at,
            a.nombre_original
     FROM chat_mensajes cm
     LEFT JOIN archivos a ON a.id = cm.archivo_id
     WHERE cm.chat_id = ? AND cm.eliminado = 0
       AND NOT EXISTS (
         SELECT 1 FROM chat_mensajes_ocultos o
         WHERE o.mensaje_id = cm.id AND o.usuario_id = ?
       )
     ORDER BY cm.created_at DESC LIMIT 1`,
    [chat.id, me.id]
  );
  const [noLeidos] = await pool.query(
    `SELECT COUNT(*) AS c FROM chat_mensajes cm
     WHERE cm.chat_id = ? AND cm.remitente_id <> ? AND cm.leido = 0
       AND cm.eliminado = 0
       AND NOT EXISTS (
         SELECT 1 FROM chat_mensajes_ocultos o
         WHERE o.mensaje_id = cm.id AND o.usuario_id = ?
       )`,
    [chat.id, me.id, me.id]
  );
  const ultimo = last.length ? last[0] : null;
  const ultimoMensaje = !ultimo
    ? null
    : ultimo.tipo === 'audio'
      ? `🎤 ${ultimo.nombre_original || 'Mensaje de voz'}`
      : ultimo.tipo === 'archivo'
        ? `📎 ${ultimo.nombre_original || 'Archivo adjunto'}`
        : ultimo.texto;
  return {
    id: chat.id,
    tipo: chat.tipo,
    ...contraparte,
    ultimo_mensaje: ultimoMensaje,
    ultimo_remitente_id: ultimo ? ultimo.remitente_id : null,
    ultimo_at: ultimo ? ultimo.created_at : chat.created_at,
    no_leidos: noLeidos[0].c || 0,
    bloqueado: !!chat.bloqueado_por,
    bloqueado_por: chat.bloqueado_por,
    yo_bloquee: chat.bloqueado_por === me.id,
  };
}

async function leerChat(chatId, meId, otrosIds, io) {
  await pool.query(
    `UPDATE chat_mensajes SET leido = 1 WHERE chat_id = ? AND remitente_id <> ? AND leido = 0`,
    [chatId, meId]
  );
  if (io) {
    for (const u of otrosIds) io.to(`usuario:${u}`).emit('chat:leido', { chat_id: chatId, por: meId });
  }
}

// ── GET /api/chat/config ─────────────────────────────────────
exports.config = asyncHandler(async (req, res) => {
  const rol = req.usuario.rol;
  let permitir = false;
  if (rol === 'admin' || rol === 'docente' || rol === 'estudiante' || rol === 'acudiente') {
    permitir = await configAbierto(req.usuario.institucion_id);
  }
  const adminId = rol === 'docente' || rol === 'estudiante' || rol === 'acudiente'
    ? await adminDeInstitucion(req.usuario.institucion_id)
    : null;
  return res.json({ ok: true, config: { rol, permitir_mensajes_abiertos: permitir, admin_id: adminId } });
});

// ── PUT /api/chat/config  { permitir_mensajes_abiertos } ─────
exports.actualizarConfig = asyncHandler(async (req, res) => {
  if (req.usuario.rol !== 'admin') {
    return res.status(403).json({ ok: false, mensaje: 'Solo el administrador de la institución puede cambiar esta opción.' });
  }
  const institucionId = req.usuario.institucion_id;
  if (!institucionId) {
    return res.status(400).json({ ok: false, mensaje: 'Tu cuenta no tiene institución asociada.' });
  }
  const permitir = !!req.body.permitir_mensajes_abiertos;
  await pool.query(
    `INSERT INTO chat_config (institucion_id, permitir_mensajes_abiertos) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE permitir_mensajes_abiertos = VALUES(permitir_mensajes_abiertos)`,
    [institucionId, permitir]
  );
  return res.json({
    ok: true,
    mensaje: permitir ? 'Mensajes abiertos: cualquier persona de la institución puede escribirte.' : 'Mensajes de entrada desactivados: solo tú inicias los chats.',
  });
});

// ── GET /api/chat/conversaciones ─────────────────────────────
exports.conversaciones = asyncHandler(async (req, res) => {
  const me = req.usuario;
  const chats = [];

  const soloConMensajes = ` AND EXISTS (SELECT 1 FROM chat_mensajes cm WHERE cm.chat_id = chats.id)`;

  if (me.rol === 'superadmin') {
    const [rows] = await pool.query(
      `SELECT id, tipo, ente_a, ente_b, institucion_id, bloqueado_por, created_at
       FROM chats WHERE tipo = 'institucion' AND ente_a = ?
       ${soloConMensajes}
       ORDER BY updated_at DESC LIMIT 25`,
      [me.id]
    );
    chats.push(...rows);
    // Ronda C3: el súperadmin también ve sus chats personales con
    // administradores y docentes.
    const [personales] = await pool.query(
      `SELECT id, tipo, ente_a, ente_b, institucion_id, bloqueado_por, created_at
       FROM chats WHERE tipo = 'personal' AND (ente_a = ? OR ente_b = ?)
       ${soloConMensajes}
       ORDER BY updated_at DESC LIMIT 25`,
      [me.id, me.id]
    );
    chats.push(...personales);
  } else if (me.rol === 'admin') {
    const [rows] = await pool.query(
      `SELECT id, tipo, ente_a, ente_b, institucion_id, bloqueado_por, created_at
       FROM chats WHERE tipo = 'institucion' AND institucion_id = ?
       ${soloConMensajes}
       ORDER BY updated_at DESC LIMIT 25`,
      [me.institucion_id]
    );
    chats.push(...rows);
    const [personales] = await pool.query(
      `SELECT id, tipo, ente_a, ente_b, institucion_id, bloqueado_por, created_at
       FROM chats WHERE tipo = 'personal' AND (ente_a = ? OR ente_b = ?)
       ${soloConMensajes}
       ORDER BY updated_at DESC LIMIT 25`,
      [me.id, me.id]
    );
    chats.push(...personales);
  } else {
    const [personales] = await pool.query(
      `SELECT id, tipo, ente_a, ente_b, institucion_id, bloqueado_por, created_at
       FROM chats WHERE tipo = 'personal' AND (ente_a = ? OR ente_b = ?)
       ${soloConMensajes}
       ORDER BY updated_at DESC LIMIT 25`,
      [me.id, me.id]
    );
    chats.push(...personales);
  }

  const [chatPropio] = await pool.query(
    `SELECT id, tipo, ente_a, ente_b, institucion_id, bloqueado_por, created_at
     FROM chats
     WHERE tipo = 'personal' AND ente_a = ? AND ente_b = ?
     LIMIT 1`,
    [me.id, me.id]
  );
  chats.push(...chatPropio);

  const unicos = [];
  const vistos = new Set();
  for (const c of chats) {
    if (!vistos.has(c.id)) { vistos.add(c.id); unicos.push(c); }
  }

  const resultado = [];
  for (const c of unicos) {
    const det = await detalleConversacion(c, me);
    resultado.push({ ...det, created_at: c.created_at });
  }

  // Los chats sin mensajes quedan al final.
  resultado.sort((x, y) => {
    const tieneX = x.ultimo_mensaje ? 1 : 0;
    const tieneY = y.ultimo_mensaje ? 1 : 0;
    return tieneY - tieneX || new Date(y.ultimo_at) - new Date(x.ultimo_at);
  });

  return res.json({ ok: true, total: resultado.length, conversaciones: resultado });
});

// ── GET /api/chat/buscar?q= ──────────────────────────────────
exports.buscar = asyncHandler(async (req, res) => {
  const me = req.usuario;
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ ok: true, total: 0, resultados: [] });

  const like = `%${q}%`;
  const propio = await resultadoChatPropio(me, q);
  const responder = (resultados, limite) => {
    const todos = incluirChatPropio(resultados, propio);
    return res.json({ ok: true, total: todos.length, resultados: todos.slice(0, limite) });
  };

  if (me.rol === 'superadmin') {
    const [insts] = await pool.query(
      `SELECT id, nombre, nit, municipio FROM instituciones
       WHERE activa = TRUE AND (nombre LIKE ? OR nit LIKE ? OR municipio LIKE ?)
       ORDER BY nombre LIMIT 20`,
      [like, like, like]
    );
    // Ronda C3: además de instituciones, el súperadmin encuentra
    // administradores y docentes de cualquier institución.
    const [users] = await pool.query(
      `SELECT u.id, u.nombres, u.apellidos, u.rol, u.numero_documento, i.nombre AS institucion
       FROM usuarios u
       LEFT JOIN instituciones i ON i.id = u.institucion_id
       WHERE u.activo = TRUE AND u.rol IN ('admin', 'docente')
         AND (u.nombres LIKE ? OR u.apellidos LIKE ? OR CONCAT(u.nombres, ' ', u.apellidos) LIKE ?
              OR u.numero_documento LIKE ? OR u.email LIKE ?)
       ORDER BY u.rol, u.nombres LIMIT 20`,
      [like, like, like, like, like]
    );
    const resultados = insts.map(r => ({ id: r.id, nombre: r.nombre, sub: r.nit || r.municipio || '', tipo: 'institucion' }));
    for (const u of users) {
      resultados.push({
        id: u.id,
        nombre: `${u.nombres} ${u.apellidos}`,
        sub: `${u.rol === 'admin' ? 'Administrador' : 'Docente'}${u.institucion ? ' · ' + u.institucion : ''} · ${u.numero_documento}`,
        tipo: 'personal',
      });
    }
    return responder(resultados, 30);
  }

  if (me.rol === 'admin') {
    const [propios] = await pool.query(
      `SELECT id, nombres, apellidos, rol, numero_documento, email FROM usuarios
       WHERE institucion_id = ? AND activo = TRUE AND rol IN ('docente','estudiante','acudiente')
         AND (nombres LIKE ? OR apellidos LIKE ? OR CONCAT(nombres, ' ', apellidos) LIKE ?
              OR numero_documento LIKE ? OR email LIKE ?)
       ORDER BY rol, nombres LIMIT 20`,
      [me.institucion_id, like, like, like, like, like]
    );
    // Admin ↔ admin: administradores de otras instituciones.
    const [admins] = await pool.query(
      `SELECT u.id, u.nombres, u.apellidos, u.numero_documento, i.nombre AS institucion
       FROM usuarios u
       JOIN instituciones i ON i.id = u.institucion_id
       WHERE u.rol = 'admin' AND u.activo = TRUE AND u.institucion_id <> ?
         AND (u.nombres LIKE ? OR u.apellidos LIKE ? OR CONCAT(u.nombres, ' ', u.apellidos) LIKE ? OR i.nombre LIKE ?)
       ORDER BY u.nombres LIMIT 10`,
      [me.institucion_id, like, like, like, like]
    );
    const etiquetas = { docente: 'Docente', estudiante: 'Estudiante', acudiente: 'Acudiente' };
    const resultados = [];
    for (const r of propios) {
      resultados.push({ id: r.id, nombre: `${r.nombres} ${r.apellidos}`, sub: `${etiquetas[r.rol] || r.rol} · ${r.numero_documento}`, tipo: 'personal' });
    }
    for (const r of admins) {
      resultados.push({ id: r.id, nombre: `${r.nombres} ${r.apellidos}`, sub: `Administrador · ${r.institucion}`, tipo: 'personal' });
    }
    return responder(resultados, 30);
  }

  if (me.rol === 'docente') {
    const resultados = [];
    const adminId = await adminDeInstitucion(me.institucion_id);
    if (adminId && (await configAbierto(me.institucion_id))) {
      const [adm] = await pool.query(
        `SELECT id, nombres, apellidos, numero_documento FROM usuarios WHERE id = ? LIMIT 1`,
        [adminId]
      );
      if (adm.length) {
        const nombreAdm = `${adm[0].nombres} ${adm[0].apellidos}`;
        if (nombreAdm.toLowerCase().includes(q.toLowerCase()) || (adm[0].numero_documento || '').includes(q)) {
          resultados.push({ id: adm[0].id, nombre: nombreAdm, sub: `Administrador · ${adm[0].numero_documento}`, tipo: 'personal' });
        }
      }
    }
    const ests = await estudiantesDeDocente(me.id, like);
    for (const e of ests) {
      resultados.push({ id: e.id, nombre: `${e.nombres} ${e.apellidos}`, sub: `Estudiante · ${e.numero_documento}`, tipo: 'personal' });
    }
    return responder(resultados, 20);
  }

  if (me.rol === 'estudiante') {
    const rows = await docentesDeEstudiante(me.id, like);
    return responder(rows.map(r => ({
        id: r.id, nombre: `${r.nombres} ${r.apellidos}`,
        sub: r.es_director ? 'Docente · Director de curso' : 'Docente', tipo: 'personal',
      })), 20);
  }

  if (me.rol === 'acudiente') {
    const rows = await docentesDeAcudido(me.id, like);
    return responder(rows.map(r => ({
        id: r.id, nombre: `${r.nombres} ${r.apellidos}`,
        sub: r.es_director ? 'Docente · Director de curso' : 'Docente', tipo: 'personal',
      })), 20);
  }

  return responder([], 20);
});

// ── POST /api/chat/abrir { tipo, ente_id } ───────────────────
exports.abrir = asyncHandler(async (req, res) => {
  const me = req.usuario;
  const { tipo, ente_id } = req.body;
  if (!tipo || !ente_id) return res.status(400).json({ ok: false, mensaje: 'Faltan tipo y ente_id.' });

  let chat;

  if (tipo === 'institucion') {
    if (me.rol !== 'superadmin') return res.status(403).json({ ok: false, mensaje: 'Solo la superadministración abre el canal de una institución.' });
    const [inst] = await pool.query(`SELECT id FROM instituciones WHERE id = ? AND activa = TRUE LIMIT 1`, [ente_id]);
    if (!inst.length) return res.status(404).json({ ok: false, mensaje: 'Institución no encontrada.' });
    const [rows] = await pool.query(
      `SELECT id, tipo, ente_a, ente_b, institucion_id, bloqueado_por, created_at
       FROM chats WHERE tipo = 'institucion' AND ente_a = ? AND ente_b = ? LIMIT 1`,
      [me.id, ente_id]
    );
    if (rows.length) {
      chat = rows[0];
    } else {
      const id = randomUUID();
      await pool.query(
        `INSERT INTO chats (id, tipo, ente_a, ente_b, institucion_id, creado_por) VALUES (?, 'institucion', ?, ?, ?, ?)`,
        [id, me.id, ente_id, ente_id, me.id]
      );
      const [nvo] = await pool.query(
        `SELECT id, tipo, ente_a, ente_b, institucion_id, bloqueado_por, created_at FROM chats WHERE id = ?`,
        [id]
      );
      chat = nvo[0];
    }
  } else {
    // tipo 'personal'
    const v = await validarDestino(me, ente_id);
    if (!v.ok) return res.status(403).json({ ok: false, mensaje: v.mensaje });
    const [par1, par2] = parCanonico(me.id, ente_id);
    const [rows] = await pool.query(
      `SELECT id, tipo, ente_a, ente_b, institucion_id, bloqueado_por, created_at
       FROM chats WHERE tipo = 'personal' AND ((ente_a = ? AND ente_b = ?) OR (ente_a = ? AND ente_b = ?)) LIMIT 1`,
      [par1, par2, par2, par1]
    );
    if (rows.length) {
      chat = rows[0];
    } else {
      const id = randomUUID();
      await pool.query(
        `INSERT INTO chats (id, tipo, ente_a, ente_b, institucion_id, creado_por) VALUES (?, 'personal', ?, ?, ?, ?)`,
        [id, par1, par2, me.institucion_id || null, me.id]
      );
      const [nvo] = await pool.query(
        `SELECT id, tipo, ente_a, ente_b, institucion_id, bloqueado_por, created_at FROM chats WHERE id = ?`,
        [id]
      );
      chat = nvo[0];
    }
  }

  const det = await detalleConversacion(chat, me);
  return res.json({ ok: true, chat: { ...det, created_at: chat.created_at }, creado: true });
});

// ── GET /api/chat/:chatId/mensajes ───────────────────────────
exports.mensajes = asyncHandler(async (req, res) => {
  const me = req.usuario;
  const [rows] = await pool.query(
    `SELECT id, tipo, ente_a, ente_b, institucion_id, bloqueado_por, created_at FROM chats WHERE id = ? LIMIT 1`,
    [req.params.chatId]
  );
  if (!rows.length) return res.status(404).json({ ok: false, mensaje: 'Chat no encontrado.' });
  const chat = rows[0];
  if (!esParticipante(chat, me)) return res.status(403).json({ ok: false, mensaje: 'No tienes acceso a este chat.' });

  const [msgs] = await pool.query(
    `SELECT cm.id, cm.remitente_id, cm.texto, cm.tipo, cm.transcripcion,
            cm.archivo_id, cm.leido, cm.created_at,
            a.nombre_original AS archivo_nombre, a.mime_type, a.tamanio_bytes
     FROM chat_mensajes cm
     LEFT JOIN archivos a ON a.id = cm.archivo_id
     WHERE cm.chat_id = ? AND cm.eliminado = 0
      AND NOT EXISTS (
        SELECT 1 FROM chat_mensajes_ocultos o
        WHERE o.mensaje_id = cm.id AND o.usuario_id = ?
      )
    ORDER BY cm.created_at ASC LIMIT 300`,
    [chat.id, me.id]
  );

  const otros = await participantesChat(chat, me.id);
  await leerChat(chat.id, me.id, otros, req.app.get('io'));

  const contraparte = await counterpart(chat, me);
  return res.json({
    ok: true,
    chat: { id: chat.id, tipo: chat.tipo, bloqueado: !!chat.bloqueado_por, bloqueado_por: chat.bloqueado_por, yo_bloquee: chat.bloqueado_por === me.id, ...contraparte },
    mensajes: msgs,
  });
});

// ── POST /api/chat/:chatId/enviar { texto } o multipart { archivo } ──
exports.enviar = asyncHandler(async (req, res) => {
  const me = req.usuario;
  const file = req.file;
  const texto = typeof req.body.texto === 'string' ? req.body.texto.trim() : '';
  const transcripcion = typeof req.body.transcripcion === 'string'
    ? req.body.transcripcion.trim()
    : '';
  let conn = null;
  let archivoGuardado = false;

  try {
    if (texto.length > 2000) return res.status(400).json({ ok: false, mensaje: 'El mensaje es muy largo.' });
    if (transcripcion.length > 20000) {
      return res.status(400).json({ ok: false, mensaje: 'La transcripción es muy larga.' });
    }
    if (!texto && !file) return res.status(400).json({ ok: false, mensaje: 'Escribe un mensaje o adjunta un archivo.' });

    const [rows] = await pool.query(
      `SELECT id, tipo, ente_a, ente_b, institucion_id, bloqueado_por
       FROM chats WHERE id = ? LIMIT 1`,
      [req.params.chatId]
    );
    if (!rows.length) return res.status(404).json({ ok: false, mensaje: 'Chat no encontrado.' });
    const chat = rows[0];
    if (!esParticipante(chat, me)) {
      return res.status(403).json({ ok: false, mensaje: 'No tienes acceso a este chat.' });
    }
    if (chat.bloqueado_por) {
      return res.status(403).json({ ok: false, mensaje: 'Este chat está bloqueado.' });
    }

    // Ronda C2: si el admin cerró "mensajes abiertos", nadie de la
    // institución puede seguir escribiéndole, ni por un chat ya iniciado.
    if (chat.tipo === 'personal' && !['admin', 'superadmin'].includes(me.rol)) {
      const otroId = chat.ente_a === me.id ? chat.ente_b : chat.ente_a;
      const adminId = await adminDeInstitucion(chat.institucion_id);
      if (otroId === adminId && !(await configAbierto(chat.institucion_id))) {
        return res.status(403).json({ ok: false, mensaje: 'Este chat está bloqueado por el administrador.' });
      }
    }

    const id = randomUUID();
    const archivoId = file ? randomUUID() : null;
    const tipo = file ? tipoChatArchivo(file) : 'texto';
    const fecha = new Date();
    conn = await pool.getConnection();
    await conn.beginTransaction();

    if (file) {
      await conn.query(
        `INSERT INTO archivos
           (id, subido_por, tipo, nombre_original, nombre_storage, ruta_storage,
            mime_type, tamanio_bytes, es_publico, descripcion)
         VALUES (?, ?, 'chat_adjunto', ?, ?, ?, ?, ?, FALSE, ?)`,
        [
          archivoId,
          me.id,
          file.originalname,
          file.filename,
          rutaRelativaProyecto(file.path),
          file.mimetype,
          file.size,
          'Adjunto de mensajería',
        ]
      );
    }

    await conn.query(
      `INSERT INTO chat_mensajes
         (id, chat_id, remitente_id, archivo_id, tipo, texto, transcripcion)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, chat.id, me.id, archivoId, tipo, texto || null, tipo === 'audio' ? transcripcion || null : null]
    );
    await conn.commit();
    archivoGuardado = !!file;

    const otros = await participantesChat(chat, me.id);
    const io = req.app.get('io');
    if (io) {
      for (const u of otros) io.to(`usuario:${u}`).emit('chat:update', { chat_id: chat.id });
    }

    return res.status(201).json({
      ok: true,
      mensaje: 'Mensaje enviado.',
      msg: {
        id,
        chat_id: chat.id,
        remitente_id: me.id,
        archivo_id: archivoId,
        tipo,
        texto: texto || null,
        transcripcion: tipo === 'audio' ? transcripcion || null : null,
        archivo_nombre: file ? file.originalname : null,
        mime_type: file ? file.mimetype : null,
        tamanio_bytes: file ? file.size : null,
        leido: 0,
        created_at: fecha,
      },
    });
  } catch (err) {
    if (conn) await conn.rollback();
    throw err;
  } finally {
    if (conn) conn.release();
    if (file && !archivoGuardado) await eliminarTemporal(file);
  }
});

// Descarga/reproducción autenticada: solo quien participa en el chat.
exports.descargarAdjunto = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT c.id AS chat_id, c.tipo, c.ente_a, c.ente_b,
            c.institucion_id, a.nombre_original, a.ruta_storage, a.mime_type
     FROM chat_mensajes cm
     JOIN chats c ON c.id = cm.chat_id
     JOIN archivos a ON a.id = cm.archivo_id
     WHERE cm.id = ? AND cm.chat_id = ? LIMIT 1`,
    [req.params.mensajeId, req.params.chatId]
  );
  if (!rows.length) return res.status(404).json({ ok: false, mensaje: 'Adjunto no encontrado.' });
  const archivo = rows[0];
  if (!esParticipante(archivo, req.usuario)) {
    return res.status(403).json({ ok: false, mensaje: 'No tienes acceso a este adjunto.' });
  }

  const ruta = path.resolve(RAIZ_PROYECTO, archivo.ruta_storage);
  if (!ruta.startsWith(`${CARPETA_CHAT}${path.sep}`)) {
    console.error('Ruta de adjunto de chat fuera de su carpeta.');
    return res.status(500).json({ ok: false, mensaje: 'No se pudo abrir el adjunto.' });
  }

  res.setHeader('Content-Type', archivo.mime_type || 'application/octet-stream');
  res.setHeader(
    'Content-Disposition',
    `inline; filename*=UTF-8''${encodeURIComponent(archivo.nombre_original)}`
  );
  return res.sendFile(ruta, err => {
    if (err) {
      console.error('descargar adjunto de chat:', err.message);
      if (!res.headersSent) {
        res.status(err.code === 'ENOENT' ? 404 : 500).json({
          ok: false,
          mensaje: err.code === 'ENOENT' ? 'Adjunto no encontrado.' : 'No se pudo abrir el adjunto.',
        });
      }
    }
  });
});

// ── POST /api/chat/:chatId/bloquear ──────────────────────────
exports.bloquear = asyncHandler(async (req, res) => {
  const me = req.usuario;
  const [rows] = await pool.query(`SELECT * FROM chats WHERE id = ? LIMIT 1`, [req.params.chatId]);
  if (!rows.length) return res.status(404).json({ ok: false, mensaje: 'Chat no encontrado.' });
  if (!esParticipante(rows[0], me)) return res.status(403).json({ ok: false, mensaje: 'No tienes acceso a este chat.' });

  await pool.query(`UPDATE chats SET bloqueado_por = ? WHERE id = ?`, [me.id, req.params.chatId]);

  const otros = await participantesChat(rows[0], me.id);
  const io = req.app.get('io');
  if (io) {
    for (const u of otros) io.to(`usuario:${u}`).emit('chat:update', { chat_id: req.params.chatId });
  }

  return res.json({ ok: true, mensaje: 'Chat bloqueado.' });
});

// ── POST /api/chat/:chatId/desbloquear ───────────────────────
exports.desbloquear = asyncHandler(async (req, res) => {
  const me = req.usuario;
  const [rows] = await pool.query(`SELECT * FROM chats WHERE id = ? LIMIT 1`, [req.params.chatId]);
  if (!rows.length) return res.status(404).json({ ok: false, mensaje: 'Chat no encontrado.' });
  if (!esParticipante(rows[0], me)) return res.status(403).json({ ok: false, mensaje: 'No tienes acceso a este chat.' });
  if (rows[0].bloqueado_por !== me.id) return res.status(403).json({ ok: false, mensaje: 'Solo quien bloqueó el chat puede desbloquearlo.' });

  await pool.query(`UPDATE chats SET bloqueado_por = NULL WHERE id = ?`, [req.params.chatId]);

  const otros = await participantesChat(rows[0], me.id);
  const io = req.app.get('io');
  if (io) {
    for (const u of otros) io.to(`usuario:${u}`).emit('chat:update', { chat_id: req.params.chatId });
  }

  return res.json({ ok: true, mensaje: 'Chat desbloqueado.' });
});

// ── DELETE /api/chat/:chatId/mensajes/:mensajeId ─────────────
// Mensaje propio: se elimina para todos (marca + borra adjuntos).
// Mensaje ajeno: se oculta solo para quien lo solicita.
exports.eliminarMensaje = asyncHandler(async (req, res) => {
  const me = req.usuario;
  let [chats] = await pool.query(
    `SELECT * FROM chats WHERE id = ? LIMIT 1`,
    [req.params.chatId]
  );
  // El frontend del chat de curso trabaja con el id del grupo: se acepta
  // también ese id para resolver el mismo chat y aplicar la misma regla.
  if (!chats.length) {
    [chats] = await pool.query(
      `SELECT * FROM chats WHERE grupo_id = ? ORDER BY created_at ASC LIMIT 1`,
      [req.params.chatId]
    );
  }
  if (!chats.length) return res.status(404).json({ ok: false, mensaje: 'Chat no encontrado.' });
  const chat = chats[0];
  if (!(await esParticipanteChat(chat, me))) {
    return res.status(403).json({ ok: false, mensaje: 'No tienes acceso a este chat.' });
  }

  const [rows] = await pool.query(
    `SELECT cm.id, cm.remitente_id, cm.archivo_id, cm.eliminado, a.ruta_storage
       FROM chat_mensajes cm
       LEFT JOIN archivos a ON a.id = cm.archivo_id
      WHERE cm.id = ? AND cm.chat_id = ? LIMIT 1`,
    [req.params.mensajeId, chat.id]
  );
  if (!rows.length) return res.status(404).json({ ok: false, mensaje: 'Mensaje no encontrado.' });
  const mensaje = rows[0];
  if (Number(mensaje.eliminado) === 1) {
    return res.json({ ok: true, mensaje: 'El mensaje ya estaba eliminado.', alcance: 'todos' });
  }

  const io = req.app.get('io');

  // Mensaje de otra persona: solo se oculta para mí.
  if (mensaje.remitente_id !== me.id) {
    await pool.query(
      `INSERT INTO chat_mensajes_ocultos (mensaje_id, usuario_id) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE usuario_id = VALUES(usuario_id)`,
      [mensaje.id, me.id]
    );
    if (io) {
      io.to(`usuario:${me.id}`).emit('chat:mensaje-oculto', {
        chat_id: chat.id,
        mensaje_id: mensaje.id,
      });
    }
    return res.json({ ok: true, mensaje: 'Mensaje oculto solo para ti.', alcance: 'propio' });
  }

  // Mensaje propio: se elimina para todos y se borran sus adjuntos.
  let archivoRuta = null;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `UPDATE chat_mensajes
          SET eliminado = 1, eliminado_por = ?, eliminado_at = NOW(),
              texto = NULL, transcripcion = NULL, archivo_id = NULL
        WHERE id = ? AND chat_id = ? AND eliminado = 0`,
      [me.id, mensaje.id, chat.id]
    );
    await conn.query(`DELETE FROM chat_mensajes_ocultos WHERE mensaje_id = ?`, [mensaje.id]);
    if (mensaje.archivo_id) {
      archivoRuta = mensaje.ruta_storage || null;
      await conn.query(`DELETE FROM archivos WHERE id = ?`, [mensaje.archivo_id]);
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  if (archivoRuta) {
    const ruta = path.resolve(RAIZ_PROYECTO, archivoRuta);
    if (ruta.startsWith(`${CARPETA_CHAT}${path.sep}`)) {
      try {
        await fs.promises.unlink(ruta);
      } catch (err) {
        if (err.code !== 'ENOENT') {
          console.error('No se pudo borrar el adjunto del mensaje:', err.message);
        }
      }
    }
  }

  if (io) {
    for (const sala of await salasEventoChat(chat)) {
      io.to(sala).emit('chat:mensaje-eliminado', {
        chat_id: chat.id,
        mensaje_id: mensaje.id,
      });
    }
  }

  return res.json({ ok: true, mensaje: 'Mensaje eliminado para todos.', alcance: 'todos' });
});
