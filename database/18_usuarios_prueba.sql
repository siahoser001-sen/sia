-- ============================================================
--  18_usuarios_prueba.sql
--  Cuentas de prueba FIJAS (una por rol) para no tener que crear
--  roles sueltos cada vez que se quiere probar el sistema.
--
--  Con estas cuentas se cubren TODOS los roles del sistema:
--    superadmin · admin · docente (x2) · estudiante (x2) · acudiente (x2)
--
--  Cómo ejecutarlo (igual que los otros archivos de /database):
--  MySQL Workbench → File → Open SQL Script → este archivo
--  → Ctrl+Shift+Enter. Debe correrse DESPUÉS de las migraciones
--  01 a 17 (depende de las tablas que esas crean).
--
--  Idempotente: usa INSERT IGNORE, así que se puede repetir sin
--  duplicar. Si un correo/documento ya existía (p. ej. un estudiante
--  que se registró antes con ese documento), la cuenta de prueba
--  NO se sobrescribe: se conserva la existente. Revisa el SELECT
--  del final para confirmar que las 8 cuentas quedaron con los
--  emails de prueba.
--
--  Contraseñas (documentadas también en README.md, sección 2.1):
--    Admin2025!      → superadmin   (ya existe desde la migración 01;
--                      aquí solo se incluye como salvaguarda)
--    Admin2026!      → admin
--    Docente2026!    → 2 docentes
--    Estudiante2026! → 2 estudiantes
--    Acudiente2026!  → 2 acudientes
--  Los hashes de abajo fueron verificados 2026-08-28 con
--  bcrypt.compare(contraseña, hash) => true.
-- ============================================================

USE sia_db;
SET NAMES utf8mb4;

-- ── Institución de prueba ─────────────────────────────────────
INSERT IGNORE INTO instituciones
    (id,                                     nombre,                  nit,        codigo_dane, direccion,          municipio, departamento, telefono,     email_institucional, activa)
VALUES
    ('11111111-1111-4111-8111-111111111101', 'Institución de Prueba SIA', '900000001', '90000000001', 'Calle 1 # 1-1', 'Medellín', 'Antioquia', '3001111111', 'institucion.prueba@sia.edu.co', TRUE);

-- ── Configuración por defecto de esa institución ──────────────
INSERT IGNORE INTO configuracion
    (id,                                     institucion_id,                                  nota_minima, nota_maxima, nota_aprobatoria, num_periodos, tipo_periodo)
VALUES
    ('11111111-1111-4111-8111-111111111102', '11111111-1111-4111-8111-111111111101', 1.0, 5.0, 3.0, 4, 'bimestre');

-- ── Grado y curso donde quedan matriculados los estudiantes ───
INSERT IGNORE INTO grados
    (id,                                     institucion_id,                                  nombre,  nivel,        orden)
VALUES
    ('11111111-1111-4111-8111-111111111103', '11111111-1111-4111-8111-111111111101', 'Décimo', 'Bachillerato', 10);

INSERT IGNORE INTO grupos
    (id,                                     grado_id,                                   nombre, capacidad_max, activo)
VALUES
    ('11111111-1111-4111-8111-111111111104', '11111111-1111-4111-8111-111111111103', '1001', 35, TRUE);

-- ── Usuarios de prueba ────────────────────────────────────────
-- El superadmin es global (institucion_id NULL). Todos los demás
-- pertenecen a la Institución de Prueba SIA.
INSERT IGNORE INTO usuarios
    (id,                                     institucion_id,                                  rol,          nombres,               apellidos,        tipo_documento, numero_documento, email,                  telefono,     password_hash,                                                   activo)
