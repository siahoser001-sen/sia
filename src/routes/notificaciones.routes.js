// ============================================================
//  notificaciones.routes.js
//  Montado en /api/notificaciones
// ============================================================

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/notificaciones.controller');
const { authMiddleware } = require('../middleware/auth.middleware');

router.use(authMiddleware);

router.get('/', ctrl.listarNotificaciones);

module.exports = router;