const repository = require('../repositories/mock-logistics.repository');
const AppError = require('../utils/app-error');

function requireShipment(shipmentId) {
  const shipment = repository.getShipmentById(shipmentId);

  if (!shipment) {
    throw new AppError(
      404,
      'SHIPMENT_NOT_FOUND',
      `Shipment ${shipmentId} was not found`
    );
  }

  return shipment;
}

function getShipmentDetails(shipmentId) {
  const shipment = requireShipment(shipmentId);
  const driver = shipment.driverId
    ? repository.getDriverById(shipment.driverId) || null
    : null;
  const assignment =
    repository.getAssignmentByShipmentId(shipment.shipmentId) || null;
  const exceptions = repository
    .getExceptions()
    .filter((item) => item.shipmentId === shipment.shipmentId);

  return {
    ...shipment,
    driver,
    assignment,
    exceptions
  };
}

function getTodaysSummary() {
  const allShipments = repository.getShipments();
  const operatingDate = allShipments[0]
    ? allShipments[0].serviceDate
    : null;
  const shipments = allShipments.filter(
    (shipment) => shipment.serviceDate === operatingDate
  );
  const shipmentIds = new Set(
    shipments.map((shipment) => shipment.shipmentId)
  );
  const activeExceptions = repository
    .getExceptions()
    .filter(
      (exception) =>
        exception.status === 'ACTIVE' &&
        shipmentIds.has(exception.shipmentId)
    ).length;

  return {
    operatingDate,
    total: shipments.length,
    scheduled: shipments.filter(
      (shipment) => shipment.status === 'SCHEDULED'
    ).length,
    inTransit: shipments.filter(
      (shipment) => shipment.status === 'IN_TRANSIT'
    ).length,
    delayed: shipments.filter(
      (shipment) => shipment.status === 'DELAYED'
    ).length,
    activeExceptions
  };
}

function getDelayedShipments() {
  return repository
    .getShipments()
    .filter((shipment) => shipment.status === 'DELAYED')
    .map((shipment) => getShipmentDetails(shipment.shipmentId));
}

function getShipmentExceptions(shipmentId) {
  requireShipment(shipmentId);

  return repository
    .getExceptions()
    .filter((exception) => exception.shipmentId === shipmentId);
}

function getActiveDelayMinutes(shipmentId) {
  return repository
    .getExceptions()
    .filter(
      (exception) =>
        exception.shipmentId === shipmentId &&
        exception.status === 'ACTIVE'
    )
    .reduce(
      (total, exception) => total + (exception.delayMinutes || 0),
      0
    );
}

function getShipmentImpact(shipmentId) {
  requireShipment(shipmentId);
  const directDelayMinutes = getActiveDelayMinutes(shipmentId);

  if (directDelayMinutes > 0) {
    return {
      shipmentId,
      impacted: true,
      risk: directDelayMinutes >= 60 ? 'HIGH' : 'MEDIUM',
      sourceShipmentId: shipmentId,
      delayMinutes: directDelayMinutes,
      reason: `This shipment has an active ${directDelayMinutes}-minute delay`
    };
  }

  const assignment = repository.getAssignmentByShipmentId(shipmentId);

  if (!assignment || !assignment.driverId) {
    return {
      shipmentId,
      impacted: false,
      risk: 'NONE',
      sourceShipmentId: null,
      reason: 'No driver is currently assigned to this shipment'
    };
  }

  const previousAssignment = repository
    .getAssignments()
    .filter(
      (candidate) =>
        candidate.driverId === assignment.driverId &&
        candidate.sequence < assignment.sequence &&
        candidate.status !== 'REJECTED'
    )
    .sort((left, right) => right.sequence - left.sequence)[0];

  if (!previousAssignment) {
    return {
      shipmentId,
      impacted: false,
      risk: 'NONE',
      sourceShipmentId: null,
      reason: 'The assigned driver has no earlier active demo assignment'
    };
  }

  const delayMinutes = getActiveDelayMinutes(
    previousAssignment.shipmentId
  );
  const impacted = delayMinutes > 0;

  return {
    shipmentId,
    impacted,
    risk: impacted ? (delayMinutes >= 60 ? 'HIGH' : 'MEDIUM') : 'NONE',
    sourceShipmentId: previousAssignment.shipmentId,
    delayMinutes,
    reason: impacted
      ? `The driver's earlier assignment has an active ${delayMinutes}-minute delay`
      : 'The driver has no active delay on the earlier assignment'
  };
}

