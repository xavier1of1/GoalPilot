import { ArrowRight, BadgeCheck, CalendarClock, LineChart, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router';

import { Disclosure } from '../components/Disclosure.js';

export function LandingPage(): React.JSX.Element {
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">A calmer way to plan a big purchase</p>
          <h1>Turn “someday” into a savings route you can follow.</h1>
          <p className="hero-intro">
            See the contribution you need, compare transparent interest models, and practice a
            set-and-forget plan—without connecting a bank.
          </p>
          <div className="hero-actions">
            <Link className="button" to="/plan">
              Build my plan <ArrowRight aria-hidden="true" size={18} />
            </Link>
            <a className="secondary-link" href="#how-it-works">
              See how it works
            </a>
          </div>
          <div className="trust-row" aria-label="Product safeguards">
            <span>
              <ShieldCheck aria-hidden="true" /> Local and private
            </span>
            <span>
              <BadgeCheck aria-hidden="true" /> Deterministic math
            </span>
          </div>
        </div>
        <div className="hero-card" aria-label="Example goal progress">
          <div className="hero-card-top">
            <span>Japan in spring</span>
            <span className="status-pill">On track</span>
          </div>
          <p className="hero-number">$4,240</p>
          <p className="muted">of $6,000 saved in this example</p>
          <div
            className="progress-track"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={71}
            aria-label="Example progress: 71 percent"
          >
            <span style={{ width: '71%' }} />
          </div>
          <dl className="metric-grid">
            <div>
              <dt>Next step</dt>
              <dd>$440 monthly</dd>
            </div>
            <div>
              <dt>Modeled interest</dt>
              <dd>$84</dd>
            </div>
          </dl>
          <p className="microcopy">Example only · Illustrative rate, not a live offer.</p>
        </div>
      </section>

      <section className="section" id="how-it-works">
        <div className="section-heading">
          <p className="eyebrow">How it works</p>
          <h2>A useful answer in three clear steps.</h2>
        </div>
        <div className="steps-grid">
          <article>
            <CalendarClock aria-hidden="true" />
            <span className="step-number">01</span>
            <h3>Set the destination</h3>
            <p>Name the purchase, amount, deadline, and the rhythm that works for you.</p>
          </article>
          <article>
            <LineChart aria-hidden="true" />
            <span className="step-number">02</span>
            <h3>Compare the routes</h3>
            <p>Start with contributions alone, then see four transparent illustrative models.</p>
          </article>
          <article>
            <ShieldCheck aria-hidden="true" />
            <span className="step-number">03</span>
            <h3>Practice the plan</h3>
            <p>Activate a simulated account and watch contributions and modeled interest add up.</p>
          </article>
        </div>
      </section>
      <div className="content-width">
        <Disclosure />
      </div>
    </>
  );
}
