-- =====================================================================
-- 16_boletines.sql
-- Historial de boletines generados (uno por estudiante, guarda copia
-- cada vez que se genera — no se sobreescribe). El PDF en sí se guarda
-- como un `archivos` más, reusando el mismo patrón que ya tienes para
-- fotos de perfil / logos / recursos de clase.
--
-- Requiere: 14_materias_por_curso.sql y 15_plan_evaluacion.sql ya
-- aplicadas.
-- =====================================================================

START TRANSACTION;

-- 1) Nuevo tipo de archivo, para que un boletín se pueda distinguir del
--    resto en `archivos.tipo` (filtros, limpieza, etc.).
ALTER TABLE `archivos`
  MODIFY COLUMN `tipo` enum(
    'recurso_clase','tarea_entregada','foto_perfil','logo_institucion',
    'comunicado','fondo_personalizado','boletin','otro'
  ) NOT NULL DEFAULT 'otro';

-- 2) Historial de boletines. Cada fila = una generación puntual (si se
--    regenera el boletín de un estudiante, se inserta una fila nueva,
--    no se pisa la anterior — así queda el historial completo).
CREATE TABLE `boletines` (
  `id` char(36) NOT NULL DEFAULT uuid(),
  `estudiante_id` char(36) NOT NULL,
  `grupo_id` char(36) NOT NULL,
  `periodo_id` char(36) NOT NULL,
  `generado_por` char(36) NOT NULL,
  `archivo_id` char(36) NOT NULL,
  `observaciones` text DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_boletin_estudiante` (`estudiante_id`),
  KEY `idx_boletin_periodo` (`periodo_id`),
  KEY `idx_boletin_grupo` (`grupo_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `boletines`
  ADD CONSTRAINT `fk_boletines_estudiante`
    FOREIGN KEY (`estudiante_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_boletines_grupo`
    FOREIGN KEY (`grupo_id`) REFERENCES `grupos` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_boletines_periodo`
    FOREIGN KEY (`periodo_id`) REFERENCES `periodos_academicos` (`id`),
    -- Sin CASCADE, mismo criterio que notas y plan_evaluacion_items.
  ADD CONSTRAINT `fk_boletines_generado_por`
    FOREIGN KEY (`generado_por`) REFERENCES `usuarios` (`id`),
  ADD CONSTRAINT `fk_boletines_archivo`
    FOREIGN KEY (`archivo_id`) REFERENCES `archivos` (`id`) ON DELETE CASCADE;

COMMIT;
