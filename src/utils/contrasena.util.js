// Util para generar contraseñas legibles para cuentas creadas por el
// sistema (docentes, acudientes, reseteo). Compartida entre controllers.

const { randomBytes } = require('crypto');

// Charset legible (sin 0/O, 1/I/L) para la contraseña generada.
const CHARSET_PASSWORD = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

function generarPassword(longitud = 10) {
  const bytes = randomBytes(longitud);
  let pass = '';
  for (let i = 0; i < longitud; i++) {
    pass += CHARSET_PASSWORD[bytes[i] % CHARSET_PASSWORD.length];
  }
  return pass;
}

// Valida la fortaleza de una contraseña definida por el usuario:
// mínimo 8 caracteres, al menos una mayúscula, una minúscula y un número.
// Devuelve { valida: true } o { valida: false, mensaje: '...' }.
function validarFortalezaPassword(password) {
  if (!password || password.length < 8 || password.length > 72) {
    return { valida: false, mensaje: 'La contraseña debe tener entre 8 y 72 caracteres.' };
  }
  if (!/[A-Z]/.test(password)) {
    return { valida: false, mensaje: 'La contraseña debe incluir al menos una letra mayúscula.' };
  }
  if (!/[a-z]/.test(password)) {
    return { valida: false, mensaje: 'La contraseña debe incluir al menos una letra minúscula.' };
  }
  if (!/[0-9]/.test(password)) {
    return { valida: false, mensaje: 'La contraseña debe incluir al menos un número.' };
  }
  return { valida: true };
}

module.exports = { generarPassword, CHARSET_PASSWORD, validarFortalezaPassword };