// ============================================================
//  informe-didactico.routes.js
//  Montado en /api/informe-didactico
//  Informe didáctico del curso (ROADMAP D9). El permiso fino
//  (director del curso o admin/superadmin de la institución) se
//  valida dentro del controller.
// ============================================================

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/informe-didactico.controller');
const { authMiddleware } = require('../middleware/auth.middleware');

router.use(authMiddleware);

router.get('/curso/:grupoId', ctrl.informeDidactico);
router.get('/curso/:grupoId/imprimir', ctrl.imprimirInformeDidactico);

module.exports = router;