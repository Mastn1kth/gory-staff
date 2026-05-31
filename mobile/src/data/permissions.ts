import type { RoleName, SectionKey } from '../types';

export type SectionDefinition = {
  key: SectionKey;
  label: string;
  shortLabel: string;
  icon: string;
};

export const sectionDefinitions: SectionDefinition[] = [
  { key: 'home', label: 'Пульс', shortLabel: 'Пульс', icon: 'pulse' },
  { key: 'floor', label: 'План зала', shortLabel: 'Зал', icon: 'grid' },
  { key: 'myTables', label: 'Столы', shortLabel: 'Столы', icon: 'restaurant' },
  { key: 'notebook', label: 'Блокнот', shortLabel: 'Блокнот', icon: 'create' },
  { key: 'reservations', label: 'Брони', shortLabel: 'Брони', icon: 'calendar' },
  { key: 'waitlist', label: 'Ожидание', shortLabel: 'Ожидание', icon: 'hourglass' },
  { key: 'menu', label: 'Меню', shortLabel: 'Меню', icon: 'book' },
  { key: 'stoplist', label: 'Стоп-лист', shortLabel: 'Стоп', icon: 'alert-circle' },
  { key: 'schedule', label: 'График', shortLabel: 'График', icon: 'time' },
  { key: 'staff', label: 'Персонал', shortLabel: 'Люди', icon: 'people' },
  { key: 'clients', label: 'Клиенты', shortLabel: 'Клиенты', icon: 'card' },
  { key: 'events', label: 'Банкеты', shortLabel: 'Банкеты', icon: 'wine' },
  { key: 'tasks', label: 'Заявки', shortLabel: 'Заявки', icon: 'checkbox' },
  { key: 'notifications', label: 'Новости', shortLabel: 'Новости', icon: 'notifications' },
  { key: 'profile', label: 'Профиль', shortLabel: 'Профиль', icon: 'person' },
  { key: 'settings', label: 'Настройки', shortLabel: 'Настройки', icon: 'options' },
  { key: 'admin', label: 'Техчасть', shortLabel: 'Тех', icon: 'settings' },
  { key: 'analytics', label: 'Аналитика', shortLabel: 'Итоги', icon: 'stats-chart' },
  { key: 'about', label: 'О ресторане', shortLabel: 'О нас', icon: 'information-circle' },
  { key: 'announcements', label: 'Объявления', shortLabel: 'Новости', icon: 'megaphone' },
  { key: 'rules', label: 'Правила', shortLabel: 'Правила', icon: 'shield-checkmark' },
  { key: 'chat', label: 'Чат', shortLabel: 'Чат', icon: 'chatbubbles' },
];

sectionDefinitions.push({ key: 'smm', label: 'SMM', shortLabel: 'SMM', icon: 'megaphone' });

const preferredByRole: Partial<Record<RoleName, SectionKey[]>> = {
  pending: ['profile'],
  technician: ['admin', 'home', 'floor', 'staff', 'clients', 'analytics'],
  owner: ['analytics', 'clients', 'staff', 'schedule', 'home'],
  manager: ['home', 'floor', 'staff', 'clients', 'reservations', 'analytics'],
  administrator: ['home', 'floor', 'reservations', 'waitlist', 'schedule', 'events'],
  hostess: ['floor', 'reservations', 'waitlist', 'notifications', 'profile'],
  waiter: ['notebook', 'menu', 'myTables', 'notifications', 'profile'],
  chef: ['menu', 'stoplist', 'tasks', 'events', 'notifications', 'profile'],
  cook: ['stoplist', 'tasks', 'events', 'notifications', 'profile'],
  bar: ['menu', 'stoplist', 'tasks', 'events', 'notifications', 'profile'],
  technical_staff: ['tasks', 'schedule', 'notifications', 'profile'],
};

preferredByRole.smm_manager = ['smm', 'notifications', 'profile'];

export function initialSectionForRole(role: RoleName): SectionKey {
  return preferredByRole[role]?.[0] ?? 'home';
}

export function prioritySections(role: RoleName, allowed: SectionKey[]): SectionKey[] {
  const preferred = preferredByRole[role] ?? ['home', 'notifications', 'profile'];
  const maxByRole: Partial<Record<RoleName, number>> = {
    technician: 6,
    owner: 5,
    manager: 6,
    administrator: 6,
    hostess: 5,
    waiter: 5,
    chef: 6,
    cook: 5,
    bar: 5,
    technical_staff: 4,
  };
  const maxItems = maxByRole[role] ?? 5;
  const result = preferred.filter((key) => allowed.includes(key));
  for (const key of allowed) {
    if (result.length >= maxItems) break;
    if (!result.includes(key)) result.push(key);
  }
  return result;
}

export function labelForRole(role: RoleName): string {
  if (role === 'smm_manager') return 'SMM менеджер';
  const labels: Partial<Record<RoleName, string>> = {
    pending: 'Новый сотрудник',
    technician: 'Техник системы',
    owner: 'Владелец',
    manager: 'Управляющий',
    administrator: 'Администратор смены',
    hostess: 'Хостес',
    waiter: 'Официант',
    chef: 'Шеф-повар',
    cook: 'Повар',
    bar: 'Бармен',
    technical_staff: 'Техперсонал',
  };
  return labels[role] ?? role;
}

export function canManage(snapshotPermissions: string[], permission: string): boolean {
  return snapshotPermissions.includes('*') || snapshotPermissions.includes(permission);
}
