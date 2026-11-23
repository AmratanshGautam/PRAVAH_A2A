import cds from '@sap/cds';
import crypto from 'crypto';
import fs from 'fs';
import { hashPassword, verifyToken } from './auth.js';
import {
  getCargoDomainProfile,
  runResiliencePipeline,
  calculateBlastRadius,
  buildNavalDistressPacket,
  getComplianceCitations
} from './agents/orchestrator.js';

const GENESIS_HASH = 'GENESIS_PRAVAH_A2A_2026';

export function computeAuditHash(previousHash, entry) {
  const payload = [
    String(previousHash || GENESIS_HASH),
    String(entry.shipmentId || ''),
    String(entry.actionTaken || ''),
    String(entry.humanApprover || ''),
    String(entry.decisionStatus || ''),
    String(entry.details || '')
  ].join('|');
  return crypto.createHash('sha256').update(payload).digest('hex');
}

export function resolveRbacRole(user) {
  if (!user) return 'ANALYST';
  if (user.rbacRole && ['ANALYST', 'QA_PHARMA_OFFICER', 'SUPPLY_CHAIN_VP'].includes(user.rbacRole)) {
    return user.rbacRole;
  }
  const combined = `${user.role || ''} ${user.email || ''}`.toLowerCase();
  if (combined.includes('qa') || combined.includes('khalid') || combined.includes('3pl')) return 'QA_PHARMA_OFFICER';
  if (combined.includes('analyst')) return 'ANALYST';
  return 'SUPPLY_CHAIN_VP';
}

export default cds.service.impl(async function () {
  const {
    Shipments,
    ReeferBatches,
    ComplianceDocs,
    ColdChainExcursions,
    RerouteOptions,
    MaritimeIncidents,
    AuditLogs
  } = this.entities;

  async function appendImmutableAuditLog(entry) {
    const latest = await SELECT.from(AuditLogs).orderBy('createdAt desc', 'ID desc').limit(1);
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
      aiConfidenceScore: entry.aiConfidenceScore ?? 96.40,
      policyVersion: entry.policyVersion || 'PRAVAH-GOV-2.1',
      previousHash,
      details: String(entry.details || '').slice(0, 1990)
    };
    record.currentHash = computeAuditHash(previousHash, record);
    await INSERT.into(AuditLogs).entries(record);
    return record;
  }

  cds.on('served', async () => {
    const db = await cds.connect.to('db');
    const seedUsers = [
      { email: 'rajesh.nair@hyderabadpharma.in', fullName: 'VP Rajesh Nair', role: 'VP Cold-Chain Logistics', rbacRole: 'SUPPLY_CHAIN_VP', companyName: 'Deccan Biologics Ltd (Hyderabad)', corridor: 'Hyderabad -> JNPT -> Gulf', subscriptionTier: 'ENTERPRISE_A2A' },
      { email: 'ananya.deshmukh@ciplaexports.in', fullName: 'Ananya Deshmukh', role: 'Director Global Exports', rbacRole: 'SUPPLY_CHAIN_VP', companyName: 'WestCoast Pharma Exports (Mumbai)', corridor: 'Mumbai JNPT -> Jeddah / EU', subscriptionTier: 'PREMIUM_SAAS' },
      { email: 'khalid.mansoor@gulfmed3pl.ae', fullName: 'Dr. Khalid Al-Mansoor', role: 'Head of Cold-Chain 3PL & QA', rbacRole: 'QA_PHARMA_OFFICER', companyName: 'GulfMed Bonded Logistics (Dubai JAFZA)', corridor: 'JNPT -> Jebel Ali -> GCC', subscriptionTier: 'PREMIUM_SAAS' },
      { email: 'qa.officer@hyderabadpharma.in', fullName: 'Dr. Meera Iyer', role: 'QA Pharma Compliance Officer', rbacRole: 'QA_PHARMA_OFFICER', companyName: 'Deccan Biologics Ltd (Hyderabad)', corridor: 'Hyderabad -> JNPT -> Gulf', subscriptionTier: 'ENTERPRISE_A2A' },
      { email: 'analyst@hyderabadpharma.in', fullName: 'Rohan Kulkarni', role: 'Supply Chain Operations Analyst', rbacRole: 'ANALYST', companyName: 'Deccan Biologics Ltd (Hyderabad)', corridor: 'Hyderabad -> JNPT -> Gulf', subscriptionTier: 'ENTERPRISE_A2A' }
    ];
    for (const u of seedUsers) {
      const exists = await db.run(SELECT.one.from('pravah.a2a.TenantUsers').where({ email: u.email }));
      if (!exists) {
        await db.run(INSERT.into('pravah.a2a.TenantUsers').entries({
          ...u,
          passwordHash: hashPassword('Pravah@2026'),
          active: true
        }));
      } else if (!exists.rbacRole) {
        await db.run(UPDATE('pravah.a2a.TenantUsers').set({ rbacRole: u.rbacRole }).where({ email: u.email }));
      }
    }

    const existing = await SELECT.from(Shipments).limit(1);
    if (existing.length === 0) {
      const shipments = JSON.parse(fs.readFileSync(new URL('./assets/data/pharma_reefer_shipments.json', import.meta.url), 'utf8'));
      const ragDocs = JSON.parse(fs.readFileSync(new URL('./assets/rag/compliance_governance_docs.json', import.meta.url), 'utf8'));
      for (const s of shipments) {
        await INSERT.into(Shipments).entries({
          shipmentId: s.shipmentId, batchId: s.batchId, product: s.product,
          hsCode: s.hsCode, origin: s.origin, destination: s.destination,
          containerType: s.containerType, vesselMMSI: s.vesselMMSI, corridor: s.corridor,
          cargoDomain: 'PHARMA_COLD_CHAIN',
          cargoValueINR: s.cargoValueINR, cargoValueUSD: s.cargoValueUSD, status: s.status
        });
        await INSERT.into(ReeferBatches).entries({
          batchId: s.batchId, shipmentId: s.shipmentId, product: s.product,
          hsCode: s.hsCode, tempMinC: s.tempMinC, tempMaxC: s.tempMaxC,
          currentTempC: s.currentTempC, remainingShelfLifeDays: s.remainingShelfLifeDays,
          spoilageRiskFlag: false
        });
      }
      await INSERT.into(ComplianceDocs).entries(ragDocs);
    }
  });

  function requireAuth(req) {
    const h = Object.assign({}, req.headers || {}, req._?.req?.headers || {});
    const rawTok = h['x-pravah-token'];
    const authHdr = rawTok ? ('Bearer ' + rawTok) : h.authorization;
    const user = verifyToken(authHdr);
    if (!user) {
      req.error(401, 'Unauthorized: Valid Premium SaaS Bearer token required.');
      return null;
    }
    return user;
  }

  this.on('triggerCrisis', async (req) => {
    const user = requireAuth(req);
    if (!user) return;
    const d = req.data;
    const cargoDomain = d.cargoDomain || 'PHARMA_COLD_CHAIN';
    const cfoSpendCapINR = Number(d.cfoSpendCapINR) > 0 ? Number(d.cfoSpendCapINR) : 500000;
    const domain = getCargoDomainProfile(cargoDomain);
    const effectiveTempC = d.simulatedTempC !== undefined && d.simulatedTempC !== null
      ? Number(d.simulatedTempC)
      : Number(d.reeferTempC ?? 8.9);

    const shipment = await SELECT.one.from(Shipments).where({ shipmentId: d.shipmentId });
    const batch = await SELECT.one.from(ReeferBatches).where({ shipmentId: d.shipmentId });
    if (!shipment || !batch) return req.error(404, `Shipment ${d.shipmentId} not found`);

    await INSERT.into(ColdChainExcursions).entries({
      shipmentId: d.shipmentId,
      eventType: d.eventType || 'HORMUZ_STALL_EXCURSION',
      chokepoint: d.blockedChokepoint || d.chokepoint || 'Strait of Hormuz',
      vesselSogKnots: Number(d.vesselSogKnots ?? 0.4),
      aisDarkMinutes: Number(d.aisDarkMinutes ?? 45),
      reeferTempC: effectiveTempC,
      doorOpen: Boolean(d.doorOpen),
      severity: d.severity || 'CRITICAL',
      detectedBy: 'Agent 01 - The Watcher (LangGraph)'
    });
    await UPDATE(Shipments).set({ status: 'ALERT_TRIGGERED', cargoDomain }).where({ shipmentId: d.shipmentId });
    await UPDATE(ReeferBatches).set({ currentTempC: effectiveTempC, spoilageRiskFlag: effectiveTempC > 8.0 || effectiveTempC < 2.0 }).where({ shipmentId: d.shipmentId });

    const pipeline = await runResiliencePipeline({
      shipment,
      batch,
      telemetry: { ...d, reeferTempC: effectiveTempC },
      cargoDomain,
      cfoSpendCapINR,
      whatIf: {
        simulatedDelayDays: d.simulatedDelayDays,
        simulatedTempC: d.simulatedTempC,
        blockedChokepoint: d.blockedChokepoint
      }
    });

    await DELETE.from(RerouteOptions).where({ shipmentId: d.shipmentId });
    for (const opt of pipeline.routes) {
      await INSERT.into(RerouteOptions).entries({ shipmentId: d.shipmentId, ...opt });
    }

    const allShipments = await SELECT.from(Shipments);
    const blast = calculateBlastRadius(allShipments, d.blockedChokepoint || d.chokepoint || 'Strait of Hormuz');
    const recommended = pipeline.selectedRoute || pipeline.routes[0];
    const citations = getComplianceCitations();
    const usitc = pipeline.usitcResult || { htsno: domain.defaultHs, live: false };
    const blastSummary = ` Fleet Blast Radius: ${blast.affectedCount}/${blast.totalFleetCount} shipments flagged (INR ${blast.protectedValueINR.toLocaleString('en-IN')} / USD ${blast.protectedValueUSD.toLocaleString('en-US')} protected).`;

    await appendImmutableAuditLog({
      shipmentId: d.shipmentId,
      agentName: `LangGraph 4-Agent StateGraph (${domain.label})`,
      actionTaken: pipeline.fallbackTriggered
        ? 'LANGGRAPH_MULTIMODAL_FALLBACK_HITL'
        : (recommended?.cfoCapExceeded ? 'CRISIS_TRIAGE_CFO_LOCK' : 'CRISIS_TRIAGE_AWAITING_HITL'),
      euAiActClause: citations.euAiAct,
      cepaCitation: `${domain.tradeAgreement} | USITC ${usitc.htsno} (${usitc.live ? 'Live API' : 'Cached'})`,
      humanApprover: `PENDING - ${user.fullName} (${user.companyName})`,
      actorRole: resolveRbacRole(user),
      decisionStatus: recommended?.approvalStatus || 'PENDING_HITL',
      aiConfidenceScore: pipeline.fallbackTriggered ? 94.80 : 97.20,
      policyVersion: 'PRAVAH-GOV-2.1',
      details: pipeline.executiveBrief + blastSummary
    });

    return pipeline.executiveBrief + blastSummary;
  });

  this.on('reportMaritimeSOS', async (req) => {
    const user = requireAuth(req);
    if (!user) return;
    const d = req.data;
    const allShipments = await SELECT.from(Shipments);
    const corridor = d.corridor || 'Strait of Hormuz / Arabian Sea';
    const blast = calculateBlastRadius(allShipments, corridor);
    const incidentCode = 'SOS-' + new Date().getUTCFullYear() + '-' + String(Date.now()).slice(-4);
    const targetAgencies = 'Indian Navy IFC-IOR (Gurugram) | UKMTO | Indian Coast Guard MRCC (Mumbai)';

    const incidentRecord = {
      incidentCode,
      incidentType: d.incidentType || 'MISSILE_DRONE',
      severity: d.severity || 'CRITICAL',
      vesselName: d.vesselName || 'MV Deccan Reefer',
      vesselMMSI: d.vesselMMSI || '419001234',
      shipmentId: d.shipmentId || 'SHP-JNPT-001',
      latitude: Number(d.latitude ?? 26.5667),
      longitude: Number(d.longitude ?? 56.2500),
      threatBearingDeg: Number(d.threatBearingDeg ?? 215),
      threatSource: d.threatSource || 'Unidentified aerial/surface contact',
      corridor,
      cargoCriticality: d.cargoCriticality || 'Life-Saving Cold-Chain Biologics (2-8C)',
      targetAgencies,
      affectedShipments: blast.affectedCount,
      protectedValueINR: blast.protectedValueINR,
      protectedValueUSD: blast.protectedValueUSD,
      dangerRadiusNM: Number(d.dangerRadiusNM ?? 50),
      reportedBy: `${user.fullName} (${user.companyName})`,
      status: 'DISPATCHED_PROTOTYPE'
    };

    const packet = buildNavalDistressPacket(incidentRecord, blast);
    incidentRecord.dispatchPacketJson = JSON.stringify(packet, null, 2);

    await INSERT.into(MaritimeIncidents).entries(incidentRecord);

    if (incidentRecord.shipmentId) {
      await UPDATE(Shipments).set({ status: 'ALERT_TRIGGERED' }).where({ shipmentId: incidentRecord.shipmentId });
    }

    await appendImmutableAuditLog({
      shipmentId: incidentRecord.shipmentId,
      agentName: 'Agent 01 (Watcher) -> Naval SOS Dispatch',
      actionTaken: `MARITIME_SOS_${incidentRecord.incidentType}`,
      euAiActClause: 'Regulation (EU) 2024/1689 - Article 14(4) Emergency Oversight',
      cepaCitation: targetAgencies,
      humanApprover: incidentRecord.reportedBy,
      actorRole: resolveRbacRole(user),
      decisionStatus: 'DISPATCHED_PROTOTYPE',
      aiConfidenceScore: 99.00,
      policyVersion: 'PRAVAH-GOV-2.1',
      details: `${incidentCode} at (${incidentRecord.latitude}, ${incidentRecord.longitude}), bearing ${incidentRecord.threatBearingDeg} deg. Fleet Blast Radius: ${blast.affectedCount} vessels / INR ${blast.protectedValueINR.toLocaleString('en-IN')} ($${blast.protectedValueUSD.toLocaleString('en-US')}) alerted.`
    });

    return JSON.stringify(packet);
  });

  this.on('approveReroute', async (req) => {
    const user = requireAuth(req);
    if (!user) return;
    const actorRole = resolveRbacRole(user);
    if (actorRole === 'ANALYST') {
      return req.error(403, 'RBAC Denied: ANALYST role has triage/read access only. SUPPLY_CHAIN_VP or QA_PHARMA_OFFICER required for sign-off.');
    }

    const { optionId } = req.data;
    const opt = await SELECT.one.from(RerouteOptions).where({ ID: optionId });
    if (!opt) return req.error(404, 'Reroute option not found');

    const shipment = await SELECT.one.from(Shipments).where({ shipmentId: opt.shipmentId });
    const batch = await SELECT.one.from(ReeferBatches).where({ shipmentId: opt.shipmentId });
    const approverLabel = `${user.fullName} (${user.companyName})`;

    const requiresDualSignOff =
      Number(shipment?.cargoValueUSD || 0) > 250000 ||
      Number(shipment?.cargoValueINR || 0) > 20000000 ||
      Number(batch?.currentTempC || 0) > 8.0 ||
      Boolean(opt.cfoCapExceeded);

    if (requiresDualSignOff && opt.approvalStatus !== 'PENDING_QA_COUNTERSIGN') {
      await UPDATE(RerouteOptions).set({
        approvalStatus: 'PENDING_QA_COUNTERSIGN',
        firstApprover: approverLabel,
        firstApproverRole: actorRole
      }).where({ ID: optionId });

      await appendImmutableAuditLog({
        shipmentId: opt.shipmentId,
        agentName: 'Agent 04 - The Safe Guard (RBAC Dual-HITL)',
        actionTaken: 'HITL_DUAL_FIRST_SIGNOFF',
        euAiActClause: 'Regulation (EU) 2024/1689 - Article 14(4) High-Risk Dual Oversight',
        cepaCitation: opt.complianceNote || 'India-UAE CEPA Ch. 30 (0% Preferential Duty)',
        humanApprover: approverLabel,
        actorRole,
        decisionStatus: 'PENDING_QA_COUNTERSIGN',
        aiConfidenceScore: 97.50,
        policyVersion: 'PRAVAH-GOV-2.1',
        details: `First approval recorded by ${actorRole} (${approverLabel}) for ${opt.routeName}. High-risk batch (> $250k or > 8°C excursion) requires second countersignature from a distinct authorized role.`
      });

      return `PENDING_QA_COUNTERSIGN: First sign-off recorded by ${actorRole} (${approverLabel}). Awaiting second authorization from a distinct role (QA_PHARMA_OFFICER / SUPPLY_CHAIN_VP).`;
    }

    if (opt.approvalStatus === 'PENDING_QA_COUNTERSIGN' && opt.firstApproverRole === actorRole) {
      return req.error(403, `Dual-Approval Violation: Cannot self-countersign as ${actorRole}. Requires a distinct authorized role (e.g., QA_PHARMA_OFFICER vs SUPPLY_CHAIN_VP).`);
    }

    const dualNote = opt.approvalStatus === 'PENDING_QA_COUNTERSIGN'
      ? ` [Dual Sign-Off Completed: ${opt.firstApproverRole} + ${actorRole}]`
      : '';
    await UPDATE(RerouteOptions).set({ approvalStatus: 'APPROVED' }).where({ ID: optionId });
    await UPDATE(Shipments).set({ status: 'REROUTED' }).where({ shipmentId: opt.shipmentId });

    await appendImmutableAuditLog({
      shipmentId: opt.shipmentId,
      agentName: 'Agent 04 - The Safe Guard',
      actionTaken: opt.approvalStatus === 'PENDING_QA_COUNTERSIGN' ? 'HITL_DUAL_FINAL_APPROVED' : 'HITL_REROUTE_APPROVED',
      euAiActClause: 'Regulation (EU) 2024/1689 - Article 14(4)',
      cepaCitation: opt.complianceNote || 'India-UAE CEPA Ch. 30 (0% Preferential Duty)',
      humanApprover: approverLabel,
      actorRole,
      decisionStatus: 'APPROVED',
      aiConfidenceScore: 98.10,
      policyVersion: 'PRAVAH-GOV-2.1',
      details: `Approved ${opt.routeName} (INR ${opt.totalCostINR} / USD ${opt.totalCostUSD}) saving INR ${opt.savingsINR} / USD ${opt.savingsUSD}.${dualNote}`
    });
    return `APPROVED: ${opt.routeName} finalized by ${actorRole} (${approverLabel}).${dualNote}`;
  });

  this.on('rejectReroute', async (req) => {
    const user = requireAuth(req);
    if (!user) return;
    const { optionId, reason } = req.data;
    const opt = await SELECT.one.from(RerouteOptions).where({ ID: optionId });
    if (!opt) return req.error(404, 'Reroute option not found');
    const approverLabel = `${user.fullName} (${user.companyName})`;
    await UPDATE(RerouteOptions).set({ approvalStatus: 'REJECTED' }).where({ ID: optionId });
    await appendImmutableAuditLog({
      shipmentId: opt.shipmentId,
      agentName: 'Agent 04 - The Safe Guard',
      actionTaken: 'HITL_REROUTE_REJECTED',
      euAiActClause: 'Regulation (EU) 2024/1689 - Article 14(4)(e) Override',
      cepaCitation: 'N/A',
      humanApprover: approverLabel,
      actorRole: resolveRbacRole(user),
      decisionStatus: 'REJECTED',
      aiConfidenceScore: 95.00,
      policyVersion: 'PRAVAH-GOV-2.1',
      details: reason || `Overridden at HITL gate by ${approverLabel}.`
    });
    return `REJECTED: ${opt.routeName} overridden by ${approverLabel}.`;
  });

  this.on('verifyAuditChain', async () => {
    const logs = await SELECT.from(AuditLogs).orderBy('createdAt asc', 'ID asc');
    let expectedPrev = GENESIS_HASH;
    for (const row of logs) {
      if (row.previousHash !== expectedPrev) {
        return { valid: false, totalRecords: logs.length, brokenAtId: row.ID };
      }
      const recomputed = computeAuditHash(expectedPrev, row);
      if (row.currentHash !== recomputed) {
        return { valid: false, totalRecords: logs.length, brokenAtId: row.ID };
      }
      expectedPrev = row.currentHash;
    }
    return { valid: true, totalRecords: logs.length, brokenAtId: '' };
  });

  this.on('resetDemo', async (req) => {
    const user = requireAuth(req);
    if (!user) return;
    await DELETE.from(ColdChainExcursions);
    await DELETE.from(RerouteOptions);
    await DELETE.from(MaritimeIncidents);
    await DELETE.from(AuditLogs);
    await UPDATE(Shipments).set({ status: 'IN_TRANSIT', cargoDomain: 'PHARMA_COLD_CHAIN' });
    await UPDATE(ReeferBatches).set({ currentTempC: 4.2, spoilageRiskFlag: false });
    return `DEMO_RESET_OK: All 16 shipments restored to IN_TRANSIT and SOS/crisis alerts cleared by ${user.fullName}.`;
  });
});
