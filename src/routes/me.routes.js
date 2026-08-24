const express = require('express');
const controller = require('../controllers/me.controller');
const personaContext = require('../middleware/persona-context');
const requireRole = require('../middleware/require-role');
const routeHandler = require('../middleware/route-handler');

const router = express.Router();

router.use(personaContext);

router.get('/persona', routeHandler(controller.getPersona));
router.get(
  '/current-trip',
  requireRole('DRIVER'),
  routeHandler(controller.getCurrentTrip)
);
router.get(
  '/assignments',
  requireRole('DRIVER'),
  routeHandler(controller.getAssignments)
);
router.post(
  '/assignments/:shipmentId/respond',
  requireRole('DRIVER'),
  routeHandler(controller.respondToAssignment)
);
router.post(
  '/shipments/:shipmentId/exceptions',
  requireRole('DRIVER'),
  routeHandler(controller.reportException)
);

module.exports = router;
