const express = require('express');
const controller = require('../controllers/assignments.controller');
const routeHandler = require('../middleware/route-handler');

const router = express.Router();

router.post(
  '/:shipmentId/respond',
  routeHandler(controller.respondToAssignment)
);

module.exports = router;
