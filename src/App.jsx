import React, { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AppProvider } from './context/AppContext';
import { useAppContext } from './context/appState';
import AppLayout from './layouts/AppLayout';
import { CloudAppProvider } from './context/CloudAppProvider';
import { isLocalMode } from './lib/runtime';
import Login from './pages/Login'; // eager — needed immediately for auth gate

// Lazy-load all pages — only downloaded when the user navigates to that route
const Dashboard          = lazy(() => import('./pages/Dashboard'));
const Customers          = lazy(() => import('./pages/Customers'));
const Settings           = lazy(() => import('./pages/Settings'));
const Transactions       = lazy(() => import('./pages/Transactions'));
const AddTransactionPage = lazy(() => import('./pages/AddTransactionPage'));
const WorkingPage        = lazy(() => import('./pages/WorkingPage'));
const DuePage            = lazy(() => import('./pages/DuePage'));

// Minimal fallback — matches dark background so there's no white flash
const PageLoader = () => (
    <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
        Loading…
    </div>
);

const AppContent = () => {
  const { authSession, authLoading } = useAppContext();

  if (authLoading) return <PageLoader />;

  if (!authSession) {
    return <Login />;
  }

  return (
    <BrowserRouter>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/" element={<AppLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="customers" element={<Customers />} />
            <Route path="customers/:id" element={<WorkingPage />} />
            <Route path="transactions" element={<AddTransactionPage />} />
            <Route path="ledger" element={<Transactions />} />
            <Route path="due" element={<DuePage />} />
            <Route path="settings" element={<Settings />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
};

function App() {
  const Provider = isLocalMode ? AppProvider : CloudAppProvider;
  return (
    <Provider>
      <AppContent />
    </Provider>
  );
}

export default App;
