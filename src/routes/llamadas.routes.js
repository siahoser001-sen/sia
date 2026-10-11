// ============================================================
//  llamadas.routes.js
//  Montado en /api/llamadas
// ============================================================

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/llamadas.controller');
const { authMiddleware, soloRoles } = require('../middleware/auth.middleware');

router.use(authMiddleware);

router.post('/sala-rapida', soloRoles('docente'), ctrl.salaRapida);

module.exports = router;
