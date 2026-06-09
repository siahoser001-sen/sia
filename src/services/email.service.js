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

const correoInstitucionAprobada = ({ admin_email, admin_nombre, nombre_institucion }) => ({
  to: admin_email,
  subject: `[SIA] Tu institución fue aprobada`,
  html: `<h2>¡Bienvenido, ${admin_nombre}!</h2><p><b>${nombre_institucion}</b> fue aprobada. Ya puedes iniciar sesión.</p>`,
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

async function enviarCorreo({ to, subject, html }) {
  try {
    await transporter.sendMail({ from: `"SIA Sistema Académico" <${process.env.EMAIL_USER}>`, to, subject, html });
    console.log(`📧 Correo enviado a ${to}`);
  } catch (err) {
    console.error(`⚠️ Error enviando correo:`, err.message);
  }
}

module.exports = { enviarCorreo, correoNuevaSolicitudInstitucion, correoInstitucionAprobada, correoNuevaSolicitudDocente, correoDocenteAprobado, correoDocenteRechazado };
