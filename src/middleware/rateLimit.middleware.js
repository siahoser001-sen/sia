// ============================================================
//  rateLimit.middleware.js — Límites por IP
//  Complementa el bloqueo por cuenta (intentos_fallidos en
//  `usuarios`, migración 12) con un límite por IP para frenar
//  fuerza bruta distribuida (una IP que pruebe muchos correos
//  distintos, o varias IPs contra la misma cuenta).
//
//  Usa express-rate-limit con el MemoryStore por defecto, que es
//  suficiente para una instalación en un solo proceso/servidor
//  (el caso del SIA: un backend Express levantado en una máquina).
//  Si algún día se despliega en varios procesos o instancias, hay
//  que cambiar a un store compartido (Redis, etc.) para que el
//  contador sea global y no por proceso.
//
//  Para no regalar información, la respuesta de 429 es genérica:
//  no dice cuántos intentos, ni revela si la cuenta existe.
// ============================================================

const rateLimit = require('express-rate-limit');

// Valores por defecto: 20 intentos de login cada 15 minutos por IP.
// Se pueden ajustar desde .env:
//   RATE_LIMIT_LOGIN_WINDOW_MIN  (minutos de la ventana)
//   RATE_LIMIT_LOGIN_MAX         (máximo de intentos permitidos en la ventana)
const VENTANA_MIN = parseInt(process.env.RATE_LIMIT_LOGIN_WINDOW_MIN || '15', 10);
const MAX_INTENTOS_IP = parseInt(process.env.RATE_LIMIT_LOGIN_MAX || '20', 10);

// Límite aplicado específicamente al login. El bloqueo por cuenta
// (auth.controller.js) ya existe y sigue activo; esto es una capa
// adicional por dirección IP.
const loginLimiter = rateLimit({
  windowMs: VENTANA_MIN * 60 * 1000,
  max: MAX_INTENTOS_IP,
  standardHeaders: true,   // devuelve RateLimit-* en las cabeceras
  legacyHeaders: false,    // no repite las cabeceras X-RateLimit-* viejas
  message: {
    ok: false,
    mensaje: 'Demasiados intentos desde esta dirección. Espera unos minutos e intenta de nuevo.',
  },
});

// Límite para endpoints públicos que generan correos o registros
// (olvide-password, reestablecer-password, solicitar institución,
// unirse con código): más estricto para frenar spam y correo bomba.
const VENTANA_PUBLICA_MIN = parseInt(process.env.RATE_LIMIT_PUBLIC_WINDOW_MIN || '15', 10);
const MAX_INTENTOS_PUBLICOS = parseInt(process.env.RATE_LIMIT_PUBLIC_MAX || '10', 10);

const publicoLimiter = rateLimit({
  windowMs: VENTANA_PUBLICA_MIN * 60 * 1000,
  max: MAX_INTENTOS_PUBLICOS,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    mensaje: 'Demasiadas solicitudes desde esta dirección. Espera unos minutos e intenta de nuevo.',
  },
});

module.exports = { loginLimiter, publicoLimiter };
