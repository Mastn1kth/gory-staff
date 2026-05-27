import type { TableStatus } from './types';

export const palette = {
  background: '#21140F',
  surface: '#FFF8EA',
  surfaceAlt: '#F2E4C8',
  surfaceSoft: '#E7D1AD',
  deepBrown: '#2D1810',
  brown: '#4A2A1D',
  burgundy: '#7A2637',
  burgundyDark: '#541926',
  gold: '#D7A94A',
  goldSoft: '#F5D68B',
  ink: '#24170F',
  inkMuted: '#755F52',
  textOnDark: '#FFF8EA',
  textMutedOnDark: 'rgba(255, 248, 234, 0.72)',
  line: '#D9BF91',
  green: '#2F8C5B',
  red: '#B63D36',
  orange: '#D98527',
  blue: '#3573A9',
  purple: '#7B4FA2',
  gray: '#82766C',
  lightGray: '#D7D2CA',
  teal: '#267A78',
  dangerSoft: '#F7D7D2',
  successSoft: '#DDF0DF',
  infoSoft: '#D9E8F7',
};

export const tableStatusColor: Record<TableStatus, string> = {
  free: palette.green,
  occupied: palette.red,
  reserved: palette.gold,
  expected: palette.blue,
  soon_free: palette.purple,
  bill_waiting: palette.teal,
  closed: palette.gray,
  cleaning: palette.lightGray,
  soon_reserved: palette.orange,
  banquet: palette.burgundy,
};

export const tableStatusLabel: Record<TableStatus, string> = {
  free: 'Свободен',
  occupied: 'Занят',
  reserved: 'Забронирован',
  expected: 'Ожидает гостей',
  soon_free: 'Скоро освободится',
  bill_waiting: 'Ждут счёт',
  closed: 'Не используется',
  cleaning: 'На уборке',
  soon_reserved: 'Скоро бронь',
  banquet: 'Банкет',
};

export const shadow = {
  card: {
    shadowColor: '#130A06',
    shadowOpacity: 0.16,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 5,
  },
  button: {
    shadowColor: '#7A2637',
    shadowOpacity: 0.26,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 7 },
    elevation: 4,
  },
};

export const radius = {
  xs: 8,
  sm: 10,
  md: 14,
  lg: 18,
};
