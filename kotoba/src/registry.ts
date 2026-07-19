/**
 * air-ops kotoba — kotoba-E2E registry.
 *
 * Plaintext path (notam, pirep): sdk.write / sdk.read — public ops facts.
 * FK pirep → notam location via exists() (read + check; mock has no exists()).
 * E2E path (flightPlan, dispatchBrief, techLog, fuelOrder): sdk.encryptedWrite /
 * sdk.encryptedRead — crew PII / commercial terms / confidential maintenance
 * sealed in the kotoba envelope (ADR-2605181100), read-cap = owner DID +
 * explicit recipients. The substrate never sees crew identities, fuel pricing,
 * or defect detail in plaintext.
 *
 * The IATA-BSP fiat-clearing settlement EXECUTION stays etzhayyim
 * (consent-capability) — not modeled here as a collection. The fuel-order ledger
 * + commercial terms front above as E2E records; only the clearing CALL stays.
 */

import type { Etzhayyim } from "@etzhayyim/sdk";
import {
  DISPATCH_BRIEF_INNER_TYPE,
  FLIGHT_PLAN_INNER_TYPE,
  FUEL_ORDER_INNER_TYPE,
  NOTAM_COLLECTION,
  PIREP_COLLECTION,
  TECH_LOG_INNER_TYPE,
  isDecimalString,
  isUint,
  notamDidFor,
  pirepDidFor,
  rkeyOf,
  type CoverageInput,
  type CoverageOutput,
  type CreateDispatchBriefInput,
  type CreateDispatchBriefOutput,
  type DispatchBriefBody,
  type DispatchBriefView,
  type FileFlightPlanInput,
  type FileFlightPlanOutput,
  type FlightPlanBody,
  type FlightPlanView,
  type FuelOrderBody,
  type FuelOrderView,
  type GetFlightPlanInput,
  type GetFlightPlanOutput,
  type GetNotamInput,
  type GetNotamOutput,
  type GetTechLogInput,
  type GetTechLogOutput,
  type ListDispatchBriefsInput,
  type ListDispatchBriefsOutput,
  type ListFlightPlansInput,
  type ListFlightPlansOutput,
  type ListFuelOrdersInput,
  type ListFuelOrdersOutput,
  type ListNotamsInput,
  type ListNotamsOutput,
  type ListPirepsInput,
  type ListPirepsOutput,
  type NotamRecord,
  type NotamView,
  type OrderFuelInput,
  type OrderFuelOutput,
  type PirepRecord,
  type PirepView,
  type RecordNotamInput,
  type RecordNotamOutput,
  type RecordTechLogInput,
  type RecordTechLogOutput,
  type SubmitPirepInput,
  type SubmitPirepOutput,
  type TechLogBody,
  type TechLogView,
} from "./types.js";

const PAGE_LIMIT = 100;
const DEFAULT_MAX_SCAN = 10_000;

// ─── Plaintext FK helper (exists via read; mock has no exists()) ────

async function notamLocationExists(e: Etzhayyim, location: string, maxScan = DEFAULT_MAX_SCAN): Promise<boolean> {
  let count = 0;
  let cursor: string | undefined;
  while (count < maxScan) {
    const page = await e.read<NotamRecord>({ collection: NOTAM_COLLECTION, cursor, limit: PAGE_LIMIT });
    for (const r of page.records) {
      count += 1;
      if (r.value.location === location) return true;
    }
    if (!page.cursor || page.records.length < PAGE_LIMIT) break;
    cursor = page.cursor;
  }
  return false;
}

// ─── NOTAM (PLAINTEXT) ──────────────────────────────────────────────

