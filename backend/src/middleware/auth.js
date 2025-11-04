// Dev auth: expects x-user-id header (ObjectId string). Creates user automatically in dev.
const User = require('../models/User');


module.exports = async function(req, res, next) {
const userId = req.header('x-user-id');
if (!userId) return res.status(401).json({ error: 'x-user-id header required for dev auth' });


// find or create a simple dev user
let user = await User.findById(userId);
if (!user) {
// create user with provided id (use ObjectId string)
user = await User.create({ _id: userId, name: `dev-${userId}`, creditsBalance: 0 });
}
req.user = user;
next();
};