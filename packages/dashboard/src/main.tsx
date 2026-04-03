import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { FeedLayout } from './layouts/FeedLayout';
import { ErrorBoundary } from './components/ErrorBoundary';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <FeedLayout />
    </ErrorBoundary>
  </StrictMode>,
);
