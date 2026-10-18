import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router';
import './styles/app.css';
import { ToastProvider, LoadingBlock } from './components/ui';
import { AppShell, MissionLayout } from './components/Shell';
import { MissionsPage } from './pages/MissionsPage';
import { MissionFormPage } from './pages/MissionFormPage';
import { OverviewPage } from './pages/OverviewPage';
import { ProcurementPage } from './pages/ProcurementPage';
import { EvidencePage } from './pages/EvidencePage';
import { SecurityPage } from './pages/SecurityPage';
import { PaymentsPage } from './pages/PaymentsPage';
import { CheckoutReturnPage } from './pages/CheckoutReturnPage';
import { AuditPage } from './pages/AuditPage';
import { ReportPage } from './pages/ReportPage';
import { IntegrationsPage } from './pages/IntegrationsPage';

// Heavy third-party UIs load on demand.
const DecisionCenterPage = lazy(() => import('./pages/DecisionCenterPage'));
const SchedulePage = lazy(() => import('./pages/SchedulePage'));
const lazyPage = (el: React.ReactNode) => (
  <Suspense
    fallback={
      <div className="content">
        <LoadingBlock rows={6} />
      </div>
    }
  >
    {el}
  </Suspense>
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: (count, err) => count < 2 && !(err as { status?: number }).status,
    },
    mutations: { retry: false },
  },
});

const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { index: true, element: <MissionsPage autoOpen /> },
      { path: 'missions', element: <MissionsPage /> },
      { path: 'missions/new', element: <MissionFormPage /> },
      { path: 'integrations', element: <IntegrationsPage /> },
      {
        path: 'missions/:missionId',
        element: <MissionLayout />,
        children: [
          { index: true, element: <OverviewPage /> },
          { path: 'edit', element: <MissionFormPage edit /> },
          { path: 'procurement', element: <ProcurementPage /> },
          { path: 'evidence', element: <EvidencePage /> },
          { path: 'decision-center', element: lazyPage(<DecisionCenterPage />) },
          { path: 'schedule', element: lazyPage(<SchedulePage />) },
          { path: 'security', element: <SecurityPage /> },
          { path: 'payments', element: <PaymentsPage /> },
          { path: 'checkout', element: <CheckoutReturnPage /> },
          { path: 'audit', element: <AuditPage /> },
          { path: 'report', element: <ReportPage /> },
        ],
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
