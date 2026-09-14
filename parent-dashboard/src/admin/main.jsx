import React from 'react';
import { createRoot } from 'react-dom/client';
import AdminApp from './AdminApp.jsx';
import { DialogProvider } from '../components/Dialog.jsx';
import '../index.css';

createRoot(document.getElementById('admin-root')).render(
  <React.StrictMode>
    <DialogProvider>
      <AdminApp />
    </DialogProvider>
  </React.StrictMode>
);
