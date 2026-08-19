const express = require('express');
const controller = require('../controllers/shipments.controller');
const exceptionController = require('../controllers/exceptions.controller');
const routeHandler = require('../middleware/route-handler');

const router = express.Router();

router.get('/today', routeHandler(controller.getTodaysSummary));
router.get('/delayed', routeHandler(controller.getDelayedShipments));
router.get(
  '/:shipmentId/exceptions',
  routeHandler(controller.getShipmentExceptions)
);
router.post(
  '/:shipmentId/exceptions',
  routeHandler(exceptionController.reportException)
);
router.get(
  '/:shipmentId/impact',
  routeHandler(controller.getShipmentImpact)
);
router.get(
  '/:shipmentId/available-drivers',
  routeHandler(controller.getAvailableDrivers)
);
router.post(
  '/:shipmentId/reassign',
  routeHandler(controller.reassignShipment)
);
router.get('/:shipmentId', routeHandler(controller.getShipment));

module.exports = router;
