# SIA — Hoja de ruta y pendientes

> Este documento reemplaza la necesidad de releer todo el historial de chat.
> Está pensado para que cualquier chat/persona nueva entienda: qué ya existe,
> qué está a medias, qué falta por decidir, y en qué orden conviene construirlo.
> No toca `README.md` (ese es el manual de instalación/arranque del proyecto).

---

# 0. Plan estratégico (cómo avanzamos desde aquí)

> Esta sección es **nueva (2026-09-02)** y resume la forma de trabajo unificada
> (ver `../vision/VISION.md` y `GUIA_DE_AVANCE.md`). El resto de secciones (1→9) conservan el
> historial detallado; esta sección es la brújula de ahora en adelante.

## El propósito

El SIA no es solo un gestor académico: es un **entorno donde crece la capacidad de
enseñar y de aprender**, cuyo fin es revertir la decadencia de la enseñanza. Modelo
pedagógico (elegido): **aprendizaje por competencias + proyectos/retos + personalizado
adaptativo + evaluación formativa continua**, con evaluaciones **mixtas** (autocorregible
+ rúbrica por competencia) y un **catálogo global de prácticas/recursos** del superadmin
que los docentes puedan **importar**. Detalles en `../vision/VISION.md`.

## Documentación (fuentes de verdad)

> Rutas actualizadas a la organización de carpetas vigente (2026-09-02).

| Documento | Rol |
|---|---|
| `docs/modulos/vision/VISION.md` | Por qué existe el SIA y el modelo pedagógico (el "qué manda"). |
| `docs/modulos/actualizaciones/ROADMAP.md` | Hoja de ruta viva: fases, hitos y estado (este archivo). |
| `docs/modulos/actualizaciones/GUIA_DE_AVANCE.md` | Cómo pedir tareas, cómo documentar y el protocolo de trabajo. |
| `docs/modulos/actualizaciones/EVALUACIONES.md` | Spec detallada del módulo **Evaluaciones/Actividades** (el gran próximo hito). |
| `README.md` | Manual de instalación/arranque (no cambia su rol). |

## Próximo gran hito después del cierre del ROADMAP actual

