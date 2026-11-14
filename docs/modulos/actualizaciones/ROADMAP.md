# SIA — ROADMAP (condensado 2026-10-30)
Regla: solo el usuario marca ✅. Estados: ⬜ pendiente · 🔵 en progreso · 🟡 por verificar · ✅ aprobado · ⛔ bloqueado.
Todo cambio de esquema BD se confirma con el usuario antes. Docs: VISION.md, ROADMAP_HISTORIAL.md, GUIA_DE_AVANCE.md, EVALUACIONES.md, PRUEBAS_MANUALES.md.
Propósito: entorno donde crece enseñar y aprender (competencias + proyectos + personalizado + evaluación formativa; evaluaciones mixtas; catálogo global del superadmin importable).

## Fases
1 ✅ (2026-10-15) · Prefase 2 = Ronda H + Ronda I (en curso) · 2 Chatbot IA + Evaluaciones · 3 Consolidar · Futuras (por definir)

## Fase 1 (hecha)
Auth (correo o documento; roles superadmin|admin|docente|estudiante|acudiente; JWT con revocación; rate-limit; recuperación SMTP; bloqueo por intentos) · matrícula por código (1 curso activo por estudiante) · gestión académica (instituciones, periodos, materias generales y por curso, cursos/grupos, horario con plantilla de horas) · Mis clases (tareas, entregas, plan de evaluación con % por periodo, notas, asistencia) · boletín por periodo, informe anual, reporte del estudiante (3 hojas), certificados PDF, promoción masiva · calendario, comunicados, notificaciones en vivo (socket), chat del curso, videollamada/pizarrón · fondos (10 fotos + 6 colores).

## Ronda H (2026-10-15)
H1 Admin ve director en detalle de curso ⬜ (cubierto por T02)
H2 Correo obligatorio en registro de estudiante ⬜
H3 Pizarrón también en el curso dirigido ⬜
H4 Estilos: contenedores solapados (dashboard estudiante) y con zoom ⬜
H5 Tras traslado, "Mis clases" del estudiante no carga ⬜
H6 Perfil profesional: docentes y admin visibles a estudiantes/acudientes; admin con perfil; estudiante y acudiente editan sus datos ⬜
H7 Parrilla de horario proporcional a hora real ✅
H8 Reportes: edición general (plantilla) de hojas, aplicada a todos los estudiantes ⬜
H9 Reportes: elegir hoja a descargar; aviso de hojas en blanco; observaciones fluyen a hoja siguiente; cada sección en hoja nueva ⬜
H10 "Eliminar" estudiante → motivo: datos erróneos (no reingresa con esos datos; correo de aviso) o retiro (correo y contraseña inservibles hasta reinvitación por código; se envía reporte completo a estudiante y acudiente) ⬜
H11 Jitsi: estilo (configOverwrite/interfaceConfigOverwrite) y mejor inicio ⬜
H12 Acceso desde celular por IP del README falla (binding/host, CORS; la IP era de otro equipo) ⬜

