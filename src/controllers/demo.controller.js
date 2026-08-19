const demoService = require('../services/demo.service');

function resetDemo(req, res) {
  return res.json({
    data: demoService.resetDemo()
  });
}

module.exports = {
  resetDemo
};
