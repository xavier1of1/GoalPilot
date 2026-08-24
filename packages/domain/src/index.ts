export { illustrativeAssumptions, catalogVersion } from './assumptions.js';
export {
  addCalendarDays,
  addCalendarMonths,
  daysBetween,
  formatCalendarDate,
  generateContributionDates,
  isMonthEnd,
  parseCalendarDate,
} from './dates.js';
export {
  calculateDailyAccrualMicros,
  calculateMaturityInterestPosting,
  calculatePostedInterest,
  calculateZeroInterestBaseline,
  compareVehicles,
  roundAccruedInterestMicros,
} from './projection.js';
export {
  calculateSafeContribution,
  type SafeContribution,
  type SafeContributionInput,
} from './safe-contribution.js';
export {
  derivePlanHealth,
  planHealthPolicyVersion,
  type PlanHealth,
  type PlanHealthCode,
  type PlanHealthInput,
} from './plan-health.js';
export {
  rankVehicleFits,
  vehicleFitPolicyVersion,
  type RankedVehicleFit,
  type VehicleFitCandidate,
  type VehicleFitRankingInput,
} from './vehicle-fit.js';
export {
  analyzeZeroInterestPlan,
  buildRecoveryOptions,
  evaluatePlanScenario,
  type PlanScenario,
  type RecoveryOption,
  type RecoveryOptionsInput,
  type ScenarioComparison,
  type ZeroInterestPlanAnalysis,
  type ZeroInterestPlanInput,
} from './plan-scenarios.js';
export {
  assessPurchaseTiming,
  purchaseTimingPolicyVersion,
  PurchaseTimingValidationError,
  type HistoricalPriceObservation,
  type PurchaseTimingAssessment,
  type PurchaseTimingAssessmentInput,
  type PurchaseTimingState,
  type PurchaseTimingStatistics,
  type PurchaseTimingValidationCode,
  type SeasonalMonthStatistics,
} from './purchase-timing.js';
