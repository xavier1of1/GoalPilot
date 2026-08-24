import type {
  FixedTermProjectionLot,
  GoalInput,
  PreviewOutput,
  ProtectionClassification,
  VehicleAssumption,
  VehicleProjection,
} from '@goalpilot/contracts';
import { simulationDisclosure } from '@goalpilot/contracts';
import { Decimal } from 'decimal.js';

import { addCalendarDays, daysBetween, generateContributionDates, isMonthEnd } from './dates.js';
import { rankVehicleFits, vehicleFitPolicyVersion } from './vehicle-fit.js';

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });

interface ProjectionInput {
  readonly goal: GoalInput;
  readonly asOfDate: string;
  readonly scheduleAnchorDate: string;
  readonly omittedContributionDates: readonly string[];
  readonly currentPersonalPrincipalCents: number;
  readonly currentTotalValueCents: number;
  readonly currentAvailableFundsCents: number;
  readonly currentAccruedInterestMicros: number;
  readonly fixedTermLots: readonly FixedTermProjectionLot[];
  readonly contributionCents: number;
  readonly assumption: VehicleAssumption;
}

interface ProjectionNumbers {
  readonly principalCents: number;
  readonly interestCents: number;
  readonly endingBalanceCents: number;
  readonly completionDate: string | null;
}

export function calculateZeroInterestBaseline(
  goal: GoalInput,
  asOfDate: string,
  options: {
    readonly scheduleAnchorDate?: string;
    readonly missedContributionDate?: string | null;
    readonly omittedContributionDates?: readonly string[];
    readonly personalPrincipalCents?: number;
  } = {},
): PreviewOutput['zeroInterestBaseline'] {
  const personalPrincipalCents = options.personalPrincipalCents ?? goal.currentSavedCents;
  if (personalPrincipalCents >= goal.targetAmountCents) {
    return {
      feasible: true,
      occurrenceCount: 0,
      requiredContributionCents: 0,
      projectedBalanceCents: personalPrincipalCents,
      shortfallCents: 0,
    };
  }
  const omittedContributionDates = new Set([
    ...(options.omittedContributionDates ?? []),
    ...(options.missedContributionDate === undefined || options.missedContributionDate === null
      ? []
      : [options.missedContributionDate]),
  ]);
  const contributionDates = generateContributionDates(
    options.scheduleAnchorDate ?? asOfDate,
    goal.targetDate,
    goal.contributionCadence,
  ).filter((date) => date > asOfDate && !omittedContributionDates.has(date));
  const shortfallBeforeContributions = Math.max(0, goal.targetAmountCents - personalPrincipalCents);
  const requiredContributionCents =
    shortfallBeforeContributions === 0
      ? 0
      : contributionDates.length === 0
        ? null
        : Math.ceil(shortfallBeforeContributions / contributionDates.length);
  const projectedBalanceCents =
    personalPrincipalCents + goal.recurringContributionCents * contributionDates.length;
  return {
    feasible: projectedBalanceCents >= goal.targetAmountCents,
    occurrenceCount: contributionDates.length,
    requiredContributionCents,
    projectedBalanceCents,
    shortfallCents: Math.max(0, goal.targetAmountCents - projectedBalanceCents),
  };
}

