const express = require('express');
const router = express.Router();
const ToolPricing = require('../models/ToolPricing');

// GET /api/pricing
router.get('/', async (req, res) => {
  try {
    const rows = await ToolPricing.find({});
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