VALUES
    ('11111111-1111-4111-8111-111111111111', NULL,                                          'superadmin', 'Oscar Andrés',        'Navarro Ochoa', 'CC',            '1000000001',      'admin@sia.edu.co',      NULL,          '$2b$10$PJmOVs.qfVp926QlFd0hCekp5otU6qOjX11q1OKYVMNfqK.Z7WniK', TRUE), -- Admin2025!
    ('11111111-1111-4111-8111-111111111201', '11111111-1111-4111-8111-111111111101', 'admin',      'Administrador',       'Sistema',        'CC',            '1000000002',      'administrador@sia.edu.co', '3001111112', '$2b$10$8EHjkUpqe9DiM3P8E68LUOWWbdcvsU4ky.2Xo.LqemkbV3fY8zV0K', TRUE), -- Admin2026!
    ('11111111-1111-4111-8111-111111111202', '11111111-1111-4111-8111-111111111101', 'docente',    'Carlos Andrés',       'Ramírez Díaz',   'CC',            '2000000001',      'docente1@sia.edu.co',      '3001111121', '$2b$10$FVMXzN6AD0pKq9Ri5.Nia.DLUdmRNgfHBOxrslPW9gneWERZKMsqa', TRUE), -- Docente2026!
    ('11111111-1111-4111-8111-111111111203', '11111111-1111-4111-8111-111111111101', 'docente',    'Laura Marcela',       'Gómez Pérez',    'CC',            '2000000002',      'docente2@sia.edu.co',      '3001111122', '$2b$10$FVMXzN6AD0pKq9Ri5.Nia.DLUdmRNgfHBOxrslPW9gneWERZKMsqa', TRUE), -- Docente2026!
    ('11111111-1111-4111-8111-111111111301', '11111111-1111-4111-8111-111111111101', 'estudiante', 'Sebastián',           'Torres Mora',    'CC',            '3000000001',      'estudiante1@sia.edu.co',   '3001111131', '$2b$10$3UDl8b1f/UbQO12BYb1ZLu11OJh/0rCacfbVlIkHYV4E2tAF6N.aq', TRUE), -- Estudiante2026!
    ('11111111-1111-4111-8111-111111111302', '11111111-1111-4111-8111-111111111101', 'estudiante', 'Valentina',           'López Cárdenas', 'CC',            '3000000002',      'estudiante2@sia.edu.co',   '3001111132', '$2b$10$3UDl8b1f/UbQO12BYb1ZLu11OJh/0rCacfbVlIkHYV4E2tAF6N.aq', TRUE), -- Estudiante2026!
    ('11111111-1111-4111-8111-111111111401', '11111111-1111-4111-8111-111111111101', 'acudiente',  'Jorge Iván',          'Torres Arias',   'CC',            '4000000001',      'acudiente1@sia.edu.co',    '3001111141', '$2b$10$UhUtrWDq.7EYqeJxF5Jcs.PqbvqvfFotZ5iKZiaAQ7RNf40Wapida', TRUE), -- Acudiente2026!
    ('11111111-1111-4111-8111-111111111402', '11111111-1111-4111-8111-111111111101', 'acudiente',  'María Fernanda',      'Cárdenas Mora',  'CC',            '4000000002',      'acudiente2@sia.edu.co',    '3001111142', '$2b$10$UhUtrWDq.7EYqeJxF5Jcs.PqbvqvfFotZ5iKZiaAQ7RNf40Wapida', TRUE); -- Acudiente2026!

-- ── Los dos estudiantes quedan con curso activo (1001, 2026) ──
-- codigo_confirmado en NULL: para un registro sembrado a mano no se
-- le pide revalidar código (la lógica solo lo exige cuando el campo
-- tiene un valor distinto al código actual del grupo — ver
-- matriculas.controller.js, obtenerPorEstudiante).
INSERT IGNORE INTO matriculas
    (id,                                     estudiante_id,                                  grupo_id,                                   anio_lectivo, fecha_ingreso, estado)
VALUES
    ('11111111-1111-4111-8111-111111111501', '11111111-1111-4111-8111-111111111301', '11111111-1111-4111-8111-111111111104', 2026, CURDATE(), 'activa'),
    ('11111111-1111-4111-8111-111111111502', '11111111-1111-4111-8111-111111111302', '11111111-1111-4111-8111-111111111104', 2026, CURDATE(), 'activa');

-- ── Vínculo acudiente ↔ estudiante (sin esto no verían a su acudido) ──
INSERT IGNORE INTO acudientes_estudiantes
    (acudiente_id,                                   estudiante_id,                                   parentesco, es_principal)
VALUES
    ('11111111-1111-4111-8111-111111111401', '11111111-1111-4111-8111-111111111301', 'Padre', TRUE),
    ('11111111-1111-4111-8111-111111111402', '11111111-1111-4111-8111-111111111302', 'Madre', TRUE);

-- ── Verificación rápida (seleccionar y ejecutar para revisar) ──
-- SELECT email, rol, institucion_id, activo
-- FROM usuarios
-- WHERE email IN (
--   'admin@sia.edu.co', 'administrador@sia.edu.co',
--   'docente1@sia.edu.co', 'docente2@sia.edu.co',
--   'estudiante1@sia.edu.co', 'estudiante2@sia.edu.co',
--   'acudiente1@sia.edu.co', 'acudiente2@sia.edu.co'
-- )
-- ORDER BY rol;