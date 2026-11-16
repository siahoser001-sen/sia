// ============================================================
//  sockets/socket.js
//  Tiempo real para: aviso de llamada iniciada/finalizada y
//  sincronización del pizarrón (solo el docente puede dibujar).
//  Mensajería directa: chat:update, chat:mensaje-eliminado y
//  chat:mensaje-oculto se emiten a la sala `usuario:{id}`.
// ============================================================

const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');
const pool = require('../config/db');
const { estaRevocado } = require('../utils/revocacion');
const {
  condicionMateriaEnGrupo,
  condicionDocenteEnGrupo,
  parametrosMateriaEnGrupo,
  parametrosDocenteEnGrupo,
} = require('../utils/materias-curso.util');
const { setSocketIO } = require('../services/notificacion.service');
const { setIO: setIOChatCurso } = require('../services/chat-curso.service');

const colasPizarron = new Map();
// El pizarrón del curso que dirige el docente se maneja como una
// "materia" más dentro de la misma pareja (grupo, materia). El curso
// usa siempre el id 0 (nunca NULL) para no chocar con una materia real.
const MATERIA_CURSO = '0';
// Fuentes permitidas para las cajas de texto del pizarrón.
const FUENTES_CAJA = new Set([
  'Arial',
  'Georgia',
  'Courier New',
  'Comic Sans MS',
  'Verdana',
  'Times New Roman',
]);

