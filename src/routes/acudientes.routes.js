const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/acudiente.controller');
const { authMiddleware, soloRoles } = require('../middleware/auth.middleware');
const { publicoLimiter } = require('../middleware/rateLimit.middleware');

// Pública: el acudiente se registra a sí mismo con el código del curso
// de su hijo (luego crea su contraseña con /api/auth/definir-password).
router.post('/registro', publicoLimiter, ctrl.registroPropio);

// Toda la gestión de acudientes es del administrador de la institución.
router.use(authMiddleware, soloRoles('admin'));

router.get('/',                     ctrl.listar);
router.post('/',                    ctrl.agregar);
router.post('/estudiantes',         ctrl.vincular);
router.delete('/:id/estudiantes/:estudianteId', ctrl.desvincular);
router.delete('/:id',               ctrl.eliminar);

module.exports = router;