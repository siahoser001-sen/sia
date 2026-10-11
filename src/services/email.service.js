const nodemailer = require('nodemailer');
require('dotenv').config();

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});

const correoNuevaSolicitudInstitucion = ({ nombre, codigo_dane, admin_nombre, admin_email }) => ({
  to: process.env.SUPERADMIN_EMAIL,
  subject: `[SIA] Nueva institución pendiente`,
  html: `<h2>Nueva solicitud</h2><p><b>Institución:</b> ${nombre}</p><p><b>DANE:</b> ${codigo_dane}</p><p><b>Admin:</b> ${admin_nombre} (${admin_email})</p>`,
});

// Confirmación para quien llena el formulario de registro-institucion.html
// (distinta del correo anterior, que le avisa al superadmin).
const correoSolicitudRecibida = ({ admin_email, admin_nombre, nombre_institucion, codigo_dane }) => ({
  to: admin_email,
  subject: `[SIA] Recibimos tu solicitud — ${nombre_institucion}`,
  html: `<h2>Hola, ${admin_nombre}</h2>
    <p>Recibimos la solicitud de registro de <b>${nombre_institucion}</b> (DANE: ${codigo_dane}) en el SIA.</p>
    <p>El equipo la va a revisar y te vamos a escribir a este mismo correo con la respuesta (aprobación o rechazo).</p>
    <p>Si no reconoces esta solicitud, puedes ignorar este correo.</p>`,
});

const correoInstitucionAprobada = ({ admin_email, admin_nombre, nombre_institucion }) => ({
  to: admin_email,
  subject: `[SIA] Tu institución fue aprobada`,
  html: `<h2>¡Bienvenido, ${admin_nombre}!</h2><p><b>${nombre_institucion}</b> fue aprobada. Ya puedes iniciar sesión.</p>`,
});

const correoInstitucionRechazada = ({ admin_email, admin_nombre, nombre_institucion, motivo }) => ({
  to: admin_email,
  subject: `[SIA] Solicitud de institución rechazada`,
  html: `<h2>Hola, ${admin_nombre}</h2><p>Tu solicitud para registrar <b>${nombre_institucion}</b> en el SIA fue rechazada.</p>${motivo ? `<p><b>Motivo:</b> ${motivo}</p>` : '<p>No se indicó un motivo específico.</p>'}<p>Si crees que esto es un error, puedes contactar al equipo SIA o enviar una nueva solicitud corrigiendo la información.</p>`,
});

const correoNuevaSolicitudDocente = ({ admin_email, docente_nombre, docente_email }) => ({
  to: admin_email,
  subject: `[SIA] Nuevo docente solicita ingresar`,
  html: `<h2>Solicitud de docente</h2><p><b>Nombre:</b> ${docente_nombre}</p><p><b>Correo:</b> ${docente_email}</p>`,
});

const correoDocenteAprobado = ({ docente_email, docente_nombre, nombre_institucion }) => ({
  to: docente_email,
  subject: `[SIA] Tu registro fue aprobado`,
  html: `<h2>¡Bienvenido, ${docente_nombre}!</h2><p>Tu registro en <b>${nombre_institucion}</b> fue aprobado.</p>`,
});

const correoDocenteRechazado = ({ docente_email, docente_nombre, motivo }) => ({
  to: docente_email,
  subject: `[SIA] Tu solicitud fue rechazada`,
  html: `<h2>Hola, ${docente_nombre}</h2><p>Tu solicitud fue rechazada.</p>${motivo ? `<p><b>Motivo:</b> ${motivo}</p>` : ''}`,
});

const correoCredencialesDocente = ({ email, password, nombre_institucion }) => ({
  to: email,
  subject: `[SIA] Tu cuenta de docente en ${nombre_institucion}`,
  html: `<h2>Te agregaron a ${nombre_institucion}</h2>
    <p>El administrador de <b>${nombre_institucion}</b> creó tu cuenta de docente en el Sistema de Información Académica.</p>
    <p>Ya puedes iniciar sesión con estos datos:</p>
    <p><b>Correo:</b> ${email}<br/><b>Contraseña:</b> ${password}</p>
    <p>Por seguridad, te recomendamos cambiar esta contraseña una vez inicies sesión (Configuración → Cuenta).</p>
    <p>Si no esperabas este correo, contacta al administrador de tu institución.</p>`,
});

const correoInvitacionDocente = ({ email, link, nombre_institucion }) => ({
  to: email,
  subject: `[SIA] Te invitaron a unirte a ${nombre_institucion}`,
  html: `<h2>Te invitaron a ${nombre_institucion}</h2>
    <p>El administrador de <b>${nombre_institucion}</b> te agregó como docente en el Sistema de Información Académica.</p>
    <p>Para activar tu cuenta y definir tu contraseña, entra a este link (válido por 48 horas):</p>
    <p><a href="${link}">${link}</a></p>
    <p>Si no esperabas esta invitación, puedes ignorar este correo.</p>`,
});

