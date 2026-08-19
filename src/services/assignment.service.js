const repository = require('../repositories/mock-tms.repository');
const AppError = require('../utils/app-error');

const RESPONSES = {
  ACCEPT: 'ACCEPTED',
  REJECT: 'REJECTED'
};

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
  respondToAssignment
};
