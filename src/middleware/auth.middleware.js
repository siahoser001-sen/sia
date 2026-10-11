const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { estaRevocado } = require('../utils/revocacion');

// Valida el JWT y, además, comprueba que la sesión no esté revocada:
//   - Si el `jti` está en la lista negra (se cerró sesión), el token ya
//     no sirve aunque no haya expirado.
//   - Si el `ver` del token no coincide con `usuarios.token_version`
//     actual, el token es viejo (el usuario cambió/recuperó la
//     contraseña y se invalidaron todas sus sesiones).
// Se hace una consulta indexada por PK (id) en cada request autenticado;
// para el tráfico de un colegio es despreciable y garantiza la
// revocación real en el servidor.
async function authMiddleware(req, res, next) {
  const header = req.headers['authorization'];
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ ok: false, mensaje: 'Token no proporcionado.' });
  }

  let payload;
  try {
    payload = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET);
  } catch (err) {
    const msg = err.name === 'TokenExpiredError'
      ? 'La sesión expiró. Inicia sesión nuevamente.'
      : 'Token inválido.';
    return res.status(401).json({ ok: false, mensaje: msg });
  }

  // Sesión revocada por logout (jti en lista negra).
  if (estaRevocado(payload.jti)) {
    return res.status(401).json({ ok: false, mensaje: 'La sesión terminó. Inicia sesión nuevamente.' });
  }

  try {
    // Sesión revocada por cambio/recuperación de contraseña (token_version).
    const [rows] = await pool.query(`SELECT token_version FROM usuarios WHERE id = ? LIMIT 1`, [payload.id]);
    if (!rows.length) {
      return res.status(401).json({ ok: false, mensaje: 'Token inválido.' });
    }
    if ((payload.ver || 0) !== (rows[0].token_version || 0)) {
      return res.status(401).json({ ok: false, mensaje: 'La sesión terminó. Inicia sesión nuevamente.' });
    }
  } catch (err) {
    console.error('authMiddleware error:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno del servidor.' });
  }

  req.usuario = payload;
  next();
}

function soloRoles(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.usuario?.rol)) {
      return res.status(403).json({ ok: false, mensaje: `Requiere rol: ${roles.join(' o ')}.` });
    }
    next();
  };
}

module.exports = { authMiddleware, soloRoles };
