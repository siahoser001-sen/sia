// ============================================================
//  auth.controller.js — MySQL
//  Diferencia vs PostgreSQL:
//    - pool.query devuelve [rows] → desestructuramos como const [rows]
//    - Parámetros con ? en lugar de $1
// ============================================================

const pool   = require('../config/db');
const bcrypt = require('bcrypt');
const jwt    = require('jsonwebtoken');

exports.login = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ ok: false, mensaje: 'Correo y contraseña obligatorios.' });
  }

  try {
    // MySQL devuelve [rows, fields] — tomamos solo rows
    const [rows] = await pool.query(
      `SELECT id, nombres, apellidos, email, rol,
              password_hash, institucion_id, activo
       FROM usuarios
       WHERE email = ?
       LIMIT 1`,
      [email.toLowerCase().trim()]
    );

    const usuario = rows[0];

    if (!usuario || !(await bcrypt.compare(password, usuario.password_hash))) {
      return res.status(401).json({ ok: false, mensaje: 'Correo o contraseña incorrectos.' });
    }

    if (!usuario.activo) {
      return res.status(403).json({ ok: false, mensaje: 'Cuenta inactiva. Contacta al administrador.' });
    }

    await pool.query(
      `UPDATE usuarios SET ultimo_acceso = NOW() WHERE id = ?`,
      [usuario.id]
    );

    const token = jwt.sign(
      { id: usuario.id, email: usuario.email, rol: usuario.rol, institucion_id: usuario.institucion_id },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );

    return res.json({
      ok: true,
      token,
      usuario: {
        id:             usuario.id,
        nombres:        usuario.nombres,
        apellidos:      usuario.apellidos,
        email:          usuario.email,
        rol:            usuario.rol,
        institucion_id: usuario.institucion_id,
      },
    });

  } catch (err) {
    console.error('Login error:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor.' });
  }
};
