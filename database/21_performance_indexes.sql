-- ============================================================
--  21_performance_indexes.sql — Índices de rendimiento
--  Reduce lecturas de disco/full-scans en las rutas calientes
--  (login, promedios/boletines, matrículas, plan de evaluación
--   y generación de boletines) sin cambiar comportamiento.
-- ============================================================

-- 1. Login: el identificador puede ser correo (ya indexado por UNIQUE)
--    o número de documento. `uq_documento` empieza por tipo_documento,
--    así que numero_documento solo no la puede usar → full scan en el
--    login por documento. Este índice deja ambos lados indexables.
ALTER TABLE usuarios
  ADD INDEX idx_numero_documento (numero_documento);

-- 2. Promedios / boletín / asistencia por estudiante+materia+periodo:
--    antes solo había índices individuales por columna; este compuesto
--    atiende las agregaciones (AVG/COUNT) de un solo salto al índice.
ALTER TABLE notas
  ADD INDEX idx_notas_estudiante_materia_periodo (estudiante_id, materia_id, periodo_id);

-- 3. Validación de asistencia y listados de curso: se filtra
--    `grupo_id = ? AND estado='activa'` en cada jornada; cubre el
--    filtro completo sin tocar la tabla.
ALTER TABLE matriculas
  ADD INDEX idx_matricula_grupo_estado (grupo_id, estado);

-- 4. Generación y consulta de boletines por periodo y grupo.
ALTER TABLE boletines
  ADD INDEX idx_boletin_periodo_grupo (periodo_id, grupo_id);

-- 5. Plan de evaluación: se lista/consulta por materia dentro del
--    periodo activo.
ALTER TABLE plan_evaluacion_items
  ADD INDEX idx_plan_materia_periodo (materia_id, periodo_id);