import fs from 'fs';

const routeMatrix = JSON.parse(fs.readFileSync(new URL('../assets/data/route_rate_matrix.json', import.meta.url), 'utf8'));
const cepaTariffs = JSON.parse(fs.readFileSync(new URL('../assets/data/cepa_gcc_tariffs.json', import.meta.url), 'utf8'));
const ragDocs = JSON.parse(fs.readFileSync(new URL('../assets/rag/compliance_governance_docs.json', import.meta.url), 'utf8'));

export const CARGO_DOMAINS = {
  PHARMA_COLD_CHAIN: {
    key: 'PHARMA_COLD_CHAIN',
    label: 'Pharma & Biologics',
    usitcKeyword: 'insulin',
    defaultHs: '3004.31.00.10',
    defaultProduct: 'Insulin Glargine Biologics',
    tempRange: '2°C–8°C Cold-Chain',
    shelfLifeDays: 18,
    bufferDays: 3,
    dutyPct: 0,
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
    tradeAgreement: 'GCC–India Fertilizer Corridor (0% Preferential)',
    imdgAirBan: false,
    jitBufferDays: null,
    lineDownPenaltyPerDayINR: 0,
    lineDownPenaltyPerDayUSD: 0,
    constraintSummary: '180d shelf life, planting-season deadline — avoids $3,500 Gulf war surcharge & farmer price doubling.'
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
    tradeAgreement: 'India–UAE CEPA 0% + Phytosanitary Gate',
    imdgAirBan: false,
    jitBufferDays: null,
    lineDownPenaltyPerDayINR: 0,
    lineDownPenaltyPerDayUSD: 0,
    constraintSummary: 'Ultra-short 12d shelf life — blocks both Cape (+14d) & Delayed Gulf, forces 7d Jeddah Intermodal.'
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
    tradeAgreement: 'IMDG Maritime Code + NOAA Storm Check',
    imdgAirBan: true,
    jitBufferDays: null,
    lineDownPenaltyPerDayINR: 0,
    lineDownPenaltyPerDayUSD: 0,
    constraintSummary: 'IMDG Dangerous Goods Air Ban — auto-blocks Panic Spot Air and routes via bonded sea/land-bridge.'
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

export async function lookupUsitcHts(keyword = 'insulin', fallback = null) {
  const fb = fallback || { htsno: '3004.31.00.10', description: 'Insulin Glargine (cached)', general: 'Free' };
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
  const effectiveShelfLife = domain.key === 'PHARMA_COLD_CHAIN'
    ? (batch?.remainingShelfLifeDays ?? domain.shelfLifeDays)
    : domain.shelfLifeDays;

  const baselineINR = 630000;
  const baselineUSD = 7500;
  const dutyPct = domain.key === 'PHARMA_COLD_CHAIN'
    ? (tariff?.cepaPreferentialDutyPct ?? 0)
    : domain.dutyPct;

  const evaluated = [];
  for (const r of routeMatrix) {
    const shelf = checkBatchShelfLife(effectiveShelfLife, r.transitDays, domain.bufferDays);
    const isAirRoute = /air/i.test(r.mode || '') || r.routeId === 'RT-PANIC-AIR';
    const imdgBlocked = domain.imdgAirBan && isAirRoute;

    const lateDays = domain.jitBufferDays !== null ? Math.max(0, r.transitDays - domain.jitBufferDays) : 0;
    const lineDownINR = lateDays * domain.lineDownPenaltyPerDayINR;
    const lineDownUSD = lateDays * domain.lineDownPenaltyPerDayUSD;

    const economicCostINR = r.totalCostINR + lineDownINR;
    const economicCostUSD = r.totalCostUSD + lineDownUSD;
    const cfoCapExceeded = r.totalCostINR > cfoSpendCapINR;
    const viable = shelf.viable && !imdgBlocked;

    let complianceNote = `${domain.tradeAgreement} | Duty: ${dutyPct}%`;
    if (imdgBlocked) complianceNote = 'BLOCKED: IMDG Dangerous Goods Air Cargo Prohibition';
    else if (!shelf.viable) complianceNote = `BLOCKED: Spoilage Risk (${r.transitDays}d transit vs ${effectiveShelfLife}d shelf life)`;
    else if (cfoCapExceeded) complianceNote += ` | CFO Dual-Approval Lock (> INR ${cfoSpendCapINR.toLocaleString('en-IN')})`;

    let rationale = '';
    if (imdgBlocked) {
      rationale = `AUTO-REJECTED by Agent 03 (${domain.label}): Air transport prohibited under IMDG Hazmat regulations.`;
    } else if (!shelf.viable) {
      rationale = `AUTO-REJECTED by Agent 02 (${domain.label}): ${r.transitDays}d transit exceeds ${effectiveShelfLife}d shelf life (spoilage risk).`;
    } else if (lineDownINR > 0) {
      rationale = `${r.notes} | Freight INR ${r.totalCostINR.toLocaleString('en-IN')} + JIT Line-Down Penalty INR ${lineDownINR.toLocaleString('en-IN')} (${lateDays}d late) = INR ${economicCostINR.toLocaleString('en-IN')}.`;
    } else {
      rationale = `${r.notes} | ${domain.tradeAgreement} | Margin: ${shelf.marginDays}d shelf life left.`;
    }

    evaluated.push({
      routeId: r.routeId,
      routeName: r['name'],
      mode: r.mode,
      cargoDomain: domain.key,
      transitDays: r.transitDays,
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
      spoilageFlag: !shelf.viable,
      imdgBlocked,
      cfoCapExceeded,
      cfoCapThresholdINR: cfoSpendCapINR,
      complianceNote,
      viable,
      recommended: false,
      approvalStatus: imdgBlocked
        ? 'AUTO_REJECTED_IMDG_BAN'
        : (!shelf.viable ? 'AUTO_REJECTED_SPOILAGE' : 'ALTERNATIVE'),
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
    const { economicCostINR, economicCostUSD, imdgBlocked, viable, ...clean } = item;
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

export async function generateSafeGuardBrief(shipment, batch, crisis, recommendedRoute, usitcResult, cargoDomain = 'PHARMA_COLD_CHAIN') {
  const domain = getCargoDomainProfile(cargoDomain);
  const cfoNote = recommendedRoute.cfoCapExceeded
    ? ` CFO Dual-Approval Lock triggered (exceeds INR ${Number(recommendedRoute.cfoCapThresholdINR).toLocaleString('en-IN')} spend cap).`
    : '';
  const fallbackBrief = `Agent 04 (Safe Guard) [${domain.label}] recommends ${recommendedRoute.routeName} at INR ${recommendedRoute.totalCostINR.toLocaleString('en-IN')} ($${recommendedRoute.totalCostUSD.toLocaleString('en-US')}), saving INR ${recommendedRoute.savingsINR.toLocaleString('en-IN')} ($${recommendedRoute.savingsUSD.toLocaleString('en-US')}) vs Gulf War Surcharge. USITC HTS ${usitcResult.htsno} (${usitcResult.general}), ${domain.tradeAgreement}.${cfoNote} Held at HITL gate per EU AI Act Art. 14(4) for executive sign-off.`;

  if (!process.env.GEMINI_API_KEY) return fallbackBrief;

  try {
    const prompt = `You are Agent 04 (The Safe Guard) inside SAP Pravah-A2A briefing an executive.
Cargo Domain: ${domain.label} (${domain.constraintSummary}).
In 2 concise sentences, summarize why we recommend "${recommendedRoute.routeName}" (INR ${recommendedRoute.totalCostINR} / USD ${recommendedRoute.totalCostUSD}) for shipment ${shipment.shipmentId} (${batch.product}) during "${crisis.eventType}". Cite EU AI Act Article 14(4) HITL approval, ${domain.tradeAgreement} (USITC HTS ${usitcResult.htsno}), and mention if CFO Dual-Approval Lock is active (${recommendedRoute.cfoCapExceeded}).`;

    const geminiUrl = ['https:', '', 'generativelanguage.googleapis.com', 'v1beta', 'models', 'gemini-2.5-flash:generateContent'].join('/') + '?key=' + process.env.GEMINI_API_KEY;
    const res = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 180 }
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
