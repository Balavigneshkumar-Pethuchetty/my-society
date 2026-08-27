import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import federation from '@originjs/vite-plugin-federation';

export default defineConfig(({ command, mode }) => ({
  plugins: [
    react(),
    federation({
      name: 'shell',
      remotes: {
        mfe_admin: command === 'serve' && mode === 'development'
          ? 'http://localhost:4004/assets/remoteEntry.js'
          : '/mfe-admin/assets/remoteEntry.js',
        mfe_events: command === 'serve' && mode === 'development'
          ? 'http://localhost:4001/assets/remoteEntry.js'
          : '/mfe-events/assets/remoteEntry.js',
        mfe_booking: command === 'serve' && mode === 'development'
          ? 'http://localhost:4002/assets/remoteEntry.js'
          : '/mfe-booking/assets/remoteEntry.js',
        mfe_payment: command === 'serve' && mode === 'development'
          ? 'http://localhost:4003/assets/remoteEntry.js'
          : '/mfe-payment/assets/remoteEntry.js',
        mfe_tickets: command === 'serve' && mode === 'development'
          ? 'http://localhost:4005/assets/remoteEntry.js'
          : '/mfe-tickets/assets/remoteEntry.js',
        mfe_visitors: command === 'serve' && mode === 'development'
          ? 'http://localhost:4006/assets/remoteEntry.js'
          : '/mfe-visitors/assets/remoteEntry.js',
      },
      // Cast to any to satisfy type differences between plugin SharedConfig and our desired options
      shared: {
        react:             { singleton: true, eager: true, requiredVersion: '^18.3.1' },
        'react-dom':       { singleton: true, eager: true, requiredVersion: '^18.3.1' },
        'react-router-dom':{ singleton: true, eager: true, requiredVersion: '^6.24.1' },
        '@mui/material':   { singleton: true, eager: true, requiredVersion: '^5.16.7' },
        '@emotion/react':  { singleton: true, eager: true, requiredVersion: '^11.13.0' },
        '@emotion/styled': { singleton: true, eager: true, requiredVersion: '^11.13.0' },
        // Shared as a singleton so a language change made in the shell (or any
        // MFE) is reflected everywhere instantly — every remote's
        // useTranslation() reads off the exact same runtime i18next instance.
        // See src/i18n/index.ts.
        i18next:           { singleton: true, eager: true, requiredVersion: '^26.3.6' },
        'react-i18next':   { singleton: true, eager: true, requiredVersion: '^17.0.11' },
      } as any,
    }),
  ],
  server: {
    port: 3000,
    host: true,
  },
  build: {
    target: 'esnext',
    modulePreload: false,
    minify: mode === 'production',
    cssCodeSplit: false,
  },
}));
