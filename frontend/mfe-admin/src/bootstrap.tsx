import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Link, Routes, Route } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import { ThemeProvider, CssBaseline, Box, Typography } from '@mui/material';
import { createTheme } from '@mui/material/styles';
import i18n from './i18n';
import { ManageRoutes } from './ManageRoutes';
import { AdminRoutes } from './AdminRoutes';
import { SponsorApp } from './SponsorApp';
import { StandaloneAuthProvider, useStandaloneAuth } from './StandaloneAuth';

const theme = createTheme({
  palette: { primary: { main: '#6366f1' } },
  typography: { fontFamily: "'Inter', sans-serif" },
});

function DevHome() {
  return (
    <Box sx={{ p: 4 }}>
      <Typography variant="h5" fontWeight={700} sx={{ mb: 2 }}>Admin MFE — Standalone Dev</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Try these routes to preview pages:
      </Typography>
      {[
        '/manage/complimentary/test-event',
        '/manage/details/test-event',
        '/admin/users',
        '/admin/sponsors',
        '/admin/refunds',
        '/sponsor',
      ].map((r) => (
        <Box key={r} sx={{ mb: 0.5 }}>
          <Typography component={Link} to={r} fontSize={13} sx={{ color: '#6366f1', fontFamily: 'monospace' }}>{r}</Typography>
        </Box>
      ))}
    </Box>
  );
}

function StandaloneAdminRoutes() {
  const { token, login } = useStandaloneAuth();
  return <AdminRoutes token={token} onLogin={login} />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nextProvider i18n={i18n}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <StandaloneAuthProvider>
          <BrowserRouter basename={import.meta.env.BASE_URL}>
            <Routes>
              <Route path="/manage/*" element={<ManageRoutes />} />
              <Route path="/admin/*"  element={<StandaloneAdminRoutes />} />
              <Route path="/sponsor"  element={<SponsorApp firstName="Dev User" />} />
              <Route path="*"         element={<DevHome />} />
            </Routes>
          </BrowserRouter>
        </StandaloneAuthProvider>
      </ThemeProvider>
    </I18nextProvider>
  </React.StrictMode>
);
