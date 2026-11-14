-- =====================================================================
-- 31_boletines_anual.sql
-- Informe anual (ROADMAP D8).
--   El historial `boletines` hoy solo guarda boletines por periodo
--   (periodo_id NOT NULL). El informe anual recorre TODOS los periodos
--   del año, así que:
--     • periodo_id pasa a NULL (no es un periodo puntual),
--     • nueva columna tipo: 'periodo' (default, no cambia nada) | 'anual',
--     • nueva columna anio_lectivo: año al que corresponde el informe.
-- Compatible con MySQL 8 y MariaDB, IDEMPOTENTE (information_schema +
-- PREPARE, patrón de las migraciones 28/29).
-- =====================================================================

USE sia_db;

SET SESSION sql_mode = REPLACE(@@sql_mode, 'ANSI_QUOTES', '');

SET @has_tipo = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'boletines'
    AND COLUMN_NAME = 'tipo'
);
SET @ddl = IF(@has_tipo = 0,
  "ALTER TABLE boletines
     ADD COLUMN tipo ENUM('periodo','anual') NOT NULL DEFAULT 'periodo' AFTER periodo_id,
     ADD COLUMN anio_lectivo SMALLINT NULL AFTER tipo",
  "SELECT 'boletines.tipo ya existia'");
PREPARE c1 FROM @ddl; EXECUTE c1; DEALLOCATE PREPARE c1;

SET @per_not_null = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'boletines'
    AND COLUMN_NAME = 'periodo_id' AND IS_NULLABLE = 'NO'
);
SET @ddl2 = IF(@per_not_null = 1,
  "ALTER TABLE boletines MODIFY COLUMN periodo_id char(36) NULL",
  "SELECT 'boletines.periodo_id ya es nullable'");
PREPARE c2 FROM @ddl2; EXECUTE c2; DEALLOCATE PREPARE c2;