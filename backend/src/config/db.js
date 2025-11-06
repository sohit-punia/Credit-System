const mongoose = require('mongoose');

async function connectDB() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI missing in env');
  // dbName optional - mongoose will parse from URI, but we set here for clarity
  await mongoose.connect(uri, { dbName: 'creditsdb' });
}

module.exports = { connectDB };
