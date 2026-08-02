import React from 'react';
import { Link } from 'react-router-dom';
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

// Base card info for the two live services — role-specific quick actions
// get attached to these (as `actions`) inside Home() and rendered inline in
// the card by ServicesGrid, instead of in a separate section below the grid.
const EVENTS_SERVICE_BASE = {
  icon: <EventIcon sx={{ fontSize: 30 }} />,
  color: '#6366f1',
  title: 'Events & Ticketing',
  desc: 'Browse, book and attend community events with digital QR-code tickets for gate entry.',
};

const VISITOR_SERVICE_BASE = {
  icon: <HowToRegIcon sx={{ fontSize: 30 }} />,
  color: '#ec4899',
  title: 'Visitor Management',
  desc: 'Residents create QR visitor passes for guests; security scans them at the gate or logs walk-ins directly.',
};

// Event Management & Ticketing slots — kept in their own section, separate
// from Visitor Management, per role.
const RESIDENT_EVENT_SLOTS: Slot[] = [
  { icon: <EventIcon sx={{ fontSize: 28 }} />,             title: 'Events',         desc: 'Browse upcoming festivals, sports days, wellness sessions and more.',        path: '/events',   cta: 'Browse Events',     color: '#6366f1' },
  { icon: <ConfirmationNumberIcon sx={{ fontSize: 28 }} />, title: 'My Tickets',    desc: 'View your registrations and show the QR code at the gate.',                  path: '/tickets',  cta: 'View Tickets',      color: '#10b981' },
  { icon: <PaymentsIcon sx={{ fontSize: 28 }} />,           title: 'Payments',      desc: 'Check payment history and manage refunds.',                                  path: '/payments', cta: 'Payment History',   color: '#f59e0b' },
];

const COMMITTEE_EVENT_EXTRA: Slot[] = [
  { icon: <EditCalendarIcon sx={{ fontSize: 28 }} />,       title: 'Manage Events', desc: 'Create, publish and manage events. Post announcements to registered users.', path: '/manage',   cta: 'Go to Event Manager', color: '#0ea5e9' },
];

const ADMIN_EVENT_EXTRA: Slot[] = [
  { icon: <AdminPanelSettingsIcon sx={{ fontSize: 28 }} />, title: 'Admin Panel',   desc: 'User roles, revenue reports, categories and society settings.',              path: '/admin',    cta: 'Open Admin Panel',  color: '#7c3aed' },
];

const GUARD_EVENT_SLOTS: Slot[] = [
  { icon: <QrCodeScannerIcon sx={{ fontSize: 28 }} />,  title: 'QR Scanner',       desc: 'Scan resident tickets at the entry gate to mark attendance.',                                path: '/scanner',  cta: 'Open Scanner',         color: '#10b981' },
  { icon: <FactCheckIcon sx={{ fontSize: 28 }} />,      title: 'Entry Log',        desc: "Today's attendance log — who has checked in and when.",                                      path: '/entry-log', cta: 'View Entry Log',      color: '#6366f1' },
  { icon: <EventIcon sx={{ fontSize: 28 }} />,          title: 'Events',           desc: 'Browse upcoming events (view only).',                                                        path: '/events',   cta: 'Browse Events',         color: '#94a3b8' },
];

const SPONSOR_EVENT_SLOTS: Slot[] = [
  { icon: <MonetizationOnIcon sx={{ fontSize: 28 }} />, title: 'My Sponsorships', desc: 'View events you are sponsoring, track contribution status, and raise refund requests.', path: '/sponsor',  cta: 'View Sponsorships',     color: '#7c3aed' },
  { icon: <EventIcon sx={{ fontSize: 28 }} />,          title: 'Browse Events',   desc: 'Explore upcoming community events to discover sponsorship opportunities.',                path: '/events',   cta: 'Browse Events',         color: '#6366f1' },
];

// Visitor Management slots — its own section, never mixed into the events
// menus/options above.
const RESIDENT_VISITOR_SLOTS: Slot[] = [
  { icon: <BadgeIcon sx={{ fontSize: 28 }} />,              title: 'Visitor Passes', desc: 'Create QR visitor passes for guests and track entry/exit.',                 path: '/visitors', cta: 'Manage Visitors',   color: '#ec4899' },
];

const COMMITTEE_VISITOR_EXTRA: Slot[] = [
  { icon: <ListAltIcon sx={{ fontSize: 28 }} />,            title: 'Visitor Ledger', desc: 'Review visitor logs, photos, and export reports.',                          path: '/visitors/ledger', cta: 'Open Ledger',  color: '#0891b2' },
];

const GUARD_VISITOR_SLOTS: Slot[] = [
  { icon: <MeetingRoomIcon sx={{ fontSize: 28 }} />,    title: 'Visitor Gate',     desc: 'Scan visitor passes, log walk-ins, capture photos, and verify identity.',                     path: '/visitors/gate', cta: 'Open Visitor Gate', color: '#ec4899' },
];

