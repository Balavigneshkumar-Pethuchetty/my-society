import React, { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import {
  AppBar, Toolbar, Box, Button, Drawer,
  IconButton, List, ListItemButton, ListItemText,
  Menu, MenuItem, ListSubheader,
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import CloseIcon from '@mui/icons-material/Close';
import LoginIcon from '@mui/icons-material/Login';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import { NotificationBell } from './NotificationBell';
import { UserMenu } from './UserMenu';
import { ThemeToggle } from './ThemeToggle';
import { useAuth } from '../contexts/AuthContext';
import { useSociety } from '../contexts/SocietyContext';
import { NAV_BG } from '../theme';
import { ROADMAP } from '../data/roadmap';

// Other platform services, not yet live — shown muted/disabled in the nav
// so residents see the platform is more than events, without implying
// these are clickable today. Kept in sync with the shared ROADMAP data.
const MORE_SERVICES = ROADMAP.map((r) => r.title);

// Links grouped under the "Events & Ticketing" nav dropdown
const EVENTS_LINKS = [
  { label: 'Browse Events',     to: '/events',         end: false },
  { label: 'My Tickets',        to: '/tickets',        end: false },
  { label: 'My Registrations',  to: '/registrations',  end: false },
];

// Links grouped under the separate "Visitor Management" nav dropdown
const VISITOR_LINKS = [
  { label: 'Visitor Passes',    to: '/visitors',       end: false },
];

const navBtnSx = {
  color: 'rgba(203,213,225,0.9)',
  minWidth: 0,
  px: 1.5,
  py: 0.75,
  '&.active': { color: '#fff', backgroundColor: 'rgba(99,102,241,0.28)' },
  '&:hover':  { backgroundColor: 'rgba(255,255,255,0.08)', color: '#fff' },
};

export function Nav() {
  const { shortName, name } = useSociety();
  const { user, login, register } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [eventsMenuAnchor, setEventsMenuAnchor] = useState<null | HTMLElement>(null);
  const [visitorMenuAnchor, setVisitorMenuAnchor] = useState<null | HTMLElement>(null);
  const [moreMenuAnchor, setMoreMenuAnchor] = useState<null | HTMLElement>(null);

  const role    = user?.primaryRole ?? '';
  const isGuard = role === 'security_guard';
  const isGuest = !user;

  const isSponsor = role === 'sponsor';

  // Guard/sponsor accounts keep a short flat link row — grouping only
  // matters where the nav is otherwise crowded with event-only links.
  const flatLinks = isGuard
    ? [
        { label: 'QR Scanner', to: '/scanner', end: false },
        { label: 'Visitor Gate', to: '/visitors/gate', end: false },
      ]
    : [
        { label: 'Events',           to: '/events',  end: false },
        { label: 'My Sponsorships',  to: '/sponsor', end: false },
      ];

  const eventsMenuLinks = [
    ...EVENTS_LINKS,
    ...(role === 'committee_member' || role === 'admin'
      ? [{ label: 'Manage Events', to: '/manage', end: false }]
      : []),
    ...(role === 'admin' || role === 'committee_member'
      ? [{ label: 'Admin Panel', to: '/admin', end: false }]
      : []),
  ];

  const visitorMenuLinks = [
    ...VISITOR_LINKS,
    ...(role === 'admin' || role === 'committee_member'
      ? [{ label: 'Visitor Ledger', to: '/visitors/ledger', end: false }]
      : []),
  ];

  const menuItemSx = {
    fontSize: 14,
    color: 'rgba(203,213,225,0.9)',
    '&.active': { color: '#fff', bgcolor: 'rgba(99,102,241,0.28)' },
    '&:hover':  { bgcolor: 'rgba(255,255,255,0.08)', color: '#fff' },
  };

  const soonTagSx = {
    fontSize: 9, fontWeight: 700, letterSpacing: 0.5, lineHeight: 1.6,
    px: 0.6, borderRadius: 4,
    border: '1px dashed rgba(203,213,225,0.3)',
    color: 'rgba(203,213,225,0.5)',
  };

  return (
    <>
      <AppBar position="sticky" sx={{ bgcolor: NAV_BG, boxShadow: '0 4px 12px rgba(0,0,0,0.10)' }}>
        <Toolbar sx={{ gap: 1, minHeight: '60px !important' }}>

          {/* Logo */}
          <Button
            component={Link}
            to="/"
            disableRipple
            sx={{ color: '#fff', fontWeight: 700, fontSize: 15, gap: 1, mr: 1, flexShrink: 0, '&:hover': { background: 'none' } }}
          >
            <span style={{ fontSize: 20, fontWeight: 400 }}>🏛</span>
            <Box component="span" sx={{ display: { xs: 'none', sm: 'block' } }}>{name}</Box>
            <Box component="span" sx={{ display: { xs: 'block', sm: 'none' } }}>{shortName}</Box>
          </Button>

          {/* Authenticated: primary nav links */}
          {!isGuest && (
            <Box component="nav" sx={{ display: { xs: 'none', md: 'flex' }, gap: 0.5, flexShrink: 0, alignItems: 'center' }}>
              {isGuard || isSponsor ? (
                flatLinks.map((l) => (
                  <Button key={l.to} component={NavLink} to={l.to} end={l.end} sx={navBtnSx}>
                    {l.label}
                  </Button>
                ))
              ) : (
                <>
                  <Button component={NavLink} to="/" end sx={navBtnSx}>Home</Button>
                  <Button
                    onClick={(e) => setEventsMenuAnchor(e.currentTarget)}
                    endIcon={<KeyboardArrowDownIcon sx={{ fontSize: 18 }} />}
                    sx={navBtnSx}
                  >
                    Events &amp; Ticketing
                  </Button>
                  <Menu
                    anchorEl={eventsMenuAnchor}
                    open={!!eventsMenuAnchor}
                    onClose={() => setEventsMenuAnchor(null)}
                    PaperProps={{ sx: { bgcolor: NAV_BG, mt: 0.5 } }}
                  >
                    {eventsMenuLinks.map((l) => (
                      <MenuItem
                        key={l.to}
                        component={NavLink}
                        to={l.to}
                        end={l.end}
                        onClick={() => setEventsMenuAnchor(null)}
                        sx={menuItemSx}
                      >
                        {l.label}
                      </MenuItem>
                    ))}
                  </Menu>

                  <Button
                    onClick={(e) => setVisitorMenuAnchor(e.currentTarget)}
                    endIcon={<KeyboardArrowDownIcon sx={{ fontSize: 18 }} />}
                    sx={navBtnSx}
                  >
                    Visitor Management
                  </Button>
                  <Menu
                    anchorEl={visitorMenuAnchor}
                    open={!!visitorMenuAnchor}
                    onClose={() => setVisitorMenuAnchor(null)}
                    PaperProps={{ sx: { bgcolor: NAV_BG, mt: 0.5 } }}
                  >
                    {visitorMenuLinks.map((l) => (
                      <MenuItem
                        key={l.to}
                        component={NavLink}
                        to={l.to}
                        end={l.end}
                        onClick={() => setVisitorMenuAnchor(null)}
                        sx={menuItemSx}
                      >
                        {l.label}
                      </MenuItem>
                    ))}
                  </Menu>

                  <Button
                    onClick={(e) => setMoreMenuAnchor(e.currentTarget)}
                    endIcon={<KeyboardArrowDownIcon sx={{ fontSize: 18 }} />}
                    sx={navBtnSx}
                  >
                    More services
                  </Button>
                  <Menu
                    anchorEl={moreMenuAnchor}
                    open={!!moreMenuAnchor}
                    onClose={() => setMoreMenuAnchor(null)}
                    PaperProps={{ sx: { bgcolor: NAV_BG, mt: 0.5 } }}
                  >
                    <ListSubheader sx={{ bgcolor: 'transparent', color: 'rgba(203,213,225,0.45)', fontSize: 11, fontWeight: 700, letterSpacing: 1, lineHeight: '28px' }}>
                      Coming soon
                    </ListSubheader>
                    {MORE_SERVICES.map((title) => (
                      <MenuItem key={title} disabled sx={{ fontSize: 14, display: 'flex', justifyContent: 'space-between', gap: 2 }}>
                        {title}
                        <Box component="span" sx={soonTagSx}>SOON</Box>
                      </MenuItem>
                    ))}
                  </Menu>
                </>
              )}
            </Box>
          )}

          {/* Guard: scanner shortcut */}
          {isGuard && (
            <Button
              component={NavLink}
              to="/scanner"
              variant="contained"
              startIcon={<QrCodeScannerIcon />}
              sx={{ ml: 1, bgcolor: '#10b981', '&:hover': { bgcolor: '#059669' }, fontWeight: 700 }}
            >
              Scan QR
            </Button>
          )}

          <Box sx={{ flex: 1 }} />

          <ThemeToggle />

          {/* Guest: Sign In + Register buttons */}
          {isGuest ? (
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button
                variant="text"
                startIcon={<LoginIcon />}
                onClick={login}
                sx={{
                  color: 'rgba(203,213,225,0.9)',
                  fontWeight: 600,
                  display: { xs: 'none', sm: 'flex' },
                  '&:hover': { color: '#fff', bgcolor: 'rgba(255,255,255,0.08)' },
                }}
              >
                Sign In
              </Button>
              <Button
                variant="contained"
                startIcon={<PersonAddIcon />}
                onClick={register}
                sx={{ fontWeight: 700, bgcolor: '#6366f1', '&:hover': { bgcolor: '#4f46e5' }, px: { xs: 2, sm: 3 } }}
              >
                <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>Register</Box>
                <Box component="span" sx={{ display: { xs: 'inline', sm: 'none' } }}>Join</Box>
              </Button>
            </Box>
          ) : (
            <>
              <NotificationBell />
              <UserMenu />
            </>
          )}

          {/* Mobile hamburger — only for authenticated users */}
          {!isGuest && (
            <IconButton
              aria-label="Open menu"
              onClick={() => setDrawerOpen(true)}
              sx={{ display: { md: 'none' }, color: 'rgba(203,213,225,0.9)' }}
            >
              <MenuIcon />
            </IconButton>
          )}
        </Toolbar>
      </AppBar>

      {/* Mobile Drawer — authenticated only */}
      {!isGuest && (
        <Drawer
          anchor="top"
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          PaperProps={{ sx: { bgcolor: NAV_BG, color: '#fff', pt: 1 } }}
        >
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', px: 2, pb: 1 }}>
            <IconButton onClick={() => setDrawerOpen(false)} sx={{ color: 'rgba(203,213,225,0.9)' }}>
              <CloseIcon />
            </IconButton>
          </Box>
          <List disablePadding>
            {isGuard || isSponsor ? (
              flatLinks.map((l) => (
                <ListItemButton
                  key={l.to}
                  component={NavLink}
                  to={l.to}
                  end={l.end}
                  onClick={() => setDrawerOpen(false)}
                  sx={{
                    color: 'rgba(203,213,225,0.9)',
                    '&.active': { color: '#fff', bgcolor: 'rgba(99,102,241,0.28)' },
                    '&:hover':  { bgcolor: 'rgba(255,255,255,0.08)' },
                  }}
                >
                  <ListItemText primary={l.label} primaryTypographyProps={{ fontWeight: 500 }} />
                </ListItemButton>
              ))
            ) : (
              <>
                <ListItemButton
                  component={NavLink}
                  to="/"
                  end
                  onClick={() => setDrawerOpen(false)}
                  sx={{
                    color: 'rgba(203,213,225,0.9)',
                    '&.active': { color: '#fff', bgcolor: 'rgba(99,102,241,0.28)' },
                    '&:hover':  { bgcolor: 'rgba(255,255,255,0.08)' },
                  }}
                >
                  <ListItemText primary="Home" primaryTypographyProps={{ fontWeight: 500 }} />
                </ListItemButton>

                <ListSubheader sx={{ bgcolor: 'transparent', color: 'rgba(203,213,225,0.45)', fontSize: 11, fontWeight: 700, letterSpacing: 1 }}>
                  Events &amp; Ticketing
                </ListSubheader>
                {eventsMenuLinks.map((l) => (
                  <ListItemButton
                    key={l.to}
                    component={NavLink}
                    to={l.to}
                    end={l.end}
                    onClick={() => setDrawerOpen(false)}
                    sx={{
                      pl: 4,
                      color: 'rgba(203,213,225,0.9)',
                      '&.active': { color: '#fff', bgcolor: 'rgba(99,102,241,0.28)' },
                      '&:hover':  { bgcolor: 'rgba(255,255,255,0.08)' },
                    }}
                  >
                    <ListItemText primary={l.label} primaryTypographyProps={{ fontWeight: 500 }} />
                  </ListItemButton>
                ))}

                <ListSubheader sx={{ bgcolor: 'transparent', color: 'rgba(203,213,225,0.45)', fontSize: 11, fontWeight: 700, letterSpacing: 1, mt: 1 }}>
                  Visitor Management
                </ListSubheader>
                {visitorMenuLinks.map((l) => (
                  <ListItemButton
                    key={l.to}
                    component={NavLink}
                    to={l.to}
                    end={l.end}
                    onClick={() => setDrawerOpen(false)}
                    sx={{
                      pl: 4,
                      color: 'rgba(203,213,225,0.9)',
                      '&.active': { color: '#fff', bgcolor: 'rgba(99,102,241,0.28)' },
                      '&:hover':  { bgcolor: 'rgba(255,255,255,0.08)' },
                    }}
                  >
                    <ListItemText primary={l.label} primaryTypographyProps={{ fontWeight: 500 }} />
                  </ListItemButton>
                ))}

                <ListSubheader sx={{ bgcolor: 'transparent', color: 'rgba(203,213,225,0.45)', fontSize: 11, fontWeight: 700, letterSpacing: 1, mt: 1 }}>
                  More services
                </ListSubheader>
                {MORE_SERVICES.map((title) => (
                  <ListItemButton key={title} disabled sx={{ pl: 4 }}>
                    <ListItemText primary={title} primaryTypographyProps={{ fontWeight: 500, color: 'rgba(203,213,225,0.5)' }} />
                    <Box component="span" sx={soonTagSx}>SOON</Box>
                  </ListItemButton>
                ))}
              </>
            )}
          </List>
        </Drawer>
      )}
    </>
  );
}
