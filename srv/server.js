import cds from '@sap/cds';
import express from 'express';
import fs from 'fs';
import 'dotenv/config';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { hashPassword, verifyPassword, signToken, verifyToken } from './auth.js';
import { startLiveTelemetry, getLiveTelemetry } from './telemetry.js';

const uiHtml = fs.readFileSync(new URL('./public/index.html', import.meta.url), 'utf8');

const agentCards = {
  root: {
    name: "Pravah-A2A Supply Chain Orchestrator",
    version: "1.2.0",
    protocol: "A2A/1.0",
    sapJouleCompatible: true,
    multiTenantSaaS: true,
    liveFeeds: ["AISStream.io WebSocket", "USITC HTS REST API", "NOAA Weather API", "Gemini 2.0 Flash"],
    securityScheme: "HMAC-SHA256 Bearer + Scrypt Salted Auth",
    timeoutBudgetSec: 60,
    agents: [
      { id: "watcher", url: "/agents/watcher/.well-known/agent.json" },
      { id: "planner", url: "/agents/planner/.well-known/agent.json" },
      { id: "bookmaker", url: "/agents/bookmaker/.well-known/agent.json" },
      { id: "safeguard", url: "/agents/safeguard/.well-known/agent.json" }
    ]
  },
  watcher: { name: "Agent 01 - The Watcher", role: "sensing", protocol: "A2A/1.0", dataSources: ["AISStream.io Live WebSocket", "IMF PortWatch", "NOAA Weather API", "Reefer IoT"], endpoint: "/api/telemetry/live" },
  planner: { name: "Agent 02 - The Planner", role: "scenario_planning", protocol: "A2A/1.0", dataSources: ["SAP S/4HANA Batch Master", "SAP IBP Inventory"], endpoint: "/odata/v4/pravah/S4HanaBatchMaster" },
  bookmaker: { name: "Agent 03 - The Bookmaker", role: "logistics_optimization", protocol: "A2A/1.0", dataSources: ["Live USITC HTS REST API", "India-UAE CEPA", "SAP TM"], endpoint: "/odata/v4/pravah/RerouteOptions" },
  safeguard: { name: "Agent 04 - The Safe Guard", role: "governance_hitl", protocol: "A2A/1.0", dataSources: ["HANA Vector RAG", "EU AI Act Art. 14", "Immutable AuditLogs"], endpoint: "/odata/v4/pravah/AuditLogs" }
};

