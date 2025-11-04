// backend/src/routes/credits.js
const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

const CreditTransaction = require('../models/CreditTransaction');
const User = require('../models/User');
const auth = require('../middleware/auth');

// Use dev auth middleware (expects x-user-id header)
router.use(auth);

/**
 * GET /api/credits
 * Returns current cached balance for the authenticated user
 */
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

/**
 * POST /api/credits/grant
 * Grant credits to any user (dev/admin helper).
 * Body: { userId, amount, type = 'grant', idempotencyKey? }
 */
router.post('/grant', async (req, res) => {
  const { userId, amount, type = 'grant', idempotencyKey } = req.body;
  if (!userId || typeof amount !== 'number') {
    return res.status(400).json({ error: 'userId and amount required' });
  }

  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    // Insert transaction (idempotent if idempotencyKey provided)
    const txDocs = await CreditTransaction.create(
      [{ userId, amount, type, idempotencyKey }],
      { session }
    );

    // Update user's cached balance
    await User.updateOne({ _id: userId }, { $inc: { creditsBalance: amount } }).session(session);

    await session.commitTransaction();
    session.endSession();

    return res.json({ success: true, txId: txDocs[0]._id });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();

    // Duplicate idempotency key (unique index) — treat as success (idempotent)
    if (err && err.code === 11000) {
      return res.status(200).json({ success: true, message: 'duplicate_idempotency' });
    }

    console.error(err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/credits/consume
 * Fast synchronous consume endpoint for quick operations.
 * Body: { cost, toolId, breakdown, pluginRequestId, idempotencyKey }
 */
router.post('/consume', async (req, res) => {
  const { cost, toolId, breakdown = {}, pluginRequestId, idempotencyKey } = req.body;

  if (!idempotencyKey) return res.status(400).json({ error: 'idempotencyKey required' });
  if (!Number.isInteger(cost) || cost <= 0) return res.status(400).json({ error: 'invalid cost' });

  const userId = req.user._id;
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    // If this idempotency key was already processed, return existing tx result
    const existing = await CreditTransaction.findOne({ userId, idempotencyKey }).session(session);
    if (existing) {
      const userNow = await User.findById(userId).session(session);
      await session.commitTransaction();
      session.endSession();
      return res.json({ success: true, newBalance: userNow.creditsBalance, txId: existing._id });
    }

    // Load fresh user inside the transaction
    const user = await User.findById(userId).session(session);
    if (!user) throw new Error('User not found');

    // Check sufficient balance
    if ((user.creditsBalance || 0) < cost) {
      await session.abortTransaction();
      session.endSession();
      return res.status(402).json({
        success: false,
        code: 'INSUFFICIENT_FUNDS',
        needed: cost - (user.creditsBalance || 0)
      });
    }

    // Create consume transaction and decrement cached balance atomically
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
    // Ensure session is cleaned up even on errors
    try { await session.abortTransaction(); } catch (e) {}
    try { session.endSession(); } catch (e) {}

    // Duplicate key error could occur if another request created tx with same idempotencyKey concurrently
    if (err && err.code === 11000) {
      // Return the current cached balance as success
      const userNow = await User.findById(userId);
      return res.json({ success: true, newBalance: userNow.creditsBalance });
    }

    console.error(err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
