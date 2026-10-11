// ============================================================
//  chat.controller.js — Centro de mensajería (estilo Messenger)
//  Tablas: chats, chat_mensajes, chat_config (migración 22).
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
const asyncHandler = require('../utils/asyncHandler');

// ── Helpers ─────────────────────────────────────────────────
function parCanonico(a, b) {
  return a < b ? [a, b] : [b, a];
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
     JOIN docentes_materias dm ON dm.grupo_id = g.id
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
     JOIN docentes_materias dm ON dm.grupo_id = g.id
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
       SELECT e.id FROM docentes_materias dm
       JOIN matriculas mt ON mt.grupo_id = dm.grupo_id AND mt.estado = 'activa'
       JOIN usuarios e ON e.id = mt.estudiante_id AND e.activo = TRUE
       WHERE dm.docente_id = ? AND e.id = ?
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
       JOIN docentes_materias dm ON dm.grupo_id = g.id
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
  if (!enteId || enteId === me.id) return { ok: false, mensaje: 'No puedes abrir chat contigo mismo.' };
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
    `SELECT texto, remitente_id, created_at FROM chat_mensajes
     WHERE chat_id = ? ORDER BY created_at DESC LIMIT 1`,
    [chat.id]
  );
  const [noLeidos] = await pool.query(
    `SELECT COUNT(*) AS c FROM chat_mensajes
     WHERE chat_id = ? AND remitente_id <> ? AND leido = 0`,
    [chat.id, me.id]
  );
  const ultimo = last.length ? last[0] : null;
  return {
    id: chat.id,
    tipo: chat.tipo,
    ...contraparte,
    ultimo_mensaje: ultimo ? ultimo.texto : null,
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
    return res.json({ ok: true, total: resultados.length, resultados: resultados.slice(0, 30) });
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
    return res.json({ ok: true, total: resultados.length, resultados: resultados.slice(0, 30) });
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
    return res.json({ ok: true, total: resultados.length, resultados: resultados.slice(0, 20) });
  }

  if (me.rol === 'estudiante') {
    const rows = await docentesDeEstudiante(me.id, like);
    return res.json({
      ok: true, total: rows.length,
      resultados: rows.map(r => ({
        id: r.id, nombre: `${r.nombres} ${r.apellidos}`,
        sub: r.es_director ? 'Docente · Director de curso' : 'Docente', tipo: 'personal',
      })),
    });
  }

  if (me.rol === 'acudiente') {
    const rows = await docentesDeAcudido(me.id, like);
    return res.json({
      ok: true, total: rows.length,
      resultados: rows.map(r => ({
        id: r.id, nombre: `${r.nombres} ${r.apellidos}`,
        sub: r.es_director ? 'Docente · Director de curso' : 'Docente', tipo: 'personal',
      })),
    });
  }

  return res.json({ ok: true, total: 0, resultados: [] });
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
    `SELECT id, remitente_id, texto, leido, created_at FROM chat_mensajes
     WHERE chat_id = ? ORDER BY created_at ASC LIMIT 300`,
    [chat.id]
  );

  const otros = [];
  if (chat.tipo === 'personal') {
    otros.push(chat.ente_a === me.id ? chat.ente_b : chat.ente_a);
  } else if (chat.tipo === 'institucion') {
    const supId = await superadminId();
    const adminId = await adminDeInstitucion(chat.institucion_id);
    otros.push(...([supId, adminId].filter(Boolean)));
  }
  await leerChat(chat.id, me.id, otros, req.app.get('io'));

  const contraparte = await counterpart(chat, me);
  return res.json({
    ok: true,
    chat: { id: chat.id, tipo: chat.tipo, bloqueado: !!chat.bloqueado_por, bloqueado_por: chat.bloqueado_por, yo_bloquee: chat.bloqueado_por === me.id, ...contraparte },
    mensajes: msgs,
  });
});

// ── POST /api/chat/:chatId/enviar { texto } ──────────────────
exports.enviar = asyncHandler(async (req, res) => {
  const me = req.usuario;
  const texto = (req.body.texto || '').trim();
  if (!texto) return res.status(400).json({ ok: false, mensaje: 'Escribe un mensaje.' });
  if (texto.length > 2000) return res.status(400).json({ ok: false, mensaje: 'El mensaje es muy largo.' });

  const [rows] = await pool.query(
    `SELECT id, tipo, ente_a, ente_b, institucion_id, bloqueado_por FROM chats WHERE id = ? LIMIT 1`,
    [req.params.chatId]
  );
if (!rows.length) return res.status(404).json({ ok: false, mensaje: 'Chat no encontrado.' });
  const chat = rows[0];
  if (!esParticipante(chat, me)) return res.status(403).json({ ok: false, mensaje: 'No tienes acceso a este chat.' });
  if (chat.bloqueado_por) return res.status(403).json({ ok: false, mensaje: 'Este chat está bloqueado.' });

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
  const fecha = new Date();
  await pool.query(
    `INSERT INTO chat_mensajes (id, chat_id, remitente_id, texto) VALUES (?, ?, ?, ?)`,
    [id, chat.id, me.id, texto]
  );

  const otros = [];
  if (chat.tipo === 'personal') {
    otros.push(chat.ente_a === me.id ? chat.ente_b : chat.ente_a);
  } else {
    const supId = await superadminId();
    const adminId = await adminDeInstitucion(chat.institucion_id);
    otros.push(...([supId, adminId].filter(Boolean)).filter(u => u !== me.id));
  }
  const io = req.app.get('io');
  if (io) {
    for (const u of otros) io.to(`usuario:${u}`).emit('chat:update', { chat_id: chat.id });
  }

  return res.status(201).json({
    ok: true, mensaje: 'Mensaje enviado.',
    msg: { id, chat_id: chat.id, remitente_id: me.id, texto, leido: 0, created_at: fecha },
  });
});

// ── POST /api/chat/:chatId/bloquear ──────────────────────────
exports.bloquear = asyncHandler(async (req, res) => {
  const me = req.usuario;
  const [rows] = await pool.query(`SELECT * FROM chats WHERE id = ? LIMIT 1`, [req.params.chatId]);
  if (!rows.length) return res.status(404).json({ ok: false, mensaje: 'Chat no encontrado.' });
  if (!esParticipante(rows[0], me)) return res.status(403).json({ ok: false, mensaje: 'No tienes acceso a este chat.' });

  await pool.query(`UPDATE chats SET bloqueado_por = ? WHERE id = ?`, [me.id, req.params.chatId]);

  const otros = [];
  if (rows[0].tipo === 'personal') {
    otros.push(rows[0].ente_a === me.id ? rows[0].ente_b : rows[0].ente_a);
  } else {
    const supId = await superadminId();
    const adminId = await adminDeInstitucion(rows[0].institucion_id);
    otros.push(...([supId, adminId].filter(Boolean)));
  }
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

  const otros = [];
  if (rows[0].tipo === 'personal') {
    otros.push(rows[0].ente_a === me.id ? rows[0].ente_b : rows[0].ente_a);
  } else {
    const supId = await superadminId();
    const adminId = await adminDeInstitucion(rows[0].institucion_id);
    otros.push(...([supId, adminId].filter(Boolean)));
  }
  const io = req.app.get('io');
  if (io) {
    for (const u of otros) io.to(`usuario:${u}`).emit('chat:update', { chat_id: req.params.chatId });
  }

  return res.json({ ok: true, mensaje: 'Chat desbloqueado.' });
});
