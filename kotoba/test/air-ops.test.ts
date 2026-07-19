import { describe, it, expect, beforeEach } from "vitest";
import { MockEtzhayyim } from "@etzhayyim/sdk-mock";
import {
  recordNotam,
  getNotam,
  listNotams,
  submitPirep,
  listPireps,
  fileFlightPlan,
  getFlightPlan,
  listFlightPlans,
  createDispatchBrief,
  listDispatchBriefs,
  recordTechLog,
  getTechLog,
  orderFuel,
  listFuelOrders,
  coverage,
} from "../src/index.js";

const OWNER = "did:web:air-ops.etzhayyim.com";

describe("air-ops kotoba (kotoba-E2E split)", () => {
  let e: any;
  beforeEach(() => {
    e = new MockEtzhayyim({ did: OWNER });
  });

  describe("notam (PLAINTEXT public airspace notice)", () => {
    it("records, dedups, gets, lists/filters", async () => {
      expect((await recordNotam(e, { notamId: "A0001", location: "RJTT", notamType: "RWY", effectiveFrom: "2026-06-03T00:00:00Z" })).status).toBe("recorded");
      expect((await recordNotam(e, { notamId: "A0001", location: "RJTT", notamType: "RWY", effectiveFrom: "2026-06-03T00:00:00Z" })).status).toBe("alreadyExists");
      expect((await recordNotam(e, { notamId: "", location: "RJTT", notamType: "RWY", effectiveFrom: "x" })).status).toBe("rejected");
      await recordNotam(e, { notamId: "A0002", location: "RJAA", notamType: "NAV", effectiveFrom: "2026-06-03T00:00:00Z" });
      expect((await getNotam(e, { notamId: "A0001" })).notam?.location).toBe("RJTT");
      expect((await listNotams(e)).total).toBe(2);
      expect((await listNotams(e, { location: "RJTT" })).total).toBe(1);
      expect((await listNotams(e, { notamType: "NAV" })).total).toBe(1);
    });
  });

  describe("pirep (PLAINTEXT public weather report; FK -> notam location)", () => {
    it("rejects PIREP whose location has no NOTAM (FK exists())", async () => {
      const r = await submitPirep(e, { pirepId: "P1", flightNo: "NH001", location: "RJTT", altitudeFt: "35000" });
      expect(r.status).toBe("rejected");
      expect(r.error).toBe("notamLocationNotFound");
    });
    it("submits once a NOTAM anchors the location; dedups, validates, lists", async () => {
      await recordNotam(e, { notamId: "A1", location: "RJTT", notamType: "RWY", effectiveFrom: "2026-06-03T00:00:00Z" });
      expect((await submitPirep(e, { pirepId: "P1", flightNo: "NH001", location: "RJTT", altitudeFt: "35000", turbulenceSeverity: "MOD" })).status).toBe("submitted");
      expect((await submitPirep(e, { pirepId: "P1", flightNo: "NH001", location: "RJTT" })).status).toBe("alreadyExists");
      // float-rule: altitude must be a decimal string, not a number-shaped junk
      expect((await submitPirep(e, { pirepId: "PX", flightNo: "NH9", location: "RJTT", altitudeFt: "abc" })).status).toBe("rejected");
      expect((await listPireps(e)).total).toBe(1);
      expect((await listPireps(e, { flightNo: "NH001" })).total).toBe(1);
    });
  });

  describe("flightPlan (E2E-ENCRYPTED crew PII + fuel)", () => {
    it("seals via encryptedWrite, round-trips via encryptedRead, validates fuel as decimal string", async () => {
      const ok = await fileFlightPlan(e, { flightNo: "NH001", depDate: "2026-06-03", origin: "RJTT", dest: "KSFO", captainDid: "did:web:capt.example", fuelOnBoardKg: "84000.5", fuelRequiredKg: "79000", notamCount: 3 });
      expect(ok.status).toBe("filed");
      expect(ok.keyId).toBeTruthy();
      expect((await fileFlightPlan(e, { flightNo: "NHX", depDate: "d", origin: "o", dest: "z", fuelOnBoardKg: "12.3.4" })).status).toBe("rejected");
      expect((await fileFlightPlan(e, { flightNo: "NHY", depDate: "d", origin: "o", dest: "z", notamCount: -1 })).status).toBe("rejected");
      const got = await getFlightPlan(e, { flightNo: "NH001", depDate: "2026-06-03" });
      expect(got.flightPlan?.captainDid).toBe("did:web:capt.example");
      expect(got.flightPlan?.fuelOnBoardKg).toBe("84000.5");
      await fileFlightPlan(e, { flightNo: "NH010", depDate: "2026-06-03", origin: "RJAA", dest: "KLAX" });
      expect((await listFlightPlans(e)).total).toBe(2);
      expect((await listFlightPlans(e, { dest: "KSFO" })).total).toBe(1);
    });

    it("enforces read-cap: a non-recipient DID cannot decrypt flight plans", async () => {
      await fileFlightPlan(e, { flightNo: "NH001", depDate: "2026-06-03", origin: "RJTT", dest: "KSFO", captainDid: "did:web:capt" });
      const outsider: any = new MockEtzhayyim({ did: "did:web:outsider.example" });
      expect((await listFlightPlans(outsider)).total).toBe(0);
    });

    it("grants read-cap to an explicit recipient", async () => {
      const partner = "did:web:dispatch.partner.example";
      const r = await fileFlightPlan(e, { flightNo: "NH001", depDate: "2026-06-03", origin: "RJTT", dest: "KSFO", recipients: [partner] });
      expect(r.status).toBe("filed");
      expect((await listFlightPlans(e)).total).toBe(1);
    });
  });

  describe("dispatchBrief (E2E-ENCRYPTED crew + commercial OFP)", () => {
    it("seals, lists/filters, validates fuel decimal string", async () => {
      expect((await createDispatchBrief(e, { flightNo: "NH001", depDate: "2026-06-03", carrierCode: "NH", captainDid: "did:web:capt", fuelPlannedKg: "80000", ofpVersion: "v3" })).status).toBe("created");
      expect((await createDispatchBrief(e, { flightNo: "NHX", depDate: "d", carrierCode: "NH", fuelPlannedKg: "x" })).status).toBe("rejected");
      await createDispatchBrief(e, { flightNo: "JL044", depDate: "2026-06-03", carrierCode: "JL" });
      expect((await listDispatchBriefs(e)).total).toBe(2);
      expect((await listDispatchBriefs(e, { carrierCode: "NH" })).total).toBe(1);
    });
  });

  describe("techLog (E2E-ENCRYPTED confidential maintenance)", () => {
    it("seals, round-trips via get, validates required fields", async () => {
      const ok = await recordTechLog(e, { techLogId: "T1", flightNo: "NH001", depDate: "2026-06-03", tailNumber: "JA801A", defectCode: "ATA34", description: "ADIRU fault", rectification: "MEL applied", status: "open" });
      expect(ok.status).toBe("recorded");
      expect(ok.keyId).toBeTruthy();
      expect((await recordTechLog(e, { techLogId: "", flightNo: "x", depDate: "d", tailNumber: "t" })).status).toBe("rejected");
      const got = await getTechLog(e, { techLogId: "T1" });
      expect(got.techLog?.tailNumber).toBe("JA801A");
      expect(got.techLog?.defectCode).toBe("ATA34");
    });

    it("enforces read-cap: outsider sees no tech logs", async () => {
      await recordTechLog(e, { techLogId: "T1", flightNo: "NH001", depDate: "2026-06-03", tailNumber: "JA801A" });
      const outsider: any = new MockEtzhayyim({ did: "did:web:outsider.example" });
      expect((await getTechLog(outsider, { techLogId: "T1" })).error).toBe("notFound");
    });
  });

  describe("fuelOrder (E2E-ENCRYPTED commercial terms; BSP fiat-clearing stays etzhayyim)", () => {
    it("seals the ledger entry, validates requestedKg + unitPrice as decimal strings", async () => {
      const ok = await orderFuel(e, { fuelOrderId: "F1", flightNo: "NH001", depDate: "2026-06-03", fuelType: "JET-A1", requestedKg: "12000.0", supplier: "AcmeFuel", unitPrice: "0.98", currency: "USD", upliftRef: "UP-001" });
      expect(ok.status).toBe("ordered");
      expect(ok.keyId).toBeTruthy();
      expect((await orderFuel(e, { fuelOrderId: "FX", flightNo: "f", depDate: "d", requestedKg: "x" })).status).toBe("rejected");
      expect((await orderFuel(e, { fuelOrderId: "FY", flightNo: "f", depDate: "d", requestedKg: "100", unitPrice: "bad" })).status).toBe("rejected");
      await orderFuel(e, { fuelOrderId: "F2", flightNo: "JL044", depDate: "2026-06-03", requestedKg: "9000" });
      expect((await listFuelOrders(e)).total).toBe(2);
      expect((await listFuelOrders(e, { flightNo: "NH001" })).total).toBe(1);
    });
  });

  describe("coverage rollup", () => {
    it("counts plaintext (notam, pirep) + E2E (flightPlan, dispatchBrief, techLog, fuelOrder)", async () => {
      await recordNotam(e, { notamId: "A1", location: "RJTT", notamType: "RWY", effectiveFrom: "2026-06-03T00:00:00Z" });
      await recordNotam(e, { notamId: "A2", location: "RJTT", notamType: "NAV", effectiveFrom: "2026-06-03T00:00:00Z" });
      await submitPirep(e, { pirepId: "P1", flightNo: "NH001", location: "RJTT", altitudeFt: "35000" });
      await fileFlightPlan(e, { flightNo: "NH001", depDate: "2026-06-03", origin: "RJTT", dest: "KSFO" });
      await createDispatchBrief(e, { flightNo: "NH001", depDate: "2026-06-03", carrierCode: "NH" });
      await recordTechLog(e, { techLogId: "T1", flightNo: "NH001", depDate: "2026-06-03", tailNumber: "JA801A" });
      await orderFuel(e, { fuelOrderId: "F1", flightNo: "NH001", depDate: "2026-06-03", requestedKg: "12000" });
      const cov = await coverage(e);
      expect(cov.notamCount).toBe(2);
      expect(cov.pirepCount).toBe(1);
      expect(cov.flightPlanCount).toBe(1);
      expect(cov.dispatchBriefCount).toBe(1);
      expect(cov.techLogCount).toBe(1);
      expect(cov.fuelOrderCount).toBe(1);
      expect(cov.notamsByLocation?.RJTT).toBe(2);
    });
  });
});
