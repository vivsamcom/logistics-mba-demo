const crypto = require('node:crypto');
const {
  isMetaSignatureValidationEnabled
} = require('../config/env');

function rejectSignature(res, reason) {
  console.warn(`Meta signature validation failed: ${reason}`);
  return res.sendStatus(401);
}

function validateMetaSignature(req, res, next) {
  if (!isMetaSignatureValidationEnabled()) {
    console.log('Meta signature validation disabled');
    return next();
  }

  const appSecret = process.env.META_APP_SECRET;
  const receivedSignature = req.get('x-hub-signature-256');

  if (!appSecret) {
    return rejectSignature(res, 'META_APP_SECRET is not configured');
  }

  if (
    typeof receivedSignature !== 'string' ||
    !receivedSignature.startsWith('sha256=')
  ) {
    return rejectSignature(res, 'signature header is missing or malformed');
  }

  if (!Buffer.isBuffer(req.rawBody)) {
    return rejectSignature(res, 'raw request body is unavailable');
  }

  // Do not replace req.rawBody with JSON.stringify(req.body). Parsing and
  // serializing JSON can change whitespace or key formatting and invalidate a
  // legitimate signature. Meta's HMAC covers the exact HTTP body bytes.
  const calculatedHash = crypto
    .createHmac('sha256', appSecret)
    .update(req.rawBody)
    .digest('hex');
  const expectedSignature = `sha256=${calculatedHash}`;
  const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
  const receivedBuffer = Buffer.from(receivedSignature, 'utf8');

  if (
    expectedBuffer.length !== receivedBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, receivedBuffer)
  ) {
    return rejectSignature(res, 'signature does not match');
  }

  console.log('Meta signature validated successfully');
  return next();
}

module.exports = validateMetaSignature;
