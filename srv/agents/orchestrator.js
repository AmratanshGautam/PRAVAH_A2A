import fs from 'fs';
import { StateGraph, Annotation, START, END } from '@langchain/langgraph';

const routeMatrix = JSON.parse(fs.readFileSync(new URL('../assets/data/route_rate_matrix.json', import.meta.url), 'utf8'));
const cepaTariffs = JSON.parse(fs.readFileSync(new URL('../assets/data/cepa_gcc_tariffs.json', import.meta.url), 'utf8'));
const ragDocs = JSON.parse(fs.readFileSync(new URL('../assets/rag/compliance_governance_docs.json', import.meta.url), 'utf8'));

const FX_INR_PER_USD = 84;

export const CARGO_DOMAINS = {
  PHARMA_COLD_CHAIN: {
    key: 'PHARMA_COLD_CHAIN',
    label: 'Pharma & Biologics',
    usitcKeyword: 'insulin',
    defaultHs: '3004.31.00.10 (CEPA RoO: CTSH + ≥40% QVC & Direct Consignment; CoO attached)',
    defaultProduct: 'Insulin Glargine Biologics',
    tempRange: '2°C–8°C Cold-Chain',
    shelfLifeDays: 18,
    bufferDays: 3,
    dutyPct: 0,
    standardDutyPct: 5,
    tradeAgreement: 'India–UAE CEPA 0% + WHO-GDP',
    imdgAirBan: false,
    jitBufferDays: null,
    lineDownPenaltyPerDayINR: 0,
    lineDownPenaltyPerDayUSD: 0,
    constraintSummary: 'Strict 2°C–8°C thermal band, 18d shelf life — blocks Cape Detour (+14d spoilage).'
  },
  AGRI_UREA_BULK: {
    key: 'AGRI_UREA_BULK',
    label: 'Agri-Inputs & Urea',
    usitcKeyword: 'urea',
    defaultHs: '3102.10.00.00',
    defaultProduct: 'Granular Prilled Urea (Bulk)',
    tempRange: 'Ambient Dry Bulk',
    shelfLifeDays: 180,
    bufferDays: 10,
    dutyPct: 0,
    standardDutyPct: 5,
    tradeAgreement: 'GCC–India Fertilizer Corridor (0% Preferential)',
    imdgAirBan: false,
    jitBufferDays: null,
    lineDownPenaltyPerDayINR: 0,
    lineDownPenaltyPerDayUSD: 0,
    constraintSummary: '180d shelf life, planting-season deadline — avoids $3,500 Gulf war surcharge.'
  },
  PERISHABLE_FOOD: {
    key: 'PERISHABLE_FOOD',
    label: 'Perishable Food / Seafood',
    usitcKeyword: 'shrimp',
    defaultHs: '0306.17.00.03',
    defaultProduct: 'Frozen Vannamei Shrimp / Seafood',
    tempRange: '-18°C / 0°C–4°C Reefer',
    shelfLifeDays: 12,
    bufferDays: 2,
    dutyPct: 0,
    standardDutyPct: 5,
    tradeAgreement: 'India–UAE CEPA 0% + Phytosanitary Gate',
    imdgAirBan: false,
    jitBufferDays: null,
    lineDownPenaltyPerDayINR: 0,
    lineDownPenaltyPerDayUSD: 0,
    constraintSummary: 'Ultra-short 12d shelf life — blocks both Cape (+14d) & Delayed Gulf.'
  },
  SEMICONDUCTOR_JIT: {
    key: 'SEMICONDUCTOR_JIT',
    label: 'Semiconductors (JIT)',
    usitcKeyword: 'processors',
    defaultHs: '8542.31.00.01',
    defaultProduct: 'Automotive Silicon Wafers & SoCs',
    tempRange: 'Shock/Moisture Controlled (15°C–25°C)',
    shelfLifeDays: 365,
    bufferDays: 0,
    dutyPct: 0,
    standardDutyPct: 5,
    tradeAgreement: 'WTO ITA 0% Duty',
    imdgAirBan: false,
    jitBufferDays: 5,
    lineDownPenaltyPerDayINR: 800000,
    lineDownPenaltyPerDayUSD: 9524,
    constraintSummary: '₹8L/day fab line-down penalty past 5d buffer — dynamically weighs Air vs Jeddah Sea-Air.'
  },
  CHEMICALS_HAZMAT: {
    key: 'CHEMICALS_HAZMAT',
    label: 'Specialty Chemicals (Hazmat)',
    usitcKeyword: 'chemicals',
    defaultHs: '2902.50.00.00',
    defaultProduct: 'Specialty Industrial Solvents (IMDG Class 3)',
    tempRange: 'Ventilated Hazmat ISO Tank (<30°C)',
    shelfLifeDays: 365,
    bufferDays: 5,
    dutyPct: 2.5,
    standardDutyPct: 5,
    tradeAgreement: 'IMDG Maritime Code + NOAA Storm Check',
    imdgAirBan: true,
    jitBufferDays: null,
    lineDownPenaltyPerDayINR: 0,
    lineDownPenaltyPerDayUSD: 0,
    constraintSummary: 'IMDG Dangerous Goods Air Ban — auto-blocks Panic Spot Air.'
  }
};

export function getCargoDomainProfile(domainKey = 'PHARMA_COLD_CHAIN') {
  return CARGO_DOMAINS[domainKey] || CARGO_DOMAINS.PHARMA_COLD_CHAIN;
}

export function checkBatchShelfLife(remainingShelfLifeDays, transitDays, bufferDays = 3) {
  const viable = (transitDays + bufferDays) < remainingShelfLifeDays;
  return { viable, spoilageFlag: !viable, marginDays: remainingShelfLifeDays - transitDays };
}

export function queryCEPATariff(hsCode) {
  return cepaTariffs.find(t => t.hsCode === hsCode) || cepaTariffs[0];
}

/**
 * Deterministic Pharmaceutical Mean Kinetic Temperature (MKT) & Batch Value-at-Risk (VaR) Engine
 * Uses Arrhenius activation energy ratio (DeltaH / R = 10000 K) for biologic thermal degradation.
 */
export function calculateThermalSpoilageRisk(
  tempHistory = [4.2, 4.5, 5.1, 6.8],
  currentTemp = 8.9,
  remainingShelfLifeDays = 18,
  batchValueUSD = 250000,
  rerouteCostUSD = 4200
) {
  const samples = Array.isArray(tempHistory) && tempHistory.length > 0
    ? [...tempHistory, Number(currentTemp)]
    : [4.5, 5.2, Number(currentTemp)];

  const dHOverR = 10000; // 83.144 kJ/mol / 8.31446 J/(mol*K)
  let expSum = 0;
  let excursionSamples = 0;
  let cumulativeDegreeHours = 0;

  for (const tC of samples) {
    const val = Number(tC);
    const tK = val + 273.15;
    expSum += Math.exp(-dHOverR / tK);
    if (val > 8.0) {
      excursionSamples++;
      cumulativeDegreeHours += (val - 8.0) * 2; // assume 2h telemetry interval
    } else if (val < 2.0) {
      excursionSamples++;
      cumulativeDegreeHours += (2.0 - val) * 2;
    }
  }

  const mktK = dHOverR / (-Math.log(expSum / samples.length));
  const mktC = Number((mktK - 273.15).toFixed(2));
  const driftAboveSafe = Math.max(0, Number(currentTemp) - 8.0);
  const shelfLifeLossDays = Math.min(remainingShelfLifeDays, Math.round(driftAboveSafe * 1.4 + (mktC > 8 ? (mktC - 8) * 1.2 : 0)));
  const effectiveShelfLifeDays = Math.max(1, remainingShelfLifeDays - shelfLifeLossDays);

  const spoilageRiskPct = Number(
    Math.min(98, Math.max(4, driftAboveSafe * 18 + (mktC > 7.5 ? (mktC - 7.5) * 14 : 4) + (effectiveShelfLifeDays < 10 ? 22 : 0))).toFixed(1)
  );

  const batchVal = Number(batchValueUSD || 250000);
  const batchVaRUSD = Math.round(batchVal * (spoilageRiskPct / 100));
  const baselineSeaUSD = 7500; // Gulf + $3,500 war surcharge
  const cepaDutySavingsUSD = Math.round(batchVal * 0.05); // 5% standard GCC duty -> 0% India-UAE CEPA
  const rerouteIncrementalCostUSD = Math.max(500, Math.round(Number(rerouteCostUSD || 4200) - 4000));
  const netProtectedValueUSD = Math.max(0, batchVaRUSD + cepaDutySavingsUSD - rerouteIncrementalCostUSD);
  const roiRatio = Number((netProtectedValueUSD / Math.max(1, Number(rerouteCostUSD || 4200))).toFixed(2));

  return {
    mktC,
    currentTempC: Number(currentTemp),
    excursionSamples,
    cumulativeDegreeHours: Number(cumulativeDegreeHours.toFixed(1)),
    originalShelfLifeDays: remainingShelfLifeDays,
    shelfLifeLossDays,
    effectiveShelfLifeDays,
    spoilageRiskPct,
    batchValueUSD: batchVal,
    batchVaRUSD,
    batchVaRINR: Math.round(batchVaRUSD * FX_INR_PER_USD),
    cepaDutySavingsUSD,
    cepaDutySavingsINR: Math.round(cepaDutySavingsUSD * FX_INR_PER_USD),
    rerouteIncrementalCostUSD,
    netProtectedValueUSD,
    netProtectedValueINR: Math.round(netProtectedValueUSD * FX_INR_PER_USD),
    roiRatio,
    baselineCompareUSD: baselineSeaUSD
  };
}

export async function lookupUsitcHts(keyword = 'insulin', fallback = null) {
  const fb = fallback || { htsno: '3004.31.00.10 (CEPA RoO: CTSH + ≥40% QVC & Direct Consignment; CoO attached)', description: 'Insulin Glargine (cached)', general: 'Free' };
  const url = ['https:', '', 'hts.usitc.gov', 'reststop', 'search'].join('/') + '?keyword=' + encodeURIComponent(keyword);
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const top = Array.isArray(data) ? data.find(d => d.htsno) : null;
    return top
      ? { htsno: top.htsno, description: top.description, general: top.general || 'Free', live: true, keyword }
      : { ...fb, live: false, keyword };
  } catch {
    return { ...fb, live: false, keyword };
  }
}

export function calculateRouteCost(batch, tariff, options = {}) {
  const domain = getCargoDomainProfile(options.cargoDomain || 'PHARMA_COLD_CHAIN');
  const cfoSpendCapINR = Number(options.cfoSpendCapINR) > 0 ? Number(options.cfoSpendCapINR) : 500000;
  const simulatedDelayDays = Math.max(0, Number(options.simulatedDelayDays || 0));
  const blockedChokepoint = String(options.blockedChokepoint || '').toLowerCase();

  const effectiveShelfLife = domain.key === 'PHARMA_COLD_CHAIN'
    ? (options.effectiveShelfLifeDays ?? batch?.remainingShelfLifeDays ?? domain.shelfLifeDays)
    : domain.shelfLifeDays;

  const baselineINR = 630000;
  const baselineUSD = 7500;
  const dutyPct = domain.key === 'PHARMA_COLD_CHAIN'
    ? (tariff?.cepaPreferentialDutyPct ?? 0)
    : domain.dutyPct;

  const evaluated = [];
  for (const r of routeMatrix) {
    const adjustedTransitDays = r.transitDays + (r.routeId === 'RT-PANIC-AIR' ? 0 : simulatedDelayDays);
    const shelf = checkBatchShelfLife(effectiveShelfLife, adjustedTransitDays, domain.bufferDays);
    const isAirRoute = /air/i.test(r.mode || '') || r.routeId === 'RT-PANIC-AIR';
    const imdgBlocked = domain.imdgAirBan && isAirRoute;
    const chokepointBlocked = Boolean(blockedChokepoint) &&
      ((blockedChokepoint.includes('jeddah') && r.routeId === 'RT-JEDDAH-INTERMODAL') ||
       (blockedChokepoint.includes('hormuz') && r.routeId === 'RT-BASELINE-GULF') ||
       (blockedChokepoint.includes('red sea') && r.routeId === 'RT-JEDDAH-INTERMODAL'));

    const lateDays = domain.jitBufferDays !== null ? Math.max(0, adjustedTransitDays - domain.jitBufferDays) : 0;
    const lineDownINR = lateDays * domain.lineDownPenaltyPerDayINR;
    const lineDownUSD = lateDays * domain.lineDownPenaltyPerDayUSD;

    const economicCostINR = r.totalCostINR + lineDownINR;
    const economicCostUSD = r.totalCostUSD + lineDownUSD;
    const cfoCapExceeded = r.totalCostINR > cfoSpendCapINR;
    const viable = shelf.viable && !imdgBlocked && !chokepointBlocked;

    let complianceNote = `${domain.tradeAgreement} | Duty: ${dutyPct}%`;
    if (imdgBlocked) complianceNote = 'BLOCKED: IMDG Dangerous Goods Air Cargo Prohibition';
    else if (chokepointBlocked) complianceNote = `BLOCKED: Chokepoint Closure (${options.blockedChokepoint})`;
    else if (!shelf.viable) complianceNote = `BLOCKED: Spoilage Risk (${adjustedTransitDays}d transit vs ${effectiveShelfLife}d effective shelf life)`;
    else if (cfoCapExceeded) complianceNote += ` | CFO Dual-Approval Lock (> INR ${cfoSpendCapINR.toLocaleString('en-IN')})`;

    let rationale = '';
    if (imdgBlocked) {
      rationale = `AUTO-REJECTED by Agent 03 (${domain.label}): Air transport prohibited under IMDG Hazmat regulations.`;
    } else if (chokepointBlocked) {
      rationale = `AUTO-REJECTED by Agent 01/02: Corridor blocked by active "${options.blockedChokepoint}" disruption.`;
    } else if (!shelf.viable) {
      rationale = `AUTO-REJECTED by Agent 02 (${domain.label}): ${adjustedTransitDays}d transit exceeds ${effectiveShelfLife}d effective shelf life (spoilage risk).`;
    } else if (lineDownINR > 0) {
      rationale = `${r.notes} | Freight INR ${r.totalCostINR.toLocaleString('en-IN')} + JIT Line-Down Penalty INR ${lineDownINR.toLocaleString('en-IN')} (${lateDays}d late).`;
    } else {
      rationale = `${r.notes} | ${domain.tradeAgreement} | Margin: ${shelf.marginDays}d shelf life left.`;
    }

    evaluated.push({
      routeId: r.routeId,
      routeName: r['name'],
      mode: r.mode,
      cargoDomain: domain.key,
      transitDays: adjustedTransitDays,
      warRiskSurchargeUSD: r.warRiskSurchargeUSD,
      cepaDutyPct: dutyPct,
      totalCostINR: r.totalCostINR,
      totalCostUSD: r.totalCostUSD,
      economicCostINR,
      economicCostUSD,
      savingsINR: Math.max(0, baselineINR - r.totalCostINR),
      savingsUSD: Math.max(0, baselineUSD - r.totalCostUSD),
      coldChainSafe: (domain.key === 'AGRI_UREA_BULK' || domain.key === 'CHEMICALS_HAZMAT' || domain.key === 'SEMICONDUCTOR_JIT')
        ? viable
        : (r.coldChainSafe && viable),
      spoilageFlag: !shelf.viable || chokepointBlocked,
      cfoCapExceeded,
      cfoCapThresholdINR: cfoSpendCapINR,
      complianceNote,
      viable,
      recommended: false,
      approvalStatus: imdgBlocked
        ? 'AUTO_REJECTED_IMDG_BAN'
        : (chokepointBlocked ? 'AUTO_REJECTED_BLOCKED' : (!shelf.viable ? 'AUTO_REJECTED_SPOILAGE' : 'ALTERNATIVE')),
      rationale
    });
  }

  const viableRoutes = evaluated.filter(r => r.viable);
  if (viableRoutes.length > 0) {
    viableRoutes.sort((a, b) => a.economicCostINR - b.economicCostINR);
    const best = viableRoutes[0];
    best.recommended = true;
    best.approvalStatus = best.cfoCapExceeded ? 'PENDING_CFO_DUAL_APPROVAL' : 'PENDING_HITL';
  }

  const cleaned = [];
  for (const item of evaluated) {
    const { economicCostINR, economicCostUSD, viable, ...clean } = item;
    cleaned.push(clean);
  }
  return cleaned;
}

export function calculateBlastRadius(shipments = [], corridor = 'Strait of Hormuz') {
  const affected = shipments.filter(s =>
    /hormuz|gulf|arabian|red sea|oman|jnpt/i.test(`${s.corridor || ''} ${s.destination || ''} ${corridor}`)
  );
  const protectedValueINR = affected.reduce((sum, s) => sum + Number(s.cargoValueINR || 0), 0);
  const protectedValueUSD = affected.reduce((sum, s) => sum + Number(s.cargoValueUSD || 0), 0);
  const affectedShipmentIds = [];
  for (const s of affected) affectedShipmentIds.push(s.shipmentId);
  return {
    corridor,
    affectedCount: affected.length,
    totalFleetCount: shipments.length,
    protectedValueINR,
    protectedValueUSD,
    affectedShipmentIds
  };
}

export function buildNavalDistressPacket(incident, blastRadius) {
  const timestampUtc = new Date().toISOString();
  return {
    protocolVersion: 'PRAVAH-SOS-IFC-IOR-UKMTO-v1.0',
    gatewayMode: 'PROTOTYPE_SIMULATED_DISPATCH',
    disclaimer: 'Prototype dispatch packet persisted in SAP HANA Cloud. Production deployment connects directly to official IMO/UKMTO/IFC-IOR/MRCC gateways.',
    incidentCode: incident.incidentCode,
    timestampUtc,
    severity: incident.severity || 'CRITICAL',
    incidentType: incident.incidentType,
    targetAgencies: [
      'Indian Navy IFC-IOR (Information Fusion Centre – Indian Ocean Region, Gurugram)',
      'UKMTO (UK Maritime Trade Operations – Dubai/UK Watchkeeper)',
      'Indian Coast Guard MRCC (Maritime Rescue Coordination Centre, Mumbai)'
    ],
    vessel: {
      vesselName: incident.vesselName,
      mmsi: incident.vesselMMSI,
      shipmentId: incident.shipmentId,
      cargoCriticality: incident.cargoCriticality
    },
    position: {
      latitude: Number(incident.latitude),
      longitude: Number(incident.longitude),
      corridor: incident.corridor,
      dangerRadiusNM: Number(incident.dangerRadiusNM || 50)
    },
    threat: {
      source: incident.threatSource,
      bearingDegrees: Number(incident.threatBearingDeg || 0)
    },
    fleetBlastRadius: {
      vesselsAlerted: blastRadius.affectedCount,
      protectedCargoValueINR: blastRadius.protectedValueINR,
      protectedCargoValueUSD: blastRadius.protectedValueUSD
    },
    reportedBy: incident.reportedBy
  };
}

export async function generateSafeGuardBrief(shipment, batch, crisis, recommendedRoute, usitcResult, cargoDomain = 'PHARMA_COLD_CHAIN', financialRisk = null, fallbackTriggered = false) {
  const domain = getCargoDomainProfile(cargoDomain);
  const cfoNote = recommendedRoute.cfoCapExceeded
    ? ` CFO Dual-Approval Lock triggered (exceeds INR ${Number(recommendedRoute.cfoCapThresholdINR).toLocaleString('en-IN')} spend cap).`
    : '';
  const mktNote = financialRisk
    ? ` MKT ${financialRisk.mktC}°C (${financialRisk.spoilageRiskPct}% spoilage risk, VaR $${financialRisk.batchVaRUSD.toLocaleString('en-US')}, ROI ${financialRisk.roiRatio}x).`
    : '';
  const fbNote = fallbackTriggered
    ? ' LangGraph self-correction activated Fujairah/Dubai Air-Sea Multimodal Fallback.'
    : '';

  const fallbackBrief = `Agent 04 (Safe Guard) [${domain.label}] recommends ${recommendedRoute.routeName} at INR ${recommendedRoute.totalCostINR.toLocaleString('en-IN')} ($${recommendedRoute.totalCostUSD.toLocaleString('en-US')}), saving INR ${recommendedRoute.savingsINR.toLocaleString('en-IN')} ($${recommendedRoute.savingsUSD.toLocaleString('en-US')}) vs Gulf War Surcharge.${mktNote}${fbNote} USITC HTS ${usitcResult.htsno} (${usitcResult.general}), ${domain.tradeAgreement}.${cfoNote} Held at HITL gate per EU AI Act Art. 14(4) for executive sign-off.`;

  if (!process.env.GEMINI_API_KEY) return fallbackBrief;

  try {
    const prompt = `You are Agent 04 (The Safe Guard) inside SAP Pravah-A2A briefing an executive.
Cargo Domain: ${domain.label}. Multimodal Self-Correction Triggered: ${fallbackTriggered}.
MKT & VaR: ${financialRisk ? JSON.stringify({ mktC: financialRisk.mktC, spoilageRiskPct: financialRisk.spoilageRiskPct, batchVaRUSD: financialRisk.batchVaRUSD, netProtectedValueUSD: financialRisk.netProtectedValueUSD, roiRatio: financialRisk.roiRatio }) : 'N/A'}.
In 2-3 concise sentences, summarize why we recommend "${recommendedRoute.routeName}" (INR ${recommendedRoute.totalCostINR} / USD ${recommendedRoute.totalCostUSD}) for shipment ${shipment.shipmentId} (${batch.product}) during "${crisis.eventType}". Cite MKT/VaR protection, EU AI Act Article 14(4) HITL approval, ${domain.tradeAgreement} (USITC HTS ${usitcResult.htsno}), and CFO Dual-Approval Lock if active (${recommendedRoute.cfoCapExceeded}).`;

    const geminiUrl = ['https:', '', 'generativelanguage.googleapis.com', 'v1beta', 'models', 'gemini-2.5-flash:generateContent'].join('/') + '?key=' + process.env.GEMINI_API_KEY;
    const res = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 200 }
      })
    });
    if (!res.ok) return fallbackBrief;
    const json = await res.json();
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    return text || fallbackBrief;
  } catch {
    return fallbackBrief;
  }
}

