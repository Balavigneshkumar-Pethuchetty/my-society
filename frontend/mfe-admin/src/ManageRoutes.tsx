import './i18n';
import { useTranslation } from 'react-i18next';
import { Box, Typography } from '@mui/material';
import { ManageEvents }         from './pages/ManageEvents';
import { ComplimentaryTickets } from './pages/ComplimentaryTickets';
import { EventDetails }         from './pages/EventDetails';

function ComingSoon() {
  const { t } = useTranslation('admin');
  return (
    <Box component="main" sx={{ minHeight: 'calc(100vh - 64px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1.5, color: 'text.secondary' }}>
      <Typography fontSize={48} lineHeight={1}>🚧</Typography>
      <Typography variant="h5" color="text.primary">{t('common.eventManagerMfe')}</Typography>
      <Typography variant="body2">{t('common.underConstruction')}</Typography>
    </Box>
  );
}

interface ManageRoutesProps {
  token?: string | null;
  page?: string;
  id?: string;
}

export function ManageRoutes({ token = null, page, id }: ManageRoutesProps) {
  // Default landing (/manage) and events list/create (/manage/events, /manage/events/new)
  if (!page || page === 'events') return <ManageEvents token={token} id={id} />;

  if (page === 'complimentary') return <ComplimentaryTickets token={token} id={id} />;
  if (page === 'details')       return <EventDetails token={token} id={id} />;

  return <ComingSoon />;
}
