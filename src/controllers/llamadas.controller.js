const { randomBytes } = require('crypto');

// ── POST /api/llamadas/sala-rapida (docente) ───────────────────
// Crea una sala de videollamada efímera, sin asociarla a una
// materia/docente_materia_id ni persistirla en BD (no requiere
// registro de estado "activa"/"finalizada" como sí ocurre con
// las llamadas de clase en clases.controller.js). Pensada para
// reuniones puntuales (ej. hablar con un acudiente, coordinación
// rápida entre docentes, etc.).
exports.salaRapida = async (req, res) => {
  try {
    const titulo = (req.body?.titulo || '').trim() || 'Sala rápida';

    const sala = `SIA-rapida-${randomBytes(4).toString('hex')}`
      .replace(/[^a-zA-Z0-9-]/g, '-');

    return res.status(201).json({
      ok: true,
      sala,
      titulo,
      url: `https://meet.jit.si/${sala}`,
    });
  } catch (err) {
    console.error('salaRapida error:', err.message);
    return res.status(500).json({ ok: false, mensaje: 'Error interno.' });
  }
};
