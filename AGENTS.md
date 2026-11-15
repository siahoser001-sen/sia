# AGENTS.md

Proyecto SIA — aplicación académica SENA.

## Fuente de verdad
- Verifica en el código antes de afirmar rutas, pantallas, funciones o estado de una tarea.
- `docs/modulos/actualizaciones/ROADMAP.md` sigue desincronizado: T21 describe asistencia con materia y periodo opcionales; el esquema vigente de `asistencia_dia` identifica grupo, estudiante y fecha. Confirma la implementación antes de usar decisiones antiguas del documento.
- No mantener una sección de archivos huérfanos: consulta el mapa y confirma enlaces con búsquedas acotadas.

## Frontend, API y migraciones
- Las páginas y scripts consultados construyen la URL base con `window.location.origin`; no fijar `localhost` ni un puerto en el frontend.
- Las migraciones SQL actuales cubren prefijos 01–37; faltan 09 y 11. Hay dos archivos 35 (`35_asistencia_dia.sql` y `35_chat_adjuntos.sql`); el siguiente prefijo libre es 38.
- `npm run migrate` ejecuta las migraciones no registradas en `schema_migrations`, ordenadas por prefijo numérico. Para cambios de esquema, crea la próxima migración numerada y aplica el runner.
- El código de la aplicación está organizado bajo `src/controllers`, `src/routes`, `src/services`, `src/utils` y `src/sockets`; las páginas compartidas viven en `frontend/`.

## Mapa por módulo
| Módulo | Frontend (HTML/JS) | Controller / routes | Service / util | Migraciones principales |
|---|---|---|---|---|
| Asistencia diaria y por clase | `mis-clases.html`, `materia-estudiante.html` | `asistencia-dia.controller.js` / `asistencia-dia.routes.js` | `asistencia-dia.service.js` | `35_asistencia_dia.sql`, `38_asistencia_por_clase.sql` |
| Calendario y horario | `calendario.html`, `academico.html`, `mis-clases.html` | `calendario.controller.js`, `academico.controller.js` / rutas `calendario` y `academico` | `materias-curso.util.js`, `ciclo.util.js`, `chat-curso.service.js` | `01_sia_base.sql`, `17_calendario_eventos.sql`, `20_horario_horas.sql` |
| Plan de evaluación y estudio | `mis-clases.html`, `materia-estudiante.html` | `plan-evaluacion.controller.js` / `plan-evaluacion.routes.js` | `materias-curso.util.js`, `reporte-update.service.js` | `15_plan_evaluacion.sql`, `39_plan_estudio.sql` |
| Tareas y entregas con archivos | `dashboard.html`, `mis-clases.html`, `materia-estudiante.html` | `tareas.controller.js`, `tareas-entrega-archivos.controller.js` / `tareas.routes.js` | `tareas-entrega.util.js`, `materias-curso.util.js`, `notificacion.service.js`, `reporte-update.service.js`, `chat-curso.service.js` | `01_sia_base.sql`, `29_tareas_estado.sql`, `36_entregas_archivos.sql`, `39_plan_estudio.sql` |
| Notas y periodos | `materia-estudiante.html`, `mis-clases.html`, `academico.html` | `notas.controller.js`, `academico.controller.js` / rutas `notas` y `academico` | `ciclo.util.js`, `materias-curso.util.js`, `notificacion.service.js`, `reporte-update.service.js`, `chat-curso.service.js` | `01_sia_base.sql`, `15_plan_evaluacion.sql`, `30_notas_periodo_cierre.sql`, `34_nota_minima_aprobacion_institucion.sql` |
| Matrículas, traslados y materias por curso | `academico.html`, `estudiantes.html`, `activar-estudiante.html`, `mis-materias.html`, `mis-clases.html` | `matriculas.controller.js`, `promocion.controller.js`, `academico.controller.js` / rutas `matriculas` y `academico` | `materias-curso.util.js`, `ciclo.util.js` | `01_sia_base.sql`, `07_director_curso.sql`, `10_matriculacion_codigo.sql`, `13_matriculacion_por_codigo.sql`, `14_materias_por_curso.sql`, `23_materias_generales.sql`, `25_promocion_anual.sql`, `32_materias_curso.sql` |
| Notificaciones vinculadas a actividades | `dashboard.html` | `notificaciones.controller.js` / `notificaciones.routes.js` | `notificacion.service.js` | `02_sia_v2.sql`, `40_notificaciones_destino.sql` |
| Chat directo | `chat-drawer.html`, `chat-drawer.js`, `chat-drawer-inyector.js` | `chat.controller.js` / `chat.routes.js` | `materias-curso.util.js` | `22_chat_mensajeria.sql`, `35_chat_adjuntos.sql` |
| Chat de curso | `sia-chat-curso.js`, integrado en `dashboard.html` y `mis-clases.html` | `chat-curso.controller.js` / `chat.routes.js` | `chat-curso.service.js` | `33_chat_curso.sql` |
| Llamadas y pizarrón | `llamadas-docente.html`, `llamadas-estudiante.html`, `pizarron.html`, `static/js/pizarron.js` | `llamadas.controller.js`, `clases.controller.js` / `llamadas.routes.js`, `clases.routes.js` | Socket.IO en `sockets/socket.js`; sin service/util dedicado | `03_sesiones_clase.sql`, `37_pizarron_persistente.sql` |
| Reportes y boletines | `reporte-estudiante.html`, `mis-clases.html` | `reportes.controller.js`, `boletin.controller.js`, `resumen.controller.js`, `informe-didactico.controller.js` / rutas `reportes`, `boletin`, `resumen`, `informe-didactico` | `reporte-update.service.js`, `asistencia-dia.service.js`, `materias-curso.util.js`, `ciclo.util.js` | `16_boletines.sql`, `24_reporte_estudiantil.sql`, `26_certificados.sql`, `30_notas_periodo_cierre.sql`, `31_boletines_anual.sql`, `35_asistencia_dia.sql` |
| Dirección de curso | `academico.html`, `mis-clases.html` | `academico.controller.js` / `academico.routes.js`; otras funciones aparecen en las filas de sus módulos | `materias-curso.util.js` | `07_director_curso.sql`, `10_matriculacion_codigo.sql`, `32_materias_curso.sql` |
| Sesión, sidebar y UI compartida | `sia-sesion.js`, `sia-identidad.js`, `sia-ui.js`, `sia-utils.js`, `chat-drawer-inyector.js` | `auth.controller.js`, `auth.routes.js`, `auth.middleware.js` | `revocacion.js` | `01_sia_base.sql`, `12_intentos_fallidos_login.sql`, `19_revocacion_sesiones.sql` |

## Reglas para el agente
- Toca solo los archivos del módulo pedido.
- Si necesitas modificar un archivo de otro módulo, di cuál y por qué antes de tocarlo.
- No recorras todo el proyecto.
- Si el mapa no cubre algo, busca con grep acotado a `src/` o `frontend/`.
