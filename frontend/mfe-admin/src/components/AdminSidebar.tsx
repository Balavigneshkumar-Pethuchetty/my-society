import React from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Divider, Drawer, IconButton, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';

// `active` (passed by each page) is still the English label — it's used purely
// as a stable key to match against `labelKey` below, not displayed directly.
const SIDEBAR: { active: string; labelKey: string; path: string; sectionKey?: string; adminOnly?: boolean }[] = [
  { active: 'Dashboard',           labelKey: 'sidebar.dashboard',           path: '/admin',                adminOnly: true },
  { active: 'Users',               labelKey: 'sidebar.users',               path: '/admin/users',          adminOnly: true },
  { active: 'Leave Requests',      labelKey: 'sidebar.leaveRequests',       path: '/admin/leave-requests', adminOnly: true },
  { active: 'Building',            labelKey: 'sidebar.building',            path: '/admin/building',       adminOnly: true },
  { active: 'Units',               labelKey: 'sidebar.units',               path: '/admin/units',          adminOnly: true },
  { active: 'Events',              labelKey: 'sidebar.events',              path: '/admin/events',         adminOnly: true },
  { active: 'Sponsors',            labelKey: 'sidebar.sponsors',            path: '/admin/sponsors',       adminOnly: true },
  { active: 'Categories',          labelKey: 'sidebar.categories',          path: '/admin/categories',     adminOnly: true },
  { active: 'Payment Approvals',   labelKey: 'sidebar.paymentApprovals',    path: '/admin/payments',       sectionKey: 'sidebar.paymentsSection' },
  { active: 'Payment Requests',    labelKey: 'sidebar.paymentRequests',     path: '/admin/reconciliation' },
  { active: 'Refund Tasks',        labelKey: 'sidebar.refundTasks',         path: '/admin/pay-refunds' },
  { active: 'Sponsorship Refunds', labelKey: 'sidebar.sponsorshipRefunds',  path: '/admin/refunds',        sectionKey: 'sidebar.sponsorsSection', adminOnly: true },
  { active: 'Reports',             labelKey: 'sidebar.reports',             path: '/admin/reports',        adminOnly: true },
  { active: 'Settings',            labelKey: 'sidebar.settings',            path: '/admin/settings',       adminOnly: true },
];

function navigate(path: string) {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
}

function SidebarContent({ active, onNavigate, role }: { active: string; onNavigate?: () => void; role?: string }) {
  const { t } = useTranslation('admin');
  const isCommittee = role === 'committee_member';
  const visible = SIDEBAR.filter(item => !(isCommittee && item.adminOnly));
  return (
    <Box sx={{ pt: 1 }}>
      {visible.map(({ active: itemActive, labelKey, path, sectionKey }) => (
        <React.Fragment key={itemActive}>
          {sectionKey && (
            <Box sx={{ px: 2.5, pt: 1.5, pb: 0.5 }}>
              <Typography fontSize={10} fontWeight={700} color="text.secondary" textTransform="uppercase" letterSpacing={1}>
                {t(sectionKey)}
              </Typography>
              <Divider sx={{ mt: 0.5 }} />
            </Box>
          )}
          <Box
            onClick={() => { navigate(path); onNavigate?.(); }}
            sx={{
              px: 2.5, py: 1.25, fontSize: 14, cursor: 'pointer',
              color: itemActive === active ? '#6366f1' : 'text.secondary',
              fontWeight: itemActive === active ? 700 : 400,
              bgcolor: itemActive === active ? 'action.selected' : 'transparent',
              borderRight: itemActive === active ? '3px solid #6366f1' : '3px solid transparent',
              transition: 'all .15s',
              '&:hover': { bgcolor: itemActive === active ? 'action.selected' : 'action.hover', color: itemActive === active ? '#6366f1' : 'text.primary' },
            }}
          >
            {t(labelKey)}
          </Box>
        </React.Fragment>
      ))}
    </Box>
  );
}

interface AdminSidebarProps {
  active: string;
  mobileOpen: boolean;
  onMobileClose: () => void;
  role?: string;
}

export function AdminSidebar({ active, mobileOpen, onMobileClose, role }: AdminSidebarProps) {
  const { t } = useTranslation('admin');
  return (
    <>
      {/* Mobile: slide-in drawer */}
      <Drawer
        anchor="left"
        open={mobileOpen}
        onClose={onMobileClose}
        ModalProps={{ keepMounted: true }}
        PaperProps={{ sx: { width: 240, bgcolor: 'background.paper' } }}
        sx={{ display: { xs: 'block', md: 'none' } }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Typography fontWeight={700} fontSize={14} color="text.secondary">{t('sidebar.adminMenu')}</Typography>
          <IconButton size="small" onClick={onMobileClose} aria-label={t('sidebar.closeMenu')}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
        <SidebarContent active={active} onNavigate={onMobileClose} role={role} />
      </Drawer>

      {/* Desktop: permanent sidebar */}
      <Box
        sx={{
          width: 220,
          flexShrink: 0,
          display: { xs: 'none', md: 'block' },
          borderRight: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper',
          minHeight: 'calc(100vh - 64px)',
        }}
      >
        <SidebarContent active={active} role={role} />
      </Box>
    </>
  );
}
