-- =====================================================================
-- 30_notas_periodo_cierre.sql
-- Snapshot de nota por periodo (ROADMAP D7).
--   Al trasladar a un estudiante de curso, su promedio anual debe
--   combinar los periodos cursados en el curso anterior con los del nuevo.
--   Como las notas se calculan (no se guardan) y dejan de pertenecer al
--   estudiante al salir del curso, este snapshot congela el promedio de
--   cada materia por periodo en el momento del traslado.
--   Identidad de materia entre cursos: por NOMBRE de materia (dentro del
--   mismo grado, D7); el área se guarda solo informativo.
-- Compatible con MySQL 8 y MariaDB, IDEMPOTENTE.
-- =====================================================================

USE sia_db;

START TRANSACTION;

CREATE TABLE IF NOT EXISTS `notas_periodo_cierre` (
  `id`              CHAR(36)      NOT NULL PRIMARY KEY DEFAULT (UUID()),
  `estudiante_id`   CHAR(36)      NOT NULL,
  `periodo_id`      CHAR(36)      NOT NULL,
  `grupo_id`        CHAR(36)      NOT NULL,
  `materia_nombre`  VARCHAR(150)  NOT NULL,
  `area_nombre`     VARCHAR(100)  DEFAULT NULL,
  `promedio_periodo` DECIMAL(5,2) NOT NULL,
  `anio_lectivo`    SMALLINT      NOT NULL,
  `created_at`      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_cierre` (`estudiante_id`, `periodo_id`, `materia_nombre`),
  KEY `idx_cierre_estudiante` (`estudiante_id`),
  CONSTRAINT `fk_cierre_estudiante` FOREIGN KEY (`estudiante_id`)
    REFERENCES `usuarios` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_cierre_periodo` FOREIGN KEY (`periodo_id`)
    REFERENCES `periodos_academicos` (`id`),
  CONSTRAINT `fk_cierre_grupo` FOREIGN KEY (`grupo_id`)
    REFERENCES `grupos` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

COMMIT;