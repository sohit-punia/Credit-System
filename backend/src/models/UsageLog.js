const mongoose = require('mongoose');
const Schema = mongoose.Schema;


const UsageLogSchema = new Schema({
userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
pluginRequestId: { type: String, required: true },
idempotencyKey: { type: String },
toolId: { type: String, required: true },
status: { type: String, enum: ['started','completed','cancelled'], default: 'started' },
estimate: { type: Number, default: 0 },
actualCost: { type: Number, default: null },
meta: { type: Schema.Types.Mixed, default: {} },
holdTxId: { type: Schema.Types.ObjectId, ref: 'CreditTransaction' },
createdAt: { type: Date, default: Date.now },
startedAt: { type: Date, default: Date.now },
completedAt: { type: Date }
});


UsageLogSchema.index({ userId:1, idempotencyKey:1 }, { unique: true, sparse: true });


module.exports = mongoose.model('UsageLog', UsageLogSchema);