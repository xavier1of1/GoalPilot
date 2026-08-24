import { z } from 'zod';

export const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a calendar date in YYYY-MM-DD format.')
  .refine((value) => {
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 0));
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === (month ?? 1) - 1 &&
      date.getUTCDate() === day
    );
  }, 'Enter a real calendar date.');

export const contributionCadenceSchema = z.enum(['weekly', 'biweekly', 'monthly']);
export const liquidityNeedSchema = z.enum(['anytime', 'within_30_days', 'goal_date']);
export const preservationPreferenceSchema = z.enum(['required', 'flexible']);
export const goalStatusSchema = z.enum([
  'draft',
  'active',
  'paused',
  'purchase_ready',
  'completed',
  'archived',
]);
export const vehicleCodeSchema = z.enum(['cash', 'hysa', 'cd_ladder', 'treasury_ladder']);
export const vehicleFitPolicyVersionSchema = z.literal('vehicle-fit-v2');

const centsSchema = z.number().int().min(0).max(100_000_000, 'The MVP supports up to $1,000,000.');
const accruedInterestMicrosSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

export const goalInputSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    category: z.string().trim().max(40).optional(),
    targetAmountCents: centsSchema.min(50_000, 'The minimum goal is $500.'),
    currentSavedCents: centsSchema,
    targetDate: calendarDateSchema,
    recurringContributionCents: centsSchema,
    contributionCadence: contributionCadenceSchema,
    liquidityNeed: liquidityNeedSchema,
    preservationPreference: preservationPreferenceSchema,
    confidence: z.enum(['expected']).default('expected'),
    notes: z.string().trim().max(500).optional(),
  })
  .strict();

export const previewInputSchema = goalInputSchema.extend({
  asOfDate: calendarDateSchema.optional(),
});

export const vehicleAssumptionSchema = z
  .object({
    vehicleCode: vehicleCodeSchema,
    displayName: z.string(),
    assumptionVersion: z.string(),
    apyBasisPoints: z.number().int().min(0).max(10_000),
    effectiveDate: calendarDateSchema,
    reviewedDate: calendarDateSchema,
    sourceType: z.enum(['reviewed_demo_assumption']),
    sourceLabel: z.string(),
    isLive: z.literal(false),
    liquidityDays: z.number().int().min(0),
    lockDays: z.number().int().min(0),
    minimumCents: centsSchema,
    enabled: z.boolean(),
  })
  .strict();

export const fixedTermProjectionLotSchema = z
  .object({
    personalPrincipalCents: centsSchema,
    currentBalanceCents: centsSchema,
    firstMaturityDate: calendarDateSchema,
    nextMaturityDate: calendarDateSchema,
    nextMaturityInterestEligible: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.currentBalanceCents < value.personalPrincipalCents) {
      context.addIssue({
        code: 'custom',
        path: ['currentBalanceCents'],
        message: 'A fixed-term lot balance cannot be less than its personal principal.',
      });
    }
    if (value.nextMaturityDate < value.firstMaturityDate) {
      context.addIssue({
        code: 'custom',
        path: ['nextMaturityDate'],
        message: "The next maturity cannot precede the lot's first maturity.",
      });
    }
  });

export const planCalculationContextSchema = z
  .object({
    contextVersion: z.literal('plan-calculation-context-v1'),
    personalPrincipalCents: centsSchema,
    totalLedgerValueCents: centsSchema,
    currentAvailableFundsCents: centsSchema,
    currentAccruedInterestMicros: accruedInterestMicrosSchema,
    applicationDate: calendarDateSchema,
    scheduleAnchorDate: calendarDateSchema,
    omittedContributionDates: z.array(calendarDateSchema).max(24),
    fixedTermLots: z.array(fixedTermProjectionLotSchema).max(500),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.personalPrincipalCents > value.totalLedgerValueCents) {
      context.addIssue({
        code: 'custom',
        path: ['personalPrincipalCents'],
        message: 'Personal principal cannot exceed total ledger value.',
      });
    }
    if (value.currentAvailableFundsCents > value.totalLedgerValueCents) {
      context.addIssue({
        code: 'custom',
        path: ['currentAvailableFundsCents'],
        message: 'Available funds cannot exceed total ledger value.',
      });
    }
  });

export const rejectionCodeSchema = z.enum([
  'ASSUMPTION_DISABLED',
  'ASSUMPTION_NOT_EFFECTIVE',
  'ASSUMPTION_STALE',
  'LIQUIDITY_CONFLICT',
  'HORIZON_TOO_SHORT',
  'BELOW_MINIMUM',
]);

export const fitRationaleCodeSchema = z.enum([
  'ELIGIBLE_ACCESS_FIT',
  'CASH_BASELINE',
  'INELIGIBLE_POLICY',
]);

export const protectionClassificationSchema = z.enum([
  'SIMULATED_CASH',
  'SIMULATED_DEPOSIT_HELD_AS_MODELED',
  'SIMULATED_TREASURY_HELD_TO_MATURITY',
]);

export const vehicleProjectionSchema = z
  .object({
    vehicleCode: vehicleCodeSchema,
    displayName: z.string(),
    eligible: z.boolean(),
    rejectionCode: rejectionCodeSchema.nullable(),
    rejectionMessage: z.string().nullable(),
    /** @deprecated Use safeContributionCents or modelAdjustedRequiredContributionCents. */
    requiredContributionCents: centsSchema.nullable(),
    safeContributionCents: centsSchema.nullable(),
    modelAdjustedRequiredContributionCents: centsSchema.nullable(),
    fitRank: z.number().int().min(1).max(4).nullable(),
    readyByTargetUsingSafeContribution: z.boolean(),
    accessRequirementSatisfied: z.boolean(),
    lockConflictDays: z.number().int().min(0),
    safeContributionModeledCushionCents: centsSchema,
    fitRationaleCode: fitRationaleCodeSchema,
    protectionClassification: protectionClassificationSchema,
    preservationRequirementSatisfied: z.boolean(),
    firstMaturityDate: calendarDateSchema.nullable(),
    /** The recurring amount applied at each future scheduled occurrence. */
    plannedContributionCents: centsSchema,
    principalContributedCents: centsSchema,
    futurePersonalContributionsCents: centsSchema,
    modeledInterestCents: centsSchema,
    modeledBenefitVersusCashCents: z.number().int().min(-100_000_000).max(100_000_000),
    endingBalanceCents: centsSchema,
    shortfallCents: centsSchema,
    surplusCents: centsSchema,
    projectedCompletionDate: calendarDateSchema.nullable(),
    accessSummary: z.string(),
    assumption: vehicleAssumptionSchema,
  })
  .superRefine((value, context) => {
    if (value.eligible !== (value.fitRank !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['fitRank'],
        message: 'Only eligible vehicles receive a fit rank.',
      });
    }
    if (value.eligible === (value.fitRationaleCode === 'INELIGIBLE_POLICY')) {
      context.addIssue({
        code: 'custom',
        path: ['fitRationaleCode'],
        message: 'The fit rationale must match vehicle eligibility.',
      });
    }
    if (
      (value.vehicleCode === 'cash' && value.eligible) !==
      (value.fitRationaleCode === 'CASH_BASELINE')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['fitRationaleCode'],
        message: 'Only cash uses the cash-baseline rationale.',
      });
    }
    if (value.eligible === (value.rejectionCode !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['rejectionCode'],
        message: 'Only an ineligible vehicle has a rejection code.',
      });
    }
  });

export const previewOutputSchema = z
  .object({
    asOfDate: calendarDateSchema,
    rankingPolicyVersion: vehicleFitPolicyVersionSchema,
    zeroInterestBaseline: z.object({
      feasible: z.boolean(),
      occurrenceCount: z.number().int().min(0),
      requiredContributionCents: centsSchema.nullable(),
      projectedBalanceCents: centsSchema,
      shortfallCents: centsSchema,
    }),
    vehicles: z.array(vehicleProjectionSchema).length(4),
    recommendedVehicleCode: vehicleCodeSchema.nullable(),
    disclosure: z.string(),
  })
  .superRefine((value, context) => {
    const vehicleCodes = value.vehicles.map((vehicle) => vehicle.vehicleCode);
    if (new Set(vehicleCodes).size !== vehicleCodes.length) {
      context.addIssue({
        code: 'custom',
        path: ['vehicles'],
        message: 'The preview must contain each vehicle exactly once.',
      });
    }
    if (
      value.vehicles.some(
        (vehicle) =>
          vehicle.safeContributionCents !== value.zeroInterestBaseline.requiredContributionCents,
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['vehicles'],
        message: 'The zero-interest safe contribution must be vehicle-independent.',
      });
    }
    const ranked = value.vehicles
      .flatMap((vehicle) => (vehicle.fitRank === null ? [] : [vehicle.fitRank]))
      .sort((left, right) => left - right);
    if (ranked.some((rank, index) => rank !== index + 1)) {
      context.addIssue({
        code: 'custom',
        path: ['vehicles'],
        message: 'Eligible vehicle ranks must be unique and contiguous.',
      });
    }
    const recommended =
      value.vehicles.find((vehicle) => vehicle.fitRank === 1)?.vehicleCode ?? null;
    if (value.recommendedVehicleCode !== recommended) {
      context.addIssue({
        code: 'custom',
        path: ['recommendedVehicleCode'],
        message: 'The recommended vehicle must be the first-ranked eligible fit.',
      });
    }
    const cash = value.vehicles.find((vehicle) => vehicle.vehicleCode === 'cash');
    if (cash !== undefined) {
      for (const [index, vehicle] of value.vehicles.entries()) {
        if (
          vehicle.modeledBenefitVersusCashCents !==
          vehicle.endingBalanceCents - cash.endingBalanceCents
        ) {
          context.addIssue({
            code: 'custom',
            path: ['vehicles', index, 'modeledBenefitVersusCashCents'],
            message: 'Modeled benefit must reconcile to the cash ending balance.',
          });
        }
      }
    }
  });

export const registerInputSchema = z
  .object({
    email: z.email().trim().toLowerCase().max(254),
    password: z.string().min(12).max(128),
    displayName: z.string().trim().min(1).max(80),
  })
  .strict();

export const loginInputSchema = z
  .object({
    email: z.email().trim().toLowerCase().max(254),
    password: z.string().min(1).max(128),
  })
  .strict();

export const contributionInputSchema = z
  .object({
    amountCents: centsSchema.min(1),
    effectiveDate: calendarDateSchema,
    simulateFailure: z.boolean().optional(),
  })
  .strict();

export const activationInputSchema = z.object({ vehicleCode: vehicleCodeSchema }).strict();

export const goalUpdateSchema = goalInputSchema.partial().extend({
  version: z.number().int().min(1),
});

export type GoalInput = z.infer<typeof goalInputSchema>;
export type GoalStatus = z.infer<typeof goalStatusSchema>;
export type ContributionCadence = z.infer<typeof contributionCadenceSchema>;
export type LiquidityNeed = z.infer<typeof liquidityNeedSchema>;
export type VehicleCode = z.infer<typeof vehicleCodeSchema>;
export type VehicleAssumption = z.infer<typeof vehicleAssumptionSchema>;
export type FixedTermProjectionLot = z.infer<typeof fixedTermProjectionLotSchema>;
export type PlanCalculationContext = z.infer<typeof planCalculationContextSchema>;
export type FitRationaleCode = z.infer<typeof fitRationaleCodeSchema>;
export type ProtectionClassification = z.infer<typeof protectionClassificationSchema>;
export type VehicleProjection = z.infer<typeof vehicleProjectionSchema>;
export type PreviewOutput = z.infer<typeof previewOutputSchema>;

export interface ApiErrorBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly requestId: string;
    readonly fieldErrors: Readonly<Record<string, readonly string[]>> | null;
  };
}

export interface UserDto {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
}

export interface GoalDto extends GoalInput {
  readonly id: string;
  readonly status: GoalStatus;
  readonly version: number;
  readonly archivedAt: string | null;
  readonly archiveReason: 'USER_REQUESTED' | 'GOAL_COMPLETED' | 'NO_LONGER_PURSUED' | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AccountSummaryDto {
  readonly id: string;
  readonly goalId: string;
  readonly status: 'active' | 'paused' | 'purchase_ready' | 'completed' | 'archived';
  readonly vehicleCode: VehicleCode;
  readonly principalContributedCents: number;
  readonly interestEarnedCents: number;
  readonly currentLedgerBalanceCents: number;
  readonly principalCompositionBasisPoints: number;
  readonly availableBalanceCents: number;
  readonly pendingContributionCents: number;
  readonly nextContributionDate: string | null;
  readonly currentIllustrativeApyBasisPoints: number;
  readonly progressPercent: number;
  readonly projectedCompletionDate: string | null;
  readonly assumptionVersion: string;
  readonly assumptionReviewedDate: string;
  readonly assumptionIsStale: boolean;
}

export interface ActivityDto {
  readonly id: string;
  readonly type:
    | 'account_opened'
    | 'contribution_scheduled'
    | 'contribution_posted'
    | 'contribution_failed'
    | 'interest_accrued'
    | 'interest_posted'
    | 'paused'
    | 'resumed'
    | 'goal_completed'
    | 'simulated_withdrawal'
    | 'reversal';
  readonly effectiveDate: string;
  readonly principalCents: number;
  readonly interestCents: number;
  readonly description: string;
  readonly createdAt: string;
}

export const simulationDisclosure =
  'Educational simulation using illustrative assumptions. GoalPilot does not hold, transfer, or invest money. Rates and outcomes are not guaranteed.';
export const illustrativeRateLabel = 'Illustrative rate, not a live offer.';

// Product-experience v1 contracts are additive so the verified local-MVP API remains compatible
// while the progressive builder and resilience flows are introduced.
export const productExperienceVersionSchema = z.literal('product-experience-v1');
export const calculationPolicyVersionSchema = z.literal('plan-health-v1');
export const planHealthPolicyVersionSchema = calculationPolicyVersionSchema;
export const purchaseTimingPolicyVersionSchema = z.literal('purchase-timing-v1');

export const ulidSchema = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, 'Use a valid ULID.');
const persistedUserIdSchema = z
  .string()
  .regex(/^[0-9A-Z]{26}$/, 'Use a valid persisted user identifier.');
export const sha256DigestSchema = z.string().regex(/^[0-9a-f]{64}$/);
const signedCentsSchema = z.number().int().min(-100_000_000).max(100_000_000);

export const userDtoSchema = z
  .object({
    id: persistedUserIdSchema,
    email: z.email().max(254),
    displayName: z.string().min(1).max(80),
  })
  .strict();

