import cds from '@sap/cds';
import fs from 'fs';
import { hashPassword, verifyToken } from './auth.js';
import {
  queryCEPATariff,
  lookupUsitcHts,
  calculateRouteCost,
  generateSafeGuardBrief,
  getComplianceCitations
} from './agents/orchestrator.js';

export default cds.service.impl(async function () {
  const { Shipments, ReeferBatches, ComplianceDocs, ColdChainExcursions, RerouteOptions, AuditLogs } = this.entities;

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
    const user = verifyToken(req.headers?.authorization);
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
    const shipment = await SELECT.one.from(Shipments).where({ shipmentId: d.shipmentId });
    const batch = await SELECT.one.from(ReeferBatches).where({ shipmentId: d.shipmentId });
    if (!shipment || !batch) return req.error(404, `Shipment ${d.shipmentId} not found`);

    await INSERT.into(ColdChainExcursions).entries({ ...d, detectedBy: 'Agent 01 - The Watcher' });
    await UPDATE(Shipments).set({ status: 'ALERT_TRIGGERED' }).where({ shipmentId: d.shipmentId });
    await UPDATE(ReeferBatches).set({ currentTempC: d.reeferTempC, spoilageRiskFlag: true }).where({ shipmentId: d.shipmentId });

    const tariff = queryCEPATariff(batch.hsCode);
    const usitc = await lookupUsitcHts('insulin');
    const options = calculateRouteCost(batch, tariff);

    await DELETE.from(RerouteOptions).where({ shipmentId: d.shipmentId });
    for (const opt of options) {
      await INSERT.into(RerouteOptions).entries({ shipmentId: d.shipmentId, ...opt });
    }

    const recommended = options.find(o => o.recommended) || options[0];
    const citations = getComplianceCitations();
    const brief = await generateSafeGuardBrief(shipment, batch, d, recommended, usitc);

    await INSERT.into(AuditLogs).entries({
      shipmentId: d.shipmentId,
      agentName: 'Pravah-A2A 4-Agent Pipeline',
      actionTaken: 'CRISIS_TRIAGE_AWAITING_HITL',
      euAiActClause: citations.euAiAct,
      cepaCitation: `${citations.cepa} | USITC ${usitc.htsno} (${usitc.live ? 'Live API' : 'Cached'})`,
      humanApprover: `PENDING - ${user.fullName} (${user.companyName})`,
      decisionStatus: 'PENDING_HITL',
      details: brief
    });
    return brief;
  });

  this.on('approveReroute', async (req) => {
    const user = requireAuth(req);
    if (!user) return;
    const { optionId } = req.data;
    const opt = await SELECT.one.from(RerouteOptions).where({ ID: optionId });
    if (!opt) return req.error(404, 'Reroute option not found');
    const approverLabel = `${user.fullName} (${user.companyName})`;
    await UPDATE(RerouteOptions).set({ approvalStatus: 'APPROVED' }).where({ ID: optionId });
    await UPDATE(Shipments).set({ status: 'REROUTED' }).where({ shipmentId: opt.shipmentId });
    await INSERT.into(AuditLogs).entries({
      shipmentId: opt.shipmentId,
      agentName: 'Agent 04 - The Safe Guard',
      actionTaken: 'HITL_REROUTE_APPROVED',
      euAiActClause: 'Regulation (EU) 2024/1689 - Article 14(4)',
      cepaCitation: 'India-UAE CEPA Ch. 30 (0% Preferential Duty)',
      humanApprover: approverLabel,
      decisionStatus: 'APPROVED',
      details: `Approved ${opt.routeName} (INR ${opt.totalCostINR} / USD ${opt.totalCostUSD}) saving INR ${opt.savingsINR} / USD ${opt.savingsUSD}.`
    });
    return `APPROVED: ${opt.routeName} signed off by ${approverLabel}.`;
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
});
