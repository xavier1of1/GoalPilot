import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, {
  type FastifyInstance,
  LogController,
  type RawReplyDefaultExpression,
  type RawRequestDefaultExpression,
  type RawServerDefault,
} from 'fastify';
import type { Logger } from 'pino';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { ulid } from 'ulid';
import { z } from 'zod';

import { LocalAuthProvider } from '@goalpilot/auth';
import {
  accountActivationOutputSchema,
  accountDeletionOutputSchema,
  activityListOutputSchema,
  activationInputSchema,
  type AccountSummaryDto,
  authSessionOutputSchema,
  capabilitiesOutputSchema,
  contributionInputSchema,
  contributionOutputSchema,
  dataExportOutputSchema,
  demoAdvanceInputSchema,
  demoResetInputSchema,
  demoRunSummarySchema,
  goalDraftActivateInputSchema,
  goalDraftCreateInputSchema,
  goalDraftDiscardInputSchema,
  goalDraftListOutputSchema,
  goalDraftSchema,
  goalDraftUpdateInputSchema,
  goalArchiveInputSchema,
  goalDetailOutputSchema,
  goalDtoSchema,
  goalInputSchema,
  goalListOutputSchema,
  goalMutationOutputSchema,
  goalUpdateSchema,
  healthLiveOutputSchema,
  healthNotReadyOutputSchema,
  healthReadyOutputSchema,
  initialPlanActivationOutputSchema,
  loginInputSchema,
  meOutputSchema,
  type PlanCalculationContext,
  planCalculationContextSchema,
  type PlanDecisionSummary,
  planDecisionSummarySchema,
  planHealthOutputSchema,
  planHistoryOutputSchema,
  type PlanRationaleCode,
  previewInputSchema,
  previewOutputSchema,
  type PreviewOutput,
  productEventAcceptedOutputSchema,
  productEventInputSchema,
  purchaseItemCreateInputSchema,
  purchaseItemSchema,
  purchaseItemUpdateInputSchema,
  purchaseTimingLatestOutputSchema,
  priceCheckRunSummarySchema,
  priceWatchPolicyCreateInputSchema,
  priceWatchPolicySchema,
  registerInputSchema,
  type RecoveryOption,
  recoveryOptionsOutputSchema,
  runDuePriceChecksInputSchema,
  safeBaselineInputSchema,
  safeBaselineOutputSchema,
  safeBaselineResponseSchema,
  type ScenarioChange,
  type ScenarioComparison,
  scenarioChangeSchema,
  scenarioApplyInputSchema,
  scenarioApplyOutputSchema,
  scenarioPreviewInputSchema,
  scenarioPreviewOutputSchema,
  sessionStatusOutputSchema,
  ulidSchema,
  vehicleCatalogOutputSchema,
  type VehicleCode,
} from '@goalpilot/contracts';
import {
  checkDatabase,
  type DatabaseClient,
  GoalPilotRepository,
  IdempotencyConflictError,
  IndeterminateApplicationCommandError,
  PlanExperienceRepository,
  type PlanExperienceSnapshot,
  ProductExperienceRepository,
  PurchaseTimingRepository,
  StateConflictError,
} from '@goalpilot/data-access';
import {
  addCalendarDays,
  calculateSafeContribution,
  buildRecoveryOptions,
  compareVehicles,
  derivePlanHealth,
  evaluatePlanScenario,
  generateContributionDates,
  type PlanScenario,
} from '@goalpilot/domain';
import { createLogger, safeErrorContext } from '@goalpilot/observability';
import type { Clock, HistoricalPriceProvider, RateProvider } from '@goalpilot/provider-ports';
import {
  FixtureHistoricalPriceProvider,
  PersistedApplicationClock,
  PersistedUserApplicationClock,
  SimulatedContributionProvider,
  SimulatedGoalAccountProvider,
  StaticRateProvider,
} from '@goalpilot/provider-simulators';

import type { AppConfiguration } from './config.js';
import {
  AppError,
  AuthenticationRequiredError,
  ConflictAppError,
  ForbiddenOperationError,
  ResourceNotFoundError,
  ValidationAppError,
} from './errors.js';
import { processDemoAutopilot, resolveDemoAutopilotTarget } from './demo-autopilot.js';
import { runDuePriceChecks } from './purchase-timing-use-case.js';
import {
  canonicalRequestHash,
  clearSessionCookies,
  currentUser,
  csrfCookieName,
  issueSession,
  requireUser,
  sessionCookieName,
  sha256,
  verifyCsrf,
} from './session.js';

interface AppDependencies {
  readonly configuration: AppConfiguration;
  readonly database: DatabaseClient;
  readonly clock?: Clock;
  readonly rateProvider?: RateProvider;
  readonly historicalPriceProvider?: HistoricalPriceProvider;
  readonly demoAutopilotBeforeClockAdvance?: (processingDate: string) => Promise<void> | void;
}

const goalIdParameters = z.object({ goalId: ulidSchema }).strict();
const draftIdParameters = z.object({ draftId: ulidSchema }).strict();
const purchaseItemIdParameters = z.object({ itemId: ulidSchema }).strict();
const purchaseItemArchiveInputSchema = z
  .object({ expectedVersion: z.number().int().min(1) })
  .strict();
const legacyActivationInputSchema = activationInputSchema
  .extend({ expectedGoalVersion: z.number().int().min(1) })
  .strict();
const goalStateTransitionInputSchema = z
  .object({ expectedGoalVersion: z.number().int().min(1) })
  .strict();
const emptyMutationInputSchema = z.object({}).strict();
const optionalEmptyMutationInputSchema = emptyMutationInputSchema.nullish();
const demoResetOutputSchema = z
  .object({ reset: z.literal(true), resetGeneration: z.number().int().min(1) })
  .strict();
const idempotencyHeaders = z.object({ 'idempotency-key': z.string().min(8).max(128) });
const currentPlanOutputSchema = z
  .object({
    goalVersion: z.number().int().min(1),
    planVersion: z.number().int().min(1),
    summary: planDecisionSummarySchema,
  })
  .strict();
const purchaseItemListOutputSchema = z
  .object({ items: z.array(purchaseItemSchema).max(100) })
  .strict();

function completeDraftGoal(data: z.infer<typeof goalDraftSchema>['data']) {
  if (data.budgetFit === undefined)
    throw new ValidationAppError('Complete the budget-fit step before activation.');
  const parsed = goalInputSchema.safeParse({
    name: data.name,
    category: data.category,
    targetAmountCents: data.targetAmountCents,
    currentSavedCents: data.currentSavedCents,
    targetDate: data.targetDate,
    recurringContributionCents: data.recurringContributionCents,
    contributionCadence: data.contributionCadence,
    liquidityNeed: data.liquidityNeed,
    preservationPreference: data.preservationPreference,
    confidence: 'expected',
    notes: data.notes,
  });
  if (!parsed.success)
    throw new ValidationAppError('Complete every required builder step before activation.');
  return { goal: parsed.data, budgetFit: data.budgetFit };
}

export function planDecisionSummary(input: {
  readonly goal: z.infer<typeof goalInputSchema>;
  readonly projection: PreviewOutput;
  readonly vehicleCode: VehicleCode;
  readonly openingSavingsCents: number;
  readonly postedContributionsCents: number;
  readonly postedInterestCents: number;
  readonly currentAvailableFundsCents: number;
  readonly paused: boolean;
  readonly requireEligible?: boolean;
}): PlanDecisionSummary {
  const selected = input.projection.vehicles.find(
    (vehicle) => vehicle.vehicleCode === input.vehicleCode,
  );
  if (selected === undefined || (input.requireEligible === true && !selected.eligible))
    throw new ConflictAppError('Choose an eligible illustrative vehicle.');
  const currentTotalValueCents =
    input.openingSavingsCents + input.postedContributionsCents + input.postedInterestCents;
  const futurePersonalContributionsCents = selected.futurePersonalContributionsCents;
  if (futurePersonalContributionsCents < 0)
    throw new ConflictAppError('The current plan projection cannot be reconciled.');
  const safeContributionCents = input.projection.zeroInterestBaseline.requiredContributionCents;
  const rationaleCodes: PlanRationaleCode[] = ['SAFE_CONTRIBUTION_DOES_NOT_DEPEND_ON_INTEREST'];
  if (safeContributionCents !== null) {
    rationaleCodes.push(
      input.goal.recurringContributionCents < safeContributionCents
        ? 'CHOSEN_CONTRIBUTION_BELOW_SAFE_AMOUNT'
        : input.goal.recurringContributionCents === safeContributionCents
          ? 'CHOSEN_CONTRIBUTION_MATCHES_SAFE_AMOUNT'
          : 'CHOSEN_CONTRIBUTION_ABOVE_SAFE_AMOUNT',
    );
  }
  rationaleCodes.push(
    selected.assumption.lockDays > 0
      ? 'SELECTED_VEHICLE_HAS_MATURITY_LOCK'
      : 'SELECTED_VEHICLE_SATISFIES_ACCESS_NEED',
    'MODELED_INTEREST_DOES_NOT_REDUCE_COMMITMENT',
  );
  if (selected.modeledInterestCents > 0 && selected.surplusCents > 0)
    rationaleCodes.push('MODELED_INTEREST_ADDS_CUSHION');
  rationaleCodes.push(
    selected.projectedCompletionDate === null
      ? 'READINESS_CANNOT_BE_REACHED'
      : selected.projectedCompletionDate < input.goal.targetDate
        ? 'READINESS_IS_BEFORE_TARGET'
        : selected.projectedCompletionDate === input.goal.targetDate
          ? 'READINESS_IS_ON_TARGET'
          : 'READINESS_IS_AFTER_TARGET',
  );
  const health = derivePlanHealth({
    paused: input.paused,
    currentAvailableFundsCents: input.currentAvailableFundsCents,
    currentTotalValueCents,
    targetAmountCents: input.goal.targetAmountCents,
    accessConditionsSatisfied: selected.accessRequirementSatisfied,
    projectedPurchaseReadyDate: selected.projectedCompletionDate,
    targetDate: input.goal.targetDate,
    contributionCadence: input.goal.contributionCadence,
  });
  return {
    safeContributionCents,
    chosenContributionCents: input.goal.recurringContributionCents,
    contributionCadence: input.goal.contributionCadence,
    currentSavingsCents: input.openingSavingsCents,
    postedPersonalContributionsCents: input.postedContributionsCents,
    postedModeledInterestCents: input.postedInterestCents,
    currentTotalValueCents,
    currentAvailableFundsCents: input.currentAvailableFundsCents,
    futurePersonalContributionsCents,
    futureModeledInterestCents: selected.modeledInterestCents,
    projectedTargetDateBalanceCents: selected.endingBalanceCents,
    cushionCents: selected.surplusCents,
    shortfallCents: selected.shortfallCents,
    projectedReadinessDate: selected.projectedCompletionDate,
    vehicleCode: input.vehicleCode,
    assumptionVersion: selected.assumption.assumptionVersion,
    calculationPolicyVersion: 'product-experience-v1',
    rankingPolicyVersion: input.projection.rankingPolicyVersion,
    rationaleVersion: 'product-experience-v1',
    rationaleCodes,
    health: health.code,
  };
}

function immutableProjectionForSnapshot(snapshot: PlanExperienceSnapshot): PreviewOutput {
  const storedRankingPolicyVersion = (
    snapshot.projection as { readonly rankingPolicyVersion?: string }
  ).rankingPolicyVersion;
  if (
    storedRankingPolicyVersion === 'vehicle-fit-v2' &&
    snapshot.projection.vehicles.every(
      (vehicle) =>
        typeof vehicle.futurePersonalContributionsCents === 'number' &&
        typeof vehicle.modeledBenefitVersusCashCents === 'number' &&
        typeof vehicle.preservationRequirementSatisfied === 'boolean',
    )
  ) {
    return snapshot.projection;
  }
  const useStoredContext = storedRankingPolicyVersion === 'vehicle-fit-v2';
  const personalPrincipalCents = useStoredContext
    ? snapshot.calculationContext.personalPrincipalCents
    : snapshot.normalizedInput.currentSavedCents;
  const totalLedgerValueCents = useStoredContext
    ? snapshot.calculationContext.totalLedgerValueCents
    : snapshot.normalizedInput.currentSavedCents;
  const currentAvailableFundsCents = useStoredContext
    ? snapshot.calculationContext.currentAvailableFundsCents
    : snapshot.vehicleCode === 'cd_ladder' || snapshot.vehicleCode === 'treasury_ladder'
      ? 0
      : snapshot.normalizedInput.currentSavedCents;
  return compareVehicles(
    snapshot.normalizedInput,
    snapshot.applicationDate,
    snapshot.projection.vehicles.map((vehicle) => vehicle.assumption),
    {
      scheduleAnchorDate: snapshot.scheduleAnchorDate,
      omittedContributionDates: snapshot.omittedContributionDates,
      personalPrincipalCents,
      totalLedgerValueCents,
      currentAvailableFundsCents,
      currentAccruedInterestMicros: useStoredContext
        ? snapshot.calculationContext.currentAccruedInterestMicros
        : 0,
      ...(useStoredContext ? { fixedTermLots: snapshot.calculationContext.fixedTermLots } : {}),
      fixedTermVehicleCode: snapshot.vehicleCode,
    },
  );
}