export function getComplianceCitations() {
  return { euAiAct: ragDocs[1].source, cepa: ragDocs[2].source };
}

// ============================================================================
// FORMAL @langchain/langgraph STATEGRAPH (Watcher -> Planner -> Bookmaker -> [Fallback] -> SafeGuard)
// ============================================================================
const PravahGraphState = Annotation.Root({
  shipment: Annotation(),
  batch: Annotation(),
  telemetry: Annotation(),
  cargoDomain: Annotation(),
  cfoSpendCapINR: Annotation(),
  whatIf: Annotation(),
  usitcResult: Annotation(),
  candidateRoutes: Annotation(),
  rejectedRoutes: Annotation(),
  selectedRoute: Annotation(),
  financialRisk: Annotation(),
  fallbackTriggered: Annotation(),
  agentTrace: Annotation({
    reducer: (prev, next) => (prev || []).concat(next || []),
    default: () => []
  }),
  executiveBrief: Annotation()
});

async function watcherNode(state) {
  const whatIf = state.whatIf || {};
  const effectiveTempC = whatIf.simulatedTempC !== undefined && whatIf.simulatedTempC !== null
    ? Number(whatIf.simulatedTempC)
    : Number(state.telemetry?.reeferTempC ?? state.batch?.currentTempC ?? 8.9);

  const tempHistory = [4.2, 4.6, 5.4, Math.max(5.8, effectiveTempC - 1.1)];
  const risk = calculateThermalSpoilageRisk(
    tempHistory,
    effectiveTempC,
    Number(state.batch?.remainingShelfLifeDays ?? 18),
    Number(state.shipment?.cargoValueUSD ?? 250000),
    4200
  );

  return {
    telemetry: { ...state.telemetry, reeferTempC: effectiveTempC },
    financialRisk: risk,
    agentTrace: [{
      agent: 'Agent 01 - The Watcher',
      timestampUtc: new Date().toISOString(),
      status: 'COMPLETED',
      summary: `Ingested disruption at ${whatIf.blockedChokepoint || state.telemetry?.chokepoint || 'Strait of Hormuz'}. Probe ${effectiveTempC}°C -> MKT ${risk.mktC}°C, Spoilage Risk ${risk.spoilageRiskPct}%, Effective Shelf Life ${risk.effectiveShelfLifeDays}d, Batch VaR $${risk.batchVaRUSD.toLocaleString('en-US')}.`
    }]
  };
}

