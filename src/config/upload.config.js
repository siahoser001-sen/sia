// ============================================================
//  upload.config.js — Límite único de tamaño para archivos
//  subidos con multer. Se configura con UPLOAD_MAX_MB en .env
//  (por defecto 5 MB). Ningún uploader debe declarar su propio
//  límite: todos importan esta constante.
// ============================================================

const BYTES_POR_MB = 1024 * 1024;
const VALOR_ENV = Number(process.env.UPLOAD_MAX_MB);

const UPLOAD_MAX_MB = Number.isFinite(VALOR_ENV) && VALOR_ENV > 0
  ? VALOR_ENV
  : 5;

const TAMANIO_MAXIMO_BYTES = Math.round(UPLOAD_MAX_MB * BYTES_POR_MB);

module.exports = { UPLOAD_MAX_MB, TAMANIO_MAXIMO_BYTES };
