import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import ErrorBoundary from './components/ui/ErrorBoundary';
import { refreshAndReload } from './lib/recover';

// Vite fires this when a lazy chunk (a tab) fails to load — typically a tab left open across a deploy.
window.addEventListener('vite:preloadError', (e) => {
  e.preventDefault();
  void refreshAndReload();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary scope="app">
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
);
