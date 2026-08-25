const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');

process.env.NODE_ENV = 'test';
process.env.META_SIGNATURE_VALIDATION_ENABLED = 'false';
process.env.WHATSAPP_NOTIFICATIONS_ENABLED = 'false';
process.env.WHATSAPP_EXCEPTION_HEADER_IMAGE_URL =
  'https://logistics-mba-demo.onrender.com/images/breakdown-image.png';

const app = require('../src/app');
const { normalizePhone } = require('../src/utils/phone');

const DRIVER_PHONE = '919823784110';
const DISPATCHER_PHONE = '919511758488';

function request(
  server,
  { method = 'GET', path = '/', headers = {}, body }
) {
  const address = server.address();
  const bodyBuffer = body === undefined
    ? null
    : Buffer.from(JSON.stringify(body));

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: address.port,
        method,
        path,
        headers: bodyBuffer
          ? {
              'content-type': 'application/json',
              'content-length': bodyBuffer.length,
              ...headers
            }
          : headers
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({
            statusCode: res.statusCode,
            body: text ? JSON.parse(text) : null
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

function personaHeaders(phone) {
  return { 'x-whatsapp-phone': phone };
}

function resetDemo(server) {
  return request(server, {
    method: 'POST',
    path: '/api/demo/reset'
  });
}

function assignShipmentToRaj(server) {
  return request(server, {
    method: 'POST',
    path: '/api/assignments',
    body: {
      eventId: 'PERSONA-ASSIGN-1024',
      shipmentId: 'SHP-1024',
      driverId: 'DRV-101'
    }
  });
}

function reportRajException(server, headers = {}) {
  return request(server, {
    method: 'POST',
    path: '/api/me/shipments/SHP-1024/exceptions',
    headers: {
      ...personaHeaders(DRIVER_PHONE),
      ...headers
    },
    body: {
      driverId: 'DRV-305',
      type: 'VEHICLE_BREAKDOWN',
      location: 'Near Pune',
      delayMinutes: 90
    }
  });
}

test('persona-aware MBA APIs', async (t) => {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));

  await t.test('normalizes formatted WhatsApp phone numbers', () => {
    assert.equal(normalizePhone('+91 98237 84110'), DRIVER_PHONE);
    assert.equal(normalizePhone('91-98237-84110'), DRIVER_PHONE);
    assert.equal(normalizePhone(DRIVER_PHONE), DRIVER_PHONE);
  });

  await t.test('resolves the Driver persona without returning the phone', async () => {
    const response = await request(server, {
      path: '/api/me/persona',
      headers: personaHeaders('+91 98237 84110')
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body.data, {
      role: 'DRIVER',
      entityId: 'DRV-101',
      name: 'Raj'
    });
    assert.equal(response.body.data.whatsappPhone, undefined);
  });

  await t.test('uses the resolved Driver for self-service reads', async () => {
    await resetDemo(server);
    const currentTrip = await request(server, {
      path: '/api/me/current-trip',
      headers: personaHeaders(DRIVER_PHONE)
    });
    const assignments = await request(server, {
      path: '/api/me/assignments',
      headers: personaHeaders(DRIVER_PHONE)
    });

    assert.equal(currentTrip.statusCode, 200);
    assert.equal(currentTrip.body.data.driver.driverId, 'DRV-101');
    assert.equal(currentTrip.body.data.shipment, null);
    assert.equal(currentTrip.body.data.assignment, null);
    assert.equal(assignments.statusCode, 200);
    assert.deepEqual(assignments.body.data, []);
  });

  await t.test('derives the Driver for assignment responses', async () => {
    await resetDemo(server);
    await assignShipmentToRaj(server);
    const response = await request(server, {
      method: 'POST',
      path: '/api/me/assignments/SHP-1024/respond',
      headers: personaHeaders(DRIVER_PHONE),
      body: {
        driverId: 'DRV-305',
        response: 'ACCEPT'
      }
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.data.driverId, 'DRV-101');
    assert.equal(response.body.data.status, 'ACCEPTED');
  });

  await t.test('derives the Driver when reporting an exception', async () => {
    await resetDemo(server);
    await assignShipmentToRaj(server);
    const response = await reportRajException(server);

    assert.equal(response.statusCode, 201);
    assert.equal(response.body.data.exception.driverId, 'DRV-101');
    assert.equal(response.body.data.shipment.status, 'DELAYED');
    assert.equal(
      response.body.data.notification.recipient.dispatcherId,
      'DSP-001'
    );
    assert.deepEqual(response.body.data.notificationDelivery, {
      status: 'SKIPPED',
      reason: 'WHATSAPP_NOTIFICATIONS_DISABLED'
    });
  });

  await t.test('returns HIGH direct impact after an accepted assignment reports a long delay', async () => {
    await resetDemo(server);
    await assignShipmentToRaj(server);
    const acceptance = await request(server, {
      method: 'POST',
      path: '/api/me/assignments/SHP-1024/respond',
      headers: personaHeaders(DRIVER_PHONE),
      body: { response: 'ACCEPT' }
    });
    const exception = await reportRajException(server);
    const impact = await request(server, {
      path: '/api/dispatcher/shipments/SHP-1024/impact',
      headers: personaHeaders(DISPATCHER_PHONE)
    });

    assert.equal(acceptance.statusCode, 200);
    assert.equal(acceptance.body.data.status, 'ACCEPTED');
    assert.equal(exception.statusCode, 201);
    assert.equal(impact.statusCode, 200);
    assert.deepEqual(impact.body.data, {
      shipmentId: 'SHP-1024',
      impacted: true,
      risk: 'HIGH',
      sourceShipmentId: 'SHP-1024',
      delayMinutes: 90,
      reason: 'This shipment has an active 90-minute delay'
    });
  });

  await t.test('sends the exception template to the Dispatcher', async (t) => {
    const originalFetch = globalThis.fetch;
    const originalConsoleLog = console.log;
    const originalEnvironment = {
      enabled: process.env.WHATSAPP_NOTIFICATIONS_ENABLED,
      token: process.env.WHATSAPP_ACCESS_TOKEN,
      phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
      graphApiVersion: process.env.WHATSAPP_GRAPH_API_VERSION,
      headerImageUrl: process.env.WHATSAPP_EXCEPTION_HEADER_IMAGE_URL
    };
    const calls = [];
    const logs = [];

    t.after(() => {
      globalThis.fetch = originalFetch;
      console.log = originalConsoleLog;

      for (const [name, value] of [
        ['WHATSAPP_NOTIFICATIONS_ENABLED', originalEnvironment.enabled],
        ['WHATSAPP_ACCESS_TOKEN', originalEnvironment.token],
        ['WHATSAPP_PHONE_NUMBER_ID', originalEnvironment.phoneNumberId],
        ['WHATSAPP_GRAPH_API_VERSION', originalEnvironment.graphApiVersion],
        [
          'WHATSAPP_EXCEPTION_HEADER_IMAGE_URL',
          originalEnvironment.headerImageUrl
        ]
      ]) {
        if (value === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = value;
        }
      }
    });

    process.env.WHATSAPP_NOTIFICATIONS_ENABLED = 'false';
    await resetDemo(server);
    await assignShipmentToRaj(server);

    process.env.WHATSAPP_NOTIFICATIONS_ENABLED = 'true';
    process.env.WHATSAPP_ACCESS_TOKEN = 'test-access-token';
    process.env.WHATSAPP_PHONE_NUMBER_ID = 'test-phone-number-id';
    process.env.WHATSAPP_GRAPH_API_VERSION = 'v25.0';
    process.env.WHATSAPP_EXCEPTION_HEADER_IMAGE_URL =
      'https://logistics.example/images/breakdown-image.png';
    console.log = (message) => logs.push(message);
    globalThis.fetch = async (url, options) => {
      calls.push({ url, options });

      return {
        ok: true,
        status: 200,
        json: async () => ({ messages: [{ id: 'wamid.exception-1' }] })
      };
    };

    const response = await reportRajException(server, {
      'rndr-id': 'render-exception-123'
    });

    assert.equal(response.statusCode, 201);
    assert.deepEqual(response.body.data.notificationDelivery, {
      status: 'ACCEPTED_BY_META',
      attemptedAt: response.body.data.notificationDelivery.attemptedAt,
      messageId: 'wamid.exception-1'
    });
    assert.deepEqual(
      response.body.data.exception.notificationDelivery,
      response.body.data.notificationDelivery
    );
    assert.equal(calls.length, 1);
    assert.deepEqual(JSON.parse(calls[0].options.body), {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '919511758488',
      type: 'template',
      template: {
        name: 'shipment_exception_alert_v1',
        language: { code: 'en_US' },
        components: [
          {
            type: 'header',
            parameters: [
              {
                type: 'image',
                image: {
                  link:
                    'https://logistics.example/images/' +
                    'breakdown-image.png'
                }
              }
            ]
          },
          {
            type: 'body',
            parameters: [
              { type: 'text', text: 'SHP-1024' },
              { type: 'text', text: 'DRV-101' },
              { type: 'text', text: 'Vehicle breakdown' },
              { type: 'text', text: 'Near Pune' },
              { type: 'text', text: '90 minutes' }
            ]
          }
        ]
      }
    });
    assert.equal(logs.length, 1);
    const log = JSON.parse(logs[0]);
    assert.equal(log.event, 'whatsapp.exception.accepted');
    assert.equal(log.exceptionId, 'EX-002');
    assert.equal(log.shipmentId, 'SHP-1024');
    assert.equal(log.driverId, 'DRV-101');
    assert.equal(log.dispatcherId, 'DSP-001');
  });

  await t.test('keeps the exception when Meta rejects the alert', async (t) => {
    const originalFetch = globalThis.fetch;
    const originalConsoleError = console.error;
    const originalEnvironment = {
      enabled: process.env.WHATSAPP_NOTIFICATIONS_ENABLED,
      token: process.env.WHATSAPP_ACCESS_TOKEN,
      phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
      graphApiVersion: process.env.WHATSAPP_GRAPH_API_VERSION
    };
    const logs = [];

    t.after(() => {
      globalThis.fetch = originalFetch;
      console.error = originalConsoleError;

      for (const [name, value] of [
        ['WHATSAPP_NOTIFICATIONS_ENABLED', originalEnvironment.enabled],
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

    process.env.WHATSAPP_NOTIFICATIONS_ENABLED = 'false';
    await resetDemo(server);
    await assignShipmentToRaj(server);

    process.env.WHATSAPP_NOTIFICATIONS_ENABLED = 'true';
    process.env.WHATSAPP_ACCESS_TOKEN = 'test-access-token';
    process.env.WHATSAPP_PHONE_NUMBER_ID = 'test-phone-number-id';
    process.env.WHATSAPP_GRAPH_API_VERSION = 'v25.0';
    console.error = (message) => logs.push(message);
    globalThis.fetch = async () => ({
      ok: false,
      status: 400,
      json: async () => ({
        error: {
          code: 132001,
          type: 'OAuthException',
          message: 'Template does not exist in the specified language',
          error_data: { details: 'template name or language mismatch' }
        }
      })
    });

    const response = await reportRajException(server);
    const exceptions = await request(server, {
      path: '/api/shipments/SHP-1024/exceptions'
    });

    assert.equal(response.statusCode, 201);
    assert.equal(response.body.data.notificationDelivery.status, 'FAILED');
    assert.equal(
      response.body.data.notificationDelivery.error.code,
      '132001'
    );
    assert.deepEqual(
      response.body.data.exception.notificationDelivery,
      response.body.data.notificationDelivery
    );
    assert.equal(exceptions.body.count, 1);
    assert.equal(exceptions.body.data[0].exceptionId, 'EX-002');
    assert.equal(logs.length, 1);
    const log = JSON.parse(logs[0]);
    assert.equal(log.event, 'whatsapp.exception.failed');
    assert.equal(log.exceptionId, 'EX-002');
    assert.equal(log.code, '132001');
  });

  await t.test('resolves the Dispatcher and permits fleet-wide reads', async () => {
    await resetDemo(server);
    const persona = await request(server, {
      path: '/api/me/persona',
      headers: personaHeaders(DISPATCHER_PHONE)
    });
    const exceptions = await request(server, {
      path: '/api/dispatcher/exceptions',
      headers: personaHeaders(DISPATCHER_PHONE)
    });

    assert.deepEqual(persona.body.data, {
      role: 'DISPATCHER',
      entityId: 'DSP-001',
      name: 'Anita'
    });
    assert.equal(exceptions.statusCode, 200);
    assert.equal(exceptions.body.count, 1);
  });

  await t.test('reuses shipment services through Dispatcher routes', async () => {
    await resetDemo(server);
    const headers = personaHeaders(DISPATCHER_PHONE);
    const summary = await request(server, {
      path: '/api/dispatcher/shipments/today',
      headers
    });
    const delayed = await request(server, {
      path: '/api/dispatcher/shipments/delayed',
      headers
    });
    const details = await request(server, {
      path: '/api/dispatcher/shipments/SHP-1024',
      headers
    });
    const impact = await request(server, {
      path: '/api/dispatcher/shipments/SHP-1088/impact',
      headers
    });
    const availableDrivers = await request(server, {
      path: '/api/dispatcher/shipments/SHP-1088/available-drivers',
      headers
    });

    assert.equal(summary.statusCode, 200);
    assert.equal(summary.body.data.total, 5);
    assert.equal(delayed.statusCode, 200);
    assert.equal(delayed.body.count, 1);
    assert.equal(details.body.data.shipmentId, 'SHP-1024');
    assert.equal(impact.statusCode, 200);
    assert.equal(impact.body.data.shipmentId, 'SHP-1088');
    assert.deepEqual(
      availableDrivers.body.data.map((driver) => driver.driverId),
      ['DRV-203', 'DRV-218']
    );
  });

  await t.test('filters Dispatcher shipments by normalized status', async () => {
    await resetDemo(server);
    const headers = personaHeaders(DISPATCHER_PHONE);
    const response = await request(server, {
      path: '/api/dispatcher/shipments?status=in_transit',
      headers
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.count, 1);
    assert.equal(response.body.data[0].shipmentId, 'SHP-1050');
    assert.equal(response.body.data[0].status, 'IN_TRANSIT');
    assert.equal(response.body.data[0].driver.driverId, 'DRV-304');
    assert.equal(response.body.data[0].assignment.status, 'ACCEPTED');
    assert.deepEqual(response.body.data[0].exceptions, []);
  });

  await t.test('validates the Dispatcher shipment status filter', async () => {
    const headers = personaHeaders(DISPATCHER_PHONE);
    const missing = await request(server, {
      path: '/api/dispatcher/shipments',
      headers
    });
    const invalid = await request(server, {
      path: '/api/dispatcher/shipments?status=UNKNOWN',
      headers
    });

    for (const response of [missing, invalid]) {
      assert.equal(response.statusCode, 400);
      assert.deepEqual(response.body, {
        error: {
          code: 'INVALID_SHIPMENT_STATUS',
          message:
            'status must be one of: SCHEDULED, IN_TRANSIT, DELAYED'
        }
      });
    }
  });

  await t.test('allows only a Dispatcher to reassign a shipment', async () => {
    await resetDemo(server);
    const response = await request(server, {
      method: 'POST',
      path: '/api/dispatcher/shipments/SHP-1088/reassign',
      headers: personaHeaders(DISPATCHER_PHONE),
      body: { newDriverId: 'DRV-203' }
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.data.driverId, 'DRV-203');
    assert.equal(response.body.data.previousDriverId, null);
  });

  await t.test('rejects cross-role access', async () => {
    const driverResponse = await request(server, {
      path: '/api/dispatcher/exceptions',
      headers: personaHeaders(DRIVER_PHONE)
    });
    const dispatcherResponse = await request(server, {
      path: '/api/me/current-trip',
      headers: personaHeaders(DISPATCHER_PHONE)
    });

    for (const response of [driverResponse, dispatcherResponse]) {
      assert.equal(response.statusCode, 403);
      assert.equal(response.body.error.code, 'ROLE_NOT_ALLOWED');
    }
  });

  await t.test('rejects an unknown WhatsApp number', async () => {
    const response = await request(server, {
      path: '/api/me/persona',
      headers: personaHeaders('919999999999')
    });

    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.body, {
      error: {
        code: 'PERSONA_NOT_FOUND',
        message:
          'No Fleet Management persona is configured for this WhatsApp user.'
      }
    });
  });

  await t.test('requires the WhatsApp phone header', async () => {
    const response = await request(server, {
      path: '/api/me/persona'
    });

    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.body, {
      error: {
        code: 'WHATSAPP_PHONE_REQUIRED',
        message: 'X-WhatsApp-Phone is required.'
      }
    });
  });

  await t.test('keeps generic mock TMS routes header-free', async () => {
    const response = await request(server, {
      path: '/api/drivers/DRV-101/current-trip'
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.data.driver.driverId, 'DRV-101');
  });
});
