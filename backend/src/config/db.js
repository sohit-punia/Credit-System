const mongoose = require('mongoose');


async function connectDB() {
const uri = process.env.MONGO_URI;
if (!uri) throw new Error('MONGO_URI missing in env');
await mongoose.connect(uri, { dbName: 'creditsdb' });
}


module.exports = { connectDB };