# MÓDULO: Evaluaciones y Actividades por competencias

> El corazón de la visión del SIA (ver `../vision/VISION.md`). Este doc es la **spec viva** del
> módulo: se completa/resuelve con el usuario **antes** de escribir código y se actualiza
> con cada hito terminado. Sigue la plantilla de `GUIA_DE_AVANCE.md` §5.
>
> **Decisiones del usuario confirmadas el 2026-09-02** (1→6 al final).

## Objetivo pedagógico

Que el docente no solo "ponga un examen", sino que **mida y desarrolle habilidades**:
pensamiento crítico, comunicación, colaboración, creatividad y resolución de problemas.
Sustenta los pilares de la visión: **competencias**, **proyectos/retos**, **evaluación
formativa continua** y una base para el **aprendizaje personalizado**.

El flujo central promovido (punto 3 del usuario): cada docente/director arma al inicio
del **periodo** una **plantilla de actividades/evaluaciones** para su curso con el
**porcentaje** que vale cada una; el sistema **calcula y actualiza las notas en tiempo
real** dentro de esa plantilla y mantiene **edición manual** por parte del docente.

## Alcance y no-alcance

**Incluye:**
- Una **plantilla por materia + periodo** (ya existe: `plan_evaluacion_items`) con
  **% de peso**, creada por el docente o el director del curso.
- Cada **ítem de la plantilla** es una "actividad/evaluación" de uno de estos **tipos**:
  - **Manual:** el docente asigna la nota directamente en la hoja.
  - **Entrega (PDF):** el docente sube/diseña una actividad; el estudiante entrega
    (retoma `tareas` + `entregas_tareas`) y el docente califica.
  - **Enlazada a una evaluación autocorregible:** el docente crea una evaluación
    dentro del SIA y la **enlaza** al ítem; el sistema **calcula la nota y la escribe
    sola** en la celda, en vivo.
- **Evaluación integral dentro del SIA**: el docente crea la evaluación con una
  **plantilla** propia (preguntas) o puede apoyarse en el **banco** y en los
  **tipos verificados por neurociencia** (ver §4 y decisión 4).
- **Enlazar** con la regla **1 actividad ⇔ 1 evaluación** (una evaluación no puede
  enlazarse a dos ítems de la plantilla).
- **Notas en vivo**: al autocorregir se actualiza la celda y el **promedio ponderado**
  del estudiante en esa materia/periodo al instante, manteniendo **edición manual**.
- **Rúbrica por competencias** para las respuestas abiertas.
- **Boletín por competencias** (habilidades, no solo promedio).

**Queda fuera por ahora:** IA que corrija ensayos (integración futura) y la
recomendación adaptativa automática (módulo `ACTIVIDADES_ADAPTATIVAS` posterior).

## 1. La plantilla (núcleo del punto 3)

Reutiliza y amplía lo que **ya existe**:

- `plan_evaluacion_items` (materia_id, periodo_id, nombre, **peso_pct**, orden).
- `notas` con `plan_item_id` + `uq_notas_plan_estudiante` (celda única por ítem+alumno)
  y `hojaCalificacion`/`guardarCelda` en `plan-evaluacion.controller.js`.

**Ampliación** → añadir a `plan_evaluacion_items` un **tipo** para saber cómo se
resuelve/cuenta cada ítem:

- `tipo` ENUM(`manual`, `entrega`, `evaluacion`) — cómo se llena la nota.
- `evaluacion_id` CHAR(36) NULL — cuando `tipo='evaluacion'`, la evaluación enlazada.
  Con `UNIQUE(evaluacion_id)` para garantizar **1 actividad ⇔ 1 evaluación**.

Reglas de negocio:
- El docente **o** el director de curso pueden crear/editar la plantilla de su curso.
- La suma de `peso_pct` de la plantilla es **flexible pero no puede superar 100**
  (decisión del usuario, 2026-09-02). El sistema debe impedir que la suma exceda 100.
- En la hoja de calificación, cada **celda**:
  - `manual` → editable por el docente (valor 0..10).
  - `entrega` → nota de la entrega calificada (también editable).
  - `evaluacion` → **NO editable mientras esté enlazada** (la escribe el sistema), salvo
    excepción explícita pedida por el usuario.

## 2. Crear o subir actividad/evaluación (punto 3)

Al "crear ítem" de la plantilla el docente elige:

- **Subir PDF** → se crea una `tarea` con `archivo` adjunto (guardado en `storage/`
  y fila en `archivos`) tipo `entrega`; los estudiantes la ven y entregan.