function initSockets(io) {
  // Da acceso al io al servicio de notificaciones para avisar a cada
  // usuario en vivo cuando le llega una notificación (punto 4).
  setSocketIO(io);
  // Igual para el chat del curso (Ronda F, F5): el sistema publica ahí
  // creación/cierre de actividades, notas y videollamadas.
  setIOChatCurso(io);
  // Autenticación en el handshake: el cliente debe mandar el JWT
  // en socket.handshake.auth.token (mismo token del login). Además
  // del verify, se rechaza si la sesión fue revocada (logout o
  // cambio de contraseña), igual que en authMiddleware.
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Token no proporcionado.'));

    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return next(new Error('Token inválido o expirado.'));
    }

    if (estaRevocado(payload.jti)) {
      return next(new Error('Sesión revocada.'));
    }

    try {
      const [rows] = await pool.query(`SELECT token_version FROM usuarios WHERE id = ? LIMIT 1`, [payload.id]);
      if (!rows.length || (payload.ver || 0) !== (rows[0].token_version || 0)) {
        return next(new Error('Sesión revocada.'));
      }
    } catch (err) {
      console.error('socket auth error:', err.message);
      return next(new Error('No se pudo validar la sesión.'));
    }

    socket.usuario = payload;
    next();
  });

  io.on('connection', (socket) => {
    const { id: usuarioId, rol } = socket.usuario;

    // Cada usuario se une a su sala personal. Así el backend puede
    // notificarle en vivo (ej. "notificaciones:update") sin recargar.
    socket.join(`usuario:${usuarioId}`);

    // ── Chat del curso (Ronda F, F5): unión automática a la sala
    //    `curso:{grupoId}` de cada curso al que el usuario pertenece
    //    (docentes y directores, estudiantes matriculados, acudientes
    //    y admin de la institución). La autorización fina para ENVIAR
    //    se revalida en el endpoint (nunca se confía en el socket).
    unirseAChatsDeCurso(socket, usuarioId, rol).catch(err =>
      console.error('unirseAChatsDeCurso:', err.message)
    );

    // ── Unirse a la sala de una materia (avisos de llamada) ────
    //  El pizarrón ya no usa esta sala; se conserva para que los
    //  estudiantes reciban llamada-iniciada / llamada-finalizada.
    socket.on('unirse-materia', async ({ docente_materia_id } = {}) => {
      const materiaId = normalizarId(docente_materia_id);
      if (!materiaId) return;

      const autorizado = await verificarAccesoMateria(materiaId, usuarioId, rol);
      if (!autorizado) {
        socket.emit('error-autorizacion', { mensaje: 'No tienes acceso a esta materia.' });
        return;
      }

      socket.join(`materia:${materiaId}`);
    });

    // ── Unirse al pizarrón de una pareja (grupo, materia) ──────
    //  `materia_id` es el docente_materia_id de la materia o la palabra
    //  "curso" para el pizarrón del curso que dirige el docente. Cada
    //  pareja tiene su propia sala y su propio contenido guardado.
    socket.on('unirse-pizarron', async ({ grupo_id, materia_id } = {}) => {
      const grupoId = normalizarId(grupo_id);
      const materia = parsearMateria(materia_id);
      if (!grupoId || !materia) {
        socket.emit('error-autorizacion', { mensaje: 'El pizarrón solicitado no es válido.' });
        return;
      }

      const acceso = await verificarAccesoPizarron(
        grupoId,
        materia.docenteMateriaId,
        usuarioId,
        rol
      );
      if (!acceso) {
        socket.emit('error-autorizacion', { mensaje: 'No tienes acceso a este pizarrón.' });
        return;
      }

      socket.data.rol = rol;
      socket.data.puedeDibujar = acceso.puedeDibujar;
      await unirseAlPizarron(socket, {
        grupo_id: grupoId,
        materia_id: materia.materiaId,
        docente_materia_id: materia.docenteMateriaId,
      });
    });

    // ── Pizarrón: validar permiso y persistir antes de difundir. ──
    socket.on('pizarron:trazo', async (payload, responder) => {
      if (!socket.data.puedeDibujar) {
        return responderSocket(responder, false, 'No tienes permiso para modificar este pizarrón.');
      }
      const contexto = contextoPizarron(socket.data);
      const sala = salaPizarron(socket.data);
      const trazo = normalizarTrazo(payload);
      if (!contexto || !sala || !trazo) {
        return responderSocket(responder, false, 'El trazo no es válido.');
      }

      try {
        await encolarOperacionPizarron(sala, async () => {
          const id = randomUUID();
          await pool.query(
            `INSERT INTO pizarron_trazos
              (id, sesion_clase_id, docente_materia_id, grupo_id, docente_id, datos_trazo)
             VALUES (?, NULL, ?, ?, ?, ?)`,
            [
              id,
              contexto.docente_materia_id,
              contexto.grupo_id,
              usuarioId,
              JSON.stringify(trazo),
            ]
          );
          socket.to(sala).emit('pizarron:trazo', { id, trazo });
          responderSocket(responder, true, null, { id });
        });
      } catch (err) {
        console.error('Guardar trazo de pizarrón:', err.message);
        socket.emit('pizarron:error', { mensaje: 'No se pudo guardar el cambio en el pizarrón.' });
        responderSocket(responder, false, 'No se pudo guardar el cambio.');
      }
    });

    // ── Pizarrón: cajas de texto editables. El cliente manda el objeto
    //    completo; si el id ya pertenece a este pizarrón se actualiza,
    //    si es nuevo se inserta. Solo publica a los demás conectados.
    socket.on('pizarron:caja', async (payload, responder) => {
      if (!socket.data.puedeDibujar) {
        return responderSocket(responder, false, 'No tienes permiso para modificar este pizarrón.');
      }
      const contexto = contextoPizarron(socket.data);
      const sala = salaPizarron(socket.data);
      const caja = normalizarCaja(payload);
      if (!contexto || !sala || !caja) {
        return responderSocket(responder, false, 'La caja de texto no es válida.');
      }

      try {
        await encolarOperacionPizarron(sala, async () => {
          const [propias] = await pool.query(
            `SELECT id FROM pizarron_trazos
              WHERE id = ? AND ${contexto.filtro}
              LIMIT 1`,
            [caja.id, ...contexto.parametros]
          );

          if (propias.length) {
            await pool.query(
              `UPDATE pizarron_trazos
                  SET datos_trazo = ?
                WHERE id = ? AND ${contexto.filtro}`,
              [JSON.stringify(caja.datos), caja.id, ...contexto.parametros]
            );
          } else {
            // Un id ya usado en otro pizarrón no se puede reutilizar.
            const [ajenas] = await pool.query(
              `SELECT id FROM pizarron_trazos WHERE id = ? LIMIT 1`,
              [caja.id]
            );
            if (ajenas.length) {
              throw new Error('La caja pertenece a otro pizarrón.');
            }
            await pool.query(
              `INSERT INTO pizarron_trazos
                (id, sesion_clase_id, docente_materia_id, grupo_id, docente_id, datos_trazo)
               VALUES (?, NULL, ?, ?, ?, ?)`,
              [
                caja.id,
                contexto.docente_materia_id,
                contexto.grupo_id,
                usuarioId,
                JSON.stringify(caja.datos),
              ]
            );
          }

          socket.to(sala).emit('pizarron:caja', { caja: caja.datos });
          responderSocket(responder, true, null, { id: caja.id });
        });
      } catch (err) {
        console.error('Guardar caja de pizarrón:', err.message);
        socket.emit('pizarron:error', { mensaje: 'No se pudo guardar la caja de texto.' });
        responderSocket(responder, false, 'No se pudo guardar la caja de texto.');
      }
    });

    socket.on('pizarron:caja-borrar', async (payload, responder) => {
      if (!socket.data.puedeDibujar) {
        return responderSocket(responder, false, 'No tienes permiso para modificar este pizarrón.');
      }
      const contexto = contextoPizarron(socket.data);
      const sala = salaPizarron(socket.data);
      const id = normalizarUuid(payload?.id);
      if (!contexto || !sala || !id) {
        return responderSocket(responder, false, 'La caja de texto no es válida.');
      }

      try {
        await encolarOperacionPizarron(sala, async () => {
          await pool.query(
            `DELETE FROM pizarron_trazos WHERE id = ? AND ${contexto.filtro}`,
            [id, ...contexto.parametros]
          );
          socket.to(sala).emit('pizarron:caja-borrar', { id });
          responderSocket(responder, true);
        });
      } catch (err) {
        console.error('Borrar caja de pizarrón:', err.message);
        socket.emit('pizarron:error', { mensaje: 'No se pudo borrar la caja de texto.' });
        responderSocket(responder, false, 'No se pudo borrar la caja de texto.');
      }
    });

    socket.on('pizarron:limpiar', async (_payload, responder) => {
      if (!socket.data.puedeDibujar) {
        return responderSocket(responder, false, 'No tienes permiso para borrar este pizarrón.');
      }
      const contexto = contextoPizarron(socket.data);
      const sala = salaPizarron(socket.data);
      if (!contexto || !sala) {
        return responderSocket(responder, false, 'No hay un pizarrón seleccionado.');
      }

      try {
        await encolarOperacionPizarron(sala, async () => {
          await pool.query(
            `DELETE FROM pizarron_trazos WHERE ${contexto.filtro}`,
            contexto.parametros
          );
          socket.to(sala).emit('pizarron:limpiar');
          responderSocket(responder, true);
        });
      } catch (err) {
        console.error('Borrar pizarrón:', err.message);
        socket.emit('pizarron:error', { mensaje: 'No se pudo borrar el pizarrón.' });
        responderSocket(responder, false, 'No se pudo borrar el pizarrón.');
      }
    });

    socket.on('disconnect', () => {
      // No se requiere limpieza manual: socket.io libera las salas solo.
    });
  });
}

