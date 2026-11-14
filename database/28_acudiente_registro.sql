-- =====================================================================
-- 28_acudiente_registro.sql
-- Autoregistro del acudiente con el código del curso del hijo (ROADMAP D5).
--   • acudientes_estudiantes.codigo_confirmado: guarda el código de curso
--     que el acudiente usó al vincularse a sí mismo (trazabilidad). El
--     código solo valida el vínculo UNA vez, al registrarse; luego el
--     acudiente entra con su propia contraseña y no se revalida.
-- Compatible con MySQL 8 y MariaDB, IDEMPOTENTE (information_schema +
-- PREPARE, patrón de la migración 25/26).
-- =====================================================================

USE sia_db;

SET SESSION sql_mode = REPLACE(@@sql_mode, 'ANSI_QUOTES', '');

SET @has_codigo = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'acudientes_estudiantes'
    AND COLUMN_NAME = 'codigo_confirmado'
);
SET @ddl = IF(@has_codigo = 0,
  "ALTER TABLE acudientes_estudiantes
     ADD COLUMN codigo_confirmado CHAR(8) NULL AFTER es_principal",
  "SELECT 'codigo_confirmado ya existia'");
PREPARE c1 FROM @ddl; EXECUTE c1; DEALLOCATE PREPARE c1;
