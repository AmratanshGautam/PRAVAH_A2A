import 'dotenv/config';
import WebSocket from 'ws';

const vesselMap = new Map();
const telemetryState = {
  aisStatus: 'CONNECTING',
  aisMessagesReceived: 0,
  lastVesselUpdate: null,
  noaaActiveAlerts: null,
  noaaLastChecked: null,
  portWatch: {
    status: 'LOADING',
    hormuzDailyTransits: null,
    hormuzDate: null,
    babElMandebDailyTransits: null,
    babElMandebDate: null,
    source: 'IMF PortWatch ArcGIS Daily_Chokepoints_Data'
  }
};

export function startLiveTelemetry() {
  connectAIS();
  pollNOAA();
  pollPortWatch();
  setInterval(pollNOAA, 5 * 60 * 1000);
  setInterval(pollPortWatch, 30 * 60 * 1000);
}

function connectAIS() {
  const apiKey = process.env.AISSTREAM_API_KEY;
  if (!apiKey) { telemetryState.aisStatus = 'NO_API_KEY'; return; }
  try {
    const ws = new WebSocket('wss://stream.aisstream.io/v0/stream');
    ws.on('open', () => {
      telemetryState.aisStatus = 'LIVE_STREAMING';
      ws.send(JSON.stringify({ APIKey: apiKey, BoundingBoxes: [[[5.0, 32.0], [32.0, 78.0]]] }));
    });
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        const meta = msg.MetaData || {};
        const pos = msg.Message?.PositionReport || msg.Message?.StandardClassBPositionReport || {};
        const lat = meta.latitude ?? pos.Latitude;
        const lon = meta.longitude ?? pos.Longitude;
        if (!meta.MMSI || typeof lat !== 'number' || typeof lon !== 'number') return;

        telemetryState.aisMessagesReceived += 1;
        telemetryState.lastVesselUpdate = new Date().toISOString();
        vesselMap.set(String(meta.MMSI), {
          mmsi: String(meta.MMSI),
          name: (meta.ShipName || 'VESSEL-' + meta.MMSI).trim(),
          lat, lon,
          sog: typeof pos.Sog === 'number' ? Number(pos.Sog.toFixed(1)) : 0,
          stalled: typeof pos.Sog === 'number' && pos.Sog < 1.0,
          updatedAt: telemetryState.lastVesselUpdate
        });
        if (vesselMap.size > 50) vesselMap.delete(vesselMap.keys().next().value);
      } catch {}
    });
    ws.on('close', () => { telemetryState.aisStatus = 'RECONNECTING'; setTimeout(connectAIS, 10000); });
    ws.on('error', () => { telemetryState.aisStatus = 'RECONNECTING'; });
  } catch { telemetryState.aisStatus = 'ERROR'; }
}

async function pollNOAA() {
  try {
    const res = await fetch('https://api.weather.gov/alerts/active/count', {
      headers: { 'User-Agent': 'Pravah-A2A-SAP-Hackfest/1.0' }
    });
    if (res.ok) {
      const data = await res.json();
      telemetryState.noaaActiveAlerts = data.total ?? 0;
      telemetryState.noaaLastChecked = new Date().toISOString();
    }
  } catch {}
}

async function pollPortWatch() {
  try {
    const base = 'https://services9.arcgis.com/weJ1QsnbMYJlCHdG/ArcGIS/rest/services/Daily_Chokepoints_Data/FeatureServer/0/query';
    const [hRes, bRes] = await Promise.all([
      fetch(`${base}?where=portid='chokepoint6'&orderByFields=date+DESC&resultRecordCount=1&outFields=portid,portname,date,n_total,n_container,n_tanker&f=json`),
      fetch(`${base}?where=portid='chokepoint4'&orderByFields=date+DESC&resultRecordCount=1&outFields=portid,portname,date,n_total,n_container,n_tanker&f=json`)
    ]);
    const hData = await hRes.json();
    const bData = await bRes.json();
    const hAttr = hData?.features?.[0]?.attributes;
    const bAttr = bData?.features?.[0]?.attributes;

    if (hAttr || bAttr) {
      telemetryState.portWatch = {
        status: 'LIVE_ARCGIS',
        hormuzDailyTransits: hAttr?.n_total ?? null,
        hormuzContainers: hAttr?.n_container ?? null,
        hormuzDate: hAttr?.date ? new Date(hAttr.date).toISOString().slice(0, 10) : null,
        babElMandebDailyTransits: bAttr?.n_total ?? null,
        babElMandebDate: bAttr?.date ? new Date(bAttr.date).toISOString().slice(0, 10) : null,
        source: 'IMF PortWatch ArcGIS (services9.arcgis.com)'
      };
      console.log('🛰️ Live IMF PortWatch updated:', telemetryState.portWatch);
    }
  } catch {
    telemetryState.portWatch.status = 'UNAVAILABLE';
  }
}

export function getLiveTelemetry() {
  return { ...telemetryState, vesselCount: vesselMap.size, vessels: Array.from(vesselMap.values()) };
}
