import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './hooks/useAuth.jsx';
import { DialogProvider } from './components/Dialog.jsx';
import { registerServiceWorker } from './lib/push.js';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <DialogProvider>
          <App />
        </DialogProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);

// PWA service worker — powers background push notifications for parents.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    registerServiceWorker();
  });
}
