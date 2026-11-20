const fs = require('fs');

// 4.1 Synthetic S/4HANA & IBP Dataset (16 active 40-ft reefer shipments departing JNPT)
const shipments = [
  { shipmentId: "SHP-JNPT-001", batchId: "BCH-INS-2026-01", product: "Insulin Glargine (Biologic)", hsCode: "3004.31.00.10", origin: "Hyderabad -> JNPT", destination: "Jebel Ali, UAE", containerType: "40ft Reefer", tempMinC: 2.0, tempMaxC: 8.0, currentTempC: 4.2, remainingShelfLifeDays: 18, cargoValueINR: 18500000, cargoValueUSD: 220000, vesselMMSI: "419001234", corridor: "Hormuz/Gulf", status: "IN_TRANSIT" },
  { shipmentId: "SHP-JNPT-002", batchId: "BCH-MAB-2026-02", product: "Adalimumab (Monoclonal Antibody)", hsCode: "3002.15.00.00", origin: "Hyderabad -> JNPT", destination: "Riyadh via Jeddah", containerType: "40ft Reefer", tempMinC: 2.0, tempMaxC: 8.0, currentTempC: 3.8, remainingShelfLifeDays: 21, cargoValueINR: 24000000, cargoValueUSD: 285700, vesselMMSI: "419001235", corridor: "Red Sea", status: "IN_TRANSIT" },
  { shipmentId: "SHP-JNPT-003", batchId: "BCH-TRZ-2026-03", product: "Trastuzumab Biosimilar", hsCode: "3002.15.00.00", origin: "Hyderabad -> JNPT", destination: "Dammam, KSA", containerType: "40ft Reefer", tempMinC: 2.0, tempMaxC: 8.0, currentTempC: 4.5, remainingShelfLifeDays: 19, cargoValueINR: 21000000, cargoValueUSD: 250000, vesselMMSI: "419001236", corridor: "Hormuz/Gulf", status: "IN_TRANSIT" },
  { shipmentId: "SHP-JNPT-004", batchId: "BCH-VAC-2026-04", product: "Hepatitis B Recombinant Vaccine", hsCode: "3002.41.00.00", origin: "Hyderabad -> JNPT", destination: "Doha, Qatar", containerType: "40ft Reefer", tempMinC: 2.0, tempMaxC: 8.0, currentTempC: 5.1, remainingShelfLifeDays: 16, cargoValueINR: 14200000, cargoValueUSD: 169000, vesselMMSI: "419001237", corridor: "Hormuz/Gulf", status: "IN_TRANSIT" },
  { shipmentId: "SHP-JNPT-005", batchId: "BCH-EPO-2026-05", product: "Recombinant Erythropoietin", hsCode: "3004.39.00.50", origin: "Hyderabad -> JNPT", destination: "Abu Dhabi, UAE", containerType: "40ft Reefer", tempMinC: 2.0, tempMaxC: 8.0, currentTempC: 4.0, remainingShelfLifeDays: 24, cargoValueINR: 16800000, cargoValueUSD: 200000, vesselMMSI: "419001238", corridor: "Hormuz/Gulf", status: "IN_TRANSIT" },
  { shipmentId: "SHP-JNPT-006", batchId: "BCH-INS-2026-06", product: "Insulin Aspart Vials", hsCode: "3004.31.00.10", origin: "Hyderabad -> JNPT", destination: "Muscat, Oman", containerType: "40ft Reefer", tempMinC: 2.0, tempMaxC: 8.0, currentTempC: 4.6, remainingShelfLifeDays: 20, cargoValueINR: 15500000, cargoValueUSD: 184500, vesselMMSI: "419001239", corridor: "Arabian Sea", status: "IN_TRANSIT" },
  { shipmentId: "SHP-JNPT-007", batchId: "BCH-MAB-2026-07", product: "Bevacizumab Concentrate", hsCode: "3002.15.00.00", origin: "Hyderabad -> JNPT", destination: "Kuwait City, Kuwait", containerType: "40ft Reefer", tempMinC: 2.0, tempMaxC: 8.0, currentTempC: 3.9, remainingShelfLifeDays: 17, cargoValueINR: 22500000, cargoValueUSD: 267800, vesselMMSI: "419001240", corridor: "Hormuz/Gulf", status: "IN_TRANSIT" },
  { shipmentId: "SHP-JNPT-008", batchId: "BCH-VAC-2026-08", product: "Rabies Vero Cell Vaccine", hsCode: "3002.41.00.00", origin: "Hyderabad -> JNPT", destination: "Jeddah, KSA", containerType: "40ft Reefer", tempMinC: 2.0, tempMaxC: 8.0, currentTempC: 4.8, remainingShelfLifeDays: 28, cargoValueINR: 12000000, cargoValueUSD: 142800, vesselMMSI: "419001241", corridor: "Red Sea", status: "IN_TRANSIT" },
  { shipmentId: "SHP-JNPT-009", batchId: "BCH-INS-2026-09", product: "Insulin Lispro Cartridges", hsCode: "3004.31.00.10", origin: "Hyderabad -> JNPT", destination: "Manama, Bahrain", containerType: "40ft Reefer", tempMinC: 2.0, tempMaxC: 8.0, currentTempC: 4.3, remainingShelfLifeDays: 19, cargoValueINR: 17400000, cargoValueUSD: 207100, vesselMMSI: "419001242", corridor: "Hormuz/Gulf", status: "IN_TRANSIT" },
  { shipmentId: "SHP-JNPT-010", batchId: "BCH-MAB-2026-10", product: "Rituximab IV Solution", hsCode: "3002.15.00.00", origin: "Hyderabad -> JNPT", destination: "Jebel Ali, UAE", containerType: "40ft Reefer", tempMinC: 2.0, tempMaxC: 8.0, currentTempC: 4.1, remainingShelfLifeDays: 22, cargoValueINR: 26000000, cargoValueUSD: 309500, vesselMMSI: "419001243", corridor: "Hormuz/Gulf", status: "IN_TRANSIT" },
  { shipmentId: "SHP-JNPT-011", batchId: "BCH-FIL-2026-11", product: "Pegfilgrastim Prefilled Syringes", hsCode: "3002.15.00.00", origin: "Hyderabad -> JNPT", destination: "Jeddah, KSA", containerType: "40ft Reefer", tempMinC: 2.0, tempMaxC: 8.0, currentTempC: 3.7, remainingShelfLifeDays: 18, cargoValueINR: 19800000, cargoValueUSD: 235700, vesselMMSI: "419001244", corridor: "Red Sea", status: "IN_TRANSIT" },
  { shipmentId: "SHP-JNPT-012", batchId: "BCH-VAC-2026-12", product: "Pneumococcal Conjugate Vaccine", hsCode: "3002.41.00.00", origin: "Hyderabad -> JNPT", destination: "Dammam, KSA", containerType: "40ft Reefer", tempMinC: 2.0, tempMaxC: 8.0, currentTempC: 5.0, remainingShelfLifeDays: 25, cargoValueINR: 16200000, cargoValueUSD: 192800, vesselMMSI: "419001245", corridor: "Hormuz/Gulf", status: "IN_TRANSIT" },
  { shipmentId: "SHP-JNPT-013", batchId: "BCH-INS-2026-13", product: "Insulin Detemir FlexPen", hsCode: "3004.31.00.10", origin: "Hyderabad -> JNPT", destination: "Jebel Ali, UAE", containerType: "40ft Reefer", tempMinC: 2.0, tempMaxC: 8.0, currentTempC: 4.4, remainingShelfLifeDays: 15, cargoValueINR: 18900000, cargoValueUSD: 225000, vesselMMSI: "419001246", corridor: "Hormuz/Gulf", status: "IN_TRANSIT" },
  { shipmentId: "SHP-JNPT-014", batchId: "BCH-IFN-2026-14", product: "Peginterferon Alfa-2a", hsCode: "3002.15.00.00", origin: "Hyderabad -> JNPT", destination: "Doha, Qatar", containerType: "40ft Reefer", tempMinC: 2.0, tempMaxC: 8.0, currentTempC: 4.2, remainingShelfLifeDays: 23, cargoValueINR: 17100000, cargoValueUSD: 203500, vesselMMSI: "419001247", corridor: "Hormuz/Gulf", status: "IN_TRANSIT" },
  { shipmentId: "SHP-JNPT-015", batchId: "BCH-MAB-2026-15", product: "Infliximab Lyophilized", hsCode: "3002.15.00.00", origin: "Hyderabad -> JNPT", destination: "Abu Dhabi, UAE", containerType: "40ft Reefer", tempMinC: 2.0, tempMaxC: 8.0, currentTempC: 3.6, remainingShelfLifeDays: 20, cargoValueINR: 23400000, cargoValueUSD: 278500, vesselMMSI: "419001248", corridor: "Hormuz/Gulf", status: "IN_TRANSIT" },
  { shipmentId: "SHP-JNPT-016", batchId: "BCH-VAC-2026-16", product: "Rotavirus Oral Cold-Chain Pack", hsCode: "3002.41.00.00", origin: "Hyderabad -> JNPT", destination: "Jeddah, KSA", containerType: "40ft Reefer", tempMinC: 2.0, tempMaxC: 8.0, currentTempC: 4.7, remainingShelfLifeDays: 26, cargoValueINR: 13600000, cargoValueUSD: 161900, vesselMMSI: "419001249", corridor: "Red Sea", status: "IN_TRANSIT" }
];
fs.writeFileSync('assets/data/pharma_reefer_shipments.json', JSON.stringify(shipments, null, 2));

