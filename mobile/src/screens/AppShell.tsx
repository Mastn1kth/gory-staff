
import { Ionicons } from '@expo/vector-icons';
import { memo, useMemo } from 'react';
import { Pressable, SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { renderSection, type MutationFn } from './sections';
import { prioritySections, sectionDefinitions } from '../data/permissions';
import type { OfflineQueueStatus } from '../data/api';
import { palette } from '../theme';
import type { DataSnapshot, SectionKey, User } from '../types';

export function AppShell({
  activeSection,
  apiUrl,
  currentUser,
  message,
  offline,
  onDismissMessage,
  onLogout,
  onMutate,
  onRefresh,
  onSectionChange,
  queueStatus,
  realtimeStatus,
  snapshot,
  syncing,
}: {
  activeSection: SectionKey;
  apiUrl: string;
  currentUser: User;
  message?: string | null;
  offline: boolean;
  onDismissMessage: () => void;
  onLogout: () => void;
  onMutate: MutationFn;
  onRefresh: () => void;
  onSectionChange: (section: SectionKey) => void;
  queueStatus: OfflineQueueStatus;
  realtimeStatus: 'connecting' | 'connected' | 'disconnected' | 'error';
  snapshot: DataSnapshot;
  syncing: boolean;
}) {
  const { width, height } = useWindowDimensions();
  const landscape = width > height;
  const isTablet = width >= 760 && height >= 520;
  const wideTablet = width >= 1060 && height >= 620;
  const compact = landscape && !isTablet;
  const allowed = useMemo(() => {
    return sectionDefinitions.filter((section) => snapshot.sections.includes(section.key) && !['chat', 'announcements', 'rules'].includes(section.key));
  }, [snapshot.sections]);
  const navSections = useMemo(() => {
    const hiddenByRole: Partial<Record<User['role'], SectionKey[]>> = {
      waiter: ['home'],
      bar: ['home'],
      chef: ['home'],
      cook: ['home'],
    };
    const hidden = hiddenByRole[currentUser.role] ?? [];
    return allowed.filter((section) => !['profile', 'about'].includes(section.key) && !hidden.includes(section.key));
  }, [allowed, currentUser.role]);
  const bottom = prioritySections(currentUser.role, navSections.map((section) => section.key));
  const phoneSections = useMemo(() => {
    const pinned = bottom
      .map((key) => navSections.find((section) => section.key === key))
      .filter((section): section is (typeof navSections)[number] => Boolean(section));
    return pinned;
  }, [navSections, bottom]);
  const canRenderActive = allowed.some((section) => section.key === activeSection)
    && (navSections.some((section) => section.key === activeSection) || ['profile', 'about'].includes(activeSection));
  const safeActiveSection = canRenderActive ? activeSection : navSections[0]?.key ?? allowed[0]?.key ?? 'home';
  const active = sectionDefinitions.find((section) => section.key === safeActiveSection) ?? sectionDefinitions[0];
  const canOpenProfile = allowed.some((section) => section.key === 'profile');
  const canOpenNotifications = allowed.some((section) => section.key === 'notifications');
  const hostessSection: SectionKey | null = allowed.some((section) => section.key === 'floor')
    ? 'floor'
    : allowed.some((section) => section.key === 'reservations')
      ? 'reservations'
      : null;
  const unreadNotifications = snapshot.notifications.filter((item) => !item.is_read).length;
  const openHallSignals = (snapshot.hall_signals ?? []).filter((item) => item.status === 'open').length;
  const menuRestoredCount = snapshot.menu_restored_alerts?.length ?? 0;
  const coordinationBadge = openHallSignals + menuRestoredCount;
  const queueWaiting = queueStatus.pending + queueStatus.syncing;
  const queueProblem = queueStatus.failed + queueStatus.conflict;
  const syncLabel = offline ? 'Нет сети' : queueWaiting > 0 ? `${queueWaiting} ждёт` : syncing ? 'Синхронизация' : 'В сети';
  const syncIcon = offline ? 'cloud-offline' : queueWaiting > 0 ? 'time-outline' : syncing ? 'sync' : 'cloud-done';
  const passiveMessage = message
    ? null
    : offline
      ? `Нет соединения. Показаны последние сохранённые данные.${queueWaiting ? ` ${queueWaiting} действий ожидают синхронизации.` : ''}`
      : queueWaiting
        ? `${queueWaiting} действий ожидают синхронизации.`
        : queueProblem
          ? `${queueProblem} действий требуют проверки после синхронизации.`
          : null;

  const content = renderSection(safeActiveSection, {
    apiUrl,
    currentUser,
    offline,
    navigate: onSectionChange,
    onLogout,
    onMutate,
    onRefresh,
    queueStatus,
    realtimeStatus,
    snapshot,
    syncing,
  });

  return (
    <SafeAreaView style={styles.safe}>
      <View style={[styles.header, compact ? styles.headerCompact : null]}>
        <View style={styles.brandBlock}>
          <Text style={styles.brand}>Горы</Text>
          <Text style={[styles.headerTitle, compact ? styles.headerTitleCompact : null]} numberOfLines={1}>{active.label}</Text>
        </View>
        <View style={styles.headerActions}>
          {hostessSection ? (
            <Pressable
              accessibilityLabel="Хостес"
              onPress={() => onSectionChange(hostessSection)}
              style={({ pressed }) => [styles.bellButton, safeActiveSection === hostessSection ? styles.bellButtonActive : null, pressed ? styles.pressed : null]}
            >
              <Ionicons name="people-circle" size={20} color={safeActiveSection === hostessSection ? palette.ink : palette.textOnDark} />
            </Pressable>
          ) : null}
          {canOpenNotifications ? (
            <Pressable
              onPress={() => onSectionChange('notifications')}
              style={({ pressed }) => [styles.bellButton, safeActiveSection === 'notifications' ? styles.bellButtonActive : null, pressed ? styles.pressed : null]}
            >
              <Ionicons name="notifications" size={19} color={safeActiveSection === 'notifications' ? palette.ink : palette.textOnDark} />
              {unreadNotifications + coordinationBadge > 0 ? (
                <View style={styles.notificationBadge}>
                  <Text style={styles.notificationBadgeText}>
                    {unreadNotifications + coordinationBadge > 9 ? '9+' : unreadNotifications + coordinationBadge}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          ) : null}
          {canOpenProfile ? (
            <Pressable
              onPress={() => onSectionChange('profile')}
              style={({ pressed }) => [styles.bellButton, safeActiveSection === 'profile' ? styles.bellButtonActive : null, pressed ? styles.pressed : null]}
            >
              <Ionicons name="person" size={19} color={safeActiveSection === 'profile' ? palette.ink : palette.textOnDark} />
            </Pressable>
          ) : null}
          <Pressable onPress={onRefresh} style={({ pressed }) => [styles.syncPill, offline ? styles.syncOffline : null, pressed ? styles.pressed : null]}>
            <Ionicons name={syncIcon} size={17} color={offline ? palette.ink : palette.textOnDark} />
            <Text style={[styles.syncText, offline ? styles.syncTextOffline : null]}>{offline ? 'Нет сети' : syncing ? 'Обновляем' : 'В сети'}</Text>
          </Pressable>
        </View>
      </View>

      {message ? (
        <Pressable onPress={onDismissMessage} style={styles.message}>
          <Text style={styles.messageText}>{message}</Text>
        </Pressable>
      ) : null}
      {passiveMessage ? (
        <Pressable onPress={onRefresh} style={styles.message}>
          <Text style={styles.messageText}>{passiveMessage}</Text>
        </Pressable>
      ) : null}

      {isTablet ? (
        <View style={styles.tabletLayout}>
          <View style={styles.sideNav}>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.sideNavContent}>
              {navSections.map((section) => (
                <NavButton
                  key={section.key}
                  section={section}
                  role={currentUser.role}
                  active={section.key === safeActiveSection}
                  onPress={() => onSectionChange(section.key)}
                  side
                  badge={section.key === 'menu' ? menuRestoredCount : section.key === 'home' ? openHallSignals : 0}
                />
              ))}
            </ScrollView>
          </View>
          <View style={styles.tabletContent}>{content}</View>
          {wideTablet ? <TabletOpsRail snapshot={snapshot} onSectionChange={onSectionChange} /> : null}
        </View>
      ) : (
        <>
          <View style={styles.phoneContent}>{content}</View>
          <View style={[styles.bottomNav, compact ? styles.bottomNavCompact : null]}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.bottomNavContent, compact ? styles.bottomNavContentCompact : null]}>
              {phoneSections.map((section) => (
                <NavButton
                  key={section.key}
                  section={section}
                  role={currentUser.role}
                  active={section.key === safeActiveSection}
                  onPress={() => onSectionChange(section.key)}
                  compact={compact}
                  badge={section.key === 'menu' ? menuRestoredCount : section.key === 'home' ? openHallSignals : 0}
                />
              ))}
            </ScrollView>
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

function TabletOpsRail({ snapshot, onSectionChange }: { snapshot: DataSnapshot; onSectionChange: (section: SectionKey) => void }) {
  const activeStop = snapshot.stop_list.filter((item) => item.status !== 'available').length;
  const openTasks = snapshot.tasks.filter((task) => task.status !== 'done').length;
  const waiting = (snapshot.waitlist_entries ?? []).filter((item) => !['seated', 'cancelled'].includes(item.status)).length;
  const supplies = (snapshot.supply_requests ?? []).filter((item) => !['received', 'cancelled'].includes(item.status)).length;
  const nextReservation = snapshot.reservations.find((item) => !['cancelled', 'no_show', 'guests_left'].includes(item.status));
  const nextEvent = snapshot.events.find((item) => !['cancelled', 'done', 'completed'].includes(item.status));

  return (
    <View style={styles.opsRail}>
      <Text style={styles.opsTitle}>Смена</Text>
      <OpsRow label="Стоп-лист" value={activeStop} hot={activeStop > 0} onPress={() => onSectionChange('stoplist')} />
      <OpsRow label="Задачи" value={openTasks} hot={openTasks > 0} onPress={() => onSectionChange('tasks')} />
      {snapshot.sections.includes('waitlist') ? <OpsRow label="Ожидание" value={waiting} hot={waiting > 0} onPress={() => onSectionChange('waitlist')} /> : null}
      {snapshot.sections.includes('stoplist') ? <OpsRow label="Заявки" value={supplies} hot={supplies > 0} onPress={() => onSectionChange('stoplist')} /> : null}
      {nextReservation ? (
        <Pressable onPress={() => onSectionChange('reservations')} style={({ pressed }) => [styles.opsCard, pressed ? styles.pressed : null]}>
          <Text style={styles.opsCardTitle}>Ближайшая бронь</Text>
          <Text style={styles.opsCardText}>{String(nextReservation.time).slice(0, 5)} · {nextReservation.guest_name}</Text>
        </Pressable>
      ) : null}
      {nextEvent ? (
        <Pressable onPress={() => onSectionChange('events')} style={({ pressed }) => [styles.opsCard, pressed ? styles.pressed : null]}>
          <Text style={styles.opsCardTitle}>Ближайший банкет</Text>
          <Text style={styles.opsCardText}>{nextEvent.title} · {nextEvent.guests_count} гостей</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function OpsRow({ label, value, hot, onPress }: { label: string; value: number; hot?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.opsRow, hot ? styles.opsRowHot : null, pressed ? styles.pressed : null]}>
      <Text style={[styles.opsRowLabel, hot ? styles.opsRowLabelHot : null]}>{label}</Text>
      <Text style={[styles.opsRowValue, hot ? styles.opsRowValueHot : null]}>{value}</Text>
    </Pressable>
  );
}

const NavButton = memo(function NavButton({
  section,
  role,
  active,
  onPress,
  side,
  compact,
  badge = 0,
}: {
  section: { key: SectionKey; label: string; shortLabel: string; icon: string };
  role: User['role'];
  active: boolean;
  onPress: () => void;
  side?: boolean;
  compact?: boolean;
  badge?: number;
}) {
  const label = role === 'bar' && section.key === 'menu' ? 'Бар' : side ? section.label : section.shortLabel;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [side ? styles.sideButton : styles.navButton, compact ? styles.navButtonCompact : null, active ? styles.navButtonActive : null, pressed ? styles.pressed : null]}>
      <View>
        <Ionicons name={section.icon as keyof typeof Ionicons.glyphMap} size={side ? 20 : 21} color={active ? palette.ink : palette.textMutedOnDark} />
        {badge > 0 ? (
          <View style={styles.navBadge}>
            <Text style={styles.navBadgeText}>{badge > 9 ? '9+' : badge}</Text>
          </View>
        ) : null}
      </View>
      <Text style={[side ? styles.sideButtonText : styles.navButtonText, active ? styles.navButtonTextActive : null]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    paddingTop: StatusBar.currentHeight ?? 0,
    backgroundColor: palette.background,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerCompact: {
    paddingTop: 2,
    paddingBottom: 6,
  },
  brandBlock: {
    flex: 1,
  },
  brand: {
    color: palette.goldSoft,
    fontSize: 13,
    fontWeight: '900',
  },
  headerTitle: {
    marginTop: 2,
    color: palette.textOnDark,
    fontSize: 25,
    fontWeight: '900',
  },
  headerTitleCompact: {
    fontSize: 20,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  bellButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: 'rgba(255, 248, 234, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(245, 214, 139, 0.2)',
  },
  bellButtonActive: {
    backgroundColor: palette.gold,
    borderColor: palette.gold,
  },
  notificationBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    minWidth: 17,
    height: 17,
    borderRadius: 999,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.red,
  },
  notificationBadgeText: {
    color: palette.textOnDark,
    fontSize: 10,
    fontWeight: '900',
  },
  navBadge: {
    position: 'absolute',
    top: -4,
    right: -8,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.red,
  },
  navBadgeText: {
    color: palette.textOnDark,
    fontSize: 9,
    fontWeight: '900',
  },
  syncPill: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 12,
    backgroundColor: palette.burgundy,
  },
  syncOffline: {
    backgroundColor: palette.goldSoft,
  },
  syncText: {
    color: palette.textOnDark,
    fontSize: 12,
    fontWeight: '900',
  },
  syncTextOffline: {
    color: palette.ink,
  },
  userStrip: {
    marginHorizontal: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(255, 248, 234, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(245, 214, 139, 0.22)',
  },
  userStripCompact: {
    paddingVertical: 7,
    marginHorizontal: 12,
  },
  userName: {
    color: palette.textOnDark,
    fontSize: 15,
    fontWeight: '900',
  },
  userInfo: {
    flex: 1,
  },
  userRole: {
    marginTop: 2,
    color: palette.textMutedOnDark,
    fontSize: 12,
    fontWeight: '700',
  },
  shiftText: {
    color: palette.goldSoft,
    fontSize: 12,
    fontWeight: '900',
  },
  shiftButton: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 12,
    backgroundColor: palette.burgundy,
  },
  shiftButtonActive: {
    backgroundColor: palette.gold,
  },
  shiftButtonText: {
    color: palette.textOnDark,
    fontSize: 12,
    fontWeight: '900',
  },
  shiftButtonTextActive: {
    color: palette.ink,
  },
  message: {
    marginHorizontal: 16,
    marginTop: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: palette.goldSoft,
  },
  messageText: {
    color: palette.ink,
    fontSize: 13,
    fontWeight: '800',
  },
  phoneContent: {
    flex: 1,
  },
  bottomNav: {
    height: 74,
    marginHorizontal: 12,
    marginBottom: 10,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: 'rgba(45, 24, 16, 0.98)',
    borderWidth: 1,
    borderColor: 'rgba(245, 214, 139, 0.24)',
  },
  bottomNavCompact: {
    height: 62,
    marginBottom: 6,
  },
  bottomNavContent: {
    minWidth: '100%',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
  },
  bottomNavContentCompact: {
    gap: 4,
    paddingHorizontal: 6,
  },
  navButton: {
    width: 72,
    minHeight: 58,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    borderRadius: 13,
  },
  navButtonCompact: {
    width: 64,
    minHeight: 50,
  },
  navButtonActive: {
    backgroundColor: palette.gold,
  },
  navButtonText: {
    color: palette.textMutedOnDark,
    fontSize: 11,
    fontWeight: '900',
  },
  navButtonTextActive: {
    color: palette.ink,
  },
  tabletLayout: {
    flex: 1,
    flexDirection: 'row',
    paddingTop: 14,
  },
  sideNav: {
    width: 232,
    paddingLeft: 14,
    paddingRight: 8,
  },
  sideNavContent: {
    gap: 7,
    paddingBottom: 22,
  },
  sideButton: {
    minHeight: 48,
    borderRadius: 12,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  sideButtonText: {
    flex: 1,
    color: palette.textMutedOnDark,
    fontSize: 14,
    fontWeight: '900',
  },
  tabletContent: {
    flex: 1,
  },
  opsRail: {
    width: 286,
    marginRight: 14,
    marginLeft: 8,
    padding: 12,
    gap: 10,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 249, 239, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(245, 214, 139, 0.22)',
  },
  opsTitle: {
    color: palette.goldSoft,
    fontSize: 14,
    fontWeight: '900',
  },
  opsRow: {
    minHeight: 46,
    borderRadius: 12,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255, 249, 239, 0.1)',
  },
  opsRowHot: {
    backgroundColor: palette.gold,
  },
  opsRowLabel: {
    color: palette.textMutedOnDark,
    fontSize: 13,
    fontWeight: '900',
  },
  opsRowLabelHot: {
    color: palette.ink,
  },
  opsRowValue: {
    color: palette.textOnDark,
    fontSize: 18,
    fontWeight: '900',
  },
  opsRowValueHot: {
    color: palette.ink,
  },
  opsCard: {
    borderRadius: 12,
    padding: 12,
    backgroundColor: 'rgba(255, 249, 239, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(245, 214, 139, 0.22)',
  },
  opsCardTitle: {
    color: palette.goldSoft,
    fontSize: 12,
    fontWeight: '900',
  },
  opsCardText: {
    marginTop: 5,
    color: palette.textOnDark,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.75,
  },
});