export async function recordNotam(e: Etzhayyim, input: RecordNotamInput): Promise<RecordNotamOutput> {
  if (!input.notamId || !input.location || !input.notamType || !input.effectiveFrom) {
    return { status: "rejected", error: "missingRequiredFields" };
  }
  const rkey = rkeyOf("notam", input.notamId);
  const existing = await e.read<NotamRecord>({ collection: NOTAM_COLLECTION, rkey }).catch(() => ({ records: [] }));
  if (existing.records[0]?.value) {
    return { status: "alreadyExists", notamUri: existing.records[0].uri, did: existing.records[0].value.did, notamId: input.notamId };
  }
  const now = new Date().toISOString();
  const did = notamDidFor(input.notamId);
  const record: NotamRecord = {
    did,
    notamId: input.notamId,
    location: input.location,
    notamType: input.notamType,
    effectiveFrom: input.effectiveFrom,
    effectiveTo: input.effectiveTo,
    priority: input.priority,
    contentHash: input.contentHash,
    createdAt: now,
  };
  const receipt = await e.write({ collection: NOTAM_COLLECTION, record: record as unknown as Record<string, unknown>, rkey });
  return { status: "recorded", notamUri: receipt.uri, did, notamId: input.notamId };
}

export async function getNotam(e: Etzhayyim, input: GetNotamInput): Promise<GetNotamOutput> {
  if (!input.notamId) return { error: "invalidNotamId" };
  const rkey = rkeyOf("notam", input.notamId);
  const resp = await e.read<NotamRecord>({ collection: NOTAM_COLLECTION, rkey }).catch(() => ({ records: [] }));
  const r = resp.records[0];
  if (!r?.value) return { error: "notFound" };
  return { notam: { ...r.value, notamUri: r.uri } };
}

export async function listNotams(e: Etzhayyim, input: ListNotamsInput = {}): Promise<ListNotamsOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const resp = await e.read<NotamRecord>({ collection: NOTAM_COLLECTION, cursor: input.cursor, limit });
  const items: NotamView[] = resp.records
    .filter((r) => (!input.location || r.value.location === input.location) && (!input.notamType || r.value.notamType === input.notamType))
    .map((r) => ({ ...r.value, notamUri: r.uri }));
  return { items, cursor: resp.cursor, total: items.length };
}

// ─── PIREP (PLAINTEXT, FK → notam location) ─────────────────────────

export async function submitPirep(e: Etzhayyim, input: SubmitPirepInput): Promise<SubmitPirepOutput> {
  if (!input.pirepId || !input.flightNo || !input.location) return { status: "rejected", error: "missingRequiredFields" };
  if (input.altitudeFt !== undefined && !isDecimalString(input.altitudeFt)) return { status: "rejected", error: "invalidAltitudeFt" };
  if (!(await notamLocationExists(e, input.location))) return { status: "rejected", error: "notamLocationNotFound" };
  const rkey = rkeyOf("pirep", input.pirepId);
  const existing = await e.read<PirepRecord>({ collection: PIREP_COLLECTION, rkey }).catch(() => ({ records: [] }));
  if (existing.records[0]?.value) {
    return { status: "alreadyExists", pirepUri: existing.records[0].uri, did: existing.records[0].value.did, pirepId: input.pirepId };
  }
  const now = new Date().toISOString();
  const did = pirepDidFor(input.pirepId);
  const record: PirepRecord = {
    did,
    pirepId: input.pirepId,
    flightNo: input.flightNo,
    location: input.location,
    altitudeFt: input.altitudeFt,
    turbulenceSeverity: input.turbulenceSeverity,
    icingSeverity: input.icingSeverity,
    reportedAt: input.reportedAt ?? now,
    createdAt: now,
  };
  const receipt = await e.write({ collection: PIREP_COLLECTION, record: record as unknown as Record<string, unknown>, rkey });
  return { status: "submitted", pirepUri: receipt.uri, did, pirepId: input.pirepId };
}

export async function listPireps(e: Etzhayyim, input: ListPirepsInput = {}): Promise<ListPirepsOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const resp = await e.read<PirepRecord>({ collection: PIREP_COLLECTION, cursor: input.cursor, limit });
  const items: PirepView[] = resp.records
    .filter((r) => (!input.location || r.value.location === input.location) && (!input.flightNo || r.value.flightNo === input.flightNo))
    .map((r) => ({ ...r.value, pirepUri: r.uri }));
  return { items, cursor: resp.cursor, total: items.length };
}

// ─── Flight plan (E2E, crew PII + route + fuel) ─────────────────────

