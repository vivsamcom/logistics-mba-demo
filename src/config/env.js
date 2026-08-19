const dotenv = require('dotenv');

dotenv.config();

function isMetaSignatureValidationEnabled() {
  return String(process.env.META_SIGNATURE_VALIDATION_ENABLED)
    .trim()
    .toLowerCase() === 'true';
}

module.exports = {
  isMetaSignatureValidationEnabled
};
