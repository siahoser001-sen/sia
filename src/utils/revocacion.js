// ============================================================
//  revocacion.js — Revocación de sesiones JWT en memoria
//  Cada token de sesión lleva un `jti` (id único) y un `ver`
//  (token_version del usuario, ver migración 19). Para revocar:
//    - Una sola sesión (logout)  -> se agrega su `jti` aquí.
//    - Todas las sesiones de un usuario (cambio de contraseña) ->
//      se incrementa `usuarios.token_version` en la BD; los tokens
//      viejos quedan inválidos porque llevan un `ver` menor.
//  La lista negra vive en memoria (un Map), igual que el
//  MemoryStore del rate-limit. Es suficiente para una instalación
//  de un solo proceso; en un despliegue multi-instancia habría que
//  moverla a un store compartido (Redis). Las entradas expiran
//  solas junto con el token correspondiente (JWT_EXPIRES_IN).
// ============================================================

// Map<jti, expiraEnMs> — solo conserva jti de tokens no expirados.
const revocados = new Map();

// Intervalo de limpieza periódica (cada 15 min se barre lo vencido).
const LIMPIEZA_MS = 15 * 60 * 1000;

// Útil para calcular cuándo expira un jti dado el `exp` del payload.
function _expiraEnMs(expSeg) {
  const expMs = expSeg ? expSeg * 1000 : Date.now() + 8 * 60 * 60 * 1000;
  return expMs;
}

/**
 * Marca un token de sesión como revocado.
 * @param {string} jti  id único del JWT
 * @param {number} [expSeg]  timestamp `exp` del payload (segundos)
 */
function revocarJti(jti, expSeg) {
  if (!jti) return;
  revocados.set(jti, _expiraEnMs(expSeg));
}

/** Devuelve true si el jti está en la lista negra y sigue vigente. */
function estaRevocado(jti) {
  if (!jti) return false;
  const expMs = revocados.get(jti);
  if (!expMs) return false;
  if (Date.now() > expMs) {
    revocados.delete(jti);
    return false;
  }
  return true;
}

// Limpieza periódica de entradas vencidas para no acumular memoria.
setInterval(() => {
  const ahora = Date.now();
  for (const [jti, expMs] of revocados) {
    if (ahora > expMs) revocados.delete(jti);
  }
}, LIMPIEZA_MS).unref();

module.exports = { revocarJti, estaRevocado };