export const goalDtoSchema = goalInputSchema
  .extend({
    id: ulidSchema,
    status: goalStatusSchema,
    version: z.number().int().min(1),
    archivedAt: z.iso.datetime().nullable(),
    archiveReason: z.enum(['USER_REQUESTED', 'GOAL_COMPLETED', 'NO_LONGER_PURSUED']).nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const accountSummarySchema = z
  .object({
    id: ulidSchema,
    goalId: ulidSchema,
    status: z.enum(['active', 'paused', 'purchase_ready', 'completed', 'archived']),
    vehicleCode: vehicleCodeSchema,
    principalContributedCents: centsSchema,
    interestEarnedCents: centsSchema,
    currentLedgerBalanceCents: centsSchema,
    principalCompositionBasisPoints: z.number().int().min(0).max(10_000),
    availableBalanceCents: centsSchema,
    pendingContributionCents: centsSchema,
    nextContributionDate: calendarDateSchema.nullable(),
    currentIllustrativeApyBasisPoints: z.number().int().min(0).max(10_000),
    progressPercent: z.number().min(0).max(100),
    projectedCompletionDate: calendarDateSchema.nullable(),
    assumptionVersion: z.string().min(1),
    assumptionReviewedDate: calendarDateSchema,
    assumptionIsStale: z.boolean(),
  })
  .strict();

export const activitySchema = z
  .object({
    id: ulidSchema,
    type: z.enum([
      'account_opened',
      'contribution_scheduled',
      'contribution_posted',
      'contribution_failed',
      'interest_accrued',
      'interest_posted',
      'paused',
      'resumed',
      'goal_completed',
      'simulated_withdrawal',
      'reversal',
    ]),
    effectiveDate: calendarDateSchema,
    principalCents: signedCentsSchema,
    interestCents: signedCentsSchema,
    description: z.string().min(1),
    createdAt: z.iso.datetime(),
  })
  .strict();

export const healthLiveOutputSchema = z.object({ status: z.literal('live') }).strict();
export const healthReadyOutputSchema = z
  .object({ status: z.literal('ready'), database: z.literal('ready') })
  .strict();
export const healthNotReadyOutputSchema = z
  .object({ status: z.literal('not_ready'), database: z.literal('unavailable') })
  .strict();
export const vehicleCatalogOutputSchema = z
  .object({
    assumptionVersion: z.string().min(1),
    vehicles: z.array(vehicleAssumptionSchema).min(1).max(4),
  })
  .strict();
export const capabilitiesOutputSchema = z
  .object({
    demoStory: z.boolean(),
    purchaseTimingLab: z.boolean(),
    applicationDate: calendarDateSchema,
  })
  .strict();
export const authSessionOutputSchema = z
  .object({ user: userDtoSchema, csrfToken: z.string().min(1) })
  .strict();
export const meOutputSchema = z
  .object({ user: userDtoSchema, csrfToken: z.string().min(1).nullable() })
  .strict();
export const goalListOutputSchema = z.object({ goals: z.array(goalDtoSchema) }).strict();
export const goalDetailOutputSchema = z
  .object({
    goal: goalDtoSchema,
    account: accountSummarySchema.nullable(),
    applicationDate: calendarDateSchema,
  })
  .strict();
export const accountActivationOutputSchema = z.object({ account: accountSummarySchema }).strict();
export const goalMutationOutputSchema = z.object({ goal: goalDtoSchema }).strict();
export const activityListOutputSchema = z.object({ activity: z.array(activitySchema) }).strict();
export const contributionOutputSchema = z
  .object({ activityId: ulidSchema, posted: z.boolean(), duplicate: z.boolean() })
  .strict();
export const sessionStatusOutputSchema = z.object({ authenticated: z.boolean() }).strict();
export const accountDeletionOutputSchema = z.object({ status: z.literal('completed') }).strict();

const exportTimestampSchema = z.iso.datetime({ offset: true });
const exportGoalDraftSchema = z
  .object({
    id: ulidSchema,
    schemaVersion: z.literal('goal-draft-v1'),
    draftData: z.record(z.string(), z.unknown()),
    lastCompletedStep: z
      .enum(['goal', 'starting_point', 'budget_fit', 'access', 'review'])
      .nullable(),
    version: z.number().int().min(1),
    createdAt: exportTimestampSchema,
    updatedAt: exportTimestampSchema,
  })
  .strict();
const exportUserClockSchema = z
  .object({
    initialApplicationDate: calendarDateSchema,
    applicationDate: calendarDateSchema,
    version: z.number().int().min(1),
    createdAt: exportTimestampSchema,
    updatedAt: exportTimestampSchema,
  })
  .strict();
const exportDemoCapabilitySchema = z
  .object({
    fixtureKey: z.literal('japan-trip'),
    fixtureVersion: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
    resetGeneration: z.number().int().min(0),
    createdAt: exportTimestampSchema,
    updatedAt: exportTimestampSchema,
  })
  .strict();
const exportPlanVersionSchema = z
  .object({
    id: ulidSchema,
    goalId: ulidSchema,
    version: z.number().int().min(1),
    vehicleCode: vehicleCodeSchema,
    assumptionVersion: z.string().min(1),
    normalizedInput: z.unknown(),
    calculationOutput: z.unknown(),
    calculationContext: z.unknown(),
    applicationDate: calendarDateSchema,
    scheduleAnchorDate: calendarDateSchema,
    calculationPolicyVersion: z.string().min(1),
    rankingPolicyVersion: z.string().min(1),
    healthPolicyVersion: z.string().min(1),
    changeKind: z.enum(['initial_activation', 'scenario_applied', 'recovery_applied']),
    changedField: z
      .enum(['recurring_contribution', 'target_date', 'target_amount', 'missed_contribution'])
      .nullable(),
    changeReasonCode: z.enum([
      'INITIAL_ACTIVATION',
      'USER_CONTRIBUTION_CHANGED',
      'USER_DEADLINE_CHANGED',
      'USER_TARGET_CHANGED',
      'USER_MISSED_CONTRIBUTION_PLANNED',
      'RECOVERY_CONTRIBUTION_INCREASED',
      'RECOVERY_DEADLINE_EXTENDED',
      'RECOVERY_TARGET_REDUCED',
    ]),
    changePayload: z.unknown().nullable(),
    omittedContributionDates: z.array(calendarDateSchema).max(24),
    basePlanVersionId: ulidSchema.nullable(),
    createdAt: exportTimestampSchema,
  })
  .strict();
const exportSimulatedAccountSchema = z
  .object({
    id: ulidSchema,
    goalId: ulidSchema,
    planVersionId: ulidSchema,
    status: z.enum(['active', 'paused', 'purchase_ready', 'completed', 'archived']),
    nextContributionDate: calendarDateSchema.nullable(),
    lastProcessedDate: calendarDateSchema,
    lastAccrualDate: calendarDateSchema,
    accruedInterestMicros: z.number().int().min(0),
    createdAt: exportTimestampSchema,
    updatedAt: exportTimestampSchema,
  })
  .strict();
const exportLedgerEntrySchema = z
  .object({
    id: ulidSchema,
    accountId: ulidSchema,
    entryType: z.enum([
      'account_opened',
      'contribution_scheduled',
      'contribution_posted',
      'contribution_failed',
      'interest_accrued',
      'interest_posted',
      'paused',
      'resumed',
      'goal_completed',
      'simulated_withdrawal',
      'reversal',
      'plan_changed',
    ]),
    principalCents: signedCentsSchema,
    interestCents: signedCentsSchema,
    effectiveDate: calendarDateSchema,
    occurrenceId: z.string().min(1).nullable(),
    description: z.string().min(1).max(160),
    reversesEntryId: ulidSchema.nullable(),
    createdAt: exportTimestampSchema,
  })
  .strict();
const exportScheduleOccurrenceSchema = z
  .object({
    id: z.string().min(1),
    accountId: ulidSchema,
    dueDate: calendarDateSchema,
    status: z.enum(['posted', 'failed', 'skipped']),
    createdAt: exportTimestampSchema,
  })
  .strict();
const exportInterestPostingPeriodSchema = z
  .object({
    accountId: ulidSchema,
    periodEnd: calendarDateSchema,
    ledgerEntryId: ulidSchema,
  })
  .strict();
const exportPurchaseItemSchema = z
  .object({
    id: ulidSchema,
    goalId: ulidSchema,
    fixtureCode: z.literal('synthetic_oled_65_v1'),
    displayName: z.literal('65-inch OLED television'),
    currency: z.literal('USD'),
    targetPriceCents: centsSchema.min(1),
    version: z.number().int().min(1),
    lifecycle: z.enum(['active', 'archived']),
    createdAt: exportTimestampSchema,
    updatedAt: exportTimestampSchema,
  })
  .strict();
const exportPriceWatchPolicySchema = z
  .object({
    id: ulidSchema,
    purchaseItemId: ulidSchema,
    version: z.number().int().min(1),
    cadence: z.enum(['weekly', 'monthly']),
    nextDueDate: calendarDateSchema,
    freshnessLimitDays: z.literal(14),
    analysisPolicyVersion: z.literal('purchase-timing-v1'),
    enabled: z.boolean(),
    createdAt: exportTimestampSchema,
  })
  .strict();
const exportPriceCheckRunSchema = z
  .object({
    id: ulidSchema,
    priceWatchPolicyId: ulidSchema,
    purchaseItemId: ulidSchema,
    applicationDate: calendarDateSchema,
    fixtureSourceVersion: z.string().min(1).nullable(),
    fixtureSourceChecksum: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .nullable(),
    status: z.enum(['claimed', 'completed', 'failed']),
    errorCode: z
      .enum([
        'PROVIDER_FAILURE',
        'INVALID_PRICE_BATCH',
        'CURRENCY_MISMATCH',
        'FUTURE_OBSERVATION',
        'CONFLICTING_OBSERVATION',
        'ASSESSMENT_FAILURE',
      ])
      .nullable(),
    attemptCount: z.number().int().min(1).max(3),
    claimedAt: exportTimestampSchema,
    completedAt: exportTimestampSchema.nullable(),
  })
  .strict();
const exportPriceObservationSchema = z
  .object({
    id: ulidSchema,
    priceCheckRunId: ulidSchema,
    purchaseItemId: ulidSchema,
    fixtureSourceVersion: z.string().min(1),
    observationKey: z.string().regex(/^[a-z0-9_-]{1,40}$/),
    observedOn: calendarDateSchema,
    priceCents: centsSchema.min(1),
    currency: z.literal('USD'),
    createdAt: exportTimestampSchema,
  })
  .strict();
const exportSeasonalSummarySchema = z
  .object({
    months: z
      .array(
        z
          .object({
            month: z.number().int().min(1).max(12),
            observationCount: z.number().int().min(1),
            medianPriceCents: centsSchema.min(1),
          })
          .strict(),
      )
      .length(12),
  })
  .strict();
const exportPurchaseTimingAssessmentSchema = z
  .object({
    id: ulidSchema,
    priceCheckRunId: ulidSchema,
    purchaseItemId: ulidSchema,
    goalId: ulidSchema,
    priceWatchPolicyVersion: z.number().int().min(1),
    planVersionId: ulidSchema.nullable(),
    planVersionNumber: z.number().int().min(1).nullable(),
    planLifecycle: z.enum(['draft', 'active', 'completed', 'archived']),
    planHealth: z
      .enum([
        'AHEAD',
        'ON_TRACK',
        'ATTENTION_NEEDED',
        'FUNDED_BUT_LOCKED',
        'PURCHASE_READY',
        'PAUSED',
      ])
      .nullable(),
    planHealthPolicyVersion: z.string().min(1),
    analysisPolicyVersion: z.literal('purchase-timing-v1'),
    fixtureSourceVersion: z.string().min(1),
    fixtureSourceChecksum: z.string().regex(/^[0-9a-f]{64}$/),
    asOfDate: calendarDateSchema,
    currency: z.literal('USD'),
    assessmentState: z.enum([
      'INSUFFICIENT_DATA',
      'HISTORICALLY_FAVORABLE_PLAN_READY',
      'HISTORICALLY_FAVORABLE_PLAN_NOT_READY',
      'NOT_HISTORICALLY_FAVORABLE',
    ]),
    rationaleCodes: z.array(z.string().min(1)).min(1),
    seasonalSummary: exportSeasonalSummarySchema.nullable(),
    observationCount: z.number().int().min(1),
    earliestObservationDate: calendarDateSchema,
    latestObservationDate: calendarDateSchema,
    dataSpanDays: z.number().int().min(0),
    freshnessDays: z.number().int().min(0),
    currentPriceCents: centsSchema.min(1),
    targetPriceCents: centsSchema.min(1),
    minimumPriceCents: centsSchema.min(1),
    medianPriceCents: centsSchema.min(1),
    maximumPriceCents: centsSchema.min(1),
    currentPercentileBasisPoints: z.number().int().min(0).max(10_000),
    differenceFromMedianCents: signedCentsSchema,
    differenceFromTargetCents: signedCentsSchema,
    createdAt: exportTimestampSchema,
  })
  .strict();
export const userDataExportSchema = z
  .object({
    schemaVersion: z.literal('goalpilot-user-data-export-v2'),
    exportedAt: z.iso.datetime(),
    user: userDtoSchema
      .extend({ createdAt: z.iso.datetime(), updatedAt: z.iso.datetime() })
      .strict(),
    goalDrafts: z.array(exportGoalDraftSchema),
    userApplicationClock: exportUserClockSchema.nullable(),
    demoFixtureCapability: exportDemoCapabilitySchema.nullable(),
    goals: z.array(goalDtoSchema),
    planVersions: z.array(exportPlanVersionSchema),
    simulatedAccounts: z.array(exportSimulatedAccountSchema),
    ledgerEntries: z.array(exportLedgerEntrySchema),
    scheduleOccurrences: z.array(exportScheduleOccurrenceSchema),
    interestPostingPeriods: z.array(exportInterestPostingPeriodSchema),
    purchaseTiming: z
      .object({
        items: z.array(exportPurchaseItemSchema),
        watchPolicies: z.array(exportPriceWatchPolicySchema),
        checkRuns: z.array(exportPriceCheckRunSchema),
        observations: z.array(exportPriceObservationSchema),
        assessments: z.array(exportPurchaseTimingAssessmentSchema),
      })
      .strict(),
  })
  .strict();
export const dataExportOutputSchema = z
  .object({ requestId: ulidSchema, status: z.literal('completed'), data: userDataExportSchema })
  .strict();

export const safeBaselineInputSchema = z
  .object({
    targetAmountCents: centsSchema.min(50_000, 'The minimum goal is $500.'),
    currentSavedCents: centsSchema,
    targetDate: calendarDateSchema,
    contributionCadence: contributionCadenceSchema,
  })
  .strict();

const safeBaselineOutputCommonShape = {
  asOfDate: calendarDateSchema,
  targetAmountCents: centsSchema.min(50_000, 'The minimum goal is $500.'),
  currentSavedCents: centsSchema,
  targetDate: calendarDateSchema,
  contributionCadence: contributionCadenceSchema,
  calculationPolicyVersion: productExperienceVersionSchema,
} as const;

export const safeBaselineOutputSchema = z
  .discriminatedUnion('status', [
    z
      .object({
        ...safeBaselineOutputCommonShape,
        status: z.literal('already_funded'),
        firstContributionDate: z.null(),
        occurrenceCount: z.literal(0),
        safeContributionCents: z.literal(0),
        projectedBalanceCents: centsSchema,
        shortfallCents: z.literal(0),
      })
      .strict(),
    z
      .object({
        ...safeBaselineOutputCommonShape,
        status: z.literal('possible'),
        firstContributionDate: calendarDateSchema,
        occurrenceCount: z.number().int().min(1),
        safeContributionCents: centsSchema,
        projectedBalanceCents: centsSchema,
        shortfallCents: z.literal(0),
      })
      .strict(),
    z
      .object({
        ...safeBaselineOutputCommonShape,
        status: z.literal('no_remaining_occurrences'),
        firstContributionDate: z.null(),
        occurrenceCount: z.literal(0),
        safeContributionCents: z.null(),
        projectedBalanceCents: centsSchema,
        shortfallCents: centsSchema.min(1),
      })
      .strict(),
  ])
  .superRefine((value, context) => {
    if (
      value.status === 'already_funded' &&
      value.projectedBalanceCents !== value.currentSavedCents
    ) {
      context.addIssue({
        code: 'custom',
        path: ['projectedBalanceCents'],
        message: 'An already-funded baseline must preserve current savings.',
      });
    }
    if (value.status === 'no_remaining_occurrences') {
      if (
        value.projectedBalanceCents !== value.currentSavedCents ||
        value.shortfallCents !== value.targetAmountCents - value.currentSavedCents
      ) {
        context.addIssue({
          code: 'custom',
          path: ['projectedBalanceCents'],
          message: 'A baseline without occurrences must preserve and reconcile current savings.',
        });
      }
    }
    if (value.status === 'possible') {
      const projected =
        value.currentSavedCents + value.safeContributionCents * value.occurrenceCount;
      const priorContributionProjection =
        value.currentSavedCents + (value.safeContributionCents - 1) * value.occurrenceCount;
      if (
        value.firstContributionDate <= value.asOfDate ||
        value.firstContributionDate > value.targetDate ||
        projected !== value.projectedBalanceCents ||
        projected < value.targetAmountCents ||
        priorContributionProjection >= value.targetAmountCents
      ) {
        context.addIssue({
          code: 'custom',
          path: ['safeContributionCents'],
          message:
            'The safe baseline must be the minimum recurring amount that reaches the target.',
        });
      }
    }
  });

export const safeBaselineResponseSchema = z
  .object({
    baseline: safeBaselineOutputSchema,
  })
  .strict();

export const builderStepSchema = z.enum([
  'goal',
  'starting_point',
  'budget_fit',
  'access',
  'review',
]);
export const budgetFitSchema = z.enum(['lower', 'equal', 'higher']);

export const goalDraftDataSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    category: z.string().trim().max(40).optional(),
    targetAmountCents: centsSchema.min(50_000, 'The minimum goal is $500.').optional(),
    targetDate: calendarDateSchema.optional(),
    currentSavedCents: centsSchema.optional(),
    contributionCadence: contributionCadenceSchema.optional(),
    firstContributionDate: calendarDateSchema.optional(),
    safeContributionCents: centsSchema.optional(),
    recurringContributionCents: centsSchema.optional(),
    budgetFit: budgetFitSchema.optional(),
    liquidityNeed: liquidityNeedSchema.optional(),
    preservationPreference: preservationPreferenceSchema.optional(),
    confidence: z.literal('expected').optional(),
    notes: z.string().trim().max(500).optional(),
  })
  .strict();

export const goalDraftCreateInputSchema = z
  .object({
    data: goalDraftDataSchema,
    lastCompletedStep: builderStepSchema.nullable(),
  })
  .strict();

export const goalDraftUpdateInputSchema = z
  .object({
    expectedVersion: z.number().int().min(1),
    data: goalDraftDataSchema,
    lastCompletedStep: builderStepSchema.nullable(),
  })
  .strict();
export const goalDraftDiscardInputSchema = z
  .object({ expectedVersion: z.number().int().min(1) })
  .strict();
export const goalDraftActivateInputSchema = z
  .object({
    expectedDraftVersion: z.number().int().min(1),
    vehicleCode: vehicleCodeSchema,
  })
  .strict();

export const goalDraftSchema = z
  .object({
    id: ulidSchema,
    data: goalDraftDataSchema,
    lastCompletedStep: builderStepSchema.nullable(),
    version: z.number().int().min(1),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const goalDraftListOutputSchema = z
  .object({ drafts: z.array(goalDraftSchema).max(100) })
  .strict();

export const planHealthSchema = z.enum([
  'AHEAD',
  'ON_TRACK',
  'ATTENTION_NEEDED',
  'FUNDED_BUT_LOCKED',
  'PURCHASE_READY',
  'PAUSED',
]);

export const planHealthEvidenceCodeSchema = z.enum([
  'PLAN_IS_PAUSED',
  'AVAILABLE_FUNDS_MEET_TARGET',
  'TOTAL_VALUE_MEETS_TARGET_FUNDS_LOCKED',
  'READINESS_AFTER_TARGET',
  'NO_FEASIBLE_READINESS',
  'READINESS_AT_LEAST_ONE_CADENCE_EARLY',
  'READINESS_ON_OR_BEFORE_TARGET',
]);

export const planRationaleCodeSchema = z.enum([
  'SAFE_CONTRIBUTION_DOES_NOT_DEPEND_ON_INTEREST',
  'CHOSEN_CONTRIBUTION_BELOW_SAFE_AMOUNT',
  'CHOSEN_CONTRIBUTION_MATCHES_SAFE_AMOUNT',
  'CHOSEN_CONTRIBUTION_ABOVE_SAFE_AMOUNT',
  'SELECTED_VEHICLE_SATISFIES_ACCESS_NEED',
  'SELECTED_VEHICLE_HAS_MATURITY_LOCK',
  'MODELED_INTEREST_ADDS_CUSHION',
  'MODELED_INTEREST_DOES_NOT_REDUCE_COMMITMENT',
  'READINESS_IS_BEFORE_TARGET',
  'READINESS_IS_ON_TARGET',
  'READINESS_IS_AFTER_TARGET',
  'READINESS_CANNOT_BE_REACHED',
]);

export const planHealthOutputSchema = z
  .object({
    health: planHealthSchema,
    policyVersion: calculationPolicyVersionSchema,
    evidenceCodes: z.array(planHealthEvidenceCodeSchema).min(1),
    projectedReadinessDate: calendarDateSchema.nullable(),
    nextEventDate: calendarDateSchema.nullable(),
  })
  .strict();

export const planDecisionSummarySchema = z
  .object({
    safeContributionCents: centsSchema.nullable(),
    chosenContributionCents: centsSchema,
    contributionCadence: contributionCadenceSchema,
    currentSavingsCents: centsSchema,
    postedPersonalContributionsCents: centsSchema,
    postedModeledInterestCents: centsSchema,
    currentTotalValueCents: centsSchema,
    currentAvailableFundsCents: centsSchema,
    futurePersonalContributionsCents: centsSchema,
    futureModeledInterestCents: centsSchema,
    projectedTargetDateBalanceCents: centsSchema,
    cushionCents: centsSchema,
    shortfallCents: centsSchema,
    projectedReadinessDate: calendarDateSchema.nullable(),
    vehicleCode: vehicleCodeSchema,
    assumptionVersion: z.string().trim().min(1).max(80),
    calculationPolicyVersion: productExperienceVersionSchema,
    rankingPolicyVersion: vehicleFitPolicyVersionSchema,
    rationaleVersion: productExperienceVersionSchema,
    rationaleCodes: z.array(planRationaleCodeSchema).min(1),
    health: planHealthSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.cushionCents > 0 && value.shortfallCents > 0) {
      context.addIssue({
        code: 'custom',
        path: ['shortfallCents'],
        message: 'A plan cannot have both a cushion and a shortfall.',
      });
    }
    const reconciled =
      value.currentSavingsCents +
      value.postedPersonalContributionsCents +
      value.postedModeledInterestCents;
    if (reconciled !== value.currentTotalValueCents) {
      context.addIssue({
        code: 'custom',
        path: ['currentTotalValueCents'],
        message: 'Current plan values must reconcile.',
      });
    }
    const projected =
      reconciled + value.futurePersonalContributionsCents + value.futureModeledInterestCents;
    if (projected !== value.projectedTargetDateBalanceCents) {
      context.addIssue({
        code: 'custom',
        path: ['projectedTargetDateBalanceCents'],
        message: 'Projected plan values must reconcile.',
      });
    }
  });

export const changedDimensionSchema = z.enum([
  'CONTRIBUTION',
  'DEADLINE',
  'TARGET',
  'MISSED_CONTRIBUTION',
]);

export const scenarioChangeSchema = z.discriminatedUnion('changedDimension', [
  z
    .object({
      changedDimension: z.literal('CONTRIBUTION'),
      recurringContributionCents: centsSchema,
    })
    .strict(),
  z.object({ changedDimension: z.literal('DEADLINE'), targetDate: calendarDateSchema }).strict(),
  z
    .object({
      changedDimension: z.literal('TARGET'),
      targetAmountCents: centsSchema.min(50_000, 'The minimum goal is $500.'),
    })
    .strict(),
  z
    .object({
      changedDimension: z.literal('MISSED_CONTRIBUTION'),
      missedContributionDate: calendarDateSchema,
    })
    .strict(),
]);

export const scenarioPreviewInputSchema = z
  .object({
    expectedGoalVersion: z.number().int().min(1),
    expectedPlanVersion: z.number().int().min(1),
    change: scenarioChangeSchema,
  })
  .strict();

export const scenarioComparisonSchema = z
  .object({
    changedDimension: changedDimensionSchema,
    current: planDecisionSummarySchema,
    proposed: planDecisionSummarySchema,
    personalContributionChangeCents: signedCentsSchema,
    modeledInterestChangeCents: signedCentsSchema,
    targetDateBalanceChangeCents: signedCentsSchema,
    cushionChangeCents: signedCentsSchema,
    accessConsequence: z.enum([
      'UNCHANGED',
      'AVAILABLE_LATER',
      'AVAILABLE_EARLIER',
      'LOCK_CONFLICT',
    ]),
  })
  .strict();

export const scenarioPreviewOutputSchema = z
  .object({
    goalVersion: z.number().int().min(1),
    planVersion: z.number().int().min(1),
    comparison: scenarioComparisonSchema,
  })
  .strict();

export const scenarioApplyInputSchema = scenarioPreviewInputSchema;
export const scenarioApplyOutputSchema = z
  .object({
    goalVersion: z.number().int().min(1),
    planVersion: z.number().int().min(2),
    planVersionId: ulidSchema,
    activityId: ulidSchema,
    comparison: scenarioComparisonSchema,
  })
  .strict();

export const planVersionChangeReasonSchema = z.enum([
  'INITIAL_ACTIVATION',
  'WHAT_IF_APPLIED',
  'RECOVERY_APPLIED',
]);
export const planVersionSummarySchema = z
  .object({
    id: ulidSchema,
    version: z.number().int().min(1),
    activatedDate: calendarDateSchema,
    appliedAt: z.iso.datetime(),
    changedDimension: changedDimensionSchema.nullable(),
    change: scenarioChangeSchema.nullable(),
    basePlanVersionId: ulidSchema.nullable(),
    changeReason: planVersionChangeReasonSchema,
    calculationPolicyVersion: productExperienceVersionSchema,
    assumptionVersion: z.string().trim().min(1).max(80),
    fromRecovery: z.boolean(),
    summary: planDecisionSummarySchema,
  })
  .strict()
  .superRefine((value, context) => {
    const initial = value.changeReason === 'INITIAL_ACTIVATION';
    if (
      initial !==
      (value.changedDimension === null && value.change === null && value.basePlanVersionId === null)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['change'],
        message: 'Only an initial activation can omit its applied change and base plan.',
      });
    }
    if (value.change !== null && value.changedDimension !== value.change.changedDimension) {
      context.addIssue({
        code: 'custom',
        path: ['changedDimension'],
        message: 'The changed dimension must match the applied change payload.',
      });
    }
  });
