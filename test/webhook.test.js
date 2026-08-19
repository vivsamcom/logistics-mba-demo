const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { once } = require('node:events');

process.env.NODE_ENV = 'test';
process.env.WEBHOOK_VERIFY_TOKEN = 'test-verify-token';
process.env.META_APP_SECRET = 'test-app-secret';
process.env.META_SIGNATURE_VALIDATION_ENABLED = 'false';

const app = require('../src/app');
const { extractWhatsAppEvents } = require('../src/services/webhook.service');

function request(server, { method = 'GET', path = '/', headers = {}, body }) {
  const address = server.address();
  const bodyBuffer = body === undefined ? null : Buffer.from(body);

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: address.port,
        method,
        path,
        headers: bodyBuffer
          ? {
              'content-length': bodyBuffer.length,
              ...headers
            }
          : headers
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            body: Buffer.concat(chunks).toString('utf8')
          });
        });
      }
    );

    req.on('error', reject);

    if (bodyBuffer) {
      req.write(bodyBuffer);
    }

    req.end();
  });
}

test('Phase 1 webhook foundation', async (t) => {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));

  await t.test('returns the health response', async () => {
    const response = await request(server, { path: '/health' });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), {
      status: 'UP',
      service: 'by-tms-mba-demo'
    });
  });

  await t.test('accepts a valid GET webhook verification', async () => {
    const response = await request(server, {
      path:
        '/webhook?hub.mode=subscribe&hub.verify_token=test-verify-token' +
        '&hub.challenge=123456'
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.body, '123456');
  });

  await t.test('rejects an invalid GET webhook verification', async () => {
    const response = await request(server, {
      path:
        '/webhook?hub.mode=subscribe&hub.verify_token=wrong' +
        '&hub.challenge=123456'
    });

    assert.equal(response.statusCode, 403);
  });

  await t.test('accepts an unsigned POST when validation is disabled', async () => {
    process.env.META_SIGNATURE_VALIDATION_ENABLED = 'false';
    const response = await request(server, {
      method: 'POST',
      path: '/webhook',
      headers: { 'content-type': 'application/json' },
      body: '{"object":"whatsapp_business_account","entry":[]}'
    });

    assert.equal(response.statusCode, 200);
  });

  await t.test('accepts the HMAC of the exact raw body bytes', async () => {
    process.env.META_SIGNATURE_VALIDATION_ENABLED = 'true';
    const rawPayload = [
      '{',
      '  "entry": [],',
      '  "object": "whatsapp_business_account"',
      '}'
    ].join('\n');
    const signature = crypto
      .createHmac('sha256', process.env.META_APP_SECRET)
      .update(Buffer.from(rawPayload))
      .digest('hex');
    const response = await request(server, {
      method: 'POST',
      path: '/webhook',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': `sha256=${signature}`
      },
      body: rawPayload
    });

    assert.equal(response.statusCode, 200);
  });

  await t.test('rejects an incorrect signature when enabled', async () => {
    process.env.META_SIGNATURE_VALIDATION_ENABLED = 'true';
    const response = await request(server, {
      method: 'POST',
      path: '/webhook',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': `sha256=${'0'.repeat(64)}`
      },
      body: '{"entry":[]}'
    });

    assert.equal(response.statusCode, 401);
  });

  await t.test('rejects a missing signature when enabled', async () => {
    process.env.META_SIGNATURE_VALIDATION_ENABLED = 'true';
    const response = await request(server, {
      method: 'POST',
      path: '/webhook',
      headers: { 'content-type': 'application/json' },
      body: '{"entry":[]}'
    });

    assert.equal(response.statusCode, 401);
  });
});

test('extractWhatsAppEvents safely normalizes messages and statuses', () => {
  const imageMessage = {
    id: 'message-1',
    from: '15551234567',
    type: 'image',
    image: { id: 'media-1' }
  };
  const status = { id: 'message-2', status: 'delivered' };
  const events = extractWhatsAppEvents({
    entry: [
      {
        changes: [
          {
            value: {
              metadata: {
                phone_number_id: 'phone-id',
                display_phone_number: '15550000000'
              },
              contacts: [{ wa_id: '15551234567', profile: { name: 'Driver' } }],
              messages: [imageMessage],
              statuses: [status]
            }
          }
        ]
      }
    ]
  });

  assert.equal(events.length, 2);
  assert.deepEqual(events[0], {
    type: 'MESSAGE',
    phoneNumberId: 'phone-id',
    displayPhoneNumber: '15550000000',
    contact: { wa_id: '15551234567', profile: { name: 'Driver' } },
    message: imageMessage
  });
  assert.deepEqual(events[1], {
    type: 'STATUS',
    phoneNumberId: 'phone-id',
    status
  });

  assert.deepEqual(extractWhatsAppEvents(null), []);
  assert.deepEqual(extractWhatsAppEvents({ entry: [{ changes: [{}] }] }), []);
});
