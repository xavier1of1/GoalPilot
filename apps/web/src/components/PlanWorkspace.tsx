import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  CalendarClock,
  ChevronRight,
  FlaskConical,
  History,
  RotateCcw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import type {
  AccountSummaryDto,
  DemoMilestone,
  GoalDto,
  PlanDecisionSummary,
  PlanHealthEvidenceCode,
  RecoveryOption,
  ScenarioChange,
} from '@goalpilot/contracts';

import { api, ApiClientError, trackProductEvent } from '../api.js';
import { RetryableQueryError } from './RetryableQueryError.js';
import { dollarsToCents, formatDate, formatMoney, formatTimestamp } from '../format.js';
import { LogicalMutationKey } from '../idempotency.js';
import {
  accessConsequenceCopy,
  archiveReasonCopy,
  contributionCadenceCopy,
  demoFailureCopy,
  describeRecoveryRationale,
  describeScenarioChange,
  describeUnavailableRecovery,
  formatSignedMoney,
  goalStatusCopy,
  healthEvidenceCopy,
  historyDimensionCopy,
  historyReasonCopy,
  planHealthCopy,
  planRationaleCopy,
  priceCheckErrorCopy,
  priceCheckStatusCopy,
  purchaseTimingStateCopy,
  recoveryOptionCopy,
  vehicleCopy,
} from '../productCopy.js';

export function PlanWorkspace({
  goal,
  account,
  applicationDate,
}: {
  readonly goal: GoalDto;
  readonly account: AccountSummaryDto;
  readonly applicationDate: string;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const capabilities = useQuery({
    queryKey: ['capabilities'],
    queryFn: api.capabilities,
    retry: false,
  });
  const summary = useQuery({
    queryKey: ['plan-summary', goal.id],
    queryFn: () => api.planSummary(goal.id),
    retry: false,
  });
  const health = useQuery({
    queryKey: ['plan-health', goal.id],
    queryFn: () => api.planHealth(goal.id),
    retry: false,
  });
  const recovery = useQuery({
    queryKey: ['recovery-options', goal.id],
    queryFn: () => api.recoveryOptions(goal.id),
    retry: false,
  });
  const history = useQuery({
    queryKey: ['plan-history', goal.id],
    queryFn: () => api.planHistory(goal.id),
    retry: false,
  });
  const archiveKeyRef = useRef(new LogicalMutationKey());
  const refresh = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['goals'] }),
      queryClient.invalidateQueries({ queryKey: ['goal', goal.id] }),
      queryClient.invalidateQueries({ queryKey: ['plan-summary', goal.id] }),
      queryClient.invalidateQueries({ queryKey: ['plan-health', goal.id] }),
      queryClient.invalidateQueries({ queryKey: ['recovery-options', goal.id] }),
      queryClient.invalidateQueries({ queryKey: ['plan-history', goal.id] }),
      queryClient.invalidateQueries({ queryKey: ['activity', goal.id] }),
      queryClient.invalidateQueries({ queryKey: ['timing-lab', goal.id] }),
    ]);
  };
  const archive = useMutation({
    mutationFn: () => {
      const input = {
        expectedGoalVersion: goal.version,
        reasonCode: 'USER_REQUESTED' as const,
      };
      return api.archiveGoal(
        goal.id,
        input,
        archiveKeyRef.current.keyFor({ goalId: goal.id, ...input }),
      );
    },
    onSuccess: async () => {
      archiveKeyRef.current.clear();
      trackProductEvent({
        eventName: 'plan_archived',
        demo: capabilities.data?.demoStory ?? false,
        applicationVersion: 'product-experience-v1',
      });
      await refresh();
    },
  });
  const currentPlanVersion = history.data?.versions.at(-1)?.version ?? 1;
  const healthCode = health.error === null ? (health.data?.health ?? null) : null;
  const readOnly = goal.status === 'completed' || goal.status === 'archived';

  return (
    <div className="experience-stack">
      <section className="experience-card" aria-labelledby="decision-summary-title">
        <div className="card-heading-row">
          <div>
            <p className="eyebrow">Decision-ready plan</p>
            <h2 id="decision-summary-title">The commitment, cushion, and access reconcile.</h2>
          </div>
          {healthCode !== null && (
            <span className={`health-badge health-${healthCode.toLowerCase()}`}>
              {planHealthCopy[healthCode]}
            </span>
          )}
        </div>
        {summary.isPending ? (
          <p className="muted" aria-busy="true">
            Loading the current plan decision…
          </p>
        ) : summary.data === undefined ? (
          <RetryableQueryError
            error={summary.error}
            label="Plan decision summary"
            onRetry={() => summary.refetch()}
          />
        ) : (
          <>
            <DecisionSummary
              summary={summary.data}
              healthEvidenceCodes={health.error === null ? (health.data?.evidenceCodes ?? []) : []}
            />
            {health.isPending && (
              <p className="muted" aria-busy="true">
                Checking current plan health...
              </p>
            )}
            {health.error !== null && (
              <RetryableQueryError
                error={health.error}
                label="Plan health"
                description="The financial summary remains visible, but its current health and evidence could not be refreshed."
                onRetry={() => health.refetch()}
              />
            )}
          </>
        )}
      </section>

      {capabilities.error !== null && (
        <section className="experience-card" aria-label="Local feature availability">
          <RetryableQueryError
            error={capabilities.error}
            label="Local feature availability"
            description="Core plan tools remain available, but Story Mode and Purchase Timing Lab availability could not be checked."
            onRetry={() => capabilities.refetch()}
          />
        </section>
      )}

      {readOnly ? (
        <section className="experience-card lifecycle-readonly" aria-labelledby="read-only-title">
          <p className="eyebrow">Read-only lifecycle</p>
          <h2 id="read-only-title">
            {goal.status === 'archived'
              ? 'This archived plan is history.'
              : 'This plan is complete.'}
          </h2>
          <p>
            Its decision summary and immutable versions remain available, but plan changes,
            recovery, and Story-Mode advances are closed.
          </p>
          <p className="muted">
            {goal.status === 'archived' && goal.archivedAt !== null && goal.archiveReason !== null
              ? `Archived ${formatTimestamp(goal.archivedAt)}. ${archiveReasonCopy[goal.archiveReason]}.`
              : `Completed plan. Last recorded update ${formatTimestamp(goal.updatedAt)}.`}
          </p>
        </section>
      ) : (
        <>
          <WhatIfStudio
            goal={goal}
            currentPlanVersion={currentPlanVersion}
            nextContributionDate={account.nextContributionDate}
            demo={capabilities.data?.demoStory ?? false}
            onApplied={refresh}
          />

          <RecoveryPlanner
            goal={goal}
            currentPlanVersion={currentPlanVersion}
            health={healthCode}
            options={recovery.data?.options ?? []}
            loading={recovery.isPending}
            error={recovery.error}
            demo={capabilities.data?.demoStory ?? false}
            onApplied={refresh}
          />
        </>
      )}

      <section className="experience-card" aria-labelledby="history-title">
        <div className="card-heading-row">
          <div>
            <p className="eyebrow">Immutable history</p>
            <h2 id="history-title">Every applied plan remains readable.</h2>
          </div>
          <History aria-hidden="true" />
        </div>
        {history.isPending ? (
          <p className="muted" aria-busy="true">
            Loading plan versions…
          </p>
        ) : history.data === undefined ? (
          <UnavailableFeature error={history.error} label="Plan history" />
        ) : (
          <ol className="version-list">
            {history.data.versions.map((version) => {
              const baseVersion =
                version.basePlanVersionId === null
                  ? null
                  : (history.data.versions.find(
                      (candidate) => candidate.id === version.basePlanVersionId,
                    )?.version ?? null);
              return (
                <li key={version.id}>
                  <span>v{version.version}</span>
                  <div>
                    <strong>{historyReasonCopy[version.changeReason]}</strong>
                    <small>
                      Applied {formatTimestamp(version.appliedAt)} · plan date{' '}
                      {formatDate(version.activatedDate)}
                      {baseVersion === null ? '' : ` · based on v${String(baseVersion)}`}
                    </small>
                    <small>
                      {version.change === null
                        ? 'Created the first Simulated Goal Plan.'
                        : describeScenarioChange(version.change)}{' '}
                      Source:{' '}
                      {version.fromRecovery
                        ? 'Recovery Planner'
                        : version.changeReason === 'WHAT_IF_APPLIED'
                          ? 'What-If Studio'
                          : 'Plan activation'}
                      .
                    </small>
                    {version.changedDimension !== null && (
                      <small>
                        Changed field: {historyDimensionCopy[version.changedDimension]}.
                      </small>
                    )}
                    <small>
                      Calculation policy {version.calculationPolicyVersion}; assumption{' '}
                      {version.assumptionVersion}.
                    </small>
                  </div>
                  <span className="status-pill">{planHealthCopy[version.summary.health]}</span>
                </li>
              );
            })}
          </ol>
        )}
        {!readOnly && (
          <div className="archive-row">
            <p>Archiving removes this plan from active work but preserves its read-only history.</p>
            <button
              className="text-button"
              type="button"
              disabled={archive.isPending}
              onClick={() => archive.mutate()}
            >
              <Archive aria-hidden="true" size={16} />
              {archive.isPending ? 'Archiving…' : 'Archive plan'}
            </button>
          </div>
        )}
        {archive.error !== null && <UnavailableFeature error={archive.error} label="Archive" />}
      </section>

      {!readOnly && capabilities.error === null && (
        <AutopilotPanel
          goal={goal}
          applicationDate={applicationDate}
          enabled={capabilities.data?.demoStory ?? false}
          capabilityLoading={capabilities.isPending}
          demo={capabilities.data?.demoStory ?? false}
          onAdvanced={refresh}
        />
      )}

      {capabilities.error === null && (
        <TimingLabPanel
          goalId={goal.id}
          enabled={capabilities.data?.purchaseTimingLab ?? false}
          capabilityLoading={capabilities.isPending}
          demo={capabilities.data?.demoStory ?? false}
          readOnly={readOnly}
        />
      )}
    </div>
  );
}

function DecisionSummary({
  summary,
  healthEvidenceCodes,
}: {
  readonly summary: PlanDecisionSummary;
  readonly healthEvidenceCodes: readonly PlanHealthEvidenceCode[];
}): React.JSX.Element {
  return (
    <>
      <div className="decision-lead">
        <div>
          <span>Safe contribution</span>
          <strong>
            {summary.safeContributionCents === null
              ? 'Unavailable'
              : formatMoney(summary.safeContributionCents)}
          </strong>
          <small>Does not depend on modeled interest.</small>
        </div>
        <div>
          <span>Chosen contribution</span>
          <strong>{formatMoney(summary.chosenContributionCents)}</strong>
          <small>{contributionCadenceCopy[summary.contributionCadence]}</small>
        </div>
        <div>
          <span>Purchase readiness</span>
          <strong>{formatDate(summary.projectedReadinessDate)}</strong>
          <small>{vehicleCopy[summary.vehicleCode]}</small>
        </div>
      </div>
      <dl className="reconciliation compact">
        <div>
          <dt>Current savings</dt>
          <dd>{formatMoney(summary.currentSavingsCents)}</dd>
        </div>
        <div>
          <dt>+ posted contributions</dt>
          <dd>{formatMoney(summary.postedPersonalContributionsCents)}</dd>
        </div>
        <div>
          <dt>+ posted modeled interest</dt>
          <dd>{formatMoney(summary.postedModeledInterestCents)}</dd>
        </div>
        <div>
          <dt>+ future contributions</dt>
          <dd>{formatMoney(summary.futurePersonalContributionsCents)}</dd>
        </div>
        <div>
          <dt>+ future modeled interest</dt>
          <dd>{formatMoney(summary.futureModeledInterestCents)}</dd>
        </div>
        <div className="total">
          <dt>= target-date balance</dt>
          <dd>{formatMoney(summary.projectedTargetDateBalanceCents)}</dd>
        </div>
      </dl>
      <p className={summary.shortfallCents > 0 ? 'outcome-callout attention' : 'outcome-callout'}>
        {summary.shortfallCents > 0
          ? `${formatMoney(summary.shortfallCents)} projected shortfall.`
          : `${formatMoney(summary.cushionCents)} modeled cushion.`}{' '}
        Modeled interest remains secondary to personal contributions.
      </p>
      <details className="decision-evidence">
        <summary>Why this plan has this status</summary>
        <div className="evidence-grid">
          <section aria-labelledby="plan-rationale-title">
            <h3 id="plan-rationale-title">Plan rationale</h3>
            <ul>
              {summary.rationaleCodes.map((code) => (
                <li key={code}>{planRationaleCopy[code]}</li>
              ))}
            </ul>
          </section>
          <section aria-labelledby="health-evidence-title">
            <h3 id="health-evidence-title">Health evidence</h3>
            <ul>
              {healthEvidenceCodes.map((code) => (
                <li key={code}>{healthEvidenceCopy[code]}</li>
              ))}
            </ul>
          </section>
        </div>
      </details>
    </>
  );
}

function WhatIfStudio({
  goal,
  currentPlanVersion,
  nextContributionDate,
  demo,
  onApplied,
}: {
  readonly goal: GoalDto;
  readonly currentPlanVersion: number;
  readonly nextContributionDate: string | null;
  readonly demo: boolean;
  readonly onApplied: () => Promise<void>;
}): React.JSX.Element {
  const [dimension, setDimension] = useState<ScenarioChange['changedDimension']>('CONTRIBUTION');
  const [value, setValue] = useState(String(goal.recurringContributionCents / 100));
  const [message, setMessage] = useState<string | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const valueRef = useRef<HTMLInputElement>(null);
  const applyKeyRef = useRef(new LogicalMutationKey());
  const change = useMemo((): ScenarioChange | null => {
    if (dimension === 'MISSED_CONTRIBUTION')
      return nextContributionDate === null
        ? null
        : { changedDimension: dimension, missedContributionDate: nextContributionDate };
    if (dimension === 'DEADLINE')
      return /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? { changedDimension: dimension, targetDate: value }
        : null;
    try {
      const cents = dollarsToCents(value);
      if (dimension === 'TARGET' && cents < 50_000) return null;
      return dimension === 'CONTRIBUTION'
        ? { changedDimension: dimension, recurringContributionCents: cents }
        : { changedDimension: dimension, targetAmountCents: cents };
    } catch {
      return null;
    }
  }, [dimension, nextContributionDate, value]);
  const preview = useMutation({
    mutationFn: (selectedChange: ScenarioChange) =>
      api.previewScenario(goal.id, {
        expectedGoalVersion: goal.version,
        expectedPlanVersion: currentPlanVersion,
        change: selectedChange,
      }),
    onSuccess: (_, selectedChange) => {
      trackProductEvent({
        eventName: 'what_if_previewed',
        changedDimension: selectedChange.changedDimension,
        demo,
        applicationVersion: 'product-experience-v1',
      });
    },
  });
  const apply = useMutation({
    mutationFn: () => {
      if (preview.variables === undefined) throw new Error('Preview a valid change first.');
      const input = {
        expectedGoalVersion: goal.version,
        expectedPlanVersion: currentPlanVersion,
        change: preview.variables,
      };
      return api.applyScenario(
        goal.id,
        input,
        applyKeyRef.current.keyFor({ goalId: goal.id, ...input }),
      );
    },
    onSuccess: async () => {
      applyKeyRef.current.clear();
      setMessage('Applied as a new immutable plan version.');
      await onApplied();
    },
  });
  const chooseDimension = (next: ScenarioChange['changedDimension']): void => {
    applyKeyRef.current.clear();
    setDimension(next);
    preview.reset();
    setInputError(null);
    setMessage(null);
    setValue(
      next === 'CONTRIBUTION'
        ? String(goal.recurringContributionCents / 100)
        : next === 'TARGET'
          ? String(goal.targetAmountCents / 100)
          : goal.targetDate,
    );
  };
  const previewChange = (): void => {
    if (change === null) {
      setInputError(
        dimension === 'MISSED_CONTRIBUTION'
          ? 'There is no next planned contribution to miss.'
          : dimension === 'DEADLINE'
            ? 'Choose a complete new target date.'
            : dimension === 'TARGET'
              ? 'Enter a target amount of at least $500.'
              : 'Enter a valid non-negative contribution amount.',
      );
      requestAnimationFrame(() => valueRef.current?.focus());
      return;
    }
    setInputError(null);
    preview.mutate(change);
  };
  return (
    <section className="experience-card" aria-labelledby="what-if-title">
      <div className="card-heading-row">
        <div>
          <p className="eyebrow">What-If Studio</p>
          <h2 id="what-if-title">Change exactly one part of the plan.</h2>
        </div>
        <FlaskConical aria-hidden="true" />
      </div>
      <div className="scenario-controls">
        <label>
          Change dimension
          <select
            value={dimension}
            onChange={(event) =>
              chooseDimension(event.target.value as ScenarioChange['changedDimension'])
            }
          >
            <option value="CONTRIBUTION">Recurring contribution</option>
            <option value="DEADLINE">Deadline</option>
            <option value="TARGET">Target amount</option>
            <option value="MISSED_CONTRIBUTION">Miss next contribution</option>
          </select>
        </label>
        {dimension !== 'MISSED_CONTRIBUTION' && (
          <label htmlFor="what-if-value">
            {dimension === 'DEADLINE'
              ? 'New deadline'
              : dimension === 'TARGET'
                ? 'New target amount'
                : 'New contribution'}
            <span className={dimension === 'DEADLINE' ? '' : 'input-prefix'}>
              {dimension !== 'DEADLINE' && <span aria-hidden="true">$</span>}
              <input
                id="what-if-value"
                ref={valueRef}
                type={dimension === 'DEADLINE' ? 'date' : 'text'}
                inputMode={dimension === 'DEADLINE' ? undefined : 'decimal'}
                aria-invalid={inputError === null ? undefined : true}
                aria-describedby={inputError === null ? undefined : 'what-if-value-error'}
                value={value}
                onChange={(event) => {
                  applyKeyRef.current.clear();
                  setValue(event.target.value);
                  preview.reset();
                  setInputError(null);
                }}
              />
            </span>
            {inputError !== null && (
              <span className="field-error" id="what-if-value-error" role="alert">
                {inputError}
              </span>
            )}
          </label>
        )}
        {dimension === 'MISSED_CONTRIBUTION' && (
          <p className="scenario-note">
            Model one missed contribution on {formatDate(nextContributionDate)}. This preview does
            not change the active plan.
          </p>
        )}
      </div>
      {dimension === 'MISSED_CONTRIBUTION' && inputError !== null && (
        <p className="field-error" role="alert">
          {inputError}
        </p>
      )}
      <button
        className="secondary-button"
        type="button"
        disabled={preview.isPending}
        onClick={previewChange}
      >
        {preview.isPending ? 'Comparing…' : 'Preview one change'}
      </button>
      {preview.error !== null && (
        <UnavailableFeature error={preview.error} label="What-If preview" />
      )}
      {preview.data !== undefined && (
        <div className="comparison-grid" aria-live="polite">
          <ComparisonColumn label="Current" summary={preview.data.comparison.current} />
          <ChevronRight aria-hidden="true" />
          <ComparisonColumn label="Proposed" summary={preview.data.comparison.proposed} />
          <dl className="comparison-deltas">
            <div>
              <dt>Personal contributions</dt>
              <dd>{formatSignedMoney(preview.data.comparison.personalContributionChangeCents)}</dd>
            </div>
            <div>
              <dt>Modeled interest</dt>
              <dd>{formatSignedMoney(preview.data.comparison.modeledInterestChangeCents)}</dd>
            </div>
            <div>
              <dt>Target-date balance</dt>
              <dd>{formatSignedMoney(preview.data.comparison.targetDateBalanceChangeCents)}</dd>
            </div>
            <div>
              <dt>Cushion</dt>
              <dd>{formatSignedMoney(preview.data.comparison.cushionChangeCents)}</dd>
            </div>
          </dl>
          <details className="comparison-rationale">
            <summary>Why the proposed outcome changes</summary>
            <ul>
              {preview.data.comparison.proposed.rationaleCodes.map((code) => (
                <li key={code}>{planRationaleCopy[code]}</li>
              ))}
            </ul>
          </details>
          <div className="comparison-actions">
            <p>{accessConsequenceCopy[preview.data.comparison.accessConsequence]}</p>
            <button
              className="button"
              type="button"
              disabled={apply.isPending}
              onClick={() => apply.mutate()}
            >
              {apply.isPending ? 'Applying…' : 'Apply as new version'}
            </button>
          </div>
        </div>
      )}
      {apply.error !== null && <UnavailableFeature error={apply.error} label="Apply scenario" />}
      {message !== null && (
        <p className="alert alert-success" role="status">
          {message}
        </p>
      )}
    </section>
  );
}

function ComparisonColumn({
  label,
  summary,
}: {
  readonly label: string;
  readonly summary: PlanDecisionSummary;
}): React.JSX.Element {
  return (
    <article>
      <span>{label}</span>
      <strong>{formatMoney(summary.chosenContributionCents)}</strong>
      <small>
        {formatDate(summary.projectedReadinessDate)} · {planHealthCopy[summary.health]}
      </small>
      <small>{vehicleCopy[summary.vehicleCode]}</small>
      <p>
        {summary.shortfallCents > 0
          ? `${formatMoney(summary.shortfallCents)} shortfall`
          : `${formatMoney(summary.cushionCents)} cushion`}
      </p>
    </article>
  );
}

function RecoveryPlanner({
  goal,
  currentPlanVersion,
  health,
  options,
  loading,
  error,
  demo,
  onApplied,
}: {
  readonly goal: GoalDto;
  readonly currentPlanVersion: number;
  readonly health: string | null;
  readonly options: readonly RecoveryOption[];
  readonly loading: boolean;
  readonly error: unknown;
  readonly demo: boolean;
  readonly onApplied: () => Promise<void>;
}): React.JSX.Element {
  const [message, setMessage] = useState<string | null>(null);
  const applyKeyRef = useRef(new LogicalMutationKey());
  const apply = useMutation({
    mutationFn: (option: Extract<RecoveryOption, { availability: 'available' }>) => {
      const input = {
        expectedGoalVersion: goal.version,
        expectedPlanVersion: currentPlanVersion,
        change: option.change,
      };
      return api.applyRecovery(
        goal.id,
        input,
        applyKeyRef.current.keyFor({ goalId: goal.id, ...input }),
      );
    },
    onSuccess: async (_, option) => {
      applyKeyRef.current.clear();
      trackProductEvent({
        eventName: 'recovery_option_applied',
        changedDimension: option.change.changedDimension,
        demo,
        applicationVersion: 'product-experience-v1',
      });
      setMessage('Recovery applied as a new immutable plan version.');
      await onApplied();
    },
  });
  return (
    <section className="experience-card" aria-labelledby="recovery-title">
      <div className="card-heading-row">
        <div>
          <p className="eyebrow">Recovery Planner</p>
          <h2 id="recovery-title">A bounded route back—without more risk.</h2>
        </div>
        <ShieldCheck aria-hidden="true" />
      </div>
      {loading ? (
        <p className="muted" aria-busy="true">
          Checking conservative recovery options…
        </p>
      ) : error !== null ? (
        <UnavailableFeature error={error} label="Recovery Planner" />
      ) : health !== 'ATTENTION_NEEDED' ? (
        <p className="muted">Recovery options appear only when the plan needs attention.</p>
      ) : options.length === 0 ? (
        <p className="muted">No policy-valid recovery option is available.</p>
      ) : (
        <ol className="recovery-list">
          {options.map((option) => (
            <li key={option.optionType}>
              <span>{option.order}</span>
              <div>
                <strong>{recoveryOptionCopy[option.optionType]}</strong>
                {option.availability === 'available' ? (
                  <>
                    <p>{describeScenarioChange(option.change)}</p>
                    <dl className="recovery-deltas">
                      <div>
                        <dt>Personal contributions</dt>
                        <dd>{formatSignedMoney(option.personalContributionChangeCents)}</dd>
                      </div>
                      <div>
                        <dt>Modeled interest</dt>
                        <dd>{formatSignedMoney(option.modeledInterestChangeCents)}</dd>
                      </div>
                    </dl>
                    <p>{describeRecoveryRationale(option)}</p>
                    <p>
                      Projected readiness {formatDate(option.projectedReadinessDate)} ·{' '}
                      {planHealthCopy[option.resultingHealth]}
                    </p>
                  </>
                ) : (
                  <p>Unavailable: {describeUnavailableRecovery(option)}</p>
                )}
              </div>
              {option.availability === 'available' && (
                <button
                  className="secondary-button"
                  type="button"
                  disabled={apply.isPending}
                  onClick={() => apply.mutate(option)}
                >
                  Apply
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
      {apply.error !== null && <UnavailableFeature error={apply.error} label="Recovery apply" />}
      {message !== null && (
        <p className="alert alert-success" role="status">
          {message}
        </p>
      )}
    </section>
  );
}

function AutopilotPanel({
  goal,
  applicationDate,
  enabled,
  capabilityLoading,
  demo,
  onAdvanced,
}: {
  readonly goal: GoalDto;
  readonly applicationDate: string;
  readonly enabled: boolean;
  readonly capabilityLoading: boolean;
  readonly demo: boolean;
  readonly onAdvanced: () => Promise<void>;
}): React.JSX.Element {
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof api.advanceDemo>> | null>(null);
  const [resetConfirmationOpen, setResetConfirmationOpen] = useState(false);
  const resetTriggerRef = useRef<HTMLButtonElement>(null);
  const resetCancelRef = useRef<HTMLButtonElement>(null);
  const resetConfirmRef = useRef<HTMLButtonElement>(null);
  const resetConfirmationWasOpenRef = useRef(false);
  const resetKeyRef = useRef<string | null>(null);
  const advanceKeyRef = useRef<{ readonly milestone: DemoMilestone; readonly key: string } | null>(
    null,
  );
  const advance = useMutation({
    mutationFn: (milestone: DemoMilestone) => {
      if (advanceKeyRef.current?.milestone !== milestone)
        advanceKeyRef.current = { milestone, key: crypto.randomUUID() };
      return api.advanceDemo({ goalId: goal.id, milestone }, advanceKeyRef.current.key);
    },
    onSuccess: async (result) => {
      advanceKeyRef.current = null;
      trackProductEvent({
        eventName: 'autopilot_advanced',
        demo,
        applicationVersion: 'product-experience-v1',
      });
      await onAdvanced();
      setSummary(result);
    },
  });
  const reset = useMutation({
    mutationFn: () => {
      resetKeyRef.current ??= crypto.randomUUID();
      return api.resetDemo(
        {
          goalId: goal.id,
          expectedGoalVersion: goal.version,
          confirmation: 'RESET_SEEDED_STORY_DEMO',
        },
        resetKeyRef.current,
      );
    },
    onSuccess: async () => {
      resetKeyRef.current = null;
      setResetConfirmationOpen(false);
      setSummary(null);
      await onAdvanced();
    },
  });
  useEffect(() => {
    if (resetConfirmationOpen) {
      resetConfirmationWasOpenRef.current = true;
      resetConfirmRef.current?.focus();
    } else if (resetConfirmationWasOpenRef.current) {
      resetConfirmationWasOpenRef.current = false;
      resetTriggerRef.current?.focus();
    }
  }, [resetConfirmationOpen]);
  const controls: readonly [DemoMilestone, string][] = [
    ['NEXT_CONTRIBUTION', 'Next contribution'],
    ['ONE_MONTH', 'One month'],
    ['SIX_MONTHS', 'Six months'],
    ['NEXT_MATURITY', 'Next maturity'],
    ['TARGET_DATE', 'Target date'],
  ];
  return (
    <section className="experience-card autopilot" aria-labelledby="autopilot-title">
      <div className="card-heading-row">
        <div>
          <p className="eyebrow">Story-Mode Autopilot</p>
          <h2 id="autopilot-title">Preview how your simulated plan changes over time.</h2>
        </div>
        <CalendarClock aria-hidden="true" />
      </div>
      {capabilityLoading ? (
        <p className="muted">Checking local demo capability…</p>
      ) : !enabled ? (
        <p className="muted">Story mode is disabled in this local run.</p>
      ) : (
        <>
          <p>
            Application date: <strong>{formatDate(summary?.toDate ?? applicationDate)}</strong>
          </p>
          <div className="autopilot-controls">
            {controls.map(([milestone, label]) => (
              <button
                className="secondary-button"
                type="button"
                key={milestone}
                disabled={advance.isPending || reset.isPending}
                onClick={() => advance.mutate(milestone)}
              >
                {label}
              </button>
            ))}
            <button
              ref={resetTriggerRef}
              className="text-button"
              type="button"
              disabled={advance.isPending || reset.isPending}
              onClick={() => setResetConfirmationOpen(true)}
            >
              <RotateCcw aria-hidden="true" size={16} /> Reset fixture
            </button>
          </div>
          {resetConfirmationOpen && (
            <div
              className="reset-confirmation"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="reset-confirmation-title"
              aria-describedby="reset-confirmation-description"
              onKeyDown={(event) => {
                if (event.key === 'Escape' && !reset.isPending) {
                  event.preventDefault();
                  resetKeyRef.current = null;
                  setResetConfirmationOpen(false);
                  return;
                }
                if (event.key !== 'Tab' || reset.isPending) return;
                if (event.shiftKey && document.activeElement === resetCancelRef.current) {
                  event.preventDefault();
                  resetConfirmRef.current?.focus();
                } else if (!event.shiftKey && document.activeElement === resetConfirmRef.current) {
                  event.preventDefault();
                  resetCancelRef.current?.focus();
                }
              }}
            >
              <strong id="reset-confirmation-title">Reset the seeded Story Demo?</strong>
              <p id="reset-confirmation-description">
                This replaces this fixture owner's plan versions, activity, controlled date, and
                Timing Lab runs with the original synthetic seed. Other users are not changed.
              </p>
              <div className="reset-confirmation-actions">
                <button
                  ref={resetCancelRef}
                  className="text-button"
                  type="button"
                  disabled={reset.isPending}
                  onClick={() => {
                    resetKeyRef.current = null;
                    setResetConfirmationOpen(false);
                  }}
                >
                  Cancel
                </button>
                <button
                  ref={resetConfirmRef}
                  className="danger-button"
                  type="button"
                  disabled={reset.isPending}
                  onClick={() => reset.mutate()}
                >
                  {reset.isPending ? 'Resetting seeded demo...' : 'Reset seeded Story Demo'}
                </button>
              </div>
            </div>
          )}
          {summary !== null && (
            <div className="autopilot-summary" role="status">
              <strong>
                Advanced {formatDate(summary.fromDate)} to {formatDate(summary.toDate)}
              </strong>
              <span>
                {summary.contributionsPosted} contributions ·{' '}
                {formatMoney(summary.modeledInterestAddedCents)} modeled interest added ·{' '}
                {summary.interestPostings} interest postings · health{' '}
                {planHealthCopy[summary.health]}
              </span>
              {summary.failureCodes.length > 0 && (
                <span>
                  Notes: {summary.failureCodes.map((code) => demoFailureCopy[code]).join(', ')}
                </span>
              )}
            </div>
          )}
          {(advance.error ?? reset.error) !== null && (
            <UnavailableFeature error={advance.error ?? reset.error} label="Story-Mode Autopilot" />
          )}
        </>
      )}
    </section>
  );
}

function TimingLabPanel({
  goalId,
  enabled,
  capabilityLoading,
  demo,
  readOnly,
}: {
  readonly goalId: string;
  readonly enabled: boolean;
  readonly capabilityLoading: boolean;
  readonly demo: boolean;
  readonly readOnly: boolean;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const viewedRef = useRef(false);
  const runCheckKeyRef = useRef(new LogicalMutationKey());
  const timing = useQuery({
    queryKey: ['timing-lab', goalId],
    queryFn: () => api.timingLabLatest(goalId),
    enabled,
    retry: false,
  });
  const runCheck = useMutation({
    mutationFn: () =>
      api.runDuePriceChecks(runCheckKeyRef.current.keyFor({ operation: 'run-due-price-checks' })),
    onSuccess: async () => {
      runCheckKeyRef.current.clear();
      await queryClient.invalidateQueries({ queryKey: ['timing-lab', goalId] });
    },
  });
  useEffect(() => {
    if (!enabled || timing.data === undefined || viewedRef.current) return;
    viewedRef.current = true;
    trackProductEvent({
      eventName: 'purchase_timing_viewed',
      demo,
      applicationVersion: 'product-experience-v1',
    });
  }, [demo, enabled, timing.data]);
  if (capabilityLoading)
    return (
      <section className="experience-card">
        <p className="muted">Checking GoalPilot Plus availability…</p>
      </section>
    );
  if (!enabled)
    return (
      <section className="experience-card premium-card">
        <p className="eyebrow">GoalPilot Plus</p>
        <h2>Purchase Timing Lab is disabled.</h2>
        <p>Enable the explicit local demo feature to explore synthetic historical prices.</p>
      </section>
    );
  return (
    <section className="experience-card premium-card" aria-labelledby="timing-title">
      <div className="card-heading-row">
        <div>
          <p className="eyebrow">GoalPilot Plus · Premium preview</p>
          <h2 id="timing-title">Purchase Timing Lab</h2>
        </div>
        <Sparkles aria-hidden="true" />
      </div>
      {readOnly ? (
        <p className="muted">
          Historical assessment is read-only for a completed or archived plan.
        </p>
      ) : (
        <div className="timing-run-controls">
          <button
            className="secondary-button"
            type="button"
            disabled={runCheck.isPending}
            onClick={() => runCheck.mutate()}
          >
            {runCheck.isPending
              ? 'Running fixture price check...'
              : 'Run due price check (fixture only)'}
          </button>
          <p className="muted">Uses the allowlisted synthetic history; no retailer is contacted.</p>
        </div>
      )}
      {runCheck.data !== undefined && (
        <div className="autopilot-summary" role="status">
          <strong>
            Price check {priceCheckStatusCopy[runCheck.data.status]} for{' '}
            {formatDate(runCheck.data.asOfDate)}.
          </strong>
          <span>
            {runCheck.data.completedRunCount} completed · {runCheck.data.inProgressRunCount} in
            progress · {runCheck.data.replayedRunCount} replayed · {runCheck.data.failedRunCount}{' '}
            failed
          </span>
          {runCheck.data.errorCodes.length > 0 && (
            <span>
              Notes: {runCheck.data.errorCodes.map((code) => priceCheckErrorCopy[code]).join(' ')}
            </span>
          )}
        </div>
      )}
      {runCheck.error !== null && (
        <UnavailableFeature error={runCheck.error} label="Fixture price check" />
      )}
      {timing.isPending ? (
        <p className="muted" aria-busy="true">
          Loading historical demo prices…
        </p>
      ) : timing.data === undefined ? (
        <UnavailableFeature error={timing.error} label="Purchase Timing Lab" />
      ) : timing.data.assessment === null ? (
        <div className="empty-inline">
          <strong>No assessment yet</strong>
          <p>The fixture-backed routine has not produced a historical assessment.</p>
        </div>
      ) : (
        <>
          {timing.data.assessment.assessedTargetPriceCents !==
            timing.data.item.targetPriceCents && (
            <div className="alert alert-warning" role="status">
              This assessment used a target of{' '}
              {formatMoney(timing.data.assessment.assessedTargetPriceCents)}. The item target is now{' '}
              {formatMoney(timing.data.item.targetPriceCents)}, so this immutable assessment is
              stale for the current target.
            </div>
          )}
          <div className="timing-state">
            <span>{purchaseTimingStateCopy[timing.data.assessment.state]}</span>
            <strong>{formatMoney(timing.data.assessment.statistics.currentPriceCents)}</strong>
            <small>
              Assessed target {formatMoney(timing.data.assessment.assessedTargetPriceCents)}
            </small>
          </div>
          <dl className="timing-stats">
            <div>
              <dt>Historical range</dt>
              <dd>
                {formatMoney(timing.data.assessment.statistics.minimumPriceCents)}–
                {formatMoney(timing.data.assessment.statistics.maximumPriceCents)}
              </dd>
            </div>
            <div>
              <dt>Median</dt>
              <dd>{formatMoney(timing.data.assessment.statistics.medianPriceCents)}</dd>
            </div>
            <div>
              <dt>Empirical percentile</dt>
              <dd>
                {(timing.data.assessment.statistics.empiricalPercentileBasisPoints / 100).toFixed(
                  1,
                )}
                %
              </dd>
            </div>
            <div>
              <dt>Observations</dt>
              <dd>
                {timing.data.assessment.statistics.observationCount} over{' '}
                {timing.data.assessment.statistics.observationSpanDays} days
              </dd>
            </div>
            <div>
              <dt>Freshness</dt>
              <dd>{timing.data.assessment.statistics.freshnessDays} days</dd>
            </div>
            <div>
              <dt>Plan readiness</dt>
              <dd>
                {timing.data.assessment.planHealth === null
                  ? 'No active plan'
                  : planHealthCopy[timing.data.assessment.planHealth]}
              </dd>
            </div>
            <div>
              <dt>Plan lifecycle at assessment</dt>
              <dd>{goalStatusCopy[timing.data.assessment.planLifecycle]}</dd>
            </div>
          </dl>
          {timing.data.assessment.seasonal !== null && (
            <SeasonalMedianChart months={timing.data.assessment.seasonal.months} />
          )}
          {timing.data.series !== null && (
            <details className="timing-provenance">
              <summary>Historical source and replay provenance</summary>
              <dl className="detail-list">
                <div>
                  <dt>Fixture</dt>
                  <dd>{timing.data.series.displayDescriptor}</dd>
                </div>
                <div>
                  <dt>Source type</dt>
                  <dd>Deterministic synthetic fixture</dd>
                </div>
                <div>
                  <dt>Source version</dt>
                  <dd>{timing.data.series.sourceVersion}</dd>
                </div>
                <div>
                  <dt>Series as of</dt>
                  <dd>{formatDate(timing.data.series.asOfDate)}</dd>
                </div>
                <div>
                  <dt>Exact observations</dt>
                  <dd>{timing.data.series.observations.length}</dd>
                </div>
                <div>
                  <dt>Replay checksum</dt>
                  <dd className="checksum">{timing.data.series.sourceChecksum}</dd>
                </div>
              </dl>
              <p className="microcopy">
                Demo data only. The version and checksum identify the exact historical fixture used
                for this assessment; they are not retailer or market data.
              </p>
            </details>
          )}
        </>
      )}
      <div className="disclosure timing-disclosure">
        <p>
          <strong>Historical demo data, not a live retailer feed.</strong> Historical patterns do
          not predict future prices. This view cannot change your Simulated Goal Plan.
        </p>
      </div>
    </section>
  );
}

const monthLabels = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

function SeasonalMedianChart({
  months,
}: {
  readonly months: readonly {
    readonly month: number;
    readonly observationCount: number;
    readonly medianPriceCents: number;
  }[];
}): React.JSX.Element {
  const medians = months.map((month) => month.medianPriceCents);
  const minimum = Math.min(...medians);
  const maximum = Math.max(...medians);
  const range = maximum - minimum;
  return (
    <section className="timing-seasonal" aria-labelledby="seasonal-median-title">
      <div>
        <p className="eyebrow">Two-year seasonal detail</p>
        <h3 id="seasonal-median-title">Historical median by month</h3>
        <p className="muted">Descriptive synthetic history only; it is not a forecast.</p>
      </div>
      <div className="seasonal-chart" aria-hidden="true">
        {months.map((month) => {
          const height = range === 0 ? 70 : 25 + ((month.medianPriceCents - minimum) / range) * 75;
          return (
            <span className="seasonal-column" key={month.month}>
              <span className="seasonal-bar" style={{ height: `${String(height)}%` }} />
              <small>{monthLabels[month.month - 1]?.slice(0, 3)}</small>
            </span>
          );
        })}
      </div>
      <div
        className="activity-table-wrap seasonal-table-wrap"
        tabIndex={0}
        aria-label="Scrollable monthly historical median price data"
      >
        <table>
          <caption>Monthly historical median price data</caption>
          <thead>
            <tr>
              <th scope="col">Month</th>
              <th scope="col">Observations</th>
              <th scope="col">Median</th>
            </tr>
          </thead>
          <tbody>
            {months.map((month) => (
              <tr key={month.month}>
                <th scope="row">{monthLabels[month.month - 1]}</th>
                <td>{month.observationCount}</td>
                <td>{formatMoney(month.medianPriceCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function UnavailableFeature({
  error,
  label,
}: {
  readonly error: unknown;
  readonly label: string;
}): React.JSX.Element {
  const unavailable = error instanceof ApiClientError && error.status === 404;
  return (
    <div className="inline-state" role="status">
      <strong>
        {unavailable ? `${label} is not enabled in this local build.` : `${label} could not load.`}
      </strong>
      {error instanceof Error && !unavailable && <span>{error.message}</span>}
    </div>
  );
}
