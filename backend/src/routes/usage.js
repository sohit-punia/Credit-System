const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const UsageLog = require('../models/UsageLog');
const CreditTransaction = require('../models/CreditTransaction');
const User = require('../models/User');
const auth = require('../middleware/auth');

router.use(auth);

// POST /api/usage/start
router.post('/start', async (req, res) => {
  const { toolId, estimate = 0, meta = {}, pluginRequestId, idempotencyKey, hold = true } = req.body;
  if (!pluginRequestId) return res.status(400).json({ error: 'pluginRequestId required' });

  const userId = req.user._id;
  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const existing = await UsageLog.findOne({ userId, idempotencyKey }).session(session);
    if (existing) {
      await session.commitTransaction();
      session.endSession();
      return res.json({ ok: true, usage: existing });
    }

    const user = await User.findById(userId).session(session);
    if (!user) throw new Error('User not found');

    if (hold && user.creditsBalance < estimate) {
      await session.abortTransaction();
      session.endSession();
      return res.status(402).json({ ok: false, code: 'INSUFFICIENT_FUNDS', needed: estimate - user.creditsBalance });
    }

    let holdTx = null;
    if (hold && estimate > 0) {
      const txs = await CreditTransaction.create(
        [{ userId, amount: -estimate, type: 'hold', meta: { toolId, pluginRequestId }, idempotencyKey }],
        { session }
      );
      holdTx = txs[0];
      user.creditsBalance -= estimate;
      await user.save({ session });
    }

    const usage = await UsageLog.create(
      [{
        userId,
        pluginRequestId,
        idempotencyKey,
        toolId,
        status: 'started',
        estimate,
        meta,
        holdTxId: holdTx ? holdTx._id : null,
        startedAt: new Date()
      }],
      { session }
    );

    await session.commitTransaction();
    session.endSession();
    return res.json({ ok: true, usage: usage[0], newBalance: user.creditsBalance });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error(err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/usage/finalize
router.post('/finalize', async (req, res) => {
  const { pluginRequestId, idempotencyKey, actualCost = 0, meta = {} } = req.body;
  if (!pluginRequestId) return res.status(400).json({ error: 'pluginRequestId required' });

  const userId = req.user._id;
  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const usage = await UsageLog.findOne({ userId, idempotencyKey, pluginRequestId }).session(session);
    if (!usage) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ ok: false, error: 'usage_not_found' });
    }
    if (usage.status === 'completed') {
      await session.commitTransaction();
      session.endSession();
      const userNow = await User.findById(userId);
      return res.json({ ok: true, newBalance: userNow.creditsBalance });
    }

    const user = await User.findById(userId).session(session);
    if (!user) throw new Error('User not found');

    if (usage.holdTxId) {
      const holdTx = await CreditTransaction.findById(usage.holdTxId).session(session);
      const heldAmount = Math.abs(holdTx.amount);
      const diff = actualCost - heldAmount;

      if (diff > 0) {
        if ((user.creditsBalance || 0) < diff) {
          await session.abortTransaction();
          session.endSession();
          return res.status(402).json({ ok: false, code: 'INSUFFICIENT_FUNDS', needed: diff - (user.creditsBalance || 0) });
        }
        await CreditTransaction.create([{ userId, amount: -diff, type: 'consume', meta: { pluginRequestId, usageId: usage._id } }], { session });
        user.creditsBalance -= diff;
      } else if (diff < 0) {
        const refund = -diff;
        await CreditTransaction.create([{ userId, amount: refund, type: 'refund', meta: { pluginRequestId, usageId: usage._id } }], { session });
        user.creditsBalance += refund;
      }

      await CreditTransaction.create([{ userId, amount: -actualCost, type: 'consume', meta: { pluginRequestId, usageId: usage._id } }], { session });
    } else {
      if ((user.creditsBalance || 0) < actualCost) {
        await session.abortTransaction();
        session.endSession();
        return res.status(402).json({ ok: false, code: 'INSUFFICIENT_FUNDS', needed: actualCost - (user.creditsBalance || 0) });
      }
      await CreditTransaction.create([{ userId, amount: -actualCost, type: 'consume', meta: { pluginRequestId, usageId: usage._id } }], { session });
      user.creditsBalance -= actualCost;
    }

    usage.actualCost = actualCost;
    usage.status = 'completed';
    usage.completedAt = new Date();
    usage.meta = { ...usage.meta, ...meta };
    await usage.save({ session });
    await user.save({ session });

    await session.commitTransaction();
    session.endSession();
    return res.json({ ok: true, newBalance: user.creditsBalance });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error(err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/usage/cancel
router.post('/cancel', async (req, res) => {
  const { pluginRequestId, idempotencyKey, reason } = req.body;
  if (!pluginRequestId) return res.status(400).json({ error: 'pluginRequestId required' });

  const userId = req.user._id;
  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const usage = await UsageLog.findOne({ userId, idempotencyKey, pluginRequestId }).session(session);
    if (!usage) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ ok: false, error: 'usage_not_found' });
    }

    if (usage.status === 'completed') {
      await session.commitTransaction();
      session.endSession();
      return res.json({ ok: true });
    }

    if (usage.holdTxId) {
      const holdTx = await CreditTransaction.findById(usage.holdTxId).session(session);
      const refund = Math.abs(holdTx.amount);
      await CreditTransaction.create([{ userId, amount: refund, type: 'release', meta: { pluginRequestId, reason } }], { session });
      const user = await User.findById(userId).session(session);
      user.creditsBalance += refund;
      await user.save({ session });
    }

    usage.status = 'cancelled';
    usage.meta = { ...usage.meta, cancelledReason: reason };
    await usage.save({ session });

    await session.commitTransaction();
    session.endSession();
    return res.json({ ok: true });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error(err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
