namespace pravah.a2a;
using { cuid, managed } from '@sap/cds/common';

entity Shipments : managed {
  key shipmentId       : String(30);
  batchId              : String(30);
  product              : String(120);
  hsCode               : String(20);
  origin               : String(80);
  destination          : String(80);
  containerType        : String(30);
  vesselMMSI           : String(20);
  corridor             : String(40);
  cargoValueINR        : Decimal(15,2);
  cargoValueUSD        : Decimal(15,2);
  status               : String(30); // IN_TRANSIT, ALERT_TRIGGERED, REROUTED, DELIVERED
  batch                : Association to ReeferBatches on batch.batchId = batchId;
}

entity ReeferBatches : managed {
  key batchId            : String(30);
  shipmentId             : String(30);
  product                : String(120);
  hsCode                 : String(20);
  tempMinC               : Decimal(5,2);
  tempMaxC               : Decimal(5,2);
  currentTempC           : Decimal(5,2);
  remainingShelfLifeDays : Integer;
  spoilageRiskFlag       : Boolean default false;
}

entity ColdChainExcursions : cuid, managed {
  shipmentId     : String(30);
  eventType      : String(60);
  chokepoint     : String(80);
  vesselSogKnots : Decimal(5,2);
  aisDarkMinutes : Integer;
  reeferTempC    : Decimal(5,2);
  doorOpen       : Boolean;
  severity       : String(20);
  detectedBy     : String(40) default 'Agent 01 - The Watcher';
}

entity RerouteOptions : cuid, managed {
  shipmentId         : String(30);
  routeId            : String(40);
  routeName          : String(120);
  mode               : String(60);
  transitDays        : Integer;
  warRiskSurchargeUSD: Decimal(10,2);
  cepaDutyPct        : Decimal(5,2);
  totalCostINR       : Decimal(15,2);
  totalCostUSD       : Decimal(15,2);
  savingsINR         : Decimal(15,2);
  savingsUSD         : Decimal(15,2);
  coldChainSafe      : Boolean;
  spoilageFlag       : Boolean;
  recommended        : Boolean default false;
  approvalStatus     : String(30) default 'PENDING_HITL'; // PENDING_HITL, APPROVED, REJECTED
  rationale          : String(1000);
}

entity AuditLogs : cuid, managed {
  shipmentId         : String(30);
  agentName          : String(60);
  actionTaken        : String(120);
  euAiActClause      : String(120);
  cepaCitation       : String(120);
  humanApprover      : String(80);
  decisionStatus     : String(30);
  details            : String(2000);
}

entity ComplianceDocs : managed {
  key docId : String(40);
  source    : String(120);
  topic     : String(80);
  text      : String(2000);
}

entity TenantUsers : managed {
  key email        : String(120);
  fullName         : String(100);
  role             : String(80);
  companyName      : String(120);
  corridor         : String(100);
  subscriptionTier : String(40) default 'PREMIUM_SAAS';
  passwordHash     : String(256);
  active           : Boolean default true;
}
