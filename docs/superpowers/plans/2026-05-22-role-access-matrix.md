# Role Access Matrix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved restaurant role matrix across the server, seed data, mobile role types, first tabs, and access tests.

**Architecture:** Keep the server as the source of truth for allowed sections and action permissions. Keep the mobile app responsible for labels, first-tab ordering, and hiding unavailable navigation. Use fixed role definitions now, but keep permission strings granular enough for later per-user overrides.

**Tech Stack:** Node.js/Express server, PostgreSQL/pg-mem test server, Expo React Native mobile app, TypeScript role types, Node test runner.

---

## File Structure

- Modify `server/src/permissions.js`: define the new roles, permissions, sections, role groups, and helper functions.
- Modify `server/src/index.js`: replace hard-coded role checks with helper-based checks, update notification groups, snapshots, chat membership, and system access.
- Modify `server/src/routes/menu.js`: allow `chef`, `manager`, and `technician` to manage the full menu; keep `cook` and `bar` limited to operational stop-list/request flows.
- Modify `server/src/routes/staff.js`: let authorized management roles manage users and tasks; keep role assignment protected.
- Modify `server/src/routes/floor.js`: allow restaurant managers and technicians to change floor layout; keep hostess/administrator limited to operational status changes.
- Modify `server/src/routes/admin.js`: restrict client CRM to `owner`, `manager`, and `technician`; keep analytics for owner/manager/technician.
- Modify `server/src/routes/health.js`: move `/system/status` behind technical permission.
- Modify `server/src/seed.js`: seed `owner`, `chef`, `cook`, `technical_staff`, and `technician` demo role mappings.
- Modify `server/test/integration.test.js`: update role logins and assert key matrix rules.
- Modify `mobile/src/types.ts`: add `owner`, `technician`, `chef`, `cook`, and `technical_staff`; remove `kitchen` and `technical` from active role names.
- Modify `mobile/src/data/permissions.ts`: update labels, first sections, and priority navigation.
- Modify `mobile/src/screens/AppShell.tsx`: update role-specific visual behavior from old `kitchen`/`technical` names.
- Modify `mobile/src/components/FloorPlan.tsx`: let `owner`, `manager`, `administrator`, `hostess`, and `technician` send table signals where appropriate.
- Modify `mobile/src/screens/sections/shared.ts`: update assignable roles.
- Modify `mobile/src/screens/sections/screens.tsx`: update role checks for home cards, menu editing, staff editing, task updates, client visibility, and role target options.
- Modify `mobile/src/screens/sections/clients.tsx`: update client access roles.

---

### Task 1: Server Role Model

**Files:**
- Modify: `server/src/permissions.js`
- Test: `server/test/integration.test.js`

- [ ] **Step 1: Write role matrix assertions**

Add assertions in `server/test/integration.test.js` inside the role access matrix test for role sections:

```js
assert.equal(manager.sync.current_user.role, 'manager');
assert.ok(!manager.sync.sections.includes('admin'));
assert.ok(manager.sync.sections.includes('menu'));
assert.ok(manager.sync.sections.includes('clients'));
assert.equal(manager.sync.sections[0], 'home');

assert.equal(owner.sync.current_user.role, 'owner');
assert.deepEqual(owner.sync.sections.slice(0, 5), ['analytics', 'clients', 'staff', 'schedule', 'home']);
assert.ok(!owner.sync.sections.includes('menu'));
assert.ok(!owner.sync.sections.includes('stoplist'));

assert.equal(technician.sync.current_user.role, 'technician');
assert.equal(technician.sync.sections[0], 'admin');
assert.ok(technician.sync.sections.includes('menu'));
assert.ok(technician.sync.sections.includes('clients'));

assert.deepEqual(waiter.sync.sections.slice(0, 5), ['notebook', 'menu', 'myTables', 'notifications', 'profile']);
assert.deepEqual(cook.sync.sections.slice(0, 6), ['stoplist', 'tasks', 'events', 'notifications', 'profile']);
```

- [ ] **Step 2: Run test and verify failure**

Run:

```powershell
npm --workspace server test
```

Expected: FAIL because `owner`, `technician`, `chef`, `cook`, and `technical_staff` are not implemented yet.

- [ ] **Step 3: Implement role definitions**

Update `server/src/permissions.js` so it exports:

```js
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
  'announcements',
  'rules',
  'chat',
  'about',
];

function roleCan(role, roles) {
  return roles.includes(role);
}

function isTechnician(role) {
  return role === 'technician';
}
```

Then define role permissions so:

- `technician` has `['*']`.
- `owner` has client, staff, schedule, home, analytics, notification, profile, and role/staff management permissions, but no menu/stoplist/tech admin permissions.
- `manager` has all restaurant permissions except `view:tech_admin`, `manage:tech_admin`, and `system:*`.
- `administrator` has shift operations only.
- `chef` has full menu and kitchen operation permissions.
- `cook` has stop-list, tasks, supply requests, events, notifications, profile.
- `bar` keeps bar operation permissions.
- `technical_staff` has tasks, schedule, notifications, profile.
- `pending` has only profile.

Add helper exports:

```js
canManageStaff,
canManageRoles,
canManageRestaurant,
canAccessTech,
canManageGuestClients,
canUseSupplyRequests,
canManageAllTasks,
canSeeAllSchedule,
canViewActivityLog,
canManageFloorLayout,
targetGroupsForRole,
chatIdsForRole,
```

- [ ] **Step 4: Run test and verify role definition progress**

Run:

```powershell
npm --workspace server test
```

Expected: failures move from missing roles to route checks and seed data.

### Task 2: Server Route Guards and Snapshot Filtering

**Files:**
- Modify: `server/src/index.js`
- Modify: `server/src/routes/menu.js`
- Modify: `server/src/routes/staff.js`
- Modify: `server/src/routes/floor.js`
- Modify: `server/src/routes/admin.js`
- Modify: `server/src/routes/health.js`
- Test: `server/test/integration.test.js`

- [ ] **Step 1: Replace hard-coded manager checks**

In `server/src/index.js`, import the new helpers from `permissions.js` and replace local hard-coded group functions with the exported helpers:

```js
const {
  can,
  permissionsFor,
  roleDefinitions,
  sectionsForRole,
  canManageStaff,
  canManageRoles,
  canManageRestaurant,
  canAccessTech,
  canManageGuestClients,
  canUseSupplyRequests,
  canManageAllTasks,
  canSeeAllSchedule,
  canViewActivityLog,
  canManageFloorLayout,
  targetGroupsForRole,
  chatIdsForRole,
} = require('./permissions');
```

- [ ] **Step 2: Update guard functions**

Change `requireManager` into a restaurant/staff-management guard:

```js
function requireStaffManagement(req, res, next) {
  if (!canManageStaff(req.user.role)) {
    res.status(403).json({ error: 'Действие доступно только владельцу, управляющему или технику.' });
    return;
  }
  next();
}
```

Keep passing it to routes under the existing `requireManager` dependency name to avoid broad route signature churn:

```js
requireManager: requireStaffManagement,
```

- [ ] **Step 3: Update snapshot role filtering**

Use helpers in `getSnapshot`:

```js
const canSeeSchedule = canSeeAllSchedule(user.role);
const canSeeStaffList = can(user.role, 'view:staff');
const canSeeMenu = can(user.role, 'view:menu');
const canSeeStopList = can(user.role, 'view:stoplist');
const canSeeEvents = can(user.role, 'view:events');
const canSeeTasks = can(user.role, 'view:tasks');
```

Return empty arrays for sections the role does not have, especially `owner` menu/stop-list/kitchen data.

- [ ] **Step 4: Update route guards**

Replace direct role arrays:

```js
['manager', 'administrator'].includes(req.user.role)
```

with helper checks where appropriate:

```js
canManageRestaurant(req.user.role)
canManageStaff(req.user.role)
canManageAllTasks(req.user.role)
canAccessTech(req.user.role)
```

In `server/src/routes/health.js`, protect `/system/status` with:

```js
requirePermission('view:tech_admin')
```

In `server/src/routes/menu.js`, protect menu item create/update with:

```js
requirePermission('manage:menu')
```

In `server/src/routes/floor.js`, protect physical layout fields with `canManageFloorLayout(req.user.role)`.

- [ ] **Step 5: Run server tests**

Run:

```powershell
npm --workspace server test
```

Expected: failures only where seed users still have old roles.

### Task 3: Seed Data and Chat Membership

**Files:**
- Modify: `server/src/seed.js`
- Modify: `server/test/integration.test.js`
- Test: `server/test/integration.test.js`

- [ ] **Step 1: Update demo users**

