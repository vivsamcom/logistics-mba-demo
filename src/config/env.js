const dotenv = require('dotenv');

dotenv.config();

const DEFAULT_WHATSAPP_ASSIGNMENT_HEADER_IMAGE_URL =
  'https://logistics-mba-demo.onrender.com/images/load-assignment-header.png';

function isMetaSignatureValidationEnabled() {
  return String(process.env.META_SIGNATURE_VALIDATION_ENABLED)
    .trim()
    .toLowerCase() === 'true';
}

function isWhatsAppNotificationsEnabled() {
  return String(process.env.WHATSAPP_NOTIFICATIONS_ENABLED)
    .trim()
    .toLowerCase() === 'true';
}

function getWhatsAppAssignmentHeaderImageUrl() {
  const configuredUrl = String(
    process.env.WHATSAPP_ASSIGNMENT_HEADER_IMAGE_URL || ''
  ).trim();

  return configuredUrl || DEFAULT_WHATSAPP_ASSIGNMENT_HEADER_IMAGE_URL;
}

module.exports = {
  getWhatsAppAssignmentHeaderImageUrl,
  isMetaSignatureValidationEnabled,
  isWhatsAppNotificationsEnabled
};
