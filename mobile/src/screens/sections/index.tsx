import type { SectionKey } from '../../types';

import { ClientsScreen } from './clients';
import {
  AboutScreen,
  AdminScreen,
  AnalyticsScreen,
  AnnouncementsScreen,
  EventsScreen,
  FloorScreen,
  HomeScreen,
  MenuScreen,
  NotebookScreen,
  NotificationsScreen,
  ProfileScreen,
  ReservationsScreen,
  RulesScreen,
  ScheduleScreen,
  SmmScreen,
  StaffScreen,
  StopListScreen,
  TasksScreen,
} from './screens';
import { SettingsScreen } from './SettingsScreen';
import type { SectionProps } from './types';

export type { MutationFn, SectionProps } from './types';

export function renderSection(section: SectionKey, props: SectionProps) {
  switch (section) {
    case 'floor':
      return <FloorScreen {...props} />;
    case 'myTables':
      return <FloorScreen {...props} onlyMine />;
    case 'notebook':
      return <NotebookScreen {...props} />;
    case 'reservations':
      return <ReservationsScreen {...props} />;
    case 'menu':
      return <MenuScreen {...props} />;
    case 'stoplist':
      return <StopListScreen {...props} />;
    case 'schedule':
      return <ScheduleScreen {...props} />;
    case 'staff':
      return <StaffScreen {...props} />;
    case 'clients':
      return <ClientsScreen {...props} />;
    case 'events':
      return <EventsScreen {...props} />;
    case 'announcements':
      return <AnnouncementsScreen {...props} />;
    case 'smm':
      return <SmmScreen {...props} />;
    case 'chat':
      return <NotificationsScreen {...props} />;
    case 'rules':
      return <RulesScreen {...props} />;
    case 'tasks':
      return <TasksScreen {...props} />;
    case 'notifications':
      return <NotificationsScreen {...props} />;
    case 'profile':
      return <ProfileScreen {...props} />;
    case 'settings':
      return <SettingsScreen apiUrl={props.apiUrl ?? ''} />;
    case 'admin':
      return <AdminScreen {...props} />;
    case 'analytics':
      return <AnalyticsScreen {...props} />;
    case 'about':
      return <AboutScreen {...props} />;
    case 'home':
    default:
      return <HomeScreen {...props} />;
  }
}
