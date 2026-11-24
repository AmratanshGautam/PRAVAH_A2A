import 'dotenv/config';
import cds from '@sap/cds';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { startLiveTelemetry, getLiveTelemetry } from './telemetry.js';
import { hashPassword, verifyPassword, signToken, verifyToken } from './auth.js';
import {
  runResiliencePipeline,
  calculateThermalSpoilageRisk,
  queryCEPATariff,
  getComplianceCitations
} from './agents/orchestrator.js';
import { computeAuditHash, resolveRbacRole } from './pravah-service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const GENESIS_HASH = 'GENESIS_PRAVAH_A2A_2026';

function extractAuthUser(req) {
  const rawTok = req.headers['x-pravah-token'];
  return verifyToken(rawTok ? ('Bearer ' + rawTok) : req.headers.authorization);
}

async function verifyChainInDb(db) {
  const logs = await db.run(SELECT.from('pravah.a2a.AuditLogs').orderBy('createdAt asc', 'ID asc'));
  let expectedPrev = GENESIS_HASH;
  for (const row of logs) {
    if (row.previousHash !== expectedPrev) return { valid: false, totalRecords: logs.length, brokenAtId: row.ID };
    const recomputed = computeAuditHash(expectedPrev, row);
    if (row.currentHash !== recomputed) return { valid: false, totalRecords: logs.length, brokenAtId: row.ID };
    expectedPrev = row.currentHash;
  }
  return { valid: true, totalRecords: logs.length, brokenAtId: '' };
}

async function appendHashAuditInDb(db, entry) {
  const latest = await db.run(SELECT.from('pravah.a2a.AuditLogs').orderBy('createdAt desc', 'ID desc').limit(1));
  const previousHash = (latest.length > 0 && latest[0].currentHash) ? latest[0].currentHash : GENESIS_HASH;
  const record = {
    shipmentId: entry.shipmentId || 'SYSTEM',
    agentName: entry.agentName || 'Pravah-A2A',
    actionTaken: entry.actionTaken || 'EVENT',
    euAiActClause: entry.euAiActClause || 'Regulation (EU) 2024/1689 - Article 14(4)',
    cepaCitation: entry.cepaCitation || 'India-UAE CEPA 0% Duty',
    humanApprover: entry.humanApprover || 'SYSTEM',
    actorRole: entry.actorRole || 'SYSTEM',
    decisionStatus: entry.decisionStatus || 'LOGGED',
    aiConfidenceScore: entry.aiConfidenceScore ?? 96.50,
    policyVersion: entry.policyVersion || 'PRAVAH-GOV-2.1',
    previousHash,
    details: String(entry.details || '').slice(0, 1990)
  };
  record.currentHash = computeAuditHash(previousHash, record);
  await db.run(INSERT.into('pravah.a2a.AuditLogs').entries(record));
  return record;
}

const AGENT_CARDS = {
  root: {
    protocolVersion: '0.2.5',
    agentTitle: 'Pravah-A2A Sovereign Supply Chain Orchestrator',
    description: '4-Agent LangGraph A2A Control Tower on SAP BTP CAP & HANA Cloud for Multi-Domain Maritime Resilience, MKT Cold-Chain Protection, and EU AI Act Art. 14 Governance.',
    version: '2.1.0',
    protocol: 'A2A/1.0 (SAP Joule Outbound A2A Compatible)',
    defaultInputModes: ['application/json', 'text/plain'],
    defaultOutputModes: ['application/json', 'text/markdown'],
    authentication: {
      schemes: ['Bearer', 'X-Pravah-Token'],
      credentialsType: 'HMAC-SHA256-JWT',
      enterpriseSwap: 'SAP Cloud Identity Services (IAS) / XSUAA OAuth2'
    },
    capabilities: {
      streaming: true,
      pushNotifications: true,
      stateTransitionHistory: true,
      humanInTheLoop: true,
      euAiActArticle14: true,
      tamperEvidentSha256Ledger: true
    },
    skills: [
      {
        id: 'cold-chain-crisis-triage',
        title: 'Cold-Chain & Multi-Domain Crisis Triage',
        description: 'Executes LangGraph 4-agent StateGraph with Arrhenius MKT spoilage math, Batch VaR/ROI, and conditional Fujairah/Dubai Air-Sea multimodal self-correction.',
        tags: ['langgraph', 'cold-chain', 'mkt', 'var', 's4hana-event-mesh'],
        examples: ['Simulate a Red Sea blockage on SHP-JNPT-001', 'Test +6 day delay on SHP-JNPT-002']
      },
      {
        id: 'cepa-tariff-reroute-optimizer',
        title: 'India-UAE CEPA & Multi-Domain Reroute Optimizer',
        description: 'Evaluates 5 sea-export verticals (Pharma, Urea, Seafood, Semiconductors JIT, Hazmat IMDG) with live USITC HTS lookups and CFO Spend-Cap locks.',
        tags: ['cepa', 'usitc-hts', 'imdg', 'cfo-guardrail'],
        examples: ['Compare reroutes for SHP-JNPT-001', 'Show CEPA duty savings']
      },
      {
        id: 'eu-ai-act-hitl-governance',
        title: 'EU AI Act Art. 14 Override + Dual-RBAC & SHA-256 Ledger',
        description: 'Enforces RBAC Dual Sign-Off (SUPPLY_CHAIN_VP + QA_PHARMA_OFFICER), verifies SHA-256 hash-chained AuditLogs, and exports official compliance dossiers.',
        tags: ['eu-ai-act', 'rbac', 'sha256-ledger', 'compliance-dossier'],
        examples: ['Verify EU AI Act audit chain', 'Generate compliance dossier for SHP-JNPT-001']
      },
      {
        id: 'maritime-sos-naval-dispatch',
        title: 'Maritime Security & Standardized Naval SOS Packet',
        description: 'Generates standardized Indian Navy IFC-IOR / UKMTO / Indian Coast Guard MRCC Mumbai distress packets and Fleet-Wide Blast Radius scans.',
        tags: ['ifc-ior', 'ukmto', 'mrcc', 'blast-radius']
      }
    ],
    extensions: {
      sapJoule: {
        compatible: true,
        odataServicePath: '/odata/v4/pravah',
        eventMeshWebhook: '/api/webhooks/s4hana-event',
        cloudEventType: 'sap.s4.beh.handlingunit.excursion.v1',
        complianceDossierEndpoint: '/api/compliance/dossier/{shipmentId}'
      }
    },
    agents: [
      { id: 'watcher', role: 'Agent 01 - The Watcher', card: '/agents/watcher/.well-known/agent.json' },
      { id: 'planner', role: 'Agent 02 - The Planner', card: '/agents/planner/.well-known/agent.json' },
      { id: 'bookmaker', role: 'Agent 03 - The Bookmaker', card: '/agents/bookmaker/.well-known/agent.json' },
      { id: 'safeguard', role: 'Agent 04 - The Safe Guard', card: '/agents/safeguard/.well-known/agent.json' }
    ]
  },
  watcher: { id: 'watcher', role: 'Agent 01 - The Watcher', skills: ['live_aisstream_ws', 'imf_portwatch_satellite', 'noaa_weather_polling', 'mkt_thermal_drift', 's4hana_ewm_webhook'] },
  planner: { id: 'planner', role: 'Agent 02 - The Planner', skills: ['s4hana_batch_query', 'ibp_shelf_life_verification', '5_domain_constraint_engine', 'langgraph_multimodal_fallback'] },
  bookmaker: { id: 'bookmaker', role: 'Agent 03 - The Bookmaker', skills: ['usitc_hts_live_lookup', 'india_uae_cepa_0pct_tariff', 'batch_var_roi_costing', 'cfo_spend_cap_lock'] },
  safeguard: { id: 'safeguard', role: 'Agent 04 - The Safe Guard', skills: ['eu_ai_act_art14_dual_hitl', 'sha256_hash_chained_ledger', 'compliance_dossier_export', 'gemini_executive_brief'] }
};

cds.on('bootstrap', (app) => {
  app.use(express.json());
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });
  app.use(express.static(PUBLIC_DIR));
  startLiveTelemetry();

  app.get('/', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
  app.get('/health', (_req, res) => res.json({ status: 'UP', service: 'Pravah-A2A CAP + HANA Cloud', timestamp: new Date().toISOString() }));

  // A2A Discovery Cards
  app.get('/.well-known/agent.json', (_req, res) => res.json(AGENT_CARDS.root));
  app.get('/agents/:agentId/.well-known/agent.json', (req, res) => {
    const card = AGENT_CARDS[req.params.agentId];
    return card ? res.json(card) : res.status(404).json({ error: 'Agent card not found' });
  });

  // Live Telemetry & Map Config
  app.get('/api/telemetry/live', (_req, res) => res.json(getLiveTelemetry()));
  app.get('/api/config/map', (_req, res) => {
    res.json({ maptilerKey: process.env.MAPTILER_API_KEY || 'SfcHmnwhwHJpBQ9D78p9' });
  });

  // ============================================================================
  // ONE-CLICK COMPLIANCE & INDIA-UAE CEPA CUSTOMS DOSSIER ENDPOINT
  // ============================================================================
  app.get('/api/compliance/dossier/:shipmentId', async (req, res) => {
    const user = extractAuthUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const shipmentId = req.params.shipmentId;
      const db = await cds.connect.to('db');
      const [shipment, batch, excursions, options, audits, chainProof] = await Promise.all([
        db.run(SELECT.one.from('pravah.a2a.Shipments').where({ shipmentId })),
        db.run(SELECT.one.from('pravah.a2a.ReeferBatches').where({ shipmentId })),
        db.run(SELECT.from('pravah.a2a.ColdChainExcursions').where({ shipmentId }).orderBy('createdAt desc').limit(10)),
        db.run(SELECT.from('pravah.a2a.RerouteOptions').where({ shipmentId }).orderBy('recommended desc')),
        db.run(SELECT.from('pravah.a2a.AuditLogs').where({ shipmentId }).orderBy('createdAt desc').limit(15)),
        verifyChainInDb(db)
      ]);
      if (!shipment) return res.status(404).json({ error: 'Shipment not found: ' + shipmentId });

      const tempHistory = [4.2, 4.5, 5.1];
      for (const ex of excursions) tempHistory.push(Number(ex.reeferTempC || 8.9));
      const rec = options.find(o => o.recommended) || options[0] || null;
      const mkt = calculateThermalSpoilageRisk(
        tempHistory,
        Number(batch?.currentTempC ?? 4.5),
        Number(batch?.remainingShelfLifeDays ?? 18),
        Number(shipment.cargoValueUSD ?? 250000),
        rec ? Number(rec.totalCostUSD) : 4200
      );
      const cepa = queryCEPATariff(batch?.hsCode || shipment.hsCode);
      const citations = getComplianceCitations();
      const approvals = [];
      for (const a of audits) {
        if (/APPROVED|COUNTERSIGN|SIGNOFF/i.test(String(a.decisionStatus) + ' ' + String(a.actionTaken))) {
          approvals.push({
            action: a.actionTaken,
            approver: a.humanApprover,
            actorRole: a.actorRole,
            status: a.decisionStatus,
            timestamp: a.createdAt,
            auditHash: a.currentHash
          });
        }
      }

      return res.json({
        dossierId: 'DOSSIER-' + shipmentId + '-' + new Date().toISOString().slice(0, 10),
        generatedAtUtc: new Date().toISOString(),
        requestedBy: { fullName: user.fullName, role: resolveRbacRole(user), companyName: user.companyName },
        shipment,
        batch,
        mktThermalSummary: mkt,
        cepaCustomsBreakdown: {
          hsCode: shipment.hsCode,
          agreement: citations.cepa,
          standardDutyPct: cepa?.standardDutyPct ?? 5,
          cepaPreferentialDutyPct: cepa?.cepaPreferentialDutyPct ?? 0,
          estimatedDutySavingsUSD: mkt.cepaDutySavingsUSD,
          estimatedDutySavingsINR: mkt.cepaDutySavingsINR
        },
        selectedReroute: rec,
        executiveBrief: audits[0]?.details || 'No crisis triage executed yet for this shipment.',
        dualHitlSignatures: approvals,
        euAiActGovernance: {
          clause: citations.euAiAct,
          policyVersion: 'PRAVAH-GOV-2.1',
          sha256ChainVerification: chainProof,
          latestRecordHash: audits[0]?.currentHash || GENESIS_HASH
        }
      });
    } catch (e) {
      return res.status(500).json({ error: 'Failed to generate compliance dossier: ' + e.message });
    }
  });

  // ============================================================================
  // SAP S/4HANA EVENT MESH / EWM BATCH EXCURSION WEBHOOK
  // ============================================================================
  app.post('/api/webhooks/s4hana-event', async (req, res) => {
    try {
      const ev = req.body || {};
      const data = ev.data || ev;
      const shipmentId = data.shipmentId || 'SHP-JNPT-001';
      const reeferTempC = Number(data.temperatureC ?? data.reeferTempC ?? 9.6);
      const chokepoint = data.chokepoint || 'Strait of Hormuz';
      const delayDays = Number(data.delayDays ?? data.simulatedDelayDays ?? 0);
      const cargoDomain = data.cargoDomain || 'PHARMA_COLD_CHAIN';
      const eventType = ev.type || 'sap.s4.beh.handlingunit.excursion.v1';

      const db = await cds.connect.to('db');
      const shipment = await db.run(SELECT.one.from('pravah.a2a.Shipments').where({ shipmentId }));
      const batch = await db.run(SELECT.one.from('pravah.a2a.ReeferBatches').where({ shipmentId }));
      if (!shipment || !batch) return res.status(404).json({ error: 'Shipment not found in S/4HANA mirror: ' + shipmentId });

      await db.run(INSERT.into('pravah.a2a.ColdChainExcursions').entries({
        shipmentId,
        eventType,
        chokepoint,
        vesselSogKnots: Number(data.vesselSogKnots ?? 0.3),
        aisDarkMinutes: Number(data.aisDarkMinutes ?? 52),
        reeferTempC,
        doorOpen: Boolean(data.doorOpen),
        severity: 'CRITICAL',
        detectedBy: 'SAP S/4HANA Event Mesh (EWM CloudEvent)'
      }));
      await db.run(UPDATE('pravah.a2a.Shipments').set({ status: 'ALERT_TRIGGERED', cargoDomain }).where({ shipmentId }));
      await db.run(UPDATE('pravah.a2a.ReeferBatches').set({ currentTempC: reeferTempC, spoilageRiskFlag: reeferTempC > 8 }).where({ shipmentId }));

      const pipeline = await runResiliencePipeline({
        shipment,
        batch,
        telemetry: { eventType, chokepoint, reeferTempC },
        cargoDomain,
        cfoSpendCapINR: 500000,
        whatIf: { simulatedDelayDays: delayDays, simulatedTempC: reeferTempC, blockedChokepoint: data.blockedChokepoint || '' }
      });

      await db.run(DELETE.from('pravah.a2a.RerouteOptions').where({ shipmentId }));
      for (const opt of pipeline.routes) {
        await db.run(INSERT.into('pravah.a2a.RerouteOptions').entries({ shipmentId, ...opt }));
      }

      const audit = await appendHashAuditInDb(db, {
        shipmentId,
        agentName: 'SAP Event Mesh -> LangGraph 4-Agent Pipeline',
        actionTaken: 'S4HANA_CLOUDEVENT_TRIAGED',
        humanApprover: 'PENDING - SAP Event Mesh Auto-Ingest',
        actorRole: 'EVENT_MESH_WEBHOOK',
        decisionStatus: pipeline.selectedRoute?.approvalStatus || 'PENDING_HITL',
        aiConfidenceScore: 96.80,
        details: pipeline.executiveBrief
      });

      return res.status(202).json({
        specversion: '1.0',
        type: 'sap.pravah.a2a.resilience.triaged.v1',
        source: '/sap/btp/pravah-a2a/orchestrator',
        time: new Date().toISOString(),
        inboundEventType: eventType,
        shipmentId,
        fallbackTriggered: pipeline.fallbackTriggered,
        recommendedRoute: pipeline.selectedRoute,
        financialRisk: pipeline.financialRisk,
        agentTrace: pipeline.agentTrace,
        auditHash: audit.currentHash,
        executiveBrief: pipeline.executiveBrief
      });
    } catch (e) {
      return res.status(500).json({ error: 'Event Mesh ingestion failed: ' + e.message });
    }
  });

  // ============================================================================
  // ACTIONABLE JOULE-COMPATIBLE COPILOT (Simulate / Compare / Audit / Q&A)
  // ============================================================================
  app.post('/api/copilot/ask', async (req, res) => {
    const user = extractAuthUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    const question = String(req.body?.question || '').trim();
    if (!question) return res.status(400).json({ error: 'Question required' });

    const db = await cds.connect.to('db');
    const qLower = question.toLowerCase();
    const shipMatch = question.match(/SHP-[A-Z0-9-]+/i);
    const targetShipId = shipMatch ? shipMatch[0].toUpperCase() : 'SHP-JNPT-001';

    // INTENT 1: TRIGGER SIMULATION (e.g. "Simulate a Red Sea blockage on SHP-JNPT-001" or "Test +6 day delay")
    if (/simulate|test\s*\+?\d+|trigger\s+crisis|run\s+triage|blockage/i.test(qLower)) {
      const shipment = await db.run(SELECT.one.from('pravah.a2a.Shipments').where({ shipmentId: targetShipId }));
      const batch = await db.run(SELECT.one.from('pravah.a2a.ReeferBatches').where({ shipmentId: targetShipId }));
      if (!shipment || !batch) {
        const msg = `Shipment ${targetShipId} was not found in SAP HANA Cloud. Try SHP-JNPT-001 through SHP-JNPT-016.`;
        return res.json({ answer: msg, reply: msg, intent: 'TRIGGER_SIMULATION', structuredData: null, suggestedFollowUps: ['Simulate a Red Sea blockage on SHP-JNPT-001'] });
      }

      const delayMatch = question.match(/\+?(\d+)\s*(?:day|d\b)/i);
      const tempMatch = question.match(/(\d+(?:\.\d+)?)\s*°?\s*c\b/i);
      const simulatedDelayDays = delayMatch ? Number(delayMatch[1]) : (qLower.includes('red sea') ? 6 : 0);
      const simulatedTempC = tempMatch ? Number(tempMatch[1]) : 9.4;
      const blockedChokepoint = qLower.includes('red sea') ? 'Red Sea' : (qLower.includes('hormuz') ? 'Strait of Hormuz' : '');

      const pipeline = await runResiliencePipeline({
        shipment,
        batch,
        telemetry: { eventType: 'JOULE_COPILOT_SIMULATION', chokepoint: blockedChokepoint || 'Strait of Hormuz', reeferTempC: simulatedTempC },
        cargoDomain: shipment.cargoDomain || 'PHARMA_COLD_CHAIN',
        cfoSpendCapINR: 500000,
        whatIf: { simulatedDelayDays, simulatedTempC, blockedChokepoint }
      });

      await db.run(UPDATE('pravah.a2a.Shipments').set({ status: 'ALERT_TRIGGERED' }).where({ shipmentId: targetShipId }));
      await db.run(UPDATE('pravah.a2a.ReeferBatches').set({ currentTempC: simulatedTempC, spoilageRiskFlag: simulatedTempC > 8 }).where({ shipmentId: targetShipId }));
      await db.run(DELETE.from('pravah.a2a.RerouteOptions').where({ shipmentId: targetShipId }));
      for (const opt of pipeline.routes) {
        await db.run(INSERT.into('pravah.a2a.RerouteOptions').entries({ shipmentId: targetShipId, ...opt }));
      }
      await appendHashAuditInDb(db, {
        shipmentId: targetShipId,
        agentName: 'Joule Copilot -> LangGraph StateGraph',
        actionTaken: 'COPILOT_WHATIF_SIMULATION',
        humanApprover: `PENDING - ${user.fullName}`,
        actorRole: resolveRbacRole(user),
        decisionStatus: pipeline.selectedRoute?.approvalStatus || 'PENDING_HITL',
        aiConfidenceScore: 96.90,
        details: pipeline.executiveBrief
      });

      return res.json({
        answer: pipeline.executiveBrief,
        reply: pipeline.executiveBrief,
        intent: 'TRIGGER_SIMULATION',
        liveLLM: Boolean(process.env.GEMINI_API_KEY),
        structuredData: {
          shipmentId: targetShipId,
          whatIf: { simulatedDelayDays, simulatedTempC, blockedChokepoint },
          fallbackTriggered: pipeline.fallbackTriggered,
          selectedRoute: pipeline.selectedRoute,
          financialRisk: pipeline.financialRisk,
          agentTrace: pipeline.agentTrace
        },
        suggestedFollowUps: [
          `Compare reroutes for ${targetShipId}`,
          'Verify EU AI Act audit chain',
          `Show CEPA duty savings for ${targetShipId}`
        ]
      });
    }

    // INTENT 2: COMPARE REROUTE OPTIONS
    if (/compare\s+reroute|compare\s+route|route\s+options|reroute\s+options/i.test(qLower)) {
      const opts = await db.run(SELECT.from('pravah.a2a.RerouteOptions').where({ shipmentId: targetShipId }).orderBy('recommended desc', 'totalCostINR asc'));
      if (opts.length === 0) {
        const msg = `No active reroute proposals exist yet for ${targetShipId}. Say "Simulate a Red Sea blockage on ${targetShipId}" to run the 4-agent LangGraph pipeline first.`;
        return res.json({ answer: msg, reply: msg, intent: 'COMPARE_REROUTES', structuredData: { shipmentId: targetShipId, options: [] }, suggestedFollowUps: [`Simulate a Red Sea blockage on ${targetShipId}`] });
      }
      const best = opts.find(o => o.recommended) || opts[0];
      const summary = `For ${targetShipId}, ${opts.length} corridors were evaluated: #1 recommended is ${best.routeName} at ₹${Number(best.totalCostINR).toLocaleString('en-IN')} ($${Number(best.totalCostUSD).toLocaleString('en-US')}, ${best.transitDays}d, ${best.cepaDutyPct}% duty), saving ₹${Number(best.savingsINR).toLocaleString('en-IN')} ($${Number(best.savingsUSD).toLocaleString('en-US')}) vs Gulf War Surcharge. Status: ${best.approvalStatus}.`;
      return res.json({
        answer: summary,
        reply: summary,
        intent: 'COMPARE_REROUTES',
        structuredData: { shipmentId: targetShipId, recommended: best, options: opts },
        suggestedFollowUps: ['Verify EU AI Act audit chain', 'Show CEPA duty savings']
      });
    }

    // INTENT 3: VERIFY AUDIT CHAIN OR SHOW CEPA DUTY SAVINGS
    if (/verify.*audit|audit\s+chain|hash\s+chain|cepa\s+duty|tariff\s+saving/i.test(qLower)) {
      const [chain, ships] = await Promise.all([
        verifyChainInDb(db),
        db.run(SELECT.from('pravah.a2a.Shipments'))
      ]);
      const totalValUSD = ships.reduce((s, x) => s + Number(x.cargoValueUSD || 0), 0);
      const totalValINR = ships.reduce((s, x) => s + Number(x.cargoValueINR || 0), 0);
      const cepaSaveUSD = Math.round(totalValUSD * 0.05);
      const cepaSaveINR = Math.round(totalValINR * 0.05);
      const msg = `SHA-256 EU AI Act Audit Ledger Verification: ${chain.valid ? 'VALID (0 tampering detected)' : 'BROKEN at ' + chain.brokenAtId} across ${chain.totalRecords} immutable HANA records. Across ${ships.length} active shipments, India–UAE CEPA 0% preferential duty (vs 5% standard GCC tariff) protects ₹${cepaSaveINR.toLocaleString('en-IN')} ($${cepaSaveUSD.toLocaleString('en-US')}) in customs savings.`;
      return res.json({
        answer: msg,
        reply: msg,
        intent: 'AUDIT_AND_TARIFF_QUERY',
        structuredData: { auditChain: chain, fleetCount: ships.length, cepaDutySavingsINR: cepaSaveINR, cepaDutySavingsUSD: cepaSaveUSD },
        suggestedFollowUps: ['Simulate a Red Sea blockage on SHP-JNPT-001', 'Compare reroutes for SHP-JNPT-001']
      });
    }

    // INTENT 4: GENERAL EXECUTIVE Q&A (Live Gemini Cascade + Topic-Aware Fallback)
    const [shipments, options, audits, sosList] = await Promise.all([
      db.run(SELECT.from('pravah.a2a.Shipments').limit(16)),
      db.run(SELECT.from('pravah.a2a.RerouteOptions').limit(8)),
      db.run(SELECT.from('pravah.a2a.AuditLogs').orderBy('createdAt desc').limit(5)),
      db.run(SELECT.from('pravah.a2a.MaritimeIncidents').orderBy('createdAt desc').limit(5)).catch(() => [])
    ]);
    const telem = getLiveTelemetry();
    const topShipsArr = [];
    for (const v of (telem.vessels || []).slice(0, 5)) {
      topShipsArr.push(v['name'] + ' (MMSI ' + v.mmsi + ', ' + v.sog + ' kn)');
    }
    const topShips = topShipsArr.join('; ');

    if (process.env.GEMINI_API_KEY) {
      const prompt = [
        `You are Pravah-A2A, an executive SAP BTP Supply Chain & Maritime Intelligence Copilot speaking to ${user.fullName} (${user.role}, ${user.companyName}).`,
        'STRICT INSTRUCTION: Answer the user\'s EXACT question directly and concisely (2-4 sentences). Do NOT repeat ship counts or generic telemetry unless the user specifically asks about live ships, AIS, Hormuz traffic, or weather.',
        'Capabilities: LangGraph 4-Agent StateGraph with Fujairah/Dubai Air-Sea self-correction, Arrhenius MKT & Batch VaR/ROI engine, 5 Cargo Domains (Pharma 2-8C/18d CEPA 0%, Agri/Urea 180d, Perishable Seafood 12d, Semiconductors JIT ₹8L/day penalty + ITA 0%, Hazmat IMDG Air Ban), CFO Spend-Cap Dual-Approval Lock, RBAC Dual Sign-Off (VP + QA Officer), SHA-256 hash-chained EU AI Act Art. 14 AuditLogs, and Maritime SOS Naval Dispatch (IFC-IOR/UKMTO/MRCC).',
        `Live HANA State: ${shipments.length} shipments | ${options.length} active reroute options | ${sosList.length} active SOS incidents | ${audits.length} recent audit logs.`,
        `Live Telemetry (ONLY cite if asked): AISStream=${telem.aisStatus} (${telem.vesselCount} ships), IMF PortWatch Hormuz=${telem.portWatch?.hormuzDailyTransits}/day, NOAA alerts=${telem.noaaActiveAlerts}.`,
        'User Question: ' + question
      ].join('\n');

      for (const model of ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash']) {
        try {
          const gUrl = ['https:', '', 'generativelanguage.googleapis.com', 'v1beta', 'models', model + ':generateContent'].join('/') + '?key=' + encodeURIComponent(process.env.GEMINI_API_KEY);
          const gRes = await fetch(gUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.3, maxOutputTokens: 320 } })
          });
          const gData = await gRes.json();
          const text = gData?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {
            return res.json({
              answer: text.trim(),
              reply: text.trim(),
              intent: 'EXECUTIVE_QA',
              liveLLM: true,
              model,
              structuredData: null,
              suggestedFollowUps: ['Simulate a Red Sea blockage on SHP-JNPT-001', 'Verify EU AI Act audit chain']
            });
          }
        } catch {}
      }
    }

    let fallback = '';
    if (/sos|navy|pirate|missile|drone|terror|ukmto|ifc|coast guard|blast/.test(qLower)) {
      fallback = sosList.length
        ? `Active Maritime SOS ${sosList[0].incidentCode} (${sosList[0].incidentType}) is persisted in HANA Cloud with an Indian Navy IFC-IOR / UKMTO / MRCC Mumbai packet alerting ${sosList[0].affectedShipments} fleet shipments.`
        : 'Pravah-A2A generates standardized Indian Navy IFC-IOR, UKMTO, and Coast Guard MRCC Mumbai distress packets in HANA Cloud and computes Fleet-Wide Blast Radius protection.';
    } else if (/cfo|cap|spend|budget|cost|saving|air/.test(qLower)) {
      fallback = 'The CFO Spend-Cap Guardrail (₹5,00,000 / $6,000) triggers a Dual-Approval Lock on expensive air routes (₹9,66,000), while Jeddah Intermodal (₹3,52,800 / $4,200) saves ₹2,77,200 vs Gulf War Surcharge.';
    } else if (/hazmat|chemical|imdg|semiconductor|urea|shrimp|domain|cargo/.test(qLower)) {
      fallback = 'Pravah-A2A supports 5 sea-export verticals: Pharma (2–8°C, CEPA 0%), Agri/Urea (180d), Perishable Seafood (12d), Semiconductors JIT (₹8L/day penalty, ITA 0%), and Hazmat Chemicals (IMDG Air Cargo Ban).';
    } else if (/ship|ais|vessel|hormuz|noaa|weather|telemetry/.test(qLower)) {
      fallback = `Live telemetry: AISStream reports ${telem.vesselCount} vessels${topShips ? ' (' + topShips + ')' : ''}, IMF PortWatch shows ${telem.portWatch?.hormuzDailyTransits ?? 'N/A'} daily Hormuz transits, and NOAA reports ${telem.noaaActiveAlerts ?? 0} alerts.`;
    } else {
      fallback = `Pravah-A2A monitors ${shipments.length} shipments on SAP BTP + HANA Cloud with a LangGraph 4-agent StateGraph, Arrhenius MKT/VaR math, RBAC Dual Sign-Off, SHA-256 audit chain, and Maritime SOS dispatch.`;
    }
    return res.json({
      answer: fallback,
      reply: fallback,
      intent: 'EXECUTIVE_QA',
      liveLLM: false,
      structuredData: null,
      suggestedFollowUps: ['Simulate a Red Sea blockage on SHP-JNPT-001', 'Verify EU AI Act audit chain']
    });
  });

  // ============================================================================
  // MULTI-TENANT SAAS AUTHENTICATION (with RBAC Role)
  // ============================================================================
  app.post('/api/auth/login', async (req, res) => {
    try {
      const email = String(req.body?.email || '').trim().toLowerCase();
      const password = String(req.body?.password || '');
      if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
      const db = await cds.connect.to('db');
      const user = await db.run(SELECT.one.from('pravah.a2a.TenantUsers').where({ email }));
      if (!user || !user.active || !verifyPassword(password, user.passwordHash)) {
        return res.status(401).json({ error: 'Invalid credentials or inactive subscription.' });
      }
      const profile = {
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        rbacRole: resolveRbacRole(user),
        companyName: user.companyName,
        corridor: user.corridor,
        subscriptionTier: user.subscriptionTier
      };
      return res.json({ token: signToken(profile), user: profile });
    } catch { return res.status(500).json({ error: 'Authentication service unavailable.' }); }
  });

  app.post('/api/auth/register', async (req, res) => {
    try {
      const email = String(req.body?.email || '').trim().toLowerCase();
      const password = String(req.body?.password || '');
      const fullName = String(req.body?.fullName || '').trim();
      const companyName = String(req.body?.companyName || '').trim();
      const role = String(req.body?.role || 'VP Supply Chain').trim();
      const rbacRole = ['ANALYST', 'QA_PHARMA_OFFICER', 'SUPPLY_CHAIN_VP'].includes(req.body?.rbacRole)
        ? req.body.rbacRole
        : 'SUPPLY_CHAIN_VP';
      const corridor = String(req.body?.corridor || 'India JNPT -> Global Corridor').trim();
      if (!email || !email.includes('@') || password.length < 8 || !fullName || !companyName) {
        return res.status(400).json({ error: 'Valid corporate email, company name, full name, and 8+ char password required.' });
      }
      const db = await cds.connect.to('db');
      const exists = await db.run(SELECT.one.from('pravah.a2a.TenantUsers').where({ email }));
      if (exists) return res.status(409).json({ error: 'Account already subscribed. Please sign in.' });
      await db.run(INSERT.into('pravah.a2a.TenantUsers').entries({
        email, fullName, role, rbacRole, companyName, corridor, subscriptionTier: 'PREMIUM_SAAS',
        passwordHash: hashPassword(password), active: true
      }));
      const profile = { email, fullName, role, rbacRole, companyName, corridor, subscriptionTier: 'PREMIUM_SAAS' };
      return res.status(201).json({ token: signToken(profile), user: profile });
    } catch { return res.status(500).json({ error: 'Registration failed.' }); }
  });

  app.get('/api/auth/me', (req, res) => {
    const user = extractAuthUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    return res.json({ user });
  });
});

export default cds.server;
