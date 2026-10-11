// ============================================================
//  matriculas.controller.js — MySQL
//  Matrícula de estudiantes en grupos, retiros y traslados.
//  Todo limitado a la institución del usuario autenticado
//  (via el join grupos -> grados -> institucion_id).
// ============================================================

const pool   = require('../config/db');
const bcrypt = require('bcrypt');
const jwt    = require('jsonwebtoken');
const { randomUUID } = require('crypto');

// Helper: ¿estos datos (documento + nombre completo) están bloqueados
// para este grupo específico? Ocurre cuando el director/admin eliminó
// antes a alguien que se registró con esos mismos datos por error.
async function _estaBloqueado(conn, grupoId, tipo_documento, numero_documento, nombres, apellidos) {
  const [rows] = await conn.query(
    `SELECT id FROM matriculas_bloqueadas
     WHERE grupo_id = ? AND tipo_documento = ? AND numero_documento = ?
       AND nombres = ? AND apellidos = ? LIMIT 1`,
    [grupoId, tipo_documento, numero_documento, nombres.trim(), apellidos.trim()]
  );
  return rows.length > 0;
}

function _emitirToken(usuario) {
  return jwt.sign(
    { id: usuario.id, email: usuario.email, rol: usuario.rol, institucion_id: usuario.institucion_id,
      jti: randomUUID(), ver: usuario.token_version || 0 },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );
}

// ────────────────────────────────────────────────────────────
//  POST /api/matriculas  (admin, superadmin)
//  body: { estudiante_id, grupo_id, anio_lectivo, observaciones? }
// ────────────────────────────────────────────────────────────
exports.matricular = async (req, res) => {
  const { estudiante_id, grupo_id, anio_lectivo, observaciones } = req.body;

  if (!estudiante_id || !grupo_id || !anio_lectivo) {
    return res.status(400).json({ ok: false, mensaje: 'estudiante_id, grupo_id y anio_lectivo son obligatorios.' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // El estudiante debe existir, tener rol 'estudiante' y ser de la misma institución
    const [estudiante] = await conn.query(
      `SELECT id FROM usuarios WHERE id = ? AND rol = 'estudiante' AND institucion_id = ?`,
      [estudiante_id, req.usuario.institucion_id]
    );
    if (!estudiante.length) {
      await conn.rollback();
      return res.status(404).json({ ok: false, mensaje: 'Estudiante no encontrado en tu institución.' });
    }

    // El grupo debe pertenecer a la institución del usuario, y traemos su capacidad
    const [grupo] = await conn.query(
      `SELECT g.id, g.capacidad_max
       FROM grupos g
       JOIN grados gr ON gr.id = g.grado_id
       WHERE g.id = ? AND gr.institucion_id = ? AND g.activo = TRUE`,
      [grupo_id, req.usuario.institucion_id]
    );
    if (!grupo.length) {
      await conn.rollback();
      return res.status(404).json({ ok: false, mensaje: 'Grupo no encontrado o inactivo en tu institución.' });
    }

    // Verificar cupo disponible (solo cuenta matrículas activas)
    const [[{ ocupados }]] = await conn.query(
      `SELECT COUNT(*) AS ocupados FROM matriculas WHERE grupo_id = ? AND estado = 'activa'`,
      [grupo_id]
    );
    if (ocupados >= grupo[0].capacidad_max) {
      await conn.rollback();
      return res.status(409).json({ ok: false, mensaje: 'El grupo ya alcanzó su capacidad máxima.' });
    }

    // Un estudiante solo puede tener UNA matrícula activa a la vez
    // (regla consistente con el flujo de matrícula por código).
    const [activaExistente] = await conn.query(
      `SELECT mt.id, g.nombre AS grupo
       FROM matriculas mt
       JOIN grupos g ON g.id = mt.grupo_id
       WHERE mt.estudiante_id = ? AND mt.estado = 'activa'
       LIMIT 1`,
      [estudiante_id]
    );
    if (activaExistente.length) {
      await conn.rollback();
      return res.status(409).json({
        ok: false,
        mensaje: `Este estudiante ya está activo en el grupo ${activaExistente[0].grupo}. Usa Trasladar o Retirar para cambiar su matrícula.`,
      });
    }

    const id = randomUUID();
    await conn.query(
      `INSERT INTO matriculas (id, estudiante_id, grupo_id, anio_lectivo, observaciones)
       VALUES (?, ?, ?, ?, ?)`,
      [id, estudiante_id, grupo_id, anio_lectivo, observaciones || null]
    );

    await conn.commit();
    return res.status(201).json({ ok: true, mensaje: 'Matrícula registrada.', id });

  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ ok: false, mensaje: 'Este estudiante ya está matriculado en ese grupo para ese año lectivo.' });
    }
    console.error('matricular:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  } finally {
    conn.release();
  }
};

