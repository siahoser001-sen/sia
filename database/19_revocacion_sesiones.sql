-- ============================================================
--  19_revocacion_sesiones.sql
--  Revocación de sesiones JWT (Punto 3 de la auditoría de login).
--
--  Agrega a `usuarios` la columna `token_version`: un contador que
--  empieza en 0. Cada JWT de sesión incluye el valor de `ver`
--  (token_version) vigente al momento de iniciar sesión. Cuando el
--  usuario cambia/recupera su contraseña (o el admin la restablece),
--  se incrementa `token_version` y TODOS los tokens emitidos antes
--  quedan inválidos en el servidor aunque no hayan expirado.
--
--  Para el caso de "cerrar sesión" (invalidar una sola sesión),
--  se usa adicionalmente una lista negra en memoria de `jti`
--  (ver src/utils/revocacion.js), sin necesidad de tabla.
--
--  Ejecutar a mano en MySQL Workbench (no hay runner de migraciones).
-- ============================================================

ALTER TABLE usuarios
    ADD COLUMN token_version INT NOT NULL DEFAULT 0 AFTER ultimo_acceso;