// 4.2 Route & Rate Card Matrix (Dual INR + USD matching Pitch0 & Pitch1)
const routeMatrix = [
  { routeId: "RT-BASELINE-GULF", name: "Baseline (Blocked/Delayed Gulf Route + War Surcharge)", mode: "Ocean Reefer", transitDays: 19, delayDeltaDays: 9, warRiskSurchargeUSD: 3500, demurrageRangeINR: "365000-750000", totalCostINR: 630000, totalCostUSD: 7500, coldChainSafe: false, notes: "Exposed to Strait of Hormuz war-risk surcharge ($3,500/reefer) and port detention." },
  { routeId: "RT-CAPE-DETOUR", name: "Cape of Good Hope Detour", mode: "Ocean Reefer", transitDays: 24, delayDeltaDays: 14, warRiskSurchargeUSD: 1500, demurrageRangeINR: "365000-500000", totalCostINR: 588000, totalCostUSD: 7000, coldChainSafe: false, notes: "+14 days transit triggers hard batch spoilage flag in Agent 02 for <=20-day biologics." },
  { routeId: "RT-JEDDAH-INTERMODAL", name: "Jeddah Sea-Air / Land-Bridge Intermodal", mode: "Sea + Bonded Reefer Truck (CEPA)", transitDays: 7, delayDeltaDays: 0, warRiskSurchargeUSD: 0, demurrageRangeINR: "0", totalCostINR: 352800, totalCostUSD: 4200, coldChainSafe: true, savingsVsGulfINR: 277200, savingsVsAirINR: 613200, modelledSavingsRangeINR: "3.10L-6.85L", modelledSavingsRangeUSD: "3300-7300", notes: "Optimal route: bypasses Hormuz war surcharge, preserves 2-8C integrity, leverages India-UAE CEPA / GCC corridor." },
  { routeId: "RT-PANIC-AIR", name: "Panic Spot Air Freight + Cold Truck", mode: "Air Cargo + Truck", transitDays: 2, delayDeltaDays: -8, warRiskSurchargeUSD: 0, demurrageRangeINR: "0", totalCostINR: 966000, totalCostUSD: 11500, coldChainSafe: true, notes: "Avoids spoilage but triggers 200-300% panic spot rate surcharge; violates CFO spend cap." }
];
fs.writeFileSync('assets/data/route_rate_matrix.json', JSON.stringify(routeMatrix, null, 2));

