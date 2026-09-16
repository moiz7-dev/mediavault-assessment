import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { ErrorBoundary } from './ErrorBoundary';
import { queryClient } from './lib/queryClient';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root');

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary fallbackMessage="MediaVault hit a snag. Reloading the page should fix it.">
        <App />
      </ErrorBoundary>
    </QueryClientProvider>
  </StrictMode>,
);
