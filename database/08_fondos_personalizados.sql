-- ============================================================
--  08_fondos_personalizados.sql
--  Permite que los usuarios suban su propio fondo de pantalla
--  personalizado (visible junto a los 6 fondos predefinidos en
--  el selector de "Elige tu fondo").
--
--  Cómo ejecutarlo (igual que los otros archivos de /database):
--  MySQL Workbench → File → Open SQL Script → este archivo
--  → Ctrl+Shift+Enter
-- ============================================================

USE sia_db;

ALTER TABLE archivos
    MODIFY COLUMN tipo ENUM(
        'recurso_clase',
        'tarea_entregada',
        'foto_perfil',
        'logo_institucion',
        'comunicado',
        'fondo_personalizado',
        'otro'
    ) NOT NULL DEFAULT 'otro';
