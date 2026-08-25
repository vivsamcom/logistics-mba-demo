const { isWhatsAppNotificationsEnabled } = require('../config/env');

function requireEnvironmentValue(name) {
  const value = process.env[name];

  if (typeof value !== 'string' || !value.trim()) {
    const error = new Error(`${name} is not configured`);
    error.code = 'WHATSAPP_CONFIGURATION_ERROR';
    throw error;
  }

  return value.trim();
}

function normalizeGraphApiVersion(value) {
  const version = value.startsWith('v') ? value : `v${value}`;

  if (!/^v\d+\.\d+$/.test(version)) {
    const error = new Error(
      'WHATSAPP_GRAPH_API_VERSION must look like vXX.X'
    );
    error.code = 'WHATSAPP_CONFIGURATION_ERROR';
    throw error;
  }

  return version;
}

function normalizeRecipientPhone(value) {
  const phone = String(value || '').replace(/\D/g, '');

  if (!/^\d{7,15}$/.test(phone)) {
    const error = new Error(
      'WhatsApp recipient phone must include a valid country code'
    );
    error.code = 'WHATSAPP_RECIPIENT_INVALID';
    throw error;
  }

  return phone;
}

function maskRecipientPhone(value) {
  const phone = String(value || '').replace(/\D/g, '');

  if (!phone) {
    return null;
  }

  return `${'*'.repeat(Math.max(phone.length - 4, 0))}${phone.slice(-4)}`;
}

function buildLogContext(notification, context) {
  const recipient = notification && notification.recipient;
  const template = notification && notification.template;

  return {
    requestId: (context && context.requestId) || null,
    eventId: (context && context.eventId) || null,
    shipmentId: (context && context.shipmentId) || null,
    driverId:
      (context && context.driverId) || (recipient && recipient.driverId) || null,
    recipient: maskRecipientPhone(recipient && recipient.phone),
    templateName: (template && template.name) || null,
    templateLanguage: (template && template.language) || null
  };
}

function writeLog(level, event, details) {
  const output = JSON.stringify({
    level,
    event,
    timestamp: new Date().toISOString(),
    ...details
  });

  if (level === 'error') {
    console.error(output);
    return;
  }

  console.log(output);
}

function buildImageHeaderComponent(template) {
  const header = template && template.header;
  const imageLink = header && header.image && header.image.link;

  if (
    !header ||
    String(header.format || '').toUpperCase() !== 'IMAGE' ||
    typeof imageLink !== 'string' ||
    !imageLink.trim()
  ) {
    const error = new Error(
      'WhatsApp template IMAGE header with an image link is required'
    );
    error.code = 'WHATSAPP_TEMPLATE_INVALID';
    throw error;
  }

  let imageUrl;

  try {
    imageUrl = new URL(imageLink.trim());
  } catch (cause) {
    const error = new Error(
      'WhatsApp template header image link must be a valid HTTPS URL'
    );
    error.code = 'WHATSAPP_TEMPLATE_INVALID';
    throw error;
  }

  if (imageUrl.protocol !== 'https:') {
    const error = new Error(
      'WhatsApp template header image link must be a valid HTTPS URL'
    );
    error.code = 'WHATSAPP_TEMPLATE_INVALID';
    throw error;
  }

  return {
    type: 'header',
    parameters: [
      {
        type: 'image',
        image: {
          link: imageUrl.href
        }
      }
    ]
  };
}

function buildTemplateMessage(notification) {
  const template = notification && notification.template;
  const recipient = notification && notification.recipient;

  if (!template || !template.name || !template.language) {
    const error = new Error('WhatsApp template name and language are required');
    error.code = 'WHATSAPP_TEMPLATE_INVALID';
    throw error;
  }

  if (!Array.isArray(template.bodyParameters)) {
    const error = new Error('WhatsApp template body parameters are required');
    error.code = 'WHATSAPP_TEMPLATE_INVALID';
    throw error;
  }

  const bodyParameters = [...template.bodyParameters]
    .sort((left, right) => left.position - right.position)
    .map((parameter) => ({
      type: 'text',
      text: String(parameter.value)
    }));

  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: normalizeRecipientPhone(recipient && recipient.phone),
    type: 'template',
    template: {
      name: template.name,
      language: {
        code: template.language
      },
      components: [
        buildImageHeaderComponent(template),
        {
          type: 'body',
          parameters: bodyParameters
        }
      ]
    }
  };
}

