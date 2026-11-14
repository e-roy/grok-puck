// The Listen page's entry (listen.html, served by the bridge at /listen): the same theme and
// components as the admin page.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from '@/components/app/ErrorBoundary.tsx';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ThemeProvider } from '@/lib/theme.tsx';
import { ListenPage } from './ListenPage.tsx';
import '@/index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <TooltipProvider>
        <ErrorBoundary where="the Listen page" padded>
          <ListenPage />
        </ErrorBoundary>
      </TooltipProvider>
    </ThemeProvider>
  </StrictMode>,
);
