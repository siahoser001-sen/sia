-- =====================================================================
-- 15_plan_evaluacion.sql
-- Plan de evaluación por materia y periodo (actividades con % de peso),
-- y el enlace de cada nota a la actividad del plan que la generó.
--
-- Requiere que `materias.grupo_id` ya exista (migración 14). Si no la
-- corriste todavía, corre esa primero.
-- =====================================================================

START TRANSACTION;

-- 1) Tabla del plan: qué actividades se van a evaluar en una materia,
--    en un periodo puntual, y cuánto vale cada una.
CREATE TABLE `plan_evaluacion_items` (
  `id` char(36) NOT NULL DEFAULT uuid(),
  `materia_id` char(36) NOT NULL,
  `periodo_id` char(36) NOT NULL,
  `nombre` varchar(150) NOT NULL,
  `peso_pct` decimal(5,2) NOT NULL,
  `orden` smallint(6) NOT NULL DEFAULT 0,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_plan_materia` (`materia_id`),
  KEY `idx_plan_periodo` (`periodo_id`),
  CONSTRAINT `chk_plan_peso_pct` CHECK (`peso_pct` > 0 AND `peso_pct` <= 100)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `plan_evaluacion_items`
  ADD CONSTRAINT `fk_plan_items_materia`
    FOREIGN KEY (`materia_id`) REFERENCES `materias` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_plan_items_periodo`
    FOREIGN KEY (`periodo_id`) REFERENCES `periodos_academicos` (`id`);
    -- Sin ON DELETE CASCADE a propósito: mismo criterio ya usado con
    -- periodos y notas (sección 3 del ROADMAP) — un periodo con datos
    -- cargados adentro no se puede borrar, solo editar sus fechas.

-- 2) Liga cada nota a la actividad del plan que la generó. Nullable:
--    las notas creadas por el flujo manual viejo (POST /api/notas, sin
--    pasar por un plan) siguen existiendo tal cual, con plan_item_id
--    en NULL, sin que esto las afecte.
ALTER TABLE `notas`
  ADD COLUMN `plan_item_id` char(36) DEFAULT NULL AFTER `materia_id`;

ALTER TABLE `notas`
  ADD CONSTRAINT `fk_notas_plan_item`
    FOREIGN KEY (`plan_item_id`) REFERENCES `plan_evaluacion_items` (`id`)
    ON DELETE SET NULL;

-- 3) Único (plan_item_id, estudiante_id): permite guardar cada celda de
--    la hoja de calificación con un solo INSERT ... ON DUPLICATE KEY
--    UPDATE. Como MySQL/MariaDB trata cada NULL como distinto en un
--    índice único, esto no afecta a las notas viejas (todas con
--    plan_item_id = NULL conviven sin conflicto).
ALTER TABLE `notas`
  ADD UNIQUE KEY `uq_notas_plan_estudiante` (`plan_item_id`, `estudiante_id`);

COMMIT;
