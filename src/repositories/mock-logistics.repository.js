const seedDrivers = require('../data/seed/drivers.json');
const seedShipments = require('../data/seed/shipments.json');
const seedAssignments = require('../data/seed/assignments.json');
const seedExceptions = require('../data/seed/exceptions.json');

// Mutable demo store that can later be replaced by a platform adapter.

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

let state;
let nextExceptionNumber;
let operatingDate;

function getSystemDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function synchronizeShipmentDates() {
  const systemDate = getSystemDate();

  if (operatingDate === systemDate) {
    return;
  }

  state.shipments.forEach((shipment) => {
    shipment.serviceDate = systemDate;
  });
  operatingDate = systemDate;
}

function reset() {
  state = {
    drivers: clone(seedDrivers),
    shipments: clone(seedShipments),
    assignments: clone(seedAssignments),
    exceptions: clone(seedExceptions),
    assignmentEvents: []
  };
  operatingDate = null;
  synchronizeShipmentDates();

  nextExceptionNumber =
    state.exceptions.reduce((highest, exception) => {
      const match = /^EX-(\d+)$/.exec(exception.exceptionId);
      return match ? Math.max(highest, Number(match[1])) : highest;
    }, 0) + 1;
}

function getDrivers() {
  return state.drivers;
}

function getDriverById(driverId) {
  return state.drivers.find((driver) => driver.driverId === driverId);
}

function getShipments() {
  synchronizeShipmentDates();
  return state.shipments;
}

function getShipmentById(shipmentId) {
  synchronizeShipmentDates();
  return state.shipments.find(
    (shipment) => shipment.shipmentId === shipmentId
  );
}

function getAssignments() {
  return state.assignments;
}

function getAssignmentByShipmentId(shipmentId) {
  return state.assignments.find(
    (assignment) => assignment.shipmentId === shipmentId
  );
}

function createAssignment(assignment) {
  state.assignments.push(assignment);
  return assignment;
}

function getAssignmentEventById(eventId) {
  return state.assignmentEvents.find(
    (event) => event.eventId === eventId
  );
}

function createAssignmentEvent(event) {
  state.assignmentEvents.push(event);
  return event;
}

function getExceptions() {
  return state.exceptions;
}

function createException(exception) {
  const storedException = {
    exceptionId: `EX-${String(nextExceptionNumber).padStart(3, '0')}`,
    ...exception
  };

  nextExceptionNumber += 1;
  state.exceptions.push(storedException);
  return storedException;
}

reset();

module.exports = {
  reset,
  getDrivers,
  getDriverById,
  getShipments,
  getShipmentById,
  getAssignments,
  getAssignmentByShipmentId,
  createAssignment,
  getAssignmentEventById,
  createAssignmentEvent,
  getExceptions,
  createException
};
