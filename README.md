# 🎨 Figma Credits System — Backend + Plugin

This project provides a complete **credits-based billing system** for a Figma plugin.  
Users receive credits, consume credits using tools, and heavy operations follow a **hold → finalize** model to safely deduct or refund credits.

Built with:
- **Node.js / Express**
- **MongoDB / Mongoose**
- **Plugin-side Usage Manager (JavaScript)**

---

# 🏗 System Architecture Diagram

Below is a clear, simplified architecture showing how the Figma plugin communicates with the backend and how credits flow.


               ┌───────────────────────┐
               │     Figma Plugin      │
               │  (usageManager.js)    │
               └──────────┬────────────┘
                          │
             HTTP Requests│
                          ▼
       ┌─────────────────────────────────┐
       │        Node.js Backend          │
       │─────────────────────────────────│
       │ Routes:                         │
       │  • /api/credits                 │
       │  • /api/usage                   │
       │  • /api/pricing                 │
       │                                 │
       │ Logic Layers:                   │
       │  • Credit Consume (atomic)      │
       │  • Hold Credits (start)         │
       │  • Finalize / Refund            │
       │  • Idempotency Safety           │
       └───────────┬─────────────────────┘
                   │
                   ▼
       ┌─────────────────────────────────┐
       │          MongoDB Atlas          │
       │─────────────────────────────────│
       │ Collections:                    │
       │  • users                        │
       │  • credittransactions           │
       │  • usagelogs                    │
       │  • toolpricings                 │
       └─────────────────────────────────┘



---

## 📁 Project Folder Structure

backend/
│
├── src/
│ ├── config/ # DB connection
│ │ └── db.js
│ │
│ ├── middleware/ # Dev auth middleware
│ │ └── auth.js
│ │
│ ├── models/ # MongoDB schemas
│ │ ├── User.js
│ │ ├── CreditTransaction.js
│ │ ├── UsageLog.js
│ │ └── ToolPricing.js
│ │
│ ├── routes/ # API routes
│ │ ├── credits.js
│ │ ├── usage.js
│ │ └── pricing.js
│ │
│ ├── utils/ # Logging helpers, tools
│ │ └── logger.js
│ │
│ └── index.js # App entrypoint
│
├── scripts/
│ └── seed.js # Seed pricing + test user
│
├── plugin/
│ └── usageManager.js # Frontend plugin usage manager
│
├── .env # Environment variables
└── package.json

yaml
Copy code



| Method | Route                | Description            |
| ------ | -------------------- | ---------------------- |
| GET    | /api/credits         | Get balance            |
| POST   | /api/credits/consume | Deduct credits         |
| POST   | /api/credits/grant   | Add credits            |
| GET    | /api/credits/history | Credit ledger          |
| GET    | /api/pricing         | All tool pricing       |
| POST   | /api/usage/start     | Hold estimated credits |
| POST   | /api/usage/finalize  | Final cost/refund      |
| POST   | /api/usage/cancel    | Cancel & refund        |


🧪 Local Development
Install
npm install

Setup .env
PORT=5001
MONGO_URI=mongodb+srv://...

Seed DB
npm run seed

Run server
npm run dev


Use Postman with header:

x-user-id: <seeded user id>

---


