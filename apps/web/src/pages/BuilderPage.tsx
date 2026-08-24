import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Clock3,
  FilePenLine,
  Lock,
  Save,
  Sparkles,
  Trash2,
  WalletCards,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router';

import type {
  BuilderStep,
  GoalDraft,
  GoalDraftData,
  GoalInput,
  PreviewOutput,
  ProductEventInput,
  SafeBaselineOutput,
  UserDto,
  VehicleCode,
} from '@goalpilot/contracts';

import { api, ApiClientError, trackProductEvent } from '../api.js';
import { Disclosure } from '../components/Disclosure.js';
import { RetryableQueryError } from '../components/RetryableQueryError.js';
import { dollarsToCents, formatDate, formatMoney, formatRate } from '../format.js';
import { LogicalMutationKey } from '../idempotency.js';
import {
  fitRationaleCopy,
  formatSignedMoney,
  liquidityNeedCopy,
  protectionClassificationCopy,
  vehicleRejectionCopy,
  vehicleRejectionResolutionCopy,
} from '../productCopy.js';

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

const steps: readonly { readonly id: BuilderStep; readonly label: string }[] = [
  { id: 'goal', label: 'Goal' },
  { id: 'starting_point', label: 'Starting point' },
  { id: 'budget_fit', label: 'Budget fit' },
  { id: 'access', label: 'Access' },
  { id: 'review', label: 'Review' },
];

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

function amountForInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

function optionalCents(value: string): number | undefined {
  const normalized = value.replaceAll(',', '').replace('$', '').trim();
  return normalized === '' ? undefined : dollarsToCents(value);
}

function completedBefore(step: BuilderStep): BuilderStep | null {
  const index = steps.findIndex((candidate) => candidate.id === step);
  return index <= 0 ? null : (steps[index - 1]?.id ?? null);
}

function stepAfter(lastCompletedStep: BuilderStep | null): BuilderStep {
  if (lastCompletedStep === null) return 'goal';
  const index = steps.findIndex((candidate) => candidate.id === lastCompletedStep);
  return steps[Math.min(index + 1, steps.length - 1)]?.id ?? 'goal';
}

function toDraftData(values: BuilderFields, baseline: SafeBaselineOutput | null): GoalDraftData {
  const data: GoalDraftData = {
    contributionCadence: values.contributionCadence,
    liquidityNeed: values.liquidityNeed,
    preservationPreference: values.preservationPreference,
    confidence: 'expected',
  };
  if (values.name.trim() !== '') data.name = values.name.trim();
  if (values.category.trim() !== '') data.category = values.category.trim();
  const targetAmountCents = optionalCents(values.targetAmount);
  if (targetAmountCents !== undefined) data.targetAmountCents = targetAmountCents;
  if (values.targetDate !== '') data.targetDate = values.targetDate;
  const currentSavedCents = optionalCents(values.currentSaved);
  if (currentSavedCents !== undefined) data.currentSavedCents = currentSavedCents;
  const recurringContributionCents = optionalCents(values.recurringContribution);
  if (recurringContributionCents !== undefined)
    data.recurringContributionCents = recurringContributionCents;
  if (values.notes.trim() !== '') data.notes = values.notes.trim();
  if (baseline?.firstContributionDate !== null && baseline?.firstContributionDate !== undefined)
    data.firstContributionDate = baseline.firstContributionDate;
  if (baseline?.safeContributionCents !== null && baseline?.safeContributionCents !== undefined)
    data.safeContributionCents = baseline.safeContributionCents;
  const safe = baseline?.safeContributionCents;
  if (safe !== null && safe !== undefined && recurringContributionCents !== undefined)
    data.budgetFit =
      recurringContributionCents < safe
        ? 'lower'
        : recurringContributionCents > safe
          ? 'higher'
          : 'equal';
  return data;
}

