import { Info } from 'lucide-react';

import { illustrativeRateLabel, simulationDisclosure } from '@goalpilot/contracts';

export function Disclosure(): React.JSX.Element {
  return (
    <aside className="disclosure" aria-label="Simulation disclosure">
      <Info aria-hidden="true" size={18} />
      <p>
        <strong>{illustrativeRateLabel}</strong> {simulationDisclosure}
      </p>
    </aside>
  );
}
