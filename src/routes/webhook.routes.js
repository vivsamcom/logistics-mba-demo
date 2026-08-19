const express = require('express');
const webhookController = require('../controllers/webhook.controller');
const validateMetaSignature = require('../middleware/meta-signature');

const router = express.Router();

// Meta's GET verification uses a verify token, not the POST HMAC signature.
router.get('/', webhookController.verifyWebhook);
router.post('/', validateMetaSignature, webhookController.receiveWebhook);

module.exports = router;
