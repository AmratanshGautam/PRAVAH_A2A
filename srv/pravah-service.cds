using { pravah.a2a as db } from '../db/schema';

service PravahService @(path: '/odata/v4/pravah') {
  @cds.redirection.target entity Shipments           as projection on db.Shipments;
  @cds.redirection.target entity ReeferBatches       as projection on db.ReeferBatches;
  entity ColdChainExcursions as projection on db.ColdChainExcursions;
  @cds.redirection.target entity RerouteOptions      as projection on db.RerouteOptions;
  entity AuditLogs           as projection on db.AuditLogs;
  entity ComplianceDocs      as projection on db.ComplianceDocs;

  @readonly entity S4HanaBatchMaster as projection on db.ReeferBatches;
  @readonly entity IbpInventoryView  as projection on db.Shipments;
  @readonly entity TmFreightOrders   as projection on db.RerouteOptions;

  action triggerCrisis(
    shipmentId     : String,
    eventType      : String,
    chokepoint     : String,
    vesselSogKnots : Decimal,
    aisDarkMinutes : Integer,
    reeferTempC    : Decimal,
    doorOpen       : Boolean,
    severity       : String
  ) returns String;

  action approveReroute(optionId: UUID, approver: String) returns String;
  action rejectReroute(optionId: UUID, approver: String, reason: String) returns String;
}
