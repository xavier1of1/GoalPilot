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

const centsSchema = z.number().int().min(0).max(100_000_000, 'The MVP supports up to $1,000,000.');

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

export const rejectionCodeSchema = z.enum([
  'ASSUMPTION_DISABLED',
  'ASSUMPTION_NOT_EFFECTIVE',
  'ASSUMPTION_STALE',
  'LIQUIDITY_CONFLICT',
  'HORIZON_TOO_SHORT',
  'BELOW_MINIMUM',
]);

export const vehicleProjectionSchema = z.object({
  vehicleCode: vehicleCodeSchema,
  displayName: z.string(),
  eligible: z.boolean(),
  rejectionCode: rejectionCodeSchema.nullable(),
  rejectionMessage: z.string().nullable(),
  requiredContributionCents: centsSchema.nullable(),
  plannedContributionCents: centsSchema,
  principalContributedCents: centsSchema,
  modeledInterestCents: centsSchema,
  endingBalanceCents: centsSchema,
  shortfallCents: centsSchema,
  surplusCents: centsSchema,
  projectedCompletionDate: calendarDateSchema.nullable(),
  accessSummary: z.string(),
  assumption: vehicleAssumptionSchema,
});

export const previewOutputSchema = z.object({
  asOfDate: calendarDateSchema,
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
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AccountSummaryDto {
  readonly id: string;
  readonly goalId: string;
  readonly status: 'active' | 'paused' | 'purchase_ready' | 'completed';
  readonly vehicleCode: VehicleCode;
  readonly principalContributedCents: number;
  readonly interestEarnedCents: number;
  readonly currentLedgerBalanceCents: number;
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
