-- =====================================================================
-- 23_materias_generales.sql
-- Permite materias "generales" de institución (sin grado ni curso),
-- creadas por el admin (p. ej. Ética, Religión) que luego pueden
-- asignarse a cualquier curso y a varios docentes.
--   • materias.grado_id            → pasa a NULL (una materia general no
--     pertenece a un grado). Se conserva la FK (nullable).
--   • materias.institucion_id      → nueva columna que fija a qué
--     institución pertenece la materia. `areas` es global (sin
--     institucion_id), así que el scope se guarda en materias.
--   • docentes_materias.grupo_id   → pasa a NULL (una co-docencia puede
--     ser de la materia general, sin curso).
--   • docentes_materias.institucion_id → nueva, heredada del backfill
--     desde materias.
-- Archivo idempotente (guards IF [NOT] EXISTS) para poder reintentarlo
-- de forma segura si falló a mitad de camino.
-- =====================================================================

START TRANSACTION;

-- 1) Quitar las FKs que impiden NULL en las columnas que cambian.
ALTER TABLE `materias`
  DROP FOREIGN KEY IF EXISTS `materias_ibfk_2`;

ALTER TABLE `docentes_materias`
  DROP FOREIGN KEY IF EXISTS `docentes_materias_ibfk_3`;

-- 2) materias: columna institucion_id (nullable primero), backfill
--    desde el grado actual y luego NOT NULL.
ALTER TABLE `materias`
  ADD COLUMN IF NOT EXISTS `institucion_id` char(36) DEFAULT NULL AFTER `id`;

UPDATE `materias` m
JOIN `grados` gr ON gr.`id` = m.`grado_id`
SET m.`institucion_id` = gr.`institucion_id`
WHERE m.`institucion_id` IS NULL;

ALTER TABLE `materias`
  MODIFY `institucion_id` char(36) NOT NULL;

-- 3) materias: grado_id ahora opcional.
ALTER TABLE `materias`
  MODIFY `grado_id` char(36) DEFAULT NULL;

-- 4) docentes_materias: columna institucion_id (nullable primero),
--    backfill desde la materia y luego NOT NULL; grupo_id opcional.
ALTER TABLE `docentes_materias`
  ADD COLUMN IF NOT EXISTS `institucion_id` char(36) DEFAULT NULL AFTER `materia_id`;

UPDATE `docentes_materias` dm
JOIN `materias` m ON m.`id` = dm.`materia_id`
SET dm.`institucion_id` = m.`institucion_id`
WHERE dm.`institucion_id` IS NULL;

ALTER TABLE `docentes_materias`
  MODIFY `institucion_id` char(36) NOT NULL;

ALTER TABLE `docentes_materias`
  MODIFY `grupo_id` char(36) DEFAULT NULL;

-- 5) Re-crear las FKs (nullable): si el id viene, debe existir; NULL es
--    válido. Se agregan solo si ya no existen (no hay IF NOT EXISTS para
--    ADD CONSTRAINT, se resuelve con SQL dinámico).
SET @existeMaterias := (SELECT COUNT(*)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'materias'
    AND CONSTRAINT_NAME = 'materias_ibfk_2'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY');

SET @sqlMaterias := IF(@existeMaterias = 0,
  'ALTER TABLE materias ADD CONSTRAINT materias_ibfk_2 FOREIGN KEY (grado_id) REFERENCES grados(id) ON DELETE CASCADE',
  'SELECT 1');
PREPARE stmtMaterias FROM @sqlMaterias;
EXECUTE stmtMaterias;
DEALLOCATE PREPARE stmtMaterias;

SET @existeDocentes := (SELECT COUNT(*)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'docentes_materias'
    AND CONSTRAINT_NAME = 'docentes_materias_ibfk_3'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY');

SET @sqlDocentes := IF(@existeDocentes = 0,
  'ALTER TABLE docentes_materias ADD CONSTRAINT docentes_materias_ibfk_3 FOREIGN KEY (grupo_id) REFERENCES grupos(id) ON DELETE CASCADE',
  'SELECT 1');
PREPARE stmtDocentes FROM @sqlDocentes;
EXECUTE stmtDocentes;
DEALLOCATE PREPARE stmtDocentes;

COMMIT;