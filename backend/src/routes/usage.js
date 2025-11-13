const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const UsageLog = require('../models/UsageLog');
const CreditTransaction = require('../models/CreditTransaction');
const User = require('../models/User');
const auth = require('../middleware/auth');

router.use(auth);

// Helper to avoid attaching idempotencyKey when falsy
const makeTxDoc = ({ userId, amount, type, meta = {}, idempotencyKey }) => {
  const doc = { userId, amount, type, meta };
  if (idempotencyKey) doc.idempotencyKey = idempotencyKey;
  return doc;
};

/**
 * POST /api/usage/start
 * - For local fallback: will check idempotency, ensure balance >= estimate (if hold),
 *   create a UsageLog and create a hold transaction (atomic flow: decrement user then write tx).
 */
router.post('/start', async (req, res) => {
  const { toolId, estimate = 0, meta = {}, pluginRequestId, idempotencyKey, hold = true } = req.body;
  if (!pluginRequestId) return res.status(400).json({ error: 'pluginRequestId required' });

  const userId = req.user._id;

  try {
    // idempotency check: if key provided
    if (idempotencyKey) {
      const existing = await UsageLog.findOne({ userId, idempotencyKey });
      if (existing) return res.json({ ok: true, usage: existing });
    }

    // If hold required and estimate > 0, atomically decrement user balance
    let holdTx = null;
    if (hold && estimate > 0) {
      // Atomically decrement balance only if enough funds
      const updatedUser = await User.findOneAndUpdate(
        { _id: userId, creditsBalance: { $gte: estimate } },
        { $inc: { creditsBalance: -estimate } },
        { new: true }
      );
      if (!updatedUser) {
        const current = await User.findById(userId);
        const deficit = estimate - (current ? current.creditsBalance : 0);
        return res.status(402).json({ ok: false, code: 'INSUFFICIENT_FUNDS', needed: deficit });
      }

      // Create hold transaction record
      const txDoc = makeTxDoc({ userId, amount: -estimate, type: 'hold', meta: { toolId, pluginRequestId }, idempotencyKey });
      holdTx = await CreditTransaction.create(txDoc);
    }

    // Create usage log (no session)
    const usage = await UsageLog.create({
      userId,
      pluginRequestId,
      idempotencyKey: idempotencyKey || undefined,
      toolId,
      status: 'started',
      estimate,
      meta,
      holdTxId: holdTx ? holdTx._id : null,
      startedAt: new Date()
    });

    // If we didn't do an atomic decrement, fetch current balance to return
    const userNow = await User.findById(userId);
    return res.json({ ok: true, usage, newBalance: userNow.creditsBalance });
  } catch (err) {
    // If duplicate key on tx or usage (11000) treat as idempotent success
    if (err && err.code === 11000) {
      const userNow = await User.findById(userId);
      return res.json({ ok: true, newBalance: userNow.creditsBalance, note: 'duplicate_ignored' });
    }
    console.error('usage/start error', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/usage/finalize
 * - For local fallback: fetch usage, compute differences, update user via atomic ops
 *   (refund or extra consume), write transactions, and update usage doc.
 */
router.post('/finalize', async (req, res) => {
  const { pluginRequestId, idempotencyKey, actualCost = 0, meta = {} } = req.body;
  if (!pluginRequestId) return res.status(400).json({ error: 'pluginRequestId required' });

  const userId = req.user._id;
  try {
    // find usage (prefer idempotencyKey if provided)
    const usage = idempotencyKey
      ? await UsageLog.findOne({ userId, idempotencyKey, pluginRequestId })
      : await UsageLog.findOne({ userId, pluginRequestId });

    if (!usage) return res.status(404).json({ ok: false, error: 'usage_not_found' });
    if (usage.status === 'completed') {
      const userNow = await User.findById(userId);
      return res.json({ ok: true, newBalance: userNow.creditsBalance });
    }

    // If a hold existed: held amount = abs(holdTx.amount)
    if (usage.holdTxId) {
      const holdTx = await CreditTransaction.findById(usage.holdTxId);
      if (!holdTx) throw new Error('holdTx not found');

      const heldAmount = Math.abs(holdTx.amount);
      const diff = actualCost - heldAmount;

      // Case: actualCost > heldAmount => need additional funds
      if (diff > 0) {
        // Atomically remove additional funds if available
        const updatedUser = await User.findOneAndUpdate(
          { _id: userId, creditsBalance: { $gte: diff } },
          { $inc: { creditsBalance: -diff } },
          { new: true }
        );
        if (!updatedUser) {
          const current = await User.findById(userId);
          return res.status(402).json({ ok: false, code: 'INSUFFICIENT_FUNDS', needed: diff - (current ? current.creditsBalance : 0) });
        }
        // create extra consume tx
        await CreditTransaction.create(makeTxDoc({ userId, amount: -diff, type: 'consume', meta: { pluginRequestId, usageId: usage._id } }));
      } else if (diff < 0) {
        // refund: increase user balance by (-diff)
        const refund = -diff;
        await User.findByIdAndUpdate(userId, { $inc: { creditsBalance: refund } });
        await CreditTransaction.create(makeTxDoc({ userId, amount: refund, type: 'refund', meta: { pluginRequestId, usageId: usage._id } }));
      }

      // create final consume record for bookkeeping (amount = -actualCost)
      await CreditTransaction.create(makeTxDoc({ userId, amount: -actualCost, type: 'consume', meta: { pluginRequestId, usageId: usage._id } }));

    } else {
      // No hold: directly atomically deduct actualCost
      const updatedUser = await User.findOneAndUpdate(
        { _id: userId, creditsBalance: { $gte: actualCost } },
        { $inc: { creditsBalance: -actualCost } },
        { new: true }
      );
      if (!updatedUser) {
        const current = await User.findById(userId);
        return res.status(402).json({ ok: false, code: 'INSUFFICIENT_FUNDS', needed: actualCost - (current ? current.creditsBalance : 0) });
      }
      await CreditTransaction.create(makeTxDoc({ userId, amount: -actualCost, type: 'consume', meta: { pluginRequestId, usageId: usage._id } }));
    }

    // finalize usage log
    usage.actualCost = actualCost;
    usage.status = 'completed';
    usage.completedAt = new Date();
    usage.meta = { ...usage.meta, ...meta };
    await usage.save();

    const userNow = await User.findById(userId);
    return res.json({ ok: true, newBalance: userNow.creditsBalance });
  } catch (err) {
    if (err && err.code === 11000) {
      const userNow = await User.findById(userId);
      return res.json({ ok: true, newBalance: userNow.creditsBalance, note: 'duplicate_ignored' });
    }
    console.error('usage/finalize error', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/usage/cancel
 * - If usage had a hold, refund the held amount and mark usage cancelled.
 */
router.post('/cancel', async (req, res) => {
  const { pluginRequestId, idempotencyKey, reason } = req.body;
  if (!pluginRequestId) return res.status(400).json({ error: 'pluginRequestId required' });

  const userId = req.user._id;
  try {
    const usage = idempotencyKey
      ? await UsageLog.findOne({ userId, idempotencyKey, pluginRequestId })
      : await UsageLog.findOne({ userId, pluginRequestId });

    if (!usage) return res.status(404).json({ ok: false, error: 'usage_not_found' });
    if (usage.status === 'completed') return res.json({ ok: true });

    if (usage.holdTxId) {
      const holdTx = await CreditTransaction.findById(usage.holdTxId);
      if (holdTx) {
        const refund = Math.abs(holdTx.amount);
        await User.findByIdAndUpdate(userId, { $inc: { creditsBalance: refund } });
        await CreditTransaction.create(makeTxDoc({ userId, amount: refund, type: 'release', meta: { pluginRequestId, reason } }));
      }
    }

    usage.status = 'cancelled';
    usage.meta = { ...usage.meta, cancelledReason: reason };
    await usage.save();

    return res.json({ ok: true });
  } catch (err) {
    console.error('usage/cancel error', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
