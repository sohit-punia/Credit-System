const express = require('express');
const router = express.Router();
const ToolPricing = require('../models/ToolPricing');


// GET /api/pricing
router.get('/', async (req, res) => {
const rows = await ToolPricing.find({});
res.json(rows);
});


module.exports = router;