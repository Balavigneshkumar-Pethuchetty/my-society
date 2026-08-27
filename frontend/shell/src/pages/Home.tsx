import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  Accordion, AccordionDetails, AccordionSummary,
  Box, Button, Container, Typography,
} from '@mui/material';
import EventIcon from '@mui/icons-material/Event';
import ConfirmationNumberIcon from '@mui/icons-material/ConfirmationNumber';
import PaymentsIcon from '@mui/icons-material/Payments';
import EditCalendarIcon from '@mui/icons-material/EditCalendar';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner';
import FactCheckIcon from '@mui/icons-material/FactCheck';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import MonetizationOnIcon from '@mui/icons-material/MonetizationOn';
import BadgeIcon from '@mui/icons-material/Badge';
import MeetingRoomIcon from '@mui/icons-material/MeetingRoom';
import ListAltIcon from '@mui/icons-material/ListAlt';
import HowToRegIcon from '@mui/icons-material/HowToReg';
import { useAuth } from '../contexts/AuthContext';
import { useSociety } from '../contexts/SocietyContext';
import { useUserService } from '../contexts/UserServiceContext';
import { ROADMAP } from '../data/roadmap';
import { ServicesGrid, ServiceTile } from '../components/ServicesGrid';

type Slot = { icon: React.ReactNode; title: string; desc: string; path: string; cta: string; color: string };
// `id` maps to home.slots.<id>.{title,desc,cta} in the i18n locale files.
type SlotBase = { id: string; icon: React.ReactNode; path: string; color: string };

function translateSlot(t: TFunction, base: SlotBase): Slot {
  return {
    icon: base.icon,
    path: base.path,
    color: base.color,
    title: t(`home.slots.${base.id}.title`),
    desc: t(`home.slots.${base.id}.desc`),
    cta: t(`home.slots.${base.id}.cta`),
  };
}

// Base card info for the two live services — role-specific quick actions
// get attached to these (as `actions`) inside Home() and rendered inline in
// the card by ServicesGrid, instead of in a separate section below the grid.
const EVENTS_SERVICE_BASE_ID = 'eventsTicketing';
const EVENTS_SERVICE_ICON = <EventIcon sx={{ fontSize: 30 }} />;
const EVENTS_SERVICE_COLOR = '#6366f1';

const VISITOR_SERVICE_BASE_ID = 'visitorManagement';
const VISITOR_SERVICE_ICON = <HowToRegIcon sx={{ fontSize: 30 }} />;
const VISITOR_SERVICE_COLOR = '#ec4899';

// Event Management & Ticketing slots — kept in their own section, separate
// from Visitor Management, per role.
const RESIDENT_EVENT_SLOTS: SlotBase[] = [
  { id: 'events',       icon: <EventIcon sx={{ fontSize: 28 }} />,              path: '/events',   color: '#6366f1' },
  { id: 'myTickets',    icon: <ConfirmationNumberIcon sx={{ fontSize: 28 }} />, path: '/tickets',  color: '#10b981' },
  { id: 'payments',     icon: <PaymentsIcon sx={{ fontSize: 28 }} />,           path: '/payments', color: '#f59e0b' },
];

const COMMITTEE_EVENT_EXTRA: SlotBase[] = [
  { id: 'manageEvents', icon: <EditCalendarIcon sx={{ fontSize: 28 }} />,       path: '/manage',   color: '#0ea5e9' },
];

const ADMIN_EVENT_EXTRA: SlotBase[] = [
  { id: 'adminPanel',   icon: <AdminPanelSettingsIcon sx={{ fontSize: 28 }} />, path: '/admin',    color: '#7c3aed' },
];

const GUARD_EVENT_SLOTS: SlotBase[] = [
  { id: 'qrScanner',      icon: <QrCodeScannerIcon sx={{ fontSize: 28 }} />, path: '/scanner',   color: '#10b981' },
  { id: 'entryLog',       icon: <FactCheckIcon sx={{ fontSize: 28 }} />,     path: '/entry-log', color: '#6366f1' },
  { id: 'eventsViewOnly', icon: <EventIcon sx={{ fontSize: 28 }} />,         path: '/events',    color: '#94a3b8' },
];

const SPONSOR_EVENT_SLOTS: SlotBase[] = [
  { id: 'mySponsorships', icon: <MonetizationOnIcon sx={{ fontSize: 28 }} />, path: '/sponsor', color: '#7c3aed' },
  { id: 'browseEvents',   icon: <EventIcon sx={{ fontSize: 28 }} />,          path: '/events',  color: '#6366f1' },
];

// Visitor Management slots — its own section, never mixed into the events
// menus/options above.
const RESIDENT_VISITOR_SLOTS: SlotBase[] = [
  { id: 'visitorPasses', icon: <BadgeIcon sx={{ fontSize: 28 }} />,       path: '/visitors',        color: '#ec4899' },
];

const COMMITTEE_VISITOR_EXTRA: SlotBase[] = [
  { id: 'visitorLedger', icon: <ListAltIcon sx={{ fontSize: 28 }} />,     path: '/visitors/ledger', color: '#0891b2' },
];

const GUARD_VISITOR_SLOTS: SlotBase[] = [
  { id: 'visitorGate',   icon: <MeetingRoomIcon sx={{ fontSize: 28 }} />, path: '/visitors/gate',   color: '#ec4899' },
];

function useMfeSlots(role: string, t: TFunction): { events: Slot[]; visitor: Slot[] } {
  const tr = (slots: SlotBase[]) => slots.map((s) => translateSlot(t, s));
  if (role === 'security_guard') return { events: tr(GUARD_EVENT_SLOTS), visitor: tr(GUARD_VISITOR_SLOTS) };
  if (role === 'sponsor')        return { events: tr(SPONSOR_EVENT_SLOTS), visitor: [] };
  if (role === 'admin') {
    return {
      events: tr([...RESIDENT_EVENT_SLOTS, ...COMMITTEE_EVENT_EXTRA, ...ADMIN_EVENT_EXTRA]),
      visitor: tr([...RESIDENT_VISITOR_SLOTS, ...COMMITTEE_VISITOR_EXTRA]),
    };
  }
  if (role === 'committee_member') {
    return {
      events: tr([...RESIDENT_EVENT_SLOTS, ...COMMITTEE_EVENT_EXTRA]),
      visitor: tr([...RESIDENT_VISITOR_SLOTS, ...COMMITTEE_VISITOR_EXTRA]),
    };
  }
  return { events: tr(RESIDENT_EVENT_SLOTS), visitor: tr(RESIDENT_VISITOR_SLOTS) };
}

const DEBUG_ROWS = (
  user: ReturnType<typeof useAuth>['user'],
  dbUser: ReturnType<typeof useUserService>['dbUser'],
) => [
  ['Name',              user?.name],
  ['Email',             user?.email],
  ['Sub (keycloak)',    user?.sub],
  ['Roles',             user?.roles.join(', ')],
  ['Primary role',      user?.primaryRole],
  ['DB user ID',        dbUser?.id ?? '—'],
  ['DB role',           dbUser?.role ?? '—'],
  ['Phone',             dbUser?.phone ?? '—'],
  ['Apartments',        dbUser?.apartments.length
                          ? dbUser.apartments.map((a) => `Block ${a.block} — ${a.unit_number} (${a.type})`).join(', ')
                          : '—'],
] as const;

