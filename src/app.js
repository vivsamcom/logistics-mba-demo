const express = require('express');
const webhookRoutes = require('./routes/webhook.routes');
const shipmentRoutes = require('./routes/shipments.routes');
const driverRoutes = require('./routes/drivers.routes');
const assignmentRoutes = require('./routes/assignments.routes');
const exceptionRoutes = require('./routes/exceptions.routes');
const demoRoutes = require('./routes/demo.routes');
const meRoutes = require('./routes/me.routes');
const dispatcherRoutes = require('./routes/dispatcher.routes');
const errorHandler = require('./middleware/error-handler');

const app = express();

app.disable('x-powered-by');

app.use(
  express.json({
    limit: '1mb',
    verify: (req, res, buffer) => {
      // Keep the exact bytes received. Meta signs these bytes, not a
      // re-serialized version of req.body.
      req.rawBody = Buffer.from(buffer);
    }
  })
);

app.get('/health', (req, res) => {
  res.json({
    status: 'UP',
    service: 'logistics-mba-demo'
  });
});

app.use('/webhook', webhookRoutes);
app.use('/api/shipments', shipmentRoutes);
app.use('/api/drivers', driverRoutes);
app.use('/api/assignments', assignmentRoutes);
app.use('/api/exceptions', exceptionRoutes);
app.use('/api/demo', demoRoutes);
app.use('/api/me', meRoutes);
app.use('/api/dispatcher', dispatcherRoutes);

app.use(errorHandler);

module.exports = app;
