// ============================================================
//  services/chat-curso.service.js
//  Chat del curso (ROADMAP Ronda F, punto F5).
//  Publica mensajes del SISTEMA en el chat del grupo (crear/cerrar
//  actividades, notas publicadas, comunicados, videollamadas con
//  código de sala y enlace directo) y los emite en vivo por socket.io
//  a la sala `curso:{grupoId}`.
//  Uso desde otros controllers:
//     await publicarMensajeSistema(grupoId, {
//       evento: 'videollamada' | 'actividad_creada' | 'actividad_cerrada'
//             | 'nota_publicada' | 'comunicado',
//       texto: '...',
//       datos: { sala, url },   // opcional
//     });
// ============================================================

const pool = require('../config/db');
const { randomUUID } = require('crypto');

let io = null;
function setIO(instancia) { io = instancia; }

// Obtiene (o crea) el chat tipo 'curso' de un grupo.
async function chatDeGrupo(conn, grupoId) {
  const [rows] = await conn.query(
    `SELECT id, grupo_id, institucion_id FROM chats
     WHERE tipo = 'curso' AND grupo_id = ? LIMIT 1`,
    [grupoId]
  );
  if (rows.length) return rows[0];

  // El chat se asocia a la institución del grupo vía su grado.
  const [[grupo]] = await conn.query(
    `SELECT gr.institucion_id
       FROM grupos g JOIN grados gr ON gr.id = g.grado_id
      WHERE g.id = ? LIMIT 1`,
    [grupoId]
  );
  const id = randomUUID();
  await conn.query(
    `INSERT INTO chats (id, tipo, grupo_id, institucion_id)
     VALUES (?, 'curso', ?, ?)`,
    [id, grupoId, grupo ? grupo.institucion_id : null]
  );
  return { id, grupo_id: grupoId, institucion_id: grupo ? grupo.institucion_id : null };
}

// Inserta un mensaje del sistema en el chat del curso y lo emite en vivo.
async function publicarMensajeSistema(grupoId, { evento = null, texto, datos = null }) {
  if (!grupoId || !texto) return null;
  const conn = await pool.getConnection();
  try {
    const chat = await chatDeGrupo(conn, grupoId);
    const id = randomUUID();
    await conn.query(
      `INSERT INTO chat_mensajes (id, chat_id, remitente_id, origen, evento, texto, datos)
       VALUES (?, ?, NULL, 'sistema', ?, ?, ?)`,
      [id, chat.id, evento, texto, datos ? JSON.stringify(datos) : null]
    );

    const mensaje = {
      id,
      origen: 'sistema',
      evento,
      texto,
      datos,
      remitente_id: null,
      remitente_nombre: 'Sistema',
      created_at: new Date().toISOString(),
    };

    if (io) io.to(`curso:${grupoId}`).emit('chat-curso:mensaje', { grupo_id: grupoId, mensaje });
    return mensaje;
  } catch (err) {
    // El chat del curso NUNCA debe tumbar la operación principal
    // (crear tarea, iniciar llamada, etc.).
    console.error('publicarMensajeSistema (chat curso):', err.message);
    return null;
  } finally {
    conn.release();
  }
}

module.exports = { setIO, chatDeGrupo, publicarMensajeSistema };
