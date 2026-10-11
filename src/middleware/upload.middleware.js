// ============================================================
//  upload.middleware.js — Configuración de multer para subir
//  archivos binarios a disco (carpeta /storage). Cada tipo de
//  archivo (fondos, logos, etc.) usa su propia subcarpeta.
// ============================================================

const multer = require('multer');
const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');

const TIPOS_MIME_PERMITIDOS = ['image/jpeg', 'image/png', 'image/webp'];
const TAMANIO_MAXIMO_BYTES  = 8 * 1024 * 1024; // 8 MB

function crearUploaderImagen(subcarpeta) {
  const destino = path.join(__dirname, '../../storage', subcarpeta);

  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      fs.mkdirSync(destino, { recursive: true });
      cb(null, destino);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const nombreUnico = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
      cb(null, nombreUnico);
    },
  });

  const filtroArchivo = (req, file, cb) => {
    if (!TIPOS_MIME_PERMITIDOS.includes(file.mimetype)) {
      const err = new Error('Formato no permitido. Solo se aceptan imágenes JPG, PNG o WEBP.');
      err.statusCode = 400;
      return cb(err);
    }
    cb(null, true);
  };

  const uploader = multer({
    storage,
    fileFilter: filtroArchivo,
    limits: { fileSize: TAMANIO_MAXIMO_BYTES },
  });

  // Envuelve .single() para traducir el error de tamaño de multer
  // (MulterError, status 500 por defecto) a un 400 con mensaje claro.
  return {
    single: (campo) => (req, res, next) => {
      uploader.single(campo)(req, res, (err) => {
        if (err && err.code === 'LIMIT_FILE_SIZE') {
          err.statusCode = 400;
          err.message = 'La imagen supera el tamaño máximo permitido (8 MB).';
        }
        next(err);
      });
    },
  };
}

module.exports = { crearUploaderImagen };
