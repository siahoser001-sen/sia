const express  = require('express');
const router   = express.Router();
const ctrl     = require('../controllers/docente.controller');
const { authMiddleware, soloRoles } = require('../middleware/auth.middleware');

// Listado de docentes de la institución (ej. selector de director de curso)
router.get('/', authMiddleware, soloRoles('admin', 'superadmin'), ctrl.listarDocentes);

// Alta directa: el admin llena los datos y el sistema genera la
// contraseña y se la envía al docente por correo (sin link de activación).
router.post('/agregar', authMiddleware, soloRoles('admin', 'superadmin'), ctrl.agregarDocente);

module.exports = router;
