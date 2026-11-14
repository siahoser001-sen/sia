-- =====================================================================
-- 32_materias_curso.sql
-- Vínculo explícito MATERIA ↔ CURSO (ROADMAP E1).
--   El admin crea materias "generales" de la institución (materias.grupo_id
--   = NULL) y luego, dentro de cada curso, elige cuáles de esas materias se
--   dictan. Antes ese vínculo solo existía de forma implícita en
--   `docentes_materias.grupo_id` (hacía falta asignar un docente); esta tabla
--   permite definir las materias del curso de forma independiente de quién
--   las dicte.
--   `materias.grupo_id` se conserva (historicidad) y sigue funcionando; esta
--   tabla es el catálogo curso→materias para el nuevo flujo.
-- Compatible con MySQL 8 y MariaDB, IDEMPOTENTE.
-- =====================================================================

USE sia_db;

START TRANSACTION;

CREATE TABLE IF NOT EXISTS `materias_curso` (
  `id`             CHAR(36)  NOT NULL PRIMARY KEY DEFAULT (UUID()),
  `institucion_id` CHAR(36)  NOT NULL,
  `grupo_id`       CHAR(36)  NOT NULL,
  `materia_id`     CHAR(36)  NOT NULL,
  `created_at`     DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_materia_curso` (`grupo_id`, `materia_id`),
  KEY `idx_mc_materia` (`materia_id`),
  KEY `idx_mc_grupo` (`grupo_id`),
  CONSTRAINT `fk_mc_institucion` FOREIGN KEY (`institucion_id`)
    REFERENCES `instituciones` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_mc_grupo` FOREIGN KEY (`grupo_id`)
    REFERENCES `grupos` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_mc_materia` FOREIGN KEY (`materia_id`)
    REFERENCES `materias` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

COMMIT;
