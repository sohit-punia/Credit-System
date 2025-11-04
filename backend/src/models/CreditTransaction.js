const mongoose = require('mongoose');
const Schema = mongoose.Schema;


const CreditTransactionSchema = new Schema({
userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
amount: { type: Number, required: true }, // positive = grant, negative = consume
type: { type: String, required: true },
meta: { type: Schema.Types.Mixed, default: {} },
idempotencyKey: { type: String },
createdAt: { type: Date, default: Date.now }
});


CreditTransactionSchema.index({ userId: 1, idempotencyKey: 1 }, { unique: true, sparse: true });


module.exports = mongoose.model('CreditTransaction', CreditTransactionSchema);