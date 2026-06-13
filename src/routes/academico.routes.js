// ============================================================
//  academico.routes.js
//  Todas las rutas requieren login y rol admin (o superadmin).
//  Montado en /api/academico
// ============================================================

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/academico.controller');
const { authMiddleware, soloRoles } = require('../middleware/auth.middleware');

// Todas las rutas de este archivo requieren estar logueado
router.use(authMiddleware);

// Áreas — lectura para admin y docente (útil al crear materias o ver catálogo)
router.get('/areas', soloRoles('admin', 'superadmin', 'docente'), ctrl.listarAreas);

// Grados
router.get('/grados',         soloRoles('admin', 'superadmin'), ctrl.listarGrados);
router.post('/grados',        soloRoles('admin', 'superadmin'), ctrl.crearGrado);
router.put('/grados/:id',     soloRoles('admin', 'superadmin'), ctrl.actualizarGrado);
router.delete('/grados/:id',  soloRoles('admin', 'superadmin'), ctrl.eliminarGrado);

// Grupos
router.get('/grupos',         soloRoles('admin', 'superadmin'), ctrl.listarGrupos);
router.post('/grupos',        soloRoles('admin', 'superadmin'), ctrl.crearGrupo);
router.put('/grupos/:id',     soloRoles('admin', 'superadmin'), ctrl.actualizarGrupo);
router.delete('/grupos/:id',  soloRoles('admin', 'superadmin'), ctrl.eliminarGrupo);

// Materias
router.get('/materias',         soloRoles('admin', 'superadmin'), ctrl.listarMaterias);
router.post('/materias',        soloRoles('admin', 'superadmin'), ctrl.crearMateria);
router.put('/materias/:id',     soloRoles('admin', 'superadmin'), ctrl.actualizarMateria);
router.delete('/materias/:id',  soloRoles('admin', 'superadmin'), ctrl.eliminarMateria);

module.exports = router;