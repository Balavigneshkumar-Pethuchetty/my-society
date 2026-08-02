import React from 'react';
import { Link } from 'react-router-dom';
import { Box, Container, Divider, Grid, Typography } from '@mui/material';
import { useSociety } from '../contexts/SocietyContext';
import { NAV_BG } from '../theme';
import { ROADMAP } from '../data/roadmap';

const QUICK_LINKS = [
  { label: 'Home',             to: '/' },
  { label: 'Events',           to: '/events' },
  { label: 'My Tickets',       to: '/tickets' },
  { label: 'My Registrations', to: '/registrations' },
];

// Events & Ticketing and Visitor Management are the live services; the rest
// come from the shared roadmap so the footer never drifts out of sync with
// the Landing/Home "coming soon" lists. Ticketing isn't listed separately
// here — it's a feature of Events (QR-code entry on booking), not its own
// service, and "My Tickets" already has its own link under Quick Links.
const SERVICES = [
  { label: 'Events & Ticketing', to: '/events', live: true },
  { label: 'Visitor Management', to: '/visitors', live: true },
  ...ROADMAP.map((r) => ({ label: r.title, to: undefined, live: false })),
];

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
  const { name, shortName, city } = useSociety();
  const year = new Date().getFullYear();

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
              The official society management platform for residents of <strong style={{ color: 'rgba(203,213,225,0.85)' }}>{name}</strong>.
              Discover, register, and celebrate community life together.
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
            <Typography sx={headingSx}>Quick Links</Typography>
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
            <Typography sx={headingSx}>Services</Typography>
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
                      SOON
                    </Box>
                  </Box>
                ),
              )}
            </Box>
          </Grid>

          {/* Community */}
          <Grid item xs={12} sm={12} md={2}>
            <Typography sx={headingSx}>Community</Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {[
                { label: 'My Profile',  to: '/profile' },
                { label: 'Checkout',    to: '/checkout' },
                { label: 'Payments',    to: '/payments' },
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
            © {year} {name}. All rights reserved.
          </Typography>
          <Typography fontSize={12} sx={{ color: 'rgba(203,213,225,0.4)' }}>
            Built for the residents of {city}
          </Typography>
        </Box>
      </Container>
    </Box>
  );
}