function eligibility(
  goal: GoalInput,
  asOfDate: string,
  assumption: VehicleAssumption,
  currentPersonalPrincipalCents: number,
): Pick<VehicleProjection, 'eligible' | 'rejectionCode' | 'rejectionMessage'> {
  if (!assumption.enabled)
    return {
      eligible: false,
      rejectionCode: 'ASSUMPTION_DISABLED',
      rejectionMessage: 'This model is currently disabled.',
    };
  if (assumption.effectiveDate > asOfDate)
    return {
      eligible: false,
      rejectionCode: 'ASSUMPTION_NOT_EFFECTIVE',
      rejectionMessage: 'This assumption is not effective yet.',
    };
  if (assumption.vehicleCode !== 'cash' && daysBetween(assumption.reviewedDate, asOfDate) > 365)
    return {
      eligible: false,
      rejectionCode: 'ASSUMPTION_STALE',
      rejectionMessage: 'This illustrative assumption needs review.',
    };
  const horizonDays = daysBetween(asOfDate, goal.targetDate);
  if (horizonDays < assumption.lockDays)
    return {
      eligible: false,
      rejectionCode: 'HORIZON_TOO_SHORT',
      rejectionMessage: `The ${String(assumption.lockDays)}-day modeled term does not fit before the goal date.`,
    };
  if (assumption.lockDays > 0 && goal.liquidityNeed !== 'goal_date')
    return {
      eligible: false,
      rejectionCode: 'LIQUIDITY_CONFLICT',
      rejectionMessage: 'The modeled lock conflicts with the access you requested.',
    };
  if (
    assumption.minimumCents > 0 &&
    currentPersonalPrincipalCents + goal.recurringContributionCents < assumption.minimumCents
  )
    return {
      eligible: false,
      rejectionCode: 'BELOW_MINIMUM',
      rejectionMessage: 'The modeled opening amount is below this vehicle minimum.',
    };
  return { eligible: true, rejectionCode: null, rejectionMessage: null };
}

function dailyDepositProjection(input: ProjectionInput): ProjectionNumbers {
  const contributionDates = new Set(
    generateContributionDates(
      input.scheduleAnchorDate,
      input.goal.targetDate,
      input.goal.contributionCadence,
    ).filter((date) => date > input.asOfDate && !input.omittedContributionDates.includes(date)),
  );
  let principalCents = input.currentPersonalPrincipalCents;
  let balance = new Decimal(input.currentTotalValueCents);
  let accruedInterest = new Decimal(input.currentAccruedInterestMicros).dividedBy(1_000_000);
  let postedInterestCents = 0;
  let completionDate: string | null =
    input.currentAvailableFundsCents >= input.goal.targetAmountCents ? input.asOfDate : null;
  let contributionsOpen = input.currentTotalValueCents < input.goal.targetAmountCents;
  const annualRate = new Decimal(input.assumption.apyBasisPoints).dividedBy(10_000);
  const dailyRate = annualRate.plus(1).pow(new Decimal(1).dividedBy(365)).minus(1);

  let date = addCalendarDays(input.asOfDate, 1);
  while (date <= input.goal.targetDate) {
    if (contributionsOpen && contributionDates.has(date)) {
      principalCents += input.contributionCents;
      balance = balance.plus(input.contributionCents);
      if (completionDate === null && balance.greaterThanOrEqualTo(input.goal.targetAmountCents)) {
        completionDate = date;
      }
    }
    accruedInterest = accruedInterest.plus(balance.times(dailyRate));
    if (isMonthEnd(date) || date === input.goal.targetDate) {
      const posted = accruedInterest.toDecimalPlaces(0, Decimal.ROUND_HALF_EVEN).toNumber();
      postedInterestCents += posted;
      balance = balance.plus(posted);
      accruedInterest = new Decimal(0);
    }
    if (completionDate === null && balance.greaterThanOrEqualTo(input.goal.targetAmountCents)) {
      completionDate = date;
    }
    if (balance.greaterThanOrEqualTo(input.goal.targetAmountCents)) contributionsOpen = false;
    date = addCalendarDays(date, 1);
  }
  return {
    principalCents,
    interestCents: postedInterestCents,
    endingBalanceCents: balance.toDecimalPlaces(0, Decimal.ROUND_HALF_EVEN).toNumber(),
    completionDate,
  };
}

function maturityProjection(input: ProjectionInput): ProjectionNumbers {
  const contributionDates = new Set(
    input.currentTotalValueCents >= input.goal.targetAmountCents
      ? []
      : generateContributionDates(
          input.scheduleAnchorDate,
          input.goal.targetDate,
          input.goal.contributionCadence,
        ).filter((date) => date > input.asOfDate && !input.omittedContributionDates.includes(date)),
  );
  const annualMultiplier = new Decimal(input.assumption.apyBasisPoints).dividedBy(10_000).plus(1);
  const lots: {
    balanceCents: number;
    firstMaturityDate: string;
    nextMaturityDate: string | null;
    nextMaturityInterestEligible: boolean;
    parkedUntilTarget: boolean;
  }[] = input.fixedTermLots.map((lot) => ({
    balanceCents: lot.currentBalanceCents,
    firstMaturityDate: lot.firstMaturityDate,
    nextMaturityDate: lot.nextMaturityDate,
    nextMaturityInterestEligible: lot.nextMaturityDate <= input.goal.targetDate,
    parkedUntilTarget:
      lot.nextMaturityDate > input.goal.targetDate &&
      lot.firstMaturityDate <= input.goal.targetDate,
  }));
  let principalCents = input.currentPersonalPrincipalCents;
  let totalBalanceCents = input.currentTotalValueCents;
  let availableBalanceCents = input.currentAvailableFundsCents;
  let interestCents = 0;
  let completionDate: string | null =
    availableBalanceCents >= input.goal.targetAmountCents ? input.asOfDate : null;
  let contributionsOpen = totalBalanceCents < input.goal.targetAmountCents;

  let date = addCalendarDays(input.asOfDate, 1);
  while (date <= input.goal.targetDate) {
    if (contributionsOpen && contributionDates.has(date) && input.contributionCents > 0) {
      principalCents += input.contributionCents;
      totalBalanceCents += input.contributionCents;
      const firstMaturityDate = addCalendarDays(date, input.assumption.lockDays);
      lots.push({
        balanceCents: input.contributionCents,
        firstMaturityDate,
        nextMaturityDate: firstMaturityDate,
        nextMaturityInterestEligible: firstMaturityDate <= input.goal.targetDate,
        parkedUntilTarget: firstMaturityDate <= input.goal.targetDate,
      });
    }
    for (const lot of lots) {
      if (lot.nextMaturityDate !== date || input.assumption.lockDays === 0) continue;
      if (!lot.nextMaturityInterestEligible) {
        if (!lot.parkedUntilTarget) availableBalanceCents += lot.balanceCents;
        lot.nextMaturityDate = null;
        continue;
      }
      const maturedBalanceCents = new Decimal(lot.balanceCents)
        .times(annualMultiplier.pow(new Decimal(input.assumption.lockDays).dividedBy(365)))
        .toDecimalPlaces(0, Decimal.ROUND_HALF_EVEN)
        .toNumber();
      const postingCents = maturedBalanceCents - lot.balanceCents;
      interestCents += postingCents;
      totalBalanceCents += postingCents;
      lot.balanceCents = maturedBalanceCents;
      const nextMaturityDate = addCalendarDays(date, input.assumption.lockDays);
      if (nextMaturityDate <= input.goal.targetDate) {
        lot.nextMaturityDate = nextMaturityDate;
        lot.nextMaturityInterestEligible = true;
        lot.parkedUntilTarget = true;
      } else {
        lot.nextMaturityDate = nextMaturityDate;
        lot.nextMaturityInterestEligible = false;
        lot.parkedUntilTarget = true;
      }
    }
    if (date === input.goal.targetDate) {
      for (const lot of lots) {
        if (!lot.parkedUntilTarget) continue;
        availableBalanceCents += lot.balanceCents;
        lot.parkedUntilTarget = false;
        lot.nextMaturityDate = null;
      }
    }
    if (completionDate === null && availableBalanceCents >= input.goal.targetAmountCents) {
      completionDate = date;
    }
    if (totalBalanceCents >= input.goal.targetAmountCents) contributionsOpen = false;
    date = addCalendarDays(date, 1);
  }

  if (completionDate === null) {
    const postTargetAvailability = lots
      .flatMap((lot) =>
        lot.nextMaturityDate === null
          ? []
          : [{ date: lot.nextMaturityDate, balanceCents: lot.balanceCents }],
      )
      .sort((left, right) => left.date.localeCompare(right.date));
    for (const event of postTargetAvailability) {
      availableBalanceCents += event.balanceCents;
      if (availableBalanceCents >= input.goal.targetAmountCents) {
        completionDate = event.date;
        break;
      }
    }
  }
  return {
    principalCents,
    interestCents,
    endingBalanceCents: totalBalanceCents,
    completionDate,
  };
}

function runProjection(input: ProjectionInput): ProjectionNumbers {
  return input.assumption.vehicleCode === 'cd_ladder' ||
    input.assumption.vehicleCode === 'treasury_ladder'
    ? maturityProjection(input)
    : dailyDepositProjection(input);
}

function interestAdjustedRequiredContribution(
  input: Omit<ProjectionInput, 'contributionCents'>,
): number | null {
  if (input.currentTotalValueCents >= input.goal.targetAmountCents) return 0;
  const count = generateContributionDates(
    input.scheduleAnchorDate,
    input.goal.targetDate,
    input.goal.contributionCadence,
  ).filter(
    (date) => date > input.asOfDate && !input.omittedContributionDates.includes(date),
  ).length;
  if (count === 0) return 0;
  let low = 0;
  let high = Math.ceil((input.goal.targetAmountCents - input.currentTotalValueCents) / count);
  const highResult = runProjection({ ...input, contributionCents: high });
  if (highResult.completionDate === null || highResult.completionDate > input.goal.targetDate) {
    return null;
  }
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const result = runProjection({ ...input, contributionCents: middle });
    if (result.completionDate !== null && result.completionDate <= input.goal.targetDate)
      high = middle;
    else low = middle + 1;
  }
  return low;
}

function accessSummary(assumption: VehicleAssumption): string {
  if (assumption.vehicleCode === 'cash') return 'Available immediately in this model.';
  if (assumption.vehicleCode === 'hysa') return 'Modeled access within one business day.';
  return `Modeled ${String(assumption.lockDays)}-day maturities; no early-sale assumption.`;
}

function protectionClassification(
  vehicleCode: VehicleAssumption['vehicleCode'],
): ProtectionClassification {
  switch (vehicleCode) {
    case 'cash':
      return 'SIMULATED_CASH';
    case 'hysa':
    case 'cd_ladder':
      return 'SIMULATED_DEPOSIT_HELD_AS_MODELED';
    case 'treasury_ladder':
      return 'SIMULATED_TREASURY_HELD_TO_MATURITY';
  }
}

function preservesPersonalPrincipal(classification: ProtectionClassification): boolean {
  switch (classification) {
    case 'SIMULATED_CASH':
    case 'SIMULATED_DEPOSIT_HELD_AS_MODELED':
    case 'SIMULATED_TREASURY_HELD_TO_MATURITY':
      return true;
  }
}

function accessFit(
  goal: GoalInput,
  asOfDate: string,
  assumption: VehicleAssumption,
): { readonly accessRequirementSatisfied: boolean; readonly lockConflictDays: number } {
  const restrictionDays = Math.max(assumption.lockDays, assumption.liquidityDays);
  const allowedAccessDelayDays =
    goal.liquidityNeed === 'anytime'
      ? 1
      : goal.liquidityNeed === 'within_30_days'
        ? 30
        : Math.max(0, daysBetween(asOfDate, goal.targetDate));
  return {
    accessRequirementSatisfied: restrictionDays <= allowedAccessDelayDays,
    lockConflictDays: Math.max(0, restrictionDays - allowedAccessDelayDays),
  };
}

export function compareVehicles(
  goal: GoalInput,
  asOfDate: string,
  assumptions: readonly VehicleAssumption[],
  options: {
    readonly scheduleAnchorDate?: string;
    readonly missedContributionDate?: string | null;
    readonly omittedContributionDates?: readonly string[];
    readonly personalPrincipalCents?: number;
    readonly totalLedgerValueCents?: number;
    readonly currentAvailableFundsCents?: number;
    readonly currentAccruedInterestMicros?: number;
    readonly fixedTermLots?: readonly FixedTermProjectionLot[];
    readonly fixedTermVehicleCode?: VehicleAssumption['vehicleCode'];
  } = {},
): PreviewOutput {
  if (goal.targetDate < asOfDate)
    throw new RangeError('Target date cannot be before the as-of date.');
  const scheduleAnchorDate = options.scheduleAnchorDate ?? asOfDate;
  const omittedContributionDates = [
    ...(options.omittedContributionDates ?? []),
    ...(options.missedContributionDate === undefined || options.missedContributionDate === null
      ? []
      : [options.missedContributionDate]),
  ];
  const currentPersonalPrincipalCents = options.personalPrincipalCents ?? goal.currentSavedCents;
  const currentTotalValueCents = options.totalLedgerValueCents ?? goal.currentSavedCents;
  const currentAccruedInterestMicros = options.currentAccruedInterestMicros ?? 0;
  if (currentPersonalPrincipalCents > currentTotalValueCents) {
    throw new RangeError('Personal principal cannot exceed total ledger value.');
  }
  if (!Number.isSafeInteger(currentAccruedInterestMicros) || currentAccruedInterestMicros < 0) {
    throw new RangeError('Accrued interest micros must be a non-negative safe integer.');
  }
  const zeroInterestBaseline = calculateZeroInterestBaseline(goal, asOfDate, {
    scheduleAnchorDate,
    omittedContributionDates,
    personalPrincipalCents: currentPersonalPrincipalCents,
  });
  const safeContributionCents = zeroInterestBaseline.requiredContributionCents;
  const projectedVehicles = assumptions.map((assumption) => {
    const fixedTerm =
      assumption.vehicleCode === 'cd_ladder' || assumption.vehicleCode === 'treasury_ladder';
    const fixedTermLots = !fixedTerm
      ? []
      : options.fixedTermVehicleCode === assumption.vehicleCode &&
          options.fixedTermLots !== undefined
        ? options.fixedTermLots
        : currentTotalValueCents === 0
          ? []
          : [
              {
                personalPrincipalCents: currentPersonalPrincipalCents,
                currentBalanceCents: currentTotalValueCents,
                firstMaturityDate: addCalendarDays(asOfDate, assumption.lockDays),
                nextMaturityDate: addCalendarDays(asOfDate, assumption.lockDays),
                nextMaturityInterestEligible:
                  addCalendarDays(asOfDate, assumption.lockDays) <= goal.targetDate,
              },
            ];
    const currentAvailableFundsCents = fixedTerm
      ? options.fixedTermVehicleCode === assumption.vehicleCode
        ? (options.currentAvailableFundsCents ?? 0)
        : 0
      : currentTotalValueCents;
    const firstFutureContributionDate = generateContributionDates(
      scheduleAnchorDate,
      goal.targetDate,
      goal.contributionCadence,
    ).find((date) => date > asOfDate && !omittedContributionDates.includes(date));
    const firstMaturityDate = !fixedTerm
      ? null
      : ([
          ...fixedTermLots.map((lot) => lot.firstMaturityDate),
          ...(firstFutureContributionDate === undefined || goal.recurringContributionCents === 0
            ? []
            : [addCalendarDays(firstFutureContributionDate, assumption.lockDays)]),
        ].sort()[0] ?? null);
    const protection = protectionClassification(assumption.vehicleCode);
    const projectionInput = {
      goal,
      asOfDate,
      scheduleAnchorDate,
      omittedContributionDates,
      currentPersonalPrincipalCents,
      currentTotalValueCents,
      currentAvailableFundsCents,
      currentAccruedInterestMicros:
        assumption.vehicleCode === 'hysa' ? currentAccruedInterestMicros : 0,
      fixedTermLots,
      assumption,
    } as const;
    const eligibilityResult = eligibility(
      goal,
      asOfDate,
      assumption,
      currentPersonalPrincipalCents,
    );
    const values = runProjection({
      ...projectionInput,
      contributionCents: goal.recurringContributionCents,
    });
    const safeContributionValues = runProjection({
      ...projectionInput,
      contributionCents: safeContributionCents ?? 0,
    });
    const modelAdjustedRequiredContributionCents = !eligibilityResult.eligible
      ? null
      : assumption.vehicleCode === 'hysa' || assumption.vehicleCode === 'cash'
        ? safeContributionCents
        : interestAdjustedRequiredContribution({
            ...projectionInput,
          });
    const access = accessFit(goal, asOfDate, assumption);
    return {
      vehicleCode: assumption.vehicleCode,
      displayName: assumption.displayName,
      ...eligibilityResult,
      safeContributionCents,
      modelAdjustedRequiredContributionCents,
      safeContributionValues,
      ...access,
      protectionClassification: protection,
      preservationRequirementSatisfied:
        goal.preservationPreference === 'flexible' || preservesPersonalPrincipal(protection),
      firstMaturityDate,
      plannedContributionCents: goal.recurringContributionCents,
      principalContributedCents: values.principalCents,
      modeledInterestCents: values.interestCents,
      endingBalanceCents: values.endingBalanceCents,
      shortfallCents: Math.max(0, goal.targetAmountCents - values.endingBalanceCents),
      surplusCents: Math.max(0, values.endingBalanceCents - goal.targetAmountCents),
      projectedCompletionDate: values.completionDate,
      accessSummary: accessSummary(assumption),
      assumption,
    };
  });
  const fits = rankVehicleFits({
    targetAmountCents: goal.targetAmountCents,
    targetDate: goal.targetDate,
    candidates: projectedVehicles.map((vehicle) => ({
      vehicleCode: vehicle.vehicleCode,
      eligible: vehicle.eligible,
      safeContributionPurchaseReadyDate: vehicle.safeContributionValues.completionDate,
      accessRequirementSatisfied: vehicle.accessRequirementSatisfied,
      lockConflictDays: vehicle.lockConflictDays,
      modeledTargetDateBalanceCents: vehicle.safeContributionValues.endingBalanceCents,
    })),
  });
  const fitByVehicle = new Map(fits.map((fit) => [fit.vehicleCode, fit] as const));
  const vehicles = projectedVehicles.map((vehicle): VehicleProjection => {
    const fit = fitByVehicle.get(vehicle.vehicleCode);
    if (fit === undefined) throw new Error(`Missing vehicle fit for ${vehicle.vehicleCode}.`);
    return {
      vehicleCode: vehicle.vehicleCode,
      displayName: vehicle.displayName,
      eligible: vehicle.eligible,
      rejectionCode: vehicle.rejectionCode,
      rejectionMessage: vehicle.rejectionMessage,
      requiredContributionCents: vehicle.modelAdjustedRequiredContributionCents,
      safeContributionCents: vehicle.safeContributionCents,
      modelAdjustedRequiredContributionCents: vehicle.modelAdjustedRequiredContributionCents,
      fitRank: fit.rank,
      readyByTargetUsingSafeContribution: fit.readyByTargetUsingSafeContribution,
      accessRequirementSatisfied: fit.accessRequirementSatisfied,
      lockConflictDays: fit.lockConflictDays,
      safeContributionModeledCushionCents: fit.modeledCushionCents,
      fitRationaleCode: !vehicle.eligible
        ? 'INELIGIBLE_POLICY'
        : vehicle.vehicleCode === 'cash'
          ? 'CASH_BASELINE'
          : 'ELIGIBLE_ACCESS_FIT',
      protectionClassification: vehicle.protectionClassification,
      preservationRequirementSatisfied: vehicle.preservationRequirementSatisfied,
      firstMaturityDate: vehicle.firstMaturityDate,
      plannedContributionCents: vehicle.plannedContributionCents,
      principalContributedCents: vehicle.principalContributedCents,
      futurePersonalContributionsCents: Math.max(
        0,
        vehicle.principalContributedCents - currentPersonalPrincipalCents,
      ),
      modeledInterestCents: vehicle.modeledInterestCents,
      modeledBenefitVersusCashCents: 0,
      endingBalanceCents: vehicle.endingBalanceCents,
      shortfallCents: vehicle.shortfallCents,
      surplusCents: vehicle.surplusCents,
      projectedCompletionDate: vehicle.projectedCompletionDate,
      accessSummary: vehicle.accessSummary,
      assumption: vehicle.assumption,
    };
  });
  const cashEndingBalanceCents = vehicles.find(
    (vehicle) => vehicle.vehicleCode === 'cash',
  )?.endingBalanceCents;
  if (cashEndingBalanceCents === undefined) {
    throw new Error('The illustrative catalog must include the cash baseline.');
  }
  const reconciledVehicles = vehicles.map((vehicle) => ({
    ...vehicle,
    modeledBenefitVersusCashCents: vehicle.endingBalanceCents - cashEndingBalanceCents,
  }));
  const recommendedVehicleCode =
    reconciledVehicles.find((vehicle) => vehicle.fitRank === 1)?.vehicleCode ?? null;
  return {
    asOfDate,
    rankingPolicyVersion: vehicleFitPolicyVersion,
    zeroInterestBaseline,
    vehicles: reconciledVehicles,
    recommendedVehicleCode,
    disclosure: simulationDisclosure,
  };
}

