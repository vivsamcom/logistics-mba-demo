const test = require('node:test');
const assert = require('node:assert/strict');

const {
  formatDelayDuration
} = require('../src/services/exception.service');

test('formats exception delays without losing minute precision', () => {
  const cases = [
    [0, '0 minutes'],
    [1, '1 minute'],
    [59, '59 minutes'],
    [60, '1 hour'],
    [61, '1 hour 1 minute'],
    [90, '1 hour 30 minutes'],
    [120, '2 hours'],
    [1439, '23 hours 59 minutes'],
    [1440, '1 day'],
    [1530, '1 day 1 hour 30 minutes']
  ];

  for (const [minutes, expected] of cases) {
    assert.equal(formatDelayDuration(minutes), expected);
  }
});
