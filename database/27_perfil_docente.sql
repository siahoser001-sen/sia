-- =====================================================================
-- 27_perfil_docente.sql
-- Perfil del docente (ROADMAP Ronda D, punto D4).
--   Agrega a `usuarios` los campos descriptivos del perfil docente.
--   Se usan solo para el rol 'docente' (los demas roles los dejan NULL),
--   pero viven en usuarios para no crear tabla nueva.
--   • cargo             : trabajo/cargo (ej. "Docente de Matematicas")
--   • titulo_academico  : formacion (ej. "Licenciado en Matematicas")
--   • areas             : areas que ensena (texto libre)
--   • hijos_institucion : hijos en la institucion (texto libre)
--   • biografia         : presentacion libre
--   (usuarios ya tiene telefono y direccion.)
-- Compatible con MySQL 8 y MariaDB, IDEMPOTENTE (guardas sobre
-- information_schema + PREPARE, patron de la migracion 26).
-- =====================================================================

USE sia_db;

SET SESSION sql_mode = REPLACE(@@sql_mode, 'ANSI_QUOTES', '');

SET @has_perfil_docente = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'usuarios'
    AND COLUMN_NAME = 'biografia'
);
SET @ddl = IF(@has_perfil_docente = 0,
  "ALTER TABLE usuarios
     ADD COLUMN cargo              VARCHAR(120) NULL AFTER direccion,
     ADD COLUMN titulo_academico   VARCHAR(150) NULL AFTER cargo,
     ADD COLUMN areas              VARCHAR(255) NULL AFTER titulo_academico,
     ADD COLUMN hijos_institucion  VARCHAR(255) NULL AFTER areas,
     ADD COLUMN biografia          TEXT         NULL AFTER hijos_institucion",
  "SELECT 'perfil docente ya existia'");
PREPARE c1 FROM @ddl; EXECUTE c1; DEALLOCATE PREPARE c1;