export async function fileFlightPlan(e: Etzhayyim, input: FileFlightPlanInput): Promise<FileFlightPlanOutput> {
  if (!input.flightNo || !input.depDate || !input.origin || !input.dest) return { status: "rejected", error: "missingRequiredFields" };
  if (input.fuelOnBoardKg !== undefined && !isDecimalString(input.fuelOnBoardKg)) return { status: "rejected", error: "invalidFuelOnBoardKg" };
  if (input.fuelRequiredKg !== undefined && !isDecimalString(input.fuelRequiredKg)) return { status: "rejected", error: "invalidFuelRequiredKg" };
  if (input.notamCount !== undefined && !isUint(input.notamCount)) return { status: "rejected", error: "invalidNotamCount" };
  const body: FlightPlanBody = {
    flightNo: input.flightNo,
    depDate: input.depDate,
    origin: input.origin,
    dest: input.dest,
    captainDid: input.captainDid,
    route: input.route,
    aircraftType: input.aircraftType,
    fuelOnBoardKg: input.fuelOnBoardKg,
    fuelRequiredKg: input.fuelRequiredKg,
    weatherSummary: input.weatherSummary,
    notamCount: input.notamCount,
    filedAt: input.filedAt ?? new Date().toISOString(),
  };
  const receipt = await e.encryptedWrite<Record<string, unknown>>({
    innerType: FLIGHT_PLAN_INNER_TYPE,
    record: body as unknown as Record<string, unknown>,
    recipients: input.recipients ?? [],
    rkey: rkeyOf("fpl", `${input.flightNo}-${input.depDate}`),
  });
  return { status: "filed", uri: receipt.uri, keyId: receipt.keyId, flightNo: input.flightNo };
}

async function scanFlightPlans(e: Etzhayyim, maxScan: number): Promise<FlightPlanView[]> {
  const out: FlightPlanView[] = [];
  let cursor: string | undefined;
  while (out.length < maxScan) {
    const page = await e.encryptedRead<FlightPlanBody>({ innerType: FLIGHT_PLAN_INNER_TYPE, cursor, limit: PAGE_LIMIT });
    for (const r of page.records) out.push({ ...r.value, uri: r.uri, sender: r.sender, createdAt: r.createdAt });
    if (!page.cursor || page.records.length === 0) break;
    cursor = page.cursor;
  }
  return out;
}

export async function getFlightPlan(e: Etzhayyim, input: GetFlightPlanInput): Promise<GetFlightPlanOutput> {
  if (!input.flightNo || !input.depDate) return { error: "invalidKey" };
  const all = await scanFlightPlans(e, DEFAULT_MAX_SCAN);
  const found = all.find((p) => p.flightNo === input.flightNo && p.depDate === input.depDate);
  if (!found) return { error: "notFound" };
  return { flightPlan: found };
}

export async function listFlightPlans(e: Etzhayyim, input: ListFlightPlansInput = {}): Promise<ListFlightPlansOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const all = await scanFlightPlans(e, DEFAULT_MAX_SCAN);
  const filtered = all.filter((p) => (!input.dest || p.dest === input.dest) && (!input.depDate || p.depDate === input.depDate));
  return { items: filtered.slice(0, limit), total: filtered.length };
}

// ─── Dispatch brief (E2E, crew + commercial OFP) ────────────────────

export async function createDispatchBrief(e: Etzhayyim, input: CreateDispatchBriefInput): Promise<CreateDispatchBriefOutput> {
  if (!input.flightNo || !input.depDate || !input.carrierCode) return { status: "rejected", error: "missingRequiredFields" };
  if (input.fuelPlannedKg !== undefined && !isDecimalString(input.fuelPlannedKg)) return { status: "rejected", error: "invalidFuelPlannedKg" };
  const body: DispatchBriefBody = {
    flightNo: input.flightNo,
    depDate: input.depDate,
    carrierCode: input.carrierCode,
    captainDid: input.captainDid,
    fuelPlannedKg: input.fuelPlannedKg,
    alternateAirport: input.alternateAirport,
    wxMinimaMet: input.wxMinimaMet,
    ofpVersion: input.ofpVersion,
    releasedAt: input.releasedAt ?? new Date().toISOString(),
  };
  const receipt = await e.encryptedWrite<Record<string, unknown>>({
    innerType: DISPATCH_BRIEF_INNER_TYPE,
    record: body as unknown as Record<string, unknown>,
    recipients: input.recipients ?? [],
    rkey: rkeyOf("disp", `${input.flightNo}-${input.depDate}`),
  });
  return { status: "created", uri: receipt.uri, keyId: receipt.keyId, flightNo: input.flightNo };
}

