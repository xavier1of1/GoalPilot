import type {
  GoalInput,
  PreviewOutput,
  VehicleAssumption,
  VehicleProjection,
} from '@goalpilot/contracts';
import { simulationDisclosure } from '@goalpilot/contracts';
import { Decimal } from 'decimal.js';

import { addCalendarDays, daysBetween, generateContributionDates, isMonthEnd } from './dates.js';

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });

interface ProjectionInput {
  readonly goal: GoalInput;
  readonly asOfDate: string;
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
): PreviewOutput['zeroInterestBaseline'] {
  if (goal.currentSavedCents >= goal.targetAmountCents) {
    return {
      feasible: true,
      occurrenceCount: 0,
      requiredContributionCents: 0,
      projectedBalanceCents: goal.currentSavedCents,
      shortfallCents: 0,
    };
  }
  const contributionDates = generateContributionDates(
    asOfDate,
    goal.targetDate,
    goal.contributionCadence,
  );
  const shortfallBeforeContributions = Math.max(0, goal.targetAmountCents - goal.currentSavedCents);
  const requiredContributionCents =
    shortfallBeforeContributions === 0
      ? 0
      : contributionDates.length === 0
        ? null
        : Math.ceil(shortfallBeforeContributions / contributionDates.length);
  const projectedBalanceCents =
    goal.currentSavedCents + goal.recurringContributionCents * contributionDates.length;
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
    goal.currentSavedCents + goal.recurringContributionCents < assumption.minimumCents
  )
    return {
      eligible: false,
      rejectionCode: 'BELOW_MINIMUM',
      rejectionMessage: 'The modeled opening amount is below this vehicle minimum.',
    };
  return { eligible: true, rejectionCode: null, rejectionMessage: null };
}

function dailyDepositProjection(input: ProjectionInput): ProjectionNumbers {
  if (input.goal.currentSavedCents >= input.goal.targetAmountCents) {
    return {
      principalCents: input.goal.currentSavedCents,
      interestCents: 0,
      endingBalanceCents: input.goal.currentSavedCents,
      completionDate: input.asOfDate,
    };
  }
  const contributionDates = new Set(
    generateContributionDates(
      input.asOfDate,
      input.goal.targetDate,
      input.goal.contributionCadence,
    ),
  );
  let principalCents = input.goal.currentSavedCents;
  let balance = new Decimal(input.goal.currentSavedCents);
  let accruedInterest = new Decimal(0);
  let postedInterestCents = 0;
  let completionDate: string | null = null;
  const annualRate = new Decimal(input.assumption.apyBasisPoints).dividedBy(10_000);
  const dailyRate = annualRate.plus(1).pow(new Decimal(1).dividedBy(365)).minus(1);

  let date = addCalendarDays(input.asOfDate, 1);
  while (date <= input.goal.targetDate) {
    if (contributionDates.has(date)) {
      principalCents += input.contributionCents;
      balance = balance.plus(input.contributionCents);
    }
    accruedInterest = accruedInterest.plus(balance.times(dailyRate));
    if (isMonthEnd(date) || date === input.goal.targetDate) {
      const posted = accruedInterest.toDecimalPlaces(0, Decimal.ROUND_HALF_EVEN).toNumber();
      postedInterestCents += posted;
      balance = balance.plus(posted);
      accruedInterest = new Decimal(0);
    }
    if (balance.greaterThanOrEqualTo(input.goal.targetAmountCents)) {
      completionDate = date;
      break;
    }
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
  if (input.goal.currentSavedCents >= input.goal.targetAmountCents) {
    return {
      principalCents: input.goal.currentSavedCents,
      interestCents: 0,
      endingBalanceCents: input.goal.currentSavedCents,
      completionDate: input.goal.targetDate,
    };
  }
  const contributionDates = new Set(
    generateContributionDates(
      input.asOfDate,
      input.goal.targetDate,
      input.goal.contributionCadence,
    ),
  );
  const annualMultiplier = new Decimal(input.assumption.apyBasisPoints).dividedBy(10_000).plus(1);
  const lots: {
    balanceCents: number;
    nextMaturityDate: string;
  }[] = [];
  if (input.goal.currentSavedCents > 0) {
    lots.push({
      balanceCents: input.goal.currentSavedCents,
      nextMaturityDate: addCalendarDays(input.asOfDate, input.assumption.lockDays),
    });
  }
  let principalCents = input.goal.currentSavedCents;
  let interestCents = 0;
  let completionDate: string | null = null;

  let date = addCalendarDays(input.asOfDate, 1);
  while (date <= input.goal.targetDate) {
    if (contributionDates.has(date) && input.contributionCents > 0) {
      principalCents += input.contributionCents;
      lots.push({
        balanceCents: input.contributionCents,
        nextMaturityDate: addCalendarDays(date, input.assumption.lockDays),
      });
    }
    for (const lot of lots) {
      if (lot.nextMaturityDate !== date || input.assumption.lockDays === 0) continue;
      const maturedBalanceCents = new Decimal(lot.balanceCents)
        .times(annualMultiplier.pow(new Decimal(input.assumption.lockDays).dividedBy(365)))
        .toDecimalPlaces(0, Decimal.ROUND_HALF_EVEN)
        .toNumber();
      interestCents += maturedBalanceCents - lot.balanceCents;
      lot.balanceCents = maturedBalanceCents;
      lot.nextMaturityDate = addCalendarDays(date, input.assumption.lockDays);
    }
    date = addCalendarDays(date, 1);
  }
  const endingBalanceCents = principalCents + interestCents;
  if (endingBalanceCents >= input.goal.targetAmountCents) completionDate = input.goal.targetDate;
  return {
    principalCents,
    interestCents,
    endingBalanceCents,
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
): number {
  if (input.goal.currentSavedCents >= input.goal.targetAmountCents) return 0;
  const count = generateContributionDates(
    input.asOfDate,
    input.goal.targetDate,
    input.goal.contributionCadence,
  ).length;
  if (count === 0) return 0;
  let low = 0;
  let high = Math.ceil((input.goal.targetAmountCents - input.goal.currentSavedCents) / count);
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const result = runProjection({ ...input, contributionCents: middle });
    if (result.endingBalanceCents >= input.goal.targetAmountCents) high = middle;
    else low = middle + 1;
  }
  return low;
}

function accessSummary(assumption: VehicleAssumption): string {
  if (assumption.vehicleCode === 'cash') return 'Available immediately in this model.';
  if (assumption.vehicleCode === 'hysa') return 'Modeled access within one business day.';
  return `Modeled ${String(assumption.lockDays)}-day maturities; no early-sale assumption.`;
}

export function compareVehicles(
  goal: GoalInput,
  asOfDate: string,
  assumptions: readonly VehicleAssumption[],
): PreviewOutput {
  if (goal.targetDate < asOfDate)
    throw new RangeError('Target date cannot be before the as-of date.');
  const zeroInterestBaseline = calculateZeroInterestBaseline(goal, asOfDate);
  const vehicles = assumptions.map((assumption): VehicleProjection => {
    const eligibilityResult = eligibility(goal, asOfDate, assumption);
    const values = runProjection({
      goal,
      asOfDate,
      contributionCents: goal.recurringContributionCents,
      assumption,
    });
    const requiredContributionCents = !eligibilityResult.eligible
      ? null
      : assumption.vehicleCode === 'hysa' || assumption.vehicleCode === 'cash'
        ? zeroInterestBaseline.requiredContributionCents
        : interestAdjustedRequiredContribution({ goal, asOfDate, assumption });
    return {
      vehicleCode: assumption.vehicleCode,
      displayName: assumption.displayName,
      ...eligibilityResult,
      requiredContributionCents,
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
  const recommendedVehicleCode =
    [...vehicles]
      .filter(
        (vehicle): vehicle is VehicleProjection & { requiredContributionCents: number } =>
          vehicle.eligible && vehicle.requiredContributionCents !== null,
      )
      .sort(
        (left, right) =>
          left.requiredContributionCents - right.requiredContributionCents ||
          right.endingBalanceCents - left.endingBalanceCents ||
          left.assumption.liquidityDays - right.assumption.liquidityDays,
      )[0]?.vehicleCode ?? null;
  return {
    asOfDate,
    zeroInterestBaseline,
    vehicles,
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
