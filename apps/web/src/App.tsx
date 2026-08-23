import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, Route, Routes } from 'react-router';

import { api, ApiClientError } from './api.js';
import { Layout } from './components/Layout.js';
import { AuthPage } from './pages/AuthPage.js';
import { BuilderPage } from './pages/BuilderPage.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { LandingPage } from './pages/LandingPage.js';

export function App(): React.JSX.Element {
  const queryClient = useQueryClient();
  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: api.me,
    retry: false,
    staleTime: 60_000,
  });
  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
      queryClient.clear();
      window.location.assign('/');
    },
  });
  if (meQuery.isPending) {
    return (
      <Layout user={null} onLogout={() => undefined}>
        <section className="dashboard-shell" aria-busy="true" aria-label="Loading GoalPilot">
          <div className="skeleton skeleton-title" />
          <span className="sr-only">Checking your local session.</span>
        </section>
      </Layout>
    );
  }
  if (meQuery.error instanceof ApiClientError && meQuery.error.status !== 401) {
    return (
      <Layout user={null} onLogout={() => undefined}>
        <section className="empty-state spacious" role="alert">
          <h1>GoalPilot can’t reach the local API.</h1>
          <p>{meQuery.error.message}</p>
          <button className="button" type="button" onClick={() => void meQuery.refetch()}>
            Try again
          </button>
        </section>
      </Layout>
    );
  }
  const user = meQuery.data?.user ?? null;
  return (
    <Layout user={user} onLogout={() => logout.mutate()}>
      {logout.error instanceof ApiClientError && (
        <div className="alert alert-error content-width" role="alert">
          Sign out did not finish. {logout.error.message}
        </div>
      )}
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/plan" element={<BuilderPage user={user} />} />
        <Route
          path="/signin"
          element={user === null ? <AuthPage /> : <Navigate to="/dashboard" />}
        />
        <Route
          path="/dashboard"
          element={user === null ? <Navigate to="/signin" /> : <DashboardPage />}
        />
        <Route
          path="*"
          element={
            <section className="empty-state spacious">
              <h1>That route isn’t on the map.</h1>
              <a className="button" href="/">
                Return home
              </a>
            </section>
          }
        />
      </Routes>
    </Layout>
  );
}
