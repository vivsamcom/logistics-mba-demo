const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');

process.env.NODE_ENV = 'test';
process.env.META_SIGNATURE_VALIDATION_ENABLED = 'false';
process.env.WHATSAPP_NOTIFICATIONS_ENABLED = 'false';
process.env.WHATSAPP_ASSIGNMENT_HEADER_IMAGE_URL =
  'https://logistics-mba-demo.onrender.com/images/load-assignment-header.png';

const app = require('../src/app');
const repository = require('../src/repositories/mock-logistics.repository');

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

function resetDemo(server) {
  return request(server, {
    method: 'POST',
    path: '/api/demo/reset'
  });
}

function getSystemDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function addDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatTemplateDateTime(dateText, timeText) {
  const [, month, day] = dateText.split('-').map(Number);
  const [hour, minute] = timeText.split(':').map(Number);
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec'
  ];
  const period = hour >= 12 ? 'PM' : 'AM';

  return `${day} ${months[month - 1]}, ${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${period}`;
}

function reportBreakdown(server) {
  return request(server, {
    method: 'POST',
    path: '/api/shipments/SHP-1024/exceptions',
    body: {
      driverId: 'DRV-101',
      type: 'VEHICLE_BREAKDOWN',
      reason: 'Truck breakdown',
      location: 'Near Pune',
      delayMinutes: 90
    }
  });
}

function reassignToAmit(server) {
  return request(server, {
    method: 'POST',
    path: '/api/shipments/SHP-1088/reassign',
    body: { newDriverId: 'DRV-203' }
  });
}

function createLoadAssignment(server, overrides = {}, headers = {}) {
  return request(server, {
    method: 'POST',
    path: '/api/assignments',
    headers,
    body: {
      eventId: 'ASSIGN-0001',
      shipmentId: 'SHP-1092',
      driverId: 'DRV-203',
      ...overrides
    }
  });
}