## Ronda I — decisiones del usuario
- Grupo = curso. Curso ≠ materia.
- Director y profesor de materia van en entradas aparte: "601 — Dirección de curso" siempre primera, luego "601 — Matemáticas", etc.
- En cursos donde solo dicta: ve trabajos de su materia y sus estudiantes, NO "Estudiantes del curso" ni "Detalle del curso".
- Trabajos de curso (sin materia) cuentan para nota: la Dirección de curso tiene plan de evaluación propio y sale como línea aparte en boletín e informe anual.
- Sin semanas de recuperación: las notas se corrigen con edición del Admin (con motivo e historial), también en periodo cerrado.
- Archivar curso: solo sin matrículas activas; libera al director (se conserva histórico); desactiva código; no hay borrado definitivo. Docente ve sus archivados en solo lectura; estudiante en su historial.
- Cierre de periodo siempre manual (la fecha solo advierte). Cerrar no borra. No hay estado "recuperación".
- Asistencia diaria compartida: una casilla por estudiante y fecha para todo el curso, sin materia. Estados: `asistio`, `falta`, `tarde`, `justificada`; los fines de semana no se editan. El estudiante solo consulta su propia fila.
- Soporte de justificación: un archivo PDF, JPG, PNG, WEBP, DOC o DOCX por celda, hasta el límite actual de multer (5 MB, `UPLOAD_MAX_MB`); se registra en `archivos` y se descarga por endpoint autenticado.
- La lista se edita en una tarjeta de `mis-clases.html` dentro del curso. No se convierte ni fusiona automáticamente `asistencia`: el resumen de curso y los boletines/informe incorporan conteos por día de `asistencia_dia`, mientras el desglose por materia conserva su significado histórico.
- Corrección de nota sin reabrir periodo: aprobada (motivo + auditoría + nueva versión de corte; boletín publicado queda "desactualizado"). No se reabre tras promoción de año.

## Ronda I — tareas (orden) · dif. · depende · BD
T01 Diagnosticar y CORREGIR los botones que no cargan (cursos: detalle/renombrar/director; periodos→editar; materias→profesores; grados→editar; grupos→director) en los 5 roles; dejar matriz acción×rol en PRUEBAS_MANUALES.md · 1 · — · no
T02 Cursos: detalle (con director), renombrar (sin duplicados por año), director (un docente dirige un solo curso) · 1 · T01 · no
T03 Periodos→editar, materias→profesores, grados→editar, grupos→director; un solo patrón de delegación de eventos; periodo cerrado no se edita · 1 · T01 · no
T04 Admin edita notas: motivo obligatorio, historial (anterior/nuevo/quién/cuándo), notifica y marca al docente, valida escala · 2 · T01 · SÍ historial
T05 Mis clases: Dirección de curso primero, materias en entradas aparte, orden estable · 2 · T02 · no
T06 Curso dirigido y materia dictada en él: Estudiantes, Detalle, Trabajos; materias desde la misma fuente que el horario (bug curso 101); sin horario dentro · 2 · T05 · no
T07 Asignar materia en horario → evento socket → Mis clases se actualiza sin recargar (fallback al volver a la pestaña) · 2 · T06 · no
T08 Trabajos de materia en cursos que solo dicta · 2 · T06 · no
T09 Tareas de curso sin materia (director/Admin): descripción, fecha, archivos, enlace externo, etiqueta "Del director de curso"; guarda nota de entrega · 2 · T08 · SÍ materia nula + indicador
T10 Archivar curso con validaciones y diálogo explicativo · 2 · T02 · SÍ estado/fecha/autor
T11 Pestaña "Archivados": ver (solo lectura) y restaurar (valida código, nombre, director libre) · 3 · T10 · no
T12 Videollamada dentro del curso bajo "Trabajos"; se quita de la sección principal; sala con sufijo aleatorio en BD; solo miembros del curso (junto con H3/H11) · 3 · T08 · SÍ sufijo sala
T13 Llamada de curso completo sin materia (supuesto, descartable) · 3 · T12 · no
T13A Plan de evaluación de Dirección de curso (suma 100 %, trabajos asociados a ítem, línea aparte en boletín) · 3 · T09 · SÍ alcance curso/materia
T14 Política de datos al cerrar (tabla aprobada por el usuario) · 3 · T13A · doc
T15 Estados del periodo planeado→activo→en cierre→cerrado→(reabierto); periodo_id en notas/asistencia/tareas/plan; eventos auditados; un periodo activo por institución y año; migrar por fecha con respaldo · 3 · T14 · SÍ
T16 Cierre transaccional: lista de verificación (plan=100 %, notas, tareas sin calificar, asistencia), corte inmutable, idempotente, bloqueo entre admins · 3 · T15 · SÍ tabla de cortes
T17 Solo lectura al cerrar en todos los endpoints de escritura (notas, asistencia, plan, tareas); única excepción: corrección del Admin (T18) · 3 · T16 · no
T18 Reabrir (motivo, nueva versión de corte, notifica docentes) y corrección controlada de nota · 3 · T17 · SÍ versiones
T19 Boletín desde el corte: borrador→revisado→publicado; incluye línea Dirección de curso; Admin publica, director revisa (coordinar con H8/H9) · 2 · T18 · SÍ estado
T20 Copiar tarea pendiente al periodo siguiente (la original no cambia) · 2 · T18 · no
T21 Asistencia: modelo (estudiante+fecha+materia opcional+periodo), campos estado, quién, cuándo, version, justificación; API leer grilla/guardar casilla; migrar datos · 3 · T15 · SÍ
T21A Sección "Asistencia por periodo" en solo lectura y retiro de la lista antigua · 3 · T21 · no
T22 Grilla editable: menú por casilla (hover/toque/teclado), re-edición; edita Admin/Director/ProfMateria · 3 · T21A · no
T23 Totales por fila (asistencias, fallas, retardos, justificaciones) y encabezados fijos en dos ejes · 3 · T22 · no
T23A Móvil, 40 estudiantes × 60 días, ir a "hoy", agrupar por mes (junto con H4) · 3 · T23 · no
T24 Justificación con texto obligatorio, editable/quitable · 3 · T22 · no
T24A Adjuntos de justificación (reglas arriba) · 3 · T24 · SÍ tabla puente
T25 Días no lectivos (Admin, toda la institución, vía calendario): grises, no editables, sin borrar registros; periodo cerrado = solo lectura · 3 · T17,T22 · no
T26 Historial inmutable por casilla (quién/cuándo/anterior/nuevo) y exportación Excel/PDF · 4 · T24A · SÍ
T27 Tiempo real: sala por curso+periodo, el servidor decide con version, conflicto rechazado con aviso, presencia, resincronización, sin red = solo lectura; el estudiante recibe actualizaciones · 5 · T26 · no
Si T27 se complica, T22–T26 funcionan con refresco manual.

