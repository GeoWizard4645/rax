import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import ErrorBoundary from './components/ui/ErrorBoundary';
import Header from './components/layout/Header';
import Footer from './components/layout/Footer';
import TabNav from './components/layout/TabNav';
import LimitationsBanner from './components/layout/LimitationsBanner';
import { ToastProvider } from './components/ui/Toast';
import { Loading } from './components/ui/StateBlock';
import ChatWidget from './components/agent/ChatWidget';

// One chunk per tab — Recharts only loads when Tab 3 / 5 is opened.
const RateboardTab = lazy(() => import('./components/tab1-rateboard/RateboardTab'));
const ScoutTab = lazy(() => import('./components/tab2-scout/ScoutTab'));
const VolatilityTab = lazy(() => import('./components/tab3-volatility/VolatilityTab'));
const PortfolioTab = lazy(() => import('./components/tab5-portfolio/PortfolioTab'));
const QuadsTab = lazy(() => import('./components/tab6-quads/QuadsTab'));
const EfficiencyTab = lazy(() => import('./components/tab7-efficiency/EfficiencyTab'));
const CalendarTab = lazy(() => import('./components/tab8-calendar/CalendarTab'));
const EdgeTab = lazy(() => import('./components/tab9-edge/EdgeTab'));

export default function App() {
  const { pathname } = useLocation();
  return (
    <ToastProvider>
      <div className="flex min-h-screen flex-col">
        <Header />
        <TabNav />
        <LimitationsBanner />
        <main className="mx-auto w-full max-w-[1500px] flex-1 px-3 py-4 sm:px-4">
          {/* keyed by route: a crash in one tab leaves the header/nav usable and clears when you navigate */}
          <ErrorBoundary key={pathname}>
          <Suspense fallback={<Loading label="Loading tab…" />}>
            <Routes>
              <Route path="/" element={<Navigate to="/rateboard" replace />} />
              <Route path="/rateboard" element={<RateboardTab />} />
              <Route path="/scout" element={<ScoutTab />} />
              <Route path="/volatility" element={<VolatilityTab />} />
              <Route path="/otd" element={<Navigate to="/efficiency" replace />} />
              <Route path="/portfolio" element={<PortfolioTab />} />
              <Route path="/quads" element={<QuadsTab />} />
              <Route path="/efficiency" element={<EfficiencyTab />} />
              <Route path="/calendar" element={<CalendarTab />} />
              <Route path="/edge" element={<EdgeTab />} />
              <Route path="*" element={<Navigate to="/rateboard" replace />} />
            </Routes>
          </Suspense>
          </ErrorBoundary>
        </main>
        <Footer />
      </div>
      <ChatWidget />
    </ToastProvider>
  );
}