const correoInvitacionEstudiante = ({ email, link, nombre_institucion }) => ({
  to: email,
  subject: `[SIA] Te invitaron a unirte a ${nombre_institucion}`,
  html: `<h2>Te invitaron a ${nombre_institucion}</h2>
    <p>El administrador de <b>${nombre_institucion}</b> te agregó como estudiante en el Sistema de Información Académico.</p>
    <p>Para activar tu cuenta y definir tu contraseña, entra a este link (válido por 48 horas):</p>
    <p><a href="${link}">${link}</a></p>
    <p>Después de activar tu cuenta, pídele a tu director de curso el código de tu grupo para matricularte.</p>
    <p>Si no esperabas esta invitación, puedes ignorar este correo.</p>`,
});

const correoCredencialesAcudiente = ({ email, password, nombre_institucion }) => ({
  to: email,
  subject: `[SIA] Tu cuenta de acudiente en ${nombre_institucion}`,
  html: `<h2>Te vincularon como acudiente en ${nombre_institucion}</h2>
    <p>El administrador de <b>${nombre_institucion}</b> creó tu cuenta en el Sistema de Información Académica.</p>
    <p>Ya puedes iniciar sesión con estos datos:</p>
    <p><b>Correo:</b> ${email}<br/><b>Contraseña:</b> ${password}</p>
    <p>Por seguridad, te recomendamos cambiar esta contraseña una vez inicies sesión (Configuración → Cuenta).</p>
    <p>Si no esperabas este correo, contacta al administrador de tu institución.</p>`,
});

const correoRecuperacionContrasena = ({ email, link, nombre }) => ({
  to: email,
  subject: `[SIA] Restablece tu contraseña`,
  html: `<h2>Hola, ${nombre}</h2>
    <p>Recibimos una solicitud para restablecer tu contraseña en el Sistema de Información Académica.</p>
    <p>Si fuiste tú, entra a este enlace (válido por 30 minutos):</p>
    <p><a href="${link}">${link}</a></p>
    <p>Si no solicitaste esto, puedes ignorar este correo.</p>`,
});

const correoCredencialesGenerico = ({ email, password, rol, nombre_institucion }) => ({
  to: email,
  subject: `[SIA] Nueva contraseña para tu cuenta (${rol})`,
  html: `<h2>Tu contraseña fue restablecida</h2>
    <p>El administrador de <b>${nombre_institucion}</b> restableció la contraseña de tu cuenta de <b>${rol}</b>.</p>
    <p>Ya puedes iniciar sesión con estos datos:</p>
    <p><b>Correo:</b> ${email}<br/><b>Contraseña:</b> ${password}</p>
    <p>Por seguridad, te recomendamos cambiar esta contraseña una vez inicies sesión (Configuración → Cuenta).</p>
    <p>Si no esperabas este correo, contacta al administrador de tu institución.</p>`,
});

// Verifica la conexión/credenciales SMTP al arrancar el servidor,
// para detectar problemas de configuración de una vez (en vez de
// descubrirlo silenciosamente cuando alguien se registra).
transporter.verify()
  .then(() => console.log('📧 Servicio de correo listo (credenciales verificadas).'))
  .catch(err => {
    console.error('⚠️ El servicio de correo NO pudo autenticarse con Gmail.');
    console.error(`   Código: ${err.code || 'desconocido'} — ${err.message}`);
    if (err.responseCode === 534 || /application-specific password/i.test(err.message || '')) {
      console.error('   → Gmail exige una "contraseña de aplicación" (16 caracteres, sin espacios),');
      console.error('     no la contraseña normal de la cuenta. Requiere verificación en 2 pasos activada:');
      console.error('     https://myaccount.google.com/apppasswords');
    }
  });

async function enviarCorreo({ to, subject, html }) {
  try {
    await transporter.sendMail({ from: `"SIA Sistema Académico" <${process.env.EMAIL_USER}>`, to, subject, html });
    console.log(`📧 Correo enviado a ${to}`);
  } catch (err) {
    console.error(`⚠️ Error enviando correo a ${to}:`);
    console.error(`   Código: ${err.code || 'desconocido'} (${err.responseCode || '?'}) — ${err.message}`);
    if (err.response) console.error(`   Respuesta del servidor: ${err.response}`);
  }
}

module.exports = { enviarCorreo, correoNuevaSolicitudInstitucion, correoSolicitudRecibida, correoInstitucionAprobada, correoInstitucionRechazada, correoNuevaSolicitudDocente, correoDocenteAprobado, correoDocenteRechazado, correoInvitacionDocente, correoInvitacionEstudiante, correoCredencialesDocente, correoCredencialesAcudiente, correoRecuperacionContrasena, correoCredencialesGenerico };
