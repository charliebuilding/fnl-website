// Shared event configuration for FNL Ticketing Platform

export interface TicketTier {
  id: string;
  name: string;
  price: number; // in pence GBP
  description: string;
  totalCapacity: number;
  color: string;
}

export interface FNLEvent {
  id: string;
  name: string;
  shortName: string;
  date: string;
  dateIso: string;
  time: string;
  location: string;
  city: string;
  totalCapacity: number;
  description: string;
  tiers: TicketTier[];
  emoji: string;
  neonColor: string;
}

export const EVENTS: Record<string, FNLEvent> = {
  'battersea-5k': {
    id: 'battersea-5k',
    name: 'FNL Battersea Park 5K',
    shortName: 'Battersea 5K',
    date: 'April 24, 2026',
    dateIso: '2026-04-24',
    time: '20:00',
    location: 'Battersea Park, London',
    city: 'London',
    totalCapacity: 5000,
    description: 'The flagship sunset 5K through iconic Battersea Park. Closed roads, neon vibes, and London\'s best running crowd.',
    emoji: '🌇',
    neonColor: '#00FFD1',
    tiers: [
      { id: 'early-bird', name: 'Early Bird', price: 1499, description: 'Limited early access. Grab it before it\'s gone.', totalCapacity: 500, color: '#FFFF00' },
      { id: 'general', name: 'General Entry', price: 1999, description: 'Standard entry. Includes finisher medal & event tee.', totalCapacity: 4200, color: '#00FFD1' },
      { id: 'vip', name: 'VIP Experience', price: 4999, description: 'Priority start pen, exclusive VIP tent, welcome drinks & premium race pack.', totalCapacity: 300, color: '#FF006B' },
    ]
  },
  'hackney-10k': {
    id: 'hackney-10k',
    name: 'Hackney Quarter 10K',
    shortName: 'Hackney 10K',
    date: 'May 14, 2026',
    dateIso: '2026-05-14',
    time: '20:00',
    location: 'Victoria Park, Hackney, London',
    city: 'London',
    totalCapacity: 8000,
    description: 'East London\'s biggest closed-road night race. 10K of pure energy through Hackney\'s iconic streets.',
    emoji: '⚡',
    neonColor: '#FF006B',
    tiers: [
      { id: 'early-bird', name: 'Early Bird', price: 1799, description: 'Limited early access. Grab it before it\'s gone.', totalCapacity: 800, color: '#FFFF00' },
      { id: 'general', name: 'General Entry', price: 2499, description: 'Standard entry. Includes finisher medal & event tee.', totalCapacity: 6800, color: '#00FFD1' },
      { id: 'vip', name: 'VIP Experience', price: 5999, description: 'Priority start pen, exclusive VIP tent, welcome drinks & premium race pack.', totalCapacity: 400, color: '#FF006B' },
    ]
  },
  'run-the-wharf': {
    id: 'run-the-wharf',
    name: 'Run The Wharf 5K',
    shortName: 'Run The Wharf',
    date: 'September 3, 2026',
    dateIso: '2026-09-03',
    time: '20:00',
    location: 'Canary Wharf, London',
    city: 'London',
    totalCapacity: 6000,
    description: 'London\'s most spectacular night 5K. Neon lights reflected in the docklands water as you run through Canary Wharf.',
    emoji: '🌊',
    neonColor: '#FFFF00',
    tiers: [
      { id: 'early-bird', name: 'Early Bird', price: 1499, description: 'Limited early access. Grab it before it\'s gone.', totalCapacity: 600, color: '#FFFF00' },
      { id: 'general', name: 'General Entry', price: 1999, description: 'Standard entry. Includes finisher medal & event tee.', totalCapacity: 5100, color: '#00FFD1' },
      { id: 'vip', name: 'VIP Experience', price: 4999, description: 'Priority start pen, exclusive VIP tent, welcome drinks & premium race pack.', totalCapacity: 300, color: '#FF006B' },
    ]
  }
};

export function getEvent(eventId: string): FNLEvent | null {
  return EVENTS[eventId] ?? null;
}

export function getTier(eventId: string, tierId: string): TicketTier | null {
  const event = getEvent(eventId);
  return event?.tiers.find(t => t.id === tierId) ?? null;
}

export const MAX_GROUP_SIZE = 6;
export const GROUP_DISCOUNT_THRESHOLD = 4; // 4+ runners get discount
export const GROUP_DISCOUNT_PERCENT = 10;
