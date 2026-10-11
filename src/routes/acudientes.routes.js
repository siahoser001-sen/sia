const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/acudiente.controller');
const { authMiddleware, soloRoles } = require('../middleware/auth.middleware');

// Toda la gestión de acudientes es del administrador de la institución.
router.use(authMiddleware, soloRoles('admin'));

router.get('/',                     ctrl.listar);
router.post('/',                    ctrl.agregar);
router.post('/estudiantes',         ctrl.vincular);
router.delete('/:id/estudiantes/:estudianteId', ctrl.desvincular);
router.delete('/:id',               ctrl.eliminar);

module.exports = router;