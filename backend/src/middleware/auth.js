const User = require('../models/User');

module.exports = async function (req, res, next) {
  const userId = req.header('x-user-id');
  if (!userId) return res.status(401).json({ error: 'x-user-id header required for dev auth' });

  let user = await User.findById(userId);
  if (!user) {
    // create user with given id (ObjectId string)
    try {
      user = await User.create({ _id: userId, name: `dev-${userId}`, creditsBalance: 0 });
    } catch (err) {
      // If invalid id format, create without custom _id
      user = await User.create({ name: `dev-${Date.now()}`, creditsBalance: 0 });
    }
  }
  req.user = user;
  next();
};
