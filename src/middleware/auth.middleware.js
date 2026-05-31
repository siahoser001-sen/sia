const jwt = require('jsonwebtoken');

// Verifica que el token JWT sea válido
function authMiddleware(req, res, next) {
  const header = req.headers['authorization'];
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ ok: false, mensaje: 'Token no proporcionado.' });
  }
  try {
    req.usuario = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET);
    next();
  } catch (err) {
    const msg = err.name === 'TokenExpiredError'
      ? 'La sesión expiró. Inicia sesión nuevamente.'
      : 'Token inválido.';
    return res.status(401).json({ ok: false, mensaje: msg });
  }
}

// Solo permite acceso a los roles indicados
// Uso: soloRoles('superadmin', 'admin')
function soloRoles(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.usuario?.rol)) {
      return res.status(403).json({ ok: false, mensaje: `Requiere rol: ${roles.join(' o ')}.` });
    }
    next();
  };
}

module.exports = { authMiddleware, soloRoles };
