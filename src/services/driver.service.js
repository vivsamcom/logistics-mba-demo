const repository = require('../repositories/mock-logistics.repository');
const AppError = require('../utils/app-error');

function requireDriver(driverId) {
  const driver = repository.getDriverById(driverId);

  if (!driver) {
    throw new AppError(
      404,
      'DRIVER_NOT_FOUND',
      `Driver ${driverId} was not found`
    );
  }

  return driver;
}

function getCurrentTrip(driverId) {
  const driver = requireDriver(driverId);
  const shipment = driver.currentShipmentId
    ? repository.getShipmentById(driver.currentShipmentId) || null
    : null;
  const assignment = shipment
    ? repository.getAssignmentByShipmentId(shipment.shipmentId) || null
    : null;

  return {
    driver,
    assignment,
    shipment
  };
}

function getDriverAssignments(driverId) {
  requireDriver(driverId);

  return repository
    .getAssignments()
    .filter((assignment) => assignment.driverId === driverId)
    .sort((left, right) => left.sequence - right.sequence)
    .map((assignment) => ({
      ...assignment,
      shipment:
        repository.getShipmentById(assignment.shipmentId) || null
    }));
}

module.exports = {
  requireDriver,
  getCurrentTrip,
  getDriverAssignments
};
