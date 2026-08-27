import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Box, Card, CardContent, Chip, Grid, Typography } from '@mui/material';

export type ServiceAction = {
  icon: React.ReactNode;
  title: string;
  cta: string;
  path: string;
  color: string;
};

export type ServiceTile = {
  icon: React.ReactNode;
  color: string;
  title: string;
  desc: string;
  status: 'live' | 'soon';
  // Quick-action shortcuts for this service, shown inline in the card
  // (live services only) instead of in a separate section below the grid.
  actions?: ServiceAction[];
};

// Shared tile grid for "what this platform covers" — used on both the
// pre-login Landing page and the post-login Home dashboard so the two
// never drift out of sync when a new service goes live.
export function ServicesGrid({ services }: { services: ServiceTile[] }) {
  const { t } = useTranslation('shell');
  return (
    <Grid container spacing={3}>
      {services.map((s) => (
        <Grid item xs={12} sm={6} md={4} key={s.title}>
          <Card
            variant="outlined"
            sx={{
              height: '100%',
              borderRadius: 2,
              position: 'relative',
              borderStyle: s.status === 'live' ? 'solid' : 'dashed',
              transition: 'box-shadow 0.25s, transform 0.25s',
              '&:hover': {
                boxShadow: s.status === 'live' ? 6 : 4,
                transform: `translateY(-${s.status === 'live' ? 4 : 3}px)`,
              },
            }}
          >
            <Chip
              label={s.status === 'live' ? t('common.live') : t('common.comingSoonChip')}
              size="small"
              sx={{
                position: 'absolute', top: 14, right: 14,
                fontSize: 10, fontWeight: 700, height: 22,
                bgcolor: s.status === 'live' ? 'rgba(16,185,129,0.15)' : 'rgba(148,163,184,0.15)',
                color: s.status === 'live' ? '#059669' : 'text.secondary',
              }}
            />
            <CardContent sx={{ p: 3.5 }}>
              <Box
                sx={{
                  width: 52, height: 52, borderRadius: 2, mb: 2.5,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  ...(s.status === 'live'
                    ? { bgcolor: s.color, color: '#fff' }
                    : { border: `2px solid ${s.color}`, color: s.color }),
                }}
              >
                {s.icon}
              </Box>
              <Typography fontWeight={700} fontSize={17} mb={1}>{s.title}</Typography>
              <Typography fontSize={14} color="text.secondary" lineHeight={1.6}>{s.desc}</Typography>

              {s.actions && s.actions.length > 0 && (
                <Box sx={{ mt: 2.5, pt: 2, borderTop: '1px solid', borderColor: 'divider', display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {s.actions.map((a) => (
                    <Box
                      key={a.title}
                      component={Link}
                      to={a.path}
                      sx={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        fontSize: 13.5, fontWeight: 600, color: a.color,
                        textDecoration: 'none', lineHeight: 1.4,
                        '&:hover': { textDecoration: 'underline' },
                      }}
                    >
                      <span>{a.cta}</span>
                      <span>→</span>
                    </Box>
                  ))}
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>
      ))}
    </Grid>
  );
}
