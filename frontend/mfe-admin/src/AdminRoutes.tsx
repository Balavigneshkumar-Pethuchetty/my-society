import React from 'react';
import './i18n';
import { useTranslation } from 'react-i18next';
import { Box, Typography } from '@mui/material';
import { PaymentApprovals } from './pages/PaymentApprovals';
import { SponsorManagement } from './pages/SponsorManagement';
import { SponsorshipRefunds } from './pages/SponsorshipRefunds';
import { UserApproval } from './pages/UserApproval';
import { LeaveRequests } from './pages/LeaveRequests';
import { BuildingStructure } from './pages/BuildingStructure';
import { UnitManagement } from './pages/UnitManagement';
import { CategoryManagement } from './pages/CategoryManagement';
import { ReconciliationConsole } from './pages/ReconciliationConsole';
import { RefundTasks } from './pages/RefundTasks';

function ComingSoon() {
  const { t } = useTranslation('admin');
  return (
    <Box component="main" sx={{ minHeight: 'calc(100vh - 64px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1.5, color: 'text.secondary' }}>
      <Typography fontSize={48} lineHeight={1}>🚧</Typography>
      <Typography variant="h5" color="text.primary">{t('common.adminMfe')}</Typography>
      <Typography variant="body2">{t('common.underConstruction')}</Typography>
    </Box>
  );
}

interface AdminRoutesProps {
  token?: string | null;
  onLogin?: () => void;
  page?: string;
  role?: string;
}

const COMMITTEE_PAGES = new Set(['payments', 'reconciliation', 'pay-refunds']);

export function AdminRoutes({ token = null, onLogin, page, role }: AdminRoutesProps) {
  const { t } = useTranslation('admin');
  const isCommittee = role === 'committee_member';

  // Committee members land on Payment Approvals by default
  const effectivePage = (!page && isCommittee) ? 'payments' : page;

  // Block committee members from admin-only pages
  if (isCommittee && effectivePage && !COMMITTEE_PAGES.has(effectivePage)) {
    return (
      <Box component="main" sx={{ minHeight: 'calc(100vh - 64px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1.5, color: 'text.secondary' }}>
        <Typography fontSize={48} lineHeight={1}>🔒</Typography>
        <Typography variant="h5" color="text.primary">{t('common.accessDeniedTitle')}</Typography>
        <Typography variant="body2">{t('common.accessDeniedBody')}</Typography>
      </Box>
    );
  }

  if (!effectivePage || effectivePage === 'users') return <UserApproval token={token} onLogin={onLogin} />;
  if (effectivePage === 'leave-requests')     return <LeaveRequests token={token} />;
  if (effectivePage === 'building')          return <BuildingStructure token={token} />;
  if (effectivePage === 'units')             return <UnitManagement token={token} />;
  if (effectivePage === 'sponsors')          return <SponsorManagement token={token} />;
  if (effectivePage === 'categories')        return <CategoryManagement token={token} />;
  if (effectivePage === 'refunds')           return <SponsorshipRefunds token={token} />;
  if (effectivePage === 'payments')          return <PaymentApprovals token={token} role={role} />;
  if (effectivePage === 'reconciliation')    return <ReconciliationConsole token={token} role={role} />;
  if (effectivePage === 'pay-refunds')       return <RefundTasks token={token} />;
  return <ComingSoon />;
}
