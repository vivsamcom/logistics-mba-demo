const driverService = require('../services/driver.service');

function getCurrentTrip(req, res) {
  return res.json({
    data: driverService.getCurrentTrip(req.params.driverId)
  });
}

function getAssignments(req, res) {
  const data = driverService.getDriverAssignments(req.params.driverId);

  return res.json({ data, count: data.length });
}

module.exports = {
  getCurrentTrip,
  getAssignments
};
