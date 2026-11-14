// ============================================================
//  upload.middleware.js — Configuración de multer para subir
//  archivos binarios a disco (carpetas /storage y
//  /storage_privado). Cada tipo de archivo usa su subcarpeta.
//  El tamaño máximo sale de una sola constante configurable
//  (src/config/upload.config.js, env UPLOAD_MAX_MB).
// ============================================================

const multer = require('multer');
const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');

const { TAMANIO_MAXIMO_BYTES, UPLOAD_MAX_MB } = require('../config/upload.config');

const TIPOS_MIME_PERMITIDOS = ['image/jpeg', 'image/png', 'image/webp'];
const TIPOS_ARCHIVO_ASISTENCIA = new Map([
  ['.pdf', 'application/pdf'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
  ['.doc', 'application/msword'],
  ['.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
]);
// Entregas de tareas: varios tipos y algunos MIME alternativos
// (los navegadores no siempre reportan el mismo para zip).
const TIPOS_ARCHIVO_ENTREGA = new Map([
  ['.pdf',  ['application/pdf']],
  ['.jpg',  ['image/jpeg']],
  ['.jpeg', ['image/jpeg']],
  ['.png',  ['image/png']],
  ['.docx', ['application/vnd.openxmlformats-officedocument.wordprocessingml.document']],
  ['.xlsx', ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']],
  ['.pptx', ['application/vnd.openxmlformats-officedocument.presentationml.presentation']],
  ['.zip',  ['application/zip', 'application/x-zip-compressed']],
]);

function crearUploader(subcarpeta, destinoBase, tiposMimePermitidos, mensajeFormato, mensajeTamanio, mensajeCantidad) {
  const destino = path.join(destinoBase, subcarpeta);

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
    const extension = path.extname(file.originalname).toLowerCase();
    let mimePermitido = false;
    if (tiposMimePermitidos instanceof Map) {
      const esperados = tiposMimePermitidos.get(extension);
      mimePermitido = Array.isArray(esperados)
        ? esperados.includes(file.mimetype)
        : esperados === file.mimetype;
    } else {
      mimePermitido = tiposMimePermitidos.includes(file.mimetype);
    }
    if (!mimePermitido) {
      const err = new Error(mensajeFormato);
      err.statusCode = 400;
      err.expose = true;
      return cb(err);
    }
    cb(null, true);
  };

  const uploader = multer({
    storage,
    fileFilter: filtroArchivo,
    limits: { fileSize: TAMANIO_MAXIMO_BYTES },
  });

  // Traduce los MulterError (status 500 por defecto) a 400 con
  // mensajes claros en español.
  const traducirError = (err) => {
    if (!err) return;
    if (err.code === 'LIMIT_FILE_SIZE') {
      err.statusCode = 400;
      err.message = mensajeTamanio;
      err.expose = true;
    } else if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      err.statusCode = 400;
      err.message = mensajeCantidad || 'Archivo inesperado o demasiados archivos.';
      err.expose = true;
    }
  };

  return {
    single: (campo) => (req, res, next) => {
      uploader.single(campo)(req, res, (err) => {
        traducirError(err);
        next(err);
      });
    },
    array: (campo, maximo) => (req, res, next) => {
      uploader.array(campo, maximo)(req, res, (err) => {
        traducirError(err);
        next(err);
      });
    },
  };
}

function crearUploaderImagen(subcarpeta) {
  return crearUploader(
    subcarpeta,
    path.join(__dirname, '../../storage'),
    TIPOS_MIME_PERMITIDOS,
    'Formato no permitido. Solo se aceptan imágenes JPG, PNG o WEBP.',
    `La imagen supera el tamaño máximo permitido (${UPLOAD_MAX_MB} MB).`
  );
}

function crearUploaderArchivoAsistencia() {
  return crearUploader(
    'asistencia-dia',
    path.join(__dirname, '../../storage_privado'),
    TIPOS_ARCHIVO_ASISTENCIA,
    'Formato no permitido. Acepta PDF, JPG, PNG, WEBP, DOC o DOCX.',
    `El archivo supera el tamaño máximo permitido (${UPLOAD_MAX_MB} MB).`
  );
}

// Entregas de tareas: hasta 5 archivos por entrega (el máximo se
// valida en el controller), cada uno hasta UPLOAD_MAX_MB. Van a
// storage_privado porque son trabajos de estudiantes: se descargan
// solo por el endpoint autenticado.
function crearUploaderEntregaTarea() {
  return crearUploader(
    'entregas-tareas',
    path.join(__dirname, '../../storage_privado'),
    TIPOS_ARCHIVO_ENTREGA,
    'Formato no permitido. Acepta PDF, JPG, PNG, DOCX, XLSX, PPTX o ZIP.',
    `Cada archivo debe pesar máximo ${UPLOAD_MAX_MB} MB.`,
    'Puedes subir hasta 5 archivos por entrega.'
  );
}

module.exports = {
  crearUploaderImagen,
  crearUploaderArchivoAsistencia,
  crearUploaderEntregaTarea,
};
