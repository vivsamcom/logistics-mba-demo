const express = require('express');
const controller = require('../controllers/drivers.controller');
const routeHandler = require('../middleware/route-handler');

const router = express.Router();

router.get(
  '/:driverId/current-trip',
  routeHandler(controller.getCurrentTrip)
);
router.get(
  '/:driverId/assignments',
  routeHandler(controller.getAssignments)
);

module.exports = router;