export const initialPlanActivationOutputSchema = z
  .object({
    goalId: ulidSchema,
    goalVersion: z.literal(1),
    planVersionId: ulidSchema,
    planVersion: z.literal(1),
    activityId: ulidSchema,
    summary: planDecisionSummarySchema,
  })
  .strict();
export const planHistoryOutputSchema = z
  .object({
    goalId: ulidSchema,
    currentGoalVersion: z.number().int().min(1),
    versions: z.array(planVersionSummarySchema).min(1),
  })
  .strict()
  .superRefine((value, context) => {
    const versions = value.versions.map((version) => version.version);
    if (new Set(versions).size !== versions.length) {
      context.addIssue({
        code: 'custom',
        path: ['versions'],
        message: 'Plan history cannot contain duplicate version numbers.',
      });
    }
    if (versions.some((version, index) => index > 0 && version <= (versions[index - 1] ?? 0))) {
      context.addIssue({
        code: 'custom',
        path: ['versions'],
        message: 'Plan history must be returned in ascending version order.',
      });
    }
  });
export const goalArchiveReasonSchema = z.enum([
  'USER_REQUESTED',
  'GOAL_COMPLETED',
  'NO_LONGER_PURSUED',
]);
export const goalArchiveInputSchema = z
  .object({
    expectedGoalVersion: z.number().int().min(1),
    reasonCode: goalArchiveReasonSchema,
  })
  .strict();