export function immutableDecisionSummaryForSnapshot(
  snapshot: PlanExperienceSnapshot,
  projection: PreviewOutput = immutableProjectionForSnapshot(snapshot),
): PlanDecisionSummary {
  if (snapshot.storedDecisionSummary !== null) return snapshot.storedDecisionSummary;
  const fixedTerm =
    snapshot.vehicleCode === 'cd_ladder' || snapshot.vehicleCode === 'treasury_ladder';
  return planDecisionSummary({
    goal: snapshot.normalizedInput,
    projection,
    vehicleCode: snapshot.vehicleCode,
    openingSavingsCents: snapshot.normalizedInput.currentSavedCents,
    postedContributionsCents: 0,
    postedInterestCents: 0,
    currentAvailableFundsCents: fixedTerm ? 0 : snapshot.normalizedInput.currentSavedCents,
    paused: false,
  });
}

function domainScenario(change: ScenarioChange): PlanScenario {
  switch (change.changedDimension) {
    case 'CONTRIBUTION':
      return {
        kind: 'contribution',
        newRecurringContributionCents: change.recurringContributionCents,
      };
    case 'DEADLINE':
      return { kind: 'deadline', newTargetDate: change.targetDate };
    case 'TARGET':
      return { kind: 'target', newTargetAmountCents: change.targetAmountCents };
    case 'MISSED_CONTRIBUTION':
      return { kind: 'missed_contribution', contributionDate: change.missedContributionDate };
  }
}

function contractScenario(scenario: PlanScenario): ScenarioChange {
  switch (scenario.kind) {
    case 'contribution':
      return {
        changedDimension: 'CONTRIBUTION',
        recurringContributionCents: scenario.newRecurringContributionCents,
      };
    case 'deadline':
      return { changedDimension: 'DEADLINE', targetDate: scenario.newTargetDate };
    case 'target':
      return { changedDimension: 'TARGET', targetAmountCents: scenario.newTargetAmountCents };
    case 'missed_contribution':
      return {
        changedDimension: 'MISSED_CONTRIBUTION',
        missedContributionDate: scenario.contributionDate,
      };
  }
}

function recoveryOptionType(kind: 'contribution' | 'deadline' | 'target') {
  return kind === 'contribution'
    ? ('CONTRIBUTION_INCREASE' as const)
    : kind === 'deadline'
      ? ('DEADLINE_EXTENSION' as const)
      : ('TARGET_REDUCTION' as const);
}

type DomainRecoveryOption = ReturnType<typeof buildRecoveryOptions>[number];

interface SelectedVehicleRecoveryRecalculation {
  readonly projectedReadinessDate: string | null;
  readonly health: PlanDecisionSummary['health'];
  readonly personalContributionChangeCents: number;
  readonly modeledInterestChangeCents: number;
}

export function recoveryOptionsFromSelectedVehicleRecalculation(
  options: readonly DomainRecoveryOption[],
  recalculate: (change: ScenarioChange) => SelectedVehicleRecoveryRecalculation,
): readonly RecoveryOption[] {
  const result: RecoveryOption[] = [];
  for (const option of options) {
    const optionType = recoveryOptionType(option.kind);
    if (option.availability === 'unavailable') {
      result.push({
        availability: 'unavailable',
        order: option.order,
        optionType,
        reasonCode: option.reasonCode,
      } as RecoveryOption);
      continue;
    }
    const change = contractScenario(option.scenario);
    const recalculation = recalculate(change);
    if (
      recalculation.projectedReadinessDate === null ||
      !['AHEAD', 'ON_TRACK', 'PURCHASE_READY'].includes(recalculation.health)
    ) {
      result.push({
        availability: 'unavailable',
        order: option.order,
        optionType,
        reasonCode: 'SELECTED_VEHICLE_DOES_NOT_RESTORE_READINESS',
      } as RecoveryOption);
      continue;
    }
    result.push({
      availability: 'available',
      order: option.order,
      optionType,
      change,
      projectedReadinessDate: recalculation.projectedReadinessDate,
      resultingHealth: recalculation.health as 'AHEAD' | 'ON_TRACK' | 'PURCHASE_READY',
      personalContributionChangeCents: recalculation.personalContributionChangeCents,
      modeledInterestChangeCents: recalculation.modeledInterestChangeCents,
      rationaleCode: option.rationaleCode,
    } as RecoveryOption);
  }
  return result;
}

function goalWithScenario(
  goal: z.infer<typeof goalInputSchema>,
  change: ScenarioChange,
): z.infer<typeof goalInputSchema> {
  switch (change.changedDimension) {
    case 'CONTRIBUTION':
      return { ...goal, recurringContributionCents: change.recurringContributionCents };
    case 'DEADLINE':
      return { ...goal, targetDate: change.targetDate };
    case 'TARGET':
      return { ...goal, targetAmountCents: change.targetAmountCents };
    case 'MISSED_CONTRIBUTION':
      return goal;
  }
}

function scenarioPersistence(
  change: ScenarioChange,
  recovery: boolean,
): {
  readonly changedField:
    | 'recurring_contribution'
    | 'target_date'
    | 'target_amount'
    | 'missed_contribution';
  readonly changeReasonCode:
    | 'USER_CONTRIBUTION_CHANGED'
    | 'USER_DEADLINE_CHANGED'
    | 'USER_TARGET_CHANGED'
    | 'USER_MISSED_CONTRIBUTION_PLANNED'
    | 'RECOVERY_CONTRIBUTION_INCREASED'
    | 'RECOVERY_DEADLINE_EXTENDED'
    | 'RECOVERY_TARGET_REDUCED';
  readonly changePayload: Readonly<Record<string, string | number>>;
} {
  switch (change.changedDimension) {
    case 'CONTRIBUTION':
      return {
        changedField: 'recurring_contribution',
        changeReasonCode: recovery
          ? 'RECOVERY_CONTRIBUTION_INCREASED'
          : 'USER_CONTRIBUTION_CHANGED',
        changePayload: { recurringContributionCents: change.recurringContributionCents },
      };
    case 'DEADLINE':
      return {
        changedField: 'target_date',
        changeReasonCode: recovery ? 'RECOVERY_DEADLINE_EXTENDED' : 'USER_DEADLINE_CHANGED',
        changePayload: { targetDate: change.targetDate },
      };
    case 'TARGET':
      return {
        changedField: 'target_amount',
        changeReasonCode: recovery ? 'RECOVERY_TARGET_REDUCED' : 'USER_TARGET_CHANGED',
        changePayload: { targetAmountCents: change.targetAmountCents },
      };
    case 'MISSED_CONTRIBUTION':
      if (recovery) throw new ValidationAppError('Recovery cannot skip a planned contribution.');
      return {
        changedField: 'missed_contribution',
        changeReasonCode: 'USER_MISSED_CONTRIBUTION_PLANNED',
        changePayload: { missedContributionDate: change.missedContributionDate },
      };
  }
}

