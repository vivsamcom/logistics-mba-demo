const repository = require('../repositories/mock-tms.repository');

function resetDemo() {
  repository.reset();

  return {
    status: 'RESET',
    message: 'Demo TMS data restored successfully'
  };
}

module.exports = {
  resetDemo
};
