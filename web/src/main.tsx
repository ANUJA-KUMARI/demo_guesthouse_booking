// main.tsx - the entry point Vite loads. It puts <App/> into <div id="root"> in index.html.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './auth';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  // StrictMode runs extra checks in development (it may run effects twice - that's normal).
  <StrictMode>
    {/* BrowserRouter lets us use real URLs like /bookings/5 without page reloads. */}
    <BrowserRouter>
      {/* AuthProvider wraps everything so any screen can call useAuth(). */}
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