function timeToMinutes(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(value || '');

  if (!match) {
    return null;
  }

  return Number(match[1]) * 60 + Number(match[2]);
}

function getAvailableDrivers(shipmentId) {
  const shipment = requireShipment(shipmentId);
  const pickupMinutes = timeToMinutes(shipment.pickupTime);

  return repository
    .getDrivers()
    .filter((driver) => {
      if (driver.status !== 'AVAILABLE') {
        return false;
      }

      const availableMinutes = timeToMinutes(driver.availableFrom);
      return (
        pickupMinutes !== null &&
        availableMinutes !== null &&
        availableMinutes <= pickupMinutes
      );
    })
    .map((driver) => ({
      driverId: driver.driverId,
      name: driver.name,
      status: driver.status,
      availableFrom: driver.availableFrom
    }));
}

function reassignShipment(shipmentId, input) {
  const shipment = requireShipment(shipmentId);
  const newDriverId = input && input.newDriverId;

  if (typeof newDriverId !== 'string' || !newDriverId.trim()) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'newDriverId is required'
    );
  }

  const newDriver = repository.getDriverById(newDriverId);

  if (!newDriver) {
    throw new AppError(
      404,
      'DRIVER_NOT_FOUND',
      `Driver ${newDriverId} was not found`
    );
  }

  const isAvailable = getAvailableDrivers(shipmentId).some(
    (driver) => driver.driverId === newDriverId
  );

  if (!isAvailable) {
    throw new AppError(
      409,
      'DRIVER_NOT_AVAILABLE',
      `Driver ${newDriverId} is not available for shipment ${shipmentId}`
    );
  }

  const previousDriverId = shipment.driverId;
  const previousDriver = previousDriverId
    ? repository.getDriverById(previousDriverId)
    : null;
  let assignment = repository.getAssignmentByShipmentId(shipmentId);

  if (!assignment) {
    assignment = repository.createAssignment({
      shipmentId,
      driverId: newDriverId,
      status: 'ASSIGNED',
      sequence: 1
    });
  } else {
    assignment.driverId = newDriverId;
    assignment.status = 'ASSIGNED';
  }

  shipment.driverId = newDriverId;

  if (previousDriver) {
    if (previousDriver.currentShipmentId === shipmentId) {
      previousDriver.currentShipmentId = null;
    }
    if (previousDriver.nextShipmentId === shipmentId) {
      previousDriver.nextShipmentId = null;
    }
    if (
      previousDriver.status === 'ASSIGNED' &&
      !previousDriver.currentShipmentId &&
      !previousDriver.nextShipmentId
    ) {
      previousDriver.status = 'AVAILABLE';
    }
  }

  if (shipment.status === 'IN_TRANSIT' || shipment.status === 'DELAYED') {
    newDriver.currentShipmentId = shipmentId;
    newDriver.status = 'ON_TRIP';
  } else {
    newDriver.nextShipmentId = shipmentId;
    newDriver.status = 'ASSIGNED';
  }

  return {
    ...assignment,
    previousDriverId
  };
}

module.exports = {
  requireShipment,
  getShipmentDetails,
  getTodaysSummary,
  getDelayedShipments,
  getShipmentExceptions,
  getShipmentImpact,
  getAvailableDrivers,
  reassignShipment
};