## Riesgos
Esquema: T04, T09, T10, T12, T13A, T15, T16, T18, T19, T21, T24A, T26 → confirmar cada uno, migración con respaldo y probar en copia.
Migración de periodos (datos sin periodo_id → asignar por fecha). Cambiar fechas de periodo con datos → avisar y bloquear si quedan fuera de rango. Reabrir tras promoción → bloqueado. Privacidad de menores (asistencia visible entre estudiantes) aceptada con mitigaciones. Sin antivirus en adjuntos (fuera de alcance). Solapes: T02↔H1, T05/T06↔H5, T12↔H3/H11, T10↔H10, T13A/T19↔H8/H9, T23A↔H4.

## Fase 2 — Chatbot IA + Evaluaciones y Actividades
2A Chatbot: integrado lo máximo posible. Por definir: proveedor/modelo, alcance, dónde vive, datos visibles (privacidad de menores), conexión con chat del curso. Borrador: asistente por rol, ayuda contextual, redactar actividades/preguntas/retroalimentación, resúmenes.
2B Evaluaciones (spec en EVALUACIONES.md): ítems manuales, PDF-entrega o enlazados a evaluación autocorregible (1 actividad ⇔ 1 evaluación) con nota en vivo y edición manual; banco de preguntas por materia; rúbricas por competencia (Bajo/Medio/Alto/Superior); constructor de evaluación; boletín por competencia. El plan de evaluación debe admitir alcance materia y curso (T13A) y convivir con T04.
2C Preguntas por cerrar en la conversación "post Fase 2".

## Fase 3
Reverificar Fase 1 contra código y BD reales; reestructurar (consistencia visual y de flujos, navegación, deuda técnica, rendimiento, accesibilidad, errores); endurecer seguridad y datos; consolidar docs y pruebas.