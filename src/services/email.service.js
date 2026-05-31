// ============================================================
//  email.service.js — Servicio centralizado de correos
//  Usa Nodemailer + Gmail con contraseña de aplicación.
//  NUNCA uses tu contraseña normal de Gmail.
//  Genera una en: Google → Seguridad → Contraseñas de aplicación
// ============================================================

const nodemailer = require('nodemailer');
require('dotenv').config();

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,   // Contraseña de aplicación, no la normal
  },
});

// ── Plantillas de correo ─────────────────────────────────────

// Al superadmin: nueva institución pendiente
const correoNuevaSolicitudInstitucion = ({ nombre, codigo_dane, admin_nombre, admin_email }) => ({
  to:      process.env.SUPERADMIN_EMAIL,
  subject: `[SIA] Nueva institución pendiente de revisión`,
  html: `
    <h2>Nueva solicitud institucional</h2>
    <p><b>Institución:</b> ${nombre}</p>
    <p><b>Código DANE:</b> ${codigo_dane}</p>
    <p><b>Rector/Admin:</b> ${admin_nombre} (${admin_email})</p>
    <br>
    <p>Ingresa al panel de superadmin para aprobar o rechazar.</p>
  `,
});

// Al admin institucional: aprobación de su institución
const correoInstitucionAprobada = ({ admin_email, admin_nombre, nombre_institucion }) => ({
  to:      admin_email,
  subject: `[SIA] Tu institución fue aprobada`,
  html: `
    <h2>¡Bienvenido al SIA, ${admin_nombre}!</h2>
    <p>La institución <b>${nombre_institucion}</b> fue aprobada.</p>
    <p>Ya puedes iniciar sesión con tu correo registrado.</p>
  `,
});

// Al admin institucional: nueva solicitud de docente
const correoNuevaSolicitudDocente = ({ admin_email, docente_nombre, docente_email }) => ({
  to:      admin_email,
  subject: `[SIA] Nuevo docente solicita ingresar a tu institución`,
  html: `
    <h2>Solicitud de docente pendiente</h2>
    <p><b>Nombre:</b> ${docente_nombre}</p>
    <p><b>Correo:</b> ${docente_email}</p>
    <br>
    <p>Ingresa al panel de tu institución para aprobar o rechazar al docente.</p>
  `,
});

// Al docente: aprobación de su solicitud
const correoDocenteAprobado = ({ docente_email, docente_nombre, nombre_institucion }) => ({
  to:      docente_email,
  subject: `[SIA] Tu registro como docente fue aprobado`,
  html: `
    <h2>¡Bienvenido, ${docente_nombre}!</h2>
    <p>Tu registro en <b>${nombre_institucion}</b> fue aprobado.</p>
    <p>Ya puedes iniciar sesión con tu correo y contraseña.</p>
  `,
});

// Al docente: rechazo de su solicitud
const correoDocenteRechazado = ({ docente_email, docente_nombre, motivo }) => ({
  to:      docente_email,
  subject: `[SIA] Tu solicitud como docente fue rechazada`,
  html: `
    <h2>Hola, ${docente_nombre}</h2>
    <p>Lamentablemente tu solicitud fue rechazada.</p>
    ${motivo ? `<p><b>Motivo:</b> ${motivo}</p>` : ''}
    <p>Contacta directamente a la institución si crees que es un error.</p>
  `,
});

// ── Función enviadora ────────────────────────────────────────
async function enviarCorreo({ to, subject, html }) {
  try {
    await transporter.sendMail({
      from: `"SIA Sistema Académico" <${process.env.EMAIL_USER}>`,
      to,
      subject,
      html,
    });
    console.log(`📧 Correo enviado a ${to}`);
  } catch (err) {
    // No falla el flujo principal si el correo falla
    console.error(`⚠️  Error enviando correo a ${to}:`, err.message);
  }
}

module.exports = {
  enviarCorreo,
  correoNuevaSolicitudInstitucion,
  correoInstitucionAprobada,
  correoNuevaSolicitudDocente,
  correoDocenteAprobado,
  correoDocenteRechazado,
};
