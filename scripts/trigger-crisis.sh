#!/bin/bash
# Pravah-A2A Live Demo Crisis Trigger (Red Sea/Hormuz Stall + Reefer Temp Drift)
TARGET_URL="${1:-http://localhost:4004/odata/v4/pravah/triggerCrisis}"
curl -X POST "$TARGET_URL" \
  -H "Content-Type: application/json" \
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