export const recoveryOptionTypeSchema = z.enum([
  'CONTRIBUTION_INCREASE',
  'DEADLINE_EXTENSION',
  'TARGET_REDUCTION',
]);
export const recoveryRationaleCodeSchema = z.enum([
  'INCREASE_TO_ZERO_INTEREST_SAFE_AMOUNT',
  'EXTEND_TO_EARLIEST_CADENCE_DATE',
  'REDUCE_TO_HIGHEST_ATTAINABLE_TARGET',
]);
export const recoveryUnavailableReasonSchema = z.enum([
  'NO_REMAINING_CONTRIBUTIONS',
  'CONTRIBUTION_ALREADY_SUFFICIENT',
  'ZERO_CONTRIBUTION_CANNOT_RECOVER_BY_EXTENSION',
  'DEADLINE_SEARCH_LIMIT_REACHED',
  'NO_DEADLINE_EXTENSION_NEEDED',
  'ATTAINABLE_TARGET_BELOW_POLICY_MINIMUM',
  'TARGET_ALREADY_ATTAINABLE',
  'SELECTED_VEHICLE_DOES_NOT_RESTORE_READINESS',
]);

const recoveryAvailableOptionCommonShape = {
  availability: z.literal('available'),
  projectedReadinessDate: calendarDateSchema,
  resultingHealth: z.enum(['AHEAD', 'ON_TRACK', 'PURCHASE_READY']),
  personalContributionChangeCents: signedCentsSchema,
  modeledInterestChangeCents: signedCentsSchema,
} as const;

export const recoveryOptionSchema = z.union([
  z
    .object({
      ...recoveryAvailableOptionCommonShape,
      order: z.literal(1),
      optionType: z.literal('CONTRIBUTION_INCREASE'),
      change: scenarioChangeSchema.options[0],
      rationaleCode: z.literal('INCREASE_TO_ZERO_INTEREST_SAFE_AMOUNT'),
    })
    .strict(),
  z
    .object({
      ...recoveryAvailableOptionCommonShape,
      order: z.literal(2),
      optionType: z.literal('DEADLINE_EXTENSION'),
      change: scenarioChangeSchema.options[1],
      rationaleCode: z.literal('EXTEND_TO_EARLIEST_CADENCE_DATE'),
    })
    .strict(),
  z
    .object({
      ...recoveryAvailableOptionCommonShape,
      order: z.literal(3),
      optionType: z.literal('TARGET_REDUCTION'),
      change: scenarioChangeSchema.options[2],
      rationaleCode: z.literal('REDUCE_TO_HIGHEST_ATTAINABLE_TARGET'),
    })
    .strict(),
  z
    .object({
      availability: z.literal('unavailable'),
      order: z.literal(1),
      optionType: z.literal('CONTRIBUTION_INCREASE'),
      reasonCode: z.enum([
        'NO_REMAINING_CONTRIBUTIONS',
        'CONTRIBUTION_ALREADY_SUFFICIENT',
        'SELECTED_VEHICLE_DOES_NOT_RESTORE_READINESS',
      ]),
    })
    .strict(),
  z
    .object({
      availability: z.literal('unavailable'),
      order: z.literal(2),
      optionType: z.literal('DEADLINE_EXTENSION'),
      reasonCode: z.enum([
        'ZERO_CONTRIBUTION_CANNOT_RECOVER_BY_EXTENSION',
        'DEADLINE_SEARCH_LIMIT_REACHED',
        'NO_DEADLINE_EXTENSION_NEEDED',
        'SELECTED_VEHICLE_DOES_NOT_RESTORE_READINESS',
      ]),
    })
    .strict(),
  z
    .object({
      availability: z.literal('unavailable'),
      order: z.literal(3),
      optionType: z.literal('TARGET_REDUCTION'),
      reasonCode: z.enum([
        'ATTAINABLE_TARGET_BELOW_POLICY_MINIMUM',
        'TARGET_ALREADY_ATTAINABLE',
        'SELECTED_VEHICLE_DOES_NOT_RESTORE_READINESS',
      ]),
    })
    .strict(),
]);

const recoveryOptionOrder: Readonly<Record<z.infer<typeof recoveryOptionTypeSchema>, number>> = {
  CONTRIBUTION_INCREASE: 0,
  DEADLINE_EXTENSION: 1,
  TARGET_REDUCTION: 2,
};
export const recoveryOptionsOutputSchema = z
  .object({
    health: planHealthSchema,
    options: z.array(recoveryOptionSchema).max(3),
  })
  .strict()
  .superRefine((value, context) => {
    const optionTypes = value.options.map((option) => option.optionType);
    if (new Set(optionTypes).size !== optionTypes.length) {
      context.addIssue({
        code: 'custom',
        path: ['options'],
        message: 'Recovery options must be unique.',
      });
    }
    for (let index = 1; index < value.options.length; index += 1) {
      const previous = value.options[index - 1];
      const current = value.options[index];
      if (
        previous !== undefined &&
        current !== undefined &&
        recoveryOptionOrder[previous.optionType] >= recoveryOptionOrder[current.optionType]
      ) {
        context.addIssue({
          code: 'custom',
          path: ['options'],
          message: 'Recovery options must use the stable product order.',
        });
        break;
      }
    }
    if (value.health !== 'ATTENTION_NEEDED' && value.options.length > 0) {
      context.addIssue({
        code: 'custom',
        path: ['options'],
        message: 'Only an attention-needed plan receives recovery options.',
      });
    }
  });

export const demoMilestoneSchema = z.enum([
  'NEXT_CONTRIBUTION',
  'ONE_MONTH',
  'SIX_MONTHS',
  'NEXT_MATURITY',
  'TARGET_DATE',
]);
export const demoAdvanceInputSchema = z
  .object({ goalId: ulidSchema, milestone: demoMilestoneSchema })
  .strict();
export const demoResetInputSchema = z
  .object({
    goalId: ulidSchema,
    expectedGoalVersion: z.number().int().min(1),
    confirmation: z.literal('RESET_SEEDED_STORY_DEMO'),
  })
  .strict();
export const demoRunFailureCodeSchema = z.enum([
  'NO_EVENT_DUE',
  'ALREADY_PROCESSED',
  'CONTRIBUTION_FAILED',
  'LOCKED_UNTIL_MATURITY',
  'PROCESSING_FAILED',
]);
export const demoRunSummarySchema = z
  .object({
    milestone: demoMilestoneSchema,
    fromDate: calendarDateSchema,
    toDate: calendarDateSchema,
    contributionsPosted: z.number().int().min(0),
    interestPostings: z.number().int().min(0),
    modeledInterestAddedCents: centsSchema,
    skippedDuplicates: z.number().int().min(0),
    purchaseReadyTransitions: z.number().int().min(0),
    failureCodes: z.array(demoRunFailureCodeSchema),
    health: planHealthSchema,
  })
  .strict();

export const productEventNameSchema = z.enum([
  'sample_goal_opened',
  'builder_started',
  'builder_step_completed',
  'safe_baseline_viewed',
  'plan_previewed',
  'vehicle_details_opened',
  'simulated_plan_activated',
  'what_if_previewed',
  'recovery_option_applied',
  'autopilot_advanced',
  'plan_paused',
  'plan_resumed',
  'plan_purchase_ready',
  'plan_completed',
  'plan_archived',
  'purchase_timing_viewed',
  'purchase_timing_check_completed',
  'purchase_timing_check_failed',
  'purchase_timing_check_replayed',
  'purchase_timing_check_no_due',
]);

const productEventCommonShape = {
  demo: z.boolean(),
  applicationVersion: productExperienceVersionSchema,
} as const;
const simpleProductEventNames = [
  'sample_goal_opened',
  'builder_started',
  'safe_baseline_viewed',
  'plan_previewed',
  'autopilot_advanced',
  'plan_paused',
  'plan_resumed',
  'plan_purchase_ready',
  'plan_completed',
  'plan_archived',
  'purchase_timing_viewed',
  'purchase_timing_check_completed',
  'purchase_timing_check_failed',
  'purchase_timing_check_replayed',
  'purchase_timing_check_no_due',
] as const;
const simpleProductEventSchema = z
  .object({ eventName: z.enum(simpleProductEventNames), ...productEventCommonShape })
  .strict();
