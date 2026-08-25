const express = require('express');
const controller = require('../controllers/dispatcher.controller');
const personaContext = require('../middleware/persona-context');
const requireRole = require('../middleware/require-role');
const routeHandler = require('../middleware/route-handler');

const router = express.Router();

router.use(personaContext, requireRole('DISPATCHER'));

router.get(
  '/shipments/today',
  routeHandler(controller.getTodaysSummary)
);
router.get(
  '/shipments/delayed',
  routeHandler(controller.getDelayedShipments)
);
router.get('/shipments', routeHandler(controller.getShipments));
router.get('/exceptions', routeHandler(controller.getExceptions));
router.get(
  '/shipments/:shipmentId/impact',
  routeHandler(controller.getShipmentImpact)
);
router.get(
  '/shipments/:shipmentId/available-drivers',
  routeHandler(controller.getAvailableDrivers)
);
router.post(
  '/shipments/:shipmentId/reassign',
  routeHandler(controller.reassignShipment)
);
router.get(
  '/shipments/:shipmentId',
  routeHandler(controller.getShipment)
);

module.exports = router;
