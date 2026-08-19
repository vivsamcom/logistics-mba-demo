const {
  extractWhatsAppEvents,
  processWhatsAppEvents
} = require('../services/webhook.service');

function verifyWebhook(req, res) {
  const mode = req.query['hub.mode'];
  const verifyToken = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const configuredToken = process.env.WEBHOOK_VERIFY_TOKEN;

  if (
    mode === 'subscribe' &&
    configuredToken &&
    verifyToken === configuredToken
  ) {
    console.log('Webhook verification successful');
    return res.status(200).send(challenge);
  }

  console.warn('Webhook verification rejected');
  return res.sendStatus(403);
}

function receiveWebhook(req, res, next) {
  let events;

  try {
    events = extractWhatsAppEvents(req.body);
  } catch (error) {
    return next(error);
  }

  // Acknowledge Meta before doing any event processing.
  res.sendStatus(200);

  setImmediate(() => {
    try {
      processWhatsAppEvents(events);
    } catch (error) {
      console.error('Unexpected webhook event processing error', error);
    }
  });
}

module.exports = {
  verifyWebhook,
  receiveWebhook
};