function accessConsequence(
  current: PlanDecisionSummary,
  proposed: PlanDecisionSummary,
  proposedProjection: PreviewOutput,
): ScenarioComparison['accessConsequence'] {
  const proposedVehicle = proposedProjection.vehicles.find(
    (vehicle) => vehicle.vehicleCode === proposed.vehicleCode,
  );
  if (!proposedVehicle?.eligible || !proposedVehicle.accessRequirementSatisfied)
    return 'LOCK_CONFLICT';
  if (current.projectedReadinessDate === proposed.projectedReadinessDate) return 'UNCHANGED';
  if (current.projectedReadinessDate === null) return 'AVAILABLE_EARLIER';
  if (proposed.projectedReadinessDate === null) return 'AVAILABLE_LATER';
  return proposed.projectedReadinessDate < current.projectedReadinessDate
    ? 'AVAILABLE_EARLIER'
    : 'AVAILABLE_LATER';
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

async function getIdempotentReplay<T>(
  repository: ProductExperienceRepository,
  input: {
    readonly userId: string;
    readonly operation: string;
    readonly idempotencyKey: string;
    readonly requestHash: string;
  },
  schema: z.ZodType<T>,
): Promise<{ readonly value: T; readonly responseStatus: number } | null> {
  try {
    const replay = await repository.getIdempotentResponse<unknown>(input);
    return replay === null ? null : { ...replay, value: schema.parse(replay.value) };
  } catch (error) {
    if (error instanceof IdempotencyConflictError) throw new ConflictAppError(error.message);
    throw error;
  }
}

async function runIdempotentApplicationRequest<T>(
  repository: ProductExperienceRepository,
  input: {
    readonly userId: string;
    readonly operation: string;
    readonly idempotencyKey: string;
    readonly requestHash: string;
    readonly responseStatus: number;
    readonly execute: () => Promise<T>;
  },
): Promise<{ readonly value: T; readonly replayed: boolean }> {
  const identity = {
    userId: input.userId,
    operation: input.operation,
    idempotencyKey: input.idempotencyKey,
    requestHash: input.requestHash,
  };
  const claim = await repository.claimIdempotentRequest<T>(identity);
  if (claim.kind === 'replay') return { value: claim.value, replayed: true };
  // An application command can commit work before its callback or response-recording step fails.
  // Keep such a claim indeterminate: automatically making it retryable could apply relative clock,
  // ledger, export, or reset work twice. Only a caller that proves no mutation committed may abandon
  // a claim explicitly.
  const value = await input.execute();
  await repository.completeIdempotentRequest({
    ...identity,
    claimToken: claim.claimToken,
    responseStatus: input.responseStatus,
    value,
  });
  return { value, replayed: false };
}

const pendingStoryDayRepairFailureMessage =
  'GoalPilot could not finish repairing the pending Story day. Refresh and retry this request.';

function pendingStoryDayRepairedMessage(repairedThroughDate: string): string {
  return `GoalPilot repaired the pending Story day through ${repairedThroughDate}. Refresh before starting a new milestone.`;
}

function requireCompletedPendingStoryDay(
  result: Awaited<ReturnType<typeof processDemoAutopilot>>,
  pendingDate: string,
): void {
  if (result.toDate !== pendingDate || result.failures.length > 0) {
    throw new StateConflictError(pendingStoryDayRepairFailureMessage);
  }
}

type GoalPilotApp = FastifyInstance<
  RawServerDefault,
  RawRequestDefaultExpression,
  RawReplyDefaultExpression,
  Logger,
  ZodTypeProvider
>;

export async function buildApp(dependencies: AppDependencies): Promise<GoalPilotApp> {
  const { configuration, database } = dependencies;
  const repository = new GoalPilotRepository(database);
  const experienceRepository = new ProductExperienceRepository(database);
  const planRepository = new PlanExperienceRepository(database);
  const timingRepository = configuration.PURCHASE_TIMING_LAB_ENABLED
    ? new PurchaseTimingRepository(database)
    : null;
  const historicalPriceProvider = configuration.PURCHASE_TIMING_LAB_ENABLED
    ? (dependencies.historicalPriceProvider ?? new FixtureHistoricalPriceProvider())
    : null;
  const clock = dependencies.clock ?? new PersistedApplicationClock(repository);
  const rateProvider = dependencies.rateProvider ?? new StaticRateProvider();
  const authProvider = new LocalAuthProvider(repository);
  const goalAccountProvider = new SimulatedGoalAccountProvider(repository);
  const contributionProvider = new SimulatedContributionProvider(repository);
  const applicationDateForUser = async (userId: string): Promise<string> => {
    const state = await experienceRepository.getUserApplicationDate(userId);
    if (state === null) throw new ResourceNotFoundError('The application clock is unavailable.');
    return state.applicationDate;
  };
  const loadPlanContext = async (
    userId: string,
    goalId: string,
  ): Promise<{
    readonly snapshot: PlanExperienceSnapshot;
    readonly applicationDate: string;
    readonly projection: PreviewOutput;
    readonly summary: PlanDecisionSummary;
    readonly health: ReturnType<typeof derivePlanHealth>;
    readonly currentAvailableFundsCents: number;
    readonly calculationContext: PlanCalculationContext;
  }> => {
    const applicationDate = await applicationDateForUser(userId);
    const snapshot = await planRepository.getCurrentPlan(userId, goalId, applicationDate);
    if (snapshot === null) throw new ResourceNotFoundError();
    const immutableProjection = immutableProjectionForSnapshot(snapshot);
    if (snapshot.goal.status === 'completed' || snapshot.goal.status === 'archived') {
      const selected = immutableProjection.vehicles.find(
        (vehicle) => vehicle.vehicleCode === snapshot.vehicleCode,
      );
      if (selected === undefined)
        throw new ConflictAppError('The selected plan model is unavailable.');
      const summary = immutableDecisionSummaryForSnapshot(snapshot, immutableProjection);
      const health = derivePlanHealth({
        paused: summary.health === 'PAUSED',
        currentAvailableFundsCents: summary.currentAvailableFundsCents,
        currentTotalValueCents: summary.currentTotalValueCents,
        targetAmountCents: snapshot.normalizedInput.targetAmountCents,
        accessConditionsSatisfied: selected.accessRequirementSatisfied,
        projectedPurchaseReadyDate: summary.projectedReadinessDate,
        targetDate: snapshot.normalizedInput.targetDate,
        contributionCadence: snapshot.normalizedInput.contributionCadence,
      });
      return {
        snapshot,
        applicationDate,
        projection: immutableProjection,
        summary,
        health,
        currentAvailableFundsCents: summary.currentAvailableFundsCents,
        calculationContext: planCalculationContextSchema.parse(snapshot.calculationContext),
      };
    }
    const account = await goalAccountProvider.summary(userId, goalId, applicationDate);
    if (account === null) throw new ResourceNotFoundError();
    const fixedTermLots = await planRepository.getFixedTermProjectionLots(
      userId,
      goalId,
      applicationDate,
    );
    const currentPersonalPrincipalCents =
      snapshot.account.openingSavingsCents + snapshot.account.postedContributionsCents;
    const calculationContext = planCalculationContextSchema.parse({
      contextVersion: 'plan-calculation-context-v1',
      personalPrincipalCents: currentPersonalPrincipalCents,
      totalLedgerValueCents: snapshot.account.ledgerBalanceCents,
      currentAvailableFundsCents: account.availableBalanceCents,
      currentAccruedInterestMicros: snapshot.account.accruedInterestMicros,
      applicationDate,
      scheduleAnchorDate: snapshot.scheduleAnchorDate,
      omittedContributionDates: snapshot.omittedContributionDates,
      fixedTermLots,
    });
    const targetHasPassed = snapshot.goal.targetDate < applicationDate;
    const projection = targetHasPassed
      ? immutableProjection
      : compareVehicles(
          snapshot.goal,
          applicationDate,
          immutableProjection.vehicles.map((vehicle) => vehicle.assumption),
          {
            scheduleAnchorDate: snapshot.scheduleAnchorDate,
            omittedContributionDates: snapshot.omittedContributionDates,
            personalPrincipalCents: calculationContext.personalPrincipalCents,
            totalLedgerValueCents: calculationContext.totalLedgerValueCents,
            currentAvailableFundsCents: calculationContext.currentAvailableFundsCents,
            currentAccruedInterestMicros: calculationContext.currentAccruedInterestMicros,
            fixedTermLots: calculationContext.fixedTermLots,
            fixedTermVehicleCode: snapshot.vehicleCode,
          },
        );
    const selected = projection.vehicles.find(
      (vehicle) => vehicle.vehicleCode === snapshot.vehicleCode,
    );
    if (selected === undefined)
      throw new ConflictAppError('The selected plan model is unavailable.');
    const expiredProjectedReadinessDate =
      account.availableBalanceCents >= snapshot.goal.targetAmountCents &&
      selected.accessRequirementSatisfied
        ? applicationDate
        : selected.projectedCompletionDate !== null &&
            selected.projectedCompletionDate > applicationDate
          ? selected.projectedCompletionDate
          : null;
    const health = derivePlanHealth({
      paused: snapshot.account.status === 'paused',
      currentAvailableFundsCents: account.availableBalanceCents,
      currentTotalValueCents: snapshot.account.ledgerBalanceCents,
      targetAmountCents: snapshot.goal.targetAmountCents,
      accessConditionsSatisfied: selected.accessRequirementSatisfied,
      projectedPurchaseReadyDate: targetHasPassed
        ? expiredProjectedReadinessDate
        : selected.projectedCompletionDate,
      targetDate: snapshot.goal.targetDate,
      contributionCadence: snapshot.goal.contributionCadence,
    });
    let summary: PlanDecisionSummary;
    if (targetHasPassed) {
      const immutableSummary = immutableDecisionSummaryForSnapshot(snapshot, immutableProjection);
      const currentTotalValueCents = snapshot.account.ledgerBalanceCents;
      summary = {
        ...immutableSummary,
        currentSavingsCents: snapshot.account.openingSavingsCents,
        postedPersonalContributionsCents: snapshot.account.postedContributionsCents,
        postedModeledInterestCents: snapshot.account.postedInterestCents,
        currentTotalValueCents,
        currentAvailableFundsCents: account.availableBalanceCents,
        futurePersonalContributionsCents: 0,
        futureModeledInterestCents: 0,
        projectedTargetDateBalanceCents: currentTotalValueCents,
        cushionCents: Math.max(0, currentTotalValueCents - snapshot.goal.targetAmountCents),
        shortfallCents: Math.max(0, snapshot.goal.targetAmountCents - currentTotalValueCents),
        projectedReadinessDate: expiredProjectedReadinessDate,
        health: health.code,
      };
    } else {
      summary = planDecisionSummary({
        goal: snapshot.goal,
        projection,
        vehicleCode: snapshot.vehicleCode,
        openingSavingsCents: snapshot.account.openingSavingsCents,
        postedContributionsCents: snapshot.account.postedContributionsCents,
        postedInterestCents: snapshot.account.postedInterestCents,
        currentAvailableFundsCents: account.availableBalanceCents,
        paused: snapshot.account.status === 'paused',
      });
    }
    return {
      snapshot,
      applicationDate,
      projection,
      summary,
      health,
      currentAvailableFundsCents: account.availableBalanceCents,
      calculationContext,
    };
  };
  const evaluateScenario = (
    context: Awaited<ReturnType<typeof loadPlanContext>>,
    change: ScenarioChange,
  ) => {
    if (
      context.snapshot.goal.status === 'completed' ||
      context.snapshot.goal.status === 'archived'
    ) {
      throw new ConflictAppError('Completed and archived plans are read-only.');
    }
    if (
      context.snapshot.goal.targetDate < context.applicationDate &&
      change.changedDimension !== 'DEADLINE'
    ) {
      throw new ConflictAppError(
        'After the target date, extend the deadline before changing another plan input.',
      );
    }
    const plan = {
      asOfDate: context.applicationDate,
      scheduleAnchorDate: context.snapshot.scheduleAnchorDate,
      currentSavedCents: context.calculationContext.personalPrincipalCents,
      targetAmountCents: context.snapshot.goal.targetAmountCents,
      targetDate: context.snapshot.goal.targetDate,
      recurringContributionCents: context.snapshot.goal.recurringContributionCents,
      contributionCadence: context.snapshot.goal.contributionCadence,
      omittedContributionDates: context.snapshot.omittedContributionDates,
    };
    try {
      evaluatePlanScenario(plan, domainScenario(change));
    } catch (error) {
      if (error instanceof RangeError) throw new ValidationAppError(error.message);
      throw error;
    }
    const nextGoal = goalWithScenario(context.snapshot.goal, change);
    const missedContributionDate =
      change.changedDimension === 'MISSED_CONTRIBUTION' ? change.missedContributionDate : null;
    const omittedContributionDates = [
      ...context.snapshot.omittedContributionDates,
      ...(missedContributionDate === null ? [] : [missedContributionDate]),
    ];
    const rederivedFixedTermLots = context.calculationContext.fixedTermLots.map((lot) => ({
      ...lot,
      nextMaturityInterestEligible: lot.nextMaturityDate <= nextGoal.targetDate,
    }));
    const proposedAvailableFundsCents =
      context.currentAvailableFundsCents +
      rederivedFixedTermLots.reduce((available, lot) => {
        const availabilityDate =
          lot.firstMaturityDate <= nextGoal.targetDate
            ? nextGoal.targetDate
            : lot.firstMaturityDate;
        return availabilityDate <= context.applicationDate
          ? available + lot.currentBalanceCents
          : available;
      }, 0);
    const fixedTermLots = rederivedFixedTermLots.filter((lot) => {
      const availabilityDate =
        lot.firstMaturityDate <= nextGoal.targetDate ? nextGoal.targetDate : lot.firstMaturityDate;
      return availabilityDate > context.applicationDate;
    });
    const calculationContext = planCalculationContextSchema.parse({
      ...context.calculationContext,
      currentAvailableFundsCents: Math.min(
        context.calculationContext.totalLedgerValueCents,
        proposedAvailableFundsCents,
      ),
      omittedContributionDates,
      fixedTermLots,
    });
    let projection: PreviewOutput;
    try {
      projection = compareVehicles(
        nextGoal,
        context.applicationDate,
        context.projection.vehicles.map((vehicle) => vehicle.assumption),
        {
          scheduleAnchorDate: context.snapshot.scheduleAnchorDate,
          omittedContributionDates: context.snapshot.omittedContributionDates,
          missedContributionDate,
          personalPrincipalCents: calculationContext.personalPrincipalCents,
          totalLedgerValueCents: calculationContext.totalLedgerValueCents,
          currentAvailableFundsCents: calculationContext.currentAvailableFundsCents,
          currentAccruedInterestMicros: calculationContext.currentAccruedInterestMicros,
          fixedTermLots: calculationContext.fixedTermLots,
          fixedTermVehicleCode: context.snapshot.vehicleCode,
        },
      );
    } catch (error) {
      if (error instanceof RangeError) throw new ValidationAppError(error.message);
      throw error;
    }
    const proposed = planDecisionSummary({
      goal: nextGoal,
      projection,
      vehicleCode: context.snapshot.vehicleCode,
      openingSavingsCents: context.snapshot.account.openingSavingsCents,
      postedContributionsCents: context.snapshot.account.postedContributionsCents,
      postedInterestCents: context.snapshot.account.postedInterestCents,
      currentAvailableFundsCents: calculationContext.currentAvailableFundsCents,
      paused: context.snapshot.account.status === 'paused',
    });
    const comparison: ScenarioComparison = {
      changedDimension: change.changedDimension,
      current: context.summary,
      proposed,
      personalContributionChangeCents:
        proposed.futurePersonalContributionsCents -
        context.summary.futurePersonalContributionsCents,
      modeledInterestChangeCents:
        proposed.futureModeledInterestCents - context.summary.futureModeledInterestCents,
      targetDateBalanceChangeCents:
        proposed.projectedTargetDateBalanceCents - context.summary.projectedTargetDateBalanceCents,
      cushionChangeCents: proposed.cushionCents - context.summary.cushionCents,
      accessConsequence: accessConsequence(context.summary, proposed, projection),
    };
    const remainingContributionDates = generateContributionDates(
      context.snapshot.scheduleAnchorDate,
      nextGoal.targetDate,
      nextGoal.contributionCadence,
    ).filter(
      (date) =>
        date > context.applicationDate &&
        !context.snapshot.omittedContributionDates.includes(date) &&
        date !== missedContributionDate,
    );
    return {
      nextGoal,
      projection,
      calculationContext,
      comparison,
      nextContributionDate:
        context.snapshot.account.ledgerBalanceCents >= nextGoal.targetAmountCents
          ? null
          : (remainingContributionDates[0] ?? null),
    };
  };
  const recoveryForContext = (
    context: Awaited<ReturnType<typeof loadPlanContext>>,
  ): readonly RecoveryOption[] => {
    const options = buildRecoveryOptions({
      plan: {
        asOfDate: context.applicationDate,
        scheduleAnchorDate: context.snapshot.scheduleAnchorDate,
        currentSavedCents: context.calculationContext.personalPrincipalCents,
        targetAmountCents: context.snapshot.goal.targetAmountCents,
        targetDate: context.snapshot.goal.targetDate,
        recurringContributionCents: context.snapshot.goal.recurringContributionCents,
        contributionCadence: context.snapshot.goal.contributionCadence,
        omittedContributionDates: context.snapshot.omittedContributionDates,
      },
      planHealth: context.summary.health,
    });
    return recoveryOptionsFromSelectedVehicleRecalculation(options, (change) => {
      const comparison = evaluateScenario(context, change).comparison;
      return {
        projectedReadinessDate: comparison.proposed.projectedReadinessDate,
        health: comparison.proposed.health,
        personalContributionChangeCents: comparison.personalContributionChangeCents,
        modeledInterestChangeCents: comparison.modeledInterestChangeCents,
      };
    });
  };
  const app = Fastify({
    loggerInstance: createLogger(configuration.LOG_LEVEL),
    bodyLimit: 64 * 1024,
    genReqId: () => ulid(),
    logController: new LogController({ disableRequestLogging: true }),
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(cookie, { secret: configuration.SESSION_SECRET });
  await app.register(cors, {
    origin: [configuration.WEB_ORIGIN],
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
      },
    },
  });
  await app.register(rateLimit, {
    max: configuration.TEST_RATE_LIMIT_MAX,
    timeWindow: '1 minute',
  });
  await app.register(sensible);
  await app.register(swagger, {
    openapi: {
      info: { title: 'GoalPilot local API', version: '0.1.0' },
      servers: [{ url: configuration.API_ORIGIN }],
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  app.addHook('onResponse', async (request, reply) => {
    request.log.info(
      {
        requestId: request.id,
        method: request.method,
        route: request.routeOptions.url,
        statusCode: reply.statusCode,
        durationMs: Math.round(reply.elapsedTime),
      },
      'Request completed',
    );
  });

  app.addHook('onRequest', async (request) => {
    if (!['POST', 'PATCH', 'DELETE', 'PUT'].includes(request.method)) return;
    if (request.headers.origin !== configuration.WEB_ORIGIN) throw new ForbiddenOperationError();
    const requestPath = request.url.split('?', 1)[0] ?? request.url;
    if (
      (!configuration.PURCHASE_TIMING_LAB_ENABLED &&
        requestPath.startsWith('/api/v1/timing-lab/')) ||
      (!configuration.DEMO_STORY_ENABLED && requestPath.startsWith('/api/v1/demo/'))
    )
      return;
    const csrfExemptMutationPaths = new Set([
      '/auth/register',
      '/auth/login',
      '/api/v1/previews',
      '/api/v1/baselines',
    ]);
    if (csrfExemptMutationPaths.has(requestPath)) return;
    if (requestPath === '/auth/logout') {
      await verifyCsrf(request, repository);
      return;
    }
    if (!requestPath.startsWith('/api/v1/')) return;
    await verifyCsrf(request, repository);
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      void reply.status(error.httpStatus).send({
        error: {
          code: error.code,
          message: error.message,
          requestId: request.id,
          fieldErrors: null,
        },
      });
      return;
    }
    if (typeof error === 'object' && error !== null && 'validation' in error) {
      void reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Check the highlighted information and try again.',
          requestId: request.id,
          fieldErrors: null,
        },
      });
      return;
    }
    if (
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      typeof error.statusCode === 'number' &&
      error.statusCode >= 400 &&
      error.statusCode < 500
    ) {
      const statusCode = error.statusCode;
      const code =
        statusCode === 413
          ? 'PAYLOAD_TOO_LARGE'
          : statusCode === 429
            ? 'RATE_LIMITED'
            : 'BAD_REQUEST';
      const message =
        statusCode === 413
          ? 'The request is larger than GoalPilot accepts.'
          : statusCode === 429
            ? 'Too many requests. Wait a moment and try again.'
            : 'The request could not be understood.';
      void reply.status(statusCode).send({
        error: { code, message, requestId: request.id, fieldErrors: null },
      });
      return;
    }
    request.log.error(
      { ...safeErrorContext(error), requestId: request.id },
      'Unexpected request failure',
    );
    void reply.status(500).send({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Something went wrong. Try again with the request reference shown.',
        requestId: request.id,
        fieldErrors: null,
      },
    });
  });

  app.get(
    '/health/live',
    { schema: { tags: ['health'], response: { 200: healthLiveOutputSchema } } },
    () => ({ status: 'live' as const }),
  );
  app.get(
    '/health/ready',
    {
      schema: {
        tags: ['health'],
        response: { 200: healthReadyOutputSchema, 503: healthNotReadyOutputSchema },
      },
    },
    async (_request, reply) => {
      try {
        await checkDatabase(database);
        return { status: 'ready' as const, database: 'ready' as const };
      } catch {
        return reply
          .status(503)
          .send({ status: 'not_ready' as const, database: 'unavailable' as const });
      }
    },
  );

  app.get(
    '/api/v1/vehicle-catalog',
    { schema: { response: { 200: vehicleCatalogOutputSchema } } },
    async () => {
      const asOfDate = await clock.today();
      const vehicles = await rateProvider.getCatalog(asOfDate);
      return {
        assumptionVersion: vehicles[0]?.assumptionVersion ?? 'missing',
        vehicles: [...vehicles],
      };
    },
  );

  app.get(
    '/api/v1/capabilities',
    { schema: { response: { 200: capabilitiesOutputSchema } } },
    async (request) => {
      const user = await requireUser(request, repository);
      return {
        demoStory:
          configuration.DEMO_STORY_ENABLED &&
          (await experienceRepository.isDemoFixtureUser(user.id)),
        purchaseTimingLab: configuration.PURCHASE_TIMING_LAB_ENABLED,
        applicationDate: await applicationDateForUser(user.id),
      };
    },
  );

  app.post(
    '/api/v1/previews',
    { schema: { body: previewInputSchema, response: { 200: previewOutputSchema } } },
    async (request) => {
      const { asOfDate: explicitDate, ...goalFields } = request.body;
      const user = await currentUser(request, repository);
      const ownerDate = user === null ? null : await applicationDateForUser(user.id);
      if (explicitDate !== undefined && ownerDate !== null && explicitDate !== ownerDate)
        throw new ValidationAppError(
          'Authenticated previews must use the current application date.',
        );
      const asOfDate = explicitDate ?? ownerDate ?? (await clock.today());
      const goal = goalInputSchema.parse(goalFields);
      try {
        return compareVehicles(goal, asOfDate, await rateProvider.getCatalog(asOfDate));
      } catch (error) {
        if (error instanceof RangeError) throw new ValidationAppError(error.message);
        throw error;
      }
    },
  );

  app.post(
    '/api/v1/baselines',
    {
      schema: {
        body: safeBaselineInputSchema,
        response: { 200: safeBaselineResponseSchema },
      },
    },
    async (request) => {
      const user = await currentUser(request, repository);
      const asOfDate = user === null ? await clock.today() : await applicationDateForUser(user.id);
      if (request.body.targetDate < asOfDate)
        throw new ValidationAppError('Target date cannot be before the application date.');
      const contributionDates = generateContributionDates(
        asOfDate,
        request.body.targetDate,
        request.body.contributionCadence,
      );
      const baseline = calculateSafeContribution({
        targetAmountCents: request.body.targetAmountCents,
        currentSavedCents: request.body.currentSavedCents,
        contributionDates,
      });
      const response = safeBaselineOutputSchema.safeParse({
        ...request.body,
        ...baseline,
        asOfDate,
        firstContributionDate:
          baseline.status === 'possible' ? (contributionDates[0] ?? null) : null,
        calculationPolicyVersion: 'product-experience-v1',
      });
      if (!response.success)
        throw new ValidationAppError('This baseline is outside the supported simulation range.');
      return { baseline: response.data };
    },
  );

  app.post(
    '/auth/register',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: { body: registerInputSchema, response: { 201: authSessionOutputSchema } },
    },
    async (request, reply) => {
      try {
        const user = await authProvider.register(request.body);
        const csrfToken = await issueSession(repository, configuration, user.id, reply);
        await repository.audit(user.id, 'auth.registered');
        return await reply.status(201).send({ user, csrfToken });
      } catch (error) {
        if (isUniqueViolation(error))
          throw new ConflictAppError('An account with this email already exists.');
        throw error;
      }
    },
  );

  app.post(
    '/auth/login',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: { body: loginInputSchema, response: { 200: authSessionOutputSchema } },
    },
    async (request, reply) => {
      const user = await authProvider.verify(request.body.email, request.body.password);
      if (user === null)
        throw new AuthenticationRequiredError('The email or password is incorrect.');
      const oldToken = request.cookies[sessionCookieName];
      if (oldToken !== undefined) await repository.deleteSession(sha256(oldToken));
      const csrfToken = await issueSession(repository, configuration, user.id, reply);
      await repository.audit(user.id, 'auth.logged_in');
      return { user, csrfToken };
    },
  );

  app.post(
    '/auth/logout',
    { schema: { body: optionalEmptyMutationInputSchema, response: { 204: z.null() } } },
    async (request, reply) => {
      const token = request.cookies[sessionCookieName];
      if (token !== undefined) await repository.deleteSession(sha256(token));
      clearSessionCookies(reply);
      return reply.status(204).send(null);
    },
  );

  app.get('/api/v1/me', { schema: { response: { 200: meOutputSchema } } }, async (request) => {
    const user = await requireUser(request, repository);
    return { user, csrfToken: request.cookies[csrfCookieName] ?? null };
  });

  app.get(
    '/api/v1/goals',
    { schema: { response: { 200: goalListOutputSchema } } },
    async (request) => {
      const user = await requireUser(request, repository);
      return { goals: [...(await repository.listGoals(user.id))] };
    },
  );

  app.get(
    '/api/v1/goal-drafts',
    { schema: { response: { 200: goalDraftListOutputSchema } } },
    async (request) => {
      const user = await requireUser(request, repository);
      return { drafts: [...(await experienceRepository.listGoalDrafts(user.id))] };
    },
  );

  app.post(
    '/api/v1/goal-drafts',
    {
      schema: {
        body: goalDraftCreateInputSchema,
        headers: idempotencyHeaders,
        response: { 201: goalDraftSchema },
      },
    },
    async (request, reply) => {
      const user = await requireUser(request, repository);
      try {
        const result = await experienceRepository.createGoalDraft({
          userId: user.id,
          data: request.body.data,
          lastCompletedStep: request.body.lastCompletedStep,
          idempotencyKey: request.headers['idempotency-key'],
          requestHash: canonicalRequestHash(request.body),
          requestId: request.id,
        });
        if (result.replayed) reply.header('idempotency-replayed', 'true');
        return await reply.status(201).send(result.draft);
      } catch (error) {
        if (error instanceof IdempotencyConflictError) throw new ConflictAppError(error.message);
        throw error;
      }
    },
  );

  app.get(
    '/api/v1/goal-drafts/:draftId',
    { schema: { params: draftIdParameters, response: { 200: goalDraftSchema } } },
    async (request) => {
      const user = await requireUser(request, repository);
      const draft = await experienceRepository.getGoalDraft(user.id, request.params.draftId);
      if (draft === null) throw new ResourceNotFoundError();
      return draft;
    },
  );

  app.patch(
    '/api/v1/goal-drafts/:draftId',
    {
      schema: {
        params: draftIdParameters,
        body: goalDraftUpdateInputSchema,
        headers: idempotencyHeaders,
        response: { 200: goalDraftSchema },
      },
    },
    async (request, reply) => {
      const user = await requireUser(request, repository);
      if ((await experienceRepository.getGoalDraft(user.id, request.params.draftId)) === null)
        throw new ResourceNotFoundError();
      try {
        const result = await experienceRepository.updateGoalDraft({
          userId: user.id,
          draftId: request.params.draftId,
          expectedVersion: request.body.expectedVersion,
          data: request.body.data,
          lastCompletedStep: request.body.lastCompletedStep,
          idempotencyKey: request.headers['idempotency-key'],
          requestHash: canonicalRequestHash({
            draftId: request.params.draftId,
            body: request.body,
          }),
          requestId: request.id,
        });
        if (result.draft === null)
          throw new ConflictAppError('The draft changed. Refresh and try again.');
        if (result.replayed) reply.header('idempotency-replayed', 'true');
        return result.draft;
      } catch (error) {
        if (error instanceof IdempotencyConflictError) throw new ConflictAppError(error.message);
        throw error;
      }
    },
  );

  app.post(
    '/api/v1/goal-drafts/:draftId/activate',
    {
      schema: {
        params: draftIdParameters,
        body: goalDraftActivateInputSchema,
        headers: idempotencyHeaders,
        response: { 201: initialPlanActivationOutputSchema },
      },
    },
    async (request, reply) => {
      const user = await requireUser(request, repository);
      const requestHash = canonicalRequestHash({
        draftId: request.params.draftId,
        body: request.body,
      });
      const replay = await getIdempotentReplay(
        experienceRepository,
        {
          userId: user.id,
          operation: 'goal-draft.activate',
          idempotencyKey: request.headers['idempotency-key'],
          requestHash,
        },
        initialPlanActivationOutputSchema,
      );
      if (replay !== null) {
        reply.header('idempotency-replayed', 'true');
        return await reply.status(201).send(replay.value);
      }
      const draft = await experienceRepository.getGoalDraft(user.id, request.params.draftId);
      if (draft === null) throw new ResourceNotFoundError();
      const { goal, budgetFit } = completeDraftGoal(draft.data);
      const applicationDate = await applicationDateForUser(user.id);
      if (goal.targetDate < applicationDate)
        throw new ValidationAppError('Target date cannot be before the application date.');
      const contributionDates = generateContributionDates(
        applicationDate,
        goal.targetDate,
        goal.contributionCadence,
      );
      const safeBaseline = calculateSafeContribution({
        targetAmountCents: goal.targetAmountCents,
        currentSavedCents: goal.currentSavedCents,
        contributionDates,
      });
      if (safeBaseline.safeContributionCents === null)
        throw new ValidationAppError('The selected schedule has no remaining contribution dates.');
      const budgetComparison = Math.sign(
        goal.recurringContributionCents - safeBaseline.safeContributionCents,
      );
      if (
        (budgetFit === 'lower' && budgetComparison >= 0) ||
        (budgetFit === 'equal' && budgetComparison !== 0) ||
        (budgetFit === 'higher' && budgetComparison <= 0)
      ) {
        throw new ValidationAppError(
          'The chosen contribution does not match the saved budget fit.',
        );
      }
      let projection: PreviewOutput;
      try {
        projection = compareVehicles(
          goal,
          applicationDate,
          await rateProvider.getCatalog(applicationDate),
        );
      } catch (error) {
        if (error instanceof RangeError) throw new ValidationAppError(error.message);
        throw error;
      }
      const fixedTerm =
        request.body.vehicleCode === 'cd_ladder' || request.body.vehicleCode === 'treasury_ladder';
      const selectedVehicle = projection.vehicles.find(
        (vehicle) => vehicle.vehicleCode === request.body.vehicleCode,
      );
      if (selectedVehicle === undefined)
        throw new ConflictAppError('The selected plan model is unavailable.');
      const firstMaturityDate = addCalendarDays(
        applicationDate,
        selectedVehicle.assumption.lockDays,
      );
      const calculationContext = planCalculationContextSchema.parse({
        contextVersion: 'plan-calculation-context-v1',
        personalPrincipalCents: goal.currentSavedCents,
        totalLedgerValueCents: goal.currentSavedCents,
        currentAvailableFundsCents: fixedTerm ? 0 : goal.currentSavedCents,
        currentAccruedInterestMicros: 0,
        applicationDate,
        scheduleAnchorDate: applicationDate,
        omittedContributionDates: [],
        fixedTermLots:
          fixedTerm && goal.currentSavedCents > 0
            ? [
                {
                  personalPrincipalCents: goal.currentSavedCents,
                  currentBalanceCents: goal.currentSavedCents,
                  firstMaturityDate,
                  nextMaturityDate: firstMaturityDate,
                  nextMaturityInterestEligible: firstMaturityDate <= goal.targetDate,
                },
              ]
            : [],
      });
      const summary = planDecisionSummary({
        goal,
        projection,
        vehicleCode: request.body.vehicleCode,
        openingSavingsCents: goal.currentSavedCents,
        postedContributionsCents: 0,
        postedInterestCents: 0,
        currentAvailableFundsCents: fixedTerm ? 0 : goal.currentSavedCents,
        paused: false,
        requireEligible: true,
      });
      try {
        const result = await planRepository.activateDraft({
          userId: user.id,
          draftId: request.params.draftId,
          expectedDraftVersion: request.body.expectedDraftVersion,
          goal,
          vehicleCode: request.body.vehicleCode,
          projection,
          summary,
          calculationContext,
          applicationDate,
          nextContributionDate:
            goal.currentSavedCents >= goal.targetAmountCents
              ? null
              : (contributionDates[0] ?? null),
          idempotencyKey: request.headers['idempotency-key'],
          requestHash,
          requestId: request.id,
        });
        if (result.replayed) reply.header('idempotency-replayed', 'true');
        return await reply.status(201).send(result.output);
      } catch (error) {
        if (error instanceof IdempotencyConflictError) throw new ConflictAppError(error.message);
        if (error instanceof StateConflictError) throw new ConflictAppError(error.message);
        if (isUniqueViolation(error))
          throw new ConflictAppError('Only one running goal is allowed.');
        throw error;
      }
    },
  );

  app.delete(
    '/api/v1/goal-drafts/:draftId',
    {
      schema: {
        params: draftIdParameters,
        body: goalDraftDiscardInputSchema,
        headers: idempotencyHeaders,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      const user = await requireUser(request, repository);
      try {
        const result = await experienceRepository.deleteGoalDraft({
          userId: user.id,
          draftId: request.params.draftId,
          expectedVersion: request.body.expectedVersion,
          idempotencyKey: request.headers['idempotency-key'],
          requestHash: canonicalRequestHash({
            draftId: request.params.draftId,
            body: request.body,
          }),
          requestId: request.id,
        });
        if (result.result === 'not_found') throw new ResourceNotFoundError();
        if (result.result === 'version_conflict')
          throw new ConflictAppError('The draft changed. Refresh and try again.');
        if (result.replayed) reply.header('idempotency-replayed', 'true');
        return await reply.status(204).send(null);
      } catch (error) {
        if (error instanceof IdempotencyConflictError) throw new ConflictAppError(error.message);
        throw error;
      }
    },
  );

  app.post(
    '/api/v1/product-events',
    {
      schema: {
        body: productEventInputSchema,
        headers: idempotencyHeaders,
        response: { 202: productEventAcceptedOutputSchema },
      },
    },
    async (request, reply) => {
      const user = await requireUser(request, repository);
      try {
        const event = {
          ...request.body,
          demo:
            configuration.DEMO_STORY_ENABLED &&
            (await experienceRepository.isDemoFixtureUser(user.id)),
        };
        const result = await experienceRepository.recordProductEvent({
          userId: user.id,
          subjectHash: sha256(`product-event:${user.id}:${configuration.SESSION_SECRET}`),
          event,
          idempotencyKey: request.headers['idempotency-key'],
          requestHash: canonicalRequestHash(request.body),
        });
        if (result.replayed) reply.header('idempotency-replayed', 'true');
        return await reply.status(202).send({ accepted: true });
      } catch (error) {
        if (error instanceof IdempotencyConflictError) throw new ConflictAppError(error.message);
        throw error;
      }
    },
  );

  app.get(
    '/api/v1/goals/:goalId/plan/summary',
    {
      schema: {
        params: goalIdParameters,
        response: { 200: currentPlanOutputSchema },
      },
    },
    async (request) => {
      const user = await requireUser(request, repository);
      const context = await loadPlanContext(user.id, request.params.goalId);
      return {
        goalVersion: context.snapshot.goal.version,
        planVersion: context.snapshot.planVersion,
        summary: context.summary,
      };
    },
  );

  app.get(
    '/api/v1/goals/:goalId/plan/health',
    {
      schema: {
        params: goalIdParameters,
        response: { 200: planHealthOutputSchema },
      },
    },
    async (request) => {
      const user = await requireUser(request, repository);
      const context = await loadPlanContext(user.id, request.params.goalId);
      return planHealthOutputSchema.parse({
        health: context.health.code,
        policyVersion: context.health.policyVersion,
        evidenceCodes: [...context.health.evidenceCodes],
        projectedReadinessDate: context.summary.projectedReadinessDate,
        nextEventDate:
          context.snapshot.account.nextContributionDate ??
          (context.health.code === 'FUNDED_BUT_LOCKED'
            ? context.summary.projectedReadinessDate
            : null),
      });
    },
  );

  app.post(
    '/api/v1/goals/:goalId/what-if/preview',
    {
      schema: {
        params: goalIdParameters,
        body: scenarioPreviewInputSchema,
        response: { 200: scenarioPreviewOutputSchema },
      },
    },
    async (request) => {
      const user = await requireUser(request, repository);
      const context = await loadPlanContext(user.id, request.params.goalId);
      if (
        context.snapshot.goal.version !== request.body.expectedGoalVersion ||
        context.snapshot.planVersion !== request.body.expectedPlanVersion
      ) {
        throw new ConflictAppError('The plan changed. Refresh before previewing this scenario.');
      }
      const scenario = evaluateScenario(context, request.body.change);
      return {
        goalVersion: context.snapshot.goal.version,
        planVersion: context.snapshot.planVersion,
        comparison: scenario.comparison,
      };
    },
  );

  app.post(
    '/api/v1/goals/:goalId/what-if/apply',
    {
      schema: {
        params: goalIdParameters,
        body: scenarioApplyInputSchema,
        headers: idempotencyHeaders,
        response: { 201: scenarioApplyOutputSchema },
      },
    },
    async (request, reply) => {
      const user = await requireUser(request, repository);
      const requestHash = canonicalRequestHash({
        goalId: request.params.goalId,
        body: request.body,
      });
      const replay = await getIdempotentReplay(
        experienceRepository,
        {
          userId: user.id,
          operation: 'goal-plan.scenario_applied',
          idempotencyKey: request.headers['idempotency-key'],
          requestHash,
        },
        scenarioApplyOutputSchema,
      );
      if (replay !== null) {
        reply.header('idempotency-replayed', 'true');
        return await reply.status(201).send(replay.value);
      }
      const context = await loadPlanContext(user.id, request.params.goalId);
      if (
        context.snapshot.goal.status === 'completed' ||
        context.snapshot.goal.status === 'archived'
      ) {
        throw new ConflictAppError('This plan is read-only after completion or archive.');
      }
      if (
        context.snapshot.goal.version !== request.body.expectedGoalVersion ||
        context.snapshot.planVersion !== request.body.expectedPlanVersion
      ) {
        throw new ConflictAppError('The plan changed. Refresh before applying this scenario.');
      }
      const scenario = evaluateScenario(context, request.body.change);
      const selected = scenario.projection.vehicles.find(
        (vehicle) => vehicle.vehicleCode === context.snapshot.vehicleCode,
      );
      if (!selected?.eligible || !selected.accessRequirementSatisfied)
        throw new ConflictAppError('This change conflicts with the selected model access policy.');
      const persistence = scenarioPersistence(request.body.change, false);
      try {
        const result = await planRepository.applyScenario({
          userId: user.id,
          goalId: request.params.goalId,
          expectedGoalVersion: request.body.expectedGoalVersion,
          expectedPlanVersion: request.body.expectedPlanVersion,
          goal: scenario.nextGoal,
          projection: scenario.projection,
          summary: scenario.comparison.proposed,
          calculationContext: scenario.calculationContext,
          comparison: scenario.comparison,
          changeKind: 'scenario_applied',
          ...persistence,
          applicationDate: context.applicationDate,
          nextContributionDate: scenario.nextContributionDate,
          expectedFinancialRevision: {
            accountId: context.snapshot.account.id,
            accountStatus: context.snapshot.account.status,
            nextContributionDate: context.snapshot.account.nextContributionDate,
            lastProcessedDate: context.snapshot.account.lastProcessedDate,
            lastAccrualDate: context.snapshot.account.lastAccrualDate,
            ledgerEntryCount: context.snapshot.account.ledgerEntryCount,
            personalPrincipalCents: context.calculationContext.personalPrincipalCents,
            totalLedgerValueCents: context.calculationContext.totalLedgerValueCents,
            currentAvailableFundsCents: context.currentAvailableFundsCents,
            currentAccruedInterestMicros: context.calculationContext.currentAccruedInterestMicros,
          },
          idempotencyKey: request.headers['idempotency-key'],
          requestHash,
          requestId: request.id,
        });
        if (result.replayed) reply.header('idempotency-replayed', 'true');
        return await reply.status(201).send(result.output);
      } catch (error) {
        if (error instanceof IdempotencyConflictError) throw new ConflictAppError(error.message);
        if (error instanceof StateConflictError) throw new ConflictAppError(error.message);
        throw error;
      }
    },
  );

  app.get(
    '/api/v1/goals/:goalId/recovery',
    {
      schema: {
        params: goalIdParameters,
        response: { 200: recoveryOptionsOutputSchema },
      },
    },
    async (request) => {
      const user = await requireUser(request, repository);
      const context = await loadPlanContext(user.id, request.params.goalId);
      if (
        context.snapshot.goal.status === 'completed' ||
        context.snapshot.goal.status === 'archived'
      ) {
        return {
          health: context.summary.health,
          options: [],
        };
      }
      return {
        health: context.summary.health,
        options: [...recoveryForContext(context)],
      };
    },
  );

  app.post(
    '/api/v1/goals/:goalId/recovery/apply',
    {
      schema: {
        params: goalIdParameters,
        body: scenarioApplyInputSchema,
        headers: idempotencyHeaders,
        response: { 201: scenarioApplyOutputSchema },
      },
    },
    async (request, reply) => {
      const user = await requireUser(request, repository);
      const requestHash = canonicalRequestHash({
        goalId: request.params.goalId,
        body: request.body,
      });
      const replay = await getIdempotentReplay(
        experienceRepository,
        {
          userId: user.id,
          operation: 'goal-plan.recovery_applied',
          idempotencyKey: request.headers['idempotency-key'],
          requestHash,
        },
        scenarioApplyOutputSchema,
      );
      if (replay !== null) {
        reply.header('idempotency-replayed', 'true');
        return await reply.status(201).send(replay.value);
      }
      const context = await loadPlanContext(user.id, request.params.goalId);
      if (
        context.snapshot.goal.status === 'completed' ||
        context.snapshot.goal.status === 'archived'
      ) {
        throw new ConflictAppError('This plan is read-only after completion or archive.');
      }
      if (
        context.snapshot.goal.version !== request.body.expectedGoalVersion ||
        context.snapshot.planVersion !== request.body.expectedPlanVersion
      ) {
        throw new ConflictAppError('The plan changed. Refresh before applying recovery.');
      }
      const options = recoveryForContext(context);
      const selectedOption = options.find(
        (option) =>
          option.availability === 'available' &&
          canonicalRequestHash(option.change) === canonicalRequestHash(request.body.change),
      );
      if (selectedOption === undefined)
        throw new ConflictAppError('Choose a currently available recovery option.');
      const scenario = evaluateScenario(context, request.body.change);
      const selectedVehicle = scenario.projection.vehicles.find(
        (vehicle) => vehicle.vehicleCode === context.snapshot.vehicleCode,
      );
      if (!selectedVehicle?.eligible || !selectedVehicle.accessRequirementSatisfied)
        throw new ConflictAppError(
          'This recovery conflicts with the selected model access policy.',
        );
      const persistence = scenarioPersistence(request.body.change, true);
      try {
        const result = await planRepository.applyScenario({
          userId: user.id,
          goalId: request.params.goalId,
          expectedGoalVersion: request.body.expectedGoalVersion,
          expectedPlanVersion: request.body.expectedPlanVersion,
          goal: scenario.nextGoal,
          projection: scenario.projection,
          summary: scenario.comparison.proposed,
          calculationContext: scenario.calculationContext,
          comparison: scenario.comparison,
          changeKind: 'recovery_applied',
          ...persistence,
          applicationDate: context.applicationDate,
          nextContributionDate: scenario.nextContributionDate,
          expectedFinancialRevision: {
            accountId: context.snapshot.account.id,
            accountStatus: context.snapshot.account.status,
            nextContributionDate: context.snapshot.account.nextContributionDate,
            lastProcessedDate: context.snapshot.account.lastProcessedDate,
            lastAccrualDate: context.snapshot.account.lastAccrualDate,
            ledgerEntryCount: context.snapshot.account.ledgerEntryCount,
            personalPrincipalCents: context.calculationContext.personalPrincipalCents,
            totalLedgerValueCents: context.calculationContext.totalLedgerValueCents,
            currentAvailableFundsCents: context.currentAvailableFundsCents,
            currentAccruedInterestMicros: context.calculationContext.currentAccruedInterestMicros,
          },
          idempotencyKey: request.headers['idempotency-key'],
          requestHash,
          requestId: request.id,
        });
        if (result.replayed) reply.header('idempotency-replayed', 'true');
        return await reply.status(201).send(result.output);
      } catch (error) {
        if (error instanceof IdempotencyConflictError) throw new ConflictAppError(error.message);
        if (error instanceof StateConflictError) throw new ConflictAppError(error.message);
        throw error;
      }
    },
  );

  app.get(
    '/api/v1/goals/:goalId/plan/history',
    {
      schema: {
        params: goalIdParameters,
        response: { 200: planHistoryOutputSchema },
      },
    },
    async (request) => {
      const user = await requireUser(request, repository);
      const snapshots = await planRepository.getPlanHistory(user.id, request.params.goalId);
      if (snapshots.length === 0) throw new ResourceNotFoundError();
      const changedDimension = {
        recurring_contribution: 'CONTRIBUTION',
        target_date: 'DEADLINE',
        target_amount: 'TARGET',
        missed_contribution: 'MISSED_CONTRIBUTION',
      } as const;
      const latest = snapshots.at(-1);
      if (latest === undefined) throw new ResourceNotFoundError();
      return {
        goalId: request.params.goalId,
        currentGoalVersion: latest.goal.version,
        versions: snapshots.map((snapshot) => {
          const summary = immutableDecisionSummaryForSnapshot(snapshot);
          const appliedChange =
            snapshot.changedField === null
              ? null
              : scenarioChangeSchema.parse({
                  changedDimension: changedDimension[snapshot.changedField],
                  ...(snapshot.changePayload as Readonly<Record<string, unknown>>),
                });
          return {
            id: snapshot.planVersionId,
            version: snapshot.planVersion,
            activatedDate: snapshot.applicationDate,
            appliedAt: snapshot.activatedAt,
            changedDimension:
              snapshot.changedField === null ? null : changedDimension[snapshot.changedField],
            change: appliedChange,
            basePlanVersionId: snapshot.basePlanVersionId,
            changeReason:
              snapshot.changeKind === 'initial_activation'
                ? ('INITIAL_ACTIVATION' as const)
                : snapshot.changeKind === 'recovery_applied'
                  ? ('RECOVERY_APPLIED' as const)
                  : ('WHAT_IF_APPLIED' as const),
            calculationPolicyVersion: 'product-experience-v1' as const,
            assumptionVersion: snapshot.assumptionVersion,
            fromRecovery: snapshot.changeKind === 'recovery_applied',
            summary,
          };
        }),
      };
    },
  );

  const repairPendingStoryDay = async (userId: string, goalId: string): Promise<string | null> => {
    if (!(await experienceRepository.isDemoFixtureUser(userId))) {
      throw new ForbiddenOperationError();
    }
    const financialRunToken = ulid();
    if (
      !(await experienceRepository.claimOwnerFinancialRun({
        userId,
        runToken: financialRunToken,
      }))
    ) {
      throw new StateConflictError('A Story Mode financial run is already in progress.');
    }
    let executionFailure: { readonly error: unknown } | null = null;
    let repairedThroughDate: string | null | undefined;
    try {
      const clockState = await experienceRepository.getUserApplicationDate(userId);
      if (clockState === null) throw new ResourceNotFoundError();
      const milestoneContext = await experienceRepository.getDemoMilestoneContext(
        userId,
        goalId,
        clockState.applicationDate,
      );
      if (milestoneContext === null) throw new ResourceNotFoundError();
      const pendingDate = milestoneContext.pendingFinancialDate;
      if (pendingDate === null || pendingDate <= clockState.applicationDate) {
        repairedThroughDate = null;
      } else {
        const repaired = await processDemoAutopilot(repository, pendingDate, {
          clock: new PersistedUserApplicationClock(experienceRepository, userId),
          userId,
          ...(dependencies.demoAutopilotBeforeClockAdvance === undefined
            ? {}
            : { beforeClockAdvance: dependencies.demoAutopilotBeforeClockAdvance }),
        });
        requireCompletedPendingStoryDay(repaired, pendingDate);
        repairedThroughDate = pendingDate;
      }
    } catch (error) {
      executionFailure = { error };
    }
    const released = await experienceRepository.releaseOwnerFinancialRun({
      userId,
      runToken: financialRunToken,
    });
    if (!released) {
      throw new StateConflictError('Story Mode financial run ownership was lost.');
    }
    if (executionFailure !== null) throw executionFailure.error;
    if (repairedThroughDate === undefined) {
      throw new Error('Story Mode pending-day recovery did not produce a result.');
    }
    return repairedThroughDate;
  };

  if (configuration.DEMO_STORY_ENABLED) {
    app.post(
      '/api/v1/demo/advance',
      {
        schema: {
          body: demoAdvanceInputSchema,
          headers: idempotencyHeaders,
          response: { 200: demoRunSummarySchema },
        },
      },
      async (request, reply) => {
        const user = await requireUser(request, repository);
        try {
          const result = await runIdempotentApplicationRequest(experienceRepository, {
            userId: user.id,
            operation: 'demo.advance',
            idempotencyKey: request.headers['idempotency-key'],
            requestHash: canonicalRequestHash(request.body),
            responseStatus: 200,
            execute: async () => {
              if (!(await experienceRepository.isDemoFixtureUser(user.id))) {
                throw new ForbiddenOperationError();
              }
              const financialRunToken = ulid();
              if (
                !(await experienceRepository.claimOwnerFinancialRun({
                  userId: user.id,
                  runToken: financialRunToken,
                }))
              ) {
                throw new StateConflictError('A Story Mode financial run is already in progress.');
              }
              let executionFailure: { readonly error: unknown } | null = null;
              let summary: z.infer<typeof demoRunSummarySchema> | undefined;
              try {
                const clockState = await experienceRepository.getUserApplicationDate(user.id);
                if (clockState === null) throw new ResourceNotFoundError();
                const milestoneContext = await experienceRepository.getDemoMilestoneContext(
                  user.id,
                  request.body.goalId,
                  clockState.applicationDate,
                );
                if (milestoneContext === null) throw new ResourceNotFoundError();

                const { targetDate, pendingRecoveryDate } = resolveDemoAutopilotTarget(
                  clockState.applicationDate,
                  request.body.milestone,
                  milestoneContext,
                );

                let noEventDue = false;
                let run;
                if (targetDate === null || targetDate <= clockState.applicationDate) {
                  noEventDue = true;
                  run = {
                    fromDate: clockState.applicationDate,
                    toDate: clockState.applicationDate,
                    contributionsPosted: 0,
                    interestPostings: 0,
                    modeledInterestAddedCents: 0,
                    skippedDuplicates: 0,
                    purchaseReadyTransitions: 0,
                    failures: [],
                  };
                } else {
                  run = await processDemoAutopilot(repository, targetDate, {
                    clock: new PersistedUserApplicationClock(experienceRepository, user.id),
                    userId: user.id,
                    ...(dependencies.demoAutopilotBeforeClockAdvance === undefined
                      ? {}
                      : { beforeClockAdvance: dependencies.demoAutopilotBeforeClockAdvance }),
                  });
                }
                if (pendingRecoveryDate !== null) {
                  requireCompletedPendingStoryDay(run, pendingRecoveryDate);
                  throw new ConflictAppError(pendingStoryDayRepairedMessage(pendingRecoveryDate));
                }
                const current = await loadPlanContext(user.id, request.body.goalId);
                const failureCodes: z.infer<typeof demoRunSummarySchema>['failureCodes'][number][] =
                  [];
                if (noEventDue) failureCodes.push('NO_EVENT_DUE');
                if (run.skippedDuplicates > 0) failureCodes.push('ALREADY_PROCESSED');
                if (run.failures.length > 0) failureCodes.push('PROCESSING_FAILED');
                if (current.health.code === 'FUNDED_BUT_LOCKED')
                  failureCodes.push('LOCKED_UNTIL_MATURITY');
                summary = demoRunSummarySchema.parse({
                  milestone: request.body.milestone,
                  fromDate: run.fromDate,
                  toDate: run.toDate,
                  contributionsPosted: run.contributionsPosted,
                  interestPostings: run.interestPostings,
                  modeledInterestAddedCents: run.modeledInterestAddedCents,
                  skippedDuplicates: run.skippedDuplicates,
                  purchaseReadyTransitions: run.purchaseReadyTransitions,
                  failureCodes: [...new Set(failureCodes)],
                  health: current.health.code,
                });
              } catch (error) {
                executionFailure = { error };
              }
              const released = await experienceRepository.releaseOwnerFinancialRun({
                userId: user.id,
                runToken: financialRunToken,
              });
              if (!released) {
                throw new StateConflictError('Story Mode financial run ownership was lost.');
              }
              if (executionFailure !== null) throw executionFailure.error;
              if (summary === undefined) throw new Error('Story Mode did not produce a summary.');
              return summary;
            },
          });
          if (result.replayed) reply.header('idempotency-replayed', 'true');
          return result.value;
        } catch (error) {
          if (error instanceof IdempotencyConflictError) throw new ConflictAppError(error.message);
          if (error instanceof IndeterminateApplicationCommandError) {
            try {
              const repairedThroughDate = await repairPendingStoryDay(user.id, request.body.goalId);
              if (repairedThroughDate !== null) {
                throw new ConflictAppError(pendingStoryDayRepairedMessage(repairedThroughDate));
              }
            } catch (repairError) {
              if (repairError instanceof AppError) throw repairError;
              if (repairError instanceof StateConflictError) {
                throw new ConflictAppError(repairError.message);
              }
              throw repairError;
            }
            throw new ConflictAppError(error.message);
          }
          if (error instanceof StateConflictError) throw new ConflictAppError(error.message);
          throw error;
        }
      },
    );

    app.post(
      '/api/v1/demo/reset',
      {
        schema: {
          body: demoResetInputSchema,
          headers: idempotencyHeaders,
          response: { 200: demoResetOutputSchema },
        },
      },
      async (request, reply) => {
        const user = await requireUser(request, repository);
        try {
          const result = await runIdempotentApplicationRequest(experienceRepository, {
            userId: user.id,
            operation: 'demo.reset',
            idempotencyKey: request.headers['idempotency-key'],
            requestHash: canonicalRequestHash(request.body),
            responseStatus: 200,
            execute: async () => {
              const reset = await experienceRepository.resetSeededDemo({
                userId: user.id,
                goalId: request.body.goalId,
                expectedGoalVersion: request.body.expectedGoalVersion,
                requestId: request.id,
              });
              if (reset.result === 'reset')
                return { reset: true as const, resetGeneration: reset.resetGeneration };
              if (reset.result === 'version_conflict')
                throw new ConflictAppError('The seeded goal changed. Refresh before resetting.');
              throw new ResourceNotFoundError();
            },
          });
          if (result.replayed) reply.header('idempotency-replayed', 'true');
          return result.value;
        } catch (error) {
          if (error instanceof IdempotencyConflictError) throw new ConflictAppError(error.message);
          if (error instanceof StateConflictError) throw new ConflictAppError(error.message);
          throw error;
        }
      },
    );
  }

  if (timingRepository !== null && historicalPriceProvider !== null) {
    app.get(
      '/api/v1/timing-lab/purchase-items',
      { schema: { response: { 200: purchaseItemListOutputSchema } } },
      async (request) => {
        const user = await requireUser(request, repository);
        return { items: [...(await timingRepository.listPurchaseItems(user.id))] };
      },
    );

    app.post(
      '/api/v1/timing-lab/purchase-items',
      {
        schema: {
          body: purchaseItemCreateInputSchema,
          headers: idempotencyHeaders,
          response: { 201: purchaseItemSchema },
        },
      },
      async (request, reply) => {
        const user = await requireUser(request, repository);
        try {
          const result = await timingRepository.createPurchaseItem({
            userId: user.id,
            goalId: request.body.goalId,
            fixtureCode: request.body.fixtureCode,
            currency: request.body.currency,
            targetPriceCents: request.body.targetPriceCents,
            idempotencyKey: request.headers['idempotency-key'],
            requestHash: canonicalRequestHash(request.body),
          });
          if (result.replayed) reply.header('idempotency-replayed', 'true');
          return await reply.status(201).send(result.item);
        } catch (error) {
          if (error instanceof IdempotencyConflictError) throw new ConflictAppError(error.message);
          if (error instanceof StateConflictError) throw new ResourceNotFoundError();
          throw error;
        }
      },
    );

    app.patch(
      '/api/v1/timing-lab/purchase-items/:itemId',
      {
        schema: {
          params: purchaseItemIdParameters,
          body: purchaseItemUpdateInputSchema,
          headers: idempotencyHeaders,
          response: { 200: purchaseItemSchema },
        },
      },
      async (request, reply) => {
        const user = await requireUser(request, repository);
        try {
          if ((await timingRepository.getPurchaseItem(user.id, request.params.itemId)) === null) {
            throw new ResourceNotFoundError();
          }
          const result = await timingRepository.updatePurchaseItem({
            userId: user.id,
            itemId: request.params.itemId,
            expectedVersion: request.body.expectedVersion,
            targetPriceCents: request.body.targetPriceCents,
            idempotencyKey: request.headers['idempotency-key'],
            requestHash: canonicalRequestHash({
              itemId: request.params.itemId,
              body: request.body,
            }),
          });
          if (result.item === null)
            throw new ConflictAppError('The purchase item changed or is no longer available.');
          if (result.replayed) reply.header('idempotency-replayed', 'true');
          return result.item;
        } catch (error) {
          if (error instanceof IdempotencyConflictError) throw new ConflictAppError(error.message);
          if (error instanceof StateConflictError) throw new ConflictAppError(error.message);
          throw error;
        }
      },
    );

    app.post(
      '/api/v1/timing-lab/purchase-items/:itemId/archive',
      {
        schema: {
          params: purchaseItemIdParameters,
          body: purchaseItemArchiveInputSchema,
          headers: idempotencyHeaders,
          response: { 200: purchaseItemSchema },
        },
      },
      async (request, reply) => {
        const user = await requireUser(request, repository);
        try {
          if ((await timingRepository.getPurchaseItem(user.id, request.params.itemId)) === null) {
            throw new ResourceNotFoundError();
          }
          const result = await timingRepository.archivePurchaseItem({
            userId: user.id,
            itemId: request.params.itemId,
            expectedVersion: request.body.expectedVersion,
            idempotencyKey: request.headers['idempotency-key'],
            requestHash: canonicalRequestHash({
              itemId: request.params.itemId,
              body: request.body,
            }),
          });
          if (result.item === null)
            throw new ConflictAppError('The purchase item changed or is no longer available.');
          if (result.replayed) reply.header('idempotency-replayed', 'true');
          return result.item;
        } catch (error) {
          if (error instanceof IdempotencyConflictError) throw new ConflictAppError(error.message);
          if (error instanceof StateConflictError) throw new ConflictAppError(error.message);
          throw error;
        }
      },
    );

    app.get(
      '/api/v1/timing-lab/purchase-items/:itemId/latest',
      {
        schema: {
          params: purchaseItemIdParameters,
          response: { 200: purchaseTimingLatestOutputSchema },
        },
      },
      async (request) => {
        const user = await requireUser(request, repository);
        const latest = await timingRepository.getLatest(user.id, request.params.itemId);
        if (latest === null) throw new ResourceNotFoundError();
        return latest;
      },
    );

    app.post(
      '/api/v1/timing-lab/purchase-items/:itemId/watch-policies',
      {
        schema: {
          params: purchaseItemIdParameters,
          body: priceWatchPolicyCreateInputSchema,
          headers: idempotencyHeaders,
          response: { 201: priceWatchPolicySchema },
        },
      },
      async (request, reply) => {
        const user = await requireUser(request, repository);
        if (request.body.nextDueDate < (await applicationDateForUser(user.id)))
          throw new ValidationAppError('The next price check cannot be scheduled in the past.');
        try {
          const result = await timingRepository.createWatchPolicy({
            userId: user.id,
            itemId: request.params.itemId,
            cadence: request.body.cadence,
            nextDueDate: request.body.nextDueDate,
            enabled: request.body.enabled,
            idempotencyKey: request.headers['idempotency-key'],
            requestHash: canonicalRequestHash({
              itemId: request.params.itemId,
              body: request.body,
            }),
          });
          if (result.replayed) reply.header('idempotency-replayed', 'true');
          return await reply.status(201).send(result.policy);
        } catch (error) {
          if (error instanceof IdempotencyConflictError) throw new ConflictAppError(error.message);
          if (error instanceof StateConflictError) throw new ResourceNotFoundError();
          throw error;
        }
      },
    );

    app.post(
      '/api/v1/timing-lab/run-due-price-checks',
      {
        schema: {
          body: runDuePriceChecksInputSchema,
          headers: idempotencyHeaders,
          response: { 200: priceCheckRunSummarySchema },
        },
      },
      async (request, reply) => {
        const user = await requireUser(request, repository);
        const applicationDate = await applicationDateForUser(user.id);
        try {
          const result = await runIdempotentApplicationRequest(experienceRepository, {
            userId: user.id,
            operation: 'timing-lab.run-due-price-checks',
            idempotencyKey: request.headers['idempotency-key'],
            requestHash: canonicalRequestHash({ applicationDate, body: request.body }),
            responseStatus: 200,
            execute: () =>
              runDuePriceChecks(
                {
                  timingRepository,
                  planRepository,
                  goalAccountProvider,
                  historicalPriceProvider,
                  recordOutcomeEvent: async (outcome) => {
                    const demo =
                      configuration.DEMO_STORY_ENABLED &&
                      (await experienceRepository.isDemoFixtureUser(outcome.userId));
                    const event = {
                      eventName: outcome.eventName,
                      demo,
                      applicationVersion: 'product-experience-v1' as const,
                    };
                    await experienceRepository.recordProductEvent({
                      userId: outcome.userId,
                      subjectHash: sha256(
                        `product-event:${outcome.userId}:${configuration.SESSION_SECRET}`,
                      ),
                      event,
                      idempotencyKey: [
                        'timing-routine',
                        outcome.applicationDate,
                        outcome.eventName,
                        demo ? 'demo' : 'local',
                      ].join(':'),
                      requestHash: canonicalRequestHash(event),
                    });
                  },
                },
                { userId: user.id, applicationDate },
              ),
          });
          if (result.replayed) reply.header('idempotency-replayed', 'true');
          return result.value;
        } catch (error) {
          if (error instanceof IdempotencyConflictError) throw new ConflictAppError(error.message);
          if (error instanceof StateConflictError) throw new ConflictAppError(error.message);
          throw error;
        }
      },
    );
  }

  app.post(
    '/api/v1/goals',
    {
      schema: {
        body: goalInputSchema,
        headers: idempotencyHeaders,
        response: { 201: goalDtoSchema },
      },
    },
    async (request, reply) => {
      const user = await requireUser(request, repository);
      try {
        if (request.body.targetDate < (await applicationDateForUser(user.id)))
          throw new ValidationAppError('Target date cannot be before the application date.');
        const result = await repository.createGoalIdempotent({
          userId: user.id,
          goal: request.body,
          key: request.headers['idempotency-key'],
          requestHash: canonicalRequestHash(request.body),
        });
        if (result.replayed) reply.header('idempotency-replayed', 'true');
        return await reply.status(201).send(result.goal);
      } catch (error) {
        if (error instanceof IdempotencyConflictError) throw new ConflictAppError(error.message);
        if (isUniqueViolation(error))
          throw new ConflictAppError('Only one running goal is allowed.');
        throw error;
      }
    },
  );

  app.get(
    '/api/v1/goals/:goalId',
    { schema: { params: goalIdParameters, response: { 200: goalDetailOutputSchema } } },
    async (request) => {
      const user = await requireUser(request, repository);
      const goal = await repository.getGoal(user.id, request.params.goalId);
      if (goal === null) throw new ResourceNotFoundError();
      const applicationDate = await applicationDateForUser(user.id);
      const account = await goalAccountProvider.summary(user.id, goal.id, applicationDate);
      return { goal, account, applicationDate };
    },
  );

  app.patch(
    '/api/v1/goals/:goalId',
    {
      schema: {
        params: goalIdParameters,
        body: goalUpdateSchema,
        headers: idempotencyHeaders,
        response: { 200: goalDtoSchema },
      },
    },
    async (request, reply) => {
      const user = await requireUser(request, repository);
      try {
        const result = await runIdempotentApplicationRequest(experienceRepository, {
          userId: user.id,
          operation: 'goal.update',
          idempotencyKey: request.headers['idempotency-key'],
          requestHash: canonicalRequestHash({
            goalId: request.params.goalId,
            body: request.body,
          }),
          responseStatus: 200,
          execute: async () => {
            const existing = await repository.getGoal(user.id, request.params.goalId);
            if (existing === null) throw new ResourceNotFoundError();
            const { version, ...changes } = request.body;
            if (
              existing.status !== 'draft' &&
              Object.keys(changes).some((key) => !['name', 'category', 'notes'].includes(key))
            )
              throw new ConflictAppError(
                'After activation, only the goal name, category, and notes can be edited.',
              );
            const existingInput = goalInputSchema.parse({
              name: existing.name,
              category: existing.category,
              targetAmountCents: existing.targetAmountCents,
              currentSavedCents: existing.currentSavedCents,
              targetDate: existing.targetDate,
              recurringContributionCents: existing.recurringContributionCents,
              contributionCadence: existing.contributionCadence,
              liquidityNeed: existing.liquidityNeed,
              preservationPreference: existing.preservationPreference,
              confidence: existing.confidence,
              notes: existing.notes,
            });
            const merged = goalInputSchema.parse({ ...existingInput, ...changes });
            if (merged.targetDate < (await applicationDateForUser(user.id)))
              throw new ValidationAppError('Target date cannot be before the application date.');
            const updated = await repository.updateGoal(user.id, existing.id, merged, version);
            if (updated === null)
              throw new ConflictAppError('The goal changed. Refresh and try again.');
            return updated;
          },
        });
        if (result.replayed) reply.header('idempotency-replayed', 'true');
        return result.value;
      } catch (error) {
        if (error instanceof IdempotencyConflictError) throw new ConflictAppError(error.message);
        if (error instanceof StateConflictError) throw new ConflictAppError(error.message);
        throw error;
      }
    },
  );

  app.post(
    '/api/v1/goals/:goalId/activate',
    {
      schema: {
        params: goalIdParameters,
        body: legacyActivationInputSchema,
        headers: idempotencyHeaders,
        response: { 201: accountActivationOutputSchema },
      },
    },
    async (request, reply) => {
      const user = await requireUser(request, repository);
      const requestHash = canonicalRequestHash({
        goalId: request.params.goalId,
        body: request.body,
      });
      try {
        const replay = await experienceRepository.getIdempotentResponse<AccountSummaryDto>({
          userId: user.id,
          operation: 'goal.activate',
          idempotencyKey: request.headers['idempotency-key'],
          requestHash,
        });
        if (replay !== null) {
          reply.header('idempotency-replayed', 'true');
          return await reply.status(201).send({ account: replay.value });
        }
        const goal = await repository.getGoal(user.id, request.params.goalId);
        if (goal === null) throw new ResourceNotFoundError();
        if (goal.version !== request.body.expectedGoalVersion)
          throw new ConflictAppError('The goal changed. Refresh before activating.');
        const asOfDate = await applicationDateForUser(user.id);
        const projection = compareVehicles(goal, asOfDate, await rateProvider.getCatalog(asOfDate));
        const selected = projection.vehicles.find(
          (vehicle) => vehicle.vehicleCode === request.body.vehicleCode,
        );
        if (!selected?.eligible)
          throw new ConflictAppError('Choose an eligible illustrative vehicle.');
        const nextContributionDate =
          generateContributionDates(asOfDate, goal.targetDate, goal.contributionCadence)[0] ?? null;
        const result = await repository.activateGoalIdempotent({
          userId: user.id,
          goal,
          expectedGoalVersion: request.body.expectedGoalVersion,
          vehicleCode: request.body.vehicleCode,
          projection,
          asOfDate,
          nextContributionDate,
          idempotencyKey: request.headers['idempotency-key'],
          requestHash,
          requestId: request.id,
        });
        if (result.replayed) reply.header('idempotency-replayed', 'true');
        return await reply.status(201).send({ account: result.account });
      } catch (error) {
        if (error instanceof IdempotencyConflictError) throw new ConflictAppError(error.message);
        if (isUniqueViolation(error))
          throw new ConflictAppError('Only one running goal is allowed.');
        if (error instanceof StateConflictError) throw new ConflictAppError(error.message);
        throw error;
      }
    },
  );

  const stateRoute = (
    path: string,
    fromStates: readonly ('active' | 'paused' | 'purchase_ready')[],
    toState: 'active' | 'paused' | 'completed',
    eventType: 'paused' | 'resumed' | 'goal_completed',
  ): void => {
    app.post(
      path,
      {
        schema: {
          params: goalIdParameters,
          body: goalStateTransitionInputSchema,
          headers: idempotencyHeaders,
          response: { 200: goalMutationOutputSchema },
        },
      },
      async (request, reply) => {
        const user = await requireUser(request, repository);
        try {
          const result = await repository.transitionGoalStateIdempotent({
            userId: user.id,
            goalId: request.params.goalId,
            expectedGoalVersion: request.body.expectedGoalVersion,
            fromStates,
            toState,
            eventType,
            effectiveDate: await applicationDateForUser(user.id),
            idempotencyKey: request.headers['idempotency-key'],
            requestHash: canonicalRequestHash({
              goalId: request.params.goalId,
              body: request.body,
            }),
            requestId: request.id,
          });
          if (result.result === 'transitioned') {
            if (result.replayed) reply.header('idempotency-replayed', 'true');
            return { goal: result.goal };
          }
          if (result.result === 'not_found') throw new ResourceNotFoundError();
          if (result.result === 'version_conflict')
            throw new ConflictAppError('The goal changed. Refresh before continuing.');
          throw new ConflictAppError('This goal cannot make that lifecycle transition.');
        } catch (error) {
          if (error instanceof IdempotencyConflictError) throw new ConflictAppError(error.message);
          throw error;
        }
      },
    );
  };
  stateRoute('/api/v1/goals/:goalId/pause', ['active'], 'paused', 'paused');
  stateRoute('/api/v1/goals/:goalId/resume', ['paused'], 'active', 'resumed');
  stateRoute('/api/v1/goals/:goalId/complete', ['purchase_ready'], 'completed', 'goal_completed');
  app.post(
    '/api/v1/goals/:goalId/archive',
    {
      schema: {
        params: goalIdParameters,
        body: goalArchiveInputSchema,
        headers: idempotencyHeaders,
        response: { 200: goalMutationOutputSchema },
      },
    },
    async (request, reply) => {
      const user = await requireUser(request, repository);
      try {
        const result = await repository.archiveGoalPlan({
          userId: user.id,
          goalId: request.params.goalId,
          expectedGoalVersion: request.body.expectedGoalVersion,
          reasonCode: request.body.reasonCode,
          idempotencyKey: request.headers['idempotency-key'],
          requestHash: canonicalRequestHash({
            goalId: request.params.goalId,
            body: request.body,
          }),
          requestId: request.id,
        });
        if (result.result === 'archived') {
          if (result.replayed) reply.header('idempotency-replayed', 'true');
          return { goal: result.goal };
        }
        if (result.result === 'not_found') throw new ResourceNotFoundError();
        if (result.result === 'version_conflict')
          throw new ConflictAppError('The goal changed. Refresh before archiving.');
        throw new ConflictAppError('This goal cannot be archived in its current state.');
      } catch (error) {
        if (error instanceof IdempotencyConflictError) throw new ConflictAppError(error.message);
        throw error;
      }
    },
  );

  app.get(
    '/api/v1/goals/:goalId/ledger',
    {
      schema: {
        params: goalIdParameters,
        response: { 200: activityListOutputSchema },
      },
    },
    async (request) => {
      const user = await requireUser(request, repository);
      if ((await repository.getGoal(user.id, request.params.goalId)) === null)
        throw new ResourceNotFoundError();
      return {
        activity: [...(await goalAccountProvider.getActivity(user.id, request.params.goalId))],
      };
    },
  );

  app.post(
    '/api/v1/goals/:goalId/contributions',
    {
      schema: {
        params: goalIdParameters,
        body: contributionInputSchema,
        headers: idempotencyHeaders,
        response: { 200: contributionOutputSchema, 201: contributionOutputSchema },
      },
    },
    async (request, reply) => {
      const user = await requireUser(request, repository);
      if ((await repository.getGoal(user.id, request.params.goalId)) === null)
        throw new ResourceNotFoundError();
      const key = request.headers['idempotency-key'];
      if (request.body.effectiveDate !== (await applicationDateForUser(user.id)))
        throw new ValidationAppError(
          'Simulated contributions must use the current application date.',
        );
      const occurrenceId = `manual:${sha256(`${user.id}:${key}`)}`;
      let result;
      try {
        result = await contributionProvider.post({
          userId: user.id,
          goalId: request.params.goalId,
          amountCents: request.body.amountCents,
          effectiveDate: request.body.effectiveDate,
          occurrenceId,
          idempotencyKey: key,
          requestHash: canonicalRequestHash(request.body),
          simulateFailure: request.body.simulateFailure ?? false,
        });
      } catch (error) {
        if (error instanceof IdempotencyConflictError) throw new ConflictAppError(error.message);
        if (error instanceof StateConflictError) throw new ConflictAppError(error.message);
        throw error;
      }
      return reply.status(result.duplicate ? 200 : 201).send(result);
    },
  );

  app.post(
    '/api/v1/data-exports',
    {
      schema: {
        body: optionalEmptyMutationInputSchema,
        headers: idempotencyHeaders,
        response: { 201: dataExportOutputSchema },
      },
    },
    async (request, reply) => {
      const user = await requireUser(request, repository);
      try {
        const result = await runIdempotentApplicationRequest(experienceRepository, {
          userId: user.id,
          operation: 'privacy.export',
          idempotencyKey: request.headers['idempotency-key'],
          requestHash: canonicalRequestHash({}),
          responseStatus: 201,
          execute: async () => ({
            ...(await repository.createCompletedExport(user.id)),
            status: 'completed' as const,
          }),
        });
        if (result.replayed) reply.header('idempotency-replayed', 'true');
        return await reply.status(201).send(dataExportOutputSchema.parse(result.value));
      } catch (error) {
        if (error instanceof IdempotencyConflictError) throw new ConflictAppError(error.message);
        if (error instanceof StateConflictError) throw new ConflictAppError(error.message);
        throw error;
      }
    },
  );

  app.post(
    '/api/v1/account-deletion',
    {
      schema: {
        body: optionalEmptyMutationInputSchema,
        response: { 200: accountDeletionOutputSchema, 204: z.null() },
      },
    },
    async (request, reply) => {
      const user = await requireUser(request, repository);
      const deleted = await repository.deleteAccount(
        user.id,
        sha256(`deleted:${user.id}:${configuration.SESSION_SECRET}`),
      );
      clearSessionCookies(reply);
      if (!deleted) return reply.status(204).send(null);
      return reply.status(200).send({ status: 'completed' as const });
    },
  );

  app.get(
    '/api/v1/session-status',
    { schema: { response: { 200: sessionStatusOutputSchema } } },
    async (request) => ({
      authenticated: (await currentUser(request, repository)) !== null,
    }),
  );

  return app;
}
