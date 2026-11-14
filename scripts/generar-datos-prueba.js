// ============================================================
//  scripts/generar-datos-prueba.js
//  Generador de datos de prueba del SIA (ROADMAP Ronda E3).
//
//  Crea (o completa) una institución de prueba COMPLETA y coherente:
//    • 2 grados (6°, 7°) y 3 cursos (601, 602, 701)
//    • 4 periodos académicos del año en curso
//    • 8 materias generales (asignadas a los 3 cursos)
//    - Docentes: 8 por curso (co-docencia: 2 docentes por materia),
//      cada docente dicta en UN solo curso.
//    • ~81 estudiantes (27 por curso) con matrícula activa.
//    • 1 acudiente principal por estudiante.
//
//  Es IDEMPOTENTE: usa IDs deterministas + INSERT IGNORE, así que
//  puedes volver a ejecutarlo sin duplicar datos:
//      npm run datos:prueba
//
//  Credenciales que genera:
//      Admin      -> rector@colegio-prueba.sia      / Prueba2026!
//      Docentes   -> docenteN@colegio-prueba.sia     / Prueba2026!
//      Estudiantes-> estudianteN@colegio-prueba.sia  / Prueba2026!
//      Acudientes -> acudienteN@colegio-prueba.sia   / Prueba2026!
// ============================================================

const mysql  = require('mysql2/promise');
const bcrypt = require('bcrypt');
require('dotenv').config();

// ── IDs deterministas (mismo id en cada corrida) ───────────────
let _seq = 0;
function nid() {
  _seq += 1;
  return 'a1c0ffee-0000-4000-8000-' + String(_seq).padStart(12, '0');
}

const ANIO = new Date().getFullYear();
const CLAVE = 'Prueba2026!';
const DOMINIO = 'colegio-prueba.sia';

const NOMBRES = [
  'Sofía', 'Mateo', 'Valentina', 'Santiago', 'Isabella', 'Sebastián', 'Camila', 'Alejandro',
  'Mariana', 'Daniel', 'Gabriela', 'Samuel', 'Luciana', 'Tomás', 'Emilia', 'Joshua',
  'Renata', 'Nicolás', 'Antonella', 'Emilio', 'Lucía', 'Martín', 'Sara', 'Emmanuel',
];
const APELLIDOS = [
  'Gómez', 'Rodríguez', 'Martínez', 'García', 'López', 'Hernández', 'Ramírez', 'Torres',
  'Vargas', 'Castillo', 'Moreno', 'Jiménez', 'Ríos', 'Suárez', 'Ortiz', 'Cárdenas',
  'Peña', 'Salazar', 'Navarro', 'Mendoza', 'Castro', 'Rojas', 'Pineda', 'Quintero',
];

const AREAS = [
  { nombre: 'Matemáticas',             color: '#E74C3C' },
  { nombre: 'Lenguaje y Comunicación', color: '#3498DB' },
  { nombre: 'Ciencias Naturales',      color: '#27AE60' },
  { nombre: 'Ciencias Sociales',       color: '#F39C12' },
  { nombre: 'Educación Artística',     color: '#9B59B6' },
  { nombre: 'Educación Física',        color: '#1ABC9C' },
  { nombre: 'Tecnología e Informática',color: '#2C3E50' },
  { nombre: 'Inglés',                  color: '#E67E22' },
  { nombre: 'Ética y Valores',         color: '#795548' },
  { nombre: 'Religión',                color: '#607D8B' },
];

// Materias generales del colegio (nombre -> área)
const MATERIAS = [
  { nombre: 'Matemáticas',       area: 'Matemáticas' },
  { nombre: 'Español',           area: 'Lenguaje y Comunicación' },
  { nombre: 'Ciencias Naturales',area: 'Ciencias Naturales' },
  { nombre: 'Ciencias Sociales', area: 'Ciencias Sociales' },
  { nombre: 'Inglés',            area: 'Inglés' },
  { nombre: 'Educación Física',  area: 'Educación Física' },
  { nombre: 'Artes',             area: 'Educación Artística' },
  { nombre: 'Tecnología',        area: 'Tecnología e Informática' },
];

const GRADOS = [
  { nombre: '6', nivel: 'Básica Secundaria', orden: 6 },
  { nombre: '7', nivel: 'Básica Secundaria', orden: 7 },
];
const GRUPOS = [
  { grado: '6', nombre: '01' },
  { grado: '6', nombre: '02' },
  { grado: '7', nombre: '01' },
];
const PERIODOS = [
  { n: 1, nombre: 'Bimestre 1', ini: `${ANIO}-02-01`, fin: `${ANIO}-04-10` },
  { n: 2, nombre: 'Bimestre 2', ini: `${ANIO}-04-11`, fin: `${ANIO}-06-25` },
  { n: 3, nombre: 'Bimestre 3', ini: `${ANIO}-07-10`, fin: `${ANIO}-09-20` },
  { n: 4, nombre: 'Bimestre 4', ini: `${ANIO}-09-21`, fin: `${ANIO}-11-30` },
];

