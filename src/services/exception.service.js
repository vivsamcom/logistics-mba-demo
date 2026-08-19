const repository = require('../repositories/mock-tms.repository');
const AppError = require('../utils/app-error');
const { requireShipment } = require('./shipment.service');
const { requireDriver } = require('./driver.service');

function addMinutesToTime(value, minutesToAdd) {
  const match = /^(\d{2}):(\d{2})$/.exec(value || '');

  if (!match) {
    return value;
  }

  const minutesInDay = 24 * 60;
  const currentMinutes = Number(match[1]) * 60 + Number(match[2]);
  const updatedMinutes = (currentMinutes + minutesToAdd) % minutesInDay;
  const hours = Math.floor(updatedMinutes / 60);
  const minutes = updatedMinutes % 60;

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function getExceptions(status = 'ACTIVE') {
  if (typeof status !== 'string') {
    throw new AppError(
      400,
      'INVALID_EXCEPTION_STATUS',
      'status must be ACTIVE or RESOLVED'
    );
  }

  const normalizedStatus = status.toUpperCase();

  if (!['ACTIVE', 'RESOLVED'].includes(normalizedStatus)) {
    throw new AppError(
      400,
      'INVALID_EXCEPTION_STATUS',
      'status must be ACTIVE or RESOLVED'
    );
  }

  return repository
    .getExceptions()
    .filter((exception) => exception.status === normalizedStatus);
}

function reportException(shipmentId, input) {
  const shipment = requireShipment(shipmentId);
  const driverId = input && input.driverId;
  const type = input && input.type;
  const delayMinutes = input && input.delayMinutes;

  if (typeof driverId !== 'string' || !driverId.trim()) {
    throw new AppError(400, 'VALIDATION_ERROR', 'driverId is required');
  }

  const driver = requireDriver(driverId);

  if (typeof type !== 'string' || !type.trim()) {
    throw new AppError(400, 'VALIDATION_ERROR', 'type is required');
  }

  if (
    typeof delayMinutes !== 'number' ||
    !Number.isInteger(delayMinutes) ||
    delayMinutes < 0
  ) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'delayMinutes must be a non-negative integer'
    );
  }

  if (shipment.driverId !== driver.driverId) {
    throw new AppError(
      409,
      'DRIVER_NOT_ASSIGNED',
      `Driver ${driverId} is not assigned to shipment ${shipmentId}`
    );
  }

  const exception = repository.createException({
    shipmentId,
    driverId,
    type: type.trim().toUpperCase(),
    reason:
      typeof input.reason === 'string' && input.reason.trim()
        ? input.reason.trim()
        : null,
    location:
      typeof input.location === 'string' && input.location.trim()
        ? input.location.trim()
        : null,
    delayMinutes,
    status: 'ACTIVE'
  });

  if (delayMinutes > 0) {
    const totalActiveDelay = repository
      .getExceptions()
      .filter(
        (item) =>
          item.shipmentId === shipmentId && item.status === 'ACTIVE'
      )
      .reduce((total, item) => total + item.delayMinutes, 0);

    shipment.status = 'DELAYED';
    shipment.delayMinutes = totalActiveDelay;
    shipment.eta = addMinutesToTime(
      shipment.originalEta || shipment.eta,
      totalActiveDelay
    );
  }

  return {
    exception,
    shipment: {
      shipmentId: shipment.shipmentId,
      status: shipment.status,
      eta: shipment.eta,
      delayMinutes: shipment.delayMinutes
    }
  };
}

module.exports = {
  getExceptions,
  reportException
};