- **Crear evaluación con plantilla** → entra al **constructor de evaluación** (§4) y el
  resultado queda **enlazado** (tipo `evaluacion`).
- **Manual** → solo una celda que el docente llena.

En la UI del ítem debe existir una opción **"Enlazar"** que muestre **las actividades
ya asignadas** (entregas/tareas creadas antes) para asociarlas — respetando que una
actividad ya enlazada no pueda volver a enlazarse.

## 3. Evaluación autocorregible → nota en vivo

- El estudiante presenta la evaluación; al enviar, el sistema **autocorrige** y:
  1. Escribe la nota en la celda (`notas[plan_item_id, estudiante_id]`).
  2. Recalcula el **promedio ponderado** de la materia en el periodo.
  3. Se refleja **instantáneamente** en la plantilla/hoja del docente.
- El docente **puede** sobreescribir la nota manualmente (decisión del usuario: "mantener
  la opción de editar esta nota").

## 4. Constructor de evaluación y tipos neurocientíficos (punto 4)

El docente crea la evaluación B replanteada así:

- **Dos caminos:**
  a. **Plantilla propia:** el docente arma el examen pregunta a pregunta.
  b. **Parámetros avanzados (asistido por sistema):** el docente indica **tema** +
     tipo de evaluación, y el sistema **propone/armar** la evaluación según ese tipo con
     parámetros avanzados — siempre **editables / se pueden agregar preguntas** a mano.

- **Tipos de evaluación verificados por la neurociencia** (el usuario los definirá en un
  documento aparte que traerá; aquí se deja el lugar para el catálogo de tipos). Cada tipo
  describe cómo construir la evaluación sobre un tema (ej. recuperación, comprensión,
  aplicación, análisis, síntesis, evaluación metacognitiva...). Mientras el usuario no
  entregue el listado, el sistema soporta los tipos autocorregibles estándar:
  opción múltiple, verdadero/falso, emparejar, completar/ordenar, y respuesta abierta
  (para rúbrica). Cuando llegue el listado neurocientífico, se mapea aquí.

## 5. Competencias, banco y rúbricas

**Competencias** (decisión 1): un **catálogo base fijo** (nacional/estándar) + el admin
puede **agregar competencias propias de la institución**.
- Tabla `competencias` (id, nombre, descripcion, es_fija BOOL, institucion_id NULLABLE).

**Niveles de logro** (decisión 2): **Bajo · Medio · Alto · Superior** (4 niveles).

**Banco de preguntas** (decisión 5): **por materia** (se comparte entre los docentes de
la materia en la institución; opcionalmente se puede filtrar por curso más adelante).
- `banco_preguntas` (materia_id, competencia_id, nivel_dificultad, tipo, enunciado,
  opciones JSON, respuesta_correcta, explicacion_opciones JSON, docente_id).
- Cada pregunta puede llevar **explicación educativa por opción** (decisión 6).

**Rúbrica** para lo abierto: `rubricas` + `rubrica_criterios` donde cada criterio se
califica por **nivel de logro** (Bajo..Superior) y alimenta la competencia.

**Boletín**: el campo por competencia guarda el **nivel de logro** (Bajo..Superior) por
periodo, derivado de las rúbricas/resultados.

## 6. Entidades / datos (resumen; a validar con el usuario)

Reutiliza: `materias`, `grupos`, `periodos_academicos`, `plan_evaluacion_items`, `notas`
(+`plan_item_id`), `tareas`, `entregas_tareas`, `archivos`, `estudiantes_matriculados`,
`boletines`.

Nuevas propuestas:
- `competencias` (+ catálogo fijo por migración).
- `competencia_estudiantes` o ampliar boletín → nivel de logro por competencia/periodo.
- `banco_preguntas` (por materia), `banco_opciones` (con explicación por opción).
- `evaluaciones` (materia_id, grupo_id, periodo_id, titulo, tipo_neuro, plantilla/parametros,
  fecha, vigencia, limite_tiempo, reintentos — decisión abierta §7).
- `evaluacion_preguntas` (evaluacion_id, pregunta_id OR texto propio, orden, puntos,
  competencia_id, nivel).
- `evaluacion_intentos` / `evaluacion_respuestas` (evaluacion_id, estudiante_id, intento,
  respuestas, puntaje, estado).
- Ampliar `plan_evaluacion_items` con `tipo` y `evaluacion_id UNIQUE`.
- `rubricas` y `rubrica_criterios`.

*Regla: nada se crea hasta confirmar el esquema con el usuario (no inventar tablas).*

## 7. Autocorrección vs. rúbrica y decisiones aún abiertas

- **Autocorregible** → se califica solo al enviar; retro inmediata (correcta/incorrecta +
  **explicación educativa por opción** que puso el docente).
- **Abierto/proyecto** → el docente califica con rúbrica por competencia (retoma
  `entregas_tareas.archivo_id` para respuesta con archivo).

**Preguntas abiertas a confirmar antes de codificar:**
- [x] ¿La suma de % de la plantilla debe forzarse a 100 por institución, o es flexible?
      → **Flexible pero sin superar 100** (decisión 2026-09-02).
- [ ] Límite de tiempo / reintentos de una evaluación → **se decide cuando trabajemos
      directamente el módulo** (es un tema amplio y se abordará con calma).
- [ ] ¿`plan_evaluacion_items` nuevo campo: se agrega `tipo` + `evaluacion_id UNIQUE` a la tabla existente (migración 20) — de acuerdo?
- [ ] El tipo neurocientífico: ¿traes ya el listado de tipos verificados por neurociencia, o lo definimos juntos como primer hito del constructor?
- [ ] ¿El director de curso arma la plantilla solo de su curso (ya visto en `hojaCalificacion`) o también puede crear evaluaciones de una materia que no dicta (hoy solo puede VER)?

## 8. Integración

- `plan-evaluacion.controller.js` → ampliar `crearItem`/`hojaCalificacion`/`guardarCelda`
  para tipos manual/entrega/evaluacion y la escritura automática.
- `notas.controller.js` → recalcular promedio ponderado al actualizar celdas automáticas.
- `tareas.controller.js` → exponer las "actividades asignadas" disponibles para enlazar.
- `boletin.controller.js` / `resumen.controller.js` → niveles por competencia.
- `mis-clases.html` / `dashboard.html` → pantalla del estudiante para presentar evaluaciones.
- `publicaciones` (catálogo global) → importar evaluaciones/preguntas modelo.

## 9. Criterio de hecho (DoD)

Por hito (ver `GUIA_DE_AVANCE.md` §5) — p. ej. "constructor + autocorrección + nota en vivo":
- Migración `database/NN_*.sql` aplicada (ampliar `plan_evaluacion_items`, tablas de
  evaluación/competencia).
- Rutas montadas en `src/app.js` con permisos por rol.
- Funciona contra la BD real (escenario de prueba registrado).
- No rompió: plan de evaluación actual, notas, tareas/entregas, boletín.
- Alumno: presenta la evaluación y **recibe retro inmediata**; la celda del docente se
  actualiza sola con la nota y el promedio.
- Restricción **1 actividad ⇔ 1 evaluación** verificada (no se puede enlazar dos veces).
- Docente: puede crear una evaluación desde plantilla **o** por parámetros avanzados y
  editar/agregar preguntas; puede sobreescribir la nota.

## 10. Decisiones del usuario (2026-09-02)

1. **Competencias:** fijas (catálogo estándar) **+** extras por institución.
2. **Niveles de logro:** Bajo · Medio · Alto · Superior.
3. **Flujo de notas/actividades:** plantilla por periodo con % (docente/director), tipos
   manual / PDF-entrega / enlazada a evaluación; **Enlazar** con restricción **1 a 1**;
   el sistema **calcula y actualiza la nota en vivo** y el docente **puede editarla**.
4. **Constructor:** plantilla propia o **parámetros avanzados** sobre un tema según
   **tipos de evaluación avalados por neurociencia** (listado que el usuario aportará);
   siempre editable / se pueden agregar preguntas.
5. **Banco de preguntas:** **por materia**.
6. **Retroalimentación:** el docente pone **explicación educativa por opción**.
7. **Porcentajes de la plantilla:** flexibles pero **sin superar 100** (2026-09-02).

> **Pendiente deliberado:** límite de tiempo / reintentos de evaluaciones y el listado
> de tipos avalados por neurociencia → se definen cuando trabajemos directamente el módulo.

## Historial de estado
- **2026-09-02:** spec creada + decisiones 1–7 incorporadas. % flexible (máx 100) resuelto.
  Pendiente de confirmar: esquema de tablas, y (deliberadamente, al trabajar el módulo)
  límite de tiempo/reintentos y el listado de tipos neurocientíficos.