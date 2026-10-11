# GUIA_DE_AVANCE — cómo trabajar con el SIA de ahora en adelante

> Reglas prácticas para que cualquier sesión (humana o de IA) avance rápido, ordenado
> y sin malentendidos. Léelo antes de pedir/empezar una tarea. Se actualiza cuando las
> reglas cambien.

## 1. Cómo pedir una tarea (plantilla)

Cuando pidas algo nuevo, escribe (mínimo los 3 primeros campos; el resto es ideal):

1. **Qué quieres lograr** (el resultado, en una frase, orientado a valor).
2. **Para quién es** (rol que lo usa: superadmin / admin / director / docente / estudiante / acudiente).
3. **Cómo debería sentirse al usarlo** (el flujo ideal, paso a paso, en lenguaje simple).
4. **Qué NO debe pasar** (límites: no romper X, no tocar Y, no cambiar el estilo).
5. **Prioridad** (crítico / importante / deseable) para ordenar contra el ROADMAP.

> Ejemplo bueno: *"Una evaluación mixta por competencias para el docente (1), que
> permita armar un examen con preguntas autocorregibles + una sección abierta calificada
> con rúbrica (3). Debe poder reutilizar preguntas de un banco y ver en el boletín las
> habilidades del estudiante (2). No debe cambiar cómo funciona el plan de evaluación
> actual (4). Prioridad: importante (5)."*

## 2. Cómo avanzar en fases (unidad de valor)

Trabajamos por **FASES** → **HITOS** → **CRITERIO DE HECHO (DoD)**. Una fase termina
solo cuando su hito está **verificado de verdad**, no cuando "parece" lista.

- **Fase:** un módulo entregable completo (ej. "Evaluaciones por competencias").
- **Hito:** un paso interno de esa fase con valor propio (ej. "CRUD de preguntas en el banco").
- **DoD (Definition of Done):** la lista concreta que prueba que un hito quedó hecho.
  Siempre incluye: *funciona contra la BD real*, *no rompió lo existente*, y *cómo lo
  pruebas a mano*.

## 3. La regla de oro: verificar, no asumir

El proyecto **no tiene tests ni lint automatizados** y el historial del ROADMAP se ha
desincronizado varias veces. Por eso:

- Antes de dar una marca "✅ hecho", **verificar en el código** (grep/find) que el
  archivo, la función o la ruta existen y funcionan. No confiar en descripciones.
- Después de un cambio, **probar manualmente** (navegador + MySQL) y registrar cómo
  se probó en el hito.
- Si un doc dice algo y el código dice otra cosa, **manda el código**.

## 4. Estructura de documentación (less)

Para que no se te escape nada y todo esté en el lugar correcto (rutas actualizadas
a la organización vigente 2026-09-02):

```
docs/modulos/vision/VISION.md                       → por qué existe el SIA y el modelo pedagógico.
docs/modulos/actualizaciones/ROADMAP.md             → hoja de ruta viva: fases, hitos y estado de cada uno.
docs/modulos/actualizaciones/GUIA_DE_AVANCE.md      → este archivo: cómo trabajar.
docs/modulos/actualizaciones/<MODULO>.md            → spec detallada de cada módulo grande.
README.md                                           → manual de instalación/arranque (no cambia su rol).
AGENTS.md                                           → contexto técnico para sesiones de IA.
```

**Cuándo crear/actualizar cada uno:**
- Nuevo módulo grande (evaluaciones, actividades, banco de preguntas, catálogo)
  → crear `docs/modulos/actualizaciones/<MODULO>.md` **antes** de codificar.
- Terminar/hito → tachar/marcar en `ROADMAP.md` **y** reflejarlo en el código.
- Cambio de modelo pedagógico/vision → actualizar `../vision/VISION.md` primero.
- Cambio de convención técnica → `AGENTS.md`.

## 5. Plantilla de `docs/modulos/actualizaciones/<MODULO>.md`

Todo módulo nuevo empieza con esta cabeza, y se completa con el usuario antes de
escribir código:

```
# MÓDULO: <Nombre>
## Objetivo pedagógico      (qué habilidad/competencia impulsa)
## Alcance                  (qué incluye y qué queda fuera)
## Roles y flujo            (quién hace qué, paso a paso)
## Entidades / datos        (tablas, campos; reutilizar lo que exista)
## Autocorrección / rúbrica (qué se califica solo vs. qué califica el docente)
## Integración              (módulos existentes que toca)
## Preguntas abiertas       (decisiones pendientes que bloquean)
## Criterio de hecho (DoD)  (qué prueba que está listo y cómo probarlo a mano)
```

## 6. Protocolo para cada sesión (checklist)

1. Revisar `docs/modulos/actualizaciones/ROADMAP.md` → ¿en qué fase/hito toca ahora?
2. Si es módulo nuevo → leer/actualizar su `docs/modulos/actualizaciones/*.md`.
3. Hacer solo lo de ese hito; no mezclar fases.
4. Verificar contra la BD real + registrar la prueba.
5. Actualizar ROADMAP / spec al terminar.
6. Si algo no quedó probado → marcarlo como pendiente, no como "hecho".

## 7. Errores a evitar (lecciones aprendidas)

- Marcar "construido" sin verificar en código (pasó varias veces).
- Mezclar varios hitos/decisiones en un solo cambio gigante.
- Quemar `localhost:3000` en el frontend (usar `window.location.origin`).
- Cambiar de esquema sin crear migración `database/NN_...`.
- Pierde el modelo pedagógico al tomar atajos técnicos: si una evaluación mide
  solo memoria cuando la visión pide habilidades, **no está terminada**.