import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box, Button, Card, CardContent, Chip, Container,
  Divider, Grid, Stack, Typography,
} from '@mui/material';
import LoginIcon from '@mui/icons-material/Login';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import PhoneIcon from '@mui/icons-material/Phone';
import EventIcon from '@mui/icons-material/Event';
import ConfirmationNumberIcon from '@mui/icons-material/ConfirmationNumber';
import SecurityIcon from '@mui/icons-material/Security';
import QrCodeIcon from '@mui/icons-material/QrCode';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
import HowToRegIcon from '@mui/icons-material/HowToReg';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSociety } from '../contexts/SocietyContext';
import { ROADMAP } from '../data/roadmap';
import { ServicesGrid } from '../components/ServicesGrid';

const showGoogleLogin = !!import.meta.env.VITE_GOOGLE_LOGIN;
const showPhoneLogin  = !!import.meta.env.VITE_PHONE_LOGIN;

export function Landing() {
  const { t } = useTranslation('shell');
  const { login, loginWithGoogle, register } = useAuth();
  const { name, city } = useSociety();
  const navigate = useNavigate();

  // The live services today, shown alongside the roadmap so the overview
  // section reads as "one growing platform" rather than "an events app plus
  // some ideas." Ticketing is a feature of Events (QR-code entry on booking),
  // not a separate service — it doesn't get its own card, same reasoning as
  // FEATURES below which drills into Events & Ticketing as one flow.
  const LIVE_SERVICES = [
    {
      icon: <EventIcon sx={{ fontSize: 30 }} />,
      color: '#6366f1',
      title: t('services.eventsTicketing.title'),
      desc: t('services.eventsTicketing.desc'),
    },
    {
      icon: <HowToRegIcon sx={{ fontSize: 30 }} />,
      color: '#ec4899',
      title: t('services.visitorManagement.title'),
      desc: t('services.visitorManagement.desc'),
    },
  ];

  const SERVICES_OVERVIEW = [
    ...LIVE_SERVICES.map((s) => ({ ...s, status: 'live' as const })),
    ...ROADMAP.map((r) => ({
      icon: r.icon, color: r.color,
      title: t(`services.${r.id}.title`), desc: t(`services.${r.id}.desc`),
      status: 'soon' as const,
    })),
  ];

  const FEATURES = [
    {
      icon: <ConfirmationNumberIcon sx={{ fontSize: 36 }} />,
      color: '#10b981',
      title: t('landing.featuresBookPayTitle'),
      desc: t('landing.featuresBookPayDesc'),
    },
    {
      icon: <QrCodeIcon sx={{ fontSize: 36 }} />,
      color: '#ec4899',
      title: t('landing.featuresQrTitle'),
      desc: t('landing.featuresQrDesc'),
    },
    {
      icon: <SecurityIcon sx={{ fontSize: 36 }} />,
      color: '#7c3aed',
      title: t('landing.featuresSecureTitle'),
      desc: t('landing.featuresSecureDesc'),
    },
  ];

  const STATS = [
    { value: '500+', label: t('landing.statsFamilies') },
    { value: '6', label: t('landing.statsServices') },
    { value: '24h', label: t('landing.statsApproval') },
    { value: '100%', label: t('landing.statsDigital') },
  ];

  const HOW_IT_WORKS = [
    { step: '01', icon: <PersonAddIcon sx={{ fontSize: 28 }} />, title: t('landing.howStep1Title'), desc: t('landing.howStep1Desc') },
    { step: '02', icon: <EventIcon sx={{ fontSize: 28 }} />, title: t('landing.howStep2Title'), desc: t('landing.howStep2Desc') },
    { step: '03', icon: <EmojiEventsIcon sx={{ fontSize: 28 }} />, title: t('landing.howStep3Title'), desc: t('landing.howStep3Desc') },
  ];

  return (
    <Box component="main" sx={{ bgcolor: 'background.default' }}>

      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <Box
        sx={{
          background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #312e81 100%)',
          color: '#fff',
          pt: { xs: 8, md: 12 },
          pb: { xs: 10, md: 14 },
          px: 3,
          textAlign: 'center',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Decorative circles */}
        <Box sx={{ position: 'absolute', top: -80, right: -80, width: 320, height: 320, borderRadius: '50%', bgcolor: 'rgba(99,102,241,0.12)', pointerEvents: 'none' }} />
        <Box sx={{ position: 'absolute', bottom: -60, left: -60, width: 240, height: 240, borderRadius: '50%', bgcolor: 'rgba(16,185,129,0.08)', pointerEvents: 'none' }} />

        <Container maxWidth="md" sx={{ position: 'relative' }}>
          <Typography sx={{ fontSize: { xs: 52, md: 64 }, lineHeight: 1, mb: 2.5 }}>🏛</Typography>

          <Typography
            variant="h2"
            fontWeight={900}
            sx={{
              fontSize: { xs: 28, sm: 38, md: 52 },
              lineHeight: 1.1,
              mb: 1.5,
              background: 'linear-gradient(90deg, #fff 0%, #c7d2fe 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            {name}
          </Typography>

          <Typography sx={{ fontSize: { xs: 14, md: 17 }, color: '#a5b4fc', mb: 1, fontWeight: 500, letterSpacing: 0.5 }}>
            {city}
          </Typography>
          <Typography sx={{ fontSize: { xs: 15, md: 18 }, color: '#c7d2fe', mb: 5, maxWidth: 560, mx: 'auto' }}>
            {t('landing.heroSubtitle')}
          </Typography>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} justifyContent="center" alignItems="center" sx={{ mb: 2 }}>
            <Button
              variant="contained"
              size="large"
              startIcon={<LoginIcon />}
              onClick={() => login()}
              sx={{
                px: 5, py: 1.75, fontWeight: 700, fontSize: 16,
                bgcolor: '#6366f1',
                boxShadow: '0 4px 20px rgba(99,102,241,0.5)',
                '&:hover': { bgcolor: '#4f46e5', boxShadow: '0 4px 24px rgba(99,102,241,0.7)' },
                minWidth: 180,
              }}
            >
              {t('landing.signIn')}
            </Button>
            <Button
              variant="outlined"
              size="large"
              startIcon={<PersonAddIcon />}
              onClick={register}
              sx={{
                px: 5, py: 1.75, fontWeight: 700, fontSize: 16,
                color: '#fff',
                borderColor: 'rgba(255,255,255,0.45)',
                backdropFilter: 'blur(4px)',
                '&:hover': { borderColor: '#fff', bgcolor: 'rgba(255,255,255,0.1)' },
                minWidth: 220,
              }}
            >
              {t('landing.registerAsMember')}
            </Button>
          </Stack>

          {/* Alternative sign-in options */}
          {(showGoogleLogin || showPhoneLogin) && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, justifyContent: 'center', mb: 2.5 }}>
              <Box sx={{ flex: 1, maxWidth: 120, height: '1px', bgcolor: 'rgba(255,255,255,0.18)' }} />
              <Box
                component="span"
                sx={{ color: 'rgba(165,180,252,0.7)', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}
              >
                {t('landing.orContinueWith')}
              </Box>
              <Box sx={{ flex: 1, maxWidth: 120, height: '1px', bgcolor: 'rgba(255,255,255,0.18)' }} />
            </Box>
          )}

          {showGoogleLogin && (
            <Box sx={{ display: 'flex', justifyContent: 'center', mb: 3.5 }}>
              <Button
                variant="contained"
                size="large"
                onClick={loginWithGoogle}
                sx={{
                  px: 4, py: 1.5, fontWeight: 600, fontSize: 15,
                  bgcolor: '#ffffff',
                  color: '#3c4043',
                  border: '1px solid #dadce0',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
                  borderRadius: '8px',
                  gap: 1.5,
                  textTransform: 'none',
                  '&:hover': { bgcolor: '#f8f9fa', boxShadow: '0 2px 8px rgba(0,0,0,0.18)', borderColor: '#c1c7cd' },
                  minWidth: 240,
                }}
                startIcon={
                  <Box
                    component="img"
                    src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z' fill='%234285F4'/%3E%3Cpath d='M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z' fill='%2334A853'/%3E%3Cpath d='M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z' fill='%23FBBC05'/%3E%3Cpath d='M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z' fill='%23EA4335'/%3E%3C/svg%3E"
                    alt=""
                    sx={{ width: 20, height: 20 }}
                  />
                }
              >
                {t('landing.continueWithGoogle')}
              </Button>
            </Box>
          )}

          {/* Phone-OTP login — only for accounts with an already-verified number */}
          {showPhoneLogin && (
            <Box sx={{ display: 'flex', justifyContent: 'center', mb: 3.5 }}>
              <Button
                variant="outlined"
                size="large"
                startIcon={<PhoneIcon />}
                onClick={() => navigate('/phone-login')}
                sx={{
                  px: 4, py: 1.5, fontWeight: 600, fontSize: 15,
                  color: '#a5b4fc',
                  borderColor: 'rgba(165,180,252,0.5)',
                  borderRadius: '8px',
                  textTransform: 'none',
                  '&:hover': { borderColor: '#a5b4fc', bgcolor: 'rgba(165,180,252,0.08)' },
                  minWidth: 240,
                }}
              >
                {t('landing.signInWithPhone')}
              </Button>
            </Box>
          )}

          <Typography sx={{ fontSize: 13, color: 'rgba(165,180,252,0.8)' }}>
            {t('landing.newMembersHint')}
          </Typography>

          <Typography sx={{ fontSize: 13, color: 'rgba(165,180,252,0.6)', mt: 1.5 }}>
            {t('landing.alreadyRegistered')}{' '}
            <Link
              to="/forgot-password"
              style={{ color: '#a5b4fc', textDecoration: 'underline', cursor: 'pointer' }}
            >
              {t('landing.forgotPassword')}
            </Link>
          </Typography>
        </Container>
      </Box>

      {/* ── Stats strip ──────────────────────────────────────────────── */}
      <Box sx={{ bgcolor: '#1e293b', py: 3.5 }}>
        <Container maxWidth="md">
          <Grid container spacing={0} justifyContent="center">
            {STATS.map((s, i) => (
              <React.Fragment key={s.label}>
                <Grid item xs={6} md={3}>
                  <Box sx={{ textAlign: 'center', py: { xs: 1.5, md: 0 } }}>
                    <Typography sx={{ fontSize: { xs: 28, md: 34 }, fontWeight: 900, color: '#6366f1', lineHeight: 1 }}>
                      {s.value}
                    </Typography>
                    <Typography sx={{ fontSize: 12, color: 'rgba(148,163,184,0.9)', mt: 0.5, textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 500 }}>
                      {s.label}
                    </Typography>
                  </Box>
                </Grid>
                {i < STATS.length - 1 && (
                  <Grid item sx={{ display: { xs: 'none', md: 'flex' }, alignItems: 'center' }}>
                    <Divider orientation="vertical" flexItem sx={{ borderColor: 'rgba(255,255,255,0.1)', height: 40, alignSelf: 'center' }} />
                  </Grid>
                )}
              </React.Fragment>
            ))}
          </Grid>
        </Container>
      </Box>

      {/* ── Services overview (live + roadmap, front and center) ───────── */}
      <Box sx={{ py: { xs: 7, md: 10 }, px: 3, bgcolor: 'background.default' }}>
        <Container maxWidth="lg">
          <Chip
            label={t('landing.platformChip')}
            size="small"
            sx={{
              display: 'flex', mx: 'auto', mb: 2, fontWeight: 700, fontSize: 11,
              letterSpacing: 1, bgcolor: 'rgba(99,102,241,0.1)', color: '#6366f1',
            }}
          />
          <Typography variant="h4" fontWeight={800} textAlign="center" mb={1} sx={{ fontSize: { xs: 24, md: 32 } }}>
            {t('landing.platformTitle')}
          </Typography>
          <Typography textAlign="center" color="text.secondary" fontSize={16} mb={6} maxWidth={560} mx="auto">
            {t('landing.platformSubtitle', { name })}
          </Typography>

          <ServicesGrid services={SERVICES_OVERVIEW} />

          <Typography textAlign="center" fontSize={13} color="text.secondary" mt={4}>
            {t('landing.platformCta')}
          </Typography>
        </Container>
      </Box>

      {/* ── Events service detail (what's live today) ──────────────────── */}
      <Box sx={{ py: { xs: 7, md: 10 }, px: 3, bgcolor: 'background.default', borderTop: '1px solid', borderColor: 'divider' }}>
        <Container maxWidth="lg">
          <Chip
            label={t('landing.liveNowChip')}
            size="small"
            sx={{
              display: 'flex', mx: 'auto', mb: 2, fontWeight: 700, fontSize: 11,
              letterSpacing: 1, bgcolor: 'rgba(16,185,129,0.12)', color: '#059669',
            }}
          />
          <Typography variant="h4" fontWeight={800} textAlign="center" mb={1} sx={{ fontSize: { xs: 24, md: 32 } }}>
            {t('landing.eventsDetailTitle')}
          </Typography>
          <Typography textAlign="center" color="text.secondary" fontSize={16} mb={4} maxWidth={500} mx="auto">
            {t('landing.eventsDetailSubtitle')}
          </Typography>

          <Grid container spacing={3} sx={{ mb: 4 }}>
            {FEATURES.map((f) => (
              <Grid item xs={12} sm={6} md={4} key={f.title}>
                <Card
                  variant="outlined"
                  sx={{
                    height: '100%',
                    borderRadius: 2,
                    bgcolor: 'background.paper',
                    transition: 'box-shadow 0.25s, transform 0.25s',
                    '&:hover': { boxShadow: 6, transform: 'translateY(-4px)' },
                  }}
                >
                  <CardContent sx={{ p: 3.5 }}>
                    <Box
                      sx={{
                        width: 56, height: 56, borderRadius: 2,
                        bgcolor: f.color,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: '#fff', mb: 2.5,
                      }}
                    >
                      {f.icon}
                    </Box>
                    <Typography fontWeight={700} fontSize={17} mb={1}>{f.title}</Typography>
                    <Typography fontSize={14} color="text.secondary" lineHeight={1.6}>{f.desc}</Typography>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>

          <Box sx={{ textAlign: 'center' }}>
            <Link
              to="/events"
              style={{ color: '#6366f1', fontWeight: 600, fontSize: 14, textDecoration: 'none' }}
            >
              {t('landing.seeAllEventsFeatures')}
            </Link>
          </Box>
        </Container>
      </Box>

      {/* ── How it works ─────────────────────────────────────────────── */}
      <Box sx={{ py: { xs: 7, md: 10 }, px: 3, bgcolor: 'background.default', borderTop: '1px solid', borderColor: 'divider' }}>
        <Container maxWidth="md">
          <Typography variant="h4" fontWeight={800} textAlign="center" mb={1} sx={{ fontSize: { xs: 24, md: 32 } }}>
            {t('landing.howItWorksTitle')}
          </Typography>
          <Typography textAlign="center" color="text.secondary" fontSize={15} mb={7}>
            {t('landing.howItWorksSubtitle')}
          </Typography>

          <Grid container spacing={4} alignItems="flex-start">
            {HOW_IT_WORKS.map((step) => (
              <Grid item xs={12} md={4} key={step.step}>
                <Box sx={{ textAlign: 'center', px: { md: 1 } }}>
                  {/* Step number + connector */}
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', mb: 2.5 }}>
                    <Box
                      sx={{
                        width: 64, height: 64, borderRadius: '50%',
                        background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: '#fff', boxShadow: '0 4px 16px rgba(99,102,241,0.35)',
                      }}
                    >
                      {step.icon}
                    </Box>
                  </Box>
                  <Typography
                    sx={{ fontSize: 11, fontWeight: 700, color: '#6366f1', letterSpacing: 1.5, textTransform: 'uppercase', mb: 0.75 }}
                  >
                    {t('landing.step', { n: step.step })}
                  </Typography>
                  <Typography fontWeight={700} fontSize={18} mb={1}>{step.title}</Typography>
                  <Typography fontSize={14} color="text.secondary" lineHeight={1.65}>{step.desc}</Typography>
                </Box>
              </Grid>
            ))}
          </Grid>
        </Container>
      </Box>

      {/* ── Footer ───────────────────────────────────────────────────── */}
      <Box sx={{ py: 2.5, px: 3, bgcolor: '#0f172a', textAlign: 'center' }}>
        <Typography sx={{ fontSize: 12, color: 'rgba(148,163,184,0.6)' }}>
          © {t('landing.footerCopyright', { year: new Date().getFullYear(), name, city })}
        </Typography>
      </Box>

    </Box>
  );
}