// Une el socket a las salas `curso:{grupoId}` que le corresponden según
// su rol (Ronda F, F5). Solo define QUÉ salas escucha; la autorización
// para enviar se valida siempre en el endpoint HTTP.
async function unirseAChatsDeCurso(socket, usuarioId, rol) {
  let rows = [];
  if (rol === 'admin' || rol === 'superadmin') {
    [rows] = await pool.query(
      `SELECT g.id FROM grupos g
        JOIN grados gr ON gr.id = g.grado_id
       WHERE gr.institucion_id = ? AND g.activo = TRUE`,
      [socket.usuario.institucion_id]
    );
  } else if (rol === 'docente') {
    [rows] = await pool.query(
      `SELECT DISTINCT g.id FROM grupos g
        LEFT JOIN docentes_materias dm ON dm.grupo_id = g.id
       WHERE g.activo = TRUE
         AND (g.director_id = ? OR dm.docente_id = ?)`,
      [usuarioId, usuarioId]
    );
  } else if (rol === 'estudiante') {
    [rows] = await pool.query(
      `SELECT grupo_id AS id FROM matriculas
        WHERE estudiante_id = ? AND estado = 'activa'`,
      [usuarioId]
    );
  } else if (rol === 'acudiente') {
    [rows] = await pool.query(
      `SELECT DISTINCT mt.grupo_id AS id
         FROM acudientes_estudiantes ae
         JOIN matriculas mt ON mt.estudiante_id = ae.estudiante_id
        WHERE ae.acudiente_id = ? AND mt.estado = 'activa'`,
      [usuarioId]
    );
  }
  for (const r of rows) socket.join(`curso:${r.id}`);
}

