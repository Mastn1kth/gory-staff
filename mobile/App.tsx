import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
  AppState,
  BackHandler,
} from 'react-native';

import { AppShell } from './src/screens/AppShell';
import { GuestApp } from './src/screens/GuestApp';
import {
  checkServerConnection,
  connectRealtime,
  getLastActiveMode,
  getOfflineQueueStatus,
  getStoredSession,
  loadSnapshot,
  logout,
  performMutation,
  registerProfile,
  saveSession,
  signIn,
} from './src/data/api';
import type { OfflineQueueStatus } from './src/data/api';
import { initialSectionForRole } from './src/data/permissions';
import { palette } from './src/theme';
import type { ApiSession, DataSnapshot, SectionKey } from './src/types';

const SPLASH_TIMEOUT_MS = 1500;
const ONLINE_REFRESH_MS = 60000;
const OFFLINE_RECOVERY_DELAYS_MS = [2000, 5000, 10000, 30000, 60000];
const FOREGROUND_REFRESH_MIN_MS = 5000;

const EMPTY_QUEUE_STATUS: OfflineQueueStatus = {
  total: 0,
  pending: 0,
  syncing: 0,
  synced: 0,
  failed: 0,
  conflict: 0,
  lastError: null,
  items: [],
};

export default function App() {
  const [session, setSession] = useState<ApiSession | null>(null);
  const [snapshot, setSnapshot] = useState<DataSnapshot | null>(null);
  const [activeSection, setActiveSection] = useState<SectionKey>('home');
  const [sectionHistory, setSectionHistory] = useState<SectionKey[]>([]);
  const [showSplash, setShowSplash] = useState(true);
  const [booting, setBooting] = useState(true);
  const [guestInitialTab, setGuestInitialTab] = useState<'profile' | 'home' | 'menu' | 'route'>('home');
  const [syncing, setSyncing] = useState(false);
  const [offline, setOffline] = useState(false);
  const [queueStatus, setQueueStatus] = useState<OfflineQueueStatus>(EMPTY_QUEUE_STATUS);
  const [realtimeStatus, setRealtimeStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('disconnected');
  const [message, setMessage] = useState<string | null>(null);
  const reconnectAttemptRef = useRef(0);
  const appStateRef = useRef(AppState.currentState);
  const lastForegroundSyncRef = useRef(0);

  const hydrate = useCallback(
    async (targetSession = session, silent = false) => {
      if (!targetSession) return;
      if (!silent) setSyncing(true);
      try {
        const result = await loadSnapshot(targetSession);
        setSnapshot(result.snapshot);
        setOffline(result.offline);
        setQueueStatus(await getOfflineQueueStatus(targetSession.user.id));
        setActiveSection((current) => {
          const allowed = result.snapshot.sections;
          if (allowed.includes(current)) return current;
          return initialSectionForRole(result.snapshot.current_user.role);
        });
      } finally {
        if (!silent) setSyncing(false);
      }
    },
    [session],
  );

  useEffect(() => {
    const timer = setTimeout(() => setShowSplash(false), SPLASH_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const lastMode = await getLastActiveMode();
        if (lastMode === 'guest') return;
        const storedSession = await getStoredSession();
        if (!storedSession || !alive) return;
        setSyncing(true);
        const result = await loadSnapshot(storedSession);
        if (!alive) return;
        setSession(storedSession);
        setSnapshot(result.snapshot);
        setOffline(result.offline);
        setQueueStatus(await getOfflineQueueStatus(storedSession.user.id));
        setActiveSection(initialSectionForRole(result.snapshot.current_user.role));
      } catch (error) {
        if (alive) {
          const text = error instanceof Error ? error.message : 'Сессия истекла. Войдите снова.';
          setMessage(text);
          setSession(null);
          setSnapshot(null);
        }
      } finally {
        if (alive) {
          setSyncing(false);
          setBooting(false);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!session) return undefined;
    const disconnect = connectRealtime(session, {
      onChange: () => {
        if (!syncing) void hydrate(session, true);
      },
      onStatus: setRealtimeStatus,
    });
    return disconnect;
  }, [hydrate, session, syncing]);

  useEffect(() => {
    if (!session) return undefined;
    const activeSession = session;
    const subscription = AppState.addEventListener('change', (nextState) => {
      const wasBackground = appStateRef.current === 'background' || appStateRef.current === 'inactive';
      appStateRef.current = nextState;
      if (nextState !== 'active' || !wasBackground) return;
      const now = Date.now();
      if (now - lastForegroundSyncRef.current < FOREGROUND_REFRESH_MIN_MS) return;
      lastForegroundSyncRef.current = now;
      void checkServerConnection(activeSession.apiUrl)
        .then(async (connection) => {
          if (!connection.online) {
            setOffline(true);
            return;
          }
          await hydrate(activeSession, true);
          setOffline(false);
          setQueueStatus(await getOfflineQueueStatus(activeSession.user.id));
        })
        .catch(() => setOffline(true));
    });
    return () => subscription.remove();
  }, [hydrate, session]);

  useEffect(() => {
    if (!session) return undefined;
    const activeSession = session;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      if (cancelled) return;
      const latestQueue = await getOfflineQueueStatus(activeSession.user.id).catch(() => EMPTY_QUEUE_STATUS);
      if (cancelled) return;
      setQueueStatus(latestQueue);
      const hasQueue = latestQueue.pending > 0 || latestQueue.syncing > 0;
      const shouldCheck = offline || hasQueue || realtimeStatus === 'disconnected' || realtimeStatus === 'error';
      if (!shouldCheck) {
        reconnectAttemptRef.current = 0;
        try {
          await hydrate(activeSession, true);
        } catch {
          if (!cancelled) setOffline(true);
        }
        if (cancelled) return;
        timer = setTimeout(tick, ONLINE_REFRESH_MS);
        return;
      }
      const connection = await checkServerConnection(activeSession.apiUrl);
      if (cancelled) return;
      if (connection.online) {
        const wasOffline = offline;
        reconnectAttemptRef.current = 0;
        await hydrate(activeSession, true);
        if (cancelled) return;
        setOffline(false);
        setQueueStatus(await getOfflineQueueStatus(activeSession.user.id));
        if (wasOffline) setMessage('Подключение восстановлено. Данные обновлены.');
        timer = setTimeout(tick, ONLINE_REFRESH_MS);
        return;
      }
      setOffline(true);
      const delay = OFFLINE_RECOVERY_DELAYS_MS[Math.min(reconnectAttemptRef.current, OFFLINE_RECOVERY_DELAYS_MS.length - 1)];
      reconnectAttemptRef.current += 1;
      timer = setTimeout(tick, delay);
    };

    timer = setTimeout(tick, offline ? 3000 : ONLINE_REFRESH_MS);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [hydrate, offline, realtimeStatus, session]);

  const handleLogin = useCallback(async (apiUrl: string, login: string, password: string) => {
    setMessage(null);
    setSyncing(true);
    try {
      const nextSession = await signIn(apiUrl, login, password);
      const result = await loadSnapshot(nextSession);
      await saveSession(nextSession);
      setSession(nextSession);
      setSnapshot(result.snapshot);
      setOffline(result.offline);
      setQueueStatus(await getOfflineQueueStatus(nextSession.user.id));
      setActiveSection(initialSectionForRole(nextSession.user.role));
    } catch (error) {
      const text = error instanceof Error ? error.message : 'Не удалось войти.';
      setMessage(text);
    } finally {
      setSyncing(false);
    }
  }, []);

  const handleRegister = useCallback(async (apiUrl: string, name: string, phone: string, login: string, password: string) => {
    setMessage(null);
    setSyncing(true);
    try {
      const nextSession = await registerProfile(apiUrl, name, phone, login, password);
      const result = await loadSnapshot(nextSession);
      await saveSession(nextSession);
      setSession(nextSession);
      setSnapshot(result.snapshot);
      setOffline(result.offline);
      setQueueStatus(await getOfflineQueueStatus(nextSession.user.id));
      setActiveSection(initialSectionForRole(nextSession.user.role));
      setSectionHistory([]);
    } catch (error) {
      const text = error instanceof Error ? error.message : 'Не удалось создать профиль.';
      setMessage(text);
    } finally {
      setSyncing(false);
    }
  }, []);

  const resumeStaffSession = useCallback(async () => {
    setMessage(null);
    setSyncing(true);
    try {
      const storedSession = await getStoredSession();
      if (!storedSession) return false;
      const result = await loadSnapshot(storedSession);
      await saveSession(storedSession);
      setSession(storedSession);
      setSnapshot(result.snapshot);
      setOffline(result.offline);
      setQueueStatus(await getOfflineQueueStatus(storedSession.user.id));
      setActiveSection(initialSectionForRole(result.snapshot.current_user.role));
      setSectionHistory([]);
      return true;
    } catch (error) {
      const text = error instanceof Error ? error.message : 'Сессия истекла. Войдите снова.';
      setMessage(text);
      return false;
    } finally {
      setSyncing(false);
    }
  }, []);

  const handleLogout = useCallback(async () => {
    await logout();
    setSession(null);
    setSnapshot(null);
    setQueueStatus(EMPTY_QUEUE_STATUS);
    setGuestInitialTab('profile');
    setActiveSection('home');
    setSectionHistory([]);
    setMessage(null);
  }, []);

  const handleSectionChange = useCallback((nextSection: SectionKey) => {
    setActiveSection((current) => {
      if (current === nextSection) return current;
      setSectionHistory((history) => [...history.slice(-8), current]);
      return nextSection;
    });
  }, []);

  const mutate = useCallback(
    async (method: string, path: string, body?: unknown) => {
      if (!session) return null;
      setSyncing(true);
      try {
        const result = await performMutation(session, method, path, body);
        await hydrate(session, true);
        setOffline(false);
        setQueueStatus(await getOfflineQueueStatus(session.user.id));
        return result;
      } catch (error) {
        const text = error instanceof Error ? error.message : 'Действие сохранено и будет отправлено позже.';
        setMessage(text);
        setOffline(true);
        setQueueStatus(await getOfflineQueueStatus(session.user.id));
        return null;
      } finally {
        setSyncing(false);
      }
    },
    [hydrate, session],
  );

  const currentUser = useMemo(() => snapshot?.current_user ?? session?.user ?? null, [session, snapshot]);

  useEffect(() => {
    if (!session || !snapshot) return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (sectionHistory.length > 0) {
        const previous = sectionHistory[sectionHistory.length - 1];
        setSectionHistory((history) => history.slice(0, -1));
        setActiveSection(previous);
        return true;
      }
      const initial = initialSectionForRole(snapshot.current_user.role);
      if (activeSection !== initial) {
        setActiveSection(initial);
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, [activeSection, sectionHistory, session, snapshot]);

  if (showSplash || booting) {
    return <SplashScreen />;
  }

  if (!session || !snapshot || !currentUser) {
    return (
      <GuestApp
        initialTab={guestInitialTab}
        onDismissStaffMessage={() => setMessage(null)}
        onStaffEntry={resumeStaffSession}
        onStaffLogin={handleLogin}
        onStaffRegister={handleRegister}
        staffLoading={syncing}
        staffMessage={message}
      />
    );
  }

  return (
    <View style={styles.app}>
      <StatusBar style="light" />
      <AppShell
        activeSection={activeSection}
        apiUrl={session.apiUrl}
        currentUser={currentUser}
        message={message}
        offline={offline}
        onDismissMessage={() => setMessage(null)}
        onLogout={handleLogout}
        onMutate={mutate}
        onRefresh={() => hydrate(session, false)}
        onSectionChange={handleSectionChange}
        queueStatus={queueStatus}
        realtimeStatus={realtimeStatus}
        snapshot={snapshot}
        syncing={syncing}
      />
    </View>
  );
}

function SplashScreen() {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(10)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 650,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 650,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [opacity, translateY]);

  return (
    <SafeAreaView style={styles.splash}>
      <StatusBar style="light" />
      <Animated.View style={[styles.splashContent, { opacity, transform: [{ translateY }] }]}>
        <View style={styles.splashMountains}>
          <View style={styles.splashMountainBack} />
          <View style={styles.splashMountainFront} />
        </View>
        <Text style={styles.splashTitle}>Горы</Text>
        <Text style={styles.splashSubtitle}>Ресторан · Кавказская кухня · Атмосфера</Text>
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  app: {
    flex: 1,
    backgroundColor: palette.background,
  },
  splash: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: palette.background,
  },
  splashContent: {
    alignItems: 'center',
  },
  splashMountains: {
    width: 148,
    height: 92,
    marginBottom: 18,
  },
  splashMountainBack: {
    position: 'absolute',
    left: 12,
    top: 28,
    width: 86,
    height: 86,
    borderRadius: 10,
    backgroundColor: 'rgba(242, 212, 137, 0.22)',
    transform: [{ rotate: '45deg' }],
  },
  splashMountainFront: {
    position: 'absolute',
    right: 12,
    top: 14,
    width: 76,
    height: 76,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 249, 239, 0.16)',
    transform: [{ rotate: '45deg' }],
  },
  splashTitle: {
    color: palette.goldSoft,
    fontSize: 46,
    fontWeight: '900',
    letterSpacing: 0,
  },
  splashSubtitle: {
    marginTop: 10,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    color: palette.textMutedOnDark,
  },
});
