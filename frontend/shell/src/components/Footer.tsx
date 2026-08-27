import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Box, Container, Divider, Grid, Typography } from '@mui/material';
import { useSociety } from '../contexts/SocietyContext';
import { NAV_BG } from '../theme';
import { ROADMAP } from '../data/roadmap';

const linkSx = {
  color: 'rgba(203,213,225,0.65)',
  fontSize: 14,
  transition: 'color 0.15s',
  '&:hover': { color: '#fff' },
};

const headingSx = {
  fontWeight: 700,
  fontSize: 11,
  color: 'rgba(203,213,225,0.45)',
  textTransform: 'uppercase' as const,
  letterSpacing: 1.2,
  mb: 1.5,
};

export function Footer() {
  const { t } = useTranslation('shell');
  const { name, shortName, city } = useSociety();
  const year = new Date().getFullYear();

  const QUICK_LINKS = [
    { label: t('nav.home'),             to: '/' },
    { label: t('nav.events'),           to: '/events' },
    { label: t('nav.myTickets'),        to: '/tickets' },
    { label: t('nav.myRegistrations'),  to: '/registrations' },
  ];

  // Events & Ticketing and Visitor Management are the live services; the rest
  // come from the shared roadmap so the footer never drifts out of sync with
  // the Landing/Home "coming soon" lists. Ticketing isn't listed separately
  // here — it's a feature of Events (QR-code entry on booking), not its own
  // service, and "My Tickets" already has its own link under Quick Links.
  const SERVICES = [
    { label: t('services.eventsTicketing.title'), to: '/events', live: true },
    { label: t('services.visitorManagement.title'), to: '/visitors', live: true },
    ...ROADMAP.map((r) => ({ label: t(`services.${r.id}.title`), to: undefined, live: false })),
  ];

  return (
    <Box
      component="footer"
      sx={{ bgcolor: NAV_BG, color: 'rgba(203,213,225,0.9)', mt: 'auto', pt: 5, pb: 3 }}
    >
      <Container maxWidth="lg">
        <Grid container spacing={4}>

          {/* Brand */}
          <Grid item xs={12} sm={5} md={4}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
              <span style={{ fontSize: 22 }}>🏛</span>
              <Typography fontWeight={700} fontSize={16} color="#fff">{name}</Typography>
            </Box>
            <Typography variant="body2" sx={{ color: 'rgba(203,213,225,0.65)', lineHeight: 1.75, maxWidth: 300 }}>
              {t('footer.tagline', { name })}
            </Typography>
            <Box sx={{ display: 'flex', gap: 1.5, mt: 2 }}>
              <Box sx={{ px: 1.5, py: 0.5, borderRadius: 1, bgcolor: 'rgba(99,102,241,0.18)', border: '1px solid rgba(99,102,241,0.3)' }}>
                <Typography fontSize={11} fontWeight={600} color="#a5b4fc">{shortName}</Typography>
              </Box>
              <Box sx={{ px: 1.5, py: 0.5, borderRadius: 1, bgcolor: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)' }}>
                <Typography fontSize={11} fontWeight={600} color="#6ee7b7">{city}</Typography>
              </Box>
            </Box>
          </Grid>

          {/* Quick Links */}
          <Grid item xs={6} sm={3} md={3}>
            <Typography sx={headingSx}>{t('footer.quickLinks')}</Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {QUICK_LINKS.map((l) => (
                <Box key={l.to} component={Link} to={l.to} sx={linkSx}>
                  {l.label}
                </Box>
              ))}
            </Box>
          </Grid>

          {/* Services — the one live service plus what's coming next */}
          <Grid item xs={6} sm={4} md={3}>
            <Typography sx={headingSx}>{t('footer.servicesHeading')}</Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {SERVICES.map((s) =>
                s.live ? (
                  <Box key={s.label} component={Link} to={s.to!} sx={linkSx}>
                    {s.label}
                  </Box>
                ) : (
                  <Box key={s.label} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, fontSize: 14, color: 'rgba(203,213,225,0.4)' }}>
                    {s.label}
                    <Box
                      component="span"
                      sx={{
                        fontSize: 9, fontWeight: 700, letterSpacing: 0.5, lineHeight: 1.6,
                        px: 0.6, borderRadius: 4,
                        border: '1px dashed rgba(203,213,225,0.3)',
                        color: 'rgba(203,213,225,0.5)',
                      }}
                    >
                      {t('common.soon')}
                    </Box>
                  </Box>
                ),
              )}
            </Box>
          </Grid>

          {/* Community */}
          <Grid item xs={12} sm={12} md={2}>
            <Typography sx={headingSx}>{t('footer.community')}</Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {[
                { label: t('footer.myProfile'),  to: '/profile' },
                { label: t('footer.checkout'),    to: '/checkout' },
                { label: t('footer.payments'),    to: '/payments' },
              ].map((l) => (
                <Box key={l.to} component={Link} to={l.to} sx={linkSx}>
                  {l.label}
                </Box>
              ))}
            </Box>
          </Grid>
        </Grid>

        <Divider sx={{ borderColor: 'rgba(255,255,255,0.07)', my: 3.5 }} />

        <Box
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 1,
          }}
        >
          <Typography fontSize={12} sx={{ color: 'rgba(203,213,225,0.4)' }}>
            {t('footer.allRightsReserved', { year, name })}
          </Typography>
          <Typography fontSize={12} sx={{ color: 'rgba(203,213,225,0.4)' }}>
            {t('footer.builtFor', { city })}
          </Typography>
        </Box>
      </Container>
    </Box>
  );
}
