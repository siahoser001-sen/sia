# MÓDULO: Asistencia diaria por curso

## Objetivo
Mantener una lista compartida de asistencia por curso, una marca por estudiante y día, independiente de la materia.

## Alcance
- Grilla mensual para director del curso y docentes asignados a alguna materia del curso.
- El estudiante matriculado puede consultar únicamente su propia fila; esta entrega deja lista la API de lectura.
- Estados: `asistio`, `falta`, `tarde`, `justificada`. Una justificación admite motivo y/o un archivo.
- Los fines de semana no se pueden editar.
- Cada celda justificada acepta un soporte PDF, JPG/JPEG, PNG, WEBP, DOC o DOCX de hasta 5 MB. Los soportes se registran en `archivos` y se sirven mediante una ruta autenticada.
- La grilla editable vive en `mis-clases.html` para directores/docentes. El estudiante
  consulta su fila en modo de solo lectura desde `materia-estudiante.html` mediante
  `GET /api/asistencia-dia?grupo_id=&mes=`; el historial y resumen legados por materia
  siguen disponibles a través de `asistencia.controller`.

## Integración y datos
`asistencia` permanece intacta como registro histórico por materia. No se convierte ni se fusiona automáticamente porque las materias pueden tener estados distintos para el mismo estudiante y fecha.

`asistencia_dia` es la fuente de los conteos de curso por día. `resumen/curso` conserva su forma de respuesta y suma esta tabla. Boletines e informe didáctico agregan un resumen explícito de curso/día, sin atribuir esas faltas a una materia; sus fallas por materia siguen representando los registros legados.

## Permisos
- Director del grupo y docentes asociados al grupo mediante `docentes_materias` pueden leer y editar.
- Se reconoce la asignación con `grupo_id` explícito y la asignación general (`grupo_id IS NULL`) cuando la materia está vinculada al curso.
- Un estudiante activo en el grupo solo puede leer su propia fila.

## Criterio de hecho y prueba manual
Aplicar migraciones con `npm run migrate`; verificar que el editor guarda y vuelve a cargar cada estado, que solo muestra estudiantes matriculados, que rechaza fines de semana y usuarios sin acceso, que soporta documentos permitidos hasta 5 MB y que el estudiante solo obtiene su fila. Comprobar que resumen, boletín e informe diferencian los conteos diarios de los históricos por materia. Pasos detallados en `docs/verificacion/PRUEBAS_MANUALES.md`.
