const exceptionService = require('../services/exception.service');

function getExceptions(req, res) {
  const data = exceptionService.getExceptions(req.query.status || 'ACTIVE');

  return res.json({ data, count: data.length });
}

function reportException(req, res) {
  return res.status(201).json({
    data: exceptionService.reportException(
      req.params.shipmentId,
      req.body
    )
  });
}

module.exports = {
  getExceptions,
  reportException
};
