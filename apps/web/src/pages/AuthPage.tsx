import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, LockKeyhole } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router';
import { z } from 'zod';

import { api, ApiClientError } from '../api.js';

const loginSchema = z.object({
  email: z.email('Enter a valid email.'),
  password: z.string().min(12, 'Use at least 12 characters.'),
  displayName: z.string().max(80, 'Use 80 characters or fewer.').optional(),
});
type LoginFields = z.infer<typeof loginSchema>;

export function AuthPage(): React.JSX.Element {
  const [registering, setRegistering] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const form = useForm<LoginFields>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: 'alex@example.test',
      password: 'GoalPilot-Alex-2026!',
      displayName: '',
    },
  });
  const mutation = useMutation({
    mutationFn: async (values: LoginFields) =>
      registering
        ? api.register({
            email: values.email,
            password: values.password,
            displayName:
              values.displayName === undefined || values.displayName.trim().length === 0
                ? 'GoalPilot saver'
                : values.displayName.trim(),
          })
        : api.login({ email: values.email, password: values.password }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      await navigate('/dashboard');
    },
  });
  const error = mutation.error instanceof ApiClientError ? mutation.error : null;

  return (
    <section className="auth-layout">
      <div className="auth-message">
        <p className="eyebrow">Your plan, kept local</p>
        <h1>Welcome back to a clearer savings path.</h1>
        <p>
          Local sessions still exercise real ownership and security boundaries. Two synthetic users
          are included so tenant isolation can be tested without an external identity provider.
        </p>
        <div className="security-note">
          <LockKeyhole aria-hidden="true" />
          Passwords are one-way hashed. Session tokens are opaque, HttpOnly, and stored as hashes.
        </div>
      </div>
      <div className="form-card">
        <p className="eyebrow">{registering ? 'Create a local profile' : 'Local sign in'}</p>
        <h2>{registering ? 'Start your plan' : 'Continue your plan'}</h2>
        {error !== null && (
          <div className="alert alert-error" role="alert" tabIndex={-1}>
            <strong>
              {registering ? 'We couldn’t create your profile.' : 'We couldn’t sign you in.'}
            </strong>{' '}
            {error.message} <span className="request-id">Reference {error.requestId}</span>
          </div>
        )}
        <form onSubmit={form.handleSubmit((values) => mutation.mutate(values))} noValidate>
          {registering && (
            <label>
              Name
              <input
                autoComplete="name"
                aria-invalid={form.formState.errors.displayName !== undefined}
                {...form.register('displayName')}
              />
              {form.formState.errors.displayName !== undefined && (
                <span className="field-error">{form.formState.errors.displayName.message}</span>
              )}
            </label>
          )}
          <label>
            Email
            <input
              type="email"
              autoComplete="email"
              aria-invalid={form.formState.errors.email !== undefined}
              {...form.register('email')}
            />
            {form.formState.errors.email !== undefined && (
              <span className="field-error">{form.formState.errors.email.message}</span>
            )}
          </label>
          <label>
            Password
            <input
              type="password"
              autoComplete={registering ? 'new-password' : 'current-password'}
              aria-invalid={form.formState.errors.password !== undefined}
              {...form.register('password')}
            />
            {registering && <span className="helper">Use at least 12 characters.</span>}
            {form.formState.errors.password !== undefined && (
              <span className="field-error">{form.formState.errors.password.message}</span>
            )}
          </label>
          <button className="button full-width" type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? 'Working…' : registering ? 'Create local profile' : 'Sign in'}
            <ArrowRight aria-hidden="true" size={18} />
          </button>
        </form>
        <button
          className="text-button centered"
          type="button"
          onClick={() => setRegistering(!registering)}
        >
          {registering ? 'Already have a profile? Sign in' : 'Need a profile? Create one'}
        </button>
      </div>
    </section>
  );
}
