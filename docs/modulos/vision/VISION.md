# VISION — SIA: sistema educativo que transforma la enseñanza

> Documento de visión y propósito. Está antes que el código: define **por qué** existe
> el SIA y hacia **dónde** va. Si una decisión técnica contradice esta visión, la visión manda.

## El problema que venimos a resolver

La enseñanza global enfrenta una **decadencia**: se premia la memorización, no el
comprender; se califica el resultado, no el proceso ni las habilidades; cada salón
enseña igual para todos, ignorando que cada estudiante aprende distinto; y las
buenas prácticas que sí funcionan quedan atrapadas en un solo colegio en vez de
extenderse. El SIA existe para ser **esa salida**: una plataforma donde la tecnología
no vigila estudiantes, sino que **los forma mejor**.

## La misión en una frase

Que el SIA no sea un simple gestor académico, sino un **entorno completo donde crece
la capacidad de enseñar y de aprender**, empezando por lo que ya sabe hacer (notas,
asistencia, boletines, horarios, tareas) y evolucionando hacia **evaluación por
competencias y aprendizaje por proyectos** que reviertan la decadencia de la
enseñanza.

## Modelo pedagógico que impulsa (los 4 pilares)

Elegidos de forma explícita; el sistema debe favorecerlos, no estorbarles:

1. **Aprendizaje por competencias.** No calificar solo conocimientos memorizados.
   Cada evaluación mide habilidades: pensamiento crítico, comunicación, colaboración,
   creatividad, resolución de problemas. El boletín debe reflejar **habilidades**,
   no solo promedios de notas.

2. **Aprendizaje basado en proyectos/retos.** Las "actividades" son proyectos o retos
   del mundo real donde el estudiante aplica lo aprendido. La evaluación valora tanto
   el **producto final** como el **proceso** (entrega, iteración, colaboración).

3. **Aprendizaje personalizado y adaptativo.** El sistema detecta por estudiante sus
   fortalezas y debilidades y **se adapta**: recomienda refuerzos, actividades de distinto
   nivel y camino de mejora según el desempeño real.

4. **Evaluación formativa continua.** Evaluaciones frecuentes y de bajo riesgo con
   **retroalimentación inmediata**, además de las sumativas. El foco es acompañar el
   proceso, no cazar errores al final.

## Cómo se materializa

- **Evaluaciones mixtas:** tipos autocorregibles (opción múltiple, verdadero/falso,
  emparejar, completar) que se califican solos + secciones libres (ensayo/proyecto)
  que el docente califica con **rúbricas por competencia**. Base sólida, rápida y de
  alto impacto.
- **Banco de preguntas** etiquetado por competencia y nivel, reutilizable y consistente.
- **Catálogo de prácticas y recursos globales** (superadmin): packs de metodologías,
  actividades modelo, guías y recursos **importables** por los docentes a sus cursos.
  No es solo lectura: es acción integrada que mejora de verdad la enseñanza.

## Principios de diseño

- Cada pantalla y flujo nuevo debe poder responder: *¿esto ayuda a que alguien
  aprenda o enseñe mejor?* Si no, se cuestiona.
- El docente sigue teniendo el control (nada reemplaza su juicio); el sistema
  **potencia**, no sustituye.
- Lo pedagógico es tanto o más importante que lo técnico: un módulo correcto
  técnicamente pero pedagogicamente hueco **no está terminado**.

## Alcance fuera de esta visión (por ahora)

- Forzar un único método de enseñanza: el SIA **ofrece** caminos, no los impone.
- Reemplazar al docente: SIA lo asiste.
- Migrar a React u otras deudas ya documentadas: solo si se decide explícitamente.

## Cómo se avanza

La planificación operativa (fases, hitos, criterios de "hecho") vive en:

- `docs/modulos/actualizaciones/ROADMAP.md` — hoja de ruta viva por fases e hitos.
- `docs/modulos/actualizaciones/GUIA_DE_AVANCE.md` — cómo pedir tareas, cómo documentar y el protocolo de trabajo.
- `docs/modulos/actualizaciones/*.md` — especificación detallada de cada módulo grande.
- `AGENTS.md` — contexto técnico para sesiones de IA.