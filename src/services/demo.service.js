const repository = require('../repositories/mock-logistics.repository');

function resetDemo() {
  repository.reset();

  return {
    status: 'RESET',
    message: 'Demo logistics data restored successfully'
  };
}

module.exports = {
  resetDemo
};
