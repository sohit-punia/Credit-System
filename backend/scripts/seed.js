require('dotenv').config();
const mongoose = require('mongoose');
const { connectDB } = require('../src/config/db');
const seedPricing = require('../src/seed/seedPricing');
const User = require('../src/models/User');

async function run() {
  try {
    await connectDB();
    await seedPricing();

    const testId = new mongoose.Types.ObjectId();
    await User.create({ _id: testId, name: 'Dev User', creditsBalance: 200 });
    console.log('Created test user id:', testId.toString());
    process.exit(0);
  } catch (err) {
    console.error('Seed error:', err);
    process.exit(1);
  }
}

run();
