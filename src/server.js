require('./config/env');

const app = require('./app');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`by-tms-mba-demo listening on port ${PORT}`);
});
