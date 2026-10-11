-- =====================================================================
-- 20_horario_horas.sql
-- Plantilla global de horas de trabajo por institución (Punto 1 del
-- ROADMAP, 2026-09-02).
--
-- Idea:
--   - El ADMIN define UNA VEZ las horas en las que se trabaja en su
--     institución (por día de la semana: hora_inicio y hora_fin).
--   - El DIRECTOR de curso NO inventa horas: asigna la materia de cada
--     hora de su curso eligiendo entre estas horas ya planteadas.
--   - La tabla `horarios` (existente) guarda la asignación por curso:
--     que materia va en cada (grupo, dia_semana, hora_inicio).
--
-- Por qué separar: centraliza la jornada de la institución y evita que
-- cada curso defina horas distintas e inconsistentes.
-- =====================================================================

START TRANSACTION;

CREATE TABLE IF NOT EXISTS `horario_horas` (
  `id` char(36) NOT NULL DEFAULT uuid(),
  `institucion_id` char(36) NOT NULL,
  `dia_semana` smallint NOT NULL,      -- 1 = lunes ... 7 = domingo
  `hora_inicio` time NOT NULL,
  `hora_fin` time NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_hh_inst_dia` (`institucion_id`, `dia_semana`),
  CONSTRAINT `uk_hh_inst_dia_hora` UNIQUE (`institucion_id`, `dia_semana`, `hora_inicio`),
  CONSTRAINT `fk_hh_inst` FOREIGN KEY (`institucion_id`) REFERENCES `instituciones` (`id`) ON DELETE CASCADE,
  CONSTRAINT `chk_hh_dia` CHECK (`dia_semana` BETWEEN 1 AND 7),
  CONSTRAINT `chk_hh_horas` CHECK (`hora_fin` > `hora_inicio`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

COMMIT;
