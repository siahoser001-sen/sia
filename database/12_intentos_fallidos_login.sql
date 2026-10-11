-- ============================================================
-- 12_intentos_fallidos_login.sql
-- Bloqueo temporal por intentos fallidos de inicio de sesión.
-- Aplica a TODOS los roles (superadmin, admin, docente,
-- estudiante, acudiente) porque viven en la misma tabla `usuarios`.
-- ============================================================

ALTER TABLE usuarios
  ADD COLUMN intentos_fallidos INT NOT NULL DEFAULT 0,
  ADD COLUMN bloqueado_hasta   DATETIME NULL;
