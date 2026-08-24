import { Info } from 'lucide-react';

export function Disclosure(): React.JSX.Element {
  return (
    <aside className="disclosure" aria-label="Simulation disclosure">
      <Info aria-hidden="true" size={18} />
      <p>
        <strong>Simulated Goal Plan only.</strong> No real financial account is opened and no money
        moves. Every contribution, interest entry, and activity event is simulated. Rates are
        illustrative, not live offers, and outcomes are not guaranteed. The selected assumption
        version stays fixed for reproducibility.
      </p>
    </aside>
  );
}