> ⚠️ **Lo que hay que hacer HOY está en la sección [Ronda C — 2026-09-18](#ronda-c--2026-09-18-priorización-reporte-mis-clases-y-mensajería)**
> (9 tareas ordenadas por prioridad: permisos y bloqueos de mensajería, foto
> compartida, descargas del reporte, páginas personalizadas, mis clases y
> buscador de mensajería). Este módulo de Evaluaciones queda como siguiente gran
> módulo conceptual.

Tras terminar y verificar las secciones pendientes de este documento, el siguiente gran
módulo es **Evaluaciones y Actividades por competencias** (spec en
`docs/modulos/actualizaciones/EVALUACIONES.md`): plantilla por periodo con **% de peso**
(ya existe `plan_evaluacion_items`), cuyos ítems pueden ser **manuales, PDF-entrega, o**
enlazados a una evaluación autocorregible** (restricción **1 actividad ⇔ 1 evaluación**)
que **calcula y actualiza la nota en vivo** en la hoja, con edición manual del docente.
Incluye banco de preguntas por materia, rúbricas por competencia (Bajo/Medio/Alto/Superior),
constructor de evaluación con **tipos avalados por neurociencia** y boletín por competencia.

## Cierre del ROADMAP actual (decisiones, 2026-09-02)

Pendientes de decisión resueltos (detalles en la sección 8 y en el código):

- **Horas semanales** → se derivan del **horario** (no se piden a mano). Backend en
  `listarMaterias`; columna "Horas sem." en la tabla de materias.
- **Multi-materia por curso** → permitida (confirmado).
- **Traslape de periodos** → **no permitido**; se bloquea en create/update (400).
- **Páginas huérfanas** → `admin-dashboard.html` eliminada; `pizarron` y `llamadas`
  conectadas.

Quedan como **pruebas manuales end-to-end** (requieren BD real, no automatizables aquí):
plan de evaluación, calendario, acudientes/recuperación de contraseña (SMTP). Guía pasó a
paso y credenciales en `docs/verificacion/PRUEBAS_MANUALES.md`.

## Esta sección se actualiza
cada vez que un hito se verifica (marcar en su sección) o que la visión/caminos cambian.

## Ronda de tareas 2026-09-06 (nuevo plan)

Lista de tareas pedida por el usuario, con su estado. Orden de trabajo:
**1 → 2 → 5 → 3 → 6 → 4**.

| # | Tarea | Estado |
|---|---|---|
| 1 | **Horario por roles**: el admin define una plantilla de horas por institución (`horario_horas`) y el director solo puede asignar materias dentro de esas horas (no inventa horas). | 🔵 En curso (admin listo; director en `mis-clases.html` implementado) |
| 2 | **Detalle de curso** (para quien gestiona) con dos tablas: asistencia (presente/retardo/falta) + promedio de notas | 🔵 Implementado (director; verificación e2e pendiente) |
| 3 | **Comunicados globales** (no solo por institución) | ✅ Implementado (admin también publica globales; verificado con grep) |
| 4 | **Actualización parcial** de páginas sin recargar todo | ✅ Implementado (dashboard en vivo por socket) |
| 5 | **Bug de conexión**: pantallas quemando `localhost:3000` en vez de `window.location.origin` (da error intempestivo fuera del puerto 3000) | ✅ Corregido (17 HTML; verificado con grep) |
| 6 | **Notificaciones con nombre de institución** (`#nombreinstitucion`) | ✅ Implementado (servicio central + generación de notificaciones) |

### Punto 1 — Horario por roles (detalle)

- **Migración**: `database/20_horario_horas.sql` — tabla `horario_horas`
  (`institucion_id`, `dia_semana` 1-7, `hora_inicio`, `hora_fin`; UNIQUE
  `(institucion_id, dia_semana, hora_inicio)`).
- **Backend** (`academico.controller.js` / `academico.routes.js`):
  - Rutas `GET/POST/PUT/DELETE /api/academico/horario/horas` (la GET admite
    `docente`; las de escritura solo admin/superadmin) + helpers
    `listarHorasInstitucion`, `crearHoraInstitucion`, `actualizarHoraInstitucion`,
    `eliminarHoraInstitucion`, `_guardarHoraInstitucion`.
  - `crearHorario`/`actualizarHorario`: si el usuario **no** es admin/superadmin,
    el bloque `(dia_semana, hora_inicio, hora_fin)` debe existir en `horario_horas`
    de su institución (400 con sugerencia si no). El director ya estaba autorizado
    por `_esMiGrupo`/`_autorizarHorario`.
  - Sin BD no se pudo probar e2e (verificaciones: `node --check` OK; manual
    pendiente en `docs/verificacion/PRUEBAS_MANUALES.md`).
- **Frontend admin** (`academico.html`): modal "Horas de trabajo" (CRUD de la
  plantilla), botón solo para admin; el modal de franja en modo director usa
  selects con horas de la plantilla (no edita horas libres).
- **Frontend director** (`mis-clases.html`): tarjeta "Horario de mi curso" con
  parrilla día×hora de la plantilla; asignar/editar/eliminar materia por bloque.

### Punto 2 — Detalle de curso (asistencia + promedio)

- **Backend** (`resumen.controller.js`): `GET /api/resumen/curso/:grupoId` ahora
  devuelve por estudiante el desglose de **asistencia** (presente/retardo/falta/
  justificada para el periodo vigente o el pedido por query) además del promedio
  general, materias con notas y fallas totales. Incluye `periodo_nombre` y
  `anio_lectivo`. `node --check` OK.
- **Frontend director** (`mis-clases.html`): tarjeta "Detalle del curso" con las
  **dos tablas** pedidas: asistencia del periodo y promedio de notas del periodo
  (por estudiante). Se alimenta de `cargarResumenCurso` (mismo endpoint).

### Punto 5 — Bug de conexión (`:3000` quemado)

Causa: 16 pantallas definían `const API = window.location.protocol//hostname`:3000`,
rompiendo la app cuando se accede por IP/celular u otro puerto (el backend sirve
el frontend; CORS refleja cualquier origen). Fix: `window.location.origin` en
`academico`, `acudientes`, `activar-estudiante`, `comunicados`, `calendario`,
`dashboard`, `configuracion`, `instituciones`, `estudiantes`, `registro-institucion`,
`login` (API_URL), `reestablecer-password`, `llamadas-estudiante`, `llamadas-docente`,
`panel-superadmin`, `panel-admin`, `mis-clases` (ya corregido en el punto 1).
Verificado por grep: `:3000` = 0 resultados en `frontend/` (incluye `.js`).

### Punto 3 — Comunicados globales

Ya existían globales solo para superadmin (`POST /api/publicaciones/global`,
`institucion_id NULL`, visibles para todos vía `/api/publicaciones`). Decisión del
usuario: **el admin de institución también puede publicar globales**.
- **Backend** (`publicaciones.controller.js` / `publicaciones.routes.js`):
  - `POST /api/publicaciones/global` ahora acepta `superadmin` y `admin`; INSERT con
    `institucion_id NULL` igual que antes.
  - `SELECT_BASE` incluye `autor_id` para que el frontend sepa quién puede borrar.
  - `DELETE /api/publicaciones/:id`: el admin borra los de su institución **o** los
    globales que él mismo publicó (antes los globales le estaban prohibidos).
- **Frontend** (`comunicados.html`, admin): nuevo selector de alcance
  "🏫 Mi institución / 🌎 Todo el SIA" en el formulario; el filtro "por rol" se
  oculta en modo global; el listado muestra el botón Eliminar en los propios
  globales del admin. `node --check` OK.

### Punto 6 — Notificaciones con nombre de institución (`#nombreinstitucion`)

Servicio central (`src/services/notificacion.service.js`):
- Marcador `#nombreinstitucion` en `titulo`/`mensaje`: se reemplaza por el
  nombre real de la institución del destinatario (o por el que el llamador pase
  explícito con `institucion_nombre`); fallback "tu institución".
- `crearNotificacion` (individual, resuelve el marcador solo) y nueva
  `crearNotificacionLote` (inserciones por lotes de 100, con texto ya resuelto)
  para avisos masivos. `node --check` OK.

Generación de notificaciones (antes el sistema solo creaba 2):
- **Comunicados** (tipo `comunicado`, `publicaciones.controller.js`): global →
  todos los usuarios activos; institucional → todos los de la institución (o solo
  el rol de `para_rol`), excluyendo al autor.
- **Tareas** (`tareas.controller.js`): `tarea_asignada` a los estudiantes
  matriculados activos del grupo (con fecha de entrega en español); y
  `entrega_calificada` al estudiante al calificar su entrega (con la nota, si hay).
- **Notas** (`notas.controller.js`): `nota_publicada` al estudiante al registrar,
  con el valor.
- **Docentes** (`docente.controller.js`): `solicitud_docente` al docente al crear
  su cuenta ("tu cuenta de docente en #nombreinstitucion fue creada").
- **Instituciones** (`institucion.controller.js`): las 2 existentes ahora usan el
  marcador con el nombre real (`solicitud_institucion` al superadmin y
  `aprobacion` al admin).

Verificación: `node --check` OK en el servicio y en `institucion`, `publicaciones`,
`tareas`, `notas`, `docente` controllers.

### Punto 4 — Actualización parcial sin recargar (dashboard en vivo)

Decisión del usuario: que las tarjetas de datos del dashboard (tareas,
notificaciones, actividades) se refresquen en vivo vía el socket.io ya existente.
- **Backend**:
  - `src/sockets/socket.js`: al conectar, cada usuario se une a su sala
    `usuario:<id>` (permite avisarle personalmente); se registra el `io` en el
    servicio de notificaciones (`setSocketIO`).
  - `src/services/notificacion.service.js`: tras insertar una notificación se
    emite `notificaciones:update` a la sala del destinatario (individual o en
    lote).
  - Emisiones de eventos:
    - `tareas:update` → a los estudiantes del grupo al asignar una tarea
      (`tareas.controller.js crear`) y al estudiante al calificar su entrega
      (`calificarEntrega`).
    - `actividad:update` → a todos al aprobar/rechazar una institución
      (`institucion.controller.js`) y al publicar un comunicado global
      (`publicaciones.controller.js`).
- **Frontend**:
  - `dashboard.html`: carga socket.io, escucha `notificaciones:update` (recarga
    `cargarNotificaciones`) y `tareas:update` (recarga `cargarMisTareas`).
  - `panel-superadmin.html`: escucha `actividad:update` y recarga `cargarFeed`.
- Verificación: `node --check` OK en `socket.js`, `notificacion.service.js`,
  `institucion`, `publicaciones`, `tareas` y en el JS extraído de `dashboard.html`
  y `panel-superadmin.html`.

## Ronda B — 2026-09-16: identidad, reporte estudiantil y cierre operativo

> Lista pedida por el usuario. Orden de trabajo **1 → 2 → 3 → 4 → 5 → 6 → 7 → 8**,
> una tarea por mensaje. Estado inicial: todas 🔲 (planificadas, sin código).
> Nota: los puntos 1–4 ya vienen especificados por el usuario; los 5–8 son las
> piezas operativas de cierre de año que él pidió detallar (dónde se implementa
> y qué conlleva cada una).

| # | Tarea | Estado |
|---|---|---|
| 1 | **Logo/foto ampliable + reemplazo** (clic para agrandar; el admin reemplaza el logo de su institución; otros roles solo agrandan; el dueño reemplaza su propia foto) | ✅ Verificado en navegador (2026-09-18) |
| 2 | **Reporte del estudiante** (3 páginas: datos/resumen, compromiso, observaciones) para admin, docente, estudiante ("Mi reporte") y acudiente ("Mi acudido") | ✅ Núcleo verificado; ajustes en Ronda C (C5–C7) |
| 3 | **Descarga por página** (PDF/Word) y **exportación completa** de todas las páginas | ✅ Núcleo; redefinido por C5 (descargas con selector) |
| 4 | **Editor de páginas adicionales** (agregar páginas con cuadros y textos de distintos tamaños/tipos) | ✅ Núcleo; redefinido por C6 (páginas como sección) |
| 5 | **Cierre de año / promoción masiva** de todos los grupos al siguiente `anio_lectivo` con histórico | ✅ Verificado (2026-09-18) |
| 6 | **Certificados y constancias** (estudio, notas, paz y salvo) en PDF firmados — dentro del reporte | ✅ Verificado (2026-09-18) |
| 7 | **Reportes de asistencia institucional** (ausentismo por grupo/periodo) y **alertas automáticas al acudiente** | 🔲 |
| 8 | **Permisos/incapacidades/licencias de docentes** y control de horas no dictadas (o reemplazo) | 🔲 |

### Punto 1 — Logo/foto ampliable + reemplazo

- **Dónde se implementa:** solo frontend. `frontend/sia-identidad.js` (script
  compartido que ya carga logo y foto) + un **modal visor común** inyectado por
  ese mismo script; no se toca backend (los endpoints `POST /api/auth/foto` y
  `POST /api/instituciones/logo` ya existen).
- **Qué conlleva:**
  - Clic sobre el **logo del sidebar** → modal con la imagen en grande.
    - Si el usuario es **admin de esa institución** → botón **"Reemplazar logo"**
      que abre el explorador y sube la imagen nueva (mismo flujo `subirLogo`).
    - **Cualquier otro rol** de la institución → solo ver en grande, sin botón.
  - Clic sobre la **foto de perfil** (avatar del sidebar o vista previa del modal
    "Ver perfil") → modal con la imagen en grande.
    - Si es **su propia foto** → botón **"Reemplazar foto"** (flujo `subirFoto`).
    - Si es la foto de otra persona (avatares de listas) → solo ver en grande.
  - El modal visor es un overlay con fondo oscuro, imagen centrada y botón cerrar;
    se reutiliza para logo y foto (misma función `abrirVisor(url, onReemplazar)`).

### Punto 2 — Reporte del estudiante (3 páginas)

- **Dónde se implementa:**
  - **Migración `database/24_reporte_estudiantil.sql`**: tablas `reporte_compromisos`,
    `reporte_observaciones` y `reporte_paginas_personalizadas` (esta última se usa
    en el punto 4; conviene crearla ya). Cada una con `institucion_id`,
    `estudiante_id`, `creado_por`, `rol_creador`, texto, `fecha`, `estado`; la de
    páginas con `contenido_json` (bloques).
  - **Backend**: nuevo `src/controllers/reportes.controller.js` +
    `src/routes/reportes.routes.js` montado en `/api/reportes`:
    - `GET /api/reportes/estudiante/:estudianteId` → datos (nombre, documento,
      curso, materias con notas **actualizadas** y promedio, fallas del periodo,
      acudiente principal) — reutiliza la lógica de `resumen.controller.js`.
    - `GET/POST/PUT/DELETE /api/reportes/estudiante/:estudianteId/compromisos[/:id]`.
    - `GET/POST/PUT/DELETE /api/reportes/estudiante/:estudianteId/observaciones[/:id]`.
  - **Frontend**: nueva página `frontend/reporte-estudiante.html` (fondo blanco,
    plantilla institucional: membrete con logo + nombre de institución) con tres
    pestañas/páginas y su botonera de impresión (ver punto 3).
- **Puntos de entrada del reporte (dónde aparece el enlace):**
  - **Admin**: en `estudiantes.html`, botón **"Reporte" que queda ANTES de
    "Trasladar"** en cada fila.
  - **Docente**: en `mis-clases.html`, dentro del detalle de curso/estudiante,
    antes de **"Eliminar"**.
  - **Estudiante**: en `dashboard.html`, sección "Mis notas", al final →
    botón **"Mi reporte"**.
  - **Acudiente**: en `acudientes.html`, tarjeta de su acudido/al final →
    botón **"Mi reporte"** (la sección hoy son botones sin contenido; se deja
    el acceso listo para cuando se rellene y se documenta así).
- **Qué conlleva:**
  - **Página 1 — Datos del estudiante** (fondo blanco): nombre, documento,
    fecha de nacimiento si existe, curso/grupo, año lectivo, materias del curso
    con su nota por periodo (o promedio del último periodo) y promedio general,
    fallas del periodo e información del acudiente principal.
  - **Página 2 — Compromiso**: formulario para registrar **observación + compromiso**
    por mal desempeño o comportamiento (motivo, observación, compromiso, fecha,
    quién lo registra, campo de firma de estudiante/acudiente/director). Lista de
    compromisos previos con estado (pendiente/cumplido) y seguimiento (nuevo
    registro de cumplimiento).
  - **Página 3 — Observaciones individuales**: historial cronológico del
    estudiante; el **admin de la institución** y el **docente** (director del
    curso o quien dicta en él) pueden agregar; estudiante y acudiente solo lectura.
  - **Permisos finos** (backend, no solo UI): editar compromisos/observaciones =
    admin/superadmin de la institución **o** docente con acceso al curso del
    estudiante (director del grupo o co-docente); estudiante/acudiente = lectura
    de su propio expediente.

**Estado de implementación (2026-09-16):**
- Migración `database/24_reporte_estudiantil.sql` creada (3 tablas, idempotente).
- Backend `reportes.controller.js` + `reportes.routes.js` montado en `/api/reportes`
  con los endpoints del punto; permiso fino resuelto en el controller
  (`prepararContexto`, `puedeVerEstudiante`, `puedeGestionarEstudiante`);
  el reporte usa el **periodo activo** de la institución (promedio por materia y
  fallas acotadas al rango del periodo) y promedia con la regla de resumen
  (promedio simple entre materias). Incluye materias generales de la institución
  asignadas al curso vía `docentes_materias`.
- Frontend `frontend/reporte-estudiante.html` (3 pestañas, fondo blanco,
  membrete institucional con logo+DANE): página 1 datos/resumen, página 2
  compromisos (crear/marcar cumplido con seguimiento/eliminar), página 3
  observaciones (crear/eliminar); estudiante y acudiente en solo lectura
  (formularios ocultos). El acudiente con varios hijos elige al estudiante
  (`/api/matriculas/mis-hijos`).
- Entradas: `estudiantes.html` botón **Reporte antes de "Trasladar"**;
  `mis-clases.html` botón **Reporte** en el detalle del estudiante y antes de
  "Eliminar" en cada fila; `dashboard.html` "Mi notas" (estudiante),
  "Mi acudido"/"Notas" (acudiente) apuntan a `reporte-estudiante.html`.
- Punto 3 (ya implementado): botonera de descarga/impresión en
  `reporte-estudiante.html` (PDF + Word por página y "todo", con `application/pdf`
  vía pdfkit y `application/msword` para Word, endpoint
  `GET /api/reportes/estudiante/:estudianteId/imprimir`) y botón "Imprimir"
  (CSS `@media print` que imprime solo la hoja activa). Queda el editor de
  páginas personalizadas del punto 4.

### Punto 3 — Descarga por página y exportación completa

- **Dónde se implementa:** en `reporte-estudiante.html` (botonera "🗎 imprimir")
  y en `reportes.controller.js`.
  - **PDF**: se reutiliza `pdfkit` (igual que `boletin.controller.js`); endpoint
    `GET /api/reportes/estudiante/:estudianteId/imprimir?paginas=1|2|3|todas`.
  - **Word**: cada página (ya en HTML con estilos embebidos) se descarga como
    `.doc` mediante el encabezado `application/msword`/`text/html` (patrón
    compatible con Word sin dependencias extra).
- **Qué conlleva:**
  - Por página: botones **PDF** y **Word** individuales.
  - **Exportación completa**: botón **"Descargar todo"** → genera **un PDF
    combinado** con las páginas 1, 2, 3 y las personalizadas (punto 4) en orden,
    con membrete, número de página y pie; alternativa: `.zip` con los `.doc`
    individuales (se decide al implementar; el PDF combinado es el más pulcro).
  - Cabecera/plantilla institucional reutilizada en todas las salidas.

> ⚠️ **Redefinido por la Ronda C (2026-09-18):** ver **Punto C5 — descargas con
> selector de registros y formato original** (el "Descargar todo" pasa a ser un
> selector de compromisos/observaciones/páginas) y **Punto C6** (páginas
> personalizadas). Este texto queda como diseño original/histórico.

### Punto 4 — Editor de páginas adicionales (cuadros y textos)

- **Dónde se implementa:** cuarta sección de `reporte-estudiante.html`
  ("Páginas personalizadas") + CRUD `GET/POST/PUT/DELETE
  /api/reportes/estudiante/:estudianteId/paginas[/:id]` alimentando
  `reporte_paginas_personalizadas.contenido_json`.
- **Qué conlleva:**
  - **Agregar página** con título/nombre de página.
  - **Bloques editables** dentro de cada página, de dos familias:
    - **Texto**: título (H1/H2/H3), párrafo, lista con viñetas; con controles de
      alineación (izq/centro/der), tamaño (pequeño/normal/grande), negrita,
      cursiva y color.
    - **Cuadro/tabla**: número de filas y columnas, celdas editables, color de
      fondo, bordes y alineación del texto de la celda.
  - El editor es un **mini-maquetador vanilla JS** (sin librerías externas) que
    mantiene una lista de bloques en JSON y muestra una **vista documento** en
    blanco tal como saldrá impresa (incluida en la exportación de los puntos 3 y 6).
  - Ordenar los bloques (subir/bajar), duplicar y eliminar.

> ⚠️ **Redefinido por la Ronda C (2026-09-18):** ver **Punto C6 — páginas
> personalizadas como sección**, con renombrar, corrección del guardado y paleta
> de bloques completa. Este texto queda como diseño original/histórico.

### Punto 5 — Cierre de año / promoción masiva

- **Dónde se implementa:**
  - **Backend**: ampliación de `src/controllers/matriculas.controller.js` (o nuevo
    `promocion.controller.js`) + rutas en `matriculas.routes.js`:
    - `GET /api/matriculas/promocion/previa?anio_destino=` → simulación: qué
      grupos existen hoy, cuántas matrículas activas tiene cada uno y a qué grupo
      destino pasarían (para confirmar antes de ejecutar).
    - `POST /api/matriculas/promocion` (solo admin/superadmin, idempotente) →
      ejecuta el cierre del año lectivo vigente.
  - **Migración `database/25_promocion_anual.sql`**:
    - Ampliar el ENUM de `matriculas.estado` con `'promovido'` (las matrículas
      viejas no se borran: quedan como histórico).
    - Añadir `grupos.anio_lectivo` (o una tabla de equivalencias origen→destino)
      para saber qué grupos son del año nuevo.
  - **Frontend**: en `panel-admin.html` y/o `academico.html`, sección
    **"Promoción / cierre de año"** con: selector de año destino, previsualización
    (tabla origen→destino con conteos), confirmación y resumen del resultado.
- **Qué conlleva:**
  - Para cada grupo actual con matrículas activas, el admin elige/confirma el
    **grupo destino del año siguiente** (por defecto: se crea el mismo grupo con
    el nuevo año, con opción de cambiar de grado, ej. 501 → 601).
  - Se crean las **nuevas filas de matrícula** (`estado='activa'`, nuevo
    `anio_lectivo` y `grupo_id`) para cada estudiante matriculado; las filas del
    año que cierra pasan a `estado='promovido'`.
  - **Histórico conservado**: notas, asistencia y boletines del año anterior
    quedan intactos (nada se borra; los reportes/certificados apuntan por
    `anio_lectivo`).
  - El **código de matrícula** de los grupos nuevos se regenera; la asignación de
    **materias/docentes** del grupo destino queda para configuración del admin en
    el nuevo año (opcional: copiar mediante check si el destino es "el mismo
    curso del año siguiente").
  - **Bloqueos**: no se puede ejecutar dos veces para el mismo grupo+año (la
    UNIQUE `(estudiante_id, grupo_id, anio_lectivo)` ya existe) y se exige que
existan el año destino / grupos destino antes de correr.

> **Implementado (2026-09-17):**
> `database/25_promocion_anual.sql` (ENUM `promovido`, `grupos.anio_lectivo`,
> UNIQUE de 3 columnas — migración idempotente compatible con MySQL 8 y MariaDB,
> sin usar `RENAME INDEX`). Backend en `src/controllers/promocion.controller.js`
> (`GET /api/matriculas/promocion/previa`, `POST /api/matriculas/promocion`)
> con permisos admin/superadmin, idempotencia (salta filas existentes) y
> soporte para código de curso personalizado (`codigo_destino` "601") o grupo
> destino explícito (`grupo_destino_id`). `academico.controller.js` actualizado
> para incluir `anio_lectivo` en creación y listado de grupos. Frontend: sección
> "Promoción y cierre de año" añadida a `panel-admin.html` (selector de año,
> tabla origen→destino con selectable por curso/código, checkbox de copiar
> configuración docente-materia, resumen y confirmación). Pruebas con datos
> reales: previsualización + ejecución + bloqueo de re-ejecución, todo OK.

### Punto 6 — Certificados y constancias (PDF firmados)

- **Dónde se implementa:** dentro del **reporte** (punto 2): en
  `reporte-estudiante.html` una sección **"Certificados"** con los tipos
  **estudio**, **notas** y **paz y salvo** (de estudio). Backend en
  `reportes.controller.js` (nuevo `certificado` helper reutilizando el pipeline
  PDF de `boletin.controller.js`): `GET
  /api/reportes/estudiante/:estudianteId/certificado/:tipo?formato=pdf`.
  Migración de soporte: `certificados` (id, estudiante_id, tipo, consecutivo,
  generado_por, archivo_id, created_at) + campos de firma en
  `configuracion_sistema` o `instituciones` (`cargo_firma`, nombre de quien firma).
- **Qué conlleva:**
  - Membrete oficial (logo + nombre + DANE si existe + sede), consecutivo
    correlativo por certificado.
  - **Constancia de estudio**: "el estudiante X cursa Y en el año Z…".
  - **Certificado de notas/promedio**: materias, notas por periodo y promedio.
  - **Paz y salvo**: solo se genera si el estudiante **no** tiene compromisos
    pendientes ni observaciones sin resolver (definición académica, ya que el SIA
    no maneja pagos); imprime la fecha de emisión.
  - **Firma digital/impresa**: nombre y cargo de quien firma (por defecto el
    admin de la institución, editable en configuración); espacio para firma
    manuscrita al imprimir.
  - Registro en el historial `certificados` y archivo PDF en `storage/` (mismo
    patrón de boletines) para re-descarga.

> **Implementado (2026-09-17):**
> `database/26_certificados.sql` (aplicada): enum `archivos.tipo` + `'certificado'`;
> campos de firma `instituciones.nombre_firma`/`cargo_firma`/`documento_firma`;
> tabla `certificados` (id, institucion_id, estudiante_id, tipo ENUM
> `estudio|notas|paz_y_salvo`, consecutivo, anio_lectivo, generado_por,
> archivo_id, created_at, UNIQUE `(institucion_id, consecutivo)`; FKs con
> `ON DELETE CASCADE`). Nota: se crea con `DEFAULT CHARSET=utf8mb4` **sin
> `COLLATE`** porque las tablas referenciadas usan `utf8mb4_general_ci` (si no,
> errno 150). Backend en `src/controllers/reportes.controller.js`: helpers
> `generarPdfCertificado`, `detalleNotasPorMateria`, `siguienteConsecutivo`
> (MAX+1 `FOR UPDATE` en transacción), `resolverFirma`, `pendientesPazYSalvo`;
> exports `certificado`, `historialCertificados`, `descargarCertificado`,
> `actualizarFirma`. Rutas en `reportes.routes.js`: `PUT /api/reportes/certificados/firma`
> (admin/superadmin), `GET .../certificados/:id/descargar`,
> `GET .../estudiante/:estudianteId/certificados` (historial + firma) y
> `GET .../estudiante/:estudianteId/certificado/:tipo`. Frontend: pestaña
> **"Certificados"** (tab 5) en `reporte-estudiante.html` con expedición de los 3
> tipos, historial re-descargable y formulario de firma (solo admin).
> Pruebas con datos reales (admin y estudiante): los 3 tipos generan PDF válido
> (`%PDF`, ~96 KB) y descargan 200; consecutivos correlativos 000001/000002/…;
> paz y salvo devuelve **409** con compromiso pendiente (y `estudio` sí se expide);
> permisos: estudiante no puede expedir ni editar firma (403) pero ve historial y
> descarga. Dos bugs corregidos durante la prueba: (1) `anio_lectivo` mostraba
> `undefined` en la constancia (`d.anio_lectivo`→`d.anioLectivo`); (2) el
> certificado de notas no pintaba valores: la búsqueda por tipo usaba `v.tipo`
> en vez de `v.tipo_nota` y el `SELECT` de `detalleNotasPorMateria` omitía
> `peso_pct` (promedio por materia siempre `null`).

### Correcciones UI (2026-09-18)

- **Logo sin fondo blanco:** el `fill="#fff"` del SVG (`static/logo/SIA_LOGO.svg`)
  pasó a `fill="none"` para que la figura se integre sin recuadro blanco. Añadido
  cache-busting (`?v=2`) en las 14 páginas + `sia-identidad.js` y `Cache-Control:
  no-cache` en `app.js` para `.html/.js/.css/.svg`.
- **Fondo duplicado en secciones embebidas:** al navegar dentro de `panel-admin` o
  `panel-superadmin`, la sección cargada por iframe pintaba su propia `.sia-fondo`
  (foto + overlay `::after`) encima del fondo del panel anfitrión. La corrección
  añade `html.shell .sia-fondo{display:none}` a 9 páginas (`dashboard`, `academico`,
  `estudiantes`, `comunicados`, `calendario`, `acudientes`, `mis-clases`,
  `llamadas-docente`, `llamadas-estudiante`); las demás (`configuracion`,
  `instituciones`) ya lo tenían. Los hosts (`panel-admin`, `panel-superadmin`) no
  necesitan la regla porque nunca se cargan con `?shell=1`.

### Punto 7 — Reportes de asistencia institucional + alertas

- **Dónde se implementa:**
  - **Backend**: ampliar `src/controllers/asistencia.controller.js` + rutas en
    `asistencia.routes.js`:
    - `GET /api/asistencia/reporte/grupo/:grupoId?periodo_id=` → por estudiante:
      presentes/retardos/faltas/justificadas y % de cada uno en el periodo,
      desglosado por materia.
    - `GET /api/asistencia/reporte/institucion?grupo_id=&periodo_id=` → resumen
      institucional por grupo (ausentismo agregado).
    - **Alertas**: al guardar/asentar asistencia, si un estudiante cruza el umbral
      (faltas injustificadas en el periodo o consecutivas, configurable) se dispara
      `crearNotificacion` al **acudiente** principal (servicio de notificaciones ya
      existente) y se registra la alerta en una tabla para no repetir.
  - **Migración `database/26_asistencia_reportes.sql`**: umbral en
    `configuracion_sistema` + tabla `alertas_asistencia` (estudiante_id,
    acudiente_id, tipo, detalle, creado_en) para evitar duplicados.
  - **Frontend**: en `panel-admin.html` (o pestaña "Asistencia" de
    `academico.html`): filtros grupo/periodo, tabla consolidada y botón de
    exportación (templete de reporte). En el dashboard del **acudiente**: tarjeta
    de alertas de asistencia de su acudido.
- **Qué conlleva:** la tabla `asistencia` ya registra `estado`
  (presente/retardo/falta/justificada) y `materia_id`; solo falta agregar el
  consolidado por periodo (filtrando por fechas como hace `resumen`) y el disparo
  de alertas. Reutiliza el patrón de agrupación del punto 2 (reporte).

### Punto 8 — Permisos/incapacidades/licencias de docentes y horas no dictadas

- **Dónde se implementa:**
  - **Migración `database/27_ausencias_docentes.sql`**: tabla `ausencias_docentes`
    (id, institucion_id, docente_id, tipo ENUM
    `permiso/incapacidad/licencia/otro`, fecha_inicio, fecha_fin, motivo, estado
    ENUM `pendiente/aprobada/negada`, aprobado_por, created_at).
  - **Backend**: CRUD en `src/controllers/academico.controller.js` (o nuevo
    `docente-ausencias.controller.js`): rutas
    `GET/POST/PUT/DELETE /api/academico/docentes/:id/ausencias[/:id]` (admin
    gestiona/aprueba; el docente lee las suyas). Cálculo de **horas no dictadas**:
    cruzar las franjas del horario del docente (`docentes_materias` ↔ `horario`)
    con el rango de la ausencia.
  - **Frontend**: sección **"Ausencias de docentes"** en `academico.html` (o
    `panel-admin.html`): registro, lista filtrable por docente/rango/estado,
    aprobar/negar, y el conteo de horas no dictadas; el **docente ve sus propias
    ausencias** desde `dashboard.html`/`mis-clases.html`.
- **Qué conlleva:**
  - Alta de ausencias con tipo, rango de fechas, motivo y estado (aprobación por
    admin antes de contar horas salvo tipo 'otro').
  - **Control de horas no dictadas**: por franja del horario tocada → marcar la
    franja como `no dictada` + opción de **reemplazo** (asignar a otro docente de
    la institución) o dejarla marcada sin reemplazo.
  - La suma de horas no dictadas por docente/periodo alimenta un pequeño reporte
    junto al punto 7 (y el horario existente no cambia).

---

## Ronda C — 2026-09-18: priorización reporte, mis clases y mensajería

> Tareas nuevas reportadas por el usuario el 2026-09-18, **ordenadas de mayor a
> menor prioridad** (primero privacidad/permisos y bloqueos, luego funcionamiento
> del reporte, y por último pulidos de UX). Los puntos 1-4 son **correcciones
> urgentes**; 5-7 ajustan el reporte del estudiante (redefinen los puntos 3 y 4 de
> la Ronda B); 8-9 son mejoras de interacción.

| # | Tarea | Estado |
|---|---|---|
| 1 | **Permisos:** el docente ya **no** puede asignar docentes a una materia | 🔵 Implementado (verificación en navegador pendiente) |
| 2 | **Mensajería:** el bloqueo "permitir mensajes abiertos" se debe aplicar también al **enviar** | 🔵 Implementado (verificación en navegador pendiente) |
| 3 | **Mensajería:** el súperadmin solo puede hablar con **administradores o docentes** (de cualquier institución) | 🔵 Implementado (verificación en navegador pendiente) |
| 4 | **Identidad:** corregir que la foto de un docente aparezca en un estudiante | 🔲 |
| 5 | **Reporte — Descargas:** poder elegir **qué** compromisos/observaciones descargar, cada uno en su hoja con su formato original (redefine el "Descargar todo") | 🔵 Implementado (verificación en navegador pendiente) |
| 6 | **Reporte — Páginas personalizadas:** guardar la página como **sección nueva** del reporte, poder **renombrarla** y que "agregar bloque" ofrezca **todas las figuras** de las pestañas (cajas grises, líneas, cajas negras numeradas, tablas…) | 🔵 Implementado (2026-09-29; verificación en navegador pendiente) |
| 7 | **Reporte — Datos y resumen:** mostrar el **director de curso** y que los datos reflejen siempre las últimas ediciones de notas/asistencia | 🔵 Implementado (2026-09-29; verificación en navegador pendiente) |
| 8 | **Mis clases:** el detalle de un curso debe **abrir/cerrar** al pulsarlo y al abrir otro se cierra el anterior | 🔵 Implementado (2026-09-29; verificación en navegador pendiente) |
| 9 | **Mensajería:** la lista solo conserva **contactos con los que ya hay mensajes**, el buscador ("Buscar") encuentra al resto y se **elimina el botón "+ Nuevo"** | 🔵 Implementado (2026-09-29; verificación en navegador pendiente) |

### Punto C1 — Permisos: el docente ya no puede asignar docentes a una materia

- **Qué se pide:** hoy un docente (director de curso) puede asignar a **otro
  docente** dentro de una materia desde "materias de tu curso", y eso debe
  eliminarse: asignar docentes a materias queda **solo para admin/superadmin**.
- **Dónde se implementa:** `src/routes/academico.routes.js:53` (`POST
  /materias/:id/docentes` hoy permite `soloRoles('admin','superadmin','docente')`)
  y `agregarDocenteMateria` en `src/controllers/academico.controller.js:955`.
- **Qué conlleva:** quitar `'docente'` de esa ruta (y de la UI en
  `frontend/mis-clases.html`, sección "materias de tu curso"); revisar que
  `listarDocentesMateria`/`quitarDocenteMateria` mantengan `'docente'` **solo
  cuando el docente es el propio asignado** (no para gestionar el listado). Si se
  quiere conservar que el director vea sus materias, la escritura de la
  asignación queda restringida a `admin`/`superadmin`.

> **Implementado (2026-09-18):** `academico.routes.js:52-54` — `POST
> /materias/:id/docentes` y `DELETE /materias/:id/docentes/:docenteId` pasan a
> `soloRoles('admin','superadmin')` (el GET sigue permitiendo `docente` para
> lectura). En `mis-clases.html` se quitó la barra "Asignar docente a una
> materia", el texto del card y las funciones `asignarDocenteMateriaDirector`,
> `cargarDocentesInstitucion` y la variable `docentesInstitucionCache`.
> `node --check` OK en rutas y en el JS extraído de la página. Pendiente:
> verificación en navegador (403 al intentar asignar como docente).

### Punto C2 — Mensajería: bloqueo "permitir mensajes abiertos" efectivo al enviar

- **Qué se pide:** cuando el admin cierra la opción de "mensajes abiertos" (que
  cualquier persona le pueda escribir), **nadie** de la institución debe poder
  seguir escribiéndole, tampoco a través de un chat ya iniciado.
- **Bug confirmado:** `permitir_mensajes_abiertos` (columna en `chat_config`,
  `database/22_chat_mensajeria.sql:46-51`) solo se consulta al **abrir** el chat
  (`validarDestino`, `chat.controller.js:212-219`) y al **buscar** (rama docente,
  `491-503`), **pero no al enviar**. `exports.enviar` (`chat.controller.js:633-672`)
  nunca llama a `configAbierto()`, así que un docente/estudiante con un chat ya
  abierto sigue escribiendo tras cerrar el admin la opción.
- **Qué conlleva:**
  - En `enviar`, si el destinatario es el admin de la institución del chat y
    `configAbierto()` es `false`, rechazar con 403 (`"Este chat está bloqueado
    por el administrador."`). Cubre los roles docente, estudiante y acudiente.
  - Frontend: `chat-drawer.js:273-288` descarta la respuesta del envío (ignora
    4xx en silencio); hacer que `peticion`/`enviarMensaje` muestren el error del
    backend para que el usuario vea el porqué del bloqueo.
  - Al abrir un chat ya existente bloqueado, `validarDestino` debe usar el mismo
    criterio (no solo al crear).

> **Implementado (2026-09-18):** `chat.controller.js` — en `exports.enviar`, antes de
> insertar, si el chat es `personal`, quien envía no es `admin/superadmin`, el
> destinatario es `adminDeInstitucion(chat.institucion_id)` y
> `configAbierto(institucion_id)` es `false` → 403 "Este chat está bloqueado por el
> administrador." (cubre docente, estudiante y acudiente, con chat ya iniciado).
> `validarDestino` ya aplicaba ese criterio en `abrir` tanto al crear como al
> reabrir. Frontend `chat-drawer.js` `enviarMensaje`: ahora lee la respuesta; si
> `res.ok` es falso restaura el texto y muestra `res.mensaje` (antes ignoraba 4xx en
> silencio). `node --check` OK en ambos. Pendiente: verificación en navegador
> (cerrar mensajes abiertos y escribir al admin como docente de un chat existente).

### Punto C3 — Mensajería: el súperadmin solo habla con administradores o docentes

- **Qué se pide (confirmado):** el súperadmin puede iniciar **chat directo** con
  cualquier **administrador o docente** (de cualquier institución), pero **nunca**
  con estudiantes/acudientes.
- **Estado actual:** el súperadmin solo tiene el canal `tipo='institucion'` (habla
  con la institución vía su admin) y su búsqueda devuelve solo instituciones
  (`chat.controller.js:446-457`); no abre chats personales (`189-191`).
- **Qué conlleva:**
  - `exports.buscar` rama superadmin: además de instituciones, buscar usuarios de
    rol `admin` o `docente` (de cualquier institución activa).
  - `validarDestino` / `exports.abrir` rama superadmin: permitir crear chat
    `personal` solo cuando el destino es `admin` o `docente` (403 si es
    estudiante/acudiente u otro). La lista `conversaciones` debe incluir esos
    chats personales además de los institucionales.
  - Recordar el detalle existente: `superadminId()` (`chat.controller.js:35-40`)
    usa el superadmin más antiguo; con varias cuentas súperadmin los canales
    quedarían ligados a una sola — revisar si conviene resolverlo aquí.

> **Implementado (2026-09-18):** `chat.controller.js` — `buscar` rama superadmin
> devuelve además de instituciones los usuarios `admin`/`docente` (de cualquier
> institución activa, con su institución en el subtítulo) como `tipo:'personal'`;
> `validarDestino` rama superadmin permite abrir chat personal solo con
> `admin`/`docente` activos (403 si es estudiante/acudiente u otro); `conversaciones`
> rama superadmin incluye ahora los chats personales además de los institucionales
> (la deduplicación `unicos` y `detalleConversacion`/`counterpart` ya funcionaban para
> ambos). Frontend `chat-drawer.js`: placeholder y mensaje vacío del súperadmin
> actualizados; el render de resultados y `abrirNuevoChat` ya soportaban `personal`.
> `node --check` OK. Pendiente: verificación en navegador (buscar a un docente de otra
> institución, abrir chat, y confirmar 403 al intentar con un estudiante).

### Punto C4 — Identidad: corregir la foto del docente que aparece en el estudiante

- **Qué se pide:** la foto de perfil cargada a un docente aparece también en un
  estudiante; debe cada usuario mostrar **su propia** foto.
- **Estado actual:** los avatares usan `usuarios.foto_url` a través de la sesión
  (`frontend/sia-identidad.js`: `leerUsuario`, `aplicarAvatar:174`,
  `pintarPreviewFoto`, `pintarInicialAvatar`); sin foto se pintan iniciales.
  Pedir al usuario reproducir el caso (¿sidebar del estudiante, listados, o
  reporte?) y verificar en BD si `foto_url` quedó compartida entre esas cuentas
  (sospecha: la misma foto subida quedó en más de un `usuarios.foto_url`, o el
  avatar de listados usa la foto del usuario en sesión en lugar de la de cada
  fila).
- **Qué conlleva:** reproducir → corregir el origen (datos o selección de avatar
  por fila) → revisar que al reemplazar la foto no se propague a otras cuentas.

### Punto C5 — Reporte: descargas con selector de registros y formato original

> **Redefine el punto 3 de la Ronda B** ("Descarga por página"): al descargar se
> debe elegir **qué** registros entran, no "todo o nada".

- **Qué se pide:** hoy "descargar" de un compromiso saca la **hoja en blanco**
  (sin el registro guardado) y "Descargar todo" es ambiguo (¿qué genera si hay
  varios compromisos/observaciones/páginas?). El sistema debe **contar** cuántos
  compromisos y observaciones existen y, al descargar, dejar **seleccionar cuáles**
  incluir; en pantalla cada registro se ve como texto, pero **en la descarga debe
  verse tal cual el formato original de la hoja** (como la página formateada en la
  que se hizo la observación).
- **Dónde se implementa:** `frontend/reporte-estudiante.html` (botonera de
  descarga) + `reportes.controller.js` (`generarPdfReporte:1176`,
  `seleccionSecciones:1163`, `imprimir:1401`) + rutas de compromisos/observaciones
  ya existentes (`listarCompromisos:497`, `listarObservaciones:627`).
- **Qué conlleva:**
  - Botón **"Descargar"** por cada registro (lista de compromisos y observaciones)
    que genera **ese registro en su hoja con su formato original**
    (reutilizando el render de página: `pdfSeccionPagina`/`pdfTabla`/…).
  - Reemplazar **"Descargar todo"** por un **selector**: ventana con la lista de
    páginas, compromisos y observaciones con **casillas**; el usuario marca los que
    quiere y se genera **un solo PDF** con cada uno en su propia hoja (páginas
    normales 1-3 + personalizadas + registros seleccionados). Opción "seleccionar
    todo" conserva el comportamiento de "todo". Se puede ofrecer igual en Word.
  - Los datos de cada registro se toman de su fila en `reporte_compromisos` /
    `reporte_observaciones` (nunca de la plantilla en blanco).

> **Implementado (2026-09-18):** `reportes.controller.js` — `seleccionSecciones` ahora
> acepta lista separada por comas de referencias: `1|2|3`, `pg:<id página>`,
> `c:<id compromiso>`, `o:<id observación>` (mantiene `'todas'` y el `id` plano de
> página como compatibilidad). Nuevos `pdfSeccionCompromiso`/`pdfSeccionObservacion`
> (cada registro en su propia hoja con su formato) y `wordTarjetaCompromiso`/
> `wordTarjetaObservacion` (Word), cableados en `generarPdfReporte` y
> `generarHtmlWord`; `imprimir` pasa los arrays a `seleccionSecciones`.
> `frontend/reporte-estudiante.html` — botón "Descargar" por cada compromiso y
> observación (refs `c:`/`o:`); "Descargar…/Exportar…" abren un selector modal con
> casillas (páginas 1-3 + personalizadas + registros), formato PDF/Word, "Marcar
> todo", y un solo PDF/Word con lo marcado. `node --check` OK en controller y JS
> extraído de la página. Pendiente: verificación en navegador (varios registros
> usando "Marcar todo" + botón de descarga individual).

### Punto C6 — Reporte: páginas personalizadas como sección, con nombre y paleta completa

> **Redefine el punto 4 de la Ronda B** ("Editor de páginas adicionales").

- **Qué se pide:**
  - **Renombrar** la página (que no quede el genérico "páginas personalizadas").
  - El **guardado no funciona** (bug: al guardar no persiste / no aparece nada).
  - Al guardar, la página debe **agregarse como una sección más** del reporte (una
    pestaña propia, igual que "Datos y resumen", "Compromiso", "Observaciones") y
    el grupo "Páginas personalizadas" queda como categoría que las agrupa.
  - **"Agregar bloque"** debe ofrecer **todas las figuras/tipos de contenido** que
    el sistema ya usa en las pestañas: cajas grises, líneas/separadores, cajas
    negras con números (las casillas numeradas de notas), tablas, títulos,
    párrafos y listas.
- **Dónde se implementa:** CRUD de páginas ya existe
  (`reportes.controller.js`: `crearPagina:786`, `actualizarPagina:822`,
  `sanitizarBloques:394`, `parseContenido:437`) y `reporte-paginas-personalizadas`
  en `database/24_reporte_estudiantil.sql:55-69`; frontend en
  `frontend/reporte-estudiante.html` (tab "Páginas personalizadas").
- **Qué conlleva:**
  - Corregir el flujo **guardar** (endpoint `POST/PUT /paginas` + refresco de
    pestañas) y añadir control de edición de nombre del título de página.
  - Renderizar la página guardada como **pestaña extra** del reporte y como página
    en las descargas (puntos 3/5).
  - Ampliar el paleta de bloques: **caja gris** (fondo gris con texto),
    **línea separadora**, **caja negra numerada** (recuadro oscuro con número o
    contador), **tabla redimensionable**, **título/encabezado**, **párrafo** y
    **lista**; con alineación y tamaño (estilo mini-maquetador vanilla JS ya
    planteado). Reutilizar las funciones de pintado que ya producen esos bloques en
    las páginas del reporte (`pdfRenderBloque:1118`, `pdfTarjeta:968`, `pdfTabla:934`).

> **Implementado (2026-09-29):** `frontend/reporte-estudiante.html` — `nuevaPagina()`
> pide el **nombre** al crear (y enfoca el input del título); `cargarPaginas()` ahora
> **conserva** las páginas nuevas sin guardar (`_nueva`) y las ediciones locales
> (`_sucio`) al refrescar tras un guardado (antes cualquier save botaba el trabajo
> pendiente); cada página guardada se agrega como **pestaña propia** (`#tabsPaginas`)
> y como **hoja del reporte** (`#paginasSecciones`) re-editables en la tab
> "Páginas personalizadas"; paleta "Agregar bloque" ampliada con **caja gris**,
> **línea separadora** y **cuadro numerado** (además de título/párrafo/lista/tabla),
> renderizadas en pantalla y en las descargas PDF (`pdfRenderBloque`) y Word
> (`wordBloqueHTML`) tras ampliar `sanitizarBloques` en `reportes.controller.js`.

### Punto C7 — Reporte: director de curso en Datos y resumen + datos siempre frescos

- **Qué se pide:** la página 1 (Datos y resumen) debe mostrar el **nombre del
  director de curso** del estudiante; y cualquier edición (nota, asistencia,
  matrícula, materias) debe **reflejarse al instante** en el reporte.
- **Dónde se implementa:** `reunirDatosReporte` (`reportes.controller.js:131-296`)
  ya trae curso y materias; el director está en `grupos.director_id` (relación
  con `usuarios` vía `docentes_materias`/grupo) — el campo se expone en
  `resumen.controller.js`. Frontend: pestaña 1 de `reporte-estudiante.html`.
- **Qué conlleva:**
  - Añadir `director` (nombres del usuario con `id = grupos.director_id`) al
    payload del reporte y mostrarlo en la página 1 (y en la descarga PDF/Word).
  - Garantizar que el reporte **consulte siempre en vivo** (sin caché en el
    frontend) y refrescar datos al abrir/re-ingresar al reporte; verificar que
    editar nota/asistencia se vea al volver a entrar sin reiniciar el server
    (los endpoints ya leen de BD).

> **Implementado (2026-09-29):** `reportes.controller.js` — `reunirDatosReporte`
> consulta el **director de curso** (`grupos.director_id` → `usuarios`) y lo expone
> como `director` en el payload del reporte; se muestra en la pestaña 1
> (`dDirector` en `reporte-estudiante.html`) y en las descargas PDF (`pdfSeccion1`)
> y Word (`wordSeccion1`). Datos siempre frescos: `mostrarTab(1)` re-fetcha y
> `refrescarDatos()` repinta la página 1 (notas/asistencia recién editadas se ven
> al volver, sin reiniciar el server).

### Punto C8 — Mis clases: acordeón de cursos

- **Qué se pide:** en "Tus cursos", al pulsar un curso se abre el detalle con toda
  su información; hoy **al pulsarlo otra vez no se cierra**, y si hay varios cursos,
  al abrir uno **el anterior queda abierto**. Debe: (a) volver a pulsar el mismo →
  cerrar; (b) pulsar otro → cerrar el que estaba abierto y abrir el nuevo.
- **Dónde se implementa:** `frontend/mis-clases.html` (tarjetas de "Tus cursos" y
  su detalle — función que hace show/hide del detalle del curso).
- **Qué conlleva:** comportamiento de **acordeón**: un único elemento expandido a
  la vez + toggle en el mismo elemento (`classList.toggle` del detalle y quitar la
  clase de los demás). Revisar que el scroll/posición al alternar no se pierda.

> **Implementado (2026-09-29):** `abrirCurso()` en `mis-clases.html` — volver a
> pulsar el curso abierto lo **cierra** (vuelve a la lista, `cursoActivo = null`)
> y al abrir otro se cierra el anterior (`cerrarCardsCurso`); la tarjeta pulsada
> queda **resaltada** (`marcarCursoCard`) y al cerrar se hace scroll a "Tus cursos".

### Punto C9 — Mensajería: lista solo con contactos con mensajes + buscador "Buscar"

- **Qué se pide:**
  - El panel de mensajes **no** debe listar a todos los usuarios: solo se quedan
    guardados los contactos con los que **ya se han enviado mensajes**; el resto se
    encuentra por el **buscador**.
  - Eliminar el botón **"+ Nuevo"** (el buscador ya está al lado y cumple esa
    función).
  - Unificar el texto: el placeholder frío de "Busca a tu docente…" pasa a decir
    solo **"Buscar"** (porque puede ser docente o administrador).
- **Dónde se implementa:** `GET /api/chat/conversaciones`
  (`chat.controller.js:363-437`) y `buscar` (`440-534`); frontend
  `frontend/chat-drawer.js` (`mensajeVacio:158-164`, placeholders `99-107`,
  `panelNuevoParaUsuario:262-270`) y `chat-drawer.html` (botón `#siaChatNuevo`,
  línea 18).
- **Qué conlleva:**
  - Filtrar `conversaciones` para mostrar solo chats con **al menos un mensaje**
    (y, de paso, limitar a las más recientes, p. ej. últimas 20, con paginación,
    que hoy no existe y además hace 3 queries por chat en serie → N+1;
    `425-427`).
  - Quitar `#siaChatNuevo` y su lógica (`panelNuevoParaUsuario`), dejando el input
    de búsqueda siempre disponible; texto del estado vacío → "Usa el buscador para
    encontrar personas." y placeholder genérico "Buscar…".

> **Implementado (2026-09-29):** `chat.controller.js` `conversaciones` — filtra con
> `EXISTS (SELECT 1 FROM chat_mensajes ...)` para listar **solo chats con mensajes**
> y limita a los más recientes (`LIMIT 25` por consulta); se elimina el auto-creado
> del chat vacío admin↔superadmin de la lista. Frontend `chat-drawer.js` —
> eliminados el botón **"+ Nuevo"** y `panelNuevoParaUsuario`; placeholder unificado
> a **"Buscar…"** y estado vacío a **"Usa el buscador para encontrar personas."**.

---

## 1-9. Historial y pendientes detallados
*(el contenido original del documento continúa abajo)*

> **Quinta pasada (2026-08-29):** del pendiente de la auditoría de login
> (sección 0.2), se hicieron:
> - **Punto 4 — rate-limit por IP en el login**: middleware
>   `src/middleware/rateLimit.middleware.js` con `express-rate-limit`,
>   aplicado a `POST /api/auth/login`, configurables en `.env`, y soporte
>   `TRUST_PROXY` en `src/app.js`. Verificado en vivo (20 intentos OK,
>   21º → 429).
> - **Punto 5 — unificar mensajes del flujo de acceso**: mensajes de
>   bloqueo por intentos unificados en el backend, y avisos del login
>   alineados con el resto de pantallas. Ver "Punto 5" en la sección 0.2.
>
> **Sexta pasada (2026-08-30):** se cerró el **punto 3 (revocación de
> sesiones JWT)** — ver "Punto 3" en la sección 0.2. Además se **conectó
> el botón "+ Realizar evaluación"** de la tarjeta "Trabajos" (sección 4)
> al plan de evaluación/hoja de calificación con un selector de materia,
> permitiendo al director de curso VER las evaluaciones de su curso aunque
> no dicte la materia (guardar notas sigue solo para co-docentes/admin).
> Se **construyó el flujo de tareas** completo ("+ Asignar tarea", sección
> 4): backend CRUD + entregas de estudiantes + calificar/feedback, y
> frontend de docente (`mis-clases.html`) y de estudiante (`dashboard.html`).
> El resto de pendientes del ROADMAP siguen en la sección 8.

**Última actualización:** 2026-08-19 (tercera pasada), tras auditar de
nuevo el código real del zip subido más reciente contra lo que este
documento decía. La segunda pasada había encontrado que la sección 2
(materias por curso), marcada por la primera auditoría como "solo existe
la migración, falta todo el código", **en realidad ya está construida
por completo**. Esta tercera pasada verificó la sección 7 (calendario),
que seguía marcada como "🔲 pendiente, sin código, esperando que el
usuario elija estilo": **también está construida y confirmada por
completo** — migración `17_calendario_eventos.sql`,
`calendario.controller.js`, `calendario.routes.js` montada en
`/api/calendario`, y `calendario.html` enlazado desde el menú de
navegación de `dashboard.html`, `academico.html`, `mis-clases.html`,
`panel-admin.html` y `comunicados.html`. Ver sección 0.0 para el detalle
de ambas correcciones.

> **Cuarta pasada (2026-08-28):** una auditoría del flujo de login encontró
> que el rol `acudiente` **no tenía forma de existir** (ninguna pantalla crea
> cuentas con ese rol ni inserta en `acudientes_estudiantes`), que la única
> "recuperación de contraseña" era un `mailto:` muerto, y otros pendientes de
> seguridad. Se construyeron los dos primeros hallazgos en esta misma sesión
> (flujo completo de acudientes + recuperación real de contraseña) y quedaron
> documentados como pendientes los demás (sesiones JWT sin revocación,
> rate-limit solo por cuenta, mensajes de error descoordinados). Ver sección
> 0.2 para el detalle. También se agregó un **set fijo de cuentas de prueba
> por rol** (migración `18_usuarios_prueba.sql` + README sección 2.1) para no
> seguir creando roles sueltos en cada prueba.

> ⚠️ **Este documento se ha desincronizado de la realidad más de una vez.**
> Varias secciones han descrito controllers, rutas y pantallas con lujo de
> detalle (nombres de función, endpoints, líneas de código) que en un
> momento dado no coincidían con el código real — a veces por describirse
> antes de escribirse, otras veces (como la sección 2 en esta pasada) por
> quedar desactualizado después de que el código sí se terminó en una
> sesión posterior. **La lección para cualquier sesión futura sigue siendo
> la misma:** antes de dar por buena cualquier sección de este documento
> (✅ o ⚠️/🔲), verificar con `grep`/`find` que el archivo/función
> mencionado existe de verdad en el zip actual. No confiar en el texto del
> ROADMAP solo porque suena detallado, ni siquiera si dice "verificado".

**Aclaración técnica importante:** el proyecto **NO usa React**. Es HTML plano
+ JavaScript vanilla, una página `.html` por pantalla, cada una con su propio
`<script>`. Cuando alguien pida "que no recargue toda la pantalla, solo una
sección", la solución es construir esa pantalla como una sola página con
varias "vistas" internas que se muestran/ocultan con JS (como se hizo en
`activar-estudiante.html`, que tiene 2 pasos en el mismo archivo) — **no**
migrar a React salvo que se decida explícitamente hacer esa migración.

---

## 0. Qué ya está terminado y funcionando

- **Panel admin:** bug crítico que dejaba todo en "Cargando..." (arreglado —
  era una línea de JS rota que tumbaba el script completo). Se quitó la
  sección "Invitaciones enviadas" (ya no aplica).
- **Matrícula de estudiantes por código de clase** (reemplaza por completo el
  viejo sistema de invitación por correo):
  - Login acepta correo **o número de documento**.
  - `POST /api/matriculas/unirse` (público) — primer registro con
    documento+nombres+apellidos+código → crea cuenta + matrícula al instante.
  - `POST /api/auth/definir-password` — primera contraseña (una sola vez).
  - `POST /api/matriculas/unirse-clase` — estudiante ya con cuenta, sin curso
    activo, se une a uno nuevo con código (cambio de curso).
  - `POST /api/matriculas/:id/revalidar` — revalida el código cuando el
    director lo regenera (no borra notas/asistencia, solo pide reconfirmar).
  - `DELETE /api/matriculas/:id/eliminar-estudiante` — elimina cuenta
    completa + bloquea esos datos (documento+nombre) para ese curso
    específico (tabla `matriculas_bloqueadas`).
  - Un estudiante = un solo curso activo a la vez, siempre.
  - `mis-clases.html` (director): ve la lista de estudiantes que se unieron,
    puede eliminarlos.
  - `dashboard.html` (estudiante): banner "Únete a tu curso" o banner de
    revalidación de código, según el estado de su matrícula.
- **Limpieza de flujos muertos:** se eliminaron 3 sistemas viejos que ya no
  se usaban: invitación de docentes por correo, invitación de estudiantes
  por correo, autorregistro de docentes (`solicitar`/`aprobar`/`rechazar`).
  Se borraron sus archivos, rutas, controladores y páginas asociadas
  (`panel-estudiantes.html`, `definir-password.html`,
  `registro-docente.html`, `estudiantes.routes.js`,
  `invitaciones.controller.js`, `invitaciones-estudiantes.controller.js`,
  y las migraciones `09_invitaciones_docentes.sql` / `11_invitaciones_estudiantes.sql`).

## 0.0 Auditoría 2026-08-19 — qué decía este documento vs. qué hay en el código

**Nota de la segunda pasada (mismo día):** la fila de "Materias por curso"
de abajo describe el hallazgo de la primera auditoría (❌ nada existe).
Una segunda revisión del zip actual, más a fondo, encontró que **sí
existe todo**: `academico.controller.js` ya tiene `crearMateria` pidiendo
`grupo_id` + `docente_id`, `listarMaterias` con `JOIN grupos`,
`listarDocentesMateria`/`agregarDocenteMateria`/`quitarDocenteMateria`; las
rutas `GET/POST/DELETE /materias/:id/docentes` están montadas en
`academico.routes.js`; y `academico.html` tiene el campo `materiaGrupoId`
(no `materiaGradoId`), el modal "Profesores de la materia" y el botón "+"
para crear área nueva sin salir del formulario. La tabla se dejó con el
hallazgo original tachado como registro histórico del error, y la sección
2 completa más abajo ya está reescrita para reflejar el estado real.

**Nota de la tercera pasada (mismo día):** la fila de "Calendario" de
abajo describe el hallazgo de la segunda auditoría (🔲 sin construir,
coincidía con el documento). Una tercera revisión, después de que el
usuario señaló que el calendario ya se había construido y probado,
encontró que **sí existe todo**: migración `17_calendario_eventos.sql`
(tabla `calendario_eventos` con `institucion_id`, `grupo_id` opcional,
`periodo_id` opcional, `tipo` ENUM `general`/`cierre_periodo`/`otro`,
`color_hex`, `creado_por`); `calendario.controller.js` con
`listarEventos`, `crearEvento`, `actualizarEvento`, `eliminarEvento`,
`misCursosParaEventos` y la lógica de permisos ya resuelta; ruta montada
en `/api/calendario` dentro de `app.js`; y `frontend/calendario.html`
(1109 líneas) enlazado desde el menú de `dashboard.html`,
`academico.html`, `mis-clases.html`, `panel-admin.html` y
`comunicados.html`. La fila se dejó con el hallazgo original tachado
como registro histórico del error, y la sección 7 completa más abajo ya
está reescrita para reflejar el estado real.

| Sección | Lo que decía el ROADMAP | Lo que hay realmente en el código |
|---|---|---|
| 2. Materias por curso | ✅ "código construido", con formulario nuevo, modal de co-docencia, `listarMaterias` con `JOIN grupos` | ~~❌ Nada de eso existe~~ → ✅ **Corregido en la segunda pasada: sí existe, completo y verificado.** Ver nota arriba y sección 2 reescrita. |
| 3. Periodos académicos | ✅ construido | ✅ **Confirmado real.** Endpoints y pantalla existen tal cual se describen. |
| 4. Mis clases (resumen por curso/materia) | ✅ construido por completo | ✅ **Confirmado real.** `resumen.controller.js` tiene exactamente `resumenCurso`, `resumenCursoEstudiante`, `resumenMateria`; montado en `/api/resumen`; usado desde `mis-clases.html`. |
| 5. Plan de evaluación | ✅ "código construido", con `plan-evaluacion.controller.js`, `plan-evaluacion.routes.js` montado en `/api/plan-evaluacion`, hoja de cálculo en `mis-clases.html` | ✅ **Confirmado real** (construido el mismo día). `plan-evaluacion.controller.js` y `plan-evaluacion.routes.js` existen y la ruta está montada en `app.js`. Migración `15_plan_evaluacion.sql` (tabla `plan_evaluacion_items` + columna `notas.plan_item_id`) ejecutada. Pendiente solo la prueba manual end-to-end contra la base de datos real. |
| 6. Boletín / informe descargable | 🔲 "pendiente por construir", con preguntas abiertas sin resolver | ✅ **En realidad ya está terminada.** `boletin.controller.js` + `boletin.routes.js`, montado en `/api/boletines`, genera PDF con `pdfkit`, guarda historial en tabla `boletines`, conectado desde `mis-clases.html` (modal completo). Ver sección 6 reescrita abajo. |
| 7. Calendario | 🔲 pendiente, con propuesta de 4 estilos | ~~🔲 Confirmado sin construir~~ → ✅ **Corregido en la tercera pasada: sí existe, completo y verificado.** Estilo elegido: híbrido mini-calendario + detalle del día. Cierre de periodo manual (no automático). Ver nota arriba y sección 7 reescrita. |

**Consecuencia práctica:** con las secciones 2, 5, 6 y 7 confirmadas,
ya no queda ninguna pieza mayor del proyecto sin código detrás. Lo que
sigue pendiente son piezas más chicas y bien delimitadas: probar el plan
de evaluación contra la base de datos real (ver sección 5), decidir el
flujo de "Trabajos"/"Realizar evaluación" (sección 4), y las preguntas
menores sueltas de la sección 8 (horas semanales, traslape de periodos,
páginas huérfanas).

## 0.1 Archivos huérfanos sin resolver todavía

Detectados en la auditoría, **no forman parte de los flujos de
invitación/registro** (son de otra función: videollamadas/tablero), así que
no se tocaron. Pendiente decidir si se eliminan o se terminan de conectar:
- `frontend/admin-dashboard.html` — borrador viejo de `panel-admin.html`.
- `frontend/llamadas-estudiante.html` — nadie la enlaza todavía.
- `frontend/pizarron.html` — tablero de videollamada, backend (sockets) listo
  pero ninguna pantalla lo abre.

---

## 0.2 Auditoría de login y accesos (2026-08-28) — qué se atacó y qué queda pendiente

> **Contexto (por qué existe esta sección):** el usuario pidió revisar el flujo
> de acceso completo (login, roles, bloqueos por intentos). La auditoría
> encontró un **rol que no tenía forma de existir** (`acudiente`) y un **acceso
> de recuperación de contraseña muerto** (un `mailto:` que no llevaba a ninguna
> parte). Se acordó atacar los hallazgos por orden; esta sección registra qué se
> hizo (tachado ✅) y qué quedó pendiente (🔲) de **esta misma conversación**.

| # | Hallazgo de la auditoría | Estado |
|---|---|---|
| 1 | No había forma de crear cuentas `acudiente` ni de vincularlas a estudiantes: el rol era **inalcanzable** (nadie inserta en `acudientes_estudiantes` ni crea una cuenta con ese rol desde la UI, y no existía ninguna página de gestión). | ✅ HECHO (2026-08-28) — ver "Punto 1" abajo. |
| 2 | La recuperación de contraseña era un `mailto:` sin backend: si un usuario olvidaba su clave no existía ninguna ruta para cambiarla ni forma de que el admin la restableciera. | ✅ HECHO (2026-08-28) — ver "Punto 2" abajo. |
| 3 | Las sesiones JWT **no se revocan**: "cerrar sesión" solo borra el token en el frontend; un token robado sigue válido hasta expirar (`JWT_EXPIRES_IN`). | ✅ HECHO (2026-08-30) — ver "Punto 3" abajo. |
| 4 | El rate-limit de login es **solo por cuenta** (`intentos_fallidos` + `bloqueado_hasta`, migración 12): no hay límite por IP/global contra fuerza bruta distribuida. | ✅ HECHO (2026-08-29) — ver "Punto 4" abajo. |
| 5 | Mensajes y avisos del flujo de acceso descoordinados (textos que no explicaban el bloqueo por intentos en todos los escenarios; incoherencias menores de redacción entre backend y frontend). | ✅ HECHO (2026-08-29) — ver "Punto 5" abajo. |

### Punto 1 — Flujo completo de acudientes (HECHO)

Qué se construyó:
- **Backend:** `src/controllers/acudiente.controller.js` (listar, crear,
  vincular a estudiante, desvincular, eliminar con soft-delete `activo=FALSE`),
  rutas solo-admin en `src/routes/acudientes.routes.js`
  (`router.use(authMiddleware, soloRoles('admin'))`) montadas en `app.js` bajo
  `/api/acudientes`. La cuenta nueva se crea con **contraseña generada**
  (`src/utils/contrasena.util.js`), bcrypt, email opcional, y puede quedar
  vinculada de una vez a un estudiante en la misma llamada.
- **Frontend:** `frontend/acudientes.html` — redirige si `rol !== 'admin'`,
  tabla de acudientes con sus hijos (badges + × para desvincular), acciones
  "Vincular estudiante" / "Nueva contraseña" (reusa `POST /api/auth/restablecer`)
  / "Eliminar", búsqueda de estudiantes para vincular (reusa
  `/api/matriculas/estudiantes-buscar`). Enlace "Acudientes" agregado a la
  navegación de `panel-admin.html`, `academico.html`, `comunicados.html`,
  `calendario.html`, `estudiantes.html` y al dashboard del admin
  (`dashboard.html`, nav + accesos rápidos).
- Cosas a tener en cuenta:
  - El **superadmin no gestiona acudientes** (las rutas son `soloRoles('admin')`).
  - El correo de credenciales usa el servicio SMTP (`EMAIL_USER`/`EMAIL_PASS`);
    si no está configurado, el flujo sigue funcionando pero sin correo (la
    contraseña se muestra en pantalla al crear).
  - La contraseña generada usa el charset sin caracteres ambiguos
    (`contrasena.util.js`), mismo criterio que docentes.

### Punto 2 — Recuperación de contraseña (HECHO)

Qué se construyó:
- Endpoints nuevos en `src/routes/auth.routes.js` / `auth.controller.js`:
  - `POST /api/auth/olvide-password` (**público**): valida el correo, y si
    existe genera un JWT de tipo `reset-password` con expiración de **30
    minutos** y arma el link `.../frontend/reestablecer-password.html?token=...`.
    La respuesta es **genérica** ("si el correo está registrado...") para no
    revelar qué correos existen.
  - `POST /api/auth/reestablecer-password` (**público**): aplica la contraseña
    nueva con el token del correo, exige ≥8 caracteres y **desbloquea la
    cuenta** (`intentos_fallidos = 0`, `bloqueado_hasta = NULL`).
  - `POST /api/auth/restablecer` (`admin`/`superadmin`): contraseña nueva para
    cualquier usuario de su institución; la envía por correo y además la
    devuelve en la respuesta (para entregarla en persona). También desbloquea.
- **Frontend:** `frontend/reestablecer-password.html` (nuevo, 2 modos: solicitar
  correo / crear contraseña cuando llega con `?token=`, el token se
  autodecodifica de la URL). En `login.html` el "¿Olvidaste tu contraseña?"
  dejó de ser `mailto:` y ahora lleva a esa página.
- Cosas a tener en cuenta:
  - Requiere el correo SMTP configurado en `.env` (`EMAIL_USER`/`EMAIL_PASS`)
    para que el link llegue; el flujo "restablecer por admin" es el que no
    depende de `olvide-password`.
  - El token se puede reusar mientras no expire (30 min) o hasta cambiar la
    contraseña; si no se quiere permitir reuso habría que invalidarlo (ver
    pendiente 3).
  - El reset por admin usa el mismo desbloqueo, así que sirve para sacar de un
    bloqueo por intentos.

### Punto 3 — Revocación de sesiones JWT (HECHO — 2026-08-30)

Antes, "cerrar sesión" solo borraba `sia_token` del `sessionStorage` del
frontend; el backend era stateless y un token válido seguía sirviendo hasta
expirar. Se eligió un **enfoque híbrido (opciones a+b del audit)**: blacklist
de `jti` en memoria para el logout puntual + `token_version` en `usuarios`
para revocar TODAS las sesiones de un usuario de golpe (cambio/recuperación de
contraseña).

Qué se construyó:
- **Migración `database/19_revocacion_sesiones.sql`** (ya aplicada a la BD vía
  script node): `ALTER TABLE usuarios ADD COLUMN token_version INT NOT NULL
  DEFAULT 0 AFTER ultimo_acceso;`.
- **`src/utils/revocacion.js`:** `Map` en memoria `jti → expiración`. Al hacer
  logout se registra el `jti` hasta que expire el token; una tarea periódica
  limpia las entradas vencidas cada 15 min.
- **Emisión del token:** el login (`auth.controller.js`) y el auto-token post
  inscripción (`matriculas.controller.js`, `_emitirToken`) firman el JWT con
  `{ jti: randomUUID(), ver: usuario.token_version || 0 }`.
- **Validación (`src/middleware/auth.middleware.js`, reescrito async)** y en
  el `io.use` de `src/sockets/socket.js`: tras verificar el JWT se consulta
  que su `jti` no esté revocado y que `ver` coincida con el `token_version`
  actual del usuario en BD; si no, `401 "La sesión terminó. Inicia sesión
  nuevamente."`.
- **Ruta nueva:** `POST /api/auth/logout` (authMiddleware) → revoca el `jti`.
  Los 10 `cerrarSesion()` del frontend ahora llaman a esa ruta antes de borrar
  el token y redirigir.
- **Bump de `token_version`** al cambiar/recuperar contraseña o actualizar el
  hash: `reestablecerPassword`, `restablecerPorAdmin`, `definirPassword`,
  `actualizarPerfil` hacen `token_version = token_version + 1`, invalidando
  todas las sesiones previas.

Verificado en vivo (2026-08-30): login → perfil 200 → logout 200 → perfil 401
"La sesión terminó..."; y con el bump simulado de `token_version`, el perfil
con un token viejo responde 401.

Cosas a tener en cuenta:
- La blacklist vive **en memoria** (vuelve a cero al reiniciar el proceso);
  los tokens revocados solo por logout recuperan validez virtual tras un
  reinicio hasta que expiren (segundos/horas según `JWT_EXPIRES_IN`). Si se
  necesita revocación persistente hay que pasar a una tabla de sesiones (opción
  a completa) o Redis. La revocación _por token_version_ NO se pierde al
  reiniciar porque el token se valida contra la BD.
- **Antes de esta migración se probó incrementando `token_version` del
  superadmin 2 veces** → cualquier sesión vieja del superadmin (`admin@sia.edu.co`)
  quedó invalidada: hace falta volver a iniciar sesión.

### Punto 4 — Rate-limit por IP en el login (HECHO — 2026-08-29)

Complementa el bloqueo por cuenta (`intentos_fallidos`) que ya existía
(migración 12) con una **capa adicional por dirección IP** para frenar
fuerza bruta distribuida (una IP probando muchos correos, o muchas IPs
contra la misma cuenta).

Qué se construyó:
- **Dependencia:** se instaló `express-rate-limit` (^8.7.0) en `package.json`.
- **Middleware nuevo:** `src/middleware/rateLimit.middleware.js` — `loginLimiter`
  con ventana y máximo configurables desde `.env`:
  `RATE_LIMIT_LOGIN_WINDOW_MIN` (minutos de la ventana, **def: 15**) y
  `RATE_LIMIT_LOGIN_MAX` (intentos máximos por IP en la ventana, **def: 20**).
  Respuesta **genérica** (no revela cuántos intentos ni si la cuenta existe):
  `429 { ok:false, mensaje:'Demasiados intentos desde esta dirección. Espera
  unos minutos e intenta de nuevo.' }`. Usa el `MemoryStore` por defecto —
  suficiente para una instalación de un solo proceso; si algún día se despliega
  en varios procesos hay que pasar a un store compartido (Redis).
- **Cableado:** `loginLimiter` aplicado a `POST /api/auth/login` en
  `src/routes/auth.routes.js`.
- **Trust proxy:** en `src/app.js` se hace `app.set('trust proxy', 1)` solo si
  `.env` trae `TRUST_PROXY=1`. La idea: si el sistema corre detrás de
  nginx/proxy, `req.ip` tomaría la IP del proxy para todo el mundo y el
  rate-limit limitaría a todos con la misma dirección; con `TRUST_PROXY=1` se
  lee la IP real desde `X-Forwarded-For`.
- **Doc:** las nuevas variables quedaron comentadas en `env.example` y `.env`.

Verificado en vivo (2026-08-29): con el servidor corriendo, los primeros 20
intentos de login desde una misma IP pasan (devuelven 401 de credenciales
inválidas) y a partir del 21 la API responde **429** con el mensaje genérico.

Cosas a tener en cuenta:
- El bloqueo por cuenta (5 intentos → 15 min, en `usuarios.intentos_fallidos`)
  **sigue activo e intacto** — este límite por IP es adicional, no un
  reemplazo.
- `TRUST_PROXY` y los dos valores de rate-limit quedan en `0`/vacíos por
  defecto en `.env` del repo de forma local; solo hay que activarlos si el
  despliegue está detrás de un proxy.

### Punto 5 — Unificar mensajes del flujo de acceso (HECHO — 2026-08-29)

El frontend de acceso (`login.html`, `reestablecer-password.html`,
`activar-estudiante.html`) ya mostraba tal cual el `mensaje` del backend
para los errores de la API, así que el grueso de la "unificación" era
asegurar que el **backend** no dijera cosas distintas según el escenario y
que los **avisos locales** (validación de campos y errores de red) no se
desviaran de esa redacción.

Qué se ajustó:
- **Backend (`src/controllers/auth.controller.js`):** el mensaje de bloqueo
  por intentos quedó **unificado** en los dos escenarios que había
  (cuando la cuenta ya está bloqueada y cuando se acaba de bloquear en el
  5º intento). Ambos dicen ahora `Cuenta bloqueada por demasiados intentos
  fallidos. Intenta de nuevo en <N> minuto(s).` — antes el del 5º intento
  decía otra cosa.
- **Frontend (`frontend/login.html`):**
  - El aviso local "Por favor completa todos los campos." se cambió a
    **"Correo/documento y contraseña obligatorios."** (misma redacción que
    devuelve el backend `auth.controller.js` cuando faltan credenciales).
  - El fallback de error de red ahora dice **"Error de conexión. Intenta de
    nuevo."**, igual que `reestablecer-password.html` y
    `activar-estudiante.html` (antes decía "No se pudo conectar con el
    servidor. Verifica que esté en ejecución.").
- Sin cambios necesarios en `reestablecer-password.html` ni en
  `activar-estudiante.html`: sus mensajes locales de validación
  ("La contraseña debe tener al menos 8 caracteres.", "Las contraseñas no
  coinciden.") ya coinciden exactamente con los del backend, y el resto de
  errores de la API se muestran desde `data.mensaje`.

### Cuentas de prueba fijas (HECHO — registrada en esta conversación)

- Para no seguir creando roles sueltos en cada prueba, la migración
  `database/18_usuarios_prueba.sql` crea un set **fijo**: superadmin (ya
  existía desde la 01), admin, 2 docentes, 2 estudiantes y 2 acudientes con
  contraseñas fijas por rol, dentro de la *"Institución de Prueba SIA"*.
  También deja el curso Décimo 1001 con los 2 estudiantes matriculados y los
  vínculos `acudientes_estudiantes`. **Idempotente** (`INSERT IGNORE`).
- Credenciales documentadas en **README.md sección 2.1** (tabla con correo,
  documento y contraseña de cada cuenta, + cómo iniciar sesión).
- Cosas a tener en cuenta:
  - Si un correo/documento ya existía, la migración no lo sobrescribe (revisar
    el `SELECT` de verificación que trae al final).
  - Los hashes fueron verificados con `bcrypt.compare` el 2026-08-28.

### Qué falta de esta conversación (PENDIENTE)

- [x] **Punto 3 — Revocación de sesiones JWT.** ✅ HECHO (2026-08-30) — ver
      "Punto 3" arriba. Blacklist de `jti` en memoria (`src/utils/revocacion.js`)
      para logout + columna `token_version` en `usuarios` (migración
      `19_revocacion_sesiones.sql`) que revoca TODAS las sesiones al cambiar/
      recuperar contraseña o actualizar el hash. `auth.middleware.js` y el
      `io.use` de sockets validan jti + token_version. (a)+(b) híbrido.
- [x] **Punto 4 — Rate-limit global / por IP.** ✅ HECHO (2026-08-29) — ver
      "Punto 4" arriba. `express-rate-limit` en `POST /api/auth/login` (20
      intentos / 15 min por IP, configurables), respuesta genérica, y
      `TRUST_PROXY=1` en `app.js` para cuando corra detrás de nginx/proxy.
- [x] **Punto 5 — Mensajes/avisos del flujo de acceso.** ✅ HECHO
      (2026-08-29) — ver "Punto 5" arriba. Mensajes de bloqueo unificados en
      el backend y avisos locales del login alineados con el resto de
      pantallas.
- [ ] **Prueba manual end-to-end contra la BD real** de los dos flujos nuevos:
      (1) crear un acudiente desde `acudientes.html`, vincularlo, verlo en la
      lista, entrar con las credenciales; (2) "Olvidé mi contraseña" con un
      correo real y SMTP configurado (Gmail app password), crear contraseña
      nueva y entrar. También probar el desbloqueo por admin tras 5 intentos
      fallidos.

---

## 1. Orden recomendado de construcción

El orden importa porque hay dependencias técnicas duras (no se puede
construir B sin A). Este es el orden sugerido:

1. **Periodos académicos** (bloquea casi todo lo demás — ver sección 3). ✅
   CONSTRUIDO Y CONFIRMADO.
2. **Materias ligadas a curso + asignación de profesor** (sección 2) —
   depende de que ya existan periodos. ✅ CONSTRUIDO Y CONFIRMADO por
   completo (backend, rutas y frontend, incluyendo co-docencia y creación
   de áreas inline).
3. **Rediseño de "Mis clases"** (sección 4) — depende de 1 y 2, porque sin
   materias asignadas no hay notas/fallas que resumir. ✅ CONSTRUIDO Y
   CONFIRMADO por completo (vista de curso del director + vista de materia
   del docente normal).
4. **Plantilla de plan de evaluación (% de actividades)** (sección 5) —
   depende de 1 y 2, ambas resueltas. ✅ CONSTRUIDO (2026-08-19): backend,
   rutas y frontend completos. Pendiente solo la prueba manual end-to-end
   contra la base de datos real — ver sección 5.
5. **Boletín / informe descargable** (sección 6) — ✅ CONSTRUIDO Y
   CONFIRMADO por completo, backend y frontend. Funciona ya mismo sobre el
   modelo actual de materias (por grado); cuando la sección 2 migre a
   materias-por-curso no debería requerir cambios en `boletin.controller.js`
   porque ya filtra por `grupo_id` vía `m.grupo_id` (columna que ya existe
   gracias a la migración 14, aunque el resto del código de materias no la
   use todavía).
6. **Calendario anual + eventos + cierre de periodo visual** (sección 7) —
   técnicamente independiente, se puede construir en paralelo a cualquiera
   de los anteriores, pero conceptualmente conecta con periodos (sección 3).
   ✅ CONSTRUIDO Y CONFIRMADO (2026-08-19): backend, rutas, frontend y
   migración completos. Ver sección 7 reescrita.

---

## 2. Materias: rediseño de creación y asignación de profesor — ✅ CONSTRUIDO Y CONFIRMADO POR COMPLETO

> **Estado real (verificado 2026-08-19, segunda pasada):** una primera
> auditoría el mismo día había marcado esta sección como "solo existe la
> migración, falta todo el código". Una revisión más a fondo del zip
> encontró que esa conclusión era incorrecta: backend, rutas y frontend
> **sí están construidos y coinciden con el diseño acordado** — verificado
> función por función y línea por línea, no solo por nombre de archivo.

### Decisiones confirmadas por el usuario (2026-08-17)
- **Materias por curso específico:** confirmado al 100%. "Matemáticas" en
  501 y "Matemáticas" en 502 son ahora dos materias distintas, cada una
  ligada a `grupo_id` (antes solo se ligaban a `grado_id`).
- **Co-docencia:** confirmado que sí se permite más de un profesor por
  materia. El primer profesor se asigna en el mismo formulario de creación
  (fusiona "crear materia" + "asignar docente"); profesores adicionales se
  agregan después desde el botón "Profesores" de cada fila.
- **Horas semanales:** se quitó del formulario, como estaba decidido. La
  columna `intensidad_hs` se dejó intacta en la base de datos (no se borró)
  por si el usuario explica más adelante cómo la quiere manejar.
- **Áreas:** ahora se pueden crear nuevas desde el mismo formulario de
  materia (botón "+" junto al selector de área), además del listado.

### Qué se construyó de verdad
- Migración `database/14_materias_por_curso.sql`: agrega `materias.grupo_id`
  (con FK a `grupos`, `ON DELETE CASCADE`) y cambia la restricción única de
  `(area_id, grado_id, nombre)` a `(area_id, grupo_id, nombre)`.
  `materias.grado_id` se conservó (se sigue llenando automáticamente a
  partir del curso elegido) para no arriesgar un `DROP` de FK con nombre
  autogenerado desconocido, y sigue siendo útil para filtrar/reportar por
  grado.
- Backend (`src/controllers/academico.controller.js`,
  `src/routes/academico.routes.js`, montado en `/api/academico`):
  - `POST /api/academico/areas` (`exports.crearArea`) — crea área nueva
    (`nombre`, `color_hex?`, `icono?`).
  - `POST /api/academico/materias` (`exports.crearMateria`) — pide
    `grupo_id` + `docente_id` (ambos obligatorios) + `area_id` + `nombre`,
    ya no `grado_id` directo (se resuelve automáticamente a partir del
    curso).
  - `GET /api/academico/materias/:id/docentes`
    (`listarDocentesMateria`), `POST .../docentes` (`agregarDocenteMateria`),
    `DELETE .../docentes/:docenteId` (`quitarDocenteMateria`) — gestión de
    co-docencia, montadas y confirmadas en `academico.routes.js`.
  - `listarMaterias` hace `JOIN` con `grupos` (`m.grupo_id`,
    `gp.nombre AS grupo_nombre`) además de `grados`, y acepta filtro
    `?grupo_id=`.
- Frontend (`frontend/academico.html`, pestaña "Materias"):
  - El formulario de creación (`#overlayMateria`) pide **Curso**
    (`#materiaGrupoId`, un `<select>` de grupos — no de grados) + Área (con
    botón **"+"** que abre `#overlayAreaNueva` sin salir del formulario) +
    Profesor + Nombre + Descripción. No pide horas semanales.
  - Modal **"Profesores de la materia"** (`#overlayProfesoresMateria`),
    abierto desde el botón "Profesores" de cada fila
    (`abrirModalProfesoresMateria`), con funciones
    `refrescarProfesoresMateria`, agregar y quitar co-docente sin recargar
    la pantalla.
  - La tabla de materias muestra columna "Curso" y "Profesores"
    (plural, refleja co-docencia).

### Qué queda fuera de alcance / pendiente de decidir
- El nuevo manejo de "horas semanales" sigue sin explicarse — el campo
  quedó oculto/fuera del formulario, la columna `intensidad_hs` sigue en
  la base de datos sin usarse.
- Los permisos ampliados de notas/asistencia para el **director de curso**
  (ver todas las materias de su curso aunque no las dicte) y para el
  **administrador** (promedio general por curso) no van aquí — eso está
  resuelto en la sección 4 ("Mis clases"), que es donde de verdad se
  construyeron.
- Sigue sin resolver si un profesor puede dictar varias materias en el
  mismo curso — técnicamente ya funciona sin restricciones (el formulario
  no lo bloquea), solo falta confirmarlo como decisión consciente.
- **Confirmar directo en la base de datos real** (no verificable desde el
  código fuente) que `database/14_materias_por_curso.sql` ya se ejecutó —
  el código de backend/frontend asume que `materias.grupo_id` existe.

---

## 3. Periodos académicos — ✅ CONSTRUIDO

### Decisiones ya confirmadas por el usuario (2026-08-17)
- **Cantidad de periodos:** libre por institución, con nombre libre (no se
  asume trimestral/3 fijo). El botón ya no se llama "Definir periodos
  trimestrales"; el formulario deja escribir cualquier nombre.
- **Traslape de fechas:** se permite. El backend avisa (`advertencias` en
  la respuesta) pero no bloquea el guardado.
- **Cierre de periodo:** solo informativo/visual. Llegar a `fecha_fin` no
  bloquea el registro de notas nuevas ahí — las fechas solo delimitan qué
  reporte/consulta pertenece a qué periodo.
- (Sin confirmar todavía, se aplicó un valor por defecto razonable: borrar
  un periodo con notas/tareas/horarios ya cargados está bloqueado por la
  base de datos —FK sin CASCADE—, y el endpoint lo traduce a un mensaje
  claro. Editar fechas de un periodo con notas adentro sí está permitido
  libremente, sin advertencia especial. Confirmar si este comportamiento es
  el deseado.)

### Qué se construyó
- Backend (`src/controllers/academico.controller.js`,
  `src/routes/academico.routes.js`, montado en `/api/academico/periodos`):
  - `GET /api/academico/periodos` (?anio_lectivo= opcional)
  - `POST /api/academico/periodos` — un periodo o `{ periodos: [...] }`
    para crear varios de una vez.
  - `PUT /api/academico/periodos/:id`
  - `PUT /api/academico/periodos/:id/activar` — marca uno como "el periodo
    actual" de la institución (desactiva los demás). Es informativo, útil
    para preseleccionar el periodo por defecto en otras pantallas; no
    restringe nada todavía.
  - `DELETE /api/academico/periodos/:id`
  - Todo restringido a `admin`/`superadmin` y a `institucion_id` del JWT.
  - No hizo falta ninguna migración: la tabla `periodos_academicos` ya
    tenía las columnas correctas (`nombre`, `anio_lectivo`,
    `numero_periodo`, `fecha_inicio`, `fecha_fin`, `activo`).
- Frontend (`frontend/academico.html`): nueva pestaña **"Periodos"** junto
  a "Cursos" — tabla + modal de crear/editar, botón "Activar", filtro por
  año lectivo. Sigue el mismo patrón vanilla JS de pestañas ya usado en el
  resto del archivo (sin recargar la pantalla).

### Qué falta (siguiente paso lógico: sección 2, Materias)
- Con periodos ya resueltos, el bloqueo técnico que impedía asignar
  profesores a materias y guardar notas queda despejado. Section 2 puede
  empezar.

---

## 4. Rediseño de "Mis clases" (curso → materia/estudiante, sin recargar) — ✅ CONSTRUIDO POR COMPLETO

### Decisión confirmada por el usuario (2026-08-17)
- **Promedio general de un estudiante:** promedio **simple** entre sus
  materias (todas pesan igual, no se pondera por horas semanales — que de
  todas formas sigue sin definirse, ver sección 2).

### Qué se construyó
- Backend nuevo: `src/controllers/resumen.controller.js` +
  `src/routes/resumen.routes.js`, montado en `/api/resumen`:
  - `GET /api/resumen/curso/:grupoId?periodo_id=` — por cada estudiante
    matriculado activo: fallas totales (across todas las materias del
    curso) + promedio general (promedio simple de sus promedios por
    materia) + cuántas materias tienen notas. También devuelve
    `promedio_curso` (promedio del curso completo — cubre el punto 6 de
    admin sin necesitar otro endpoint aparte).
  - `GET /api/resumen/curso/:grupoId/estudiante/:estudianteId?periodo_id=`
    — desglose materia por materia (fallas + promedio) de un estudiante.
  - Si no se manda `periodo_id`, se usa el periodo marcado `activo` de la
    institución (mismo criterio que en la sección 2). Las fallas se acotan
    a las fechas de ese periodo (la tabla `asistencia` no tiene
    `periodo_id` propio, así que se filtra por el rango de fechas del
    periodo).
  - **Permiso ampliado, como pedía esta sección:** puede consultar estos
    dos endpoints el admin/superadmin de la institución, **o el docente
    que sea director de ese curso puntual** — aunque no dicte ninguna
    materia ahí. Esto no tocó `notas.controller.js` ni
    `asistencia.controller.js` (que siguen correctamente restringidos a
    "solo tu propia materia" para un docente normal); es un permiso nuevo
    y separado, verificado contra `grupos.director_id`.
- Frontend (`frontend/mis-clases.html`), sin salir del archivo ni recargar
  la página:
  - La tabla "Estudiantes de tu curso" ahora muestra **Fallas** y
    **Promedio** por estudiante.
  - Clic en el nombre de un estudiante abre una vista de detalle **dentro
    de la misma pantalla** (oculta las demás tarjetas, muestra el
    desglose por materia) con botón "← Volver al curso" que regresa sin
    recargar nada.
  - Nueva tarjeta **"Trabajos"** con los botones **"+ Asignar tarea"** y
    **"+ Realizar evaluación"** — ambos CONECTADOS (2026-08-30) a través de
    un selector de materia del curso: "Realizar evaluación" abre el modal de
    "Plan de evaluación" (con su botón "Calificar →" a la hoja), y "Asignar
    tarea" abre el modal de tareas de la materia (crear/listar/editar/
    eliminar + revisar entregas y calificar con feedback). También hay un
    botón "Tareas" en el detalle de cada materia que dicta.

### Qué falta de esta sección
- **Vista de materia para el docente que no dirige el curso** — ✅
  construida (2026-08-17): dentro de `mis-clases.html`, clic en cualquier
  materia de "Materias que dictas" abre, en la misma pantalla, una tabla
  con fallas y promedio de cada estudiante de esa materia puntual.
  Backend: `GET /api/resumen/materia/:materiaId` en
  `resumen.controller.js` (permiso: el docente que dicta, el director del
  curso aunque no la dicte, o admin/superadmin). También se agregó
  `materia_id` a la respuesta de `GET /api/clases/mis-materias`, que antes
  solo mandaba `docente_materia_id`.
- **Mover "Tareas" y "Videollamadas"** para que vivan dentro del
  curso/materia en vez de accesos sueltos del dashboard: no se hizo. Las
  videollamadas siguen en `llamadas-docente.html` como pantalla aparte.
- **"Asignar tarea"** — ✅ construido (2026-08-30) como modal dentro de
  `mis-clases.html` (selector de materia → modal de tareas), con backend
  completo en `src/controllers/tareas.controller.js` + `src/routes/tareas.routes.js`
  montado en `/api/tareas` (montado en `app.js`):
  - `GET /api/tareas/materia/:materiaId` — tareas de una materia (con conteo
    de entregas).
  - `POST /api/tareas` / `PUT /api/tareas/:id` / `DELETE /api/tareas/:id` —
    crear/editar/eliminar tarea (solo co-docente o admin/superadmin).
  - `GET /api/tareas/estudiante` + `POST /api/tareas/:id/entrega` — el
    estudiante ve sus tareas y entrega (estado `entregada`/`tarde` según la
    fecha límite), con la tarjeta "Mis tareas" en `dashboard.html`.
  - `GET /api/tareas/:id/entregas` + `PUT /api/tareas/:id/entrega` — el
    docente ve las entregas de todos los estudiantes y califica con nota +
    feedback (`estado calificada`).
  - Permisos: gestionar/calificar = co-docente o admin/superadmin; ver =
    además el director del curso aunque no dicte; estudiante = solo sus
    tareas.
  - **Pendiente:** no hay subida de archivos adjuntos todavía (la tabla
    `entregas_tareas.archivo_id` existe pero el flujo actual solo registra
    estado/comentario, sin cargar archivo).
  - La evidencia visual de la tarjeta "Trabajos" ya quedó conectada con el
    botón "+ Asignar tarea".

---

## 5. Plantilla de plan de evaluación (% de actividades tipo Excel) — ✅ CONSTRUIDO (2026-08-19)

> **Estado real:** backend y frontend construidos en esta sesión, siguiendo
> exactamente el diseño que esta sección ya tenía especificado. Migraciones
> 14 y 15 confirmadas corridas en MySQL antes de empezar. Pendiente: prueba
> manual end-to-end contra la base de datos real (crear actividades,
> calificar, confirmar que "Mis clases" y el boletín reflejan el promedio
> sin ningún cambio adicional — deberían, porque solo leen
> valor/valor_max/peso_pct/materia_id/periodo_id).

### Qué se construyó
- Backend nuevo: `src/controllers/plan-evaluacion.controller.js` +
  `src/routes/plan-evaluacion.routes.js`, montado en `/api/plan-evaluacion`
  (`src/app.js`):
  - `GET /materia/:materiaId` — lista de ítems del plan con `conteo_notas`
    por ítem, `suma_actual` y `pendiente`.
  - `POST /` — crea un ítem `{ materia_id, nombre, peso_pct }`. Rechaza si
    la suma del periodo se pasaría de 100%.
  - `PUT /:id` — edita nombre/peso. Si cambia el peso, además actualiza
    `peso_pct` en las notas ya cargadas de ese ítem (para que el promedio
    no quede calculado con un peso viejo).
  - `DELETE /:id` — elimina el ítem. Las notas que tenía **no se borran**,
    quedan con `plan_item_id = NULL` (FK `ON DELETE SET NULL`).
  - `GET /materia/:materiaId/hoja` — la hoja de cálculo: ítems como
    columnas, estudiantes matriculados activos del grupo como filas, valor
    de cada celda (o `null`) y promedio ya calculado por fila.
  - `PUT /celda` — guarda/actualiza una celda `{ plan_item_id,
    estudiante_id, valor }` con un solo `INSERT ... ON DUPLICATE KEY
    UPDATE` (gracias al `UNIQUE (plan_item_id, estudiante_id)` de la
    migración 15). `valor` vacío/`null` borra la nota de esa celda.
  - **Cambio respecto al diseño original:** el rol `docente` no tiene
    acceso a `GET /api/academico/periodos` (solo admin/superadmin), así
    que ninguno de estos endpoints pide `periodo_id` al frontend — todos
    lo resuelven solos al periodo marcado `activo` de la institución
    (mismo criterio que `resumen.controller.js`). Si no hay periodo
    activo, responden 409 pidiendo crear uno.
  - Permisos, tal como estaba especificado: **gestionar el plan**
    (crear/editar/eliminar ítems, ver la hoja) — cualquier co-docente de
    la materia sin importar el periodo, o admin/superadmin. **Calificar**
    (guardar una celda) — solo el docente que dicta esa materia **en ese
    periodo puntual**, o admin/superadmin (si califica un admin/superadmin,
    la nota queda registrada a nombre del docente asignado a la materia en
    ese periodo, no del admin).
- Frontend (`frontend/mis-clases.html`), dentro de la vista de materia que
  ya existía (sección 4), sin salir del archivo ni recargar:
  - Botón **"Plan de evaluación"** en el detalle de materia → modal con
    barra de progreso (% definido / % pendiente), lista de actividades con
    conteo de notas, formulario para agregar una nueva. Editar/eliminar
    piden confirmación explícita si la actividad ya tiene notas cargadas.
  - Botón **"Calificar →"** dentro de ese modal → hoja de cálculo
    (columnas = actividades del plan, filas = estudiantes matriculados).
    Cada celda es un `<input>` que guarda al perder el foco (`onchange`);
    dejarla vacía borra la nota. Tras guardar, la hoja se recarga para
    reflejar el promedio recalculado de esa fila.

### Decisiones confirmadas por el usuario (2026-08-17)
- **Periodicidad:** el plan se define **por periodo** (puede cambiar cada
  bimestre), no es fijo para todo el año.
- **Suma de pesos:** puede quedar **por debajo de 100%** (el resto queda
  "pendiente" en la UI). Si un ítem nuevo hace que la suma se pase de
  100%, el backend lo rechaza — mismo criterio que ya existía en
  `notas.controller.js` para el `peso_pct` de una nota individual.
- **Editar el plan con notas ya cargadas:** se permite, con advertencia.
  El backend manda el conteo de notas afectadas por cada ítem; el
  frontend muestra un `confirm()` antes de guardar el cambio o el
  borrado (mismo patrón usado con el traslape de fechas de periodos).

### Qué se pidió
- El profesor, antes de calificar, define **qué actividades va a evaluar en
  el periodo** y **cuánto vale cada una** (ej. Tarea 1 = 20%, Examen = 40%,
  Trabajo grupal = 40%), con nombre libre por actividad.
- Luego, al calificar, la pantalla funciona como una hoja de cálculo: filas
  = estudiantes, columnas = las actividades ya definidas.
- El sistema **calcula el porcentaje final automáticamente** a medida que se
  van llenando las notas.
- **Las casillas que quedan en blanco no cuentan** — solo las que tienen un
  valor puesto entran al cálculo del porcentaje.

### Qué ya existe de verdad
- Migración `database/15_plan_evaluacion.sql`:
  - Tabla nueva `plan_evaluacion_items` (materia_id, periodo_id, nombre,
    peso_pct, orden), con `CHECK (peso_pct > 0 AND peso_pct <= 100)`.
  - `notas.plan_item_id` (nullable, `ON DELETE SET NULL`) — liga cada nota
    a la actividad del plan que la generó. Las notas creadas por el flujo
    manual viejo (`POST /api/notas`, sin pasar por un plan) siguen
    funcionando exactamente igual, sin tocar `plan_item_id`.
  - `UNIQUE (plan_item_id, estudiante_id)` sobre `notas` — es lo que
    permite guardar cada celda de la hoja con un solo `INSERT ... ON
    DUPLICATE KEY UPDATE`, sin afectar las notas viejas con
    `plan_item_id = NULL`.
  - **Depende de que `materias.grupo_id` ya exista** (la introduce la
    migración 14, que sí existe — ver sección 2). Hay que correr la 14
    antes que la 15, si no se ha hecho ya.

### Qué falta probar/decidir
- [ ] **Prueba manual end-to-end contra la base real** (no verificable
      desde el código): crear 2-3 actividades en un periodo, calificar
      varios estudiantes, confirmar que "Mis clases" (sección 4) y el
      boletín (sección 6) muestran el promedio correcto sin haber tocado
      esos dos archivos.
  - Las 25 materias sin `grupo_id` (detectadas al confirmar las
    migraciones) siguen sin asignar — el usuario decidió ignorarlas por
    ahora. El plan de evaluación de esas materias específicas no
    funcionará hasta que se les asigne un curso, porque `hojaCalificacion`
    depende de `materia.grupo_id` para saber qué estudiantes listar.
- [ ] Selector de periodo en la pantalla: por ahora el plan y la hoja
      siempre usan el periodo marcado `activo` de la institución. No hay
      forma de ver/editar el plan de un periodo ya cerrado desde la UI
      todavía — se puede agregar un selector más adelante si hace falta.
- [x] "Trabajos" (sección 4): "+ Realizar evaluación" AHORA abre el modal
      del plan de evaluación vía un selector de materia (2026-08-30), con
      acceso de lectura para el director de curso. Ver sección 4.

---

## 6. Boletín / informe descargable — ✅ CONSTRUIDO Y CONFIRMADO POR COMPLETO

> **Estado real (verificado 2026-08-19):** a diferencia de las secciones 2
> y 5, esta sí está terminada de verdad — código encontrado y revisado
> línea por línea. Quedó fuera de sincronía con este documento porque se
> construyó en una sesión posterior a la última vez que se actualizó el
> ROADMAP.

### Qué se pidió
- Botón que genera un boletín descargable/imprimible tipo el que
  normalmente se conoce en colegios, visible para director de curso y
  para cualquier profesor del curso.
- El promedio se calcula **por periodo** usando el `periodo_id` de cada
  nota — no se mezcla entre periodos.

### Qué se construyó
- Migración `database/16_boletines.sql`: agrega `'boletin'` al enum
  `archivos.tipo`, y tabla nueva `boletines` (historial — cada generación
  es una fila nueva, nunca se sobreescribe una anterior) con FKs a
  `usuarios` (estudiante y quien lo generó), `grupos`, `periodos_academicos`
  y `archivos`.
- Backend: `src/controllers/boletin.controller.js` +
  `src/routes/boletin.routes.js`, montado en `/api/boletines`
  (`src/app.js`):
  - `POST /api/boletines/estudiante/:estudianteId/generar` — arma los
    datos (materias del grupo, notas del periodo, fallas por materia
    dentro del rango de fechas del periodo, promedio simple general),
    genera el PDF en memoria con `pdfkit`, lo guarda en
    `storage/boletines/` + registro en `archivos` (tipo `boletin`) +
    registro en `boletines`.
  - `GET /api/boletines/estudiante/:estudianteId?grupo_id=` — historial de
    boletines ya generados para ese estudiante en ese curso.
  - `GET /api/boletines/:id/descargar` — descarga el PDF.
  - Permiso: admin/superadmin de la institución, el docente director del
    curso, o cualquier docente que dicte una materia en ese curso (más
    amplio que solo el director, ver comentario en el propio archivo).
  - Si no se manda `periodo_id`, usa el periodo marcado `activo` de la
    institución (mismo criterio que el resto del sistema).
- Frontend (`frontend/mis-clases.html`): modal completo — botón que abre
  el modal, campo de observaciones del director, botón "Generar PDF",
  lista de boletines anteriores con link de descarga.

### Preguntas que ya quedaron resueltas por el propio código
- **¿Individual o consolidado de curso?** → Individual únicamente (por
  `estudianteId`). No existe versión consolidada de todo el curso en un
  solo archivo — se puede agregar más adelante si hace falta.
- **¿Lleva algo más que notas/asistencia?** → Sí, campo libre de
  `observaciones` que llena quien genera el boletín (director/docente),
  se guarda en la tabla `boletines` y aparece en el PDF.
- **¿Se guarda historial?** → Sí, cada generación es una fila nueva en
  `boletines`, con su propio PDF en `archivos`; nada se sobreescribe.

### Qué sigue pendiente de esta sección (no bloqueante, mejoras futuras)
- [ ] Cuando la sección 2 (materias por curso) se termine de verdad,
      confirmar que el boletín no requiere cambios — ya usa `m.grupo_id`
      en su query de materias, así que en teoría no debería necesitar
      tocarse, pero conviene una prueba manual una vez esté todo conectado.
- [ ] No hay versión consolidada de boletines de todo el curso en un solo
      archivo — evaluar si hace falta más adelante.

---

## 7. Calendario anual + eventos + cierre de periodo ✅ CONSTRUIDO Y CONFIRMADO

### Qué se pidió
- Un calendario anual, tanto para el **administrador** (todo el colegio)
  como para el **docente** (sus estudiantes/cursos).
- Al hacer clic en un día, se puede **escribir un evento**.
- Entre los tipos de evento: **cierre de un periodo** (ligado a lo de la
  sección 3).
- El usuario pidió explícitamente que **antes de construirlo** se propongan
  distintos estilos de calendario (tamaños/funcionalidades distintas) para
  escoger uno.

### Estilo elegido: híbrido mini-calendario + detalle del día
De las 4 propuestas (mensual clásico, agenda/lista, híbrido, línea de
tiempo anual), se construyó la **opción 3** (estilo Notion
Calendar/Fantastical): un calendario mensual pequeño a un lado, y al
hacer clic en un día, la lista de eventos de ese día se muestra al otro
lado. No se implementó el elemento de franjas de color por periodo
(opción 4) que se había sugerido como complemento.

### Lo que hay construido, verificado archivo por archivo
- **`database/17_calendario_eventos.sql`** — tabla `calendario_eventos`:
  `id`, `institucion_id`, `grupo_id` (NULL = evento de todo el colegio),
  `periodo_id` (opcional, solo referencia informativa), `creado_por`,
  `titulo`, `descripcion`, `fecha`, `tipo` ENUM
  (`general`/`cierre_periodo`/`otro`), `color_hex`. FKs a
  `instituciones`, `grupos`, `periodos_academicos`, `usuarios`. Índices
  por institución, grupo y fecha. Migración ejecutada.
- **`src/controllers/calendario.controller.js`**:
  - `listarEventos` — `GET /api/calendario/eventos?desde=&hasta=&grupo_id=`.
    Devuelve eventos generales de la institución + los del/los curso(s)
    que le correspondan al usuario según su rol (docente → cursos donde
    dirige o dicta materia; estudiante → su curso con matrícula activa;
    acudiente → cursos de sus estudiantes a cargo, vía
    `acudientes_estudiantes`, mismo patrón que
    `notas.controller.js`/`asistencia.controller.js`).
  - `crearEvento` / `actualizarEvento` / `eliminarEvento` —
    `POST`/`PUT`/`DELETE /api/calendario/eventos(/:id)`.
  - `misCursosParaEventos` — `GET /api/calendario/mis-cursos`, para el
    `<select>` del formulario (admin/superadmin ven todos los cursos de
    su institución; docente solo los que dirige).
  - Permisos: admin/superadmin gestionan cualquier evento de su
    institución (general o de cualquier curso); docente solo eventos con
    `grupo_id` = el curso que dirige (validado contra
    `grupos.director_id`, mismo patrón que `resumen.controller.js`).
- **`src/routes/calendario.routes.js`** — montada en `/api/calendario`
  dentro de `app.js` (línea 63), con `authMiddleware` +
  `soloRoles(...)` por endpoint.
- **`frontend/calendario.html`** (1109 líneas) — enlazada desde el menú
  de navegación de `dashboard.html`, `academico.html`, `mis-clases.html`,
  `panel-admin.html` y `comunicados.html`.

### Preguntas que estaban abiertas — ya resueltas (confirmadas por el usuario, 2026-08-19)
- ~~¿Cuál estilo de los 4?~~ → Híbrido (opción 3), sin las franjas de
  periodo de la opción 4.
- ~~¿Cierre de periodo automático o manual?~~ → **Manual.** El admin lo
  agrega a mano como evento aparte (`tipo='cierre_periodo'`); no se
  deriva de `periodos_academicos.fecha_fin`. `periodo_id` es opcional,
  solo para referenciar visualmente a qué periodo pertenece el cierre si
  el admin lo liga.
- ~~¿Quién puede crear eventos?~~ → Admin/superadmin (cualquier evento de
  su institución) + docente director de curso (solo eventos de su curso
  puntual). Un docente que solo dicta materia sin dirigir no puede crear
  eventos, aunque sí ve los de su(s) curso(s).
- ~~¿La vista del docente muestra también eventos generales del
  colegio?~~ → Sí, siempre: `listarEventos` combina eventos generales
  (`grupo_id IS NULL`) con los del/los curso(s) del usuario.

### Qué falta probar/decidir
- [ ] No hay evidencia en el código de que se haya probado el flujo
      completo contra la base de datos real (crear evento, listarlo por
      rango de fechas, editar, eliminar) — se recomienda una prueba
      manual end-to-end, igual que con el plan de evaluación (sección 5).
- [ ] El elemento visual de franjas de color por periodo (parte de la
      recomendación original, opción 4) no se construyó — evaluar si
      hace falta más adelante o si se descarta definitivamente.

---

## 8. Resumen de preguntas pendientes (para no perder ninguna)

- [x] Materias por curso (sección 2): construir backend y frontend —
      resuelto y confirmado por completo, ver sección 2 completa arriba.
- [x] Confirmar directamente en MySQL que `14_materias_por_curso.sql` y
      `15_plan_evaluacion.sql` ya se ejecutaron — confirmado el
      2026-08-19: ambas migraciones corridas. Quedó pendiente (aceptado
      por el usuario, no urgente): 25 materias con `grupo_id` sin asignar
      por ambigüedad de grado con más de un curso.
- [x] Plan de evaluación (sección 5): backend + frontend construidos el
      2026-08-19. Ver sección 5 completa arriba.
- [x] Calendario (sección 7): construido y confirmado por completo —
      backend, rutas, frontend y migración. Estilo híbrido mini-calendario
      + detalle del día, cierre de periodo manual, admin/superadmin +
      director de curso pueden crear eventos. Ver sección 7 completa
      arriba.
- [ ] **Siguiente paso real:** probar de punta a punta contra la base de
      datos real tanto el plan de evaluación (ver "Qué falta
      probar/decidir" en la sección 5) como el calendario (ver "Qué falta
      probar/decidir" en la sección 7) — ninguno de los dos tiene
      evidencia en el código de haberse probado end-to-end todavía.
- [x] Nuevo manejo de "horas semanales" → **resuelto (2026-09-02):** la columna
      `materias.intensidad_hs` ya no se pide a mano; la intensidad semanal se **deriva
      del horario** (suma de horas de las franjas de cada materia). El backend
      (`listarMaterias`) la calcula agrupando `horarios` por materia y se muestra en
      la tabla de materias (columna "Horas sem."). Ver decisión de cierre en la
      sección 0.
- [x] ¿Un profesor puede dictar varias materias en el mismo curso? → **Sí, permitido
      (2026-09-02, confirmado).** Ya funciona y se documenta como decisión consciente
      (co-docencia y horario lo asumen).
- [x] Periodos: ¿se pueden traslapar fechas? → **No.** Decisión 2026-09-02: los
      periodos NO pueden traslaparse. Implementado en `crearPeriodos` y
      `actualizarPeriodo` (`academico.controller.js`): si hay traslape, se rechaza
      con 400. Antes solo se advertía.
- [x] "Asignar tarea" / "Realizar evaluación": resueltos (2026-08-30) vía la
      tarjeta "Trabajos" con un selector de materia. "Realizar evaluación" abre
      el plan de evaluación/hoja; "Asignar tarea" abre el flujo de tareas
      (ver sección 4) — CRUD por materia + entregas de estudiantes + calificar
      con feedback. Sin archivos adjuntos todavía.
- [x] Promedio general del estudiante (todas las materias): resuelto —
      promedio simple, ver sección 4.
- [x] Boletín: resuelto y construido por completo — individual, con
      observaciones, con historial. Ver sección 6.
- [x] Calendario: resuelto y construido por completo — estilo híbrido,
      cierre de periodo manual, admin/superadmin + director de curso
      crean eventos. Ver sección 7. Falta solo la prueba end-to-end.
- [x] Páginas huérfanas (`admin-dashboard.html`, `llamadas-estudiante.html`,
      `pizarron.html`) → **resueltas (2026-09-02):** `pizarron.html` y
      `llamadas-*.html` ya están conectadas (`mis-clases.html`/`dashboard.html`),
      y `admin-dashboard.html` se **eliminó** (era borrador viejo de
      `panel-admin.html`, nadie lo enlazaba).
- [x] Auditoría de login (2026-08-28) — puntos 1 y 2: flujo completo de
      acudientes y recuperación de contraseña, hechos. Ver sección 0.2.
- [x] Cuentas de prueba fijas por rol (migración `18_usuarios_prueba.sql` +
      README sección 2.1): hechas — superadmin, admin, 2 docentes, 2
      estudiantes y 2 acudientes con contraseñas fijas. Ver sección 0.2.
- [x] Auditoría de login — punto 3: revocación de sesiones JWT (logout +
      token_version). Ver sección 0.2.
- [x] Auditoría de login — punto 4: rate-limit global / por IP en el login
      (hoy solo por cuenta). ✅ HECHO (2026-08-29) — ver sección 0.2,
      "Punto 4".
- [x] Auditoría de login — punto 5: unificar mensajes/avisos del flujo de
      acceso con el estado real. ✅ HECHO (2026-08-29) — ver sección 0.2,
      "Punto 5".
- [ ] Prueba manual end-to-end contra la BD real de acudientes + recuperación
      de contraseña (incluido correo con SMTP). Ver sección 0.2.

---

## 9. Cómo usar este documento

Antes de empezar a construir cualquiera de estas secciones, conviene:
1. Revisar la sección "Preguntas abiertas" de esa sección específica y
   resolverlas con el usuario primero.
2. Confirmar que las dependencias de la sección "1. Orden recomendado" ya
   estén resueltas (ej. no tiene sentido construir materias sin periodos).
3. **Antes de dar por buena cualquier marca ✅ de este documento, verificar
   con `grep`/`find` sobre el código real** (nombre de archivo, nombre de
   función, ruta montada en `src/app.js`) — no basta con que el texto
   suene detallado o con fecha de "decisión confirmada". La auditoría de
   2026-08-19 (sección 0.0) encontró tres secciones marcadas como
   terminadas que no tenían ningún código detrás, y una marcada como
   pendiente que ya estaba completa. No asumir que este documento está
   sincronizado con el repositorio salvo que se haya verificado así.
4. Actualizar este archivo tachando lo que ya se resolvió/construyó, para
   que siga siendo la fuente de verdad y no quede desactualizado — y
   verificar en disco antes de escribir "✅ construido", no después.
