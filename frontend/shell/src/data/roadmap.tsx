import React from 'react';
import Diversity3Icon from '@mui/icons-material/Diversity3';
import StorefrontIcon from '@mui/icons-material/Storefront';
import LocalParkingIcon from '@mui/icons-material/LocalParking';
import VideocamIcon from '@mui/icons-material/Videocam';

export type RoadmapItem = { icon: React.ReactNode; color: string; title: string; desc: string };

// Services planned beyond the currently-live modules (Events, Ticketing,
// Visitor Management). Shared between the public Landing page and the
// logged-in Home dashboard so the two never drift out of sync.
export const ROADMAP: RoadmapItem[] = [
  {
    icon: <Diversity3Icon sx={{ fontSize: 30 }} />,
    color: '#7c3aed',
    title: 'Welfare Association',
    desc: 'Meeting minutes, resolutions, and welfare-fund tracking in one shared committee record.',
  },
  {
    icon: <StorefrontIcon sx={{ fontSize: 30 }} />,
    color: '#d97706',
    title: 'Vendor Management',
    desc: 'Onboard maintenance vendors, track service contracts, and rate recurring providers.',
  },
  {
    icon: <LocalParkingIcon sx={{ fontSize: 30 }} />,
    color: '#059669',
    title: 'Car Parking',
    desc: 'Reserve visitor slots and manage resident vehicle allocations, no more paper logs.',
  },
  {
    icon: <VideocamIcon sx={{ fontSize: 30 }} />,
    color: '#e11d48',
    title: 'AI CCTV Surveillance',
    desc: "Frigate-powered smart camera alerts for your society's gates and common areas, with vehicle entry/exit tracking, human tracking, and face recognition.",
  },
];