export const productEventInputSchema = z.discriminatedUnion('eventName', [
  simpleProductEventSchema,
  z
    .object({
      eventName: z.literal('builder_step_completed'),
      ...productEventCommonShape,
      builderStep: builderStepSchema,
    })
    .strict(),
  z
    .object({
      eventName: z.literal('vehicle_details_opened'),
      ...productEventCommonShape,
      vehicleCode: vehicleCodeSchema,
      rejectionCode: rejectionCodeSchema.nullable(),
    })
    .strict(),
  z
    .object({
      eventName: z.literal('simulated_plan_activated'),
      ...productEventCommonShape,
      vehicleCode: vehicleCodeSchema,
    })
    .strict(),
  z
    .object({
      eventName: z.literal('what_if_previewed'),
      ...productEventCommonShape,
      changedDimension: changedDimensionSchema,
    })
    .strict(),
  z
    .object({
      eventName: z.literal('recovery_option_applied'),
      ...productEventCommonShape,
      changedDimension: z.enum(['CONTRIBUTION', 'DEADLINE', 'TARGET']),
    })
    .strict(),
]);
export const productEventAcceptedOutputSchema = z.object({ accepted: z.literal(true) }).strict();
export const productEventSummarySchema = z
  .object({
    eventCounts: z.array(
      z.object({ eventName: productEventNameSchema, count: z.number().int().min(0) }).strict(),
    ),
    builderStepCounts: z.array(
      z.object({ builderStep: builderStepSchema, count: z.number().int().min(0) }).strict(),
    ),
  })
  .strict();

export const purchaseTimingStateSchema = z.enum([
  'INSUFFICIENT_DATA',
  'STALE_DATA',
  'HISTORICALLY_FAVORABLE_PLAN_READY',
  'HISTORICALLY_FAVORABLE_PLAN_NOT_READY',
  'WATCH',
  'HISTORICALLY_TYPICAL',
  'HISTORICALLY_ELEVATED',
]);
export const priceFixtureCodeSchema = z.literal('synthetic_oled_65_v1');
export const purchaseItemDisplayNameSchema = z.literal('65-inch OLED television');
export const priceCurrencySchema = z.literal('USD');
export const purchaseItemLifecycleSchema = z.enum(['active', 'archived']);

export const purchaseItemCreateInputSchema = z
  .object({
    goalId: ulidSchema,
    fixtureCode: priceFixtureCodeSchema,
    currency: priceCurrencySchema,
    targetPriceCents: centsSchema.min(1),
  })
  .strict();
export const purchaseItemUpdateInputSchema = z
  .object({
    expectedVersion: z.number().int().min(1),
    targetPriceCents: centsSchema.min(1),
  })
  .strict();
export const purchaseItemSchema = z
  .object({
    id: ulidSchema,
    goalId: ulidSchema,
    fixtureCode: priceFixtureCodeSchema,
    displayName: purchaseItemDisplayNameSchema,
    currency: priceCurrencySchema,
    targetPriceCents: centsSchema.min(1),
    lifecycle: purchaseItemLifecycleSchema,
    version: z.number().int().min(1),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const priceWatchCadenceSchema = z.enum(['weekly', 'monthly']);
export const priceWatchPolicyCreateInputSchema = z
  .object({
    cadence: priceWatchCadenceSchema,
    nextDueDate: calendarDateSchema,
    enabled: z.boolean(),
  })
  .strict();
export const priceWatchPolicySchema = z
  .object({
    id: ulidSchema,
    purchaseItemId: ulidSchema,
    version: z.number().int().min(1),
    cadence: priceWatchCadenceSchema,
    nextDueDate: calendarDateSchema,
    freshnessLimitDays: z.literal(14),
    analysisPolicyVersion: purchaseTimingPolicyVersionSchema,
    enabled: z.boolean(),
    createdAt: z.iso.datetime(),
  })
  .strict();

export const historicalPriceObservationSchema = z
  .object({
    observationKey: z.string().regex(/^[a-z0-9_-]{1,40}$/),
    observedDate: calendarDateSchema,
    priceCents: centsSchema.min(1),
    currency: priceCurrencySchema,
  })
  .strict();
export const historicalPriceSeriesSchema = z
  .object({
    fixtureCode: priceFixtureCodeSchema,
    displayDescriptor: purchaseItemDisplayNameSchema,
    currency: priceCurrencySchema,
    asOfDate: calendarDateSchema,
    sourceVersion: z.string().regex(/^[a-z0-9._-]{1,80}$/),
    sourceChecksum: sha256DigestSchema,
    sourceType: z.literal('deterministic_fixture'),
    isDemoData: z.literal(true),
    observations: z.array(historicalPriceObservationSchema).min(1),
  })
  .strict()
  .superRefine((value, context) => {
    const observationsByKey = new Map<string, z.infer<typeof historicalPriceObservationSchema>>();
    for (const [index, observation] of value.observations.entries()) {
      if (observation.observedDate > value.asOfDate) {
        context.addIssue({
          code: 'custom',
          path: ['observations', index, 'observedDate'],
          message: 'Historical observations cannot be in the future.',
        });
      }
      const prior = observationsByKey.get(observation.observationKey);
      if (
        prior !== undefined &&
        (prior.observedDate !== observation.observedDate ||
          prior.priceCents !== observation.priceCents)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['observations', index, 'observationKey'],
          message: 'A repeated observation key must contain byte-equivalent price data.',
        });
      }
      observationsByKey.set(observation.observationKey, observation);
    }
  });

export const purchaseTimingStatisticsSchema = z
  .object({
    minimumPriceCents: centsSchema.min(1),
    medianPriceCents: centsSchema.min(1),
    maximumPriceCents: centsSchema.min(1),
    currentPriceCents: centsSchema.min(1),
    empiricalPercentileBasisPoints: z.number().int().min(0).max(10_000),
    differenceFromMedianCents: signedCentsSchema,
    differenceFromTargetCents: signedCentsSchema,
    observationCount: z.number().int().min(0),
    observationSpanDays: z.number().int().min(0),
    freshnessDays: z.number().int().min(0),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.currentPriceCents < value.minimumPriceCents ||
      value.currentPriceCents > value.maximumPriceCents
    ) {
      context.addIssue({
        code: 'custom',
        path: ['currentPriceCents'],
        message: 'The current price must be part of the historical price range.',
      });
    }
    if (
      value.minimumPriceCents > value.medianPriceCents ||
      value.medianPriceCents > value.maximumPriceCents
    ) {
      context.addIssue({
        code: 'custom',
        path: ['medianPriceCents'],
        message: 'Minimum, median, and maximum prices must be ordered.',
      });
    }
  });

export const seasonalPriceMonthSchema = z
  .object({
    month: z.number().int().min(1).max(12),
    observationCount: z.number().int().min(3),
    medianPriceCents: centsSchema.min(1),
  })
  .strict();
export const seasonalPriceSummarySchema = z
  .object({ months: z.array(seasonalPriceMonthSchema).length(12) })
  .strict()
  .superRefine((value, context) => {
    const months = value.months.map((month) => month.month);
    if (new Set(months).size !== 12) {
      context.addIssue({
        code: 'custom',
        path: ['months'],
        message: 'Seasonal detail must contain every calendar month exactly once.',
      });
    }
  });

