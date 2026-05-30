const ALL_SECTIONS = [
  'home',
  'floor',
  'reservations',
  'waitlist',
  'menu',
  'stoplist',
  'schedule',
  'staff',
  'clients',
  'events',
  'tasks',
  'notifications',
  'profile',
  'admin',
  'analytics',
  'smm',
  'announcements',
  'rules',
  'chat',
  'about',
];

const roleDefinitions = {
  pending: {
    id: 'role-pending',
    name: 'pending',
    label: 'Новый сотрудник',
    sections: ['profile'],
    permissions: ['view:profile'],
  },
  technician: {
    id: 'role-technician',
    name: 'technician',
    label: 'Техник системы',
    sections: ['admin', ...ALL_SECTIONS.filter((section) => section !== 'admin')],
    permissions: ['*'],
  },
  owner: {
    id: 'role-owner',
    name: 'owner',
    label: 'Владелец',
    sections: ['analytics', 'clients', 'staff', 'schedule', 'home', 'smm', 'notifications', 'profile'],
    permissions: [
      'view:analytics',
      'view:clients',
      'view:staff',
      'view:schedule',
      'view:home',
      'view:smm',
      'view:notifications',
      'view:profile',
      'manage:clients',
      'manage:staff',
      'manage:roles',
      'manage:schedule',
      'manage:social_feed',
    ],
  },
  manager: {
    id: 'role-manager',
    name: 'manager',
    label: 'Управляющий',
    sections: [
      'home',
      'floor',
      'staff',
      'clients',
      'reservations',
      'analytics',
      'waitlist',
      'menu',
      'stoplist',
      'schedule',
      'events',
      'tasks',
      'notifications',
      'profile',
      'smm',
      'announcements',
      'rules',
      'chat',
    ],
    permissions: [
      'view:home',
      'view:floor',
      'view:reservations',
      'view:waitlist',
      'view:menu',
      'view:stoplist',
      'view:schedule',
      'view:staff',
      'view:clients',
      'view:events',
      'view:tasks',
      'view:notifications',
      'view:profile',
      'view:analytics',
      'view:smm',
      'view:announcements',
      'view:rules',
      'view:chat',
      'manage:floor',
      'manage:reservations',
      'manage:waitlist',
      'manage:menu',
      'manage:stoplist',
      'manage:schedule',
      'manage:staff',
      'manage:roles',
      'manage:clients',
      'manage:events',
      'manage:tasks',
      'manage:supply_requests',
      'manage:social_feed',
      'manage:announcements',
      'manage:rules',
      'chat:pin_shift',
    ],
  },
  administrator: {
    id: 'role-administrator',
    name: 'administrator',
    label: 'Администратор смены',
    sections: ['home', 'floor', 'reservations', 'waitlist', 'schedule', 'events', 'tasks', 'notifications', 'profile'],
    permissions: [
      'view:home',
      'view:floor',
      'view:reservations',
      'view:waitlist',
      'view:schedule',
      'view:events',
      'view:tasks',
      'view:notifications',
      'view:profile',
      'manage:floor',
      'manage:reservations',
      'manage:waitlist',
      'manage:tasks',
      'manage:events',
    ],
  },
  smm_manager: {
    id: 'role-smm-manager',
    name: 'smm_manager',
    label: 'SMM РјРµРЅРµРґР¶РµСЂ',
    sections: ['smm', 'notifications', 'profile'],
    permissions: ['view:smm', 'manage:social_feed', 'view:notifications', 'view:profile'],
  },
  hostess: {
    id: 'role-hostess',
    name: 'hostess',
    label: 'Хостес',
    sections: ['floor', 'reservations', 'waitlist', 'notifications', 'profile'],
    permissions: [
      'view:floor',
      'view:reservations',
      'view:waitlist',
      'view:notifications',
      'view:profile',
      'manage:floor',
      'manage:reservations',
      'manage:waitlist',
    ],
  },
  waiter: {
    id: 'role-waiter',
    name: 'waiter',
    label: 'Официант',
    sections: ['notebook', 'menu', 'myTables', 'notifications', 'profile'],
    permissions: [
      'view:notebook',
      'view:menu',
      'view:my_tables',
      'view:notifications',
      'view:profile',
    ],
  },
  chef: {
    id: 'role-chef',
    name: 'chef',
    label: 'Шеф-повар',
    sections: ['menu', 'stoplist', 'tasks', 'events', 'notifications', 'profile'],
    permissions: [
      'view:menu',
      'view:stoplist',
      'view:tasks',
      'view:events',
      'view:notifications',
      'view:profile',
      'manage:menu',
      'manage:stoplist',
      'manage:supply_requests',
    ],
  },
  cook: {
    id: 'role-cook',
    name: 'cook',
    label: 'Повар',
    sections: ['stoplist', 'tasks', 'events', 'notifications', 'profile'],
    permissions: [
      'view:stoplist',
      'view:tasks',
      'view:events',
      'view:notifications',
      'view:profile',
      'manage:stoplist',
      'manage:supply_requests',
    ],
  },
  bar: {
    id: 'role-bar',
    name: 'bar',
    label: 'Бармен',
    sections: ['menu', 'stoplist', 'tasks', 'events', 'notifications', 'profile'],
    permissions: [
      'view:menu',
      'view:stoplist',
      'view:tasks',
      'view:events',
      'view:notifications',
      'view:profile',
      'manage:stoplist',
      'manage:supply_requests',
    ],
  },
  technical_staff: {
    id: 'role-technical-staff',
    name: 'technical_staff',
    label: 'Техперсонал',
    sections: ['tasks', 'schedule', 'notifications', 'profile'],
    permissions: [
      'view:tasks',
      'view:schedule',
      'view:notifications',
      'view:profile',
    ],
  },
};

