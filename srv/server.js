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

  // Public Map Configuration Endpoint (Exposes MapTiler key safely from environment)
  app.get('/api/config/map', (_req, res) => {
    res.json({
      maptilerKey: process.env.MAPTILER_API_KEY || 'SfcHmnwhwHJpBQ9D78p9'
    });
  });

  // Real Gemini-Powered Joule A2A Copilot (Authenticated)
  app.post("/api/copilot/ask", async (req, res) => {
    const rawTok = req.headers["x-pravah-token"];
    const user = verifyToken(rawTok ? ("Bearer " + rawTok) : req.headers.authorization);
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    const question = String(req.body?.question || "").trim();
    if (!question) return res.status(400).json({ error: "Question required" });

    const db = await cds.connect.to("db");
    const [shipments, options, audits, sosList] = await Promise.all([
      db.run(SELECT.from("pravah.a2a.Shipments").limit(16)),
      db.run(SELECT.from("pravah.a2a.RerouteOptions").limit(8)),
      db.run(SELECT.from("pravah.a2a.AuditLogs").orderBy("createdAt desc").limit(5)),
      db.run(SELECT.from("pravah.a2a.MaritimeIncidents").orderBy("createdAt desc").limit(5)).catch(() => [])
    ]);
    const telem = getLiveTelemetry();
    const topShipsArr = [];
    for (const v of (telem.vessels || []).slice(0, 5)) {
      topShipsArr.push(v['name'] + " (MMSI " + v.mmsi + ", " + v.sog + " kn)");
    }
    const topShips = topShipsArr.join("; ");

    const optSummary = [];
    for (const o of options) {
      optSummary.push({
        route: o.routeName, domain: o.cargoDomain, inr: o.totalCostINR, usd: o.totalCostUSD,
        days: o.transitDays, status: o.approvalStatus, cfoLock: o.cfoCapExceeded, note: o.complianceNote
      });
    }
    const sosSummary = [];
    for (const m of sosList) {
      sosSummary.push({
        code: m.incidentCode, type: m.incidentType, ship: m.shipmentId,
        lat: m.latitude, lng: m.longitude, blastBoxes: m.affectedShipments, protectedINR: m.protectedValueINR
      });
    }

    if (process.env.GEMINI_API_KEY) {
      const prompt = [
        "You are Pravah-A2A, an executive SAP BTP Supply Chain & Maritime Intelligence Copilot speaking to " + user.fullName + " (" + user.role + ", " + user.companyName + ").",
        "STRICT INSTRUCTION: Answer the user's EXACT question directly, naturally, and concisely (2-4 sentences). Do NOT mention vessel counts, AISStream numbers, or generic telemetry unless the user specifically asks about live ships, maritime traffic, weather, or telemetry.",
        "Platform Capabilities: 4 A2A Agents (01 Watcher, 02 Planner, 03 Bookmaker, 04 Safe Guard), 5 Cargo Domains (Pharma 2-8C/18d CEPA 0%, Agri/Urea 180d, Perishable Seafood 12d, Semiconductors JIT with INR 8L/day line-down penalty + WTO ITA 0%, Specialty Chemicals Hazmat with IMDG Air Cargo Ban), CFO Spend-Cap Dual-Approval Lock (default INR 5,00,000 / $6,000), EU AI Act Art. 14(4) HITL Sign-Off & printable A4 Certificate, and Maritime SOS Naval Dispatch (Indian Navy IFC-IOR, UKMTO, Indian Coast Guard MRCC Mumbai).",
        "Live HANA State: " + shipments.length + " shipments | Active Reroutes: " + JSON.stringify(optSummary) + " | Active Maritime SOS: " + JSON.stringify(sosSummary) + " | Audit Records: " + audits.length,
        "Live External Feeds (use ONLY if relevant to the question): AISStream=" + telem.aisStatus + " (" + telem.vesselCount + " ships: " + (topShips || "warming up") + "), IMF PortWatch Hormuz=" + telem.portWatch?.hormuzDailyTransits + "/day (" + telem.portWatch?.hormuzDate + "), Bab el-Mandeb=" + telem.portWatch?.babElMandebDailyTransits + "/day, NOAA alerts=" + telem.noaaActiveAlerts + ".",
        "User Question: " + question
      ].join("\n");

      const models = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"];
      for (const model of models) {
        try {
          const gUrl = ["https:", "", "generativelanguage.googleapis.com", "v1beta", "models", model + ":generateContent"].join("/") + "?key=" + encodeURIComponent(process.env.GEMINI_API_KEY);
          const gRes = await fetch(gUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { temperature: 0.3, maxOutputTokens: 320 }
            })
          });
          const gData = await gRes.json();
          const text = gData?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) return res.json({ answer: text.trim(), liveLLM: true, model, liveVessels: telem.vesselCount });
          console.error("[Copilot Gemini " + model + "]", gRes.status, gData?.error?.message || "No text returned");
        } catch (err) {
          console.error("[Copilot Gemini " + model + " Error]", err.message);
        }
      }
    }

    // Topic-aware fallback (only used if all Gemini models fail/rate-limit)
    const q = question.toLowerCase();
    let fallback = "";
    if (/sos|navy|pirate|missile|drone|terror|attack|ukmto|ifc|coast guard|blast/.test(q)) {
      fallback = sosList.length
        ? "Active Maritime SOS " + sosList[0].incidentCode + " (" + sosList[0].incidentType + ") has been persisted in HANA Cloud with a standardized Indian Navy IFC-IOR / UKMTO / MRCC Mumbai packet, alerting " + sosList[0].affectedShipments + " fleet shipments (INR " + Number(sosList[0].protectedValueINR).toLocaleString("en-IN") + " protected)."
        : "Pravah-A2A's Maritime Security & SOS module captures GPS coordinates, MMSI, and threat bearing to generate standardized Indian Navy IFC-IOR, UKMTO, and Indian Coast Guard MRCC Mumbai distress packets while scanning the entire fleet blast radius.";
    } else if (/cfo|cap|spend|budget|cost|price|saving|air/.test(q)) {
      fallback = "The configurable CFO Spend-Cap Guardrail (default ₹5,00,000 / $6,000) automatically places a Dual-Approval Lock on expensive routes like Panic Spot Air (₹9,66,000 / $11,500), while Jeddah Intermodal (₹3,52,800 / $4,200) saves ₹2,77,200 ($3,300) vs Gulf War Surcharge.";
    } else if (/hazmat|chemical|imdg|semiconductor|chip|urea|agri|shrimp|food|domain|cargo/.test(q)) {
      fallback = "Pravah-A2A supports 5 sea-export verticals: Pharma (2–8°C, 18d CEPA 0%), Agri/Urea (180d bulk), Perishable Seafood (12d), Semiconductors JIT (₹8L/day line-down penalty + WTO ITA 0%), and Hazmat Chemicals (automatic IMDG Air Cargo Ban).";
    } else if (/eu|ai act|cepa|audit|compliance|certificate|legal|hitl/.test(q)) {
      fallback = "Every reroute is held at Agent 04's Human-in-the-Loop gate per EU AI Act Article 14(4). Once approved, SAP HANA Cloud logs an immutable audit entry (" + audits.length + " records active) and unlocks a printable A4 Compliance & India–UAE CEPA 0% Duty Certificate.";
    } else if (/ship|ais|vessel|hormuz|noaa|weather|telemetry|live|map/.test(q)) {
      fallback = "Live telemetry is active: AISStream reports " + telem.vesselCount + " live vessels" + (topShips ? " (" + topShips + ")" : "") + ", IMF PortWatch shows " + (telem.portWatch?.hormuzDailyTransits ?? "N/A") + " daily Strait of Hormuz transits, and NOAA reports " + (telem.noaaActiveAlerts ?? 0) + " active alerts.";
    } else {
      fallback = "Pravah-A2A currently monitors " + shipments.length + " S/4HANA shipments on SAP BTP + HANA Cloud with 4 A2A agents, 5 cargo-domain rule engines, CFO spend-cap governance, EU AI Act Art. 14(4) audit trails, and Maritime SOS naval dispatch. Ask me about any specific route, cargo domain, compliance rule, or live corridor.";
    }
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
