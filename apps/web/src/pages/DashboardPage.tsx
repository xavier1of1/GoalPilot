import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  CheckCircle2,
  CirclePause,
  CirclePlay,
  Download,
  History,
  Plus,
  Target,
  Trash2,
  TrendingUp,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';

import { api, ApiClientError } from '../api.js';
import { Disclosure } from '../components/Disclosure.js';
import { dollarsToCents, formatDate, formatMoney, formatRate } from '../format.js';

export function DashboardPage(): React.JSX.Element {
  const [search, setSearch] = useSearchParams();
  const queryClient = useQueryClient();
  const goalsQuery = useQuery({ queryKey: ['goals'], queryFn: api.goals });
  const selectedGoal =
    goalsQuery.data?.goals.find((goal) => goal.id === search.get('goal')) ??
    goalsQuery.data?.goals.find((goal) =>
      ['active', 'paused', 'purchase_ready'].includes(goal.status),
    ) ??
    goalsQuery.data?.goals[0];
  const detailQuery = useQuery({
    queryKey: ['goal', selectedGoal?.id],
    queryFn: () => api.goal(selectedGoal?.id ?? ''),
    enabled: selectedGoal !== undefined,
  });
  const activityQuery = useQuery({
    queryKey: ['activity', selectedGoal?.id],
    queryFn: () => api.activity(selectedGoal?.id ?? ''),
    enabled: selectedGoal !== undefined && detailQuery.data?.account !== null,
  });
  const [amount, setAmount] = useState('100');
  const [effectiveDate, setEffectiveDate] = useState('2026-08-23');
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [contributionError, setContributionError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const contributionKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (detailQuery.data?.applicationDate !== undefined)
      setEffectiveDate(detailQuery.data.applicationDate);
  }, [detailQuery.data?.applicationDate]);
  useEffect(() => {
    contributionKeyRef.current = null;
  }, [amount, effectiveDate, selectedGoal?.id]);
  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['goals'] });
    await queryClient.invalidateQueries({ queryKey: ['goal', selectedGoal?.id] });
    await queryClient.invalidateQueries({ queryKey: ['activity', selectedGoal?.id] });
  };
  const actionMutation = useMutation({
    mutationFn: async (action: 'pause' | 'resume' | 'complete' | 'archive') => {
      if (selectedGoal === undefined) throw new Error('No goal selected.');
      return api.action(selectedGoal.id, action);
    },
    onSuccess: async (_, action) => {
      setActionMessage(
        action === 'pause'
          ? 'Recurring simulation paused.'
          : action === 'resume'
            ? 'Recurring simulation resumed.'
            : action === 'complete'
              ? 'Goal completed and retained in your history.'
              : 'Goal archived in your local history.',
      );
      await refresh();
    },
  });
  const contributionMutation = useMutation({
    mutationFn: async () => {
      if (selectedGoal === undefined) throw new Error('No goal selected.');
      contributionKeyRef.current ??= crypto.randomUUID();
      return api.contribute(
        selectedGoal.id,
        dollarsToCents(amount),
        effectiveDate,
        contributionKeyRef.current,
      );
    },
    onSuccess: async () => {
      contributionKeyRef.current = null;
      setContributionError(null);
      setActionMessage('Your simulated contribution posted successfully.');
      dialogRef.current?.close();
      await refresh();
    },
    onError: (mutationError) => {
      setContributionError(
        mutationError instanceof Error
          ? mutationError.message
          : 'The simulated contribution could not be posted.',
      );
      requestAnimationFrame(() => amountRef.current?.focus());
    },
  });
  const error = [
    goalsQuery.error,
    detailQuery.error,
    activityQuery.error,
    actionMutation.error,
  ].find((value): value is Error => value instanceof Error);

  if (goalsQuery.isPending) return <DashboardSkeleton />;
  if (goalsQuery.data?.goals.length === 0) return <EmptyDashboard />;
  if (detailQuery.isPending) return <DashboardSkeleton />;
  const detail = detailQuery.data;
  const account = detail?.account;
  const lifetimeFundingCents =
    (account?.principalContributedCents ?? 0) + (account?.interestEarnedCents ?? 0);

  return (
    <section className="dashboard-shell">
      <div className="dashboard-heading">
        <div>
          <p className="eyebrow">Your dashboard</p>
          <h1>{selectedGoal?.name ?? 'Your savings plan'}</h1>
          <p className="muted">A current view of your simulated route and its assumptions.</p>
        </div>
        {account?.status === 'active' && (
          <button
            className="button"
            type="button"
            onClick={() => {
              setContributionError(null);
              dialogRef.current?.showModal();
            }}
          >
            <Plus aria-hidden="true" size={18} /> Add simulated contribution
          </button>
        )}
      </div>

      {(goalsQuery.data?.goals.length ?? 0) > 1 && (
        <label className="goal-selector">
          View goal
          <select
            value={selectedGoal?.id}
            onChange={(event) => setSearch({ goal: event.target.value })}
          >
            {goalsQuery.data?.goals.map((goal) => (
              <option key={goal.id} value={goal.id}>
                {goal.name} · {goal.status.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </label>
      )}

      {actionMessage !== null && (
        <div className="alert alert-success" role="status">
          <CheckCircle2 aria-hidden="true" /> {actionMessage}
        </div>
      )}
      {error !== undefined && (
        <div className="alert alert-error" role="alert">
          <strong>We couldn’t refresh this plan.</strong> {error.message}{' '}
          {error instanceof ApiClientError && (
            <span className="request-id">Reference {error.requestId}</span>
          )}
        </div>
      )}

      {account === null || account === undefined ? (
        <article className="empty-state">
          <Target aria-hidden="true" />
          <h2>This goal has not been activated yet.</h2>
          <p>Return to the planner to compare eligible illustrative routes.</p>
          <Link className="button" to="/plan">
            Compare routes <ArrowRight aria-hidden="true" size={18} />
          </Link>
        </article>
      ) : (
        <>
          <div className="dashboard-grid">
            <article className="progress-card">
              <div className="card-heading-row">
                <div>
                  <p className="eyebrow">Current simulated balance</p>
                  <p className="dashboard-balance">
                    {formatMoney(account.currentLedgerBalanceCents)}
                  </p>
                  <p className="muted">
                    of{' '}
                    {formatMoney(
                      detail?.goal.targetAmountCents ?? selectedGoal?.targetAmountCents ?? 0,
                    )}
                  </p>
                </div>
                <span className={`status-pill ${account.status}`}>
                  {account.status.replace('_', ' ')}
                </span>
              </div>
              <div
                className="progress-track large"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={account.progressPercent}
                aria-label={`${String(account.progressPercent)} percent of goal funded`}
              >
                <span style={{ width: `${String(account.progressPercent)}%` }} />
              </div>
              <p className="progress-label">{account.progressPercent}% funded</p>
              <dl className="metric-grid dashboard-metrics">
                <div>
                  <dt>Principal</dt>
                  <dd>{formatMoney(account.principalContributedCents)}</dd>
                </div>
                <div>
                  <dt>Modeled interest</dt>
                  <dd>{formatMoney(account.interestEarnedCents)}</dd>
                </div>
                <div>
                  <dt>Next contribution</dt>
                  <dd>{formatDate(account.nextContributionDate)}</dd>
                </div>
                <div>
                  <dt>Projected completion</dt>
                  <dd>{formatDate(account.projectedCompletionDate)}</dd>
                </div>
              </dl>
            </article>

            <article className="assumption-card">
              <div className="card-icon">
                <TrendingUp aria-hidden="true" />
              </div>
              <p className="eyebrow">Selected route</p>
              <h2>{account.vehicleCode.replaceAll('_', ' ')}</h2>
              <p className="rate">{formatRate(account.currentIllustrativeApyBasisPoints)}</p>
              <p className="microcopy">Illustrative rate, not a live offer.</p>
              {account.assumptionIsStale && (
                <div className="alert alert-warning" role="status">
                  <strong>Review recommended.</strong> This active plan keeps its historical
                  assumption from {formatDate(account.assumptionReviewedDate)} for reproducibility;
                  it is not a current rate.
                </div>
              )}
              <dl className="assumption-list">
                <div>
                  <dt>Assumption version</dt>
                  <dd>{account.assumptionVersion}</dd>
                </div>
                <div>
                  <dt>Availability</dt>
                  <dd>{formatMoney(account.availableBalanceCents)}</dd>
                </div>
                <div>
                  <dt>Pending</dt>
                  <dd>{formatMoney(account.pendingContributionCents)}</dd>
                </div>
              </dl>
            </article>
          </div>

          <article className="chart-card">
            <div className="card-heading-row">
              <div>
                <p className="eyebrow">Lifetime funding composition</p>
                <h2>Principal stays distinct from modeled interest.</h2>
              </div>
            </div>
            <div className="chart-layout">
              <div className="composition-chart" aria-hidden="true">
                <span
                  className="composition-principal"
                  style={{
                    width: `${String(lifetimeFundingCents === 0 ? 0 : (account.principalContributedCents / lifetimeFundingCents) * 100)}%`,
                  }}
                />
                <span className="composition-interest" />
              </div>
              <p className="sr-only">
                Lifetime funding is {formatMoney(lifetimeFundingCents)}:{' '}
                {formatMoney(account.principalContributedCents)} principal and{' '}
                {formatMoney(account.interestEarnedCents)} modeled interest.
              </p>
            </div>
          </article>

          <article className="activity-card">
            <div className="card-heading-row">
              <div>
                <p className="eyebrow">Account activity</p>
                <h2>An append-only history of the simulation.</h2>
              </div>
              <History aria-hidden="true" />
            </div>
            {activityQuery.isPending ? (
              <p className="muted">Loading account activity…</p>
            ) : activityQuery.data?.activity.length === 0 ? (
              <p className="muted">Activity will appear after activation or a contribution.</p>
            ) : (
              <div className="activity-table-wrap">
                <table>
                  <caption className="sr-only">Simulated account activity</caption>
                  <thead>
                    <tr>
                      <th>Activity</th>
                      <th>Date</th>
                      <th>Principal</th>
                      <th>Interest</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activityQuery.data?.activity.map((entry) => (
                      <tr key={entry.id}>
                        <td>
                          <strong>{entry.description}</strong>
                          <span>{entry.type.replaceAll('_', ' ')}</span>
                        </td>
                        <td>{formatDate(entry.effectiveDate)}</td>
                        <td>
                          {entry.principalCents === 0 ? '—' : formatMoney(entry.principalCents)}
                        </td>
                        <td>
                          {entry.interestCents === 0 ? '—' : formatMoney(entry.interestCents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </article>

          <div className="plan-actions">
            {account.status === 'active' && (
              <button
                className="secondary-button"
                type="button"
                disabled={actionMutation.isPending}
                onClick={() => actionMutation.mutate('pause')}
              >
                <CirclePause aria-hidden="true" /> Pause simulation
              </button>
            )}
            {account.status === 'paused' && (
              <button
                className="secondary-button"
                type="button"
                disabled={actionMutation.isPending}
                onClick={() => actionMutation.mutate('resume')}
              >
                <CirclePlay aria-hidden="true" /> Resume simulation
              </button>
            )}
            {account.status === 'purchase_ready' && (
              <button
                className="button"
                type="button"
                disabled={actionMutation.isPending}
                onClick={() => actionMutation.mutate('complete')}
              >
                <CheckCircle2 aria-hidden="true" /> Mark purchase complete
              </button>
            )}
            {account.status === 'completed' && selectedGoal?.status === 'completed' && (
              <button
                className="secondary-button"
                type="button"
                disabled={actionMutation.isPending}
                onClick={() => actionMutation.mutate('archive')}
              >
                Archive goal
              </button>
            )}
          </div>
          <Disclosure />
        </>
      )}

      <DataControls />
      <dialog ref={dialogRef} className="dialog" aria-labelledby="contribution-title">
        <form method="dialog" onSubmit={(event) => event.preventDefault()}>
          <p className="eyebrow">Simulation only</p>
          <h2 id="contribution-title">Add a simulated contribution</h2>
          <p>No money will move. This adds an auditable entry to the local ledger.</p>
          <label htmlFor="contribution-amount">
            Amount
            <span className="input-prefix">
              <span aria-hidden="true">$</span>
              <input
                id="contribution-amount"
                ref={amountRef}
                value={amount}
                inputMode="decimal"
                aria-invalid={contributionError === null ? undefined : true}
                aria-describedby={contributionError === null ? undefined : 'contribution-error'}
                onChange={(event) => {
                  setAmount(event.target.value);
                  setContributionError(null);
                }}
              />
            </span>
          </label>
          {contributionError !== null && (
            <p className="field-error" id="contribution-error" role="alert">
              {contributionError}
            </p>
          )}
          <label htmlFor="contribution-effective-date">
            Effective date
            <input id="contribution-effective-date" type="date" value={effectiveDate} readOnly />
          </label>
          <div className="dialog-actions">
            <button
              className="text-button"
              type="button"
              onClick={() => dialogRef.current?.close()}
            >
              Cancel
            </button>
            <button
              className="button"
              type="button"
              disabled={contributionMutation.isPending}
              onClick={() => {
                try {
                  const amountCents = dollarsToCents(amount);
                  if (amountCents < 1 || amountCents > 100_000_000)
                    throw new Error('Enter an amount between $0.01 and $1,000,000.');
                  setContributionError(null);
                  contributionMutation.mutate();
                } catch (validationError) {
                  setContributionError(
                    validationError instanceof Error
                      ? validationError.message
                      : 'Enter a valid dollar amount.',
                  );
                  requestAnimationFrame(() => amountRef.current?.focus());
                }
              }}
            >
              {contributionMutation.isPending ? 'Posting…' : 'Post simulated contribution'}
            </button>
          </div>
        </form>
      </dialog>
    </section>
  );
}

function EmptyDashboard(): React.JSX.Element {
  return (
    <section className="dashboard-shell">
      <article className="empty-state spacious">
        <Target aria-hidden="true" />
        <p className="eyebrow">Your dashboard</p>
        <h1>Ready when you are.</h1>
        <p>Create a goal to see the contribution baseline and compare four illustrative routes.</p>
        <Link className="button" to="/plan">
          Build my first plan <ArrowRight aria-hidden="true" size={18} />
        </Link>
      </article>
    </section>
  );
}

function DashboardSkeleton(): React.JSX.Element {
  return (
    <section className="dashboard-shell" aria-busy="true" aria-label="Loading dashboard">
      <div className="skeleton skeleton-title" />
      <div className="dashboard-grid">
        <div className="skeleton skeleton-card" />
        <div className="skeleton skeleton-card" />
      </div>
      <span className="sr-only">Loading your GoalPilot dashboard.</span>
    </section>
  );
}

function DataControls(): React.JSX.Element {
  const [message, setMessage] = useState<string | null>(null);
  const exportMutation = useMutation({
    mutationFn: api.exportData,
    onSuccess: (value) => {
      const href = URL.createObjectURL(
        new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
      );
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.download = 'goalpilot-export.json';
      anchor.click();
      URL.revokeObjectURL(href);
      setMessage('Your GoalPilot data export was created.');
    },
  });
  const deletionMutation = useMutation({
    mutationFn: api.deleteAccount,
    onSuccess: () => window.location.assign('/'),
  });
  const error = [exportMutation.error, deletionMutation.error].find(
    (value): value is Error => value instanceof Error,
  );
  return (
    <section className="data-controls" aria-labelledby="data-controls-title">
      <div>
        <p className="eyebrow">Your local data</p>
        <h2 id="data-controls-title">Export or delete your profile</h2>
        <p>
          Exports include only your goals, plans, and activity. Deletion signs out every local
          session.
        </p>
      </div>
      <div className="data-actions">
        <button
          className="secondary-button"
          type="button"
          disabled={exportMutation.isPending || deletionMutation.isPending}
          onClick={() => exportMutation.mutate()}
        >
          <Download aria-hidden="true" /> Export JSON
        </button>
        <button
          className="danger-button"
          type="button"
          disabled={exportMutation.isPending || deletionMutation.isPending}
          onClick={() => {
            if (
              window.confirm(
                'Permanently delete this local profile and all financial simulation data?',
              )
            )
              deletionMutation.mutate();
          }}
        >
          <Trash2 aria-hidden="true" /> Delete profile
        </button>
      </div>
      {message !== null && <p role="status">{message}</p>}
      {error !== undefined && (
        <p className="field-error" role="alert">
          The data request could not be completed. {error.message}
        </p>
      )}
    </section>
  );
}
