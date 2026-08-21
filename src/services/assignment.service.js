const repository = require('../repositories/mock-logistics.repository');
const AppError = require('../utils/app-error');

const RESPONSES = {
  ACCEPT: 'ACCEPTED',
  REJECT: 'REJECTED'
};

function requireText(input, fieldName) {
  const value = input && input[fieldName];

  if (typeof value !== 'string' || !value.trim()) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      `${fieldName} is required`
    );
  }

  return value.trim();
}

function getAssignmentSequence(driverId) {
  return repository
    .getAssignments()
    .filter((assignment) => assignment.driverId === driverId)
    .reduce(
      (highest, assignment) => Math.max(highest, assignment.sequence || 0),
      0
    ) + 1;
}

function requireAvailableAssignmentSlot(driver, shipment) {
  if (
    shipment.status === 'SCHEDULED' &&
    driver.nextShipmentId &&
    driver.nextShipmentId !== shipment.shipmentId
  ) {
    throw new AppError(
      409,
      'DRIVER_ASSIGNMENT_CONFLICT',
      `Driver ${driver.driverId} already has next shipment ${driver.nextShipmentId}`
    );
  }

  if (
    shipment.status !== 'SCHEDULED' &&
    driver.currentShipmentId &&
    driver.currentShipmentId !== shipment.shipmentId
  ) {
    throw new AppError(
      409,
      'DRIVER_ASSIGNMENT_CONFLICT',
      `Driver ${driver.driverId} already has current shipment ${driver.currentShipmentId}`
    );
  }
}

function applyDriverAssignment(driver, shipment) {
  if (shipment.status === 'SCHEDULED') {
    driver.nextShipmentId = shipment.shipmentId;
    if (!driver.currentShipmentId) {
      driver.status = 'ASSIGNED';
    }
    return;
  }

  driver.currentShipmentId = shipment.shipmentId;
  driver.status = 'ON_TRIP';
}

function buildCreateResult(event, created) {
  return {
    created,
    event,
    assignment: repository.getAssignmentByShipmentId(event.shipmentId),
    shipment: repository.getShipmentById(event.shipmentId),
    driver: repository.getDriverById(event.driverId)
  };
}

function createAssignment(input) {
  const eventId = requireText(input, 'eventId');
  const shipmentId = requireText(input, 'shipmentId');
  const driverId = requireText(input, 'driverId');
  const existingEvent = repository.getAssignmentEventById(eventId);

  if (existingEvent) {
    if (
      existingEvent.shipmentId !== shipmentId ||
      existingEvent.driverId !== driverId
    ) {
      throw new AppError(
        409,
        'ASSIGNMENT_EVENT_CONFLICT',
        `Assignment event ${eventId} was already used for another assignment`
      );
    }

    return buildCreateResult(existingEvent, false);
  }

  const shipment = repository.getShipmentById(shipmentId);

  if (!shipment) {
    throw new AppError(
      404,
      'SHIPMENT_NOT_FOUND',
      `Shipment ${shipmentId} was not found`
    );
  }

  const driver = repository.getDriverById(driverId);

  if (!driver) {
    throw new AppError(
      404,
      'DRIVER_NOT_FOUND',
      `Driver ${driverId} was not found`
    );
  }

  let assignment = repository.getAssignmentByShipmentId(shipmentId);

  if (assignment && assignment.status !== 'REJECTED') {
    throw new AppError(
      409,
      'SHIPMENT_ALREADY_ASSIGNED',
      `Shipment ${shipmentId} is already assigned to driver ${assignment.driverId}`
    );
  }

  if (shipment.driverId && shipment.driverId !== driverId) {
    throw new AppError(
      409,
      'SHIPMENT_ALREADY_ASSIGNED',
      `Shipment ${shipmentId} is already assigned to driver ${shipment.driverId}`
    );
  }

  requireAvailableAssignmentSlot(driver, shipment);

  const occurredAt = new Date().toISOString();
  const sequence = getAssignmentSequence(driverId);

  if (assignment) {
    assignment.driverId = driverId;
    assignment.status = 'ASSIGNED';
    assignment.sequence = sequence;
    assignment.assignedAt = occurredAt;
  } else {
    assignment = repository.createAssignment({
      shipmentId,
      driverId,
      status: 'ASSIGNED',
      sequence,
      assignedAt: occurredAt
    });
  }

  shipment.driverId = driverId;
  applyDriverAssignment(driver, shipment);

  const event = repository.createAssignmentEvent({
    eventId,
    type: 'LOAD_ASSIGNED',
    shipmentId,
    driverId,
    occurredAt
  });

  return {
    created: true,
    event,
    assignment,
    shipment,
    driver
  };
}

function respondToAssignment(shipmentId, input) {
  const driverId = input && input.driverId;
  const response = input && input.response;

  if (typeof driverId !== 'string' || !driverId.trim()) {
    throw new AppError(400, 'VALIDATION_ERROR', 'driverId is required');
  }

  if (typeof response !== 'string' || !RESPONSES[response.toUpperCase()]) {
    throw new AppError(
      400,
      'INVALID_ASSIGNMENT_RESPONSE',
      'response must be ACCEPT or REJECT'
    );
  }

  const driver = repository.getDriverById(driverId);

  if (!driver) {
    throw new AppError(
      404,
      'DRIVER_NOT_FOUND',
      `Driver ${driverId} was not found`
    );
  }

  const shipment = repository.getShipmentById(shipmentId);

  if (!shipment) {
    throw new AppError(
      404,
      'SHIPMENT_NOT_FOUND',
      `Shipment ${shipmentId} was not found`
    );
  }

  const assignment = repository.getAssignmentByShipmentId(shipmentId);

  if (!assignment) {
    throw new AppError(
      404,
      'ASSIGNMENT_NOT_FOUND',
      `Assignment for shipment ${shipmentId} was not found`
    );
  }

  if (assignment.driverId !== driverId) {
    throw new AppError(
      409,
      'ASSIGNMENT_DRIVER_MISMATCH',
      `Shipment ${shipmentId} is not assigned to driver ${driverId}`
    );
  }

  if (assignment.status !== 'ASSIGNED') {
    throw new AppError(
      409,
      'ASSIGNMENT_ALREADY_RESPONDED',
      `Assignment for shipment ${shipmentId} is already ${assignment.status}`
    );
  }

  assignment.status = RESPONSES[response.toUpperCase()];

  if (assignment.status === 'REJECTED') {
    shipment.driverId = null;
    if (driver.currentShipmentId === shipmentId) {
      driver.currentShipmentId = null;
    }
    if (driver.nextShipmentId === shipmentId) {
      driver.nextShipmentId = null;
    }
    if (!driver.currentShipmentId && !driver.nextShipmentId) {
      driver.status = 'AVAILABLE';
    }
  }

  return assignment;
}

module.exports = {
  createAssignment,
  respondToAssignment
};
