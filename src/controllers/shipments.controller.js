const shipmentService = require('../services/shipment.service');

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

function reassignShipment(req, res) {
  return res.json({
    data: shipmentService.reassignShipment(
      req.params.shipmentId,
      req.body
    )
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