function normalizarId(valor) {
  // Los ids de la base son CHAR(36) con formato UUID (no enteros).
  if (typeof valor === 'string') {
    const texto = valor.trim();
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(texto)) {
      return texto;
    }
  }
  // Compatibilidad con flujos que todavía envían ids numéricos.
  const numero = Number(valor);
  return Number.isInteger(numero) && numero > 0 ? numero : null;
}

// `materia_id` identifica la materia dentro del grupo: 0 es el pizarrón
// del curso que dirige el docente y un UUID es una materia concreta.
// "curso" se acepta solo como valor antiguo y se normaliza a 0.
// Devuelve null si el valor no es válido.
function parsearMateria(valor) {
  if (
    valor === undefined ||
    valor === null ||
    valor === '' ||
    valor === 0 ||
    valor === MATERIA_CURSO ||
    valor === 'curso'
  ) {
    return { materiaId: MATERIA_CURSO, docenteMateriaId: null };
  }
  const docenteMateriaId = normalizarId(valor);
  return docenteMateriaId
    ? { materiaId: String(docenteMateriaId), docenteMateriaId }
    : null;
}

// Cada pizarrón es una pareja (materia, curso), con ids en ese orden.
function salaPizarron(data) {
  if (!data.grupo_id) return null;
  const materia = String(data.materia_id ?? data.docente_materia_id ?? MATERIA_CURSO);
  return `pizarron:${materia}:${data.grupo_id}`;
}

function contextoPizarron(data) {
  if (!data.grupo_id) return null;
  const materiaId = String(data.materia_id ?? data.docente_materia_id ?? MATERIA_CURSO);
  return {
    grupo_id: data.grupo_id,
    materia_id: materiaId,
    docente_materia_id: materiaId === MATERIA_CURSO ? null : materiaId,
    // Se usa la pareja completa (grupo_id, materia_id); el curso se
    // guarda como 0 aunque la columna heredada use NULL para el curso.
    filtro: "grupo_id = ? AND COALESCE(docente_materia_id, '0') = ?",
    parametros: [data.grupo_id, materiaId],
  };
}

async function unirseAlPizarron(socket, contexto) {
  const sala = salaPizarron(contexto);
  const datos = contextoPizarron(contexto);
  if (!sala || !datos) return;

  const salaAnterior = salaPizarron(socket.data);
  if (salaAnterior && salaAnterior !== sala) socket.leave(salaAnterior);
  socket.data.grupo_id = contexto.grupo_id;
  socket.data.materia_id = String(contexto.materia_id ?? MATERIA_CURSO);
  socket.data.docente_materia_id = contexto.docente_materia_id ?? null;
  socket.join(sala);

  try {
    const trazos = await encolarOperacionPizarron(sala, async () => {
      const [rows] = await pool.query(
        `SELECT id, orden, datos_trazo
           FROM pizarron_trazos
          WHERE ${datos.filtro}
          ORDER BY orden ASC`,
        datos.parametros
      );
      return rows;
    });
    socket.emit('pizarron:carga', {
      trazos,
      puede_dibujar: Boolean(socket.data.puedeDibujar),
      grupo_id: contexto.grupo_id,
      materia_id: contexto.materia_id ?? MATERIA_CURSO,
      docente_materia_id: contexto.docente_materia_id ?? null,
    });
  } catch (err) {
    console.error('Cargar pizarrón:', err.message);
    socket.emit('pizarron:error', { mensaje: 'No se pudo cargar el pizarrón guardado.' });
  }
}

function encolarOperacionPizarron(sala, operacion) {
  const anterior = colasPizarron.get(sala) || Promise.resolve();
  const siguiente = anterior.catch(() => undefined).then(operacion);
  colasPizarron.set(sala, siguiente);
  siguiente.then(
    () => {
      if (colasPizarron.get(sala) === siguiente) colasPizarron.delete(sala);
    },
    () => {
      if (colasPizarron.get(sala) === siguiente) colasPizarron.delete(sala);
    }
  );
  return siguiente;
}

function responderSocket(responder, ok, mensaje, extra = {}) {
  if (typeof responder === 'function') {
    responder({ ok, ...(mensaje ? { mensaje } : {}), ...extra });
  }
}

function normalizarUuid(valor) {
  if (typeof valor !== 'string') return null;
  const id = valor.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    ? id
    : null;
}