Change demo roles:

```js
u-admin -> manager
u-administrator -> administrator
u-kitchen -> chef
u-cook -> cook
u-security -> technical_staff
```

Add demo users:

```js
{
  id: 'u-owner',
  name: 'Владелец Ресторана',
  login: 'owner',
  role: 'owner',
  position: 'Владелец',
}
{
  id: 'u-technician',
  name: 'Техник Системы',
  login: 'technician',
  role: 'technician',
  position: 'Техник системы',
}
```

- [ ] **Step 2: Update test logins**

In `server/test/integration.test.js`, login as:

```js
const owner = await loginAs('owner');
const technician = await loginAs('technician');
const chef = await loginAs('kitchen');
const cook = await loginAs('tamara');
```

- [ ] **Step 3: Run server tests**

Run:

```powershell
npm --workspace server test
```

Expected: role matrix and existing auth tests pass.

### Task 4: Mobile Role Types and Navigation

**Files:**
- Modify: `mobile/src/types.ts`
- Modify: `mobile/src/data/permissions.ts`
- Modify: `mobile/src/screens/AppShell.tsx`
- Modify: `mobile/src/components/FloorPlan.tsx`
- Modify: `mobile/src/screens/sections/shared.ts`
- Modify: `mobile/src/screens/sections/clients.tsx`
- Modify: `mobile/src/screens/sections/screens.tsx`
- Test: `mobile` TypeScript check

- [ ] **Step 1: Update role type**

Change `RoleName` to:

```ts
export type RoleName =
  | 'pending'
  | 'technician'
  | 'owner'
  | 'manager'
  | 'administrator'
  | 'hostess'
  | 'waiter'
  | 'chef'
  | 'cook'
  | 'bar'
  | 'technical_staff';
```

- [ ] **Step 2: Update first tabs and labels**

In `mobile/src/data/permissions.ts`, define:

```ts
const preferredByRole: Record<RoleName, SectionKey[]> = {
  pending: ['profile'],
  technician: ['admin', 'home', 'floor', 'staff', 'clients', 'analytics'],
  owner: ['analytics', 'clients', 'staff', 'schedule', 'home'],
  manager: ['home', 'floor', 'staff', 'clients', 'analytics', 'reservations'],
  administrator: ['home', 'floor', 'reservations', 'waitlist', 'schedule', 'events'],
  hostess: ['floor', 'reservations', 'waitlist', 'notifications', 'profile'],
  waiter: ['notebook', 'menu', 'myTables', 'notifications', 'profile'],
  chef: ['menu', 'stoplist', 'tasks', 'events', 'notifications', 'profile'],
  cook: ['stoplist', 'tasks', 'events', 'notifications', 'profile'],
  bar: ['menu', 'stoplist', 'tasks', 'events', 'notifications', 'profile'],
  technical_staff: ['tasks', 'schedule', 'notifications', 'profile'],
};
```

- [ ] **Step 3: Replace old role checks**

Replace old `kitchen` checks with `chef`/`cook`, old `technical` checks with `technical_staff`, and add `technician`/`owner` where role logic requires management access.

- [ ] **Step 4: Run typecheck**

Run:

```powershell
npm --workspace mobile run typecheck
```

Expected: PASS.

### Task 5: Full Verification

**Files:**
- Verify all modified files

- [ ] **Step 1: Run server tests**

Run:

```powershell
npm --workspace server test
```

Expected: PASS.

- [ ] **Step 2: Run mobile typecheck**

Run:

```powershell
npm --workspace mobile run typecheck
```

Expected: PASS.

- [ ] **Step 3: Review git diff**

Run:

```powershell
git diff --stat
git diff -- server/src/permissions.js mobile/src/data/permissions.ts server/test/integration.test.js
```

Expected: changes are limited to role matrix implementation and the plan document.

---

## Self-Review

Spec coverage:

- All roles from the approved spec have implementation tasks.
- First tabs are explicitly covered in mobile and server sections.
- Server-side route protection is covered.
- Seed migration is covered.
- Tests cover role sections, system access, menu editing, and role-specific route protection.

Placeholder scan:

- No `TBD`, `TODO`, or unspecified future work remains in the task list.

Type consistency:

- New role names are consistently `technician`, `owner`, `chef`, `cook`, and `technical_staff`.
- Old role names `kitchen` and `technical` are explicitly migration targets, not final active role names.