async function scanDispatchBriefs(e: Etzhayyim, maxScan: number): Promise<DispatchBriefView[]> {
  const out: DispatchBriefView[] = [];
  let cursor: string | undefined;
  while (out.length < maxScan) {
    const page = await e.encryptedRead<DispatchBriefBody>({ innerType: DISPATCH_BRIEF_INNER_TYPE, cursor, limit: PAGE_LIMIT });
    for (const r of page.records) out.push({ ...r.value, uri: r.uri, sender: r.sender, createdAt: r.createdAt });
    if (!page.cursor || page.records.length === 0) break;
    cursor = page.cursor;
  }
  return out;
}

export async function listDispatchBriefs(e: Etzhayyim, input: ListDispatchBriefsInput = {}): Promise<ListDispatchBriefsOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const all = await scanDispatchBriefs(e, DEFAULT_MAX_SCAN);
  const filtered = all.filter((b) => (!input.carrierCode || b.carrierCode === input.carrierCode) && (!input.depDate || b.depDate === input.depDate));
  return { items: filtered.slice(0, limit), total: filtered.length };
}

// ─── Tech log (E2E, confidential maintenance) ───────────────────────

export async function recordTechLog(e: Etzhayyim, input: RecordTechLogInput): Promise<RecordTechLogOutput> {
  if (!input.techLogId || !input.flightNo || !input.depDate || !input.tailNumber) return { status: "rejected", error: "missingRequiredFields" };
  const body: TechLogBody = {
    techLogId: input.techLogId,
    flightNo: input.flightNo,
    depDate: input.depDate,
    tailNumber: input.tailNumber,
    defectCode: input.defectCode,
    description: input.description,
    rectification: input.rectification,
    status: input.status,
    recordedAt: input.recordedAt ?? new Date().toISOString(),
  };
  const receipt = await e.encryptedWrite<Record<string, unknown>>({
    innerType: TECH_LOG_INNER_TYPE,
    record: body as unknown as Record<string, unknown>,
    recipients: input.recipients ?? [],
    rkey: rkeyOf("tlog", input.techLogId),
  });
  return { status: "recorded", uri: receipt.uri, keyId: receipt.keyId, techLogId: input.techLogId };
}

async function scanTechLogs(e: Etzhayyim, maxScan: number): Promise<TechLogView[]> {
  const out: TechLogView[] = [];
  let cursor: string | undefined;
  while (out.length < maxScan) {
    const page = await e.encryptedRead<TechLogBody>({ innerType: TECH_LOG_INNER_TYPE, cursor, limit: PAGE_LIMIT });
    for (const r of page.records) out.push({ ...r.value, uri: r.uri, sender: r.sender, createdAt: r.createdAt });
    if (!page.cursor || page.records.length === 0) break;
    cursor = page.cursor;
  }
  return out;
}

export async function getTechLog(e: Etzhayyim, input: GetTechLogInput): Promise<GetTechLogOutput> {
  if (!input.techLogId) return { error: "invalidTechLogId" };
  const all = await scanTechLogs(e, DEFAULT_MAX_SCAN);
  const found = all.find((t) => t.techLogId === input.techLogId);
  if (!found) return { error: "notFound" };
  return { techLog: found };
}

// ─── Fuel order (E2E, commercial terms; LEDGER entry) ───────────────
// The fuel-uplift commercial terms front here as an E2E ledger entry; the
// IATA-BSP fiat-clearing settlement CALL stays etzhayyim via consent-capability.