async function readResponseBody(response) {
  try {
    return await response.json();
  } catch (error) {
    return null;
  }
}

function getResponseHeader(response, name) {
  if (!response.headers || typeof response.headers.get !== 'function') {
    return null;
  }

  return response.headers.get(name);
}

async function sendTemplateMessage(notification, fetchImplementation) {
  const accessToken = requireEnvironmentValue('WHATSAPP_ACCESS_TOKEN');
  const phoneNumberId = requireEnvironmentValue('WHATSAPP_PHONE_NUMBER_ID');
  const graphApiVersion = normalizeGraphApiVersion(
    requireEnvironmentValue('WHATSAPP_GRAPH_API_VERSION')
  );
  const fetchRequest = fetchImplementation || globalThis.fetch;

  if (typeof fetchRequest !== 'function') {
    const error = new Error('This Node.js runtime does not provide fetch');
    error.code = 'WHATSAPP_RUNTIME_ERROR';
    throw error;
  }

  const response = await fetchRequest(
    `https://graph.facebook.com/${graphApiVersion}/${phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(buildTemplateMessage(notification))
    }
  );
  const body = await readResponseBody(response);

  if (!response.ok) {
    const graphError = body && body.error;
    const error = new Error(
      (graphError && graphError.message) ||
        `Meta WhatsApp API returned HTTP ${response.status}`
    );
    error.code =
      (graphError && String(graphError.code)) || 'WHATSAPP_API_ERROR';
    error.httpStatus = response.status;
    error.meta = {
      type: (graphError && graphError.type) || null,
      subcode:
        (graphError && graphError.error_subcode) === undefined
          ? null
          : String(graphError.error_subcode),
      details:
        (graphError &&
          graphError.error_data &&
          graphError.error_data.details) ||
        null,
      traceId:
        (graphError && graphError.fbtrace_id) ||
        getResponseHeader(response, 'x-fb-trace-id'),
      requestId: getResponseHeader(response, 'x-fb-request-id')
    };
    throw error;
  }

  return body || {};
}

async function sendAssignmentNotification(notification, context = {}) {
  const logContext = buildLogContext(notification, context);

  if (!isWhatsAppNotificationsEnabled()) {
    return {
      status: 'SKIPPED',
      reason: 'WHATSAPP_NOTIFICATIONS_DISABLED'
    };
  }

  const attemptedAt = new Date().toISOString();

  try {
    const response = await sendTemplateMessage(notification);
    const firstMessage = Array.isArray(response.messages)
      ? response.messages[0]
      : null;
    const messageId = (firstMessage && firstMessage.id) || null;

    writeLog('info', 'whatsapp.assignment.accepted', {
      ...logContext,
      messageId
    });

    return {
      status: 'ACCEPTED_BY_META',
      attemptedAt,
      messageId
    };
  } catch (error) {
    writeLog('error', 'whatsapp.assignment.failed', {
      ...logContext,
      code: error.code || 'WHATSAPP_SEND_FAILED',
      message: error.message,
      httpStatus: error.httpStatus || null,
      meta: error.meta || null
    });

    return {
      status: 'FAILED',
      attemptedAt,
      error: {
        code: error.code || 'WHATSAPP_SEND_FAILED',
        message: error.message,
        httpStatus: error.httpStatus || null,
        meta: error.meta || null
      }
    };
  }
}

module.exports = {
  buildTemplateMessage,
  sendTemplateMessage,
  sendAssignmentNotification
};
