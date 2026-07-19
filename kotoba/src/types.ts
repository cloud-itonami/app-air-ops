/**
 * air-ops kotoba — kotoba-E2E split. Maximal migration of airline flight
 * operations: front everything that can move; only the irreducible regulated
 * EXECUTION stays etzhayyim.
 *
 * Per ADR-2606011400 (Consensys product-front / infra-back) + ADR-2605172400
 * (3-axis Liability/Custody/Settlement) + ADR-2605181100 (kotoba E2E
 * encrypted-record envelope). Founder directive 2026-06-03: PII / CUI / crew /
 * commercial terms may migrate to etzhayyim when made safe via kotoba E2E.
 *
 * SPLIT:
 *   PLAINTEXT (public ops facts, AT records via sdk.write/read) —
 *     notam: public airspace notices / reference catalog.
 *     pirep: pilot weather reports (public ops facts: turbulence/icing at a
 *            position). FK pirep → notam location via exists() (read + check).
 *   E2E (kotoba, com.etzhayyim.apps.airOps.*) — sealed via
 *   sdk.encryptedWrite/encryptedRead, read-cap = owner DID + explicit recipients:
 *     flightPlan: crew (captain DID) + route + fuel figures + weather brief.
 *     dispatchBrief: crew + fuel planned + OFP version (commercial dispatch).
 *     techLog: tail number + defect/rectification (confidential maintenance).
 *     fuelOrder: supplier + commercial fuel-uplift terms (the LEDGER entry).
 *
 *   STAYS etzhayyim (consumed via consent-capability, NOT a collection) — the
 *   IATA-BSP fiat-clearing settlement rail for fuel uplift and ground services.
 *   Per Operating Entity Boundary (ADR-2605172100) etzhayyim never becomes the
 *   fiat counterparty. So the fuel-order LEDGER + commercial-terms DATA fronts
 *   here as E2E records — only the BSP fiat-clearing CALL stays etzhayyim.
 *   Likewise GPU/LLM weather-brief inference + the NOTAM/weather upstream feed
 *   EXECUTION stay etzhayyim; the resulting facts front as records above.
 *
 * AT-Lexicon: no float — all counts/altitudes/winds are integers; fuel and
 * lat/lon (DOUBLE in the legacy schema) are decimal STRINGS; severity scales
 * are short string enums, not floats.
 */

// ─── Collection NSIDs ───────────────────────────────────────────────

// Plaintext (public ops facts).
export const NOTAM_COLLECTION = "com.etzhayyim.apps.airOps.notam";
export const PIREP_COLLECTION = "com.etzhayyim.apps.airOps.pirep";

// E2E inner-types (body shape inside the kotoba envelope; = collection NSID).
export const FLIGHT_PLAN_INNER_TYPE = "com.etzhayyim.apps.airOps.flightPlan";
export const DISPATCH_BRIEF_INNER_TYPE = "com.etzhayyim.apps.airOps.dispatchBrief";
export const TECH_LOG_INNER_TYPE = "com.etzhayyim.apps.airOps.techLog";
export const FUEL_ORDER_INNER_TYPE = "com.etzhayyim.apps.airOps.fuelOrder";

export const AIR_OPS_DID_PREFIX = "did:web:air-ops.etzhayyim.com:" as const;

// ─── NOTAM (PLAINTEXT, public airspace notice) ──────────────────────

export interface NotamRecord {
  did: string;
  notamId: string;
  location: string;
  notamType: string;
  effectiveFrom: string;
  effectiveTo?: string;
  priority?: string;
  contentHash?: string;
  createdAt: string;
}
export interface NotamView extends NotamRecord {
  notamUri: string;
}
export interface RecordNotamInput {
  notamId: string;
  location: string;
  notamType: string;
  effectiveFrom: string;
  effectiveTo?: string;
  priority?: string;
  contentHash?: string;
}
export interface RecordNotamOutput {
  status: "recorded" | "alreadyExists" | "rejected";
  notamUri?: string;
  did?: string;
  notamId?: string;
  error?: string;
}
export interface GetNotamInput {
  notamId: string;
}
export interface GetNotamOutput {
  notam?: NotamView;
  error?: string;
}
export interface ListNotamsInput {
  location?: string;
  notamType?: string;
  limit?: number;
  cursor?: string;
}
export interface ListNotamsOutput {
  items: NotamView[];
  cursor?: string;
  total: number;
}