export function calculatePostedInterest(
  balanceCents: number,
  apyBasisPoints: number,
  days: number,
): number {
  if (balanceCents < 0 || apyBasisPoints < 0 || days < 0)
    throw new RangeError('Values cannot be negative.');
  const annualMultiplier = new Decimal(apyBasisPoints).dividedBy(10_000).plus(1);
  return new Decimal(balanceCents)
    .times(annualMultiplier.pow(new Decimal(days).dividedBy(365)).minus(1))
    .toDecimalPlaces(0, Decimal.ROUND_HALF_EVEN)
    .toNumber();
}

export function calculateDailyAccrualMicros(balanceCents: number, apyBasisPoints: number): number {
  if (balanceCents < 0 || apyBasisPoints < 0) throw new RangeError('Values cannot be negative.');
  const dailyRate = new Decimal(apyBasisPoints)
    .dividedBy(10_000)
    .plus(1)
    .pow(new Decimal(1).dividedBy(365))
    .minus(1);
  return new Decimal(balanceCents)
    .times(dailyRate)
    .times(1_000_000)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_EVEN)
    .toNumber();
}

export function roundAccruedInterestMicros(accruedInterestMicros: number): number {
  if (accruedInterestMicros < 0) throw new RangeError('Accrued interest cannot be negative.');
  return new Decimal(accruedInterestMicros)
    .dividedBy(1_000_000)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_EVEN)
    .toNumber();
}

export function calculateMaturityInterestPosting(
  principalCents: number,
  apyBasisPoints: number,
  termDays: number,
  cycle: number,
): number {
  if (
    principalCents < 0 ||
    apyBasisPoints < 0 ||
    !Number.isInteger(termDays) ||
    termDays <= 0 ||
    !Number.isInteger(cycle) ||
    cycle <= 0
  )
    throw new RangeError('Maturity inputs are outside the supported range.');
  const termMultiplier = new Decimal(apyBasisPoints)
    .dividedBy(10_000)
    .plus(1)
    .pow(new Decimal(termDays).dividedBy(365));
  let balance = new Decimal(principalCents);
  let previous = principalCents;
  for (let posting = 1; posting <= cycle; posting += 1) {
    const matured = balance
      .times(termMultiplier)
      .toDecimalPlaces(0, Decimal.ROUND_HALF_EVEN)
      .toNumber();
    if (posting === cycle) return matured - previous;
    balance = new Decimal(matured);
    previous = matured;
  }
  return 0;
}
