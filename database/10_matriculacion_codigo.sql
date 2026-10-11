-- ============================================================
--  10_matriculacion_codigo.sql
--  Código de grupo: el director de curso (o admin) genera un
--  código corto que los estudiantes usan para auto-matricularse
--  en su grupo, sin pasar por el flujo manual de admin.
--
--  Cómo ejecutarlo (igual que los otros archivos de /database):
--  MySQL Workbench → File → Open SQL Script → este archivo
--  → Ctrl+Shift+Enter
-- ============================================================

USE sia_db;

ALTER TABLE grupos
    ADD COLUMN codigo_matricula CHAR(8) NULL UNIQUE AFTER director_id,
    ADD COLUMN codigo_activo    BOOLEAN NOT NULL DEFAULT TRUE AFTER codigo_matricula;