// ─── PIREP (PLAINTEXT, public weather report; FK → notam location) ──

export interface PirepRecord {
  did: string;
  pirepId: string;
  flightNo: string;
  location: string;
  /** Decimal string (DOUBLE in legacy schema). */
  altitudeFt?: string;
  turbulenceSeverity?: string;
  icingSeverity?: string;
  reportedAt: string;
  createdAt: string;
}
export interface PirepView extends PirepRecord {
  pirepUri: string;
}
export interface SubmitPirepInput {
  pirepId: string;
  flightNo: string;
  location: string;
  altitudeFt?: string;
  turbulenceSeverity?: string;
  icingSeverity?: string;
  reportedAt?: string;
}
export interface SubmitPirepOutput {
  status: "submitted" | "alreadyExists" | "rejected";
  pirepUri?: string;
  did?: string;
  pirepId?: string;
  error?: string;
}
export interface ListPirepsInput {
  location?: string;
  flightNo?: string;
  limit?: number;
  cursor?: string;
}
export interface ListPirepsOutput {
  items: PirepView[];
  cursor?: string;
  total: number;
}

// ─── Flight plan (E2E, crew PII + route + fuel) ─────────────────────

export interface FlightPlanBody {
  flightNo: string;
  depDate: string;
  origin: string;
  dest: string;
  captainDid?: string;
  route?: string;
  aircraftType?: string;
  /** Decimal string. */
  fuelOnBoardKg?: string;
  /** Decimal string. */
  fuelRequiredKg?: string;
  weatherSummary?: string;
  notamCount?: number;
  filedAt: string;
}
export interface FlightPlanView extends FlightPlanBody {
  uri: string;
  sender: string;
  createdAt: string;
}
export interface FileFlightPlanInput {
  flightNo: string;
  depDate: string;
  origin: string;
  dest: string;
  captainDid?: string;
  route?: string;
  aircraftType?: string;
  fuelOnBoardKg?: string;
  fuelRequiredKg?: string;
  weatherSummary?: string;
  notamCount?: number;
  filedAt?: string;
  /** Extra DIDs to grant read-cap (owner always included). */
  recipients?: string[];
}
export interface FileFlightPlanOutput {
  status: "filed" | "rejected";
  uri?: string;
  keyId?: string;
  flightNo?: string;
  error?: string;
}
export interface GetFlightPlanInput {
  flightNo: string;
  depDate: string;
}
export interface GetFlightPlanOutput {
  flightPlan?: FlightPlanView;
  error?: string;
}
export interface ListFlightPlansInput {
  dest?: string;
  depDate?: string;
  limit?: number;
  cursor?: string;
}
export interface ListFlightPlansOutput {
  items: FlightPlanView[];
  cursor?: string;
  total: number;
}

// ─── Dispatch brief (E2E, crew + commercial OFP) ────────────────────

export interface DispatchBriefBody {
  flightNo: string;
  depDate: string;
  carrierCode: string;
  captainDid?: string;
  /** Decimal string. */
  fuelPlannedKg?: string;
  alternateAirport?: string;
  wxMinimaMet?: boolean;
  ofpVersion?: string;
  releasedAt: string;
}
export interface DispatchBriefView extends DispatchBriefBody {
  uri: string;
  sender: string;
  createdAt: string;
}
export interface CreateDispatchBriefInput {
  flightNo: string;
  depDate: string;
  carrierCode: string;
  captainDid?: string;
  fuelPlannedKg?: string;
  alternateAirport?: string;
  wxMinimaMet?: boolean;
  ofpVersion?: string;
  releasedAt?: string;
  recipients?: string[];
}
export interface CreateDispatchBriefOutput {
  status: "created" | "rejected";
  uri?: string;
  keyId?: string;
  flightNo?: string;
  error?: string;
}
export interface ListDispatchBriefsInput {
  carrierCode?: string;
  depDate?: string;
  limit?: number;
  cursor?: string;
}
export interface ListDispatchBriefsOutput {
  items: DispatchBriefView[];
  cursor?: string;
  total: number;
}

