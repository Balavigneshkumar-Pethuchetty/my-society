import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Avatar, Box, Chip, Divider,
  ListItemIcon, Menu, MenuItem, Tooltip, Typography,
} from '@mui/material';
import AccountCircleIcon from '@mui/icons-material/AccountCircle';
import ApartmentIcon from '@mui/icons-material/Apartment';
import ConfirmationNumberIcon from '@mui/icons-material/ConfirmationNumber';
import DashboardIcon from '@mui/icons-material/Dashboard';
import ExitToAppIcon from '@mui/icons-material/ExitToApp';
import LogoutIcon from '@mui/icons-material/Logout';
import SettingsIcon from '@mui/icons-material/Settings';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import { useAuth } from '../contexts/AuthContext';
import { useUserService } from '../contexts/UserServiceContext';
import { avatarUrl } from '../api/userService';
import { ROLE_COLORS, ROLE_LABELS } from '../theme';

export function UserMenu() {
  const { t } = useTranslation('shell');
  const { user, logout }   = useAuth();
  const { dbUser }         = useUserService();
  const navigate           = useNavigate();
  const [anchor, setAnchor] = useState<null | HTMLElement>(null);

  if (!user) return null;

  const open      = Boolean(anchor);
  const firstName = user.name.split(' ')[0];
  const apt       = dbUser?.apartments[0];

  return (
    <>
      <Tooltip title={t('nav.account')}>
        <Box
          component="button"
          onClick={(e) => setAnchor(e.currentTarget)}
          aria-haspopup="true"
          aria-expanded={open}
          sx={{
            display: 'flex', alignItems: 'center', gap: 0.75,
            px: 1, py: 0.5, border: 'none', borderRadius: 5,
            bgcolor: 'transparent', cursor: 'pointer',
            color: 'rgba(203,213,225,0.9)', transition: 'background 0.15s',
            '&:hover': { bgcolor: 'rgba(255,255,255,0.08)' },
          }}
        >
          <Avatar src={avatarUrl(dbUser?.avatar_url)} sx={{ width: 32, height: 32, bgcolor: 'primary.main', fontSize: 12, fontWeight: 700 }}>
            {user.initials}
          </Avatar>
          <Box component="span" sx={{ display: { xs: 'none', sm: 'block' }, fontSize: 13, fontWeight: 500, color: '#fff' }}>
            {firstName}
          </Box>
          <KeyboardArrowDownIcon sx={{ fontSize: 16, transition: 'transform 0.2s', transform: open ? 'rotate(180deg)' : 'none' }} />
        </Box>
      </Tooltip>

      <Menu
        anchorEl={anchor}
        open={open}
        onClose={() => setAnchor(null)}
        onClick={() => setAnchor(null)}
        transformOrigin={{ horizontal: 'right', vertical: 'top' }}
        anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
        PaperProps={{ elevation: 4, sx: { width: 260, borderRadius: 1.5, mt: 1 } }}
      >
        {/* Identity block */}
        <Box sx={{ px: 2, py: 1.5, bgcolor: 'action.hover', display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
          <Avatar src={avatarUrl(dbUser?.avatar_url)} sx={{ width: 42, height: 42, bgcolor: 'primary.main', fontSize: 15, fontWeight: 700 }}>
            {user.initials}
          </Avatar>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography fontWeight={600} fontSize={14} noWrap>{user.name}</Typography>
            <Typography fontSize={12} color="text.secondary" noWrap>{user.email}</Typography>
            {apt && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
                <ApartmentIcon sx={{ fontSize: 12, color: 'text.secondary' }} />
                <Typography fontSize={11} color="text.secondary" noWrap>
                  {t('userMenu.unitLabel', { block: apt.block, unit: apt.unit_number })}
                </Typography>
              </Box>
            )}
            <Chip
              label={ROLE_LABELS[user.primaryRole] ?? user.primaryRole}
              size="small"
              sx={{
                mt: 0.75, height: 20, fontSize: 11, fontWeight: 600,
                bgcolor: ROLE_COLORS[user.primaryRole] ?? 'grey.400',
                color: '#fff',
                '& .MuiChip-label': { px: 1 },
              }}
            />
          </Box>
        </Box>

        <Divider />

        <MenuItem dense onClick={() => navigate('/profile')} sx={{ gap: 1.25, py: 1.25 }}>
          <ListItemIcon sx={{ minWidth: 0 }}><AccountCircleIcon fontSize="small" /></ListItemIcon>
          {t('userMenu.myProfile')}
        </MenuItem>

        <MenuItem dense onClick={() => navigate('/settings')} sx={{ gap: 1.25, py: 1.25 }}>
          <ListItemIcon sx={{ minWidth: 0 }}><SettingsIcon fontSize="small" /></ListItemIcon>
          {t('userMenu.settings')}
        </MenuItem>

        <MenuItem dense onClick={() => navigate('/tickets')} sx={{ gap: 1.25, py: 1.25 }}>
          <ListItemIcon sx={{ minWidth: 0 }}><ConfirmationNumberIcon fontSize="small" /></ListItemIcon>
          {t('userMenu.myTickets')}
        </MenuItem>

        {(user.primaryRole === 'admin' || user.primaryRole === 'committee_member') && (
          <MenuItem dense onClick={() => navigate(user.primaryRole === 'admin' ? '/admin' : '/manage')} sx={{ gap: 1.25, py: 1.25 }}>
            <ListItemIcon sx={{ minWidth: 0 }}><DashboardIcon fontSize="small" /></ListItemIcon>
            {user.primaryRole === 'admin' ? t('userMenu.adminDashboard') : t('userMenu.manageEvents')}
          </MenuItem>
        )}

        <Divider />

        <MenuItem dense onClick={() => navigate('/profile#leave-society')} sx={{ gap: 1.25, py: 1.25, color: 'error.main' }}>
          <ListItemIcon sx={{ minWidth: 0, color: 'error.main' }}><ExitToAppIcon fontSize="small" /></ListItemIcon>
          {t('userMenu.leaveSociety')}
        </MenuItem>

        <MenuItem dense onClick={logout} sx={{ gap: 1.25, py: 1.25, color: 'error.main' }}>
          <ListItemIcon sx={{ minWidth: 0, color: 'error.main' }}><LogoutIcon fontSize="small" /></ListItemIcon>
          {t('userMenu.signOut')}
        </MenuItem>
      </Menu>
    </>
  );
}