async function plannerNode(state) {
  const domain = getCargoDomainProfile(state.cargoDomain);
  const tariff = queryCEPATariff(state.batch?.hsCode || domain.defaultHs);
  const allOptions = calculateRouteCost(state.batch, tariff, {
    cargoDomain: state.cargoDomain,
    cfoSpendCapINR: state.cfoSpendCapINR,
    simulatedDelayDays: state.whatIf?.simulatedDelayDays || 0,
    blockedChokepoint: state.whatIf?.blockedChokepoint || '',
    effectiveShelfLifeDays: state.financialRisk?.effectiveShelfLifeDays
  });

  const candidates = [];
  const rejected = [];
  for (const r of allOptions) {
    if (String(r.approvalStatus || '').startsWith('AUTO_REJECTED')) rejected.push(r);
    else candidates.push(r);
  }

  return {
    candidateRoutes: candidates,
    rejectedRoutes: rejected,
    agentTrace: [{
      agent: 'Agent 02 - The Planner',
      timestampUtc: new Date().toISOString(),
      status: 'COMPLETED',
      summary: `[${domain.label}] Evaluated ${allOptions.length} corridors with ${state.whatIf?.simulatedDelayDays || 0}d extra delay. Viable: ${candidates.length}, Auto-Rejected: ${rejected.length}.`
    }]
  };
}

async function bookmakerNode(state) {
  const domain = getCargoDomainProfile(state.cargoDomain);
  const usitc = await lookupUsitcHts(domain.usitcKeyword, {
    htsno: domain.defaultHs,
    description: domain.defaultProduct + ' (cached)',
    general: 'Free'
  });

  const allRoutes = [...(state.candidateRoutes || []), ...(state.rejectedRoutes || [])];
  const recommended = (state.candidateRoutes || []).find(r => r.recommended) || (state.candidateRoutes || [])[0] || null;
  const updatedRisk = calculateThermalSpoilageRisk(
    [4.2, 4.6, 5.4],
    Number(state.telemetry?.reeferTempC ?? 8.9),
    Number(state.batch?.remainingShelfLifeDays ?? 18),
    Number(state.shipment?.cargoValueUSD ?? 250000),
    recommended ? recommended.totalCostUSD : 4200
  );

  return {
    usitcResult: usitc,
    selectedRoute: recommended,
    financialRisk: updatedRisk,
    agentTrace: [{
      agent: 'Agent 03 - The Bookmaker',
      timestampUtc: new Date().toISOString(),
      status: 'COMPLETED',
      summary: `USITC HTS ${usitc.htsno} (${usitc.live ? 'Live API' : 'Cached'}). Primary candidate: ${recommended ? recommended.routeName : 'NONE'}. Net Protected Value: $${updatedRisk.netProtectedValueUSD.toLocaleString('en-US')} (ROI ${updatedRisk.roiRatio}x).`
    }]
  };
}

function routeAfterBookmaker(state) {
  const domain = getCargoDomainProfile(state.cargoDomain);
  const seaCandidates = (state.candidateRoutes || []).filter(r => !/air/i.test(r.mode || '') && r.routeId !== 'RT-PANIC-AIR');
  const severeThermalExcursion = Number(state.financialRisk?.spoilageRiskPct || 0) >= 70 && domain.key === 'PHARMA_COLD_CHAIN';
  const noViableSea = seaCandidates.length === 0 && !domain.imdgAirBan;

  if (noViableSea || severeThermalExcursion) {
    return 'multimodalFallback';
  }
  return 'safeguard';
}

