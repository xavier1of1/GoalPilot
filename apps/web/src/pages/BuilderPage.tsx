import { useMutation } from '@tanstack/react-query';
import { ArrowRight, Check, Clock3, Lock, Sparkles, WalletCards, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router';

import type { GoalInput, PreviewOutput, UserDto, VehicleCode } from '@goalpilot/contracts';

import { api, ApiClientError } from '../api.js';
import { Disclosure } from '../components/Disclosure.js';
import { dollarsToCents, formatDate, formatMoney, formatRate } from '../format.js';

interface BuilderFields {
  readonly name: string;
  readonly category: string;
  readonly targetAmount: string;
  readonly currentSaved: string;
  readonly targetDate: string;
  readonly recurringContribution: string;
  readonly contributionCadence: 'weekly' | 'biweekly' | 'monthly';
  readonly liquidityNeed: 'anytime' | 'within_30_days' | 'goal_date';
  readonly preservationPreference: 'required' | 'flexible';
  readonly notes: string;
}

function normalize(values: BuilderFields): GoalInput {
  return {
    name: values.name.trim(),
    ...(values.category.trim() === '' ? {} : { category: values.category.trim() }),
    targetAmountCents: dollarsToCents(values.targetAmount),
    currentSavedCents: dollarsToCents(values.currentSaved),
    targetDate: values.targetDate,
    recurringContributionCents: dollarsToCents(values.recurringContribution),
    contributionCadence: values.contributionCadence,
    liquidityNeed: values.liquidityNeed,
    preservationPreference: values.preservationPreference,
    confidence: 'expected',
    ...(values.notes.trim() === '' ? {} : { notes: values.notes.trim() }),
  };
}

function validateMoney(value: string, minimumCents = 0): true | string {
  try {
    const cents = dollarsToCents(value);
    if (cents < minimumCents)
      return minimumCents === 50_000 ? 'The minimum goal is $500.' : 'Enter a non-negative amount.';
    if (cents > 100_000_000) return 'The local MVP supports up to $1,000,000.';
    return true;
  } catch {
    return 'Enter a valid dollar amount with no more than two decimal places.';
  }
}

export function BuilderPage({ user }: { readonly user: UserDto | null }): React.JSX.Element {
  const [preview, setPreview] = useState<PreviewOutput | null>(null);
  const [normalizedGoal, setNormalizedGoal] = useState<GoalInput | null>(null);
  const [previewFingerprint, setPreviewFingerprint] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const createKeyRef = useRef<string | null>(null);
  const navigate = useNavigate();
  const form = useForm<BuilderFields>({
    defaultValues: {
      name: 'Japan trip',
      category: 'Travel',
      targetAmount: '6000',
      currentSaved: '1000',
      targetDate: '2027-08-23',
      recurringContribution: '450',
      contributionCadence: 'monthly',
      liquidityNeed: 'goal_date',
      preservationPreference: 'required',
      notes: '',
    },
  });
  const currentFingerprint = JSON.stringify(form.watch());
  useEffect(() => {
    if (previewFingerprint !== null && previewFingerprint !== currentFingerprint) {
      setPreview(null);
      setNormalizedGoal(null);
      setPreviewFingerprint(null);
      createKeyRef.current = null;
    }
  }, [currentFingerprint, previewFingerprint]);
  const previewMutation = useMutation({
    mutationFn: api.preview,
    onSuccess: (result) => {
      setPreview(result);
      setTimeout(() => resultsRef.current?.focus(), 0);
    },
    onError: () => {
      setPreview(null);
      setNormalizedGoal(null);
      setPreviewFingerprint(null);
    },
  });
  const createMutation = useMutation({
    mutationFn: async (vehicleCode: VehicleCode) => {
      if (normalizedGoal === null) throw new Error('Preview a goal before saving.');
      createKeyRef.current ??= crypto.randomUUID();
      const goal = await api.createGoal(normalizedGoal, createKeyRef.current);
      try {
        await api.activate(goal.id, vehicleCode);
      } catch (error) {
        const saved = await api.goal(goal.id);
        if (saved.account?.vehicleCode !== vehicleCode) throw error;
      }
      return goal;
    },
    onSuccess: async (goal) => {
      createKeyRef.current = null;
      await navigate(`/dashboard?goal=${goal.id}`);
    },
  });
  const onSubmit = (values: BuilderFields): void => {
    setLocalError(null);
    try {
      const goal = normalize(values);
      if (goal.name.length === 0) throw new Error('Give your goal a short name.');
      if (goal.targetAmountCents < 50_000)
        throw new Error('The minimum goal for this MVP is $500.');
      setNormalizedGoal(goal);
      setPreviewFingerprint(JSON.stringify(values));
      createKeyRef.current = null;
      previewMutation.mutate(goal);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'Check your entries and try again.');
    }
  };
  const requestError =
    previewMutation.error instanceof ApiClientError
      ? previewMutation.error
      : createMutation.error instanceof ApiClientError
        ? createMutation.error
        : null;

  return (
    <section className="builder-shell">
      <div className="builder-intro">
        <p className="eyebrow">Goal builder</p>
        <h1>Give your next purchase a clear route.</h1>
        <p>
          We’ll start with contributions alone. Illustrative interest is shown separately as a
          buffer.
        </p>
      </div>
      <div className="builder-grid">
        <div className="form-card builder-form">
          {(localError !== null || requestError !== null) && (
            <div className="alert alert-error" role="alert">
              <strong>Check your plan.</strong> {localError ?? requestError?.message}
              {requestError !== null && (
                <span className="request-id">Reference {requestError.requestId}</span>
              )}
            </div>
          )}
          <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
            <fieldset>
              <legend>What are you saving for?</legend>
              <div className="form-grid two-columns">
                <label>
                  Goal name
                  <input
                    required
                    maxLength={80}
                    aria-invalid={form.formState.errors.name !== undefined}
                    {...form.register('name', { required: 'Give your goal a short name.' })}
                  />
                  {form.formState.errors.name !== undefined && (
                    <span className="field-error">{form.formState.errors.name.message}</span>
                  )}
                </label>
                <label>
                  Category <span className="optional">Optional</span>
                  <input maxLength={40} {...form.register('category')} />
                </label>
              </div>
            </fieldset>
            <fieldset>
              <legend>Amount and timing</legend>
              <div className="form-grid two-columns">
                <label>
                  Target amount
                  <span className="input-prefix">
                    <span aria-hidden="true">$</span>
                    <input
                      inputMode="decimal"
                      required
                      aria-invalid={form.formState.errors.targetAmount !== undefined}
                      aria-describedby={
                        form.formState.errors.targetAmount === undefined
                          ? undefined
                          : 'target-amount-error'
                      }
                      {...form.register('targetAmount', {
                        validate: (value) => validateMoney(value, 50_000),
                      })}
                    />
                  </span>
                  {form.formState.errors.targetAmount !== undefined && (
                    <span className="field-error" id="target-amount-error">
                      {form.formState.errors.targetAmount.message}
                    </span>
                  )}
                </label>
                <label>
                  Purchase date
                  <input
                    type="date"
                    required
                    aria-invalid={form.formState.errors.targetDate !== undefined}
                    {...form.register('targetDate', { required: 'Choose a purchase date.' })}
                  />
                  {form.formState.errors.targetDate !== undefined && (
                    <span className="field-error">{form.formState.errors.targetDate.message}</span>
                  )}
                </label>
                <label>
                  Already saved
                  <span className="input-prefix">
                    <span aria-hidden="true">$</span>
                    <input
                      inputMode="decimal"
                      required
                      aria-invalid={form.formState.errors.currentSaved !== undefined}
                      aria-describedby={
                        form.formState.errors.currentSaved === undefined
                          ? undefined
                          : 'current-saved-error'
                      }
                      {...form.register('currentSaved', {
                        validate: (value) => validateMoney(value),
                      })}
                    />
                  </span>
                  {form.formState.errors.currentSaved !== undefined && (
                    <span className="field-error" id="current-saved-error">
                      {form.formState.errors.currentSaved.message}
                    </span>
                  )}
                </label>
                <label>
                  Recurring contribution
                  <span className="input-prefix">
                    <span aria-hidden="true">$</span>
                    <input
                      inputMode="decimal"
                      required
                      aria-invalid={form.formState.errors.recurringContribution !== undefined}
                      aria-describedby={
                        form.formState.errors.recurringContribution === undefined
                          ? undefined
                          : 'recurring-contribution-error'
                      }
                      {...form.register('recurringContribution', {
                        validate: (value) => validateMoney(value),
                      })}
                    />
                  </span>
                  {form.formState.errors.recurringContribution !== undefined && (
                    <span className="field-error" id="recurring-contribution-error">
                      {form.formState.errors.recurringContribution.message}
                    </span>
                  )}
                </label>
                <label>
                  Contribution rhythm
                  <select {...form.register('contributionCadence')}>
                    <option value="weekly">Weekly</option>
                    <option value="biweekly">Every two weeks</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </label>
              </div>
            </fieldset>
            <fieldset>
              <legend>Access preferences</legend>
              <div className="form-grid two-columns">
                <label>
                  When might you need the money?
                  <select {...form.register('liquidityNeed')}>
                    <option value="anytime">At any time</option>
                    <option value="within_30_days">Within 30 days</option>
                    <option value="goal_date">Only at the goal date</option>
                  </select>
                </label>
                <label>
                  Capital preservation
                  <select {...form.register('preservationPreference')}>
                    <option value="required">Required</option>
                    <option value="flexible">Flexible</option>
                  </select>
                </label>
              </div>
            </fieldset>
            <label>
              Notes <span className="optional">Optional</span>
              <textarea maxLength={500} {...form.register('notes')} />
            </label>
            <button
              className="button full-width"
              type="submit"
              disabled={previewMutation.isPending}
            >
              {previewMutation.isPending ? 'Calculating your route…' : 'Compare my routes'}
              <ArrowRight aria-hidden="true" size={18} />
            </button>
          </form>
        </div>

        <aside className="builder-aside">
          <div className="aside-card">
            <Sparkles aria-hidden="true" />
            <h2>What you’ll see</h2>
            <ul className="check-list">
              <li>
                <Check aria-hidden="true" /> Your contribution-only baseline
              </li>
              <li>
                <Check aria-hidden="true" /> Four transparent modeled routes
              </li>
              <li>
                <Check aria-hidden="true" /> Access conflicts explained, never hidden
              </li>
            </ul>
          </div>
          <Disclosure />
        </aside>
      </div>

      {preview !== null && (
        <Results
          preview={preview}
          user={user}
          pending={createMutation.isPending}
          onActivate={(vehicleCode) => createMutation.mutate(vehicleCode)}
          resultsRef={resultsRef}
        />
      )}
    </section>
  );
}

function Results({
  preview,
  user,
  pending,
  onActivate,
  resultsRef,
}: {
  readonly preview: PreviewOutput;
  readonly user: UserDto | null;
  readonly pending: boolean;
  readonly onActivate: (vehicleCode: VehicleCode) => void;
  readonly resultsRef: React.RefObject<HTMLDivElement | null>;
}): React.JSX.Element {
  const baseline = preview.zeroInterestBaseline;
  const eligibleCount = useMemo(
    () => preview.vehicles.filter((vehicle) => vehicle.eligible).length,
    [preview],
  );
  return (
    <div className="results-section" ref={resultsRef} tabIndex={-1}>
      <div className="section-heading results-heading">
        <div>
          <p className="eyebrow">Your route comparison</p>
          <h2>{eligibleCount} modeled routes fit these access preferences.</h2>
        </div>
        <span className={baseline.feasible ? 'status-pill success' : 'status-pill attention'}>
          {baseline.feasible
            ? 'Contribution plan is feasible'
            : 'Contribution plan has a shortfall'}
        </span>
      </div>
      <article className="baseline-card">
        <div>
          <p className="eyebrow">Start here · no interest</p>
          <h3>Your contribution-only baseline</h3>
          <p>This is the controllable plan. Variable illustrative interest does not reduce it.</p>
        </div>
        <dl>
          <div>
            <dt>Required each contribution</dt>
            <dd>
              {baseline.requiredContributionCents === null
                ? 'Deadline is too soon'
                : formatMoney(baseline.requiredContributionCents)}
            </dd>
          </div>
          <div>
            <dt>Occurrences</dt>
            <dd>{baseline.occurrenceCount}</dd>
          </div>
          <div>
            <dt>Projected balance</dt>
            <dd>{formatMoney(baseline.projectedBalanceCents)}</dd>
          </div>
        </dl>
      </article>
      <div className="vehicle-grid">
        {preview.vehicles.map((vehicle) => {
          const recommended = vehicle.vehicleCode === preview.recommendedVehicleCode;
          return (
            <article
              className={`vehicle-card ${!vehicle.eligible ? 'ineligible' : ''} ${recommended ? 'recommended' : ''}`}
              key={vehicle.vehicleCode}
            >
              <div className="vehicle-topline">
                <span className="vehicle-icon" aria-hidden="true">
                  {vehicle.assumption.lockDays > 0 ? <Lock /> : <WalletCards />}
                </span>
                {recommended && (
                  <span className="recommended-label">Recommended simulated fit</span>
                )}
                {!vehicle.eligible && <span className="rejected-label">Doesn’t fit</span>}
              </div>
              <h3>{vehicle.displayName}</h3>
              <p className="rate">{formatRate(vehicle.assumption.apyBasisPoints)}</p>
              <p className="microcopy">Illustrative rate, not a live offer.</p>
              {vehicle.eligible ? (
                <>
                  <dl className="vehicle-metrics">
                    <div>
                      <dt>Required contribution</dt>
                      <dd>{formatMoney(vehicle.requiredContributionCents ?? 0)}</dd>
                    </div>
                    <div>
                      <dt>Principal</dt>
                      <dd>{formatMoney(vehicle.principalContributedCents)}</dd>
                    </div>
                    <div>
                      <dt>Modeled interest</dt>
                      <dd>{formatMoney(vehicle.modeledInterestCents)}</dd>
                    </div>
                    <div>
                      <dt>Ending balance</dt>
                      <dd>{formatMoney(vehicle.endingBalanceCents)}</dd>
                    </div>
                  </dl>
                  <p className="access-note">
                    <Clock3 aria-hidden="true" /> {vehicle.accessSummary}
                  </p>
                  <p className="microcopy">
                    Version {vehicle.assumption.assumptionVersion} · effective{' '}
                    {formatDate(vehicle.assumption.effectiveDate)}
                  </p>
                  {user === null ? (
                    recommended && (
                      <Link className="button full-width" to="/signin">
                        Sign in to save this route
                      </Link>
                    )
                  ) : (
                    <button
                      className={recommended ? 'button full-width' : 'secondary-button full-width'}
                      type="button"
                      disabled={pending}
                      onClick={() => onActivate(vehicle.vehicleCode)}
                    >
                      {pending ? 'Activating…' : 'Activate this simulated route'}
                    </button>
                  )}
                </>
              ) : (
                <div className="rejection">
                  <X aria-hidden="true" />
                  <p>
                    <strong>{vehicle.rejectionCode?.replaceAll('_', ' ').toLowerCase()}</strong>
                    <br />
                    {vehicle.rejectionMessage}
                  </p>
                </div>
              )}
            </article>
          );
        })}
      </div>
      <Disclosure />
    </div>
  );
}