export const purchaseTimingRationaleCodeSchema = z.enum([
  'INSUFFICIENT_OBSERVATION_COUNT',
  'INSUFFICIENT_OBSERVATION_SPAN',
  'LATEST_OBSERVATION_STALE',
  'PRICE_AT_OR_BELOW_FAVORABLE_PERCENTILE',
  'PRICE_AT_OR_ABOVE_ELEVATED_PERCENTILE',
  'PRICE_ABOVE_TARGET',
  'PRICE_WITHIN_TYPICAL_RANGE',
  'PLAN_PURCHASE_READY',
  'PLAN_PAUSED',
  'PLAN_FUNDED_BUT_LOCKED',
  'PLAN_NOT_PURCHASE_READY',
]);
export const purchaseTimingPlanLifecycleSchema = z.enum([
  'draft',
  'active',
  'completed',
  'archived',
]);
export const purchaseTimingAssessmentSchema = z
  .object({
    id: ulidSchema,
    purchaseItemId: ulidSchema,
    priceCheckRunId: ulidSchema,
    asOfDate: calendarDateSchema,
    assessedTargetPriceCents: centsSchema.min(1),
    currentPlanVersion: z.number().int().min(1).nullable(),
    planLifecycle: purchaseTimingPlanLifecycleSchema,
    planHealth: planHealthSchema.nullable(),
    state: purchaseTimingStateSchema,
    statistics: purchaseTimingStatisticsSchema,
    seasonal: seasonalPriceSummarySchema.nullable(),
    rationaleCodes: z.array(purchaseTimingRationaleCodeSchema).min(1),
    analysisPolicyVersion: purchaseTimingPolicyVersionSchema,
    sourceVersion: z.string().regex(/^[a-z0-9._-]{1,80}$/),
    sourceChecksum: sha256DigestSchema,
    createdAt: z.iso.datetime(),
  })
  .strict()
  .superRefine((value, context) => {
    const insufficient =
      value.statistics.observationCount < 30 || value.statistics.observationSpanDays < 90;
    const stale = !insufficient && value.statistics.freshnessDays > 14;
    let expectedState: z.infer<typeof purchaseTimingStateSchema>;
    if (insufficient) {
      expectedState = 'INSUFFICIENT_DATA';
    } else if (stale) {
      expectedState = 'STALE_DATA';
    } else if (value.statistics.empiricalPercentileBasisPoints <= 2_500) {
      expectedState =
        value.planHealth === 'PURCHASE_READY'
          ? 'HISTORICALLY_FAVORABLE_PLAN_READY'
          : 'HISTORICALLY_FAVORABLE_PLAN_NOT_READY';
    } else if (value.statistics.empiricalPercentileBasisPoints >= 7_500) {
      expectedState = 'HISTORICALLY_ELEVATED';
    } else if (value.statistics.differenceFromTargetCents > 0) {
      expectedState = 'WATCH';
    } else {
      expectedState = 'HISTORICALLY_TYPICAL';
    }
    if (value.state !== expectedState) {
      context.addIssue({
        code: 'custom',
        path: ['state'],
        message: 'The assessment state must follow purchase-timing-v1 precedence.',
      });
    }
    if (
      value.state === 'HISTORICALLY_FAVORABLE_PLAN_READY' &&
      value.planHealth !== 'PURCHASE_READY'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['planHealth'],
        message: 'A favorable ready assessment requires purchase-ready plan health.',
      });
    }
    const invalidPlanProvenance =
      (value.planLifecycle === 'draft' &&
        (value.currentPlanVersion !== null || value.planHealth !== null)) ||
      (value.planLifecycle === 'active' &&
        (value.currentPlanVersion === null || value.planHealth === null)) ||
      ((value.planLifecycle === 'completed' || value.planLifecycle === 'archived') &&
        (value.currentPlanVersion === null || value.planHealth !== null));
    if (invalidPlanProvenance) {
      context.addIssue({
        code: 'custom',
        path: ['currentPlanVersion'],
        message:
          'Plan version and health must match the captured draft, active, or terminal lifecycle.',
      });
    }
    if (value.seasonal !== null && value.statistics.observationSpanDays < 730) {
      context.addIssue({
        code: 'custom',
        path: ['seasonal'],
        message: 'Seasonal detail requires at least 24 months of history.',
      });
    }
  });
export const purchaseTimingLatestOutputSchema = z
  .object({
    item: purchaseItemSchema,
    policy: priceWatchPolicySchema.nullable(),
    assessment: purchaseTimingAssessmentSchema.nullable(),
    series: historicalPriceSeriesSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.assessment === null) !== (value.series === null)) {
      context.addIssue({
        code: 'custom',
        path: ['series'],
        message: 'A latest assessment must include its exact historical series provenance.',
      });
    }
  });

export const priceCheckRunStatusSchema = z.enum([
  'completed',
  'failed',
  'in_progress',
  'replayed',
  'no_due_policies',
]);
export const priceCheckRunErrorCodeSchema = z.enum([
  'PROVIDER_FAILURE',
  'INVALID_PRICE_BATCH',
  'CURRENCY_MISMATCH',
  'FUTURE_OBSERVATION',
  'CONFLICTING_OBSERVATION',
  'ASSESSMENT_FAILURE',
]);
export const priceCheckRunSummarySchema = z
  .object({
    asOfDate: calendarDateSchema,
    status: priceCheckRunStatusSchema,
    duePolicyCount: z.number().int().min(0),
    completedRunCount: z.number().int().min(0),
    inProgressRunCount: z.number().int().min(0),
    replayedRunCount: z.number().int().min(0),
    failedRunCount: z.number().int().min(0),
    observationsInserted: z.number().int().min(0),
    assessmentsCreated: z.number().int().min(0),
    errorCodes: z.array(priceCheckRunErrorCodeSchema),
  })
  .strict();
export const runDuePriceChecksInputSchema = z.object({}).strict();

export type SafeBaselineInput = z.infer<typeof safeBaselineInputSchema>;
export type SafeBaselineOutput = z.infer<typeof safeBaselineOutputSchema>;
export type SafeBaselineResponse = z.infer<typeof safeBaselineResponseSchema>;
export type BuilderStep = z.infer<typeof builderStepSchema>;
export type GoalDraftData = z.infer<typeof goalDraftDataSchema>;
export type GoalDraftCreateInput = z.infer<typeof goalDraftCreateInputSchema>;
export type GoalDraftUpdateInput = z.infer<typeof goalDraftUpdateInputSchema>;
export type GoalDraftDiscardInput = z.infer<typeof goalDraftDiscardInputSchema>;
export type GoalDraftActivateInput = z.infer<typeof goalDraftActivateInputSchema>;
export type GoalDraft = z.infer<typeof goalDraftSchema>;
export type PlanHealth = z.infer<typeof planHealthSchema>;
export type PlanHealthEvidenceCode = z.infer<typeof planHealthEvidenceCodeSchema>;
export type PlanHealthOutput = z.infer<typeof planHealthOutputSchema>;
export type PlanRationaleCode = z.infer<typeof planRationaleCodeSchema>;
export type PlanDecisionSummary = z.infer<typeof planDecisionSummarySchema>;
export type PlanVersionSummary = z.infer<typeof planVersionSummarySchema>;
export type InitialPlanActivationOutput = z.infer<typeof initialPlanActivationOutputSchema>;
export type PlanHistoryOutput = z.infer<typeof planHistoryOutputSchema>;
export type GoalArchiveInput = z.infer<typeof goalArchiveInputSchema>;
export type ChangedDimension = z.infer<typeof changedDimensionSchema>;
export type ScenarioChange = z.infer<typeof scenarioChangeSchema>;
export type ScenarioPreviewInput = z.infer<typeof scenarioPreviewInputSchema>;
export type ScenarioPreviewOutput = z.infer<typeof scenarioPreviewOutputSchema>;
export type ScenarioComparison = z.infer<typeof scenarioComparisonSchema>;
export type ScenarioApplyInput = z.infer<typeof scenarioApplyInputSchema>;
export type ScenarioApplyOutput = z.infer<typeof scenarioApplyOutputSchema>;
export type RecoveryOption = z.infer<typeof recoveryOptionSchema>;
export type RecoveryOptionsOutput = z.infer<typeof recoveryOptionsOutputSchema>;
export type DemoMilestone = z.infer<typeof demoMilestoneSchema>;
export type DemoAdvanceInput = z.infer<typeof demoAdvanceInputSchema>;
export type DemoResetInput = z.infer<typeof demoResetInputSchema>;
export type DemoRunSummary = z.infer<typeof demoRunSummarySchema>;
export type ProductEventName = z.infer<typeof productEventNameSchema>;
export type ProductEventInput = z.infer<typeof productEventInputSchema>;
export type ProductEventAcceptedOutput = z.infer<typeof productEventAcceptedOutputSchema>;
export type ProductEventSummary = z.infer<typeof productEventSummarySchema>;
export type PurchaseTimingState = z.infer<typeof purchaseTimingStateSchema>;
export type PurchaseItemCreateInput = z.infer<typeof purchaseItemCreateInputSchema>;
export type PurchaseItemUpdateInput = z.infer<typeof purchaseItemUpdateInputSchema>;
export type PurchaseItem = z.infer<typeof purchaseItemSchema>;
export type PriceWatchPolicyCreateInput = z.infer<typeof priceWatchPolicyCreateInputSchema>;
export type PriceWatchPolicy = z.infer<typeof priceWatchPolicySchema>;
export type HistoricalPriceObservation = z.infer<typeof historicalPriceObservationSchema>;
export type HistoricalPriceSeries = z.infer<typeof historicalPriceSeriesSchema>;
export type PurchaseTimingStatistics = z.infer<typeof purchaseTimingStatisticsSchema>;
export type PurchaseTimingAssessment = z.infer<typeof purchaseTimingAssessmentSchema>;
export type PurchaseTimingLatestOutput = z.infer<typeof purchaseTimingLatestOutputSchema>;
export type RunDuePriceChecksInput = z.infer<typeof runDuePriceChecksInputSchema>;
export type PriceCheckRunSummary = z.infer<typeof priceCheckRunSummarySchema>;
