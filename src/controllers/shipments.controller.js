const shipmentService = require('../services/shipment.service');
const whatsappService = require('../services/whatsapp.service');

function getTodaysSummary(req, res) {
  return res.json({
    data: shipmentService.getTodaysSummary()
  });
}

function getDelayedShipments(req, res) {
  const data = shipmentService.getDelayedShipments();

  return res.json({ data, count: data.length });
}

function getShipment(req, res) {
  return res.json({
    data: shipmentService.getShipmentDetails(req.params.shipmentId)
  });
}

function getShipmentExceptions(req, res) {
  const data = shipmentService.getShipmentExceptions(req.params.shipmentId);

  return res.json({ data, count: data.length });
}

function getShipmentImpact(req, res) {
  return res.json({
    data: shipmentService.getShipmentImpact(req.params.shipmentId)
  });
}

function getAvailableDrivers(req, res) {
  const data = shipmentService.getAvailableDrivers(req.params.shipmentId);

  return res.json({ data, count: data.length });
}

async function reassignShipment(req, res) {
  const result = shipmentService.reassignShipment(
    req.params.shipmentId,
    req.body
  );
  const notificationDelivery =
    await whatsappService.sendAssignmentNotification(result.notification, {
      requestId: req.get('Rndr-Id') || req.get('X-Request-Id') || null,
      shipmentId: result.shipmentId,
      driverId: result.driverId
    });

  return res.json({
    data: {
      ...result,
      notificationDelivery
    }
  });
}

module.exports = {
  getTodaysSummary,
  getDelayedShipments,
  getShipment,
  getShipmentExceptions,
  getShipmentImpact,
  getAvailableDrivers,
  reassignShipment
};
