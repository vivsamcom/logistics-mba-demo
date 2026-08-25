const repository = require('../repositories/mock-logistics.repository');
const {
  getWhatsAppExceptionHeaderImageUrl
} = require('../config/env');
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

function formatExceptionType(value) {
  const words = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ');

  return words ? `${words[0].toUpperCase()}${words.slice(1)}` : 'Exception';
}

function formatDurationPart(value, unit) {
  return `${value} ${unit}${value === 1 ? '' : 's'}`;
}

function formatDelayDuration(value) {
  const totalMinutes = Number(value);

  if (!Number.isInteger(totalMinutes) || totalMinutes < 0) {
    throw new AppError(
      422,
      'EXCEPTION_NOTIFICATION_DATA_INCOMPLETE',
      'exception.delayMinutes must be a non-negative integer'
    );
  }

  if (totalMinutes < 60) {
    return formatDurationPart(totalMinutes, 'minute');
  }

  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  const parts = [];

  if (days > 0) {
    parts.push(formatDurationPart(days, 'day'));
  }
  if (hours > 0) {
    parts.push(formatDurationPart(hours, 'hour'));
  }
  if (minutes > 0) {
    parts.push(formatDurationPart(minutes, 'minute'));
  }

  return parts.join(' ');
}

function buildExceptionNotification(exception, assignedDriver) {
  const dispatcher = repository
    .getUsers()
    .find((user) => user.role === 'DISPATCHER');

  if (!dispatcher || !dispatcher.entityId || !dispatcher.whatsappPhone) {
    throw new AppError(
      422,
      'EXCEPTION_NOTIFICATION_DATA_INCOMPLETE',
      'A Dispatcher WhatsApp persona is required to send exception alerts'
    );
  }

  const driver =
    assignedDriver || repository.getDriverById(exception.driverId);

  if (!driver || typeof driver.name !== 'string' || !driver.name.trim()) {
    throw new AppError(
      422,
      'EXCEPTION_NOTIFICATION_DATA_INCOMPLETE',
      'The assigned driver name is required to send exception alerts'
    );
  }

  return {
    channel: 'WHATSAPP',
    recipient: {
      dispatcherId: dispatcher.entityId,
      phone: dispatcher.whatsappPhone
    },
    template: {
      name: 'shipment_exception_alert_v1',
      category: 'UTILITY',
      language: 'en_US',
      header: {
        format: 'IMAGE',
        image: {
          link: getWhatsAppExceptionHeaderImageUrl()
        }
      },
      bodyParameters: [
        {
          position: 1,
          name: 'shipment',
          value: exception.shipmentId
        },
        {
          position: 2,
          name: 'driver',
          value: `${exception.driverId} - ${driver.name.trim()}`
        },
        {
          position: 3,
          name: 'exceptionType',
          value: formatExceptionType(exception.type)
        },
        {
          position: 4,
          name: 'location',
          value: exception.location || 'Not provided'
        },
        {
          position: 5,
          name: 'delay',
          value: formatDelayDuration(exception.delayMinutes)
        }
      ]
    }
  };
}

function reportException(shipmentId, input, options = {}) {
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

  const exceptionData = {
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
  };
  const notification = options.includeNotification
    ? buildExceptionNotification(exceptionData, driver)
    : null;
  const exception = repository.createException(exceptionData);

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

  const result = {
    exception,
    shipment: {
      shipmentId: shipment.shipmentId,
      status: shipment.status,
      eta: shipment.eta,
      delayMinutes: shipment.delayMinutes
    }
  };

  if (notification) {
    result.notification = notification;
  }

  return result;
}

module.exports = {
  buildExceptionNotification,
  formatDelayDuration,
  getExceptions,
  reportException
};
