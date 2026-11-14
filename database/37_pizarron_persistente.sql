-- Persistencia del pizarrón por materia o por curso.
-- `datos_trazo` conserva el JSON de trazos y texto; los trazos asociados
-- a sesiones previas se reasignan al pizarrón persistente de su materia.

USE sia_db;

ALTER TABLE pizarron_trazos
  MODIFY sesion_clase_id CHAR(36) NULL,
  ADD COLUMN docente_materia_id CHAR(36) NULL AFTER sesion_clase_id,
  ADD COLUMN grupo_id CHAR(36) NULL AFTER docente_materia_id,
  ADD COLUMN orden BIGINT UNSIGNED NOT NULL AUTO_INCREMENT UNIQUE AFTER datos_trazo,
  ADD INDEX idx_pizarron_materia_orden (docente_materia_id, orden),
  ADD INDEX idx_pizarron_grupo_orden (grupo_id, orden),
  ADD CONSTRAINT fk_pizarron_trazo_materia
    FOREIGN KEY (docente_materia_id) REFERENCES docentes_materias(id) ON DELETE CASCADE,
  ADD CONSTRAINT fk_pizarron_trazo_grupo
    FOREIGN KEY (grupo_id) REFERENCES grupos(id) ON DELETE CASCADE;

UPDATE pizarron_trazos pt
JOIN sesiones_clase sc ON sc.id = pt.sesion_clase_id
SET pt.docente_materia_id = sc.docente_materia_id
WHERE pt.sesion_clase_id IS NOT NULL;