// ─── Tech log (E2E, confidential maintenance) ───────────────────────

export interface TechLogBody {
  techLogId: string;
  flightNo: string;
  depDate: string;
  tailNumber: string;
  defectCode?: string;
  description?: string;
  rectification?: string;
  status?: string;
  recordedAt: string;
}
export interface TechLogView extends TechLogBody {
  uri: string;
  sender: string;
  createdAt: string;
}
export interface RecordTechLogInput {
  techLogId: string;
  flightNo: string;
  depDate: string;
  tailNumber: string;
  defectCode?: string;
  description?: string;
  rectification?: string;
  status?: string;
  recordedAt?: string;
  recipients?: string[];
}
export interface RecordTechLogOutput {
  status: "recorded" | "rejected";
  uri?: string;
  keyId?: string;
  techLogId?: string;
  error?: string;
}
export interface GetTechLogInput {
  techLogId: string;
}
export interface GetTechLogOutput {
  techLog?: TechLogView;
  error?: string;
}

// ─── Fuel order (E2E, commercial terms; LEDGER entry) ───────────────
// The fuel-uplift commercial-terms DATA fronts here as an E2E ledger entry.
// The IATA-BSP fiat-clearing settlement CALL stays etzhayyim (consent-capability).

export interface FuelOrderBody {
  fuelOrderId: string;
  flightNo: string;
  depDate: string;
  fuelType?: string;
  /** Decimal string. */
  requestedKg: string;
  supplier?: string;
  /** Decimal string (unit price); settlement clears off-substrate via etzhayyim. */
  unitPrice?: string;
  currency?: string;
  upliftRef?: string;
  orderedAt: string;
}
export interface FuelOrderView extends FuelOrderBody {
  uri: string;
  sender: string;
  createdAt: string;
}
export interface OrderFuelInput {
  fuelOrderId: string;
  flightNo: string;
  depDate: string;
  fuelType?: string;
  requestedKg: string;
  supplier?: string;
  unitPrice?: string;
  currency?: string;
  upliftRef?: string;
  orderedAt?: string;
  recipients?: string[];
}
export interface OrderFuelOutput {
  status: "ordered" | "rejected";
  uri?: string;
  keyId?: string;
  fuelOrderId?: string;
  error?: string;
}
export interface ListFuelOrdersInput {
  flightNo?: string;
  limit?: number;
  cursor?: string;
}
export interface ListFuelOrdersOutput {
  items: FuelOrderView[];
  cursor?: string;
  total: number;
}

// ─── Coverage rollup ────────────────────────────────────────────────

export interface CoverageInput {
  maxScan?: number;
}
export interface CoverageOutput {
  notamCount?: number;
  pirepCount?: number;
  flightPlanCount?: number;
  dispatchBriefCount?: number;
  techLogCount?: number;
  fuelOrderCount?: number;
  notamsByLocation?: Record<string, number>;
  truncated?: boolean;
  error?: string;
}

// ─── Validation + helpers ───────────────────────────────────────────

export function isUint(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0;
}
export function isDecimalString(s: unknown): s is string {
  return typeof s === "string" && /^\d+(\.\d+)?$/.test(s);
}
export function notamDidFor(notamId: string): string {
  return `${AIR_OPS_DID_PREFIX}notam:${notamId.toLowerCase()}`;
}
export function pirepDidFor(pirepId: string): string {
  return `${AIR_OPS_DID_PREFIX}pirep:${pirepId.toLowerCase()}`;
}
export function rkeyOf(prefix: string, id: string): string {
  return `${prefix}-${id.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}
