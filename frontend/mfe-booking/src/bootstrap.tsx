import React from 'react';
import ReactDOM from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ThemeProvider, CssBaseline, Box, Typography } from '@mui/material';
import { createTheme } from '@mui/material/styles';
import { BookingApp } from './BookingApp';
import i18n from './i18n';

const theme = createTheme({ palette: { primary: { main: '#10b981' } } });

function DevHome() {
  return (
    <Box sx={{ p: 4 }}>
      <Typography variant="h5" fontWeight={700} sx={{ mb: 2 }}>Booking MFE — Standalone Dev</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Try these routes to preview pages:
      </Typography>
      {['/tickets'].map((r) => (
        <Box key={r} sx={{ mb: 0.5 }}>
          <Typography component="a" href={r} fontSize={13} sx={{ color: '#6366f1', fontFamily: 'monospace' }}>{r}</Typography>
        </Box>
      ))}
    </Box>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nextProvider i18n={i18n}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <BrowserRouter basename={import.meta.env.BASE_URL}>
          <Routes>
            <Route path="/tickets/*" element={<BookingApp />} />
            <Route path="*"          element={<DevHome />} />
          </Routes>
        </BrowserRouter>
      </ThemeProvider>
    </I18nextProvider>
  </React.StrictMode>
);