export async function orderFuel(e: Etzhayyim, input: OrderFuelInput): Promise<OrderFuelOutput> {
  if (!input.fuelOrderId || !input.flightNo || !input.depDate) return { status: "rejected", error: "missingRequiredFields" };
  if (!isDecimalString(input.requestedKg)) return { status: "rejected", error: "invalidRequestedKg" };
  if (input.unitPrice !== undefined && !isDecimalString(input.unitPrice)) return { status: "rejected", error: "invalidUnitPrice" };
  const body: FuelOrderBody = {
    fuelOrderId: input.fuelOrderId,
    flightNo: input.flightNo,
    depDate: input.depDate,
    fuelType: input.fuelType,
    requestedKg: input.requestedKg,
    supplier: input.supplier,
    unitPrice: input.unitPrice,
    currency: input.currency,
    upliftRef: input.upliftRef,
    orderedAt: input.orderedAt ?? new Date().toISOString(),
  };
  const receipt = await e.encryptedWrite<Record<string, unknown>>({
    innerType: FUEL_ORDER_INNER_TYPE,
    record: body as unknown as Record<string, unknown>,
    recipients: input.recipients ?? [],
    rkey: rkeyOf("fuel", input.fuelOrderId),
  });
  return { status: "ordered", uri: receipt.uri, keyId: receipt.keyId, fuelOrderId: input.fuelOrderId };
}

async function scanFuelOrders(e: Etzhayyim, maxScan: number): Promise<FuelOrderView[]> {
  const out: FuelOrderView[] = [];
  let cursor: string | undefined;
  while (out.length < maxScan) {
    const page = await e.encryptedRead<FuelOrderBody>({ innerType: FUEL_ORDER_INNER_TYPE, cursor, limit: PAGE_LIMIT });
    for (const r of page.records) out.push({ ...r.value, uri: r.uri, sender: r.sender, createdAt: r.createdAt });
    if (!page.cursor || page.records.length === 0) break;
    cursor = page.cursor;
  }
  return out;
}

export async function listFuelOrders(e: Etzhayyim, input: ListFuelOrdersInput = {}): Promise<ListFuelOrdersOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const all = await scanFuelOrders(e, DEFAULT_MAX_SCAN);
  const filtered = all.filter((f) => !input.flightNo || f.flightNo === input.flightNo);
  return { items: filtered.slice(0, limit), total: filtered.length };
}

// ─── Coverage rollup (plaintext + E2E countAll) ─────────────────────

export async function coverage(e: Etzhayyim, input: CoverageInput = {}): Promise<CoverageOutput> {
  const maxScan = Math.min(input.maxScan ?? DEFAULT_MAX_SCAN, DEFAULT_MAX_SCAN);
  const notamsByLocation: Record<string, number> = {};
  let notamCount = 0;
  let notamCursor: string | undefined;
  while (notamCount < maxScan) {
    const page = await e.read<NotamRecord>({ collection: NOTAM_COLLECTION, cursor: notamCursor, limit: PAGE_LIMIT });
    for (const r of page.records) {
      notamsByLocation[r.value.location] = (notamsByLocation[r.value.location] ?? 0) + 1;
      notamCount += 1;
    }
    if (!page.cursor || page.records.length < PAGE_LIMIT) break;
    notamCursor = page.cursor;
  }
  let pirepCount = 0;
  let pirepCursor: string | undefined;
  while (pirepCount < maxScan) {
    const page = await e.read<PirepRecord>({ collection: PIREP_COLLECTION, cursor: pirepCursor, limit: PAGE_LIMIT });
    pirepCount += page.records.length;
    if (!page.cursor || page.records.length < PAGE_LIMIT) break;
    pirepCursor = page.cursor;
  }
  const flightPlanCount = (await scanFlightPlans(e, maxScan)).length;
  const dispatchBriefCount = (await scanDispatchBriefs(e, maxScan)).length;
  const techLogCount = (await scanTechLogs(e, maxScan)).length;
  const fuelOrderCount = (await scanFuelOrders(e, maxScan)).length;
  return {
    notamCount,
    pirepCount,
    flightPlanCount,
    dispatchBriefCount,
    techLogCount,
    fuelOrderCount,
    notamsByLocation,
    truncated:
      notamCount >= maxScan ||
      pirepCount >= maxScan ||
      flightPlanCount >= maxScan ||
      dispatchBriefCount >= maxScan ||
      techLogCount >= maxScan ||
      fuelOrderCount >= maxScan,
  };
}