export function BuilderPage({ user }: { readonly user: UserDto | null }): React.JSX.Element {
  const [step, setStep] = useState<BuilderStep>('goal');
  const [baseline, setBaseline] = useState<SafeBaselineOutput | null>(null);
  const [preview, setPreview] = useState<PreviewOutput | null>(null);
  const [normalizedGoal, setNormalizedGoal] = useState<GoalInput | null>(null);
  const [activeDraft, setActiveDraft] = useState<GoalDraft | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const resumedStepRef = useRef<BuilderStep | null>(null);
  const builderStartedRef = useRef(false);
  const completedStepsRef = useRef(new Set<BuilderStep>());
  const draftWriteKeyRef = useRef(new LogicalMutationKey());
  const discardKeyRef = useRef(new LogicalMutationKey());
  const activationKeyRef = useRef(new LogicalMutationKey());
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const form = useForm<BuilderFields>({
    defaultValues: {
      name: 'Japan trip',
      category: 'Travel',
      targetAmount: '9000',
      currentSaved: '1500',
      targetDate: '2028-02-23',
      recurringContribution: '400.50',
      contributionCadence: 'monthly',
      liquidityNeed: 'within_30_days',
      preservationPreference: 'required',
      notes: '',
    },
  });
  const draftsQuery = useQuery({
    queryKey: ['goal-drafts'],
    queryFn: api.drafts,
    enabled: user !== null,
    retry: false,
  });
  const capabilities = useQuery({
    queryKey: ['capabilities'],
    queryFn: api.capabilities,
    enabled: user !== null,
    retry: false,
  });
  const demo = capabilities.data?.demoStory ?? false;
  const recordProductEvent = (event: ProductEventInput): void => {
    if (user !== null) trackProductEvent(event);
  };
  const recordCompletedStep = (builderStep: BuilderStep): void => {
    if (completedStepsRef.current.has(builderStep)) return;
    completedStepsRef.current.add(builderStep);
    recordProductEvent({
      eventName: 'builder_step_completed',
      builderStep,
      demo,
      applicationVersion: 'product-experience-v1',
    });
  };
  useEffect(() => {
    if (
      user === null ||
      capabilities.isPending ||
      capabilities.error !== null ||
      builderStartedRef.current
    )
      return;
    builderStartedRef.current = true;
    trackProductEvent({
      eventName: 'builder_started',
      demo,
      applicationVersion: 'product-experience-v1',
    });
  }, [capabilities.error, capabilities.isPending, demo, user]);
  useEffect(() => {
    const subscription = form.watch(() => {
      draftWriteKeyRef.current.clear();
      activationKeyRef.current.clear();
    });
    return () => subscription.unsubscribe();
  }, [form]);
  const baselineMutation = useMutation({
    mutationFn: api.safeBaseline,
    onSuccess: ({ baseline: result }) => {
      setBaseline(result);
      const resumedStep = resumedStepRef.current;
      if (resumedStep === null && result.safeContributionCents !== null)
        form.setValue('recurringContribution', amountForInput(result.safeContributionCents));
      setStep(resumedStep ?? 'budget_fit');
      setNotice(
        resumedStep === null
          ? 'Your contribution-only baseline is ready. Now decide what fits your budget.'
          : `Draft restored at ${steps.find((candidate) => candidate.id === resumedStep)?.label ?? 'the saved step'}. The contribution-only baseline was refreshed.`,
      );
      resumedStepRef.current = null;
      if (resumedStep === null) {
        recordCompletedStep('starting_point');
        recordProductEvent({
          eventName: 'safe_baseline_viewed',
          demo,
          applicationVersion: 'product-experience-v1',
        });
      }
    },
    onError: () => {
      resumedStepRef.current = null;
    },
  });
  const saveDraftMutation = useMutation({
    mutationFn: async () => {
      const data = toDraftData(form.getValues(), baseline);
      const lastCompletedStep = completedBefore(step);
      const request =
        activeDraft === null
          ? { operation: 'create' as const, data, lastCompletedStep }
          : {
              operation: 'update' as const,
              draftId: activeDraft.id,
              expectedVersion: activeDraft.version,
              data,
              lastCompletedStep,
            };
      const key = draftWriteKeyRef.current.keyFor(request);
      return activeDraft === null
        ? api.createDraft({ data, lastCompletedStep }, key)
        : api.updateDraft(
            activeDraft.id,
            {
              expectedVersion: activeDraft.version,
              data,
              lastCompletedStep,
            },
            key,
          );
    },
    onSuccess: async (draft) => {
      draftWriteKeyRef.current.clear();
      setActiveDraft(draft);
      setNotice('Draft saved. You can safely resume it later.');
      await queryClient.invalidateQueries({ queryKey: ['goal-drafts'] });
    },
  });
  const discardMutation = useMutation({
    mutationFn: (draft: GoalDraft) =>
      api.discardDraft(
        draft.id,
        draft.version,
        discardKeyRef.current.keyFor({ draftId: draft.id, expectedVersion: draft.version }),
      ),
    onSuccess: async (_, draft) => {
      discardKeyRef.current.clear();
      if (activeDraft?.id === draft.id) setActiveDraft(null);
      setNotice('Draft discarded. No active plan was changed.');
      await queryClient.invalidateQueries({ queryKey: ['goal-drafts'] });
    },
  });
  const previewMutation = useMutation({
    mutationFn: api.preview,
    onSuccess: (result) => {
      setPreview(result);
      recordCompletedStep('review');
      recordProductEvent({
        eventName: 'plan_previewed',
        demo,
        applicationVersion: 'product-experience-v1',
      });
      setTimeout(() => resultsRef.current?.focus(), 0);
    },
  });
  const activationMutation = useMutation({
    mutationFn: async (vehicleCode: VehicleCode) => {
      const data = toDraftData(form.getValues(), baseline);
      const lastCompletedStep = 'review' as const;
      const draftWriteRequest =
        activeDraft === null
          ? { operation: 'create' as const, data, lastCompletedStep }
          : {
              operation: 'update' as const,
              draftId: activeDraft.id,
              expectedVersion: activeDraft.version,
              data,
              lastCompletedStep,
            };
      const draftWriteKey = draftWriteKeyRef.current.keyFor(draftWriteRequest);
      const draft =
        activeDraft === null
          ? await api.createDraft({ data, lastCompletedStep }, draftWriteKey)
          : await api.updateDraft(
              activeDraft.id,
              {
                expectedVersion: activeDraft.version,
                data,
                lastCompletedStep,
              },
              draftWriteKey,
            );
      const activationInput = {
        expectedDraftVersion: draft.version,
        vehicleCode,
      };
      return api.activateDraft(
        draft.id,
        activationInput,
        activationKeyRef.current.keyFor({ draftId: draft.id, ...activationInput }),
      );
    },
    onSuccess: async (result, vehicleCode) => {
      draftWriteKeyRef.current.clear();
      activationKeyRef.current.clear();
      recordProductEvent({
        eventName: 'simulated_plan_activated',
        vehicleCode,
        demo,
        applicationVersion: 'product-experience-v1',
      });
      await queryClient.invalidateQueries({ queryKey: ['goal-drafts'] });
      await navigate(`/dashboard?goal=${result.goalId}`);
    },
  });

  const requestError = [
    baselineMutation.error,
    saveDraftMutation.error,
    discardMutation.error,
    previewMutation.error,
    activationMutation.error,
  ].find((error): error is Error => error instanceof Error);
  const stepIndex = steps.findIndex((candidate) => candidate.id === step);

  const resumeDraft = (draft: GoalDraft): void => {
    const data = draft.data;
    form.reset({
      name: data.name ?? '',
      category: data.category ?? '',
      targetAmount:
        data.targetAmountCents === undefined ? '' : amountForInput(data.targetAmountCents),
      currentSaved:
        data.currentSavedCents === undefined ? '' : amountForInput(data.currentSavedCents),
      targetDate: data.targetDate ?? '',
      recurringContribution:
        data.recurringContributionCents === undefined
          ? ''
          : amountForInput(data.recurringContributionCents),
      contributionCadence: data.contributionCadence ?? 'monthly',
      liquidityNeed: data.liquidityNeed ?? 'goal_date',
      preservationPreference: data.preservationPreference ?? 'required',
      notes: data.notes ?? '',
    });
    setActiveDraft(draft);
    setBaseline(null);
    setPreview(null);
    const resumedStep = stepAfter(draft.lastCompletedStep);
    const needsBaseline = steps.findIndex((candidate) => candidate.id === resumedStep) >= 2;
    if (
      needsBaseline &&
      data.targetAmountCents !== undefined &&
      data.currentSavedCents !== undefined &&
      data.targetDate !== undefined &&
      data.contributionCadence !== undefined
    ) {
      resumedStepRef.current = resumedStep;
      setStep('starting_point');
      setNotice('Draft restored. Refreshing its contribution-only baseline...');
      baselineMutation.mutate({
        targetAmountCents: data.targetAmountCents,
        currentSavedCents: data.currentSavedCents,
        targetDate: data.targetDate,
        contributionCadence: data.contributionCadence,
      });
      return;
    }
    setStep(needsBaseline ? 'starting_point' : resumedStep);
    setNotice(
      needsBaseline
        ? 'Draft restored. Complete the starting point to refresh its contribution-only baseline.'
        : `Draft restored at ${steps.find((candidate) => candidate.id === resumedStep)?.label ?? 'the saved step'}.`,
    );
  };

  const continueFromGoal = async (): Promise<void> => {
    if (await form.trigger(['name', 'targetAmount', 'targetDate'])) {
      recordCompletedStep('goal');
      setStep('starting_point');
    }
  };
  const revealBaseline = async (): Promise<void> => {
    if (!(await form.trigger(['currentSaved', 'contributionCadence']))) return;
    setLocalError(null);
    try {
      baselineMutation.mutate({
        targetAmountCents: dollarsToCents(form.getValues('targetAmount')),
        currentSavedCents: dollarsToCents(form.getValues('currentSaved')),
        targetDate: form.getValues('targetDate'),
        contributionCadence: form.getValues('contributionCadence'),
      });
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'Check the starting point.');
    }
  };
  const previewPlan = (): void => {
    setLocalError(null);
    try {
      const goal = normalize(form.getValues());
      setNormalizedGoal(goal);
      previewMutation.mutate(goal);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'Check your plan.');
    }
  };
  const continueFromBudget = async (): Promise<void> => {
    if (!(await form.trigger('recurringContribution', { shouldFocus: true }))) return;
    recordCompletedStep('budget_fit');
    setStep('access');
  };
  const continueFromAccess = (): void => {
    recordCompletedStep('access');
    setStep('review');
  };

  return (
    <section className="builder-shell">
      <div className="builder-intro">
        <p className="eyebrow">Progressive goal builder</p>
        <h1>Build the commitment before comparing interest.</h1>
        <p>
          GoalPilot reveals the server-calculated zero-interest amount first. Budget fit and
          illustrative vehicle details come only after that controllable baseline.
        </p>
      </div>

      {user !== null && capabilities.error !== null && (
        <RetryableQueryError
          label="Local feature availability"
          error={capabilities.error}
          description="Goal building remains available, but Story Mode cannot be classified until this check succeeds."
          onRetry={() => capabilities.refetch()}
        />
      )}

      {user !== null && (draftsQuery.data?.drafts.length ?? 0) > 0 && (
        <section className="draft-shelf" aria-labelledby="drafts-title">
          <div>
            <p className="eyebrow">Incomplete drafts</p>
            <h2 id="drafts-title">Resume where you stopped</h2>
          </div>
          <div className="draft-list">
            {draftsQuery.data?.drafts.map((draft) => (
              <article key={draft.id}>
                <FilePenLine aria-hidden="true" />
                <div>
                  <strong>{draft.data.name ?? 'Untitled goal'}</strong>
                  <span>
                    Saved {new Date(draft.updatedAt).toLocaleDateString()} · Next:{' '}
                    {steps.find((candidate) => candidate.id === stepAfter(draft.lastCompletedStep))
                      ?.label ?? 'Goal'}
                  </span>
                </div>
                <button
                  className="text-button"
                  type="button"
                  disabled={baselineMutation.isPending}
                  onClick={() => resumeDraft(draft)}
                >
                  Resume
                </button>
                <button
                  className="text-button danger-text"
                  type="button"
                  aria-label={`Discard ${draft.data.name ?? 'untitled goal'} draft`}
                  disabled={discardMutation.isPending}
                  onClick={() => discardMutation.mutate(draft)}
                >
                  <Trash2 aria-hidden="true" size={16} />
                </button>
              </article>
            ))}
          </div>
        </section>
      )}

      <nav className="builder-steps" aria-label="Goal builder progress">
        <ol>
          {steps.map((candidate, index) => (
            <li
              className={index === stepIndex ? 'current' : index < stepIndex ? 'complete' : ''}
              key={candidate.id}
            >
              <span aria-hidden="true">{index < stepIndex ? <Check size={15} /> : index + 1}</span>
              <strong>{candidate.label}</strong>
              {index === stepIndex && <span className="sr-only">Current step</span>}
            </li>
          ))}
        </ol>
      </nav>

      {notice !== null && (
        <div className="alert alert-success" role="status">
          {notice}
        </div>
      )}
      {(localError !== null || requestError !== undefined) && (
        <div className="alert alert-error" role="alert">
          <strong>We couldn’t continue.</strong> {localError ?? requestError?.message}
          {requestError instanceof ApiClientError && (
            <span className="request-id">Reference {requestError.requestId}</span>
          )}
        </div>
      )}

      <div className="builder-grid">
        <div className="form-card builder-form">
          <form onSubmit={(event) => event.preventDefault()} noValidate>
            {step === 'goal' && <GoalStep form={form} />}
            {step === 'starting_point' && <StartingPointStep form={form} />}
            {step === 'budget_fit' && baseline !== null && (
              <BudgetStep form={form} baseline={baseline} />
            )}
            {step === 'access' && <AccessStep form={form} />}
            {step === 'review' && <ReviewStep form={form} baseline={baseline} />}

            <div className="builder-actions">
              {stepIndex > 0 && (
                <button
                  className="text-button"
                  type="button"
                  onClick={() => setStep(steps[stepIndex - 1]?.id ?? 'goal')}
                >
                  <ArrowLeft aria-hidden="true" size={17} /> Back
                </button>
              )}
              {step === 'goal' && (
                <button className="button" type="button" onClick={() => void continueFromGoal()}>
                  Continue <ArrowRight aria-hidden="true" size={17} />
                </button>
              )}
              {step === 'starting_point' && (
                <button
                  className="button"
                  type="button"
                  disabled={baselineMutation.isPending}
                  onClick={() => void revealBaseline()}
                >
                  {baselineMutation.isPending ? 'Calculating…' : 'Reveal my safe contribution'}
                </button>
              )}
              {step === 'budget_fit' && (
                <button className="button" type="button" onClick={() => void continueFromBudget()}>
                  Continue to access
                </button>
              )}
              {step === 'access' && (
                <button className="button" type="button" onClick={continueFromAccess}>
                  Review plan
                </button>
              )}
              {step === 'review' && (
                <button
                  className="button"
                  type="button"
                  disabled={previewMutation.isPending}
                  onClick={previewPlan}
                >
                  {previewMutation.isPending ? 'Building preview…' : 'Preview my plan'}
                </button>
              )}
              {user !== null && (
                <button
                  className="secondary-button"
                  type="button"
                  disabled={saveDraftMutation.isPending}
                  onClick={() => saveDraftMutation.mutate()}
                >
                  <Save aria-hidden="true" size={17} />
                  {saveDraftMutation.isPending ? 'Saving…' : 'Save draft'}
                </button>
              )}
            </div>
          </form>
        </div>
        <aside className="builder-aside">
          <div className="aside-card">
            <Sparkles aria-hidden="true" />
            <h2>One decision at a time</h2>
            <ul className="check-list">
              <li>
                <Check aria-hidden="true" /> Baseline before budget
              </li>
              <li>
                <Check aria-hidden="true" /> Access before return
              </li>
              <li>
                <Check aria-hidden="true" /> Four explained modeled fits
              </li>
            </ul>
          </div>
          <Disclosure />
        </aside>
      </div>

      {preview !== null && normalizedGoal !== null && (
        <Results
          preview={preview}
          goal={normalizedGoal}
          user={user}
          pending={activationMutation.isPending}
          onActivate={(vehicleCode) => activationMutation.mutate(vehicleCode)}
          onVehicleDetails={(vehicleCode, rejectionCode) =>
            recordProductEvent({
              eventName: 'vehicle_details_opened',
              vehicleCode,
              rejectionCode,
              demo,
              applicationVersion: 'product-experience-v1',
            })
          }
          resultsRef={resultsRef}
        />
      )}
    </section>
  );
}

type BuilderForm = ReturnType<typeof useForm<BuilderFields>>;

function GoalStep({ form }: { readonly form: BuilderForm }): React.JSX.Element {
  return (
    <fieldset>
      <legend>1. What are you saving for?</legend>
      <div className="form-grid two-columns">
        <label>
          Goal name
          <input
            required
            maxLength={80}
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
        <label>
          Target amount
          <span className="input-prefix">
            <span aria-hidden="true">$</span>
            <input
              inputMode="decimal"
              {...form.register('targetAmount', {
                validate: (value) => validateMoney(value, 50_000),
              })}
            />
          </span>
          {form.formState.errors.targetAmount !== undefined && (
            <span className="field-error">{form.formState.errors.targetAmount.message}</span>
          )}
        </label>
        <label>
          Purchase date
          <input
            type="date"
            {...form.register('targetDate', { required: 'Choose a purchase date.' })}
          />
          {form.formState.errors.targetDate !== undefined && (
            <span className="field-error">{form.formState.errors.targetDate.message}</span>
          )}
        </label>
      </div>
    </fieldset>
  );
}

function StartingPointStep({ form }: { readonly form: BuilderForm }): React.JSX.Element {
  return (
    <fieldset>
      <legend>2. Set the starting point</legend>
      <p className="muted">
        No budget question appears until the server returns your zero-interest baseline.
      </p>
      <div className="form-grid two-columns">
        <label>
          Already saved
          <span className="input-prefix">
            <span aria-hidden="true">$</span>
            <input
              inputMode="decimal"
              {...form.register('currentSaved', { validate: (value) => validateMoney(value) })}
            />
          </span>
          {form.formState.errors.currentSaved !== undefined && (
            <span className="field-error">{form.formState.errors.currentSaved.message}</span>
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
  );
}

function BudgetStep({
  form,
  baseline,
}: {
  readonly form: BuilderForm;
  readonly baseline: SafeBaselineOutput;
}): React.JSX.Element {
  const cadence = form.getValues('contributionCadence').replace('biweekly', 'two weeks');
  const contributionError = form.formState.errors.recurringContribution?.message;
  return (
    <fieldset>
      <legend>3. Does this commitment fit?</legend>
      <article className="safe-reveal" aria-live="polite">
        <p className="eyebrow">Does not depend on modeled interest</p>
        <strong>
          {baseline.safeContributionCents === null
            ? 'No remaining contribution dates'
            : `${formatMoney(baseline.safeContributionCents)} per ${cadence}`}
        </strong>
        <p>
          {baseline.occurrenceCount} planned contributions through {formatDate(baseline.targetDate)}
          .
        </p>
      </article>
      <label htmlFor="budget-contribution">
        Amount that fits your budget
        <span className="input-prefix">
          <span aria-hidden="true">$</span>
          <input
            aria-label="Amount that fits your budget"
            aria-invalid={contributionError === undefined ? undefined : true}
            aria-describedby={
              contributionError === undefined
                ? 'budget-contribution-help'
                : 'budget-contribution-help budget-contribution-error'
            }
            id="budget-contribution"
            inputMode="decimal"
            {...form.register('recurringContribution', {
              validate: (value) => validateMoney(value),
            })}
          />
        </span>
        <span className="helper" id="budget-contribution-help">
          Lower shows a shortfall. Higher may show earlier readiness. Interest never reduces the
          safe amount.
        </span>
        {contributionError !== undefined && (
          <span className="field-error" id="budget-contribution-error" role="alert">
            {contributionError}
          </span>
        )}
      </label>
    </fieldset>
  );
}

function AccessStep({ form }: { readonly form: BuilderForm }): React.JSX.Element {
  return (
    <fieldset>
      <legend>4. When might you need this money?</legend>
      <div className="form-grid two-columns">
        <label>
          Access need
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
  );
}

function ReviewStep({
  form,
  baseline,
}: {
  readonly form: BuilderForm;
  readonly baseline: SafeBaselineOutput | null;
}): React.JSX.Element {
  return (
    <fieldset>
      <legend>5. Review before preview</legend>
      <dl className="review-list">
        <div>
          <dt>Goal</dt>
          <dd>{form.getValues('name')}</dd>
        </div>
        <div>
          <dt>Target</dt>
          <dd>{formatMoney(dollarsToCents(form.getValues('targetAmount')))}</dd>
        </div>
        <div>
          <dt>Deadline</dt>
          <dd>{formatDate(form.getValues('targetDate'))}</dd>
        </div>
        <div>
          <dt>Safe amount</dt>
          <dd>
            {baseline?.safeContributionCents === null ||
            baseline?.safeContributionCents === undefined
              ? 'Unavailable'
              : formatMoney(baseline.safeContributionCents)}
          </dd>
        </div>
        <div>
          <dt>Chosen amount</dt>
          <dd>{formatMoney(dollarsToCents(form.getValues('recurringContribution')))}</dd>
        </div>
        <div>
          <dt>Access</dt>
          <dd>{liquidityNeedCopy[form.getValues('liquidityNeed')]}</dd>
        </div>
      </dl>
      <label>
        Notes <span className="optional">Optional</span>
        <textarea maxLength={500} {...form.register('notes')} />
      </label>
    </fieldset>
  );
}

function Results({
  preview,
  goal,
  user,
  pending,
  onActivate,
  onVehicleDetails,
  resultsRef,
}: {
  readonly preview: PreviewOutput;
  readonly goal: GoalInput;
  readonly user: UserDto | null;
  readonly pending: boolean;
  readonly onActivate: (vehicleCode: VehicleCode) => void;
  readonly onVehicleDetails: (
    vehicleCode: VehicleCode,
    rejectionCode: PreviewOutput['vehicles'][number]['rejectionCode'],
  ) => void;
  readonly resultsRef: React.RefObject<HTMLDivElement | null>;
}): React.JSX.Element {
  const vehicles = useMemo(
    () =>
      [...preview.vehicles].sort((left, right) => {
        if (left.vehicleCode === preview.recommendedVehicleCode) return -1;
        if (right.vehicleCode === preview.recommendedVehicleCode) return 1;
        if (left.vehicleCode === 'cash') return -1;
        if (right.vehicleCode === 'cash') return 1;
        if (left.eligible !== right.eligible) return left.eligible ? -1 : 1;
        return (left.fitRank ?? 99) - (right.fitRank ?? 99);
      }),
    [preview],
  );
  const recommended =
    vehicles.find((vehicle) => vehicle.vehicleCode === preview.recommendedVehicleCode) ?? null;
  const cadenceLabel =
    goal.contributionCadence === 'biweekly'
      ? 'every two weeks'
      : goal.contributionCadence.replace('ly', '');
  return (
    <div className="results-section" ref={resultsRef} tabIndex={-1}>
      <article className="plan-lead">
        <div>
          <p className="eyebrow">Your Simulated Goal Plan</p>
          <h2>
            Save {formatMoney(goal.recurringContributionCents)} {cadenceLabel} through{' '}
            {formatDate(goal.targetDate)}
          </h2>
          <p>
            Illustrated fit: <strong>{recommended?.displayName ?? 'No eligible model'}</strong>
          </p>
          <p>
            Projected purchase readiness:{' '}
            <strong>{formatDate(recommended?.projectedCompletionDate ?? null)}</strong>
          </p>
        </div>
        <dl className="reconciliation">
          <div>
            <dt>Current savings</dt>
            <dd>{formatMoney(goal.currentSavedCents)}</dd>
          </div>
          <div>
            <dt>+ planned personal contributions</dt>
            <dd>{formatMoney(recommended?.futurePersonalContributionsCents ?? 0)}</dd>
          </div>
          <div>
            <dt>+ modeled interest</dt>
            <dd>{formatMoney(recommended?.modeledInterestCents ?? 0)}</dd>
          </div>
          <div className="total">
            <dt>= projected balance</dt>
            <dd>{formatMoney(recommended?.endingBalanceCents ?? goal.currentSavedCents)}</dd>
          </div>
        </dl>
      </article>
      <article className="baseline-card">
        <div>
          <p className="eyebrow">Primary commitment · zero interest</p>
          <h3>
            {preview.zeroInterestBaseline.requiredContributionCents === null
              ? 'No remaining contribution dates'
              : `${formatMoney(preview.zeroInterestBaseline.requiredContributionCents)} each contribution`}
          </h3>
          <p>Does not depend on modeled interest. Your chosen amount remains separate.</p>
        </div>
        <dl>
          <div>
            <dt>Chosen</dt>
            <dd>{formatMoney(goal.recurringContributionCents)}</dd>
          </div>
          <div>
            <dt>Occurrences</dt>
            <dd>{preview.zeroInterestBaseline.occurrenceCount}</dd>
          </div>
          <div>
            <dt>
              {preview.zeroInterestBaseline.shortfallCents > 0
                ? 'Shortfall'
                : 'Zero-interest balance'}
            </dt>
            <dd>
              {formatMoney(
                preview.zeroInterestBaseline.shortfallCents > 0
                  ? preview.zeroInterestBaseline.shortfallCents
                  : preview.zeroInterestBaseline.projectedBalanceCents,
              )}
            </dd>
          </div>
        </dl>
      </article>
      <div className="vehicle-grid">
        {vehicles.map((vehicle) => {
          const selected = vehicle.vehicleCode === preview.recommendedVehicleCode;
          return (
            <article
              className={`vehicle-card ${!vehicle.eligible ? 'ineligible' : ''} ${selected ? 'recommended' : ''}`}
              key={vehicle.vehicleCode}
            >
              <div className="vehicle-topline">
                <span className="vehicle-icon" aria-hidden="true">
                  {vehicle.assumption.lockDays > 0 ? <Lock /> : <WalletCards />}
                </span>
                {selected && (
                  <span className="recommended-label">
                    Illustrated fit · rank {vehicle.fitRank}
                  </span>
                )}
                {!vehicle.eligible && <span className="rejected-label">Doesn’t fit</span>}
              </div>
              <h3>{vehicle.displayName}</h3>
              <p className="rate">{formatRate(vehicle.assumption.apyBasisPoints)}</p>
              <p className="microcopy">Illustrative rate, not a live offer.</p>
              {vehicle.eligible ? (
                <>
                  <p className="fit-rationale">{fitRationaleCopy[vehicle.fitRationaleCode]}</p>
                  <dl className="vehicle-metrics">
                    <div>
                      <dt>Safe contribution</dt>
                      <dd>
                        {vehicle.safeContributionCents === null
                          ? 'Unavailable'
                          : formatMoney(vehicle.safeContributionCents)}
                      </dd>
                    </div>
                    <div>
                      <dt>Modeled interest</dt>
                      <dd>{formatMoney(vehicle.modeledInterestCents)}</dd>
                    </div>
                    <div>
                      <dt>Readiness</dt>
                      <dd>{formatDate(vehicle.projectedCompletionDate)}</dd>
                    </div>
                    <div>
                      <dt>Modeled cushion</dt>
                      <dd>{formatMoney(vehicle.safeContributionModeledCushionCents)}</dd>
                    </div>
                    <div>
                      <dt>Projected ending balance</dt>
                      <dd>{formatMoney(vehicle.endingBalanceCents)}</dd>
                    </div>
                    <div>
                      <dt>Modeled benefit versus cash</dt>
                      <dd>{formatSignedMoney(vehicle.modeledBenefitVersusCashCents)}</dd>
                    </div>
                  </dl>
                  <p className="access-note">
                    <Clock3 aria-hidden="true" /> {vehicle.accessSummary}
                  </p>
                  <p className="microcopy">
                    Server projection using the plan schedule and fixed reviewed assumption through
                    the target date.
                  </p>
                  <details
                    onToggle={(event) => {
                      if (event.currentTarget.open)
                        onVehicleDetails(vehicle.vehicleCode, vehicle.rejectionCode);
                    }}
                  >
                    <summary>Assumption and calculation detail</summary>
                    <dl className="detail-list">
                      <div>
                        <dt>Assumption</dt>
                        <dd>{vehicle.assumption.assumptionVersion}</dd>
                      </div>
                      <div>
                        <dt>Effective</dt>
                        <dd>{formatDate(vehicle.assumption.effectiveDate)}</dd>
                      </div>
                      <div>
                        <dt>Reviewed</dt>
                        <dd>{formatDate(vehicle.assumption.reviewedDate)}</dd>
                      </div>
                      <div>
                        <dt>Source</dt>
                        <dd>{vehicle.assumption.sourceLabel}</dd>
                      </div>
                      <div>
                        <dt>Live rate</dt>
                        <dd>No - reviewed demo assumption</dd>
                      </div>
                      <div>
                        <dt>Principal</dt>
                        <dd>{formatMoney(vehicle.principalContributedCents)}</dd>
                      </div>
                      <div>
                        <dt>Interest</dt>
                        <dd>{formatMoney(vehicle.modeledInterestCents)}</dd>
                      </div>
                      <div>
                        <dt>Lock</dt>
                        <dd>{vehicle.assumption.lockDays} days</dd>
                      </div>
                      <div>
                        <dt>Modeled access</dt>
                        <dd>{vehicle.assumption.liquidityDays} days</dd>
                      </div>
                      <div>
                        <dt>Protection treatment</dt>
                        <dd>{protectionClassificationCopy[vehicle.protectionClassification]}</dd>
                      </div>
                      <div>
                        <dt>Preservation requirement</dt>
                        <dd>
                          {vehicle.preservationRequirementSatisfied
                            ? 'Satisfied by this model'
                            : 'Not satisfied by this model'}
                        </dd>
                      </div>
                      <div>
                        <dt>First maturity</dt>
                        <dd>
                          {vehicle.firstMaturityDate === null
                            ? 'Not applicable'
                            : formatDate(vehicle.firstMaturityDate)}
                        </dd>
                      </div>
                      <div>
                        <dt>Modeled minimum</dt>
                        <dd>{formatMoney(vehicle.assumption.minimumCents)}</dd>
                      </div>
                    </dl>
                  </details>
                  {user === null ? (
                    selected && (
                      <Link className="button full-width" to="/signin">
                        Sign in to activate this Simulated Goal Plan
                      </Link>
                    )
                  ) : (
                    <button
                      className={selected ? 'button full-width' : 'secondary-button full-width'}
                      type="button"
                      disabled={pending}
                      onClick={() => onActivate(vehicle.vehicleCode)}
                    >
                      {pending ? 'Activating…' : 'Activate this Simulated Goal Plan'}
                    </button>
                  )}
                </>
              ) : (
                <div className="rejection">
                  <X aria-hidden="true" />
                  <p>
                    <strong>
                      {vehicle.rejectionCode === null
                        ? 'This route is unavailable.'
                        : vehicleRejectionCopy[vehicle.rejectionCode]}
                    </strong>
                    <br />
                    <span>{vehicle.rejectionMessage}</span>
                    <br />
                    <span>
                      What would need to change:{' '}
                      {vehicle.rejectionCode === null
                        ? 'Choose a different modeled route.'
                        : vehicleRejectionResolutionCopy[vehicle.rejectionCode]}
                    </span>
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
