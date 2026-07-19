/**
 * air-ops kotoba — barrel. kotoba-E2E split: public ops facts (notam, pirep)
 * plaintext; crew PII / commercial terms / confidential maintenance (flightPlan,
 * dispatchBrief, techLog, fuelOrder) sealed via kotoba E2E (ADR-2605181100).
 * The IATA-BSP fiat-clearing settlement EXECUTION stays etzhayyim (consent-capability).
 */
export * from "./types.js";
export {
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
} from "./registry.js";
