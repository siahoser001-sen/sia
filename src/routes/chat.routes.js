// ============================================================
//  chat.routes.js — Montado en /api/chat
//  Centro de mensajería (chats estilo Messenger).
// ============================================================

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/chat.controller');
const { authMiddleware } = require('../middleware/auth.middleware');

router.use(authMiddleware);

router.get('/config',             ctrl.config);
router.put('/config',             ctrl.actualizarConfig);
router.get('/conversaciones',     ctrl.conversaciones);
router.get('/buscar',             ctrl.buscar);
router.post('/abrir',             ctrl.abrir);
router.get('/:chatId/mensajes',   ctrl.mensajes);
router.post('/:chatId/enviar',    ctrl.enviar);
router.post('/:chatId/bloquear',  ctrl.bloquear);
router.post('/:chatId/desbloquear', ctrl.desbloquear);

module.exports = router;