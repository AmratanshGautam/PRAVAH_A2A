import cds from '@sap/cds';
import fs from 'fs';
import { hashPassword, verifyToken } from './auth.js';
import {
  getCargoDomainProfile,
  queryCEPATariff,
  lookupUsitcHts,
  calculateRouteCost,
  calculateBlastRadius,
  buildNavalDistressPacket,
  generateSafeGuardBrief,
  getComplianceCitations
} from './agents/orchestrator.js';

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

  cds.on('served', async () => {
    const db = await cds.connect.to('db');
    const existingUsers = await db.run(SELECT.from('pravah.a2a.TenantUsers').limit(1));
    if (existingUsers.length === 0) {
      await db.run(INSERT.into('pravah.a2a.TenantUsers').entries([
        { email: 'rajesh.nair@hyderabadpharma.in', fullName: 'VP Rajesh Nair', role: 'VP Cold-Chain Logistics', companyName: 'Deccan Biologics Ltd (Hyderabad)', corridor: 'Hyderabad -> JNPT -> Gulf', subscriptionTier: 'ENTERPRISE_A2A', passwordHash: hashPassword('Pravah@2026'), active: true },
        { email: 'ananya.deshmukh@ciplaexports.in', fullName: 'Ananya Deshmukh', role: 'Director Global Exports', companyName: 'WestCoast Pharma Exports (Mumbai)', corridor: 'Mumbai JNPT -> Jeddah / EU', subscriptionTier: 'PREMIUM_SAAS', passwordHash: hashPassword('Pravah@2026'), active: true },
        { email: 'khalid.mansoor@gulfmed3pl.ae', fullName: 'Dr. Khalid Al-Mansoor', role: 'Head of Cold-Chain 3PL', companyName: 'GulfMed Bonded Logistics (Dubai JAFZA)', corridor: 'JNPT -> Jebel Ali -> GCC', subscriptionTier: 'PREMIUM_SAAS', passwordHash: hashPassword('Pravah@2026'), active: true }
      ]));
      console.log('✅ Seeded 3 Premium SaaS Tenant Users with salted scrypt hashes.');
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

    const shipment = await SELECT.one.from(Shipments).where({ shipmentId: d.shipmentId });
    const batch = await SELECT.one.from(ReeferBatches).where({ shipmentId: d.shipmentId });
    if (!shipment || !batch) return req.error(404, `Shipment ${d.shipmentId} not found`);

    await INSERT.into(ColdChainExcursions).entries({
      shipmentId: d.shipmentId,
      eventType: d.eventType,
      chokepoint: d.chokepoint,
      vesselSogKnots: d.vesselSogKnots,
      aisDarkMinutes: d.aisDarkMinutes,
      reeferTempC: d.reeferTempC,
      doorOpen: Boolean(d.doorOpen),
      severity: d.severity || 'CRITICAL',
      detectedBy: 'Agent 01 - The Watcher'
    });
    await UPDATE(Shipments).set({ status: 'ALERT_TRIGGERED', cargoDomain }).where({ shipmentId: d.shipmentId });
    await UPDATE(ReeferBatches).set({ currentTempC: d.reeferTempC, spoilageRiskFlag: true }).where({ shipmentId: d.shipmentId });

    const tariff = queryCEPATariff(batch.hsCode);
    const usitc = await lookupUsitcHts(domain.usitcKeyword, {
      htsno: domain.defaultHs,
      description: domain.defaultProduct + ' (cached)',
      general: 'Free'
    });
    const options = calculateRouteCost(batch, tariff, { cargoDomain, cfoSpendCapINR });

    await DELETE.from(RerouteOptions).where({ shipmentId: d.shipmentId });
    for (const opt of options) {
      await INSERT.into(RerouteOptions).entries({ shipmentId: d.shipmentId, ...opt });
    }

    const allShipments = await SELECT.from(Shipments);
    const blast = calculateBlastRadius(allShipments, d.chokepoint || 'Strait of Hormuz');
    const recommended = options.find(o => o.recommended) || options[0];
    const citations = getComplianceCitations();
    const brief = await generateSafeGuardBrief(shipment, batch, d, recommended, usitc, cargoDomain);
    const blastSummary = ` Fleet Blast Radius: ${blast.affectedCount}/${blast.totalFleetCount} shipments flagged (INR ${blast.protectedValueINR.toLocaleString('en-IN')} / USD ${blast.protectedValueUSD.toLocaleString('en-US')} protected).`;

    await INSERT.into(AuditLogs).entries({
      shipmentId: d.shipmentId,
      agentName: `Pravah-A2A 4-Agent Pipeline (${domain.label})`,
      actionTaken: recommended.cfoCapExceeded ? 'CRISIS_TRIAGE_CFO_LOCK' : 'CRISIS_TRIAGE_AWAITING_HITL',
      euAiActClause: citations.euAiAct,
      cepaCitation: `${domain.tradeAgreement} | USITC ${usitc.htsno} (${usitc.live ? 'Live API' : 'Cached'})`,
      humanApprover: `PENDING - ${user.fullName} (${user.companyName})`,
      decisionStatus: recommended.approvalStatus,
      details: brief + blastSummary
    });
    return brief + blastSummary;
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

    await INSERT.into(AuditLogs).entries({
      shipmentId: incidentRecord.shipmentId,
      agentName: 'Agent 01 (Watcher) -> Naval SOS Dispatch',
      actionTaken: `MARITIME_SOS_${incidentRecord.incidentType}`,
      euAiActClause: 'Regulation (EU) 2024/1689 - Article 14(4) Emergency Oversight',
      cepaCitation: targetAgencies,
      humanApprover: incidentRecord.reportedBy,
      decisionStatus: 'DISPATCHED_PROTOTYPE',
      details: `${incidentCode} at (${incidentRecord.latitude}, ${incidentRecord.longitude}), bearing ${incidentRecord.threatBearingDeg} deg. Fleet Blast Radius: ${blast.affectedCount} vessels / INR ${blast.protectedValueINR.toLocaleString('en-IN')} ($${blast.protectedValueUSD.toLocaleString('en-US')}) alerted.`
    });

    return JSON.stringify(packet);
  });

  this.on('approveReroute', async (req) => {
    const user = requireAuth(req);
    if (!user) return;
    const { optionId } = req.data;
    const opt = await SELECT.one.from(RerouteOptions).where({ ID: optionId });
    if (!opt) return req.error(404, 'Reroute option not found');
    const approverLabel = `${user.fullName} (${user.companyName})`;
    const cfoSuffix = opt.cfoCapExceeded ? ' [CFO Dual-Approval Cap Cleared]' : '';
    await UPDATE(RerouteOptions).set({ approvalStatus: 'APPROVED' }).where({ ID: optionId });
    await UPDATE(Shipments).set({ status: 'REROUTED' }).where({ shipmentId: opt.shipmentId });
    await INSERT.into(AuditLogs).entries({
      shipmentId: opt.shipmentId,
      agentName: 'Agent 04 - The Safe Guard',
      actionTaken: opt.cfoCapExceeded ? 'CFO_DUAL_APPROVAL_GRANTED' : 'HITL_REROUTE_APPROVED',
      euAiActClause: 'Regulation (EU) 2024/1689 - Article 14(4)',
      cepaCitation: opt.complianceNote || 'India-UAE CEPA Ch. 30 (0% Preferential Duty)',
      humanApprover: approverLabel,
      decisionStatus: 'APPROVED',
      details: `Approved ${opt.routeName} (INR ${opt.totalCostINR} / USD ${opt.totalCostUSD}) saving INR ${opt.savingsINR} / USD ${opt.savingsUSD}.${cfoSuffix}`
    });
    return `APPROVED: ${opt.routeName} signed off by ${approverLabel}.${cfoSuffix}`;
  });

  this.on('rejectReroute', async (req) => {
    const user = requireAuth(req);
    if (!user) return;
    const { optionId, reason } = req.data;
    const opt = await SELECT.one.from(RerouteOptions).where({ ID: optionId });
    if (!opt) return req.error(404, 'Reroute option not found');
    const approverLabel = `${user.fullName} (${user.companyName})`;
    await UPDATE(RerouteOptions).set({ approvalStatus: 'REJECTED' }).where({ ID: optionId });
    await INSERT.into(AuditLogs).entries({
      shipmentId: opt.shipmentId,
      agentName: 'Agent 04 - The Safe Guard',
      actionTaken: 'HITL_REROUTE_REJECTED',
      euAiActClause: 'Regulation (EU) 2024/1689 - Article 14(4)(e) Override',
      cepaCitation: 'N/A',
      humanApprover: approverLabel,
      decisionStatus: 'REJECTED',
      details: reason || `Overridden at HITL gate by ${approverLabel}.`
    });
    return `REJECTED: ${opt.routeName} overridden by ${approverLabel}.`;
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
