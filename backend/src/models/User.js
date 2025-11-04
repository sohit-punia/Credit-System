const mongoose = require('mongoose');
const Schema = mongoose.Schema;


const UserSchema = new Schema({
_id: { type: Schema.Types.ObjectId, auto: false },
name: { type: String },
email: { type: String },
creditsBalance: { type: Number, default: 0 },
createdAt: { type: Date, default: Date.now }
});


module.exports = mongoose.model('User', UserSchema);