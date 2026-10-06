import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import Header from './components/layout/Header';
import Footer from './components/layout/Footer';
import TabNav from './components/layout/TabNav';
import { ToastProvider } from './components/ui/Toast';
import { Loading } from './components/ui/StateBlock';

// One chunk per tab — Recharts only loads when Tab 3 / 5 is opened.
const RateboardTab = lazy(() => import('./components/tab1-rateboard/RateboardTab'));
const ScoutTab = lazy(() => import('./components/tab2-scout/ScoutTab'));
const VolatilityTab = lazy(() => import('./components/tab3-volatility/VolatilityTab'));
const OtdTab = lazy(() => import('./components/tab4-otd/OtdTab'));
const PortfolioTab = lazy(() => import('./components/tab5-portfolio/PortfolioTab'));
const QuadsTab = lazy(() => import('./components/tab6-quads/QuadsTab'));

export default function App() {
  return (
    <ToastProvider>
      <div className="flex min-h-screen flex-col">
        <Header />
        <TabNav />
        <main className="mx-auto w-full max-w-[1500px] flex-1 px-3 py-4 sm:px-4">
          <Suspense fallback={<Loading label="Loading tab…" />}>
            <Routes>
              <Route path="/" element={<Navigate to="/rateboard" replace />} />
              <Route path="/rateboard" element={<RateboardTab />} />
              <Route path="/scout" element={<ScoutTab />} />
              <Route path="/volatility" element={<VolatilityTab />} />
              <Route path="/otd" element={<OtdTab />} />
              <Route path="/portfolio" element={<PortfolioTab />} />
              <Route path="/quads" element={<QuadsTab />} />
              <Route path="*" element={<Navigate to="/rateboard" replace />} />
            </Routes>
          </Suspense>
        </main>
        <Footer />
      </div>
    </ToastProvider>
  );
}
