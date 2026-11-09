import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { ErrorBoundary } from './components/app/ErrorBoundary.tsx';
import { TooltipProvider } from './components/ui/tooltip';
import { ThemeProvider } from './lib/theme.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <TooltipProvider>
        <ErrorBoundary where="the page" padded>
          <App />
        </ErrorBoundary>
      </TooltipProvider>
    </ThemeProvider>
  </StrictMode>,
);