export function Home() {
  const { t }               = useTranslation('shell');
  const { user }           = useAuth();
  const { name, city }     = useSociety();
  const { dbUser }         = useUserService();
  const firstName          = user?.name.split(' ')[0] ?? 'there';
  const role               = user?.primaryRole ?? 'resident';
  const roleHint           = t(`home.roleWelcome.${role}`);
  const { events: eventSlots, visitor: visitorSlots } = useMfeSlots(role, t);
  const apt                = dbUser?.apartments[0];

  // Live service cards carry their own role-specific quick actions inline
  // (rendered by ServicesGrid) instead of separate sections below the grid.
  const liveServices: ServiceTile[] = [
    {
      icon: EVENTS_SERVICE_ICON, color: EVENTS_SERVICE_COLOR,
      title: t(`services.${EVENTS_SERVICE_BASE_ID}.title`), desc: t(`services.${EVENTS_SERVICE_BASE_ID}.desc`),
      status: 'live', actions: eventSlots,
    },
    ...(visitorSlots.length > 0
      ? [{
          icon: VISITOR_SERVICE_ICON, color: VISITOR_SERVICE_COLOR,
          title: t(`services.${VISITOR_SERVICE_BASE_ID}.title`), desc: t(`services.${VISITOR_SERVICE_BASE_ID}.desc`),
          status: 'live' as const, actions: visitorSlots,
        }]
      : []),
  ];
  const servicesOverview: ServiceTile[] = role === 'security_guard'
    ? liveServices
    : [...liveServices, ...ROADMAP.map((r) => ({
        icon: r.icon, color: r.color,
        title: t(`services.${r.id}.title`), desc: t(`services.${r.id}.desc`),
        status: 'soon' as const,
      }))];

  return (
    <Box component="main">

      {/* Hero */}
      <Box sx={{ background: 'linear-gradient(135deg,#1e293b 0%,#312e81 100%)', color: '#fff', py: { xs: 5, md: 8 }, px: 3 }}>
        <Container maxWidth="lg">
          <Typography sx={{ fontSize: 13, color: '#a5b4fc', fontWeight: 500, mb: 1, letterSpacing: 0.5 }}>
            {name} · {city}
          </Typography>
          <Typography variant="h4" fontWeight={800} sx={{ lineHeight: 1.15, mb: 1.25, fontSize: { xs: 26, md: 36 } }}>
            {t('home.welcomeBack', { name: firstName })}
          </Typography>
          <Typography sx={{ fontSize: 16, color: '#c7d2fe', mb: apt ? 2 : 3.5 }}>{roleHint}</Typography>
          {apt && (
            <Typography sx={{ fontSize: 13, color: '#a5b4fc', mb: 3, display: 'flex', alignItems: 'center', gap: 0.75 }}>
              {t('home.unitLine', { block: apt.block, unit: apt.unit_number, type: apt.type })}
            </Typography>
          )}
          <Button
            component={Link}
            to="/events"
            variant="contained"
            size="large"
            sx={{ fontWeight: 600, px: 3.5, bgcolor: 'primary.main', '&:hover': { bgcolor: '#4f46e5' } }}
          >
            {t('home.browseEventsCta')}
          </Button>
        </Container>
      </Box>

      {/* Society services — Events & Ticketing and Visitor Management cards
          carry their own quick actions inline, so residents don't need to
          scroll past a separate "quick actions" section to find them. */}
      <Box sx={{ py: 6, px: { xs: 2, sm: 3 } }}>
        <Container maxWidth="lg">
          <Typography variant="h6" fontWeight={700} sx={{ mb: 0.5 }}>
            {role === 'security_guard' ? t('home.sectionTitleGuard') : t('home.sectionTitleAll')}
          </Typography>
          <Typography fontSize={14} color="text.secondary" sx={{ mb: 3 }}>
            {role === 'security_guard' ? t('home.sectionSubtitleGuard') : t('home.sectionSubtitleAll')}
          </Typography>
          <ServicesGrid services={servicesOverview} />
        </Container>
      </Box>

      {/* Debug panel — dev and test only */}
      {['dev', 'test'].includes(import.meta.env.VITE_APP_ENV) && <Box sx={{ bgcolor: '#f0fdf4', borderTop: '1px solid #bbf7d0', py: 2 }}>
        <Container maxWidth="lg">
          <Accordion disableGutters elevation={0} sx={{ bgcolor: 'transparent' }}>
            <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ color: '#166534' }} />} sx={{ px: 0 }}>
              <Typography fontSize={13} fontWeight={600} color="#166534">
                🔑 Token details (dev only)
              </Typography>
            </AccordionSummary>
            <AccordionDetails sx={{ px: 0, pt: 0 }}>
              {DEBUG_ROWS(user, dbUser).map(([label, val]) => (
                <Box key={label} sx={{ display: 'flex', alignItems: 'baseline', gap: 1.5, mb: 0.75 }}>
                  <Typography fontSize={13} color="text.secondary" sx={{ minWidth: 160, flexShrink: 0 }}>{label}</Typography>
                  <Box component="code" sx={{ bgcolor: '#dcfce7', px: 0.75, py: 0.25, borderRadius: 0.5, fontSize: 12, fontFamily: "'Fira Code', monospace", color: '#166534', wordBreak: 'break-all' }}>
                    {val}
                  </Box>
                </Box>
              ))}
            </AccordionDetails>
          </Accordion>
        </Container>
      </Box>}

    </Box>
  );
}
