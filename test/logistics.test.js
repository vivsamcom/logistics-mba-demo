const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');

process.env.NODE_ENV = 'test';
process.env.META_SIGNATURE_VALIDATION_ENABLED = 'false';

const app = require('../src/app');

function request(server, { method = 'GET', path = '/', body }) {
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
              'content-length': bodyBuffer.length
            }
          : undefined
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

function createLoadAssignment(server, overrides = {}) {
  return request(server, {
    method: 'POST',
    path: '/api/assignments',
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
    assert.equal(driverAssignments.body.count, 1);
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
