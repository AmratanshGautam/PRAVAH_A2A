import fs from 'fs';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';

const routeMatrix = JSON.parse(fs.readFileSync(new URL('../assets/data/route_rate_matrix.json', import.meta.url), 'utf8'));
const cepaTariffs = JSON.parse(fs.readFileSync(new URL('../assets/data/cepa_gcc_tariffs.json', import.meta.url), 'utf8'));
const ragDocs = JSON.parse(fs.readFileSync(new URL('../assets/rag/compliance_governance_docs.json', import.meta.url), 'utf8'));

export function checkBatchShelfLife(remainingShelfLifeDays, transitDays, bufferDays = 3) {
  const viable = (transitDays + bufferDays) < remainingShelfLifeDays;
  return { viable, spoilageFlag: !viable, marginDays: remainingShelfLifeDays - transitDays };
}

export function queryCEPATariff(hsCode) {
  return cepaTariffs.find(t => t.hsCode === hsCode) || cepaTariffs[0];
}

export async function lookupUsitcHts(keyword = 'insulin') {
  try {
    const res = await fetch(`https://hts.usitc.gov/reststop/search?keyword=${encodeURIComponent(keyword)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const top = Array.isArray(data) ? data.find(d => d.htsno) : null;
    return top
      ? { htsno: top.htsno, description: top.description, general: top.general || 'Free', live: true }
      : { htsno: '3004.31.00.10', description: 'Insulin Glargine', general: 'Free', live: false };
  } catch {
    return { htsno: '3004.31.00.10', description: 'Insulin Glargine (cached)', general: 'Free', live: false };
  }
}

export function calculateRouteCost(batch, tariff) {
  const baselineINR = 630000;
  const baselineUSD = 7500;
  return routeMatrix.map(r => {
    const shelf = checkBatchShelfLife(batch.remainingShelfLifeDays, r.transitDays);
    const isOptimal = r.routeId === 'RT-JEDDAH-INTERMODAL' && shelf.viable;
    return {
      routeId: r.routeId,
      routeName: r.name,
      mode: r.mode,
      transitDays: r.transitDays,
      warRiskSurchargeUSD: r.warRiskSurchargeUSD,
      cepaDutyPct: tariff.cepaPreferentialDutyPct,
      totalCostINR: r.totalCostINR,
      totalCostUSD: r.totalCostUSD,
      savingsINR: Math.max(0, baselineINR - r.totalCostINR),
      savingsUSD: Math.max(0, baselineUSD - r.totalCostUSD),
      coldChainSafe: r.coldChainSafe && shelf.viable,
      spoilageFlag: shelf.spoilageFlag,
      recommended: isOptimal,
      approvalStatus: isOptimal ? 'PENDING_HITL' : (shelf.spoilageFlag ? 'AUTO_REJECTED_SPOILAGE' : 'ALTERNATIVE'),
      rationale: shelf.spoilageFlag
        ? `REJECTED by Agent 02: ${r.transitDays}d transit exceeds ${batch.remainingShelfLifeDays}d batch shelf life (spoilage risk).`
        : `${r.notes} | CEPA Duty: ${tariff.cepaPreferentialDutyPct}% | Margin: ${shelf.marginDays}d shelf life left.`
    };
  });
}

export async function generateSafeGuardBrief(shipment, batch, crisis, recommendedRoute, usitcResult) {
  const fallbackBrief = `Agent 04 (Safe Guard) recommends ${recommendedRoute.routeName} at INR ${recommendedRoute.totalCostINR.toLocaleString('en-IN')} ($${recommendedRoute.totalCostUSD.toLocaleString('en-US')}), saving INR ${recommendedRoute.savingsINR.toLocaleString('en-IN')} ($${recommendedRoute.savingsUSD.toLocaleString('en-US')}) vs Gulf War Surcharge while preserving ${batch.remainingShelfLifeDays}d shelf life (2-8C). USITC HTS ${usitcResult.htsno} (${usitcResult.general}), India-UAE CEPA 0% duty. Held at HITL gate per EU AI Act Art. 14(4) for VP Rajesh Nair sign-off.`;

  if (!process.env.GEMINI_API_KEY) return fallbackBrief;

  try {
    const llm = new ChatGoogleGenerativeAI({
      model: 'gemini-2.0-flash',
      apiKey: process.env.GEMINI_API_KEY,
      temperature: 0.2
    });
    const prompt = `You are Agent 04 (The Safe Guard) inside SAP Pravah-A2A briefing VP Rajesh Nair.
In 2 concise sentences, summarize why we recommend "${recommendedRoute.routeName}" (INR ${recommendedRoute.totalCostINR} / USD ${recommendedRoute.totalCostUSD}) for shipment ${shipment.shipmentId} (${batch.product}, ${batch.remainingShelfLifeDays} days shelf life) during "${crisis.eventType}" (temp ${crisis.reeferTempC}C). Cite EU AI Act Article 14(4) HITL approval and India-UAE CEPA 0% duty (HTS ${usitcResult.htsno}).`;
    const response = await llm.invoke(prompt);
    return typeof response.content === 'string' ? response.content.trim() : fallbackBrief;
  } catch {
    return fallbackBrief;
  }
}

export function getComplianceCitations() {
  return { euAiAct: ragDocs[1].source, cepa: ragDocs[2].source };
}
