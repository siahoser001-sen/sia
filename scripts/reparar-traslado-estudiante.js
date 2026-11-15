// Reparación puntual de una matrícula trasladada al grupo equivocado.
// Por defecto solo muestra el SQL; --ejecutar exige confirmación interactiva.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parsearArgs(argv) {
  const args = { ejecutar: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--ejecutar') {
      args.ejecutar = true;
    } else if ([
      '--estudiante', '--matricula-origen', '--matricula-destino',
      '--grupo-origen', '--grupo-destino', '--anio',
    ].includes(arg)) {
      args[arg.slice(2)] = argv[++i];
    } else if (arg === '--ayuda' || arg === '-h') {
      args.ayuda = true;
    } else {
      throw new Error(`Argumento no reconocido: ${arg}`);
    }
  }
  return args;
}

function imprimirUso() {
  console.log(
    'Uso: node scripts/reparar-traslado-estudiante.js ' +
    '--estudiante <UUID> --matricula-origen <UUID> --matricula-destino <UUID> ' +
    '--grupo-origen <UUID> --grupo-destino <UUID> --anio <año> [--ejecutar]'
  );
  console.log('Sin --ejecutar, solo imprime el SQL de reparación.');
}

function crearSql({ estudiante, matriculaOrigen, matriculaDestino, grupoOrigen, grupoDestino, anio }) {
  return [
    `UPDATE matriculas
SET estado = 'trasladada', fecha_retiro = CURRENT_DATE
WHERE estudiante_id = '${estudiante}'
  AND grupo_id = '${grupoOrigen}'
  AND id = '${matriculaOrigen}'
  AND anio_lectivo = ${anio}
  AND estado = 'activa';`,
    `UPDATE matriculas
SET estado = 'activa', fecha_retiro = NULL
WHERE estudiante_id = '${estudiante}'
  AND grupo_id = '${grupoDestino}'
  AND id = '${matriculaDestino}'
  AND anio_lectivo = ${anio}
  AND estado = 'trasladada';`,
  ];
}

function validarIdentificadores(args) {
  const campos = [
    ['estudiante', args.estudiante],
    ['matrícula origen', args['matricula-origen']],
    ['matrícula destino', args['matricula-destino']],
    ['grupo origen', args['grupo-origen']],
    ['grupo destino', args['grupo-destino']],
  ];
  for (const [nombre, valor] of campos) {
    if (!valor || !UUID_RE.test(valor)) {
      throw new Error(`Falta un UUID válido para ${nombre}.`);
    }
  }
  if (args['grupo-origen'] === args['grupo-destino']) {
    throw new Error('El grupo origen y el destino deben ser distintos.');
  }
  if (!/^\d{4}$/.test(args.anio || '')) {
    throw new Error('Indica un año lectivo válido con --anio.');
  }
}

async function pedirConfirmacion() {
  const readline = require('readline');
  const interfaz = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await new Promise(resolve => {
      interfaz.question('Escribe EJECUTAR para aplicar esta reparación: ', resolve);
    });
  } finally {
    interfaz.close();
  }
}

async function ejecutar(args, sql) {
  const respuesta = await pedirConfirmacion();
  if (respuesta !== 'EJECUTAR') {
    console.log('Cancelado; no se modificó la base de datos.');
    return;
  }

  require('dotenv').config();
  const mysql = require('mysql2/promise');
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'sia_db',
    charset: 'utf8mb4',
  });

  try {
    await conn.beginTransaction();

    const [origen] = await conn.query(
      `SELECT mt.id, mt.anio_lectivo
       FROM matriculas mt
       WHERE mt.id = ? AND mt.estudiante_id = ? AND mt.grupo_id = ?
         AND mt.anio_lectivo = ? AND mt.estado = 'activa'
       FOR UPDATE`,
      [args['matricula-origen'], args.estudiante, args['grupo-origen'], args.anio]
    );
    const [destino] = await conn.query(
      `SELECT mt.id, mt.anio_lectivo
       FROM matriculas mt
       WHERE mt.id = ? AND mt.estudiante_id = ? AND mt.grupo_id = ?
         AND mt.anio_lectivo = ? AND mt.estado = 'trasladada'
       FOR UPDATE`,
      [args['matricula-destino'], args.estudiante, args['grupo-destino'], args.anio]
    );
    const [destinoGrupo] = await conn.query(
      `SELECT gd.id, gd.capacidad_max
       FROM grupos go
       JOIN grados gro ON gro.id = go.grado_id
       JOIN grupos gd ON gd.id = ?
       JOIN grados grd ON grd.id = gd.grado_id
       WHERE go.id = ? AND gro.institucion_id = grd.institucion_id
         AND go.activo = TRUE AND gd.activo = TRUE
       FOR UPDATE`,
      [args['grupo-destino'], args['grupo-origen']]
    );
    if (!destinoGrupo.length) {
      throw new Error('Origen/destino inválido, inactivo o de instituciones distintas.');
    }
    if (origen.length !== 1 || destino.length !== 1) {
      throw new Error('No coinciden las matrículas de origen/destino con el estudiante, curso, año y estado esperados.');
    }

    const [activas] = await conn.query(
      `SELECT id, grupo_id
       FROM matriculas
       WHERE estudiante_id = ? AND estado = 'activa'
       FOR UPDATE`,
      [args.estudiante]
    );
    const cantidadEnOrigen = activas.filter(m => m.grupo_id === args['grupo-origen']).length;
    const activaEnOtroGrupo = activas.some(m => m.grupo_id !== args['grupo-origen']);

    if (activaEnOtroGrupo || cantidadEnOrigen !== 1) {
      throw new Error('El estudiante tiene matrículas activas adicionales; se requiere revisión manual.');
    }

    const [[{ ocupados }]] = await conn.query(
      `SELECT COUNT(*) AS ocupados
       FROM matriculas
       WHERE grupo_id = ? AND estado = 'activa'`,
      [args['grupo-destino']]
    );
    if (ocupados >= destinoGrupo[0].capacidad_max) {
      throw new Error('El grupo destino ya alcanzó su capacidad máxima.');
    }

    const [actualizacion] = await conn.query(sql[0]);
    if (actualizacion.affectedRows !== 1) {
      throw new Error('No se actualizó exactamente una matrícula de origen.');
    }
    const [reactivacion] = await conn.query(sql[1]);
    if (reactivacion.affectedRows !== 1) {
      throw new Error('No se reactivó exactamente una matrícula histórica del grupo destino.');
    }
    await conn.commit();
    console.log('Reparación aplicada. Las notas y asistencias históricas no se modificaron.');
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    await conn.end();
  }
}

async function main() {
  const args = parsearArgs(process.argv.slice(2));
  if (args.ayuda) {
    imprimirUso();
    return;
  }
  validarIdentificadores(args);

  const sql = crearSql({
    estudiante: args.estudiante,
    matriculaOrigen: args['matricula-origen'],
    matriculaDestino: args['matricula-destino'],
    grupoOrigen: args['grupo-origen'],
    grupoDestino: args['grupo-destino'],
    anio: args.anio,
  });
  console.log('SQL que se propone aplicar:\n');
  console.log('START TRANSACTION;');
  console.log(sql.join('\n\n'));
  console.log('\nCOMMIT;');

  if (!args.ejecutar) {
    console.log('\nVista previa solamente. Añade --ejecutar tras revisar el SQL para iniciar la confirmación.');
    return;
  }
  await ejecutar(args, sql);
}

main().catch(err => {
  console.error(`Error: ${err.message}`);
  process.exitCode = 1;
});
