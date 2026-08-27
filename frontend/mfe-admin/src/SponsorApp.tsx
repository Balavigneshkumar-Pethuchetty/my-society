import React from 'react';
import './i18n';
import { SponsorDashboard } from './pages/SponsorDashboard';

interface Props { firstName?: string }

export function SponsorApp({ firstName }: Props) {
  return <SponsorDashboard firstName={firstName} />;
}
