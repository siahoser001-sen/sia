-- =====================================================================
-- 14_materias_por_curso.sql
-- Liga `materias` a un grupo (curso) específico en vez de solo al grado.
-- "Matemáticas" en 501 y "Matemáticas" en 502 pasan a ser materias
-- distintas. `grado_id` se conserva intacto (no se toca su FK
-- `materias_ibfk_2`) para no arriesgar nada sobre una restricción ya
-- existente; sigue sirviendo para filtrar/reportar por grado.
-- =====================================================================

START TRANSACTION;

-- 1) Nueva columna, nullable por ahora: hay materias existentes que no
--    se pueden asignar a un grupo sin ambigüedad (ver paso 2), así que
--    no puede ser NOT NULL todavía.
ALTER TABLE `materias`
  ADD COLUMN `grupo_id` char(36) DEFAULT NULL AFTER `grado_id`;

-- 2) Backfill automático SOLO para los casos sin ambigüedad: si el
--    grado de la materia tiene un único grupo, se asigna directo. Si el
--    grado tiene más de un grupo, la materia queda en NULL a propósito
--    (no hay forma de adivinar a cuál de los grupos pertenecía) y hay
--    que asignarla a mano desde la pantalla de Materias.
UPDATE `materias` m
JOIN (
  SELECT `grado_id`, MIN(`id`) AS `unico_grupo_id`
  FROM `grupos`
  GROUP BY `grado_id`
  HAVING COUNT(*) = 1
) g ON g.`grado_id` = m.`grado_id`
SET m.`grupo_id` = g.`unico_grupo_id`
WHERE m.`grupo_id` IS NULL;

-- 3) Cambia la restricción única de (area_id, grado_id, nombre) a
--    (area_id, grupo_id, nombre). OJO CON EL ORDEN: `uq_materia` era el
--    único índice que respaldaba la FK `materias_ibfk_1` (area_id →
--    areas), porque area_id es su primera columna (grado_id sí tenía
--    índice propio aparte, area_id no). Por eso el nuevo índice se crea
--    ANTES de borrar el viejo — si no, MySQL tira el error 1553 porque
--    area_id se queda sin ningún índice que la respalde.
ALTER TABLE `materias`
  ADD UNIQUE KEY `uq_materia_grupo` (`area_id`, `grupo_id`, `nombre`);

ALTER TABLE `materias`
  DROP KEY `uq_materia`;

-- 4) FK explícita hacia grupos, con nombre propio (para no repetir el
--    problema de quedar con un nombre autogenerado desconocido).
ALTER TABLE `materias`
  ADD CONSTRAINT `fk_materias_grupo`
    FOREIGN KEY (`grupo_id`) REFERENCES `grupos` (`id`)
    ON DELETE CASCADE;

COMMIT;

-- =====================================================================
-- Verificación manual después de correr esto: cualquier fila que salga
-- aquí quedó sin grupo asignado (grado con más de un grupo, ambiguo) y
-- hay que arreglarla a mano desde la pantalla de Materias antes de que
-- el backend de la sección 2 la use.
-- =====================================================================
SELECT id, area_id, grado_id, nombre
FROM materias
WHERE grupo_id IS NULL;
