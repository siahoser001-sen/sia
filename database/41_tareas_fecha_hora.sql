USE sia_db;

ALTER TABLE tareas
  MODIFY COLUMN fecha_entrega DATETIME NOT NULL;

UPDATE tareas
SET fecha_entrega = CONCAT(DATE_FORMAT(fecha_entrega, '%Y-%m-%d'), ' 23:59:59');
