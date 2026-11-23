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
  cargoDomain          : String(40) default 'PHARMA_COLD_CHAIN';
  cargoValueINR        : Decimal(15,2);
  cargoValueUSD        : Decimal(15,2);
  status               : String(30);
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
  shipmentId          : String(30);
  routeId             : String(40);
  routeName           : String(120);
  mode                : String(60);
  cargoDomain         : String(40) default 'PHARMA_COLD_CHAIN';
  transitDays         : Integer;
  warRiskSurchargeUSD : Decimal(10,2);
  cepaDutyPct         : Decimal(5,2);
  totalCostINR        : Decimal(15,2);
  totalCostUSD        : Decimal(15,2);
  savingsINR          : Decimal(15,2);
  savingsUSD          : Decimal(15,2);
  coldChainSafe       : Boolean;
  spoilageFlag        : Boolean;
  cfoCapExceeded      : Boolean default false;
  cfoCapThresholdINR  : Decimal(15,2) default 500000;
  complianceNote      : String(500);
  recommended         : Boolean default false;
  approvalStatus      : String(40) default 'PENDING_HITL';
  firstApprover       : String(120);
  firstApproverRole   : String(40);
  rationale           : String(1000);
}

entity MaritimeIncidents : cuid, managed {
  incidentCode       : String(40);
  incidentType       : String(60);
  severity           : String(20) default 'CRITICAL';
  vesselName         : String(100);
  vesselMMSI         : String(20);
  shipmentId         : String(30);
  latitude           : Decimal(9,5);
  longitude          : Decimal(9,5);
  threatBearingDeg   : Integer;
  threatSource       : String(120);
  corridor           : String(80);
  cargoCriticality   : String(120);
  targetAgencies     : String(200);
  dispatchPacketJson : LargeString;
  affectedShipments  : Integer default 0;
  protectedValueINR  : Decimal(15,2) default 0;
  protectedValueUSD  : Decimal(15,2) default 0;
  dangerRadiusNM     : Integer default 50;
  reportedBy         : String(100);
  status             : String(30) default 'DISPATCHED_PROTOTYPE';
}

entity AuditLogs : cuid, managed {
  shipmentId         : String(30);
  agentName          : String(80);
  actionTaken        : String(120);
  euAiActClause      : String(120);
  cepaCitation       : String(200);
  humanApprover      : String(120);
  actorRole          : String(40);
  decisionStatus     : String(40);
  aiConfidenceScore  : Decimal(5,2);
  policyVersion      : String(20) default 'PRAVAH-GOV-2.1';
  previousHash       : String(64);
  currentHash        : String(64);
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
  rbacRole         : String(40) default 'SUPPLY_CHAIN_VP';
  companyName      : String(120);
  corridor         : String(100);
  subscriptionTier : String(40) default 'PREMIUM_SAAS';
  passwordHash     : String(256);
  active           : Boolean default true;
}
