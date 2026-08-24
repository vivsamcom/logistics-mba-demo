const driverService = require('../services/driver.service');
const assignmentService = require('../services/assignment.service');
const exceptionService = require('../services/exception.service');

function getPersona(req, res) {
  const { role, entityId, name } = req.persona;

  return res.json({
    data: { role, entityId, name }
  });
}

function getCurrentTrip(req, res) {
  return res.json({
    data: driverService.getCurrentTrip(req.persona.entityId)
  });
}

function getAssignments(req, res) {
  const data = driverService.getDriverAssignments(req.persona.entityId);

  return res.json({ data, count: data.length });
}

function respondToAssignment(req, res) {
  return res.json({
    data: assignmentService.respondToAssignment(req.params.shipmentId, {
      driverId: req.persona.entityId,
      response: req.body && req.body.response
    })
  });
}

function reportException(req, res) {
  const input = req.body || {};

  return res.status(201).json({
    data: exceptionService.reportException(req.params.shipmentId, {
      driverId: req.persona.entityId,
      type: input.type,
      reason: input.reason,
      location: input.location,
      delayMinutes: input.delayMinutes
    })
  });
}

module.exports = {
  getPersona,
  getCurrentTrip,
  getAssignments,
  respondToAssignment,
  reportException
};