// 2.5 India-UAE CEPA & GCC Tariff Schedules
const cepaTariffs = [
  { hsCode: "3004.31.00.10", category: "Insulin Glargine & Insulin Formulations", mfnDutyPct: 5.0, cepaPreferentialDutyPct: 0.0, gccCommonExternalTariffPct: 0.0, certificateRequired: "India-UAE CEPA Certificate of Origin (DGFT)", corridor: "JNPT -> Jebel Ali / Jeddah Land-Bridge" },
  { hsCode: "3002.15.00.00", category: "Monoclonal Antibodies & Immunological Biologics", mfnDutyPct: 5.0, cepaPreferentialDutyPct: 0.0, gccCommonExternalTariffPct: 0.0, certificateRequired: "India-UAE CEPA COO + Cold-Chain GDP Cert", corridor: "JNPT -> Jebel Ali / Jeddah Land-Bridge" },
  { hsCode: "3002.41.00.00", category: "Human Vaccines (Cold-Chain 2-8C)", mfnDutyPct: 5.0, cepaPreferentialDutyPct: 0.0, gccCommonExternalTariffPct: 0.0, certificateRequired: "WHO-PQ + CEPA COO", corridor: "JNPT -> Jebel Ali / Jeddah Land-Bridge" },
  { hsCode: "3004.39.00.50", category: "Recombinant Hormones & Biologics", mfnDutyPct: 5.0, cepaPreferentialDutyPct: 0.0, gccCommonExternalTariffPct: 0.0, certificateRequired: "India-UAE CEPA COO", corridor: "JNPT -> Jebel Ali / Jeddah Land-Bridge" }
];
fs.writeFileSync('assets/data/cepa_gcc_tariffs.json', JSON.stringify(cepaTariffs, null, 2));