test('mock logistics demo APIs', async (t) => {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));

  await t.test('returns a calculated shipment summary', async () => {
    await resetDemo(server);
    const response = await request(server, {
      path: '/api/shipments/today'
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body.data, {
      operatingDate: getSystemDate(),
      total: 5,
      scheduled: 2,
      inTransit: 2,
      delayed: 1,
      activeExceptions: 1
    });
  });

  await t.test('gets an existing shipment with related data', async () => {
    await resetDemo(server);
    const response = await request(server, {
      path: '/api/shipments/SHP-1024'
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.data.shipmentId, 'SHP-1024');
    assert.equal(response.body.data.serviceDate, getSystemDate());
    assert.equal(
      response.body.data.expectedDeliveryDate,
      addDays(getSystemDate(), 2)
    );
    assert.equal(
      response.body.data.deliveryLocation,
      'Bengaluru Warehouse'
    );
    assert.equal(response.body.data.driver.driverId, 'DRV-101');
    assert.equal(response.body.data.assignment.status, 'ACCEPTED');
  });

  await t.test('returns a structured 404 for an unknown shipment', async () => {
    const response = await request(server, {
      path: '/api/shipments/SHP-9999'
    });

    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.body, {
      error: {
        code: 'SHIPMENT_NOT_FOUND',
        message: 'Shipment SHP-9999 was not found'
      }
    });
  });

  await t.test('returns delayed shipments from current state', async () => {
    await resetDemo(server);
    const response = await request(server, {
      path: '/api/shipments/delayed'
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.count, 1);
    assert.equal(response.body.data[0].shipmentId, 'SHP-1099');
  });

  await t.test('returns the driver current trip and ordered assignments', async () => {
    await resetDemo(server);
    const currentTrip = await request(server, {
      path: '/api/drivers/DRV-101/current-trip'
    });
    const assignments = await request(server, {
      path: '/api/drivers/DRV-101/assignments'
    });

    assert.equal(currentTrip.statusCode, 200);
    assert.equal(currentTrip.body.data.shipment.shipmentId, 'SHP-1024');
    assert.deepEqual(
      assignments.body.data.map((item) => item.shipmentId),
      ['SHP-1024', 'SHP-1088']
    );
  });

  await t.test('accepts a pending assignment and validates repeat responses', async () => {
    await resetDemo(server);
    const accepted = await request(server, {
      method: 'POST',
      path: '/api/assignments/SHP-1088/respond',
      body: { driverId: 'DRV-101', response: 'ACCEPT' }
    });
    const repeated = await request(server, {
      method: 'POST',
      path: '/api/assignments/SHP-1088/respond',
      body: { driverId: 'DRV-101', response: 'REJECT' }
    });

    assert.equal(accepted.statusCode, 200);
    assert.equal(accepted.body.data.status, 'ACCEPTED');
    assert.equal(repeated.statusCode, 409);
    assert.equal(
      repeated.body.error.code,
      'ASSIGNMENT_ALREADY_RESPONDED'
    );
  });

  await t.test('creates a new load assignment', async () => {
    await resetDemo(server);
    const created = await createLoadAssignment(server);
    const shipment = await request(server, {
      path: '/api/shipments/SHP-1092'
    });
    const driverAssignments = await request(server, {
      path: '/api/drivers/DRV-203/assignments'
    });

    assert.equal(created.statusCode, 201);
    assert.equal(created.body.data.idempotent, false);
    assert.equal(created.body.data.event.eventId, 'ASSIGN-0001');
    assert.equal(created.body.data.event.type, 'LOAD_ASSIGNED');
    assert.equal(created.body.data.assignment.status, 'ASSIGNED');
    assert.equal(created.body.data.assignment.driverId, 'DRV-203');
    assert.deepEqual(created.body.data.notification, {
      channel: 'WHATSAPP',
      recipient: {
        driverId: 'DRV-203',
        phone: '+15550000203'
      },
      template: {
        name: 'new_load_assignment_v1',
        category: 'UTILITY',
        language: 'en_US',
        header: {
          format: 'IMAGE',
          image: {
            link:
              'https://logistics-mba-demo.onrender.com/images/' +
              'load-assignment-header.png'
          }
        },
        bodyParameters: [
          { position: 1, name: 'shipment', value: 'SHP-1092' },
          {
            position: 2,
            name: 'pickup',
            value: 'Chennai Port'
          },
          {
            position: 3,
            name: 'delivery',
            value: 'Hyderabad Distribution Center'
          },
          {
            position: 4,
            name: 'pickupDateTime',
            value: formatTemplateDateTime(getSystemDate(), '15:00')
          },
          {
            position: 5,
            name: 'expectedDeliveryDateTime',
            value: formatTemplateDateTime(getSystemDate(), '23:00')
          }
        ],
        buttons: [
          {
            index: 0,
            type: 'QUICK_REPLY',
            text: 'Accept',
            action: 'ACCEPT',
            payload: 'ASSIGNMENT:ACCEPT:SHP-1092:DRV-203'
          },
          {
            index: 1,
            type: 'QUICK_REPLY',
            text: 'Reject',
            action: 'REJECT',
            payload: 'ASSIGNMENT:REJECT:SHP-1092:DRV-203'
          }
        ]
      }
    });
    assert.match(
      created.body.data.assignment.assignedAt,
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/
    );
    assert.equal(shipment.body.data.driverId, 'DRV-203');
    assert.equal(shipment.body.data.driver.status, 'ASSIGNED');
    assert.equal(shipment.body.data.driver.nextShipmentId, 'SHP-1092');
    assert.deepEqual(
      driverAssignments.body.data.map((item) => item.shipmentId),
      ['SHP-1092']
    );
  });

  await t.test('handles event retries without duplicate assignments', async () => {
    await resetDemo(server);
    const created = await createLoadAssignment(server);
    const retried = await createLoadAssignment(server);
    const driverAssignments = await request(server, {
      path: '/api/drivers/DRV-203/assignments'
    });

    assert.equal(created.statusCode, 201);
    assert.equal(retried.statusCode, 200);
    assert.equal(retried.body.data.idempotent, true);
    assert.deepEqual(
      retried.body.data.notification,
      created.body.data.notification
    );
    assert.equal(driverAssignments.body.count, 1);
  });

  await t.test('sends the assignment template once through Meta', async (t) => {
    const originalFetch = globalThis.fetch;
    const originalConsoleLog = console.log;
    const originalEnvironment = {
      enabled: process.env.WHATSAPP_NOTIFICATIONS_ENABLED,
      token: process.env.WHATSAPP_ACCESS_TOKEN,
      phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
      graphApiVersion: process.env.WHATSAPP_GRAPH_API_VERSION,
      headerImageUrl: process.env.WHATSAPP_ASSIGNMENT_HEADER_IMAGE_URL
    };
    const calls = [];
    const infoLogs = [];

    t.after(() => {
      globalThis.fetch = originalFetch;
      console.log = originalConsoleLog;
      process.env.WHATSAPP_NOTIFICATIONS_ENABLED =
        originalEnvironment.enabled;

      for (const [name, value] of [
        ['WHATSAPP_ACCESS_TOKEN', originalEnvironment.token],
        ['WHATSAPP_PHONE_NUMBER_ID', originalEnvironment.phoneNumberId],
        ['WHATSAPP_GRAPH_API_VERSION', originalEnvironment.graphApiVersion],
        [
          'WHATSAPP_ASSIGNMENT_HEADER_IMAGE_URL',
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

    process.env.WHATSAPP_NOTIFICATIONS_ENABLED = 'true';
    process.env.WHATSAPP_ACCESS_TOKEN = 'test-access-token';
    process.env.WHATSAPP_PHONE_NUMBER_ID = 'test-phone-number-id';
    process.env.WHATSAPP_GRAPH_API_VERSION = 'v25.0';
    process.env.WHATSAPP_ASSIGNMENT_HEADER_IMAGE_URL =
      'https://logistics.example/images/load-assignment-header.png';
    console.log = (message) => infoLogs.push(message);
    globalThis.fetch = async (url, options) => {
      calls.push({ url, options });

      return {
        ok: true,
        status: 200,
        json: async () => ({ messages: [{ id: 'wamid.assignment-1' }] })
      };
    };

    await resetDemo(server);
    const reassigned = await reassignToAmit(server);
    const created = await createLoadAssignment(server, {
      driverId: 'DRV-101'
    });
    const retried = await createLoadAssignment(server, {
      driverId: 'DRV-101'
    });

    assert.equal(reassigned.statusCode, 200);
    assert.equal(created.statusCode, 201);
    assert.deepEqual(created.body.data.notificationDelivery, {
      status: 'ACCEPTED_BY_META',
      attemptedAt: created.body.data.notificationDelivery.attemptedAt,
      messageId: 'wamid.assignment-1'
    });
    assert.equal(retried.statusCode, 200);
    assert.equal(
      retried.body.data.notificationDelivery.messageId,
      'wamid.assignment-1'
    );
    assert.equal(calls.length, 1);
    assert.equal(infoLogs.length, 1);
    assert.equal(
      JSON.parse(infoLogs[0]).event,
      'whatsapp.assignment.accepted'
    );
    assert.equal(
      calls[0].url,
      'https://graph.facebook.com/v25.0/test-phone-number-id/messages'
    );
    assert.equal(
      calls[0].options.headers.Authorization,
      'Bearer test-access-token'
    );
    assert.deepEqual(JSON.parse(calls[0].options.body), {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '919823784110',
      type: 'template',
      template: {
        name: 'new_load_assignment_v1',
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
                    'load-assignment-header.png'
                }
              }
            ]
          },
          {
            type: 'body',
            parameters: [
              { type: 'text', text: 'SHP-1092' },
              { type: 'text', text: 'Chennai Port' },
              {
                type: 'text',
                text: 'Hyderabad Distribution Center'
              },
              {
                type: 'text',
                text: formatTemplateDateTime(getSystemDate(), '15:00')
              },
              {
                type: 'text',
                text: formatTemplateDateTime(getSystemDate(), '23:00')
              }
            ]
          }
        ]
      }
    });
  });

  await t.test('keeps the assignment when Meta rejects the message', async (t) => {
    const originalFetch = globalThis.fetch;
    const originalConsoleError = console.error;
    const originalEnabled = process.env.WHATSAPP_NOTIFICATIONS_ENABLED;
    const originalToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const originalPhoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const originalGraphApiVersion = process.env.WHATSAPP_GRAPH_API_VERSION;
    const errorLogs = [];

    t.after(() => {
      globalThis.fetch = originalFetch;
      console.error = originalConsoleError;
      process.env.WHATSAPP_NOTIFICATIONS_ENABLED = originalEnabled;

      const environment = {
        WHATSAPP_ACCESS_TOKEN: originalToken,
        WHATSAPP_PHONE_NUMBER_ID: originalPhoneNumberId,
        WHATSAPP_GRAPH_API_VERSION: originalGraphApiVersion
      };

      for (const [name, value] of Object.entries(environment)) {
        if (value === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = value;
        }
      }
    });

    process.env.WHATSAPP_NOTIFICATIONS_ENABLED = 'true';
    process.env.WHATSAPP_ACCESS_TOKEN = 'test-access-token';
    process.env.WHATSAPP_PHONE_NUMBER_ID = 'test-phone-number-id';
    process.env.WHATSAPP_GRAPH_API_VERSION = 'v25.0';
    console.error = (message) => errorLogs.push(message);
    globalThis.fetch = async () => ({
      ok: false,
      status: 400,
      headers: {
        get: (name) =>
          name === 'x-fb-request-id' ? 'meta-request-456' : null
      },
      json: async () => ({
        error: {
          code: 132001,
          error_subcode: 2494073,
          type: 'OAuthException',
          message: 'Template does not exist in the specified language',
          error_data: { details: 'template name or language mismatch' },
          fbtrace_id: 'meta-trace-789'
        }
      })
    });

    await resetDemo(server);
    const created = await createLoadAssignment(
      server,
      {},
      { 'rndr-id': 'render-request-123' }
    );
    const shipment = await request(server, {
      path: '/api/shipments/SHP-1092'
    });

    assert.equal(created.statusCode, 201);
    assert.equal(created.body.data.notificationDelivery.status, 'FAILED');
    assert.equal(
      created.body.data.notificationDelivery.error.code,
      '132001'
    );
    assert.equal(
      created.body.data.notificationDelivery.error.httpStatus,
      400
    );
    assert.equal(shipment.body.data.driverId, 'DRV-203');
    assert.equal(shipment.body.data.assignment.status, 'ASSIGNED');

    assert.equal(errorLogs.length, 1);
    const log = JSON.parse(errorLogs[0]);
    assert.deepEqual(log, {
      level: 'error',
      event: 'whatsapp.assignment.failed',
      timestamp: log.timestamp,
      requestId: 'render-request-123',
      eventId: 'ASSIGN-0001',
      shipmentId: 'SHP-1092',
      driverId: 'DRV-203',
      recipient: '*******0203',
      templateName: 'new_load_assignment_v1',
      templateLanguage: 'en_US',
      code: '132001',
      message: 'Template does not exist in the specified language',
      httpStatus: 400,
      meta: {
        type: 'OAuthException',
        subcode: '2494073',
        details: 'template name or language mismatch',
        traceId: 'meta-trace-789',
        requestId: 'meta-request-456'
      }
    });
    assert.equal(errorLogs[0].includes('test-access-token'), false);
  });

  await t.test('rejects conflicting events and existing assignments', async () => {
    await resetDemo(server);
    await createLoadAssignment(server);
    const eventConflict = await createLoadAssignment(server, {
      shipmentId: 'SHP-1050'
    });
    const existingAssignment = await createLoadAssignment(server, {
      eventId: 'ASSIGN-0002',
      shipmentId: 'SHP-1024',
      driverId: 'DRV-101'
    });

    assert.equal(eventConflict.statusCode, 409);
    assert.equal(
      eventConflict.body.error.code,
      'ASSIGNMENT_EVENT_CONFLICT'
    );
    assert.equal(existingAssignment.statusCode, 409);
    assert.equal(
      existingAssignment.body.error.code,
      'SHIPMENT_ALREADY_ASSIGNED'
    );
  });

  await t.test('validates required assignment fields', async () => {
    await resetDemo(server);
    const response = await request(server, {
      method: 'POST',
      path: '/api/assignments',
      body: {
        shipmentId: 'SHP-1092',
        driverId: 'DRV-203'
      }
    });

    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.body, {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'eventId is required'
      }
    });
  });

  await t.test('does not assign a load with incomplete notification data', async () => {
    await resetDemo(server);
    repository.getShipmentById('SHP-1092').pickupLocation = null;

    const response = await createLoadAssignment(server);
    const shipment = await request(server, {
      path: '/api/shipments/SHP-1092'
    });

    assert.equal(response.statusCode, 422);
    assert.deepEqual(response.body, {
      error: {
        code: 'ASSIGNMENT_NOTIFICATION_DATA_INCOMPLETE',
        message:
          'shipment.pickupLocation is required to build the load assignment notification'
      }
    });
    assert.equal(shipment.body.data.driverId, null);
    assert.equal(shipment.body.data.assignment, null);
  });

  await t.test('records a breakdown and updates shipment and exception views', async () => {
    await resetDemo(server);
    const created = await reportBreakdown(server);
    const shipment = await request(server, {
      path: '/api/shipments/SHP-1024'
    });
    const shipmentExceptions = await request(server, {
      path: '/api/shipments/SHP-1024/exceptions'
    });
    const activeExceptions = await request(server, {
      path: '/api/exceptions'
    });

    assert.equal(created.statusCode, 201);
    assert.equal(created.body.data.exception.exceptionId, 'EX-002');
    assert.equal(created.body.data.exception.type, 'VEHICLE_BREAKDOWN');
    assert.equal(created.body.data.shipment.status, 'DELAYED');
    assert.equal(created.body.data.shipment.eta, '18:30');
    assert.equal(shipment.body.data.status, 'DELAYED');
    assert.equal(shipment.body.data.delayMinutes, 90);
    assert.equal(shipmentExceptions.body.count, 1);
    assert.equal(activeExceptions.body.count, 2);
  });

  await t.test('supplies backend-owned downstream impact', async () => {
    await resetDemo(server);
    await reportBreakdown(server);
    const response = await request(server, {
      path: '/api/shipments/SHP-1088/impact'
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body.data, {
      shipmentId: 'SHP-1088',
      impacted: true,
      risk: 'HIGH',
      sourceShipmentId: 'SHP-1024',
      delayMinutes: 90,
      reason: "The driver's earlier assignment has an active 90-minute delay"
    });
  });

  await t.test('returns drivers available before the shipment pickup', async () => {
    await resetDemo(server);
    const response = await request(server, {
      path: '/api/shipments/SHP-1088/available-drivers'
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(
      response.body.data.map((driver) => driver.driverId),
      ['DRV-203', 'DRV-218']
    );
  });

  await t.test('reassigns the shipment and keeps assignment data consistent', async () => {
    await resetDemo(server);
    const reassignment = await reassignToAmit(server);
    const shipment = await request(server, {
      path: '/api/shipments/SHP-1088'
    });
    const amitAssignments = await request(server, {
      path: '/api/drivers/DRV-203/assignments'
    });
    const rajAssignments = await request(server, {
      path: '/api/drivers/DRV-101/assignments'
    });

    assert.equal(reassignment.statusCode, 200);
    assert.equal(reassignment.body.data.driverId, 'DRV-203');
    assert.equal(reassignment.body.data.previousDriverId, 'DRV-101');
    assert.equal(shipment.body.data.driverId, 'DRV-203');
    assert.equal(shipment.body.data.assignment.driverId, 'DRV-203');
    assert.deepEqual(
      amitAssignments.body.data.map((item) => item.shipmentId),
      ['SHP-1088']
    );
    assert.deepEqual(
      rajAssignments.body.data.map((item) => item.shipmentId),
      ['SHP-1024']
    );
  });

  await t.test('restores every mutation to the original seed state', async () => {
    await resetDemo(server);
    await reportBreakdown(server);
    await reassignToAmit(server);

    const reset = await resetDemo(server);
    const currentShipment = await request(server, {
      path: '/api/shipments/SHP-1024'
    });
    const nextShipment = await request(server, {
      path: '/api/shipments/SHP-1088'
    });
    const exceptions = await request(server, {
      path: '/api/shipments/SHP-1024/exceptions'
    });
    const availableDrivers = await request(server, {
      path: '/api/shipments/SHP-1088/available-drivers'
    });

    assert.equal(reset.statusCode, 200);
    assert.equal(reset.body.data.status, 'RESET');
    assert.equal(currentShipment.body.data.status, 'IN_TRANSIT');
    assert.equal(currentShipment.body.data.eta, '17:00');
    assert.equal(nextShipment.body.data.driverId, 'DRV-101');
    assert.equal(exceptions.body.count, 0);
    assert.equal(
      availableDrivers.body.data.some(
        (driver) => driver.driverId === 'DRV-203'
      ),
      true
    );
  });
});
