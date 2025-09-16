import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@/contexts/AuthContext';
import { CompanyProvider } from '@/contexts/CompanyContext';
import { AuthErrorBoundary } from '@/components/auth/AuthErrorBoundary';
import { AuthStatusIndicator } from '@/components/auth/AuthStatusIndicator';
import { enableResizeObserverErrorSuppression } from '@/utils/resizeObserverErrorHandler';
import App from './App.tsx'
import './index.css'

// Suppress ResizeObserver errors before any components render
enableResizeObserverErrorSuppression();

// Removed auto-migration imports for production safety

const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <AuthErrorBoundary>
      <AuthProvider>
        <AuthStatusIndicator />
        <CompanyProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </CompanyProvider>
      </AuthProvider>
    </AuthErrorBoundary>
  </QueryClientProvider>
);
