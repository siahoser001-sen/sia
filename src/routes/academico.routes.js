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
router.post('/areas', soloRoles('admin', 'superadmin'), ctrl.crearArea);

// Cursos (atajo simple sobre grados+grupos, ej. "601")
router.get('/cursos',         soloRoles('admin', 'superadmin'), ctrl.listarCursos);
router.post('/cursos',        soloRoles('admin', 'superadmin'), ctrl.crearCursoRapido);
router.delete('/cursos/:id',  soloRoles('admin', 'superadmin'), ctrl.eliminarGrupo);

// Grados
router.get('/grados',         soloRoles('admin', 'superadmin'), ctrl.listarGrados);
router.post('/grados',        soloRoles('admin', 'superadmin'), ctrl.crearGrado);
router.put('/grados/:id',     soloRoles('admin', 'superadmin'), ctrl.actualizarGrado);
router.delete('/grados/:id',  soloRoles('admin', 'superadmin'), ctrl.eliminarGrado);

// Grupos
router.get('/grupos',         soloRoles('admin', 'superadmin'), ctrl.listarGrupos);
router.post('/grupos',        soloRoles('admin', 'superadmin'), ctrl.crearGrupo);
router.put('/grupos/:id',     soloRoles('admin', 'superadmin'), ctrl.actualizarGrupo);
router.put('/grupos/:id/director', soloRoles('admin', 'superadmin'), ctrl.asignarDirector);
router.delete('/grupos/:id',  soloRoles('admin', 'superadmin'), ctrl.eliminarGrupo);

// Director de curso (rol 'docente' + grupos.director_id — se valida dentro del controller)
router.get('/mi-grupo',                    soloRoles('docente'), ctrl.miGrupoDirector);
router.get('/mis-cursos',                  soloRoles('docente'), ctrl.misCursosDocente);
router.get('/docentes',                    soloRoles('admin', 'superadmin', 'docente'), ctrl.listarDocentesInstitucion);
router.post('/grupos/:id/generar-codigo',  soloRoles('admin', 'superadmin', 'docente'), ctrl.generarCodigoGrupo);
router.put('/grupos/:id/codigo-estado',    soloRoles('admin', 'superadmin', 'docente'), ctrl.cambiarEstadoCodigo);

// Materias (admin/superadmin siempre; el docente-director solo gestiona
// las de su propio curso — se valida dentro del controller)
router.get('/materias',         soloRoles('admin', 'superadmin', 'docente'), ctrl.listarMaterias);
router.post('/materias',        soloRoles('admin', 'superadmin', 'docente'), ctrl.crearMateria);
router.put('/materias/:id',     soloRoles('admin', 'superadmin', 'docente'), ctrl.actualizarMateria);
router.delete('/materias/:id',  soloRoles('admin', 'superadmin', 'docente'), ctrl.eliminarMateria);

// Co-docencia (varios profesores por materia y curso).
// Ronda C1: solo admin/superadmin asignan o retiran docentes de una materia;
// el docente-director ya no gestiona a otros docentes.
router.get('/materias/:id/docentes',              soloRoles('admin', 'superadmin', 'docente'), ctrl.listarDocentesMateria);
router.post('/materias/:id/docentes',              soloRoles('admin', 'superadmin'), ctrl.agregarDocenteMateria);
router.delete('/materias/:id/docentes/:docenteId', soloRoles('admin', 'superadmin'), ctrl.quitarDocenteMateria);

// Periodos académicos (bloquea materias/notas hasta que existan)
router.get('/periodos',            soloRoles('admin', 'superadmin'), ctrl.listarPeriodos);
router.post('/periodos',           soloRoles('admin', 'superadmin'), ctrl.crearPeriodos);
router.put('/periodos/:id',        soloRoles('admin', 'superadmin'), ctrl.actualizarPeriodo);
router.put('/periodos/:id/activar',soloRoles('admin', 'superadmin'), ctrl.activarPeriodo);
router.delete('/periodos/:id',     soloRoles('admin', 'superadmin'), ctrl.eliminarPeriodo);

// Horarios (parrilla semanal por curso)
// Lectura/gestión: admin/superadmin + director de curso (se valida dentro del controller).
router.get('/horario',             soloRoles('admin', 'superadmin', 'docente'), ctrl.listarHorario);
router.get('/horario/materias',    soloRoles('admin', 'superadmin', 'docente'), ctrl.listarMateriasHorario);
router.post('/horario',            soloRoles('admin', 'superadmin', 'docente'), ctrl.crearHorario);
router.put('/horario/:id',         soloRoles('admin', 'superadmin', 'docente'), ctrl.actualizarHorario);
router.delete('/horario/:id',      soloRoles('admin', 'superadmin', 'docente'), ctrl.eliminarHorario);

// Plantilla global de horas de trabajo de la institución (Punto 1):
// el ADMIN la define; el DIRECTOR solo la lee para asignar materias.
router.get('/horario/horas',              soloRoles('admin', 'superadmin', 'docente'), ctrl.listarHorasInstitucion);
router.post('/horario/horas',             soloRoles('admin', 'superadmin'),            ctrl.crearHoraInstitucion);
router.put('/horario/horas/:id',          soloRoles('admin', 'superadmin'),            ctrl.actualizarHoraInstitucion);
router.delete('/horario/horas/:id',       soloRoles('admin', 'superadmin'),            ctrl.eliminarHoraInstitucion);

module.exports = router;