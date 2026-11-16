// ============================================================
//  chat.routes.js — Montado en /api/chat
//  Centro de mensajería (chats estilo Messenger).
// ============================================================

const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const router  = express.Router();
const ctrl    = require('../controllers/chat.controller');
const ctrlCurso = require('../controllers/chat-curso.controller');
const { authMiddleware } = require('../middleware/auth.middleware');

const CARPETA_CHAT = path.resolve(__dirname, '../../storage_privado/chat');
const TIPOS_CHAT = new Map([
  ['.pdf', ['application/pdf']],
  ['.jpg', ['image/jpeg']],
  ['.jpeg', ['image/jpeg']],
  ['.png', ['image/png']],
  ['.docx', ['application/vnd.openxmlformats-officedocument.wordprocessingml.document']],
  ['.xlsx', ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']],
  ['.pptx', ['application/vnd.openxmlformats-officedocument.presentationml.presentation']],
  ['.zip', ['application/zip', 'application/x-zip-compressed']],
  ['.webm', ['audio/webm', 'video/webm']],
  ['.ogg', ['audio/ogg', 'application/ogg', 'audio/vorbis', 'audio/opus']],
  ['.mp4', ['audio/mp4', 'video/mp4']],
  ['.mp3', ['audio/mpeg', 'audio/mp3']],
  ['.wav', ['audio/wav', 'audio/x-wav']],
]);
const uploaderChat = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      fs.mkdirSync(CARPETA_CHAT, { recursive: true });
      cb(null, CARPETA_CHAT);
    },
    filename: (req, file, cb) => {
      cb(null, `${Date.now()}-${randomUUID()}${path.extname(file.originalname).toLowerCase()}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const extension = path.extname(file.originalname).toLowerCase();
    const mimeTypes = TIPOS_CHAT.get(extension);
    if (!mimeTypes || !mimeTypes.includes((file.mimetype || '').split(';')[0].toLowerCase())) {
      const err = new Error('Formato no permitido. Acepta los formatos de entrega o audio WEBM, OGG, MP4, MP3 o WAV.');
      err.statusCode = 400;
      err.expose = true;
      return cb(err);
    }
    return cb(null, true);
  },
});

function recibirAdjunto(req, res, next) {
  uploaderChat.single('archivo')(req, res, err => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      err.statusCode = 400;
      err.expose = true;
      err.message = err.code === 'LIMIT_FILE_SIZE'
        ? 'El archivo supera el máximo permitido de 5 MB.'
        : 'Solo puedes adjuntar un archivo por mensaje.';
    }
    return next(err);
  });
}

router.use(authMiddleware);

router.get('/config',             ctrl.config);
router.put('/config',             ctrl.actualizarConfig);
router.get('/conversaciones',     ctrl.conversaciones);
router.get('/buscar',             ctrl.buscar);
router.post('/abrir',             ctrl.abrir);

// ── Chat del curso (Ronda F, F5): un chat por grupo donde escriben
//    los docentes y el sistema; estudiantes/acudientes solo leen. ──
router.get('/curso/:grupoId',            ctrlCurso.abrir);
router.post('/curso/:grupoId/mensajes',  ctrlCurso.enviar);

router.get('/:chatId/mensajes',   ctrl.mensajes);
router.delete('/:chatId/mensajes/:mensajeId', ctrl.eliminarMensaje);
router.get('/:chatId/adjuntos/:mensajeId', ctrl.descargarAdjunto);
router.post('/:chatId/enviar',    recibirAdjunto, ctrl.enviar);
router.post('/:chatId/bloquear',  ctrl.bloquear);
router.post('/:chatId/desbloquear', ctrl.desbloquear);

module.exports = router;