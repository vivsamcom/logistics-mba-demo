const assignmentService = require('../services/assignment.service');
const whatsappService = require('../services/whatsapp.service');

async function createAssignment(req, res) {
  const result = assignmentService.createAssignment(req.body);
  const previousDelivery = result.event.notificationDelivery;
  let notificationDelivery = previousDelivery;

  if (
    !previousDelivery ||
    previousDelivery.status === 'FAILED'
  ) {
    notificationDelivery =
      await whatsappService.sendAssignmentNotification(result.notification, {
        requestId: req.get('Rndr-Id') || req.get('X-Request-Id') || null,
        eventId: result.event.eventId,
        shipmentId: result.event.shipmentId,
        driverId: result.event.driverId
      });

    // Persist accepted/failed attempts on the in-memory idempotency event.
    // A later retry can retry failures and avoid duplicating accepted sends.
    if (notificationDelivery.status !== 'SKIPPED') {
      result.event.notificationDelivery = notificationDelivery;
    }
  }

  return res.status(result.created ? 201 : 200).json({
    data: {
      idempotent: !result.created,
      event: result.event,
      assignment: result.assignment,
      shipment: result.shipment,
      driver: result.driver,
      notification: result.notification,
      notificationDelivery
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
