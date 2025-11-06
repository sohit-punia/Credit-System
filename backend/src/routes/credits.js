const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

const CreditTransaction = require('../models/CreditTransaction');
const User = require('../models/User');
const auth = require('../middleware/auth');

// dev auth
router.use(auth);

// GET /api/credits
router.get('/', async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ error: 'user_not_found' });
    return res.json({ balance: user.creditsBalance });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/credits/grant
router.post('/grant', async (req, res) => {
  const { userId, amount, type = 'grant', idempotencyKey } = req.body;
  if (!userId || typeof amount !== 'number') {
    return res.status(400).json({ error: 'userId and amount required' });
  }

  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const txDocs = await CreditTransaction.create(
      [{ userId, amount, type, idempotencyKey }],
      { session }
    );

    await User.updateOne({ _id: userId }, { $inc: { creditsBalance: amount } }).session(session);

    await session.commitTransaction();
    session.endSession();

    return res.json({ success: true, txId: txDocs[0]._id });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    if (err && err.code === 11000) return res.status(200).json({ success: true, message: 'duplicate_idempotency' });
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/credits/consume
router.post('/consume', async (req, res) => {
  const { cost, toolId, breakdown = {}, pluginRequestId, idempotencyKey } = req.body;

  if (!idempotencyKey) return res.status(400).json({ error: 'idempotencyKey required' });
  if (!Number.isInteger(cost) || cost <= 0) return res.status(400).json({ error: 'invalid cost' });

  const userId = req.user._id;
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const existing = await CreditTransaction.findOne({ userId, idempotencyKey }).session(session);
    if (existing) {
      const userNow = await User.findById(userId).session(session);
      await session.commitTransaction();
      session.endSession();
      return res.json({ success: true, newBalance: userNow.creditsBalance, txId: existing._id });
    }

    const user = await User.findById(userId).session(session);
    if (!user) throw new Error('User not found');

    if ((user.creditsBalance || 0) < cost) {
      await session.abortTransaction();
      session.endSession();
      return res.status(402).json({ success: false, code: 'INSUFFICIENT_FUNDS', needed: cost - (user.creditsBalance || 0) });
    }

    const txDocs = await CreditTransaction.create(
      [{
        userId,
        amount: -cost,
        type: 'consume',
        meta: { toolId, breakdown, pluginRequestId },
        idempotencyKey
      }],
      { session }
    );

    user.creditsBalance = user.creditsBalance - cost;
    await user.save({ session });

    await session.commitTransaction();
    session.endSession();

    return res.json({ success: true, newBalance: user.creditsBalance, txId: txDocs[0]._id });
  } catch (err) {
    try { await session.abortTransaction(); } catch(e) {}
    try { session.endSession(); } catch(e) {}
    if (err && err.code === 11000) {
      const userNow = await User.findById(userId);
      return res.json({ success: true, newBalance: userNow.creditsBalance });
    }
    console.error(err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
