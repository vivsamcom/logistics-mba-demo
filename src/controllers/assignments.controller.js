const assignmentService = require('../services/assignment.service');

function respondToAssignment(req, res) {
  return res.json({
    data: assignmentService.respondToAssignment(
      req.params.shipmentId,
      req.body
    )
  });
}

module.exports = {
  respondToAssignment
};
