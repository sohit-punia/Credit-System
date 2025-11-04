const mongoose = require('mongoose');
const Schema = mongoose.Schema;


const ToolPricingSchema = new Schema({
toolId: { type: String, required: true, unique: true },
base: { type: Number, default: 0 },
addons: { type: Schema.Types.Mixed, default: {} },
perPage: { type: Number, default: 0 },
createdAt: { type: Date, default: Date.now }
});


module.exports = mongoose.model('ToolPricing', ToolPricingSchema);