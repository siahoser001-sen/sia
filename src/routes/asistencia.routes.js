// ============================================================
//  asistencia.routes.js
//  Montado en /api/asistencia
// ============================================================

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/asistencia.controller');
const { authMiddleware, soloRoles } = require('../middleware/auth.middleware');

router.use(authMiddleware);

router.post('/', soloRoles('docente'), ctrl.registrarMasivo);
router.get('/materia/:materiaId', soloRoles('admin', 'superadmin', 'docente'), ctrl.obtenerPorFecha);
router.get('/estudiante/:estudianteId', ctrl.historialEstudiante); // valida rol internamente
router.get('/resumen/:estudianteId/materia/:materiaId', ctrl.resumenEstudiante);

module.exports = router;
