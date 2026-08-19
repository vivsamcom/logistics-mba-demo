const express = require('express');
const controller = require('../controllers/demo.controller');
const routeHandler = require('../middleware/route-handler');

const router = express.Router();

router.post('/reset', routeHandler(controller.resetDemo));

module.exports = router;
