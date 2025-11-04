const ToolPricing = require('../models/ToolPricing');

const seed = async () => {
  const tools = [
    { toolId: 'pdf_exporter', base: 10, addons: { multiPage: 5, highRes: 2 }, perPage: 1 },
    { toolId: 'palette', base: 15, addons: { wcagCheck: 5 }, perPage: 0 },
    { toolId: 'unit_convert', base: 5, addons: { perItem: 1 }, perPage: 0 },
    { toolId: 'import_tool', base: 30, addons: { largeFile: 10 }, perPage: 0 },
  ];

  for (const tool of tools) {
    await ToolPricing.updateOne({ toolId: tool.toolId }, { $set: tool }, { upsert: true });
  }

  console.log('✅ Tool pricing seeded successfully');
};

module.exports = seed;
