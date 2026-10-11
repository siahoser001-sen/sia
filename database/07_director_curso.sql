-- ============================================================
--  07_director_curso.sql
--  Agrega el concepto de "director de curso": un docente
--  responsable de un grupo, con permiso para matricular
--  estudiantes en ese grupo y consultar su información académica.
--
--  Cómo ejecutarlo (igual que los otros archivos de /database):
--  MySQL Workbench → File → Open SQL Script → este archivo
--  → Ctrl+Shift+Enter
-- ============================================================

USE sia_db;

ALTER TABLE grupos
    ADD COLUMN director_id CHAR(36) NULL AFTER grado_id,
    ADD CONSTRAINT fk_grupo_director
        FOREIGN KEY (director_id) REFERENCES usuarios(id) ON DELETE SET NULL,
    ADD INDEX idx_grupo_director (director_id);
