import { Component, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  readonly children: ReactNode;
}

interface ErrorBoundaryState {
  readonly failed: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public override state: ErrorBoundaryState = { failed: false };

  public static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  public override componentDidCatch(): void {
    // Recovery intentionally avoids logging component properties that may contain goal data.
  }

  public override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="dashboard-shell">
        <section className="form-card" role="alert">
          <p className="eyebrow">Local recovery</p>
          <h1>GoalPilot needs a fresh start.</h1>
          <p>
            Your saved plan remains in PostgreSQL. Reload the local interface to recover this view.
          </p>
          <button className="button" type="button" onClick={() => window.location.reload()}>
            Reload GoalPilot
          </button>
        </section>
      </main>
    );
  }
}
