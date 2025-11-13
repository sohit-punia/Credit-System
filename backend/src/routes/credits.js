const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

const CreditTransaction = require('../models/CreditTransaction');
const User = require('../models/User');
const auth = require('../middleware/auth');

// dev auth
router.use(auth);

// Helper: build tx doc but DO NOT attach idempotencyKey if falsy
const makeTxDoc = ({ userId, amount, type, meta = {}, idempotencyKey }) => {
  const doc = { userId, amount, type, meta };
  if (idempotencyKey) doc.idempotencyKey = idempotencyKey;
  return doc;
};

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
      [makeTxDoc({ userId, amount, type, idempotencyKey })],
      { session }
    );

    await User.updateOne({ _id: userId }, { $inc: { creditsBalance: amount } }).session(session);

    await session.commitTransaction();
    session.endSession();

    return res.json({ success: true, txId: txDocs[0]._id });
  } catch (err) {
    try { await session.abortTransaction(); } catch(e) {}
    try { session.endSession(); } catch(e) {}

    // idempotency duplicate -> treat as success
    if (err && err.code === 11000) return res.status(200).json({ success: true, message: 'duplicate_idempotency' });

    console.error(err);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/credits/consume (fast synchronous consume)
// Non-transactional, atomic consume (fallback for local dev)
router.post('/consume', async (req, res) => {
  const { cost, toolId, breakdown = {}, pluginRequestId, idempotencyKey } = req.body;
  if (!idempotencyKey) return res.status(400).json({ error: 'idempotencyKey required' });
  if (!Number.isInteger(cost) || cost <= 0) return res.status(400).json({ error: 'invalid cost' });

  const userId = req.user._id;

  try {
    // idempotency check first
    const existing = await CreditTransaction.findOne({ userId, idempotencyKey });
    if (existing) {
      const userNow = await User.findById(userId);
      return res.json({ success: true, newBalance: userNow.creditsBalance, txId: existing._id });
    }

    // Atomic find-and-update to ensure no overdraft (single call)
    const updatedUser = await User.findOneAndUpdate(
      { _id: userId, creditsBalance: { $gte: cost } },
      { $inc: { creditsBalance: -cost } },
      { new: true }
    );

    if (!updatedUser) {
      // not enough balance
      const current = await User.findById(userId);
      const deficit = cost - (current ? current.creditsBalance : 0);
      return res.status(402).json({ success: false, code: 'INSUFFICIENT_FUNDS', needed: deficit });
    }

    // create transaction record (no session)
    const txDoc = { userId, amount: -cost, type: 'consume', meta: { toolId, breakdown, pluginRequestId } };
    if (idempotencyKey) txDoc.idempotencyKey = idempotencyKey;
    const tx = await CreditTransaction.create(txDoc);

    return res.json({ success: true, newBalance: updatedUser.creditsBalance, txId: tx._id });
  } catch (err) {
    // handle duplicate idempotency race
    if (err && err.code === 11000) {
      const userNow = await User.findById(userId);
      return res.json({ success: true, newBalance: userNow.creditsBalance });
    }
    console.error('consume error', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/credits/history
router.get('/history', async (req, res) => {
  try {
    const userId = req.user._id;
    const txs = await CreditTransaction.find({ userId }).sort({ createdAt: -1 }).limit(500);
    return res.json({ transactions: txs });
  } catch (err) {
    console.error('history error', err);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