// ────────────────────────────────────────────────────────────
//  GET /api/matriculas/grupo/:grupoId  (admin, superadmin, docente)
//  El docente solo puede consultar grupos donde dicta alguna materia.
// ────────────────────────────────────────────────────────────
exports.listarPorGrupo = async (req, res) => {
  const { grupoId } = req.params;

  try {
    if (req.usuario.rol === 'docente') {
      const [acceso] = await pool.query(
        `SELECT g.id FROM grupos g
         WHERE g.id = ? AND g.director_id = ?
         UNION
         SELECT grupo_id FROM docentes_materias WHERE grupo_id = ? AND docente_id = ?`,
        [grupoId, req.usuario.id, grupoId, req.usuario.id]
      );
      if (!acceso.length) {
        return res.status(403).json({ ok: false, mensaje: 'No diriges ni dictas ninguna materia en ese grupo.' });
      }
    }

    const [rows] = await pool.query(
      `SELECT mt.id AS matricula_id, mt.estado, mt.fecha_ingreso, mt.anio_lectivo,
              mt.codigo_confirmado,
              u.id AS estudiante_id, u.nombres, u.apellidos, u.tipo_documento, u.numero_documento, u.foto_url
       FROM matriculas mt
       JOIN usuarios u ON u.id = mt.estudiante_id
       JOIN grupos g ON g.id = mt.grupo_id
       JOIN grados gr ON gr.id = g.grado_id
       WHERE mt.grupo_id = ? AND mt.estado = 'activa' AND gr.institucion_id = ?
       ORDER BY u.apellidos, u.nombres`,
      [grupoId, req.usuario.institucion_id]
    );
    return res.json({ ok: true, total: rows.length, estudiantes: rows });
  } catch (err) {
    console.error('listarPorGrupo:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// ────────────────────────────────────────────────────────────
//  GET /api/matriculas/mis-hijos  (acudiente)
// ────────────────────────────────────────────────────────────
exports.misHijos = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT u.id AS estudiante_id, u.nombres, u.apellidos, ae.parentesco, ae.es_principal,
              mt.id AS matricula_id, mt.estado AS estado_matricula,
              g.nombre AS grupo, gr.nombre AS grado
       FROM acudientes_estudiantes ae
       JOIN usuarios u ON u.id = ae.estudiante_id
       LEFT JOIN matriculas mt ON mt.estudiante_id = u.id AND mt.estado = 'activa'
       LEFT JOIN grupos g ON g.id = mt.grupo_id
       LEFT JOIN grados gr ON gr.id = g.grado_id
       WHERE ae.acudiente_id = ?`,
      [req.usuario.id]
    );
    return res.json({ ok: true, hijos: rows });
  } catch (err) {
    console.error('misHijos:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// ────────────────────────────────────────────────────────────
//  GET /api/matriculas/estudiantes-buscar?q=...  (admin, superadmin)
//  Busca estudiantes de la institución (documento, nombres o
//  apellidos) para matricularlos desde el panel. Incluye si el
//  estudiante tiene una matrícula activa en este momento.
// ────────────────────────────────────────────────────────────
exports.buscarEstudiantes = async (req, res) => {
  const q = (req.query.q || '').trim();

  try {
    const [rows] = await pool.query(
      `SELECT u.id AS estudiante_id, u.nombres, u.apellidos,
              u.tipo_documento, u.numero_documento,
              mt.id AS matricula_id, mt.estado AS estado_matricula,
              g.nombre AS grupo, gr.nombre AS grado
       FROM usuarios u
       LEFT JOIN matriculas mt ON mt.estudiante_id = u.id AND mt.estado = 'activa'
       LEFT JOIN grupos g ON g.id = mt.grupo_id
       LEFT JOIN grados gr ON gr.id = g.grado_id
       WHERE u.rol = 'estudiante' AND u.institucion_id = ?
         AND (u.numero_documento LIKE ? OR u.nombres LIKE ? OR u.apellidos LIKE ?)
       ORDER BY u.apellidos, u.nombres
       LIMIT 30`,
      [req.usuario.institucion_id, `%${q}%`, `%${q}%`, `%${q}%`]
    );
    return res.json({ ok: true, total: rows.length, estudiantes: rows });
  } catch (err) {
    console.error('buscarEstudiantes:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// ────────────────────────────────────────────────────────────
//  GET /api/matriculas/estudiante/:estudianteId
//  admin/superadmin: cualquiera de su institución.
//  docente: solo si dicta materia en el grupo actual del estudiante.
//  acudiente: solo si es acudiente registrado de ese estudiante.
//  estudiante: solo su propio id.
// ────────────────────────────────────────────────────────────
exports.obtenerPorEstudiante = async (req, res) => {
  const { estudianteId } = req.params;
  const { rol, id: usuarioId } = req.usuario;

  try {
    if (rol === 'estudiante' && usuarioId !== estudianteId) {
      return res.status(403).json({ ok: false, mensaje: 'No puedes consultar la matrícula de otro estudiante.' });
    }

    if (rol === 'acudiente') {
      const [rel] = await pool.query(
        `SELECT 1 FROM acudientes_estudiantes WHERE acudiente_id = ? AND estudiante_id = ?`,
        [usuarioId, estudianteId]
      );
      if (!rel.length) {
        return res.status(403).json({ ok: false, mensaje: 'No eres acudiente registrado de este estudiante.' });
      }
    }

    const [rows] = await pool.query(
      `SELECT mt.id AS matricula_id, mt.estado, mt.anio_lectivo, mt.fecha_ingreso, mt.fecha_retiro,
              mt.codigo_confirmado,
              g.id AS grupo_id, g.nombre AS grupo, g.codigo_matricula, g.codigo_activo,
              gr.nombre AS grado
       FROM matriculas mt
       JOIN grupos g ON g.id = mt.grupo_id
       JOIN grados gr ON gr.id = g.grado_id
       WHERE mt.estudiante_id = ? AND mt.estado = 'activa'
       LIMIT 1`,
      [estudianteId]
    );

    if (!rows.length) {
      return res.json({ ok: true, matricula: null, mensaje: 'Este estudiante no tiene una matrícula activa.' });
    }

    // Bandera de conveniencia para el frontend: ¿el código con el
    // que se confirmó por última vez sigue siendo el vigente?
    rows[0].requiere_revalidacion =
      !!rows[0].codigo_confirmado &&
      rows[0].codigo_activo === 1 &&
      rows[0].codigo_confirmado !== rows[0].codigo_matricula;

    if (rol === 'docente') {
      const [dicta] = await pool.query(
        `SELECT id FROM docentes_materias WHERE grupo_id = ? AND docente_id = ?`,
        [rows[0].grupo_id, usuarioId]
      );
      if (!dicta.length) {
        return res.status(403).json({ ok: false, mensaje: 'No dictas ninguna materia en el grupo de este estudiante.' });
      }
    }

    return res.json({ ok: true, matricula: rows[0] });
  } catch (err) {
    console.error('obtenerPorEstudiante:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// ────────────────────────────────────────────────────────────
//  PUT /api/matriculas/:id/retirar  (admin, superadmin)
//  body: { observaciones? }
// ────────────────────────────────────────────────────────────
exports.retirar = async (req, res) => {
  const { id } = req.params;
  const { observaciones } = req.body;

  try {
    const [result] = await pool.query(
      `UPDATE matriculas mt
       JOIN grupos g ON g.id = mt.grupo_id
       JOIN grados gr ON gr.id = g.grado_id
       SET mt.estado = 'retirada',
           mt.fecha_retiro = CURRENT_DATE,
           mt.observaciones = COALESCE(?, mt.observaciones)
       WHERE mt.id = ? AND mt.estado = 'activa' AND gr.institucion_id = ?`,
      [observaciones, id, req.usuario.institucion_id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ ok: false, mensaje: 'Matrícula activa no encontrada.' });
    }
    return res.json({ ok: true, mensaje: 'Estudiante retirado.' });
  } catch (err) {
    console.error('retirar:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// ────────────────────────────────────────────────────────────
//  POST /api/matriculas/:id/trasladar  (admin, superadmin)
//  body: { nuevo_grupo_id }
//  Cierra la matrícula actual como 'trasladada' y crea una nueva
//  matrícula activa en el grupo destino, dentro de una transacción.
// ────────────────────────────────────────────────────────────
exports.trasladar = async (req, res) => {
  const { id } = req.params;
  const { nuevo_grupo_id } = req.body;

  if (!nuevo_grupo_id) {
    return res.status(400).json({ ok: false, mensaje: 'nuevo_grupo_id es obligatorio.' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [actual] = await conn.query(
      `SELECT mt.id, mt.estudiante_id, mt.anio_lectivo
       FROM matriculas mt
       JOIN grupos g ON g.id = mt.grupo_id
       JOIN grados gr ON gr.id = g.grado_id
       WHERE mt.id = ? AND mt.estado = 'activa' AND gr.institucion_id = ?
       FOR UPDATE`,
      [id, req.usuario.institucion_id]
    );
    if (!actual.length) {
      await conn.rollback();
      return res.status(404).json({ ok: false, mensaje: 'Matrícula activa no encontrada.' });
    }

    const [grupoDestino] = await conn.query(
      `SELECT g.id, g.capacidad_max
       FROM grupos g JOIN grados gr ON gr.id = g.grado_id
       WHERE g.id = ? AND gr.institucion_id = ? AND g.activo = TRUE`,
      [nuevo_grupo_id, req.usuario.institucion_id]
    );
    if (!grupoDestino.length) {
      await conn.rollback();
      return res.status(404).json({ ok: false, mensaje: 'Grupo destino no encontrado o inactivo.' });
    }

    const [[{ ocupados }]] = await conn.query(
      `SELECT COUNT(*) AS ocupados FROM matriculas WHERE grupo_id = ? AND estado = 'activa'`,
      [nuevo_grupo_id]
    );
    if (ocupados >= grupoDestino[0].capacidad_max) {
      await conn.rollback();
      return res.status(409).json({ ok: false, mensaje: 'El grupo destino ya alcanzó su capacidad máxima.' });
    }

    await conn.query(
      `UPDATE matriculas SET estado = 'trasladada', fecha_retiro = CURRENT_DATE WHERE id = ?`,
      [id]
    );

    const nuevaId = randomUUID();
    await conn.query(
      `INSERT INTO matriculas (id, estudiante_id, grupo_id, anio_lectivo)
       VALUES (?, ?, ?, ?)`,
      [nuevaId, actual[0].estudiante_id, nuevo_grupo_id, actual[0].anio_lectivo]
    );

    await conn.commit();
    return res.status(201).json({ ok: true, mensaje: 'Estudiante trasladado.', nueva_matricula_id: nuevaId });

  } catch (err) {
    await conn.rollback();
    console.error('trasladar:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  } finally {
    conn.release();
  }
};

// ────────────────────────────────────────────────────────────
//  POST /api/matriculas/unirse   (público, sin sesión)
//  Registro + matrícula instantánea con código de clase.
//  body: { tipo_documento, numero_documento, nombres, apellidos, codigo }
//
//  Un estudiante solo puede estar matriculado en UN curso a la
//  vez. Si el documento ya tiene cuenta CON contraseña, esta vía
//  queda cerrada: debe iniciar sesión y usar "Unirme a clase"
//  desde Mis clases (ver unirseAClase más abajo).
// ────────────────────────────────────────────────────────────
exports.unirseConCodigo = async (req, res) => {
  let { tipo_documento, numero_documento, nombres, apellidos, codigo } = req.body;

  if (!numero_documento || !nombres || !apellidos || !codigo) {
    return res.status(400).json({ ok: false, mensaje: 'Documento, nombres, apellidos y código son obligatorios.' });
  }
  tipo_documento   = (tipo_documento || 'CC').trim().toUpperCase();
  numero_documento = numero_documento.trim();
  nombres          = nombres.trim();
  apellidos        = apellidos.trim();
  codigo           = codigo.trim().toUpperCase();

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 1) El código debe existir, estar activo, y el grupo activo.
    const [grupoRows] = await conn.query(
      `SELECT g.id AS grupo_id, g.capacidad_max, gr.institucion_id
       FROM grupos g
       JOIN grados gr ON gr.id = g.grado_id
       WHERE g.codigo_matricula = ? AND g.codigo_activo = TRUE AND g.activo = TRUE
       FOR UPDATE`,
      [codigo]
    );
    if (!grupoRows.length) {
      await conn.rollback();
      return res.status(404).json({ ok: false, mensaje: 'Ese código no existe o ya no está activo. Pídele uno vigente a tu director de curso.' });
    }
    const grupo = grupoRows[0];

    // 2) ¿Estos datos están bloqueados para este curso? (eliminado antes por error)
    if (await _estaBloqueado(conn, grupo.grupo_id, tipo_documento, numero_documento, nombres, apellidos)) {
      await conn.rollback();
      return res.status(403).json({ ok: false, mensaje: 'No puedes registrarte con estos datos en este curso. Contacta a tu director de curso.' });
    }

    // 3) ¿Ya existe una cuenta con este documento?
    const [existente] = await conn.query(
      `SELECT id, password_hash, nombres, apellidos, rol FROM usuarios
       WHERE tipo_documento = ? AND numero_documento = ? LIMIT 1`,
      [tipo_documento, numero_documento]
    );

    let estudianteId;

    if (existente.length) {
      const cuenta = existente[0];
      if (cuenta.rol !== 'estudiante') {
        await conn.rollback();
        return res.status(409).json({ ok: false, mensaje: 'Ya existe una cuenta con ese documento y no es de estudiante.' });
      }
      if (cuenta.password_hash) {
        await conn.rollback();
        return res.status(409).json({
          ok: false,
          mensaje: 'Ya tienes una cuenta creada. Inicia sesión con tu contraseña y usa "Unirme a clase" dentro de Mis clases para cambiar de curso.',
        });
      }
      // Cuenta a medias (se registró antes pero nunca definió
      // contraseña): se reutiliza y se le permite continuar.
      estudianteId = cuenta.id;

      const [matriculaPrevia] = await conn.query(
        `SELECT id FROM matriculas WHERE estudiante_id = ? AND estado = 'activa' LIMIT 1`,
        [estudianteId]
      );
      if (matriculaPrevia.length) {
        await conn.query(
          `UPDATE matriculas SET estado = 'retirada', fecha_retiro = CURRENT_DATE WHERE id = ?`,
          [matriculaPrevia[0].id]
        );
      }
    } else {
      // 4) Cupo del grupo (solo cuando se va a crear una matrícula nueva)
      const [[{ ocupados }]] = await conn.query(
        `SELECT COUNT(*) AS ocupados FROM matriculas WHERE grupo_id = ? AND estado = 'activa'`,
        [grupo.grupo_id]
      );
      if (ocupados >= grupo.capacidad_max) {
        await conn.rollback();
        return res.status(409).json({ ok: false, mensaje: 'Este curso ya alcanzó su capacidad máxima. Contacta a tu director de curso.' });
      }

      estudianteId = randomUUID();
      await conn.query(
        `INSERT INTO usuarios (id, institucion_id, rol, nombres, apellidos, tipo_documento, numero_documento, activo)
         VALUES (?, ?, 'estudiante', ?, ?, ?, ?, TRUE)`,
        [estudianteId, grupo.institucion_id, nombres, apellidos, tipo_documento, numero_documento]
      );
    }

    const matriculaId = randomUUID();
    await conn.query(
      `INSERT INTO matriculas (id, estudiante_id, grupo_id, anio_lectivo, codigo_confirmado)
       VALUES (?, ?, ?, ?, ?)`,
      [matriculaId, estudianteId, grupo.grupo_id, new Date().getFullYear(), codigo]
    );

    await conn.commit();

    const [rows] = await pool.query(
      `SELECT u.id, u.nombres, u.apellidos, u.email, u.rol, u.institucion_id, u.token_version, i.nombre AS institucion_nombre
       FROM usuarios u LEFT JOIN instituciones i ON i.id = u.institucion_id
       WHERE u.id = ?`,
      [estudianteId]
    );
    const usuario = rows[0];
    const token = _emitirToken(usuario);

    return res.status(201).json({
      ok: true,
      mensaje: 'Quedaste inscrito. Ahora crea tu contraseña para poder entrar la próxima vez.',
      token,
      usuario: {
        id: usuario.id, nombres: usuario.nombres, apellidos: usuario.apellidos,
        email: usuario.email, rol: usuario.rol,
        institucion_id: usuario.institucion_id, institucion_nombre: usuario.institucion_nombre || null,
      },
    });
  } catch (err) {
    await conn.rollback();
    console.error('unirseConCodigo:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  } finally {
    conn.release();
  }
};

// ────────────────────────────────────────────────────────────
//  POST /api/matriculas/unirse-clase   (auth, rol estudiante)
//  Para un estudiante que YA tiene cuenta y contraseña, y que
//  actualmente NO tiene curso activo (lo retiraron para poder
//  cambiarlo). Se usa desde "Mis clases" con solo el código.
//  body: { codigo }
// ────────────────────────────────────────────────────────────
exports.unirseAClase = async (req, res) => {
  let { codigo } = req.body;
  if (!codigo) {
    return res.status(400).json({ ok: false, mensaje: 'El código es obligatorio.' });
  }
  codigo = codigo.trim().toUpperCase();

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [estRows] = await conn.query(
      `SELECT tipo_documento, numero_documento, nombres, apellidos, institucion_id
       FROM usuarios WHERE id = ? FOR UPDATE`,
      [req.usuario.id]
    );
    const estudiante = estRows[0];

    const [activaRows] = await conn.query(
      `SELECT id FROM matriculas WHERE estudiante_id = ? AND estado = 'activa' LIMIT 1`,
      [req.usuario.id]
    );
    if (activaRows.length) {
      await conn.rollback();
      return res.status(409).json({ ok: false, mensaje: 'Ya tienes un curso activo. Debes salir de tu curso actual antes de unirte a uno nuevo.' });
    }

    const [grupoRows] = await conn.query(
      `SELECT g.id AS grupo_id, g.capacidad_max, gr.institucion_id
       FROM grupos g
       JOIN grados gr ON gr.id = g.grado_id
       WHERE g.codigo_matricula = ? AND g.codigo_activo = TRUE AND g.activo = TRUE
       FOR UPDATE`,
      [codigo]
    );
    if (!grupoRows.length) {
      await conn.rollback();
      return res.status(404).json({ ok: false, mensaje: 'Ese código no existe o ya no está activo.' });
    }
    const grupo = grupoRows[0];

    if (grupo.institucion_id !== estudiante.institucion_id) {
      await conn.rollback();
      return res.status(403).json({ ok: false, mensaje: 'Ese código pertenece a otra institución.' });
    }

    if (await _estaBloqueado(conn, grupo.grupo_id, estudiante.tipo_documento, estudiante.numero_documento, estudiante.nombres, estudiante.apellidos)) {
      await conn.rollback();
      return res.status(403).json({ ok: false, mensaje: 'No puedes unirte a este curso con tus datos actuales. Contacta a tu director de curso.' });
    }

    const [[{ ocupados }]] = await conn.query(
      `SELECT COUNT(*) AS ocupados FROM matriculas WHERE grupo_id = ? AND estado = 'activa'`,
      [grupo.grupo_id]
    );
    if (ocupados >= grupo.capacidad_max) {
      await conn.rollback();
      return res.status(409).json({ ok: false, mensaje: 'Ese curso ya alcanzó su capacidad máxima.' });
    }

    const matriculaId = randomUUID();
    await conn.query(
      `INSERT INTO matriculas (id, estudiante_id, grupo_id, anio_lectivo, codigo_confirmado)
       VALUES (?, ?, ?, ?, ?)`,
      [matriculaId, req.usuario.id, grupo.grupo_id, new Date().getFullYear(), codigo]
    );

    await conn.commit();
    return res.status(201).json({ ok: true, mensaje: 'Te uniste al curso correctamente.', matricula_id: matriculaId });
  } catch (err) {
    await conn.rollback();
    console.error('unirseAClase:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  } finally {
    conn.release();
  }
};

// ────────────────────────────────────────────────────────────
//  POST /api/matriculas/:id/revalidar   (auth, rol estudiante)
//  El director regeneró el código del curso: el estudiante debe
//  volver a digitarlo para confirmar que sigue siendo él. No
//  crea ni borra nada, solo actualiza codigo_confirmado.
//  body: { codigo }
// ────────────────────────────────────────────────────────────
exports.revalidarCodigo = async (req, res) => {
  const { id } = req.params;
  let { codigo } = req.body;
  if (!codigo) {
    return res.status(400).json({ ok: false, mensaje: 'El código es obligatorio.' });
  }
  codigo = codigo.trim().toUpperCase();

  try {
    const [rows] = await pool.query(
      `SELECT mt.id, g.codigo_matricula, g.codigo_activo
       FROM matriculas mt
       JOIN grupos g ON g.id = mt.grupo_id
       WHERE mt.id = ? AND mt.estudiante_id = ? AND mt.estado = 'activa' LIMIT 1`,
      [id, req.usuario.id]
    );
    if (!rows.length) {
      return res.status(404).json({ ok: false, mensaje: 'Matrícula no encontrada.' });
    }
    const mt = rows[0];
    if (!mt.codigo_activo) {
      return res.status(400).json({ ok: false, mensaje: 'Este curso no tiene un código activo en este momento.' });
    }
    if (codigo !== mt.codigo_matricula) {
      return res.status(400).json({ ok: false, mensaje: 'El código no coincide con el código actual del curso.' });
    }

    await pool.query(`UPDATE matriculas SET codigo_confirmado = ? WHERE id = ?`, [codigo, id]);
    return res.json({ ok: true, mensaje: 'Código confirmado.' });
  } catch (err) {
    console.error('revalidarCodigo:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};

// ────────────────────────────────────────────────────────────
//  DELETE /api/matriculas/:id/eliminar-estudiante
//  (admin, superadmin, docente-director del grupo)
//  Para cuando el estudiante se registró con datos que no
//  coinciden con la realidad. Borra la cuenta completa (no solo
//  la matrícula) y bloquea esos datos para ese curso específico,
//  para que no se puedan volver a usar en el formulario público.
//  body: { motivo? }
// ────────────────────────────────────────────────────────────
exports.eliminarEstudiante = async (req, res) => {
  const { id } = req.params; // id de la matrícula
  const { motivo } = req.body;
  const { rol, id: usuarioId, institucion_id: institucionId } = req.usuario;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      `SELECT mt.id AS matricula_id, mt.grupo_id,
              u.id AS estudiante_id, u.tipo_documento, u.numero_documento, u.nombres, u.apellidos,
              g.director_id, gr.institucion_id
       FROM matriculas mt
       JOIN usuarios u ON u.id = mt.estudiante_id
       JOIN grupos g ON g.id = mt.grupo_id
       JOIN grados gr ON gr.id = g.grado_id
       WHERE mt.id = ? AND mt.estado = 'activa'
       FOR UPDATE`,
      [id]
    );
    if (!rows.length) {
      await conn.rollback();
      return res.status(404).json({ ok: false, mensaje: 'Matrícula no encontrada.' });
    }
    const info = rows[0];

    if (info.institucion_id !== institucionId) {
      await conn.rollback();
      return res.status(404).json({ ok: false, mensaje: 'Matrícula no encontrada.' });
    }
    if (rol === 'docente' && info.director_id !== usuarioId) {
      await conn.rollback();
      return res.status(403).json({ ok: false, mensaje: 'No eres el director de este curso.' });
    }

    await conn.query(
      `INSERT INTO matriculas_bloqueadas (grupo_id, tipo_documento, numero_documento, nombres, apellidos, motivo, bloqueado_por)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [info.grupo_id, info.tipo_documento, info.numero_documento, info.nombres, info.apellidos, motivo || null, usuarioId]
    );

    // Elimina la cuenta completa (la matrícula se va en cascada).
    await conn.query(`DELETE FROM usuarios WHERE id = ?`, [info.estudiante_id]);

    await conn.commit();
    return res.json({ ok: true, mensaje: 'Estudiante eliminado. No podrá volver a registrarse con esos datos en este curso.' });
  } catch (err) {
    await conn.rollback();
    console.error('eliminarEstudiante:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  } finally {
    conn.release();
  }
};
