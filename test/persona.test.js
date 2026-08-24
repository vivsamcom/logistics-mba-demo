const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');

process.env.NODE_ENV = 'test';
process.env.META_SIGNATURE_VALIDATION_ENABLED = 'false';

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
    assert.equal(currentTrip.body.data.shipment.shipmentId, 'SHP-1024');
    assert.equal(assignments.statusCode, 200);
    assert.deepEqual(
      assignments.body.data.map((item) => item.shipmentId),
      ['SHP-1024', 'SHP-1088']
    );
  });

  await t.test('derives the Driver for assignment responses', async () => {
    await resetDemo(server);
    const response = await request(server, {
      method: 'POST',
      path: '/api/me/assignments/SHP-1088/respond',
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
    const response = await request(server, {
      method: 'POST',
      path: '/api/me/shipments/SHP-1024/exceptions',
      headers: personaHeaders(DRIVER_PHONE),
      body: {
        driverId: 'DRV-305',
        type: 'VEHICLE_BREAKDOWN',
        location: 'Near Pune',
        delayMinutes: 90
      }
    });

    assert.equal(response.statusCode, 201);
    assert.equal(response.body.data.exception.driverId, 'DRV-101');
    assert.equal(response.body.data.shipment.status, 'DELAYED');
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
    assert.equal(response.body.data.previousDriverId, 'DRV-101');
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
