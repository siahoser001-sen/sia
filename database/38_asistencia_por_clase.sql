USE sia_db;

ALTER TABLE asistencia_dia
  ADD COLUMN clase_id CHAR(36) NULL AFTER fecha,
  DROP INDEX uq_asistencia_dia_grupo_estudiante_fecha,
  ADD UNIQUE KEY uq_asistencia_dia_grupo_estudiante_fecha_clase
    (grupo_id, estudiante_id, fecha, clase_id),
  ADD KEY idx_asistencia_dia_clase_fecha (clase_id, fecha),
  ADD CONSTRAINT fk_asistencia_dia_clase FOREIGN KEY (clase_id)
    REFERENCES horarios (id) ON DELETE SET NULL;
