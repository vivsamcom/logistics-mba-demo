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

function requireNotificationText(value, fieldName) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AppError(
      422,
      'ASSIGNMENT_NOTIFICATION_DATA_INCOMPLETE',
      `${fieldName} is required to build the load assignment notification`
    );
  }

  return value.trim();
}

function formatNotificationDateTime(
  dateValue,
  timeValue,
  dateFieldName,
  timeFieldName
) {
  const dateText = requireNotificationText(dateValue, dateFieldName);
  const timeText = requireNotificationText(timeValue, timeFieldName);
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateText);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(timeText);

  if (!dateMatch || !timeMatch) {
    throw new AppError(
      422,
      'ASSIGNMENT_NOTIFICATION_DATA_INCOMPLETE',
      `${dateFieldName} and ${timeFieldName} must use YYYY-MM-DD and HH:mm formats`
    );
  }

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59
  ) {
    throw new AppError(
      422,
      'ASSIGNMENT_NOTIFICATION_DATA_INCOMPLETE',
      `${dateFieldName} or ${timeFieldName} is not a valid date or time`
    );
  }

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
  const displayHour = hour % 12 || 12;

  return `${day} ${months[month - 1]}, ${displayHour}:${String(minute).padStart(2, '0')} ${period}`;
}

function buildAssignmentNotification(shipment, driver) {
  const shipmentId = requireNotificationText(
    shipment && shipment.shipmentId,
    'shipment.shipmentId'
  );
  const pickupLocation = requireNotificationText(
    shipment && shipment.pickupLocation,
    'shipment.pickupLocation'
  );
  const deliveryLocation = requireNotificationText(
    shipment && shipment.deliveryLocation,
    'shipment.deliveryLocation'
  );
  const pickupDateTime = formatNotificationDateTime(
    shipment && shipment.serviceDate,
    shipment && shipment.pickupTime,
    'shipment.serviceDate',
    'shipment.pickupTime'
  );
  const expectedDeliveryDateTime = formatNotificationDateTime(
    shipment && shipment.expectedDeliveryDate,
    shipment && shipment.eta,
    'shipment.expectedDeliveryDate',
    'shipment.eta'
  );
  const recipientPhone = requireNotificationText(
    driver && driver.phone,
    'driver.phone'
  );

  return {
    channel: 'WHATSAPP',
    recipient: {
      driverId: driver.driverId,
      phone: recipientPhone
    },
    template: {
      name: 'new_load_assignment_v1',
      category: 'UTILITY',
      language: 'en_US',
      bodyParameters: [
        { position: 1, name: 'shipment', value: shipmentId },
        { position: 2, name: 'pickup', value: pickupLocation },
        { position: 3, name: 'delivery', value: deliveryLocation },
        {
          position: 4,
          name: 'pickupDateTime',
          value: pickupDateTime
        },
        {
          position: 5,
          name: 'expectedDeliveryDateTime',
          value: expectedDeliveryDateTime
        }
      ],
      buttons: [
        {
          index: 0,
          type: 'QUICK_REPLY',
          text: 'Accept',
          action: 'ACCEPT',
          payload: `ASSIGNMENT:ACCEPT:${shipmentId}:${driver.driverId}`
        },
        {
          index: 1,
          type: 'QUICK_REPLY',
          text: 'Reject',
          action: 'REJECT',
          payload: `ASSIGNMENT:REJECT:${shipmentId}:${driver.driverId}`
        }
      ]
    }
  };
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
  const shipment = repository.getShipmentById(event.shipmentId);
  const driver = repository.getDriverById(event.driverId);

  return {
    created,
    event,
    assignment: repository.getAssignmentByShipmentId(event.shipmentId),
    shipment,
    driver,
    notification: buildAssignmentNotification(shipment, driver)
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

  // Validate every value needed by the future outbound adapter before
  // mutating assignment state.
  const notification = buildAssignmentNotification(shipment, driver);

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
    driver,
    notification
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