function numeroPizarron(valor) {
  return typeof valor === 'number' && Number.isFinite(valor) && Math.abs(valor) <= 10000;
}

// Normaliza una caja de texto editable. El objeto guardado en
// datos_trazo conserva todos los campos que usa el cliente.
function normalizarCaja(payload) {
  const caja = payload?.caja ?? payload;
  if (!caja || typeof caja !== 'object' || Array.isArray(caja)) return null;

  const id = normalizarUuid(caja.id);
  if (!id) return null;
  if (typeof caja.texto !== 'string' || caja.texto.length > 4000) return null;
  if (
    !numeroPizarron(caja.x)
    || !numeroPizarron(caja.y)
    || !numeroPizarron(caja.ancho)
    || !numeroPizarron(caja.tamaño)
  ) return null;
  if (caja.ancho < 120 || caja.ancho > 10000) return null;
  if (caja.tamaño < 12 || caja.tamaño > 72) return null;
  if (!/^#[0-9a-f]{6}$/i.test(caja.color || '')) return null;

  return {
    id,
    datos: {
      tipo: 'caja',
      id,
      texto: caja.texto,
      x: Math.round(caja.x),
      y: Math.round(caja.y),
      ancho: Math.round(caja.ancho),
      fuente: FUENTES_CAJA.has(caja.fuente) ? caja.fuente : 'Arial',
      tamaño: Math.round(caja.tamaño),
      negrita: caja.negrita === true,
      cursiva: caja.cursiva === true,
      color: caja.color.toLowerCase(),
    },
  };
}

function normalizarTrazo(trazo) {
  if (!trazo || typeof trazo !== 'object' || Array.isArray(trazo)) return null;
  if (!/^#[0-9a-f]{6}$/i.test(trazo.color || '')) return null;

  if (trazo.tipo === 'texto') {
    if (typeof trazo.texto !== 'string' || !trazo.texto.trim() || trazo.texto.length > 4000) return null;
    if (
      typeof trazo.x !== 'number' || !Number.isFinite(trazo.x) || Math.abs(trazo.x) > 10000
      || typeof trazo.y !== 'number' || !Number.isFinite(trazo.y) || Math.abs(trazo.y) > 10000
    ) return null;
    return { tipo: 'texto', texto: trazo.texto, x: trazo.x, y: trazo.y, color: trazo.color };
  }

  if (!Array.isArray(trazo.points) || trazo.points.length < 2 || trazo.points.length > 1024) return null;
  const points = trazo.points.map((point) => {
    if (
      !point
      || typeof point.x !== 'number' || !Number.isFinite(point.x) || Math.abs(point.x) > 10000
      || typeof point.y !== 'number' || !Number.isFinite(point.y) || Math.abs(point.y) > 10000
    ) return null;
    return { x: point.x, y: point.y };
  });
  if (points.includes(null)) return null;
  const width = trazo.width;
  if (typeof width !== 'number' || !Number.isFinite(width) || width < 1 || width > 50) return null;
  const herramienta = trazo.herramienta === 'borrador' ? 'borrador' : 'lapiz';
  return { tipo: 'trazo', herramienta, points, color: trazo.color, width };
}

// Autoriza la sala de avisos de una materia (llamadas). Mantiene la
// misma regla de negocio que el middleware HTTP: docente dueño de la
// materia o estudiante matriculado en su curso.
async function verificarAccesoMateria(docenteMateriaId, usuarioId, rol) {
  try {
    if (rol === 'docente') {
      const [rows] = await pool.query(
        `SELECT id FROM docentes_materias WHERE id = ? AND docente_id = ?`,
        [docenteMateriaId, usuarioId]
      );
      return rows.length > 0;
    }
    if (rol === 'estudiante') {
      const [rows] = await pool.query(
        `SELECT dm.id
         FROM docentes_materias dm
         JOIN materias m ON m.id = dm.materia_id
         JOIN matriculas mt ON mt.estudiante_id = ? AND mt.estado = 'activa'
         WHERE dm.id = ? AND m.activa = TRUE
           AND ${condicionDocenteEnGrupo('dm', 'm', 'mt.grupo_id')}
           AND ${condicionMateriaEnGrupo('m', 'mt.grupo_id')}`,
        [usuarioId, docenteMateriaId]
      );
      return rows.length > 0;
    }
    return rol === 'admin' || rol === 'superadmin';
  } catch (err) {
    console.error('verificarAccesoMateria (socket) error:', err.message);
    return false;
  }
}

// Autoriza el acceso a la pareja (grupo, materia) y decide quién dibuja.
//  - admin/superadmin: espectadores.
//  - docente: dibuja si dirige el grupo (cualquier materia del curso y el
//    pizarrón "curso") o si la materia está asignada a él en ese grupo.
//  - estudiante/acudiente del grupo: espectadores; si se pide una materia,
//    esta debe pertenecer al curso.
// Devuelve null si no tiene acceso.
async function verificarAccesoPizarron(grupoId, docenteMateriaId, usuarioId, rol) {
  try {
    if (rol === 'admin' || rol === 'superadmin') {
      return { puedeVer: true, puedeDibujar: false };
    }

    if (rol === 'docente') {
      const [grupos] = await pool.query(
        `SELECT (g.director_id = ?) AS es_director
           FROM grupos g
          WHERE g.id = ? AND g.activo = TRUE
          LIMIT 1`,
        [usuarioId, grupoId]
      );
      if (!grupos.length) return null;

      if (docenteMateriaId) {
        const [materias] = await pool.query(
          `SELECT dm.id
             FROM docentes_materias dm
             JOIN materias m ON m.id = dm.materia_id
            WHERE dm.id = ? AND m.activa = TRUE
              AND ${condicionDocenteEnGrupo('dm', 'm', '?')}`,
          [docenteMateriaId, ...parametrosDocenteEnGrupo(grupoId)]
        );
        if (!materias.length) return null;
      }

      // es_director puede venir como 1/0 o true/false según el driver.
      if (grupos[0].es_director) {
        return { puedeVer: true, puedeDibujar: true };
      }
      if (!docenteMateriaId) return null;

      const [asignadas] = await pool.query(
        `SELECT dm.id
           FROM docentes_materias dm
           JOIN materias m ON m.id = dm.materia_id
          WHERE dm.id = ? AND dm.docente_id = ? AND m.activa = TRUE
            AND ${condicionDocenteEnGrupo('dm', 'm', '?')}`,
        [docenteMateriaId, usuarioId, ...parametrosDocenteEnGrupo(grupoId)]
      );
      return asignadas.length ? { puedeVer: true, puedeDibujar: true } : null;
    }

    if (rol === 'estudiante') {
      const [matriculas] = await pool.query(
        `SELECT id FROM matriculas
          WHERE grupo_id = ? AND estudiante_id = ? AND estado = 'activa'
          LIMIT 1`,
        [grupoId, usuarioId]
      );
      if (!matriculas.length) return null;
      if (docenteMateriaId && !(await materiaDelCurso(docenteMateriaId, grupoId))) return null;
      return { puedeVer: true, puedeDibujar: false };
    }

    if (rol === 'acudiente') {
      const [matriculas] = await pool.query(
        `SELECT mt.id
           FROM acudientes_estudiantes ae
           JOIN matriculas mt ON mt.estudiante_id = ae.estudiante_id
          WHERE mt.grupo_id = ? AND ae.acudiente_id = ? AND mt.estado = 'activa'
          LIMIT 1`,
        [grupoId, usuarioId]
      );
      if (!matriculas.length) return null;
      if (docenteMateriaId && !(await materiaDelCurso(docenteMateriaId, grupoId))) return null;
      return { puedeVer: true, puedeDibujar: false };
    }

    return null;
  } catch (err) {
    console.error('verificarAccesoPizarron (socket) error:', err.message);
    return null;
  }
}

// Verifica que una asignación (docente_materias) pertenezca al curso.
async function materiaDelCurso(docenteMateriaId, grupoId) {
  const [rows] = await pool.query(
    `SELECT dm.id
       FROM docentes_materias dm
       JOIN materias m ON m.id = dm.materia_id
      WHERE dm.id = ? AND m.activa = TRUE
        AND ${condicionDocenteEnGrupo('dm', 'm', '?')}
        AND ${condicionMateriaEnGrupo('m', '?')}`,
    [
      docenteMateriaId,
      ...parametrosDocenteEnGrupo(grupoId),
      ...parametrosMateriaEnGrupo(grupoId),
    ]
  );
  return rows.length > 0;
}

module.exports = { initSockets };
