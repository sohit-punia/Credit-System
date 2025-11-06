require('dotenv').config();
const express = require('express');
const app = express();
const { connectDB } = require('./src/config/db');
const pricingRoutes = require('./src/routes/pricing');
const creditsRoutes = require('./src/routes/credits');
const usageRoutes = require('./src/routes/usage');
const logger = require('./src/utils/logger');

app.use(express.json());

connectDB()
  .then(() => logger.info('MongoDB connected'))
  .catch(err => { logger.error('DB connect error', err); process.exit(1); });

app.get('/health', (req, res) => res.send('ok'));

app.use('/api/pricing', pricingRoutes);
app.use('/api/credits', creditsRoutes);
app.use('/api/usage', usageRoutes);

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => logger.info(`Server listening on ${PORT}`));