const DOCENTES_POR_GRUPO = 8;
const ESTUDIANTES_POR_GRUPO = 27;

function nombrePersona(i) {
  return {
    nombres: NOMBRES[i % NOMBRES.length],
    apellidos: APELLIDOS[(i * 3 + 1) % APELLIDOS.length],
  };
}

async function main() {
  const conn = await mysql.createConnection({
    host:     process.env.DB_HOST || 'localhost',
    port:     Number(process.env.DB_PORT || 3306),
    user:     process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'sia_db',
    charset:  'utf8mb4',
  });

  try {
    // Hash único reutilizado (misma contraseña para todos).
    const hash = await bcrypt.hash(CLAVE, 10);

    // 1) Áreas (globales): se consumen 10 ids siempre para mantener
    //    la secuencia determinista, aunque ya existan.
    const areaId = {};
    for (const a of AREAS) {
      const id = nid();
      const [ex] = await conn.query('SELECT id FROM areas WHERE nombre = ? LIMIT 1', [a.nombre]);
      if (ex.length) {
        areaId[a.nombre] = ex[0].id;
      } else {
        await conn.query('INSERT INTO areas (id, nombre, color_hex) VALUES (?, ?, ?)', [id, a.nombre, a.color]);
        areaId[a.nombre] = id;
      }
    }

    // 2) Institución
    const instId = nid();
    await conn.query(
      `INSERT IGNORE INTO instituciones (id, nombre, nit, codigo_dane, telefono)
       VALUES (?, ?, ?, ?, ?)`,
      [instId, 'Colegio de Prueba SIA', '900-PRUEBA-1', '9999990001', '3001234567']
    );

    // 3) Configuración
    await conn.query(
      `INSERT IGNORE INTO configuracion (id, institucion_id, num_periodos, tipo_periodo)
       VALUES (?, ?, ?, ?)`,
      [nid(), instId, PERIODOS.length, 'bimestre']
    );

    // 4) Grados
    const grados = {};
    let orden = 1;
    for (const g of GRADOS) {
      const id = nid();
      await conn.query(
        `INSERT IGNORE INTO grados (id, institucion_id, nombre, nivel, orden) VALUES (?, ?, ?, ?, ?)`,
        [id, instId, g.nombre, 'Básica Secundaria', orden++]
      );
      grados[g.nombre] = id;
    }

    // 5) Grupos (sin director todavía)
    const grupos = [];
    for (const gr of GRUPOS) {
      const id = nid();
      const codigo = `${gr.grado}${gr.nombre}`;
      await conn.query(
        `INSERT IGNORE INTO grupos (id, grado_id, anio_lectivo, nombre, capacidad_max, codigo_matricula, codigo_activo)
         VALUES (?, ?, ?, ?, ?, ?, TRUE)`,
        [id, grados[gr.grado], ANIO, gr.nombre, ESTUDIANTES_POR_GRUPO + 5, codigo]
      );
      grupos.push({ id, codigo, grado: gr.grado, nombre: gr.nombre });
    }

    // 6) Periodos
    const periodos = [];
    for (const p of PERIODOS) {
      const id = nid();
      await conn.query(
        `INSERT IGNORE INTO periodos_academicos
           (id, institucion_id, nombre, anio_lectivo, numero_periodo, fecha_inicio, fecha_fin, activo)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, instId, p.nombre, ANIO, p.n, p.ini, p.fin, p.n === 1]
      );
      periodos.push(id);
    }

    // 7) Materias generales (sin grado/curso)
    const materias = [];
    for (const m of MATERIAS) {
      const id = nid();
      await conn.query(
        `INSERT IGNORE INTO materias (id, institucion_id, area_id, grado_id, grupo_id, nombre, activa)
         VALUES (?, ?, ?, NULL, NULL, ?, TRUE)`,
        [id, instId, areaId[m.area], m.nombre]
      );
      materias.push({ id, nombre: m.nombre });
    }

    // 8) Docentes: 8 por curso (cada uno en UN solo curso)
    let idxDoc = 0;
    const docentesPorGrupo = {};
    for (const grupo of grupos) {
      docentesPorGrupo[grupo.id] = [];
      for (let k = 0; k < DOCENTES_POR_GRUPO; k++) {
        const id = nid();
        idxDoc += 1;
        const { nombres, apellidos } = nombrePersona(idxDoc * 2);
        await conn.query(
          `INSERT IGNORE INTO usuarios
             (id, institucion_id, rol, nombres, apellidos, tipo_documento, numero_documento, email, password_hash, activo)
           VALUES (?, ?, 'docente', ?, ?, 'CC', ?, ?, ?, TRUE)`,
          [id, instId, nombres, apellidos, '7710' + String(idxDoc).padStart(6, '0'),
           `docente${idxDoc}@${DOMINIO}`, hash]
        );
        docentesPorGrupo[grupo.id].push(id);
      }
      // Director del curso = primer docente
      await conn.query(`UPDATE grupos SET director_id = ? WHERE id = ?`, [docentesPorGrupo[grupo.id][0], grupo.id]);
    }

    // 9) materias_curso: cada curso ofrece todas las materias
    for (const grupo of grupos) {
      for (const m of materias) {
        await conn.query(
          `INSERT IGNORE INTO materias_curso (id, institucion_id, grupo_id, materia_id)
           VALUES (?, ?, ?, ?)`,
          [nid(), instId, grupo.id, m.id]
        );
      }
    }

    // 10) docentes_materias: 2 docentes por materia en cada periodo
    for (const grupo of grupos) {
      const doc = docentesPorGrupo[grupo.id];
      for (let mi = 0; mi < materias.length; mi++) {
        const d1 = doc[(mi * 2) % doc.length];
        const d2 = doc[(mi * 2 + 1) % doc.length];
        for (const periodoId of periodos) {
          for (const docId of [d1, d2]) {
            await conn.query(
              `INSERT IGNORE INTO docentes_materias
                 (id, docente_id, materia_id, institucion_id, grupo_id, periodo_id)
               VALUES (?, ?, ?, ?, ?, ?)`,
              [nid(), docId, materias[mi].id, instId, grupo.id, periodoId]
            );
          }
        }
      }
    }

    // 11) Estudiantes + matrícula + acudiente principal
    let idxEst = 0;
    let idxAcu = 0;
    for (const grupo of grupos) {
      for (let s = 0; s < ESTUDIANTES_POR_GRUPO; s++) {
        idxEst += 1;
        const estId = nid();
        const { nombres, apellidos } = nombrePersona(idxEst * 5);
        const anioNac = 2012 + (idxEst % 4);
        const mesNac  = String((idxEst % 12) + 1).padStart(2, '0');
        const diaNac  = String((idxEst % 27) + 1).padStart(2, '0');
        await conn.query(
          `INSERT IGNORE INTO usuarios
             (id, institucion_id, rol, nombres, apellidos, tipo_documento, numero_documento,
              email, fecha_nacimiento, genero, password_hash, activo)
           VALUES (?, ?, 'estudiante', ?, ?, 'TI', ?, ?, ?, ?, ?, TRUE)`,
          [estId, instId, nombres, apellidos, '7720' + String(idxEst).padStart(6, '0'),
           `estudiante${idxEst}@${DOMINIO}`, `${anioNac}-${mesNac}-${diaNac}`,
           idxEst % 2 === 0 ? 'F' : 'M', hash]
        );

        // Matrícula activa
        await conn.query(
          `INSERT IGNORE INTO matriculas (id, estudiante_id, grupo_id, anio_lectivo, codigo_confirmado, estado)
           VALUES (?, ?, ?, ?, ?, 'activa')`,
          [nid(), estId, grupo.id, ANIO, grupo.codigo]
        );

        // Acudiente principal
        idxAcu += 1;
        const acuId = nid();
        const acu = nombrePersona(idxAcu * 7 + 3);
        await conn.query(
          `INSERT IGNORE INTO usuarios
             (id, institucion_id, rol, nombres, apellidos, tipo_documento, numero_documento, email, telefono, password_hash, activo)
           VALUES (?, ?, 'acudiente', ?, ?, 'CC', ?, ?, ?, ?, TRUE)`,
          [acuId, instId, acu.nombres, apellidos, '7730' + String(idxAcu).padStart(6, '0'),
           `acudiente${idxAcu}@${DOMINIO}`, `3${String(100000000 + idxAcu).slice(-9)}`, hash]
        );
        await conn.query(
          `INSERT IGNORE INTO acudientes_estudiantes (acudiente_id, estudiante_id, parentesco, es_principal)
           VALUES (?, ?, ?, TRUE)`,
          [acuId, estId, idxAcu % 2 === 0 ? 'Madre' : 'Padre']
        );
      }
    }

    // 12) Usuario administrador del colegio de prueba
    await conn.query(
      `INSERT IGNORE INTO usuarios
         (id, institucion_id, rol, nombres, apellidos, tipo_documento, numero_documento, email, password_hash, activo)
       VALUES (?, ?, 'admin', ?, ?, 'CC', ?, ?, ?, TRUE)`,
      [nid(), instId, 'Rector', 'Colegio de Prueba', '7700' + '000001',
       `rector@${DOMINIO}`, hash]
    );

    console.log('Datos de prueba generados/actualizados correctamente.\n');
    console.log(`  Institución:  Colegio de Prueba SIA  (id ${instId})`);
    console.log(`  Cursos:       ${grupos.map(g => g.codigo).join(', ')}`);
    console.log(`  Docentes:     ${grupos.length * DOCENTES_POR_GRUPO}`);
    console.log(`  Estudiantes:  ${grupos.length * ESTUDIANTES_POR_GRUPO}`);
    console.log('  Contraseña para TODAS las cuentas:  ' + CLAVE);
    console.log(`\n  Admin -> rector@${DOMINIO}`);
    console.log(`  Ejemplos -> docente1@${DOMINIO}  |  estudiante1@${DOMINIO}  |  acudiente1@${DOMINIO}`);
  } finally {
    await conn.end();
  }
}

main().catch(err => {
  console.error('Error generando datos de prueba:', err.message);
  process.exit(1);
});