function permissionsFor(role) {
  return roleDefinitions[role]?.permissions ?? [];
}

function can(role, permission) {
  const permissions = permissionsFor(role);
  return permissions.includes('*') || permissions.includes(permission);
}

function sectionsForRole(role) {
  return roleDefinitions[role]?.sections ?? [];
}

function canAccessTech(role) {
  return can(role, 'view:tech_admin') || can(role, 'system:full_access');
}

function canManageStaff(role) {
  return ['technician', 'owner', 'manager'].includes(role);
}

function canManageRoles(role) {
  return ['technician', 'owner', 'manager'].includes(role);
}

function canManageRestaurant(role) {
  return ['technician', 'manager'].includes(role);
}

function canManageGuestClients(role) {
  return ['technician', 'owner', 'manager'].includes(role);
}

function canUseSupplyRequests(role) {
  return ['technician', 'manager', 'administrator', 'chef', 'cook', 'bar'].includes(role);
}

function canManageAllTasks(role) {
  return ['technician', 'manager', 'administrator'].includes(role);
}

function canSeeAllSchedule(role) {
  return ['technician', 'owner', 'manager', 'administrator'].includes(role);
}

function canViewActivityLog(role) {
  return ['technician', 'owner', 'manager'].includes(role);
}

function canManageFloorLayout(role) {
  return ['technician', 'manager'].includes(role);
}

function targetGroupsForRole(role) {
  const groups = [role, 'all'];
  if (['administrator', 'hostess', 'waiter', 'manager', 'technician'].includes(role)) groups.push('hall');
  if (['chef', 'cook', 'manager', 'technician'].includes(role)) groups.push('kitchen');
  if (['bar', 'manager', 'technician'].includes(role)) groups.push('bar');
  if (['hostess', 'waiter', 'chef', 'cook', 'bar', 'administrator', 'manager', 'smm_manager', 'technician'].includes(role)) groups.push('events');
  if (['owner', 'manager', 'administrator', 'smm_manager', 'technician'].includes(role)) groups.push('management');
  if (role === 'technician') groups.push('hostess');
  if (role === 'manager') groups.push('hostess');
  return [...new Set(groups)];
}

function chatIdsForRole(role) {
  const byRole = {
    pending: [],
    technician: ['chat-general', 'chat-hall', 'chat-kitchen', 'chat-bar', 'chat-hostess', 'chat-admins', 'chat-management', 'chat-events', 'chat-shift'],
    owner: ['chat-general', 'chat-admins', 'chat-management'],
    manager: ['chat-general', 'chat-hall', 'chat-kitchen', 'chat-bar', 'chat-hostess', 'chat-admins', 'chat-management', 'chat-events', 'chat-shift'],
    administrator: ['chat-general', 'chat-hall', 'chat-kitchen', 'chat-bar', 'chat-hostess', 'chat-admins', 'chat-management', 'chat-events', 'chat-shift'],
    smm_manager: ['chat-general', 'chat-admins', 'chat-management', 'chat-events'],
    hostess: ['chat-general', 'chat-hall', 'chat-hostess', 'chat-events', 'chat-shift'],
    waiter: ['chat-general', 'chat-hall', 'chat-events', 'chat-shift'],
    chef: ['chat-general', 'chat-kitchen', 'chat-events', 'chat-shift'],
    cook: ['chat-general', 'chat-kitchen', 'chat-events', 'chat-shift'],
    bar: ['chat-general', 'chat-bar', 'chat-events', 'chat-shift'],
    technical_staff: ['chat-general', 'chat-shift'],
  };

  return byRole[role] ?? [];
}

module.exports = {
  ALL_SECTIONS,
  roleDefinitions,
  permissionsFor,
  can,
  sectionsForRole,
  canAccessTech,
  canManageStaff,
  canManageRoles,
  canManageRestaurant,
  canManageGuestClients,
  canUseSupplyRequests,
  canManageAllTasks,
  canSeeAllSchedule,
  canViewActivityLog,
  canManageFloorLayout,
  targetGroupsForRole,
  chatIdsForRole,
};
