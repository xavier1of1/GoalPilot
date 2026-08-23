import { LogOut, Menu, Sprout } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, NavLink } from 'react-router';

import type { UserDto } from '@goalpilot/contracts';

export function Layout({
  user,
  onLogout,
  children,
}: {
  readonly user: UserDto | null;
  readonly onLogout: () => void;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, []);
  return (
    <div className="site-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <header className="site-header">
        <Link className="brand" to="/" aria-label="GoalPilot home">
          <span className="brand-mark" aria-hidden="true">
            <Sprout size={19} />
          </span>
          GoalPilot
        </Link>
        <button
          className="mobile-menu"
          type="button"
          aria-label="Toggle navigation"
          aria-expanded={open}
          aria-controls="primary-navigation"
          onClick={() => setOpen((value) => !value)}
        >
          <Menu aria-hidden="true" />
        </button>
        <nav
          id="primary-navigation"
          aria-label="Primary navigation"
          className={open ? 'nav open' : 'nav'}
        >
          <NavLink to="/plan" onClick={() => setOpen(false)}>
            Plan a goal
          </NavLink>
          {user === null ? (
            <Link className="button button-small" to="/signin" onClick={() => setOpen(false)}>
              Sign in
            </Link>
          ) : (
            <>
              <NavLink to="/dashboard" onClick={() => setOpen(false)}>
                Dashboard
              </NavLink>
              <button className="text-button" type="button" onClick={onLogout}>
                <LogOut aria-hidden="true" size={16} /> Sign out
              </button>
            </>
          )}
        </nav>
      </header>
      <main id="main-content">{children}</main>
      <footer className="site-footer">
        <span>GoalPilot local MVP</span>
        <span>No real accounts. No money movement. No live offers.</span>
      </footer>
    </div>
  );
}
