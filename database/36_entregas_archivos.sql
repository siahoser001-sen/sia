-- =====================================================================
-- 36_entregas_archivos.sql
-- Varios archivos por entrega de tarea (máx. 5, validado en Node).
--   `entregas_tareas.archivo_id` se conserva por compatibilidad con el
--   esquema anterior (un solo archivo); los archivos nuevos viven en
--   esta tabla puente y se registran en `archivos`.
-- No se aplica automáticamente: requiere confirmación del usuario.
-- =====================================================================

USE sia_db;

CREATE TABLE IF NOT EXISTS entregas_archivos (
  id          CHAR(36) NOT NULL PRIMARY KEY DEFAULT (UUID()),
  entrega_id  CHAR(36) NOT NULL,
  archivo_id  CHAR(36) NOT NULL,
  creado_en   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_entrega_archivo (entrega_id, archivo_id),
  KEY idx_entregas_archivos_archivo (archivo_id),
  CONSTRAINT fk_entregas_archivos_entrega FOREIGN KEY (entrega_id)
    REFERENCES entregas_tareas(id) ON DELETE CASCADE,
  CONSTRAINT fk_entregas_archivos_archivo FOREIGN KEY (archivo_id)
    REFERENCES archivos(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
