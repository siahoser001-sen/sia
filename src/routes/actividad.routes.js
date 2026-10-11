const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/actividad.controller');
const { authMiddleware, soloRoles } = require('../middleware/auth.middleware');

router.get('/', authMiddleware, soloRoles('superadmin'), ctrl.obtenerActividad);

module.exports = router;
