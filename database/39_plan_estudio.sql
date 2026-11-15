-- Unifica actividades ponderadas y tareas dentro del plan de estudio.
-- Las tareas anteriores se conservan y se migran como actividades sin porcentaje.

USE sia_db;

ALTER TABLE plan_evaluacion_items
  MODIFY COLUMN peso_pct DECIMAL(5,2) NULL;

ALTER TABLE tareas
  ADD COLUMN plan_item_id CHAR(36) NULL AFTER periodo_id,
  ADD COLUMN archivo_id CHAR(36) NULL AFTER plan_item_id,
  ADD COLUMN permitir_tardias BOOLEAN NOT NULL DEFAULT TRUE AFTER archivo_id,
  ADD COLUMN recibir_entregas BOOLEAN NOT NULL DEFAULT TRUE AFTER permitir_tardias,
  ADD UNIQUE KEY uq_tareas_plan_item (plan_item_id),
  ADD KEY idx_tareas_archivo (archivo_id),
  ADD CONSTRAINT fk_tareas_plan_item FOREIGN KEY (plan_item_id)
    REFERENCES plan_evaluacion_items(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_tareas_archivo FOREIGN KEY (archivo_id)
    REFERENCES archivos(id) ON DELETE SET NULL;

ALTER TABLE entregas_tareas
  ADD COLUMN entrega_tarde BOOLEAN NOT NULL DEFAULT FALSE AFTER estado;

UPDATE entregas_tareas
SET entrega_tarde = TRUE
WHERE estado = 'tarde';

CREATE TEMPORARY TABLE _plan_estudio_tareas_migracion (
  tarea_id CHAR(36) NOT NULL PRIMARY KEY,
  plan_item_id CHAR(36) NOT NULL
);

INSERT INTO _plan_estudio_tareas_migracion (tarea_id, plan_item_id)
SELECT id, UUID() FROM tareas;

INSERT INTO plan_evaluacion_items (id, materia_id, periodo_id, nombre, peso_pct, orden)
SELECT migracion.plan_item_id, tarea.materia_id, tarea.periodo_id,
       LEFT(tarea.titulo, 150), NULL, 0
FROM tareas tarea
JOIN _plan_estudio_tareas_migracion migracion ON migracion.tarea_id = tarea.id;

UPDATE tareas tarea
JOIN _plan_estudio_tareas_migracion migracion ON migracion.tarea_id = tarea.id
SET tarea.plan_item_id = migracion.plan_item_id;

DROP TEMPORARY TABLE _plan_estudio_tareas_migracion;
