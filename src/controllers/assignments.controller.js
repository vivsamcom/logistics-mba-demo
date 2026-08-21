const assignmentService = require('../services/assignment.service');

function createAssignment(req, res) {
  const result = assignmentService.createAssignment(req.body);

  return res.status(result.created ? 201 : 200).json({
    data: {
      idempotent: !result.created,
      event: result.event,
      assignment: result.assignment,
      shipment: result.shipment,
      driver: result.driver,
      notification: result.notification
    }
  });
}

function respondToAssignment(req, res) {
  return res.json({
    data: assignmentService.respondToAssignment(
      req.params.shipmentId,
      req.body
    )
  });
}

module.exports = {
  createAssignment,
  respondToAssignment
};
