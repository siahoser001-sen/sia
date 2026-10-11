-- ============================================================
--  05_publicaciones_globales.sql
--  Permite que el superadministrador publique comunicados
--  globales (visibles para TODAS las instituciones), sin
--  necesidad de asociarlos a una institución específica.
-- ============================================================

ALTER TABLE comunicados
  MODIFY COLUMN institucion_id CHAR(36) NULL;
