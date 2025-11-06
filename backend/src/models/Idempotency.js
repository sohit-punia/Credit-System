const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const IdempotencySchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  key: { type: String, required: true },
  operation: { type: String },
  response: { type: Schema.Types.Mixed },
  createdAt: { type: Date, default: Date.now }
});

IdempotencySchema.index({ userId: 1, key: 1 }, { unique: true });

module.exports = mongoose.model('Idempotency', IdempotencySchema);
