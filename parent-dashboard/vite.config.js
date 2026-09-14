import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2019',
    rollupOptions: {
      // Two completely separate apps on the same Pages project:
      //   index.html   -> parent dashboard (React Router routes)
      //   admin.html   -> admin console at /setbd (served via _redirects)
      input: {
        main: 'index.html',
        admin: 'admin.html',
      },
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          supabase: ['@supabase/supabase-js'],
          // heavier libraries loaded once and cached — Plyr (media player core)
          // and Tone.js (notification/toast sounds) live in their own chunk so
          // the main bundle stays lean
          media: ['plyr', 'tone'],
        },
      },
    },
  },
});