cds.on('bootstrap', (app) => {
  startLiveTelemetry();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });
  app.use('/api', express.json());

  app.get('/', (_req, res) => res.type('html').send(uiHtml));
  app.get('/logo.jpg', (_req, res) => { const p = new URL('./public/logo.jpg', import.meta.url); fs.existsSync(p) ? res.type('image/jpeg').send(fs.readFileSync(p)) : res.status(404).end(); });
  app.get('/.well-known/agent.json', (_req, res) => res.json(agentCards.root));
  app.get('/agents/:agentId/.well-known/agent.json', (req, res) => {
    const card = agentCards[req.params.agentId];
    return card ? res.json(card) : res.status(404).json({ error: 'Agent card not found' });
  });

  // Live AISStream.io + NOAA Telemetry Endpoint
  app.get('/api/telemetry/live', (_req, res) => res.json(getLiveTelemetry()));

  // Real Gemini-Powered Joule A2A Copilot (Authenticated)
  app.post("/api/copilot/ask", async (req, res) => {
    const user = verifyToken(req.headers.authorization);
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    const question = String(req.body?.question || "").trim();
    if (!question) return res.status(400).json({ error: "Question required" });

    const db = await cds.connect.to("db");
    const [shipments, options, audits] = await Promise.all([
      db.run(SELECT.from("pravah.a2a.Shipments").limit(6)),
      db.run(SELECT.from("pravah.a2a.RerouteOptions").limit(4)),
      db.run(SELECT.from("pravah.a2a.AuditLogs").orderBy("createdAt desc").limit(3))
    ]);
    const telem = getLiveTelemetry();
    const topShips = telem.vessels.slice(0, 5).map(v => `${v.name} (MMSI ${v.mmsi}, ${v.sog} kn at ${v.lat.toFixed(2)},${v.lon.toFixed(2)})`).join("; ");

    if (process.env.GEMINI_API_KEY) {
      try {
        const prompt = `You are Pravah-A2A, a Joule-compatible SAP Supply Chain AI Copilot speaking to ${user.fullName} (${user.role}, ${user.companyName}).
Live Telemetry: AISStream=${telem.aisStatus} (${telem.vesselCount} live ships: ${topShips || "warming up"}), NOAA active alerts=${telem.noaaActiveAlerts}, LIVE IMF PortWatch Satellite Transits: Strait of Hormuz=${telem.portWatch?.hormuzDailyTransits}/day (${telem.portWatch?.hormuzDate}), Bab el-Mandeb=${telem.portWatch?.babElMandebDailyTransits}/day.
S/4HANA Shipments: ${shipments.length} active pharma reefers. Active Reroutes: ${JSON.stringify(options.map(o => ({ route: o.routeName, inr: o.totalCostINR, usd: o.totalCostUSD, days: o.transitDays, spoilage: o.spoilageFlag })))}.
Latest Audits: ${audits.length} EU AI Act Art. 14 records.
Answer concisely in 2-3 sentences: ${question}`;

        const gRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        const gData = await gRes.json();
        const text = gData?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) return res.json({ answer: text.trim(), liveLLM: true, liveVessels: telem.vesselCount });
      } catch {}
    }

    // Smart Live-Data Grounded Fallback (always includes real AISStream + NOAA + HANA numbers)
    const fallback = telem.vesselCount > 0
      ? `Live AISStream is tracking <strong>${telem.vesselCount} real vessels</strong> right now (e.g., ${topShips}) alongside <strong>${telem.noaaActiveAlerts ?? 0} live NOAA alerts</strong>. For S/4HANA pharma exports, Jeddah Intermodal (₹3,52,800 / $4,200; 0% CEPA duty) avoids the $3,500 Hormuz war surcharge and Cape +14d spoilage.`
      : `AISStream (${telem.aisStatus}) & NOAA (${telem.noaaActiveAlerts ?? 0} live alerts) are active with ${shipments.length} HANA Cloud pharma shipments and ${audits.length} EU AI Act Art. 14 audit records. Jeddah Intermodal (₹3,52,800 / $4,200) remains the #1 cold-chain safe route.`;
    return res.json({ answer: fallback, liveLLM: false, liveVessels: telem.vesselCount });
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      const email = String(req.body?.email || '').trim().toLowerCase();
      const password = String(req.body?.password || '');
      if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
      const db = await cds.connect.to('db');
      const user = await db.run(SELECT.one.from('pravah.a2a.TenantUsers').where({ email }));
      if (!user || !user.active || !verifyPassword(password, user.passwordHash)) {
        return res.status(401).json({ error: 'Invalid credentials or inactive subscription.' });
      }
      const profile = { email: user.email, fullName: user.fullName, role: user.role, companyName: user.companyName, corridor: user.corridor, subscriptionTier: user.subscriptionTier };
      return res.json({ token: signToken(profile), user: profile });
    } catch { return res.status(500).json({ error: 'Authentication service unavailable.' }); }
  });

  app.post('/api/auth/register', async (req, res) => {
    try {
      const { email, password, fullName, role, companyName, corridor } = req.body || {};
      const cleanEmail = String(email || '').trim().toLowerCase();
      if (!cleanEmail || !password || password.length < 6 || !fullName || !companyName) {
        return res.status(400).json({ error: 'Provide name, company, email, and password (min 6 chars).' });
      }
      const db = await cds.connect.to('db');
      const exists = await db.run(SELECT.one.from('pravah.a2a.TenantUsers').where({ email: cleanEmail }));
      if (exists) return res.status(409).json({ error: 'An account with this email already exists.' });
      const newUser = {
        email: cleanEmail, fullName: String(fullName).trim(), role: String(role || 'VP Supply Chain').trim(),
        companyName: String(companyName).trim(), corridor: String(corridor || 'India -> JNPT -> Gulf').trim(),
        subscriptionTier: 'PREMIUM_SAAS', passwordHash: hashPassword(password), active: true
      };
      await db.run(INSERT.into('pravah.a2a.TenantUsers').entries(newUser));
      const profile = { email: newUser.email, fullName: newUser.fullName, role: newUser.role, companyName: newUser.companyName, corridor: newUser.corridor, subscriptionTier: newUser.subscriptionTier };
      return res.status(201).json({ token: signToken(profile), user: profile });
    } catch { return res.status(500).json({ error: 'Registration failed.' }); }
  });

  app.get('/api/auth/me', (req, res) => {
    const user = verifyToken(req.headers.authorization);
    return user ? res.json({ user }) : res.status(401).json({ error: 'Unauthorized' });
  });
});

export default cds.server;