// 4.4 Compliance & Governance RAG Chunks (EU AI Act Art. 14 + India-UAE CEPA Pharma Annexures)
const ragDocs = [
  { docId: "EU-AI-ACT-ART14-1", source: "Regulation (EU) 2024/1689 - Article 14(1)-(2)", topic: "Human Oversight Interface", text: "High-risk AI systems shall be designed and developed with appropriate human-machine interface tools so they can be effectively overseen by natural persons during use, aiming to prevent or minimise risks to health, safety, or fundamental rights." },
  { docId: "EU-AI-ACT-ART14-4", source: "Regulation (EU) 2024/1689 - Article 14(4)(a)-(e)", topic: "Override & Stop Controls", text: "Human oversight measures must enable assigned overseers (VP Rajesh Nair) to understand capabilities and limitations, monitor anomalies, remain aware of automation bias, interpret AI outputs, and override, disregard, or halt automated spend/rerouting decisions before execution." },
  { docId: "CEPA-PHARMA-ANNEX-1", source: "India-UAE CEPA Chapter 30 Pharma Annexure", topic: "Preferential 0% Duty", text: "Qualifying Indian pharmaceutical formulations under HS 3002 and HS 3004 exported from JNPT to UAE/GCC hubs qualify for 0% preferential customs duty under India-UAE CEPA when accompanied by a valid DGFT Certificate of Origin." },
  { docId: "WHO-GDP-COLDCHAIN-1", source: "Cold-Chain GDP SOP (2-8C Biologics)", topic: "Temperature Excursion Gate", text: "Insulin Glargine and Monoclonal Antibodies must be maintained strictly within 2.0C to 8.0C. Any door-open event or temperature drift above 8.0C requires immediate triage and route re-optimization within remaining batch shelf life." }
];
fs.writeFileSync('assets/rag/compliance_governance_docs.json', JSON.stringify(ragDocs, null, 2));

// 4.3 Crisis Simulator Trigger Script (Demo Trigger)
const triggerScript = `#!/bin/bash
# Pravah-A2A Live Demo Crisis Trigger (Red Sea/Hormuz Stall + Reefer Temp Drift)
TARGET_URL="\${1:-http://localhost:4004/odata/v4/pravah/triggerCrisis}"
curl -X POST "$TARGET_URL" \\
  -H "Content-Type: application/json" \\
  -d '{
    "shipmentId": "SHP-JNPT-001",
    "eventType": "HORMUZ_CHOKEPOINT_STALL_AND_TEMP_DRIFT",
    "chokepoint": "Strait of Hormuz / Red Sea",
    "vesselSogKnots": 0.4,
    "aisDarkMinutes": 45,
    "reeferTempC": 8.9,
    "doorOpen": true,
    "severity": "CRITICAL"
  }'
echo ""
`;
fs.writeFileSync('scripts/trigger-crisis.sh', triggerScript);
fs.chmodSync('scripts/trigger-crisis.sh', '755');

console.log("✅ All Step 4 assets created successfully!");
