const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildTemplateMessage,
  sendTemplateMessage
} = require('../src/services/whatsapp.service');

function notificationFixture() {
  return {
    channel: 'WHATSAPP',
    recipient: {
      driverId: 'DRV-101',
      phone: '+91 98237 84110'
    },
    template: {
      name: 'new_load_assignment_v1',
      category: 'UTILITY',
      language: 'en_US',
      bodyParameters: [
        { position: 3, name: 'delivery', value: 'Bengaluru Warehouse' },
        { position: 1, name: 'shipment', value: 'SHP-1024' },
        { position: 2, name: 'pickup', value: 'Mumbai Port' },
        { position: 5, name: 'deliveryTime', value: '27 Aug, 5:00 PM' },
        { position: 4, name: 'pickupTime', value: '25 Aug, 9:00 AM' }
      ],
      buttons: [
        {
          index: 0,
          type: 'QUICK_REPLY',
          payload: 'ASSIGNMENT:ACCEPT:SHP-1024:DRV-101'
        }
      ]
    }
  };
}

test('builds the approved body-only utility template payload', () => {
  assert.deepEqual(buildTemplateMessage(notificationFixture()), {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: '919823784110',
    type: 'template',
    template: {
      name: 'new_load_assignment_v1',
      language: { code: 'en_US' },
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: 'SHP-1024' },
            { type: 'text', text: 'Mumbai Port' },
            { type: 'text', text: 'Bengaluru Warehouse' },
            { type: 'text', text: '25 Aug, 9:00 AM' },
            { type: 'text', text: '27 Aug, 5:00 PM' }
          ]
        }
      ]
    }
  });
});

test('posts the template to the configured Meta messages endpoint', async (t) => {
  const originalEnvironment = {
    token: process.env.WHATSAPP_ACCESS_TOKEN,
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    graphApiVersion: process.env.WHATSAPP_GRAPH_API_VERSION
  };
  let capturedRequest;

  t.after(() => {
    for (const [name, value] of [
      ['WHATSAPP_ACCESS_TOKEN', originalEnvironment.token],
      ['WHATSAPP_PHONE_NUMBER_ID', originalEnvironment.phoneNumberId],
      ['WHATSAPP_GRAPH_API_VERSION', originalEnvironment.graphApiVersion]
    ]) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  });

  process.env.WHATSAPP_ACCESS_TOKEN = 'secret-token';
  process.env.WHATSAPP_PHONE_NUMBER_ID = '123456789';
  process.env.WHATSAPP_GRAPH_API_VERSION = '25.0';

  const response = await sendTemplateMessage(
    notificationFixture(),
    async (url, options) => {
      capturedRequest = { url, options };

      return {
        ok: true,
        status: 200,
        json: async () => ({ messages: [{ id: 'wamid.test-1' }] })
      };
    }
  );

  assert.deepEqual(response, { messages: [{ id: 'wamid.test-1' }] });
  assert.equal(
    capturedRequest.url,
    'https://graph.facebook.com/v25.0/123456789/messages'
  );
  assert.equal(
    capturedRequest.options.headers.Authorization,
    'Bearer secret-token'
  );
});
