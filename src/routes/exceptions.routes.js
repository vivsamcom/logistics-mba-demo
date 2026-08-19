const express = require('express');
const controller = require('../controllers/exceptions.controller');
const routeHandler = require('../middleware/route-handler');

const router = express.Router();

router.get('/', routeHandler(controller.getExceptions));

module.exports = router;
