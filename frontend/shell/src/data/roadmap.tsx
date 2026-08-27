import React from 'react';
import Diversity3Icon from '@mui/icons-material/Diversity3';
import StorefrontIcon from '@mui/icons-material/Storefront';
import LocalParkingIcon from '@mui/icons-material/LocalParking';
import VideocamIcon from '@mui/icons-material/Videocam';

// `id` maps to a `services.<id>.title` / `services.<id>.desc` key in the i18n
// locale files (src/i18n/locales/*.json) — title/desc below are the English
// fallback only, consumers should translate via t(`services.${id}.title`).
export type RoadmapItem = { id: string; icon: React.ReactNode; color: string; title: string; desc: string };

// Services planned beyond the currently-live modules (Events, Ticketing,
// Visitor Management). Shared between the public Landing page and the
// logged-in Home dashboard so the two never drift out of sync.
export const ROADMAP: RoadmapItem[] = [
  {
    id: 'welfareAssociation',
    icon: <Diversity3Icon sx={{ fontSize: 30 }} />,
    color: '#7c3aed',
    title: 'Welfare Association',
    desc: 'Meeting minutes, resolutions, and welfare-fund tracking in one shared committee record.',
  },
  {
    id: 'vendorManagement',
    icon: <StorefrontIcon sx={{ fontSize: 30 }} />,
    color: '#d97706',
    title: 'Vendor Management',
    desc: 'Onboard maintenance vendors, track service contracts, and rate recurring providers.',
  },
  {
    id: 'carParking',
    icon: <LocalParkingIcon sx={{ fontSize: 30 }} />,
    color: '#059669',
    title: 'Car Parking',
    desc: 'Reserve visitor slots and manage resident vehicle allocations, no more paper logs.',
  },
  {
    id: 'aiCctv',
    icon: <VideocamIcon sx={{ fontSize: 30 }} />,
    color: '#e11d48',
    title: 'AI CCTV Surveillance',
    desc: "Frigate-powered smart camera alerts for your society's gates and common areas, with vehicle entry/exit tracking, human tracking, and face recognition.",
  },
];
