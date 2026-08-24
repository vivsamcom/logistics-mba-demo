const repository = require('../repositories/mock-logistics.repository');
const AppError = require('../utils/app-error');
const { normalizePhone } = require('../utils/phone');

function resolveByWhatsAppPhone(phone) {
  const normalizedPhone = normalizePhone(phone);
  const persona = repository.getUserByWhatsAppPhone(normalizedPhone);

  if (!persona) {
    throw new AppError(
      404,
      'PERSONA_NOT_FOUND',
      'No Fleet Management persona is configured for this WhatsApp user.'
    );
  }

  return {
    ...persona,
    whatsappPhone: normalizedPhone
  };
}

function resolveRoleByWhatsAppPhone(phone, role) {
  const persona = resolveByWhatsAppPhone(phone);

  if (persona.role !== role) {
    throw new AppError(
      403,
      'ROLE_NOT_ALLOWED',
      'This operation is not available for the current Fleet Management persona.'
    );
  }

  return persona;
}

function resolveDriverByWhatsAppPhone(phone) {
  return resolveRoleByWhatsAppPhone(phone, 'DRIVER');
}

function resolveDispatcherByWhatsAppPhone(phone) {
  return resolveRoleByWhatsAppPhone(phone, 'DISPATCHER');
}

module.exports = {
  resolveByWhatsAppPhone,
  resolveDriverByWhatsAppPhone,
  resolveDispatcherByWhatsAppPhone
};
