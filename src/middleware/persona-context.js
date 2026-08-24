const personaService = require('../services/persona.service');
const AppError = require('../utils/app-error');
const { normalizePhone } = require('../utils/phone');

function personaContext(req, res, next) {
  try {
    const phone = req.get('X-WhatsApp-Phone');

    if (!phone || !normalizePhone(phone)) {
      throw new AppError(
        400,
        'WHATSAPP_PHONE_REQUIRED',
        'X-WhatsApp-Phone is required.'
      );
    }

    req.persona = personaService.resolveByWhatsAppPhone(phone);
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = personaContext;
