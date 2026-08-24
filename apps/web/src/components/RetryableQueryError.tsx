import { ApiClientError } from '../api.js';

export function RetryableQueryError({
  label,
  error,
  description = 'Check that the local API is available, then try again.',
  onRetry,
}: {
  readonly label: string;
  readonly error: unknown;
  readonly description?: string;
  readonly onRetry: () => unknown;
}): React.JSX.Element {
  return (
    <div className="inline-state" role="alert">
      <strong>{label} could not load.</strong>
      <p>{description}</p>
      {error instanceof Error && <span>{error.message}</span>}
      {error instanceof ApiClientError && <small>Request ID: {error.requestId}</small>}
      <button className="text-button" type="button" onClick={() => void onRetry()}>
        Try again
      </button>
    </div>
  );
}