function useMfeSlots(role: string): { events: Slot[]; visitor: Slot[] } {
  if (role === 'security_guard') return { events: GUARD_EVENT_SLOTS, visitor: GUARD_VISITOR_SLOTS };
  if (role === 'sponsor')        return { events: SPONSOR_EVENT_SLOTS, visitor: [] };
  if (role === 'admin') {
    return {
      events: [...RESIDENT_EVENT_SLOTS, ...COMMITTEE_EVENT_EXTRA, ...ADMIN_EVENT_EXTRA],
      visitor: [...RESIDENT_VISITOR_SLOTS, ...COMMITTEE_VISITOR_EXTRA],
    };
  }
  if (role === 'committee_member') {
    return {
      events: [...RESIDENT_EVENT_SLOTS, ...COMMITTEE_EVENT_EXTRA],
      visitor: [...RESIDENT_VISITOR_SLOTS, ...COMMITTEE_VISITOR_EXTRA],
    };
  }
  return { events: RESIDENT_EVENT_SLOTS, visitor: RESIDENT_VISITOR_SLOTS };
}

const ROLE_WELCOME: Record<string, string> = {
  admin:            'You have full admin access across your society\'s services — starting with events, and growing.',
  committee_member: 'Create and manage events, and register for them just like any resident.',
  resident:         'Your society, in one place — events and tickets today, with more services on the way.',
  security_guard:   'Use the QR scanner below to verify resident tickets at the gate.',
  sponsor:          'Track your sponsorships, monitor event funding, and manage refund requests.',
};

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
  const { user }           = useAuth();
  const { name, city }     = useSociety();
  const { dbUser }         = useUserService();
  const firstName          = user?.name.split(' ')[0] ?? 'there';
  const role               = user?.primaryRole ?? 'resident';
  const roleHint           = ROLE_WELCOME[role];
  const { events: eventSlots, visitor: visitorSlots } = useMfeSlots(role);
  const apt                = dbUser?.apartments[0];

  // Live service cards carry their own role-specific quick actions inline
  // (rendered by ServicesGrid) instead of separate sections below the grid.
  const liveServices: ServiceTile[] = [
    { ...EVENTS_SERVICE_BASE, status: 'live', actions: eventSlots },
    ...(visitorSlots.length > 0
      ? [{ ...VISITOR_SERVICE_BASE, status: 'live' as const, actions: visitorSlots }]
      : []),
  ];
  const servicesOverview: ServiceTile[] = role === 'security_guard'
    ? liveServices
    : [...liveServices, ...ROADMAP.map((r) => ({ ...r, status: 'soon' as const }))];

  return (
    <Box component="main">

      {/* Hero */}
      <Box sx={{ background: 'linear-gradient(135deg,#1e293b 0%,#312e81 100%)', color: '#fff', py: { xs: 5, md: 8 }, px: 3 }}>
        <Container maxWidth="lg">
          <Typography sx={{ fontSize: 13, color: '#a5b4fc', fontWeight: 500, mb: 1, letterSpacing: 0.5 }}>
            {name} · {city}
          </Typography>
          <Typography variant="h4" fontWeight={800} sx={{ lineHeight: 1.15, mb: 1.25, fontSize: { xs: 26, md: 36 } }}>
            Welcome back, {firstName} 👋
          </Typography>
          <Typography sx={{ fontSize: 16, color: '#c7d2fe', mb: apt ? 2 : 3.5 }}>{roleHint}</Typography>
          {apt && (
            <Typography sx={{ fontSize: 13, color: '#a5b4fc', mb: 3, display: 'flex', alignItems: 'center', gap: 0.75 }}>
              🏠 Block {apt.block} — Flat {apt.unit_number} ({apt.type})
            </Typography>
          )}
          <Button
            component={Link}
            to="/events"
            variant="contained"
            size="large"
            sx={{ fontWeight: 600, px: 3.5, bgcolor: 'primary.main', '&:hover': { bgcolor: '#4f46e5' } }}
          >
            Browse Events →
          </Button>
        </Container>
      </Box>

      {/* Society services — Events & Ticketing and Visitor Management cards
          carry their own quick actions inline, so residents don't need to
          scroll past a separate "quick actions" section to find them. */}
      <Box sx={{ py: 6, px: { xs: 2, sm: 3 } }}>
        <Container maxWidth="lg">
          <Typography variant="h6" fontWeight={700} sx={{ mb: 0.5 }}>
            {role === 'security_guard' ? 'Your services' : 'All society services'}
          </Typography>
          <Typography fontSize={14} color="text.secondary" sx={{ mb: 3 }}>
            {role === 'security_guard'
              ? 'Quick access to your gate operations.'
              : "Events & Ticketing and Visitor Management are live today — jump straight in from each card below. Here's everything else coming to the platform."}
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