async function multimodalFallbackNode(state) {
  const domain = getCargoDomainProfile(state.cargoDomain);
  const capINR = Number(state.cfoSpendCapINR || 500000);
  const costINR = 487200;
  const costUSD = 5800;
  const cfoCapExceeded = costINR > capINR;

  const fallbackRoute = {
    routeId: 'RT-FUJAIRAH-AIR-SEA',
    routeName: 'Fujairah / Dubai Air-Sea Express Multimodal Fallback',
    mode: 'Sea-Air Express (Cold-Chain)',
    cargoDomain: domain.key,
    transitDays: 3,
    warRiskSurchargeUSD: 0,
    cepaDutyPct: 0,
    totalCostINR: costINR,
    totalCostUSD: costUSD,
    savingsINR: Math.max(0, 630000 - costINR),
    savingsUSD: Math.max(0, 7500 - costUSD),
    coldChainSafe: true,
    spoilageFlag: false,
    cfoCapExceeded,
    cfoCapThresholdINR: capINR,
    complianceNote: `${domain.tradeAgreement} | LangGraph Self-Correction Multimodal Corridor`,
    recommended: true,
    approvalStatus: cfoCapExceeded ? 'PENDING_CFO_DUAL_APPROVAL' : 'PENDING_HITL',
    rationale: `LANGGRAPH SELF-CORRECTION: Standard sea corridors failed shelf-life/spoilage gate (${state.financialRisk?.spoilageRiskPct}% risk, ${state.financialRisk?.effectiveShelfLifeDays}d effective shelf life). Rerouted via 3-day Fujairah/Dubai Air-Sea Express at INR 4,87,200 ($5,800) with 0% CEPA duty.`
  };

  const demoted = [];
  for (const r of (state.candidateRoutes || [])) {
    demoted.push({ ...r, recommended: false, approvalStatus: r.approvalStatus === 'PENDING_HITL' ? 'ALTERNATIVE' : r.approvalStatus });
  }

  const updatedRisk = calculateThermalSpoilageRisk(
    [4.2, 4.6, 5.4],
    Number(state.telemetry?.reeferTempC ?? 8.9),
    Number(state.batch?.remainingShelfLifeDays ?? 18),
    Number(state.shipment?.cargoValueUSD ?? 250000),
    costUSD
  );

  return {
    candidateRoutes: [fallbackRoute, ...demoted],
    selectedRoute: fallbackRoute,
    fallbackTriggered: true,
    financialRisk: updatedRisk,
    agentTrace: [{
      agent: 'LangGraph Self-Correction -> Multimodal Fallback Node',
      timestampUtc: new Date().toISOString(),
      status: 'TRIGGERED',
      summary: `All standard sea options failed thermal/shelf-life threshold. Activated Fujairah/Dubai Air-Sea Express (3d, INR 4,87,200 / $5,800, ROI ${updatedRisk.roiRatio}x).`
    }]
  };
}

async function safeguardNode(state) {
  const chosen = state.selectedRoute || (state.candidateRoutes || [])[0] || (state.rejectedRoutes || [])[0];
  const brief = await generateSafeGuardBrief(
    state.shipment,
    state.batch,
    state.telemetry,
    chosen,
    state.usitcResult || { htsno: '3004.31.00.10 (CEPA RoO: CTSH + ≥40% QVC & Direct Consignment; CoO attached)', general: 'Free', live: false },
    state.cargoDomain,
    state.financialRisk,
    Boolean(state.fallbackTriggered)
  );

  const highRiskDual = Number(state.shipment?.cargoValueUSD || 0) > 250000 || Number(state.telemetry?.reeferTempC || 0) > 8.0;

  return {
    executiveBrief: brief,
    agentTrace: [{
      agent: 'Agent 04 - The Safe Guard',
      timestampUtc: new Date().toISOString(),
      status: 'AWAITING_HITL',
      summary: `EU AI Act Art. 14(4) Gate Active (${highRiskDual ? 'Dual Sign-Off Required: VP + QA Officer' : 'Standard Executive HITL'}). Recommendation: ${chosen?.routeName}.`
    }]
  };
}

const resilienceGraph = new StateGraph(PravahGraphState)
  .addNode('watcher', watcherNode)
  .addNode('planner', plannerNode)
  .addNode('bookmaker', bookmakerNode)
  .addNode('multimodalFallback', multimodalFallbackNode)
  .addNode('safeguard', safeguardNode)
  .addEdge(START, 'watcher')
  .addEdge('watcher', 'planner')
  .addEdge('planner', 'bookmaker')
  .addConditionalEdges('bookmaker', routeAfterBookmaker, {
    multimodalFallback: 'multimodalFallback',
    safeguard: 'safeguard'
  })
  .addEdge('multimodalFallback', 'safeguard')
  .addEdge('safeguard', END)
  .compile();

export async function runResiliencePipeline({
  shipment,
  batch,
  telemetry,
  cargoDomain = 'PHARMA_COLD_CHAIN',
  cfoSpendCapINR = 500000,
  whatIf = {}
}) {
  const result = await resilienceGraph.invoke({
    shipment,
    batch,
    telemetry,
    cargoDomain,
    cfoSpendCapINR,
    whatIf,
    fallbackTriggered: false,
    agentTrace: []
  });

  const allRoutes = [...(result.candidateRoutes || []), ...(result.rejectedRoutes || [])];
  return {
    routes: allRoutes,
    selectedRoute: result.selectedRoute,
    financialRisk: result.financialRisk,
    fallbackTriggered: Boolean(result.fallbackTriggered),
    usitcResult: result.usitcResult,
    agentTrace: result.agentTrace || [],
    executiveBrief: result.executiveBrief
  };
}
