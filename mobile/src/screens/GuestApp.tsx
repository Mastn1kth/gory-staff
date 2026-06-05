// @ts-nocheck — converted from legacy bundle; tab screens use jsx runtime calls.
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { VideoView, useVideoPlayer } from 'expo-video';
import QRCode from 'react-native-qrcode-svg';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as _react from 'react';
import { jsx, jsxs } from 'react/jsx-runtime';
import * as _reactJsxRuntime from 'react/jsx-runtime';
import {
  Animated,
  Clipboard,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { GuestBookingPanel } from '../components/GuestBookingPanel';
import { OAuthButtons } from '../components/OAuthButtons';
import {
  checkServerConnection,
  getFixedApiUrl,
  getStoredGuestSession,
  guestLogin,
  guestRegister,
  guestOAuthLogin,
  commentGuestNewsPost,
  likeGuestNewsPost,
  unlikeGuestNewsPost,
  loadGuestMenu,
  loadGuestNews,
  loadGuestNewsComments,
  loadGuestProfile,
  logoutGuest,
  updateGuestProfile,
} from '../data/api';
import { formatRussianPhoneInput } from '../utils/phoneFormat';
import { Card, EmptyState, Field, KeyboardAwareScrollView, ModalSheet, Pill, PrimaryButton, ScreenScroll, SecondaryButton, SectionTitle } from '../components/ui';
import { palette, shadow } from '../theme';
import * as _theme from '../theme';

const RESTAURANT_ADDRESS = 'Иваново, Советская 36а';
const RESTAURANT_PHONE = '+7 900 100-10-00';
const RESTAURANT_HOURS = 'Ежедневно 12:00-00:00';
const ROUTE_URL = 'https://yandex.ru/maps/?text=%D0%98%D0%B2%D0%B0%D0%BD%D0%BE%D0%B2%D0%BE%2C%20%D0%A1%D0%BE%D0%B2%D0%B5%D1%82%D1%81%D0%BA%D0%B0%D1%8F%2036%D0%B0';
const ROUTE_APP_URL = 'yandexmaps://maps.yandex.ru/?text=%D0%98%D0%B2%D0%B0%D0%BD%D0%BE%D0%B2%D0%BE%2C%20%D0%A1%D0%BE%D0%B2%D0%B5%D1%82%D1%81%D0%BA%D0%B0%D1%8F%2036%D0%B0';
const RESTAURANT_LAT = '57.0004';
const RESTAURANT_LON = '40.9733';
const MAP_IMAGE_URL = `https://staticmap.openstreetmap.de/staticmap.php?center=${RESTAURANT_LAT},${RESTAURANT_LON}&zoom=16&size=650x520&maptype=mapnik&markers=${RESTAURANT_LAT},${RESTAURANT_LON},red-pushpin`;
const GUEST_NEWS_PAGE_SIZE = 10;
const GUEST_NEWS_COMMENTS_PAGE_SIZE = 20;
const loyaltyTiers = [{
    key: 'bronze',
    title: 'Бронза',
    threshold: 0,
    benefits: ['Базовая бонусная карта', 'Участие в акциях']
  }, {
    key: 'silver',
    title: 'Серебро',
    threshold: 3000,
    benefits: ['Больше персональных предложений', 'Приоритетные приглашения']
  }, {
    key: 'gold',
    title: 'Золото',
    threshold: 10000,
    benefits: ['Специальные предложения', 'Повышенные бонусы']
  }, {
    key: 'platinum',
    title: 'Платина',
    threshold: 25000,
    benefits: ['Индивидуальные предложения', 'Лучшие приглашения ресторана']
  }];
const guestTabs = [{
    key: 'news',
    label: 'Профиль',
    icon: 'person-circle-outline'
  }, {
    key: 'restaurant',
    label: 'Главная',
    icon: 'restaurant-outline'
  }, {
    key: 'menu',
    label: 'Меню',
    icon: 'book-outline'
  }, {
    key: 'bonus',
    label: 'Маршрут',
    icon: 'location-outline'
  }];
const guestTabOrder = ['news', 'restaurant', 'menu', 'bonus', 'profile'];
guestTabs[0] = { key: 'news', label: 'Новости', icon: 'newspaper-outline' };
guestTabs[1] = { key: 'restaurant', label: 'Ресторан', icon: 'restaurant-outline' };
guestTabs[3] = { key: 'bonus', label: 'Бонусная карта', icon: 'card-outline' };
guestTabs.push({ key: 'profile', label: 'Профиль', icon: 'person-circle-outline' });
const guestTabsInDisplayOrder = guestTabOrder
  .map(key => guestTabs.find(tab => tab.key === key))
  .filter(Boolean);
const fixedCategories = [
  'Все',
  'Закуски',
  'Горячие закуски',
  'Салаты',
  'Супы',
  'Из печи',
  'Лепешки',
  'Хинкали',
  'Горячее',
  'Гарниры',
  'Мангал',
  'Десерты',
  'Намазки',
  'Особые блюда',
  'Напитки',
  'Вино',
  'Банкетное меню',
];
const transactionLabels = {
    registration_bonus: 'Бонус за регистрацию',
    referral_bonus: 'Бонус за приглашение',
    birthday_bonus: 'Бонус ко дню рождения',
    manual_add: 'Ручное начисление',
    manual_remove: 'Ручное списание',
    purchase_cashback: 'Кэшбэк',
    correction: 'Корректировка',
    expired: 'Сгоревшие бонусы',
    spend: 'Списание'
  };
const orderStatusLabels = {
  ordered: 'Заказал',
  accepted: 'Принято',
  in_progress: 'Готовится',
  done: 'Готово',
  served: 'Принесли',
  cancelled: 'Отменено'
};
const birthdayDays = Array.from({ length: 31 }, (_, index) => String(index + 1).padStart(2, '0'));
const birthdayMonths = Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, '0'));
const birthdayYears = Array.from({ length: 90 }, (_, index) => String(new Date().getFullYear() - 14 - index));
export function GuestApp({
  initialTab = 'news',
  onDismissStaffMessage,
  onStaffEntry,
  onStaffLogin,
  onStaffRegister,
  staffLoading,
  staffMessage,
}: {
  initialTab?: 'news' | 'restaurant' | 'menu' | 'bonus' | 'profile';
  onDismissStaffMessage?: () => void;
  onStaffEntry?: () => Promise<boolean>;
  onStaffLogin: (apiUrl: string, login: string, password: string) => Promise<void>;
  onStaffRegister: (apiUrl: string, name: string, phone: string, login: string, password: string) => Promise<void>;
  staffLoading?: boolean;
  staffMessage?: string | null;
}) {
    const pagerRef = useRef<ScrollView>(null);
    const [activeTab, setActiveTab] = useState(initialTab);
    const [pageWidth, setPageWidth] = useState(1);
    const [guestSession, setGuestSession] = useState(null);
    const [guestProfile, setGuestProfile] = useState(null);
    const [guestMenu, setGuestMenu] = useState({
        categories: [],
        items: []
      });
    const [guestNews, setGuestNews] = useState({ items: [] });
    const [guestNewsLoading, setGuestNewsLoading] = useState(true);
    const [guestNewsLoadingMore, setGuestNewsLoadingMore] = useState(false);
    const [guestNewsHasMore, setGuestNewsHasMore] = useState(false);
    const [guestNewsRefreshing, setGuestNewsRefreshing] = useState(false);
    const [guestMenuLoading, setGuestMenuLoading] = useState(true);
    const [guestOffline, setGuestOffline] = useState(false);
    const [guestSyncing, setGuestSyncing] = useState(false);
    const [guestMessage, setGuestMessage] = useState(null);
    const [guestMode, setGuestMode] = useState(null);
    const [staffVisible, setStaffVisible] = useState(false);
    const [menuQuery, setMenuQuery] = useState('');
    const [selectedDish, setSelectedDish] = useState(null);
    const [selectedNewsPostId, setSelectedNewsPostId] = useState(null);
    const [newsCommentDrafts, setNewsCommentDrafts] = useState({});
    const [newsCommentsByPost, setNewsCommentsByPost] = useState({});
    const [newsCommentsHasMoreByPost, setNewsCommentsHasMoreByPost] = useState({});
    const [newsCommentsNextOffsetByPost, setNewsCommentsNextOffsetByPost] = useState({});
    const [newsCommentsLoading, setNewsCommentsLoading] = useState(false);
    const [newsCommentsLoadingMore, setNewsCommentsLoadingMore] = useState(false);
    const reconnectAttemptRef = useRef(0);
    const [category, setCategory] = useState('Все');
    const [referralModalVisible, setReferralModalVisible] = useState(false);
    const [loyaltyModalVisible, setLoyaltyModalVisible] = useState(false);
    const [guestEditVisible, setGuestEditVisible] = useState(false);
    const [redemptionCodeModalVisible, setRedemptionCodeModalVisible] = useState(false);
    const [redemptionToken, setRedemptionToken] = useState(null);
    const [redemptionTokenLoading, setRedemptionTokenLoading] = useState(false);
    useEffect(() => {
      var alive = true;
      async function bootGuest() {
          var stored = null;
          try {
            stored = await getStoredGuestSession();
            if (!alive) return;
            setGuestSession(stored);
            if (stored) {
              var result = await loadGuestProfile(stored);
              if (!alive) return;
              setGuestProfile(result.profile);
              setGuestOffline(result.offline);
            }
          } catch (error) {
            if (alive) setGuestMessage(error instanceof Error ? error.message : 'Нет соединения с сервером.');
          }
          try {
            var _result = await loadGuestMenu(stored?.apiUrl);
            if (!alive) return;
            setGuestMenu(_result.menu);
            setGuestOffline(current => current || _result.offline);
          } catch (_error) {
            if (alive) setGuestOffline(true);
          } finally {
            if (alive) setGuestMenuLoading(false);
          }
          try {
            var newsResult = await loadGuestNews(stored, { limit: GUEST_NEWS_PAGE_SIZE, offset: 0 });
            if (!alive) return;
            setGuestNews(newsResult.news);
            setGuestNewsHasMore(Boolean(newsResult.news.pagination?.has_more));
            setGuestOffline(current => current || newsResult.offline);
          } catch (_error) {
            if (alive) setGuestOffline(true);
          } finally {
            if (alive) setGuestNewsLoading(false);
          }
      }
      void bootGuest();
      return () => {
        alive = false;
      };
      // Boot runs once on app open; menu/profile are cached by the data layer.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    async function syncGuestData(showRestoredMessage = false) {
        setGuestMenuLoading(true);
        var targetUrl = guestSession?.apiUrl || getFixedApiUrl();
        var connection = await checkServerConnection(targetUrl);
        if (!connection.online) {
          setGuestOffline(true);
          setGuestMenuLoading(false);
          return false;
        }
        setGuestSyncing(true);
        try {
          if (guestSession) {
            var profileResult = await loadGuestProfile(guestSession);
            setGuestProfile(profileResult.profile);
            setGuestSession({
              ...guestSession,
              apiUrl: connection.apiUrl,
              profile: profileResult.profile
            });
          }
          var menuResult = await loadGuestMenu(connection.apiUrl);
          setGuestMenu(menuResult.menu);
          var newsResult = await loadGuestNews(guestSession ? { ...guestSession, apiUrl: connection.apiUrl } : connection.apiUrl, { limit: GUEST_NEWS_PAGE_SIZE, offset: 0 });
          setGuestNews(newsResult.news);
          setGuestNewsHasMore(Boolean(newsResult.news.pagination?.has_more));
          setGuestOffline(false);
          if (showRestoredMessage) setGuestMessage('Подключение восстановлено. Данные обновлены.');
          return true;
        } catch (error) {
          setGuestOffline(true);
          if (showRestoredMessage) setGuestMessage(error instanceof Error ? error.message : 'Нет соединения с сервером.');
          return false;
        } finally {
          setGuestSyncing(false);
          setGuestMenuLoading(false);
        }
    }
    useEffect(() => {
      var cancelled = false;
      var timer = null;
      var delays = [2000, 5000, 10000, 30000, 60000];
      async function tick() {
          if (cancelled) return;
          if (!guestOffline) {
            reconnectAttemptRef.current = 0;
            timer = setTimeout(tick, 90000);
            return;
          }
          var restored = await syncGuestData(true);
          if (cancelled) return;
          if (restored) {
            reconnectAttemptRef.current = 0;
            timer = setTimeout(tick, 90000);
            return;
          }
          var delay = delays[Math.min(reconnectAttemptRef.current, delays.length - 1)];
          reconnectAttemptRef.current += 1;
          timer = setTimeout(tick, delay);
}
      timer = setTimeout(tick, guestOffline ? 3000 : 90000);
      return () => {
        cancelled = true;
        if (timer) clearTimeout(timer);
      };
      // Reconnect loop intentionally follows current guest session and offline status.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [guestOffline, guestSession?.token]);
    useEffect(() => {
      var index = Math.max(0, guestTabOrder.findIndex(tab => tab === initialTab));
      var tab = guestTabOrder[index];
      if (tab) setActiveTab(tab);
      if (pageWidth <= 1) return;
      var timer = setTimeout(() => pagerRef.current?.scrollTo({
        x: index * pageWidth,
        animated: false
      }), 0);
      return () => clearTimeout(timer);
    }, [initialTab, pageWidth]);
    var goToTab = nextTab => {
      var index = guestTabOrder.findIndex(tab => tab === nextTab);
      if (index < 0) return;
      setActiveTab(nextTab);
      pagerRef.current?.scrollTo({
        x: index * pageWidth,
        animated: false
      });
    };
    var menuItems = useMemo(() => guestMenu.items ?? [], [guestMenu.items]);
    var categories = useMemo(() => {
      var fromServer = menuItems.map(item => item.category_name).filter(Boolean);
      return [...new Set([...fixedCategories, ...fromServer])];
    }, [menuItems]);
    var filteredMenu = useMemo(() => {
      var query = menuQuery.trim().toLowerCase();
      return menuItems.filter(item => {
        var categoryMatch = category === 'Все' || item.category_name === category;
        var queryMatch = !query || `${item.name} ${item.category_name ?? ''} ${item.description ?? ''} ${item.composition ?? ''}`.toLowerCase().includes(query);
        return categoryMatch && queryMatch;
      });
    }, [category, menuItems, menuQuery]);
    var popular = useMemo(() => menuItems.filter(item => Number(item.popularity ?? 0) >= 80 || item.is_available).slice(0, 5), [menuItems]);
    var selectedNewsPost = useMemo(() => (guestNews.items ?? []).find(item => item.id === selectedNewsPostId) ?? null, [guestNews.items, selectedNewsPostId]);
    var selectedNewsComments = selectedNewsPost ? newsCommentsByPost[selectedNewsPost.id] ?? selectedNewsPost.comments ?? [] : [];
    var selectedNewsCommentsHasMore = selectedNewsPost ? Boolean(newsCommentsHasMoreByPost[selectedNewsPost.id]) : false;
    async function refreshGuestProfile(session = guestSession) {
        if (!session) return;
        try {
          var result = await loadGuestProfile(session);
          setGuestProfile(result.profile);
          setGuestOffline(result.offline);
        } catch (error) {
          setGuestMessage(error instanceof Error ? error.message : 'Не удалось обновить профиль.');
        }
}
    async function handleGuestAuth(mode, form) {
        setGuestMessage(null);
        try {
          var session = mode === 'login' ? await guestLogin(getFixedApiUrl(), form.phone) : await guestRegister(getFixedApiUrl(), {
            name: form.name,
            phone: form.phone,
            birthday: form.birthday,
            referral_code: form.referralCode,
            personal_data_consent: true,
            marketing_consent: form.marketingConsent
          });
          setGuestSession(session);
          setGuestProfile(session.profile);
          setGuestMode(null);
          setGuestMessage(mode === 'login' ? 'Вход выполнен.' : 'Добро пожаловать в Горы. Мы начислили вам 300 бонусов.');
        } catch (error) {
          var text = error instanceof Error ? error.message : 'Не удалось выполнить действие.';
          setGuestMessage(text);
          throw new Error(text);
        }
}
    async function handleGuestLogout() {
        await logoutGuest();
        setGuestSession(null);
        setGuestProfile(null);
        setGuestMessage('Вы вышли из гостевого профиля.');
}
    function handleGuestCheckedIn(_tableNumber, profile) {
      if (profile?.guest) {
        setGuestProfile(profile);
        setGuestSession(current => current ? { ...current, profile } : current);
      } else {
        void refreshGuestProfile();
      }
    }
    async function handleGuestOrder(menuItemId) {
      if (!guestSession?.token) {
        setGuestMessage('Сначала войдите и привяжитесь к столу.');
        return;
      }
      try {
        setSelectedDish(menuItems.find(item => item.id === menuItemId) ?? null);
        setGuestMessage('Позиция добавлена в заказ.');
        await refreshGuestProfile(guestSession);
      } catch (error) {
        setGuestMessage(error instanceof Error ? error.message : 'Не удалось добавить позицию.');
      }
    }
    async function refreshGuestNews(session = guestSession) {
      var showSkeleton = !(guestNews.items ?? []).length;
      try {
        setGuestNewsRefreshing(true);
        if (showSkeleton) {
          setGuestNewsLoading(true);
        }
        var result = await loadGuestNews(session || getFixedApiUrl(), { limit: GUEST_NEWS_PAGE_SIZE, offset: 0 });
        setGuestNews(result.news);
        setGuestNewsHasMore(Boolean(result.news.pagination?.has_more));
        setGuestOffline(result.offline);
      } catch (error) {
        setGuestMessage(error instanceof Error ? error.message : 'Не удалось обновить новости.');
      } finally {
        setGuestNewsLoading(false);
        setGuestNewsRefreshing(false);
      }
    }
    async function loadMoreGuestNews() {
      if (guestNewsLoading || guestNewsLoadingMore || guestNewsRefreshing || !guestNewsHasMore) return;
      try {
        setGuestNewsLoadingMore(true);
        var offset = (guestNews.items ?? []).length;
        var result = await loadGuestNews(guestSession || getFixedApiUrl(), { limit: GUEST_NEWS_PAGE_SIZE, offset });
        setGuestNews(current => ({
          ...result.news,
          items: [...(current.items ?? []), ...(result.news.items ?? [])]
        }));
        setGuestNewsHasMore(Boolean(result.news.pagination?.has_more));
        setGuestOffline(result.offline);
      } catch (error) {
        setGuestMessage(error instanceof Error ? error.message : 'РќРµ СѓРґР°Р»РѕСЃСЊ РґРѕР·Р°РіСЂСѓР·РёС‚СЊ РЅРѕРІРѕСЃС‚Рё.');
      } finally {
        setGuestNewsLoadingMore(false);
      }
    }
    async function loadNewsComments(post, options = {}) {
      if (!post) return;
      var append = Boolean(options.append);
      var currentComments = newsCommentsByPost[post.id] ?? [];
      var offset = append ? newsCommentsNextOffsetByPost[post.id] ?? currentComments.length : 0;
      if (append && (newsCommentsLoadingMore || !newsCommentsHasMoreByPost[post.id])) return;
      try {
        append ? setNewsCommentsLoadingMore(true) : setNewsCommentsLoading(true);
        var result = await loadGuestNewsComments(guestSession || getFixedApiUrl(), post.id, { limit: GUEST_NEWS_COMMENTS_PAGE_SIZE, offset });
        setNewsCommentsByPost(current => {
          var existing = append ? current[post.id] ?? [] : [];
          var byId = new Map(existing.map(comment => [comment.id, comment]));
          for (var comment of result.comments.items ?? []) byId.set(comment.id, comment);
          return { ...current, [post.id]: Array.from(byId.values()) };
        });
        setNewsCommentsHasMoreByPost(current => ({ ...current, [post.id]: Boolean(result.comments.pagination?.has_more) }));
        setNewsCommentsNextOffsetByPost(current => ({ ...current, [post.id]: result.comments.pagination?.next_offset ?? null }));
      } catch (error) {
        setGuestMessage(error instanceof Error ? error.message : 'РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РіСЂСѓР·РёС‚СЊ РєРѕРјРјРµРЅС‚Р°СЂРёРё.');
      } finally {
        append ? setNewsCommentsLoadingMore(false) : setNewsCommentsLoading(false);
      }
    }
    function openNewsComments(post) {
      setSelectedNewsPostId(post.id);
      void loadNewsComments(post, { append: false });
    }
    function loadMoreNewsComments() {
      if (!selectedNewsPost) return;
      void loadNewsComments(selectedNewsPost, { append: true });
    }
    async function handleNewsLike(post, options = {}) {
      if (!guestSession?.token) {
        setGuestMode('login');
        setGuestMessage('Войдите в профиль, чтобы ставить лайки.');
        return;
      }
      var wasLiked = Boolean(post.liked_by_me);
      if (options.forceLike && wasLiked) return;
      var previousLikeCount = Number(post.like_count ?? 0);
      var nextLiked = options.forceLike ? true : !wasLiked;
      var optimisticLikeCount = Math.max(0, previousLikeCount + (nextLiked ? 1 : -1));
      setGuestNews(current => ({
        ...current,
        items: (current.items ?? []).map(item => item.id === post.id ? { ...item, liked_by_me: nextLiked, like_count: optimisticLikeCount } : item)
      }));
      try {
        var likeResult = nextLiked ? await likeGuestNewsPost(guestSession, post.id) : await unlikeGuestNewsPost(guestSession, post.id);
        setGuestNews(current => ({
          ...current,
          items: (current.items ?? []).map(item => item.id === post.id ? { ...item, liked_by_me: likeResult.liked, like_count: likeResult.like_count } : item)
        }));
      } catch (error) {
        setGuestNews(current => ({
          ...current,
          items: (current.items ?? []).map(item => item.id === post.id ? { ...item, liked_by_me: wasLiked, like_count: previousLikeCount } : item)
        }));
        setGuestMessage(error instanceof Error ? error.message : 'Не удалось поставить лайк.');
      }
    }
    async function handleNewsComment(post) {
      if (!guestSession?.token) {
        setGuestMode('login');
        setGuestMessage('Войдите в профиль, чтобы комментировать.');
        return;
      }
      var text = String(newsCommentDrafts[post.id] ?? '').trim();
      if (!text) return;
      try {
        var comment = await commentGuestNewsPost(guestSession, post.id, text);
        setNewsCommentDrafts(current => ({ ...current, [post.id]: '' }));
        setNewsCommentsByPost(current => ({ ...current, [post.id]: [...(current[post.id] ?? []), comment] }));
        setNewsCommentsHasMoreByPost(current => ({ ...current, [post.id]: Boolean(current[post.id]) }));
        setGuestNews(current => ({
          ...current,
          items: (current.items ?? []).map(item => item.id === post.id ? {
            ...item,
            comment_count: Number(item.comment_count ?? 0) + 1,
            comments: [...(item.comments ?? []), comment]
          } : item)
        }));
      } catch (error) {
        setGuestMessage(error instanceof Error ? error.message : 'Не удалось отправить комментарий.');
      }
    }
    async function handleGuestProfileUpdate(form) {
        if (!guestSession) throw new Error('Сначала войдите в гостевой профиль.');
        var profile = await updateGuestProfile(guestSession, form);
        var nextSession = {
          ...guestSession,
          profile
        };
        setGuestProfile(profile);
        setGuestSession(nextSession);
        setGuestEditVisible(false);
        setGuestMessage('Профиль обновлён.');
}
    function copyReferralCode() {
      var code = guestProfile?.referral.code || guestProfile?.guest.referral_code;
      if (!code) return;
      Clipboard.setString(code);
      setGuestMessage('Реферальный код скопирован.');
    }
    async function shareReferralCode() {
        var code = guestProfile?.referral.code || guestProfile?.guest.referral_code;
        if (!code) return;
        await Share.share({
          message: `Пригласи друга в «Горы»: друг вводит мой код ${code}, а бонусы падают на карту.`
        });
}
    async function openRoute() {
        try {
          var canOpenYandex = await Linking.canOpenURL(ROUTE_APP_URL).catch(() => false);
          await Linking.openURL(canOpenYandex ? ROUTE_APP_URL : ROUTE_URL);
        } catch (_error) {
          setGuestMessage('Не удалось открыть маршрут. Проверьте приложение Яндекс Карты или интернет.');
        }
}
    async function callRestaurant() {
        await Linking.openURL(`tel:${RESTAURANT_PHONE}`);
}
    async function openSupportContact() {
        try {
          await Linking.openURL(`tel:${RESTAURANT_PHONE}`);
        } catch (error) {
          setGuestMessage('Не удалось открыть телефон.');
        }
}
    async function openTermsOfService() {
        try {
          // Можно заменить на реальную ссылку на пользовательское соглашение
          const termsUrl = 'https://gory-restaurant.ru/terms';
          const canOpen = await Linking.canOpenURL(termsUrl).catch(() => false);
          if (canOpen) {
            await Linking.openURL(termsUrl);
          } else {
            setGuestMessage('Пользовательское соглашение: Используя приложение, вы соглашаетесь с условиями обработки персональных данных и бонусной программы ресторана Горы.');
          }
        } catch (error) {
          setGuestMessage('Не удалось открыть пользовательское соглашение.');
        }
}
    function copyAddress() {
      Clipboard.setString(RESTAURANT_ADDRESS);
      setGuestMessage('Адрес скопирован.');
    }
    async function openStaffEntry() {
      onDismissStaffMessage?.();
      if (onStaffEntry) {
        const resumed = await onStaffEntry();
        if (resumed) return;
      }
      setStaffVisible(true);
    }
    async function showRedemptionCode() {
      if (!guestSession?.token) {
        setGuestMode('login');
        setGuestMessage('Войдите в профиль для списания бонусов.');
        return;
      }
      if (guestOffline) {
        setGuestMessage('Для списания бонусов требуется подключение к интернету.');
        return;
      }
      setRedemptionCodeModalVisible(true);
      await loadRedemptionToken();
    }
    async function loadRedemptionToken() {
      if (!guestSession?.token) return;
      setRedemptionTokenLoading(true);
      try {
        const { getGuestBonusRedemptionToken } = await import('../data/api');
        const token = await getGuestBonusRedemptionToken(guestSession);
        setRedemptionToken(token);
      } catch (error) {
        setGuestMessage(error instanceof Error ? error.message : 'Не удалось получить код.');
      } finally {
        setRedemptionTokenLoading(false);
      }
    }
    async function refreshRedemptionToken() {
      if (!guestSession?.token) return;
      setRedemptionTokenLoading(true);
      try {
        const { refreshGuestBonusRedemptionToken } = await import('../data/api');
        const token = await refreshGuestBonusRedemptionToken(guestSession);
        setRedemptionToken(token);
        setGuestMessage('Код обновлён.');
      } catch (error) {
        setGuestMessage(error instanceof Error ? error.message : 'Не удалось обновить код.');
      } finally {
        setRedemptionTokenLoading(false);
      }
    }
    useEffect(() => {
      if (!redemptionCodeModalVisible || !guestSession?.token) return;
      const interval = setInterval(() => {
        void loadRedemptionToken();
      }, 5 * 60 * 1000); // Обновляем каждые 5 минут
      return () => clearInterval(interval);
    }, [redemptionCodeModalVisible, guestSession?.token]);
    return /*#__PURE__*/jsxs(SafeAreaView, {
      style: styles.app,
      children: [/*#__PURE__*/jsx(StatusBar, {
        style: "dark"
      }), /*#__PURE__*/jsxs(View, {
        style: styles.shell,
        children: [/*#__PURE__*/jsxs(ScrollView, {
          ref: pagerRef,
          horizontal: true,
          scrollEnabled: false,
          disableScrollViewPanResponder: true,
          showsHorizontalScrollIndicator: false,
          onLayout: event => setPageWidth(event.nativeEvent.layout.width),
          contentOffset: {
            x: Math.max(0, guestTabOrder.findIndex(tab => tab === initialTab)) * pageWidth,
            y: 0
          },
          style: styles.pager,
          children: [/*#__PURE__*/jsx(GuestPage, {
            width: pageWidth,
            children: /*#__PURE__*/jsx(GuestNewsScreen, {
              items: guestNews.items ?? [],
              loading: guestNewsLoading,
              loadingMore: guestNewsLoadingMore,
              hasMore: guestNewsHasMore,
              refreshing: guestNewsRefreshing,
              selectedPost: selectedNewsPost,
              selectedPostComments: selectedNewsComments,
              commentsLoading: newsCommentsLoading,
              commentsLoadingMore: newsCommentsLoadingMore,
              commentsHasMore: selectedNewsCommentsHasMore,
              commentDrafts: newsCommentDrafts,
              onCommentDraft: (postId, text) => setNewsCommentDrafts(current => ({ ...current, [postId]: text })),
              onComment: handleNewsComment,
              onLike: handleNewsLike,
              onLoadMore: loadMoreGuestNews,
              onOpenComments: openNewsComments,
              onLoadMoreComments: loadMoreNewsComments,
              onCloseComments: () => setSelectedNewsPostId(null),
              guestMessage: guestMessage,
              offline: guestOffline,
              profile: guestProfile,
              guestSession: guestSession,
              onCopyCode: copyReferralCode,
              onLogin: () => setGuestMode('login'),
              onLogout: handleGuestLogout,
              onEditProfile: () => setGuestEditVisible(true),
              onRefresh: () => refreshGuestNews(),
              onRegister: () => setGuestMode('register'),
              onShowCode: () => setReferralModalVisible(true),
              onShowLevel: () => setLoyaltyModalVisible(true),
              onShareCode: shareReferralCode,
              onStaff: openStaffEntry
            })
          }), /*#__PURE__*/jsx(GuestPage, {
            width: pageWidth,
            children: /*#__PURE__*/jsx(GuestRestaurantScreen, {
              offline: guestOffline,
              popular: popular,
              guestSession: guestSession,
              guestName: guestProfile?.guest?.name ?? 'Гость',
              onOpenMenu: () => goToTab('menu'),
              onRoute: openRoute,
              onCall: callRestaurant,
              onCopyAddress: copyAddress,
              onLogin: () => setGuestMode('login')
            })
          }), /*#__PURE__*/jsx(GuestPage, {
            width: pageWidth,
            children: /*#__PURE__*/jsx(GuestMenuScreen, {
              categories: categories,
              category: category,
              guestSession: guestSession,
              guestProfile: guestProfile,
              items: filteredMenu,
              loading: guestMenuLoading,
              offline: guestOffline,
              query: menuQuery,
              onCategory: setCategory,
              onDishPress: setSelectedDish,
              onQuery: setMenuQuery,
              onRefresh: () => syncGuestData(true)
            })
          }), /*#__PURE__*/jsx(GuestPage, {
            width: pageWidth,
            children: /*#__PURE__*/jsx(GuestBonusScreen, {
              offline: guestOffline,
              profile: guestProfile,
              onCopyCode: copyReferralCode,
              onLogin: () => setGuestMode('login'),
              onRefresh: () => refreshGuestProfile(),
              onRegister: () => setGuestMode('register'),
              onShowCode: () => setReferralModalVisible(true),
              onShowLevel: () => setLoyaltyModalVisible(true),
              onShareCode: shareReferralCode
            })
          }), /*#__PURE__*/jsx(GuestPage, {
            width: pageWidth,
            children: /*#__PURE__*/jsx(GuestProfileScreen, {
              guestMessage: guestMessage,
              offline: guestOffline,
              profile: guestProfile,
              guestSession: guestSession,
              onLogin: () => setGuestMode('login'),
              onLogout: handleGuestLogout,
              onEditProfile: () => setGuestEditVisible(true),
              onRefresh: () => refreshGuestProfile(),
              onRegister: () => setGuestMode('register'),
              onStaff: openStaffEntry,
              onSupportContact: openSupportContact,
              onTermsOfService: openTermsOfService
            })
          })]
        }), guestOffline || guestSyncing ? /*#__PURE__*/jsxs(View, {
          style: styles.connectionBanner,
          children: [/*#__PURE__*/jsx(Ionicons, {
            name: guestOffline ? 'cloud-offline-outline' : 'sync-outline',
            size: 18,
            color: palette.ink
          }), /*#__PURE__*/jsx(Text, {
            style: styles.connectionBannerText,
            children: guestOffline ? 'Нет соединения. Показаны последние сохранённые данные.' : 'Синхронизация данных.'
          })]
        }) : null, /*#__PURE__*/jsx(View, {
          style: styles.bottomNav,
          children: guestTabsInDisplayOrder.map(tab => {
            var active = activeTab === tab.key;
            return /*#__PURE__*/jsxs(Pressable, {
              onPress: () => goToTab(tab.key),
              style: [styles.navItem, active ? styles.navItemActive : null],
              children: [/*#__PURE__*/jsx(Ionicons, {
                name: tab.icon,
                size: 22,
                color: active ? '#24201D' : '#A39E98'
              }), /*#__PURE__*/jsx(Text, {
                style: [styles.navText, active ? styles.navTextActive : null],
                numberOfLines: 1,
                children: tab.label
              })]
            }, tab.key);
          })
        })]
      }), /*#__PURE__*/jsx(GuestAuthModal, {
        visible: guestMode !== null,
        mode: guestMode,
        onClose: () => setGuestMode(null),
        onSubmit: handleGuestAuth,
        onOAuthSuccess: (session) => {
          setGuestSession(session);
          setGuestProfile(session.profile);
          setGuestMode(null);
          const provider = session.profile?.guest?.oauth_provider;
          const providerName = provider === 'yandex' ? 'Яндекс' : provider === 'vk' ? 'ВКонтакте' : 'OAuth';
          setGuestMessage(`Вход выполнен через ${providerName}`);
        }
      }), /*#__PURE__*/jsx(ReferralCodeModal, {
        visible: referralModalVisible,
        profile: guestProfile,
        onClose: () => setReferralModalVisible(false),
        onCopyCode: copyReferralCode,
        onShareCode: shareReferralCode
      }), /*#__PURE__*/jsx(LoyaltyLevelModal, {
        visible: loyaltyModalVisible,
        profile: guestProfile,
        onClose: () => setLoyaltyModalVisible(false)
      }), /*#__PURE__*/jsx(GuestEditProfileModal, {
        visible: guestEditVisible,
        profile: guestProfile,
        onClose: () => setGuestEditVisible(false),
        onSubmit: handleGuestProfileUpdate
      }), /*#__PURE__*/jsx(BonusRedemptionCodeModal, {
        visible: redemptionCodeModalVisible,
        token: redemptionToken,
        loading: redemptionTokenLoading,
        onClose: () => setRedemptionCodeModalVisible(false),
        onRefresh: refreshRedemptionToken
      }), /*#__PURE__*/jsx(StaffLoginModal, {
        visible: staffVisible,
        loading: staffLoading,
        message: staffMessage,
        onClose: () => {
          setStaffVisible(false);
          onDismissStaffMessage();
        },
        onSubmit: (login, password) => onStaffLogin(getFixedApiUrl(), login, password),
        onRegister: (name, phone, login, password) => onStaffRegister(getFixedApiUrl(), name, phone, login, password)
      }), /*#__PURE__*/jsx(DishDetailModal, {
        item: selectedDish,
        visible: Boolean(selectedDish),
        onClose: () => setSelectedDish(null)
      })]
    });
  }
  function GuestPage(_ref2) {
    var children = _ref2.children,
      width = _ref2.width;
    return /*#__PURE__*/jsx(View, {
      style: [styles.page, {
        width
      }],
      children: children
    });
  }
  function GuestNewsScreen(_ref3) {
    var items = _ref3.items ?? [],
      loading = _ref3.loading,
      loadingMore = _ref3.loadingMore,
      hasMore = _ref3.hasMore,
      refreshing = _ref3.refreshing,
      offline = _ref3.offline,
      selectedPost = _ref3.selectedPost,
      selectedPostComments = _ref3.selectedPostComments ?? [],
      commentsLoading = _ref3.commentsLoading,
      commentsLoadingMore = _ref3.commentsLoadingMore,
      commentsHasMore = _ref3.commentsHasMore,
      commentDrafts = _ref3.commentDrafts ?? {},
      onCommentDraft = _ref3.onCommentDraft,
      onComment = _ref3.onComment,
      onLike = _ref3.onLike,
      onLoadMore = _ref3.onLoadMore,
      onOpenComments = _ref3.onOpenComments,
      onLoadMoreComments = _ref3.onLoadMoreComments,
      onCloseComments = _ref3.onCloseComments,
      guestSession = _ref3.guestSession,
      onLogin = _ref3.onLogin,
      onRefresh = _ref3.onRefresh;
    var handleFeedScroll = event => {
      var nativeEvent = event.nativeEvent;
      var distanceToEnd = nativeEvent.contentSize.height - (nativeEvent.layoutMeasurement.height + nativeEvent.contentOffset.y);
      if (distanceToEnd < 360) onLoadMore?.();
    };
    return /*#__PURE__*/jsxs(KeyboardAwareScrollView, {
      contentContainerStyle: styles.feedContent,
      baseBottomPadding: 118,
      showsVerticalScrollIndicator: false,
      keyboardShouldPersistTaps: "handled",
      contentInsetAdjustmentBehavior: "automatic",
      onScroll: handleFeedScroll,
      scrollEventThrottle: 16,
      refreshControl: /*#__PURE__*/jsx(RefreshControl, {
        refreshing: Boolean(refreshing),
        onRefresh: onRefresh,
        tintColor: palette.burgundy,
        colors: [palette.burgundy],
        progressBackgroundColor: palette.surface
      }),
      children: [/*#__PURE__*/jsxs(View, {
        style: styles.headerLine,
        children: [/*#__PURE__*/jsx(Text, {
          style: styles.brand,
          children: "Горы"
        }), offline ? /*#__PURE__*/jsx(Text, {
          style: styles.offlineBadge,
          children: "нет связи"
        }) : null]
      }), /*#__PURE__*/jsx(Text, {
        style: styles.screenTitle,
        children: "Новости"
      }), loading ? /*#__PURE__*/jsx(NewsSkeletonList, {}) : items.length ? items.map(post => /*#__PURE__*/jsx(NewsPostCard, {
        post: post,
        onLike: options => onLike(post, options),
        onOpenComments: () => onOpenComments(post)
      }, post.id)) : /*#__PURE__*/jsxs(Card, {
        tone: "soft",
        children: [/*#__PURE__*/jsx(Text, {
          style: styles.cardTitleDark,
          children: "Новостей пока нет"
        }), /*#__PURE__*/jsx(Text, {
          style: styles.mutedDark,
          children: "Когда SMM опубликует пост или подтянется отметка из Instagram/VK, она появится здесь."
        }), /*#__PURE__*/jsx(SecondaryButton, {
          title: "Обновить новости",
          onPress: onRefresh
        })]
      }), loadingMore ? /*#__PURE__*/jsx(NewsSkeletonCard, {
        compact: true
      }) : null, hasMore && !loading && !loadingMore ? /*#__PURE__*/jsx(SecondaryButton, {
        title: "Показать ещё",
        onPress: onLoadMore
      }) : null, !guestSession?.token ? /*#__PURE__*/jsx(SecondaryButton, {
        title: "Войти, чтобы комментировать",
        onPress: onLogin
      }) : null, /*#__PURE__*/jsx(NewsCommentsSheet, {
        post: selectedPost,
        comments: selectedPostComments,
        loading: commentsLoading,
        loadingMore: commentsLoadingMore,
        hasMore: commentsHasMore,
        draft: selectedPost ? commentDrafts[selectedPost.id] ?? '' : '',
        visible: Boolean(selectedPost),
        onDraft: text => selectedPost ? onCommentDraft(selectedPost.id, text) : null,
        onComment: () => selectedPost ? onComment(selectedPost) : null,
        onLoadMore: onLoadMoreComments,
        onClose: onCloseComments
      })]
    });
  }
  function NewsSkeletonList() {
    return /*#__PURE__*/jsxs(Fragment, {
      children: [/*#__PURE__*/jsx(NewsSkeletonCard, {}), /*#__PURE__*/jsx(NewsSkeletonCard, {
        compact: true
      })]
    });
  }
  function NewsSkeletonCard(_refSkeleton) {
    var compact = _refSkeleton?.compact;
    return /*#__PURE__*/jsxs(Card, {
      children: [/*#__PURE__*/jsx(View, {
        style: [styles.newsSkeletonMedia, compact ? styles.newsSkeletonMediaCompact : null]
      }), /*#__PURE__*/jsx(View, {
        style: styles.newsSkeletonLine
      }), /*#__PURE__*/jsx(View, {
        style: styles.newsSkeletonLineShort
      }), /*#__PURE__*/jsxs(View, {
        style: styles.newsSkeletonActions,
        children: [/*#__PURE__*/jsx(View, {
          style: styles.newsSkeletonPill
        }), /*#__PURE__*/jsx(View, {
          style: styles.newsSkeletonPill
        })]
      })]
    });
  }
  function NewsCommentsSheet(_refCommentsSheet) {
    var post = _refCommentsSheet.post,
      visible = _refCommentsSheet.visible,
      comments = _refCommentsSheet.comments ?? [],
      loading = _refCommentsSheet.loading,
      loadingMore = _refCommentsSheet.loadingMore,
      hasMore = _refCommentsSheet.hasMore,
      draft = _refCommentsSheet.draft,
      onDraft = _refCommentsSheet.onDraft,
      onComment = _refCommentsSheet.onComment,
      onLoadMore = _refCommentsSheet.onLoadMore,
      onClose = _refCommentsSheet.onClose;
    return /*#__PURE__*/jsx(ModalSheet, {
      visible: visible,
      title: "РљРѕРјРјРµРЅС‚Р°СЂРёРё",
      onClose: onClose,
      children: post ? /*#__PURE__*/jsxs(View, {
        style: styles.commentsSheetBody,
        children: [/*#__PURE__*/jsx(Text, {
          style: styles.cardTitleDark,
          children: post.title
        }), loading ? /*#__PURE__*/jsx(Text, {
          style: styles.mutedDark,
          children: "Р—Р°РіСЂСѓР¶Р°РµРј РєРѕРјРјРµРЅС‚Р°СЂРёРё"
        }) : comments.length ? comments.map(comment => /*#__PURE__*/jsxs(View, {
          style: styles.commentLine,
          children: [/*#__PURE__*/jsx(Text, {
            style: styles.commentAuthor,
            children: comment.guest_name ?? "Р“РѕСЃС‚СЊ"
          }), /*#__PURE__*/jsx(Text, {
            style: styles.commentText,
            children: comment.text
          })]
        }, comment.id)) : /*#__PURE__*/jsx(Text, {
          style: styles.mutedDark,
          children: "РџРѕРєР° РЅРµС‚ РєРѕРјРјРµРЅС‚Р°СЂРёРµРІ."
        }), hasMore ? /*#__PURE__*/jsx(SecondaryButton, {
          title: loadingMore ? "Р—Р°РіСЂСѓР¶Р°РµРј..." : "РџРѕРєР°Р·Р°С‚СЊ РµС‰С‘",
          onPress: onLoadMore
        }) : null, /*#__PURE__*/jsxs(View, {
          style: styles.commentComposer,
          children: [/*#__PURE__*/jsx(Field, {
            label: "РљРѕРјРјРµРЅС‚Р°СЂРёР№",
            placeholder: "РќР°РїРёСЃР°С‚СЊ РєРѕРјРјРµРЅС‚Р°СЂРёР№",
            value: draft,
            onChangeText: onDraft
          }), /*#__PURE__*/jsx(SecondaryButton, {
            title: "РћС‚РїСЂР°РІРёС‚СЊ",
            onPress: onComment
          })]
        })]
      }) : null
    });
  }
  function NewsVideoPlayer(_refVideo) {
    var url = _refVideo.url;
    var player = useVideoPlayer(url, player => {
      player.loop = true;
      player.muted = false;
    });
    return /*#__PURE__*/jsx(VideoView, {
      player: player,
      style: styles.feedMedia,
      nativeControls: true,
      allowsFullscreen: true,
      contentFit: "cover"
    });
  }
  function NewsPostCard(_refNewsPost) {
    var post = _refNewsPost.post,
      onLike = _refNewsPost.onLike,
      onOpenComments = _refNewsPost.onOpenComments;
    var media = post.media?.[0] ?? null;
    var imageUrl = media?.thumbnail_url || media?.url;
    var isVideo = media?.media_type === 'video' && media?.url;
    var lastTapRef = useRef(0);
    var [heartBurstVisible, setHeartBurstVisible] = useState(false);
    var handleMediaTap = () => {
      var now = Date.now();
      if (now - lastTapRef.current < 300) {
        setHeartBurstVisible(true);
        onLike({ forceLike: true });
        setTimeout(() => setHeartBurstVisible(false), 520);
      }
      lastTapRef.current = now;
    };
    var previewComments = (post.comments ?? []).slice(-2);
    return /*#__PURE__*/jsxs(Card, {
      children: [imageUrl ? /*#__PURE__*/jsxs(Pressable, {
        onPress: handleMediaTap,
        style: styles.feedMediaFrame,
        children: [isVideo ? /*#__PURE__*/jsx(NewsVideoPlayer, {
          url: media.url
        }) : /*#__PURE__*/jsx(Image, {
          source: { uri: imageUrl },
          style: styles.feedMedia
        }), heartBurstVisible ? /*#__PURE__*/jsx(View, {
          pointerEvents: "none",
          style: styles.newsHeartBurst,
          children: /*#__PURE__*/jsx(Ionicons, {
            name: "heart",
            size: 76,
            color: "#fe2c55"
          })
        }) : null]
      }) : null, /*#__PURE__*/jsx(Text, {
        style: styles.cardTitleDark,
        children: post.title
      }), /*#__PURE__*/jsx(Text, {
        style: styles.mutedDark,
        children: post.body
      }), /*#__PURE__*/jsxs(View, {
        style: styles.newsActions,
        children: [/*#__PURE__*/jsxs(Pressable, {
          onPress: () => onLike(),
          style: [styles.newsActionButton, styles.newsLikeButton, post.liked_by_me ? styles.newsLikeButtonActive : null],
          children: [/*#__PURE__*/jsx(Ionicons, {
            name: post.liked_by_me ? "heart" : "heart-outline",
            size: 20,
            color: post.liked_by_me ? "#fe2c55" : "#8e8e93"
          }), /*#__PURE__*/jsx(Text, {
            style: [styles.newsActionText, styles.newsLikeText, post.liked_by_me ? styles.newsLikeTextActive : null],
            children: String(post.like_count ?? 0)
          })]
        }), /*#__PURE__*/jsxs(Pressable, {
          onPress: onOpenComments,
          style: styles.newsActionButton,
          children: [/*#__PURE__*/jsx(Ionicons, {
            name: "chatbubble-outline",
            size: 20,
            color: palette.ink
          }), /*#__PURE__*/jsx(Text, {
            style: styles.newsActionText,
            children: String(post.comment_count ?? 0)
          })]
        })]
      }), previewComments.map(comment => /*#__PURE__*/jsxs(View, {
        style: styles.commentLine,
        children: [/*#__PURE__*/jsx(Text, {
          style: styles.commentAuthor,
          children: comment.guest_name ?? "Гость"
        }), /*#__PURE__*/jsx(Text, {
          style: styles.commentText,
          children: comment.text
        })]
      }, comment.id)), Number(post.comment_count ?? 0) > previewComments.length ? /*#__PURE__*/jsx(Pressable, {
        onPress: onOpenComments,
        style: styles.newsCommentsMore,
        children: /*#__PURE__*/jsx(Text, {
          style: styles.newsCommentsMoreText,
          children: "Открыть комментарии"
        })
      }) : null]
    });
  }
  function GuestProfileScreen(_ref3) {
    var guestMessage = _ref3.guestMessage,
      offline = _ref3.offline,
      profile = _ref3.profile,
      guestSession = _ref3.guestSession,
      onCopyCode = _ref3.onCopyCode,
      onLogin = _ref3.onLogin,
      onLogout = _ref3.onLogout,
      onEditProfile = _ref3.onEditProfile,
      onRefresh = _ref3.onRefresh,
      onRegister = _ref3.onRegister,
      onShowCode = _ref3.onShowCode,
      onShowLevel = _ref3.onShowLevel,
      onShareCode = _ref3.onShareCode,
      onStaff = _ref3.onStaff,
      onSupportContact = _ref3.onSupportContact,
      onTermsOfService = _ref3.onTermsOfService;
    var guest = profile?.guest ?? null;
    return /*#__PURE__*/jsxs(KeyboardAwareScrollView, {
      contentContainerStyle: styles.content,
      baseBottomPadding: 118,
      showsVerticalScrollIndicator: false,
      keyboardShouldPersistTaps: "handled",
      contentInsetAdjustmentBehavior: "automatic",
      children: [/*#__PURE__*/jsxs(View, {
        style: styles.headerLine,
        children: [/*#__PURE__*/jsx(Text, {
          style: styles.brand,
          children: "Горы"
        }), offline ? /*#__PURE__*/jsx(Text, {
          style: styles.offlineBadge,
          children: "нет связи"
        }) : null]
      }), /*#__PURE__*/jsx(Text, {
        style: styles.screenTitle,
        children: "Профиль"
      }), guestMessage ? /*#__PURE__*/jsx(Text, {
        style: styles.notice,
        children: guestMessage
      }) : null, guest ? /*#__PURE__*/jsxs(Fragment, {
        children: [/*#__PURE__*/jsxs(Card, {
          children: [/*#__PURE__*/jsx(Text, {
            style: styles.cardTitleDark,
            children: guest.name
          }), /*#__PURE__*/jsx(Text, {
            style: styles.mutedDark,
            children: guest.phone
          }), guest.birthday ? /*#__PURE__*/jsx(Text, {
            style: styles.mutedDark,
            children: `День рождения: ${guest.birthday}`
          }) : null]
        }), /*#__PURE__*/jsx(SecondaryButton, {
          title: "Редактировать профиль",
          onPress: onEditProfile
        }), /*#__PURE__*/jsx(SecondaryButton, {
          title: "Обновить профиль",
          onPress: onRefresh
        }), /*#__PURE__*/jsx(SecondaryButton, {
          title: "Выйти",
          danger: true,
          onPress: onLogout
        })]
      }) : /*#__PURE__*/jsxs(Card, {
        tone: "soft",
        children: [/*#__PURE__*/jsx(Text, {
          style: styles.cardTitleDark,
          children: "Вход в гостевой профиль"
        }), /*#__PURE__*/jsx(Text, {
          style: styles.mutedDark,
          children: "Войдите или зарегистрируйтесь, чтобы редактировать личные данные."
        }), /*#__PURE__*/jsxs(View, {
          style: styles.rowButtons,
          children: [/*#__PURE__*/jsx(PrimaryButton, {
            title: "Войти",
            onPress: onLogin
          }), /*#__PURE__*/jsx(SecondaryButton, {
            title: "Регистрация",
            onPress: onRegister
          })]
        })]
      }), /*#__PURE__*/jsxs(Pressable, {
        onPress: onStaff,
        style: styles.staffButton,
        children: [/*#__PURE__*/jsx(Ionicons, {
          name: "shield-checkmark-outline",
          size: 18,
          color: "#8B8178"
        }), /*#__PURE__*/jsx(Text, {
          style: styles.staffButtonText,
          children: "Для сотрудников"
        })]
      })]
    });
    return /*#__PURE__*/jsxs(KeyboardAwareScrollView, {
      contentContainerStyle: styles.content,
      baseBottomPadding: 118,
      showsVerticalScrollIndicator: false,
      keyboardShouldPersistTaps: "handled",
      contentInsetAdjustmentBehavior: "automatic",
      children: [/*#__PURE__*/jsxs(View, {
        style: styles.headerLine,
        children: [/*#__PURE__*/jsx(Text, {
          style: styles.brand,
          children: "\u0413\u043E\u0440\u044B"
        }), offline ? /*#__PURE__*/jsx(Text, {
          style: styles.offlineBadge,
          children: "\u043D\u0435\u0442 \u0441\u0432\u044F\u0437\u0438"
        }) : null]
      }), /*#__PURE__*/jsx(Text, {
        style: styles.screenTitle,
        children: "\u041F\u0440\u043E\u0444\u0438\u043B\u044C"
      }), guestMessage ? /*#__PURE__*/jsx(Text, {
        style: styles.notice,
        children: guestMessage
      }) : null, guest ? /*#__PURE__*/jsxs(_reactJsxRuntime.Fragment, {
        children: [/*#__PURE__*/jsx(BonusCard, {
          profile: profile
        }), /*#__PURE__*/jsx(PrimaryButton, {
          title: "\u041F\u043E\u043A\u0430\u0437\u0430\u0442\u044C QR \u0434\u043B\u044F \u0441\u043F\u0438\u0441\u0430\u043D\u0438\u044F \u0431\u043E\u043D\u0443\u0441\u043E\u0432",
          onPress: showRedemptionCode
        }), /*#__PURE__*/jsx(SecondaryButton, {
          title: "\u0420\u0435\u0434\u0430\u043A\u0442\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u043F\u0440\u043E\u0444\u0438\u043B\u044C",
          onPress: onEditProfile
        }), /*#__PURE__*/jsxs(View, {
          style: styles.cardGrid,
          children: [/*#__PURE__*/jsx(InfoCard, {
            title: "\u0420\u0435\u0444\u0435\u0440\u0430\u043B\u044C\u043D\u044B\u0439 \u043A\u043E\u0434",
            value: profile?.referral.code ?? guest.referral_code,
            text: "\u041F\u043E\u043A\u0430\u0436\u0438\u0442\u0435 \u043A\u043E\u0434 \u0438\u043B\u0438 QR-\u043A\u0430\u0440\u0442\u043E\u0447\u043A\u0443 \u0434\u0440\u0443\u0433\u0443"
          })]
        }), /*#__PURE__*/jsxs(View, {
          style: styles.rowButtons,
          children: [/*#__PURE__*/jsx(SecondaryButton, {
            title: "\u0421\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u043A\u043E\u0434",
            onPress: onCopyCode
          }), /*#__PURE__*/jsx(SecondaryButton, {
            title: "\u041F\u043E\u0434\u0435\u043B\u0438\u0442\u044C\u0441\u044F",
            onPress: onShareCode
          }), /*#__PURE__*/jsx(SecondaryButton, {
            title: "\u041F\u043E\u043A\u0430\u0437\u0430\u0442\u044C QR-\u043A\u043E\u0434",
            onPress: onShowCode
          })]
        }), /*#__PURE__*/jsx(LoyaltyProgress, {
          balance: guest.bonus_balance,
          level: guest.loyalty_level,
          onPress: onShowLevel
        }), /*#__PURE__*/jsxs(Card, {
          children: [/*#__PURE__*/jsx(Text, {
            style: styles.cardTitleDark,
            children: "\u041F\u0435\u0440\u0441\u043E\u043D\u0430\u043B\u044C\u043D\u044B\u0435 \u043F\u0440\u0435\u0434\u043B\u043E\u0436\u0435\u043D\u0438\u044F"
          }), (profile?.offers ?? []).map(offer => /*#__PURE__*/jsxs(View, {
            style: styles.offerLine,
            children: [/*#__PURE__*/jsx(Text, {
              style: styles.offerTitle,
              children: offer.title
            }), /*#__PURE__*/jsx(Text, {
              style: styles.mutedDark,
              children: offer.text
            })]
          }, offer.id))]
        }), /*#__PURE__*/jsx(SecondaryButton, {
          title: "\u0412\u044B\u0439\u0442\u0438",
          danger: true,
          onPress: onLogout
        }), /*#__PURE__*/jsxs(Card, {
          tone: "soft",
          children: [/*#__PURE__*/jsx(Text, {
            style: styles.cardTitleDark,
            children: "\u0418\u043D\u0444\u043E\u0440\u043C\u0430\u0446\u0438\u044F \u0438 \u043F\u043E\u0434\u0434\u0435\u0440\u0436\u043A\u0430"
          }), /*#__PURE__*/jsx(InfoRow, {
            icon: "document-text-outline",
            text: "\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C\u0441\u043A\u043E\u0435 \u0441\u043E\u0433\u043B\u0430\u0448\u0435\u043D\u0438\u0435",
            onPress: onTermsOfService
          }), /*#__PURE__*/jsx(InfoRow, {
            icon: "chatbubbles-outline",
            text: "\u041D\u0430\u043F\u0438\u0441\u0430\u0442\u044C \u0432 \u043F\u043E\u0434\u0434\u0435\u0440\u0436\u043A\u0443",
            onPress: onSupportContact
          }), /*#__PURE__*/jsx(InfoRow, {
            icon: "call-outline",
            text: "\u041F\u043E\u0437\u0432\u043E\u043D\u0438\u0442\u044C \u0432 \u0440\u0435\u0441\u0442\u043E\u0440\u0430\u043D",
            onPress: onSupportContact
          })]
        })]
      }) : /*#__PURE__*/jsxs(_reactJsxRuntime.Fragment, {
        children: [/*#__PURE__*/jsxs(Card, {
          children: [/*#__PURE__*/jsx(Text, {
            style: styles.cardTitleDark,
            children: "\u0412\u043E\u0439\u0434\u0438\u0442\u0435 \u0432 \u043F\u0440\u043E\u0444\u0438\u043B\u044C"
          }), /*#__PURE__*/jsx(Text, {
            style: styles.mutedDark,
            children: "\u0412\u043E\u0439\u0434\u0438\u0442\u0435, \u0447\u0442\u043E\u0431\u044B \u0432\u0438\u0434\u0435\u0442\u044C \u0431\u043E\u043D\u0443\u0441\u044B, \u043F\u0435\u0440\u0441\u043E\u043D\u0430\u043B\u044C\u043D\u044B\u0435 \u043F\u0440\u0435\u0434\u043B\u043E\u0436\u0435\u043D\u0438\u044F \u0438 \u0440\u0435\u0444\u0435\u0440\u0430\u043B\u044C\u043D\u0443\u044E \u043A\u0430\u0440\u0442\u0443"
          }), /*#__PURE__*/jsxs(View, {
            style: styles.rowButtons,
            children: [/*#__PURE__*/jsx(PrimaryButton, {
              title: "\u0412\u043E\u0439\u0442\u0438",
              onPress: onLogin
            }), /*#__PURE__*/jsx(SecondaryButton, {
              title: "\u0417\u0430\u0440\u0435\u0433\u0438\u0441\u0442\u0440\u0438\u0440\u043E\u0432\u0430\u0442\u044C\u0441\u044F",
              onPress: onRegister
            })]
          })]
        }), /*#__PURE__*/jsxs(Card, {
          tone: "soft",
          children: [/*#__PURE__*/jsx(Text, {
            style: styles.cardTitleDark,
            children: "\u0418\u043D\u0444\u043E\u0440\u043C\u0430\u0446\u0438\u044F"
          }), /*#__PURE__*/jsx(InfoRow, {
            icon: "restaurant-outline",
            text: "\u041E \u0440\u0435\u0441\u0442\u043E\u0440\u0430\u043D\u0435"
          }), /*#__PURE__*/jsx(InfoRow, {
            icon: "gift-outline",
            text: "\u0411\u043E\u043D\u0443\u0441\u043D\u0430\u044F \u043F\u0440\u043E\u0433\u0440\u0430\u043C\u043C\u0430"
          }), /*#__PURE__*/jsx(InfoRow, {
            icon: "document-text-outline",
            text: "\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C\u0441\u043A\u043E\u0435 \u0441\u043E\u0433\u043B\u0430\u0448\u0435\u043D\u0438\u0435",
            onPress: onTermsOfService
          })]
        }), /*#__PURE__*/jsxs(Card, {
          tone: "soft",
          children: [/*#__PURE__*/jsx(Text, {
            style: styles.cardTitleDark,
            children: "\u041F\u043E\u0434\u0434\u0435\u0440\u0436\u043A\u0430"
          }), /*#__PURE__*/jsx(InfoRow, {
            icon: "call-outline",
            text: "\u041F\u043E\u0437\u0432\u043E\u043D\u0438\u0442\u044C \u0432 \u0440\u0435\u0441\u0442\u043E\u0440\u0430\u043D",
            onPress: onSupportContact
          }), /*#__PURE__*/jsx(InfoRow, {
            icon: "chatbubbles-outline",
            text: "\u041D\u0430\u043F\u0438\u0441\u0430\u0442\u044C \u0432 \u043F\u043E\u0434\u0434\u0435\u0440\u0436\u043A\u0443",
            onPress: onSupportContact
          })]
        })]
      }), /*#__PURE__*/jsxs(Pressable, {
        onPress: onStaff,
        style: styles.staffButton,
        children: [/*#__PURE__*/jsx(Ionicons, {
          name: "shield-checkmark-outline",
          size: 18,
          color: "#8B8178"
        }), /*#__PURE__*/jsx(Text, {
          style: styles.staffButtonText,
          children: "\u0414\u043B\u044F \u0441\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A\u043E\u0432"
        })]
      })]
    });
  }
  function GuestRestaurantScreen(_ref4) {
    var offline = _ref4.offline,
      popular = _ref4.popular,
      guestSession = _ref4.guestSession,
      guestName = _ref4.guestName,
      onOpenMenu = _ref4.onOpenMenu,
      onRoute = _ref4.onRoute;
    return /*#__PURE__*/jsxs(KeyboardAwareScrollView, {
      contentContainerStyle: styles.content,
      baseBottomPadding: 118,
      showsVerticalScrollIndicator: false,
      keyboardShouldPersistTaps: "handled",
      contentInsetAdjustmentBehavior: "automatic",
      children: [/*#__PURE__*/jsxs(LinearGradient, {
        colors: ['#17251f', '#4a211d', '#8c243d'],
        style: styles.hero,
        children: [/*#__PURE__*/jsx(Text, {
          style: styles.brand,
          children: "\u0413\u043E\u0440\u044B"
        }), /*#__PURE__*/jsx(Text, {
          style: styles.heroTitle,
          children: "\u041A\u0430\u0432\u043A\u0430\u0437\u0441\u043A\u0430\u044F \u043A\u0443\u0445\u043D\u044F \u0432 \u0442\u0451\u043F\u043B\u043E\u0439 \u0430\u0442\u043C\u043E\u0441\u0444\u0435\u0440\u0435"
        }), /*#__PURE__*/jsx(Text, {
          style: styles.heroText,
          children: "\u0420\u0435\u0441\u0442\u043E\u0440\u0430\u043D \u043A\u0430\u0432\u043A\u0430\u0437\u0441\u043A\u043E\u0439 \u043A\u0443\u0445\u043D\u0438 \u0432 \u0418\u0432\u0430\u043D\u043E\u0432\u043E \u2014 \u0434\u043B\u044F \u0443\u0436\u0438\u043D\u043E\u0432, \u0432\u0441\u0442\u0440\u0435\u0447 \u0438 \u0442\u0451\u043F\u043B\u044B\u0445 \u0432\u0435\u0447\u0435\u0440\u043E\u0432."
        })]
      }), offline ? /*#__PURE__*/jsx(Text, {
        style: styles.notice,
        children: "\u041D\u0435\u0442 \u0441\u043E\u0435\u0434\u0438\u043D\u0435\u043D\u0438\u044F. \u0414\u0430\u043D\u043D\u044B\u0435 \u043C\u043E\u0433\u0443\u0442 \u0431\u044B\u0442\u044C \u043D\u0435\u0430\u043A\u0442\u0443\u0430\u043B\u044C\u043D\u044B."
      }) : null, guestSession?.token ? /*#__PURE__*/jsx(GuestBookingPanel, {
        apiUrl: guestSession.apiUrl,
        token: guestSession.token,
        guestName: guestName
      }) : /*#__PURE__*/jsxs(Card, {
        tone: "soft",
        children: [/*#__PURE__*/jsx(Text, {
          style: styles.cardTitleDark,
          children: "\u0417\u0430\u0431\u0440\u043E\u043D\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u0441\u0442\u043E\u043B"
        }), /*#__PURE__*/jsx(Text, {
          style: styles.mutedDark,
          children: "\u0412\u043E\u0439\u0434\u0438\u0442\u0435 \u0432 \u043F\u0440\u043E\u0444\u0438\u043B\u044C, \u0447\u0442\u043E\u0431\u044B \u043E\u0441\u0442\u0430\u0432\u0438\u0442\u044C \u0437\u0430\u044F\u0432\u043A\u0443 \u043D\u0430 \u0431\u0440\u043E\u043D\u044C \u0438\u0437 \u043F\u0440\u0438\u043B\u043E\u0436\u0435\u043D\u0438\u044F."
        })]
      }), /*#__PURE__*/jsxs(Card, {
        children: [/*#__PURE__*/jsx(Text, {
          style: styles.cardTitleDark,
          children: "\u041E \u0440\u0435\u0441\u0442\u043E\u0440\u0430\u043D\u0435"
        }), /*#__PURE__*/jsx(Text, {
          style: styles.mutedDark,
          children: "\xAB\u0413\u043E\u0440\u044B\xBB \u2014 \u0440\u0435\u0441\u0442\u043E\u0440\u0430\u043D \u043A\u0430\u0432\u043A\u0430\u0437\u0441\u043A\u043E\u0439 \u043A\u0443\u0445\u043D\u0438 \u0432 \u0418\u0432\u0430\u043D\u043E\u0432\u043E, \u0441\u043E\u0437\u0434\u0430\u043D\u043D\u044B\u0439 \u043A\u0430\u043A \u043C\u0435\u0441\u0442\u043E \u0434\u043B\u044F \u0442\u0451\u043F\u043B\u044B\u0445 \u0432\u0441\u0442\u0440\u0435\u0447, \u0441\u0435\u043C\u0435\u0439\u043D\u044B\u0445 \u0443\u0436\u0438\u043D\u043E\u0432 \u0438 \u0431\u043E\u043B\u044C\u0448\u0438\u0445 \u043F\u0440\u0430\u0437\u0434\u043D\u0438\u043A\u043E\u0432. \u0417\u0434\u0435\u0441\u044C \u0432\u0430\u0436\u043D\u044B \u043D\u0435 \u0442\u043E\u043B\u044C\u043A\u043E \u0431\u043B\u044E\u0434\u0430, \u043D\u043E \u0438 \u0430\u0442\u043C\u043E\u0441\u0444\u0435\u0440\u0430: \u043C\u044F\u0433\u043A\u0438\u0439 \u0441\u0432\u0435\u0442, \u0438\u043D\u0442\u0435\u0440\u044C\u0435\u0440 \u0441 \u0445\u0430\u0440\u0430\u043A\u0442\u0435\u0440\u043E\u043C, \u0433\u043E\u0441\u0442\u0435\u043F\u0440\u0438\u0438\u043C\u0441\u0442\u0432\u043E \u0438 \u0432\u043D\u0438\u043C\u0430\u043D\u0438\u0435 \u043A \u0434\u0435\u0442\u0430\u043B\u044F\u043C.\n\n\u0412 \u043C\u0435\u043D\u044E \u2014 \u0445\u0438\u043D\u043A\u0430\u043B\u0438, \u0445\u0430\u0447\u0430\u043F\u0443\u0440\u0438, \u0448\u0430\u0448\u043B\u044B\u043A\u0438, \u0433\u043E\u0440\u044F\u0447\u0438\u0435 \u0431\u043B\u044E\u0434\u0430, \u0437\u0430\u043A\u0443\u0441\u043A\u0438 \u0438 \u043D\u0430\u043F\u0438\u0442\u043A\u0438, \u043A\u043E\u0442\u043E\u0440\u044B\u0435 \u0445\u043E\u0447\u0435\u0442\u0441\u044F \u0440\u0430\u0437\u0434\u0435\u043B\u0438\u0442\u044C \u0437\u0430 \u043E\u0431\u0449\u0438\u043C \u0441\u0442\u043E\u043B\u043E\u043C. \u041C\u044B \u0445\u043E\u0442\u0438\u043C, \u0447\u0442\u043E\u0431\u044B \u043A\u0430\u0436\u0434\u044B\u0439 \u0433\u043E\u0441\u0442\u044C \u0447\u0443\u0432\u0441\u0442\u0432\u043E\u0432\u0430\u043B \u0441\u0435\u0431\u044F \u0436\u0435\u043B\u0430\u043D\u043D\u044B\u043C \u2014 \u0431\u043B\u0438\u0437\u043A\u043E, \u0442\u0435\u043F\u043B\u043E \u0438 \u043F\u043E-\u043D\u0430\u0441\u0442\u043E\u044F\u0449\u0435\u043C\u0443 \u0432\u043A\u0443\u0441\u043D\u043E."
        })]
      }), /*#__PURE__*/jsx(View, {
        style: styles.atmosphereGrid,
        children: ['Кавказское гостеприимство', 'Тёплый интерьер', 'Банкеты и праздники', 'Семейные вечера', 'Внимание к деталям'].map(item => /*#__PURE__*/jsxs(View, {
          style: styles.atmosphereCard,
          children: [/*#__PURE__*/jsx(Ionicons, {
            name: "sparkles-outline",
            size: 18,
            color: palette.goldSoft
          }), /*#__PURE__*/jsx(Text, {
            style: styles.atmosphereText,
            children: item
          })]
        }, item))
      }), /*#__PURE__*/jsx(Text, {
        style: styles.sectionTitle,
        children: "\u041F\u043E\u043F\u0443\u043B\u044F\u0440\u043D\u043E\u0435"
      }), popular.length ? popular.map(item => /*#__PURE__*/jsx(MemoGuestDishCard, {
        item: item,
        compact: true
      }, item.id)) : /*#__PURE__*/jsx(Card, {
        tone: "soft",
        children: /*#__PURE__*/jsx(Text, {
          style: styles.mutedDark,
          children: "\u041C\u0435\u043D\u044E \u0441\u043A\u043E\u0440\u043E \u043F\u043E\u044F\u0432\u0438\u0442\u0441\u044F"
        })
      }), /*#__PURE__*/jsxs(Card, {
        children: [/*#__PURE__*/jsx(Text, {
          style: styles.cardTitleDark,
          children: "\u0411\u0430\u043D\u043A\u0435\u0442\u044B \u0438 \u043C\u0435\u0440\u043E\u043F\u0440\u0438\u044F\u0442\u0438\u044F"
        }), /*#__PURE__*/jsx(Text, {
          style: styles.mutedDark,
          children: "\u0414\u043D\u0438 \u0440\u043E\u0436\u0434\u0435\u043D\u0438\u044F, \u0441\u0432\u0430\u0434\u044C\u0431\u044B, \u043A\u043E\u0440\u043F\u043E\u0440\u0430\u0442\u0438\u0432\u044B \u0438 \u0441\u0435\u043C\u0435\u0439\u043D\u044B\u0435 \u043F\u0440\u0430\u0437\u0434\u043D\u0438\u043A\u0438 \u0432 \u0443\u044E\u0442\u043D\u043E\u0439 \u0430\u0442\u043C\u043E\u0441\u0444\u0435\u0440\u0435 \u0440\u0435\u0441\u0442\u043E\u0440\u0430\u043D\u0430."
        }), /*#__PURE__*/jsx(View, {
          style: styles.banquetTags,
          children: ['Дни рождения', 'Свадьбы', 'Корпоративы', 'Семейные праздники'].map(item => /*#__PURE__*/jsx(Text, {
            style: styles.tag,
            children: item
          }, item))
        })]
      })]
    });
  }
  function GuestMenuScreen(_ref5) {
    var categories = _ref5.categories,
      category = _ref5.category,
      guestSession = _ref5.guestSession,
      guestProfile = _ref5.guestProfile,
      items = _ref5.items,
      loading = _ref5.loading,
      offline = _ref5.offline,
      query = _ref5.query,
      onCategory = _ref5.onCategory,
      onDishPress = _ref5.onDishPress,
      onQuery = _ref5.onQuery,
      onRefresh = _ref5.onRefresh;
    var currentTableSession = null;
    var orderItems = [];
    var menuPromos = [{
      title: 'Сеты для компании',
      text: 'Тёплые блюда для общего стола',
      icon: 'people-outline',
      category: 'Банкетное меню',
      colors: ['#7a2638', '#bf6142']
    }, {
      title: 'Хинкали и хачапури',
      text: 'Кавказская классика каждый день',
      icon: 'restaurant-outline',
      category: 'Хинкали',
      colors: ['#2d1810', '#7a4a2f']
    }, {
      title: 'Банкеты в Горах',
      text: 'Праздники, встречи и семейные вечера',
      icon: 'sparkles-outline',
      category: 'Банкетное меню',
      colors: ['#26362f', '#7a2638']
    }];
    return /*#__PURE__*/jsxs(KeyboardAwareScrollView, {
      contentContainerStyle: styles.content,
      baseBottomPadding: 118,
      showsVerticalScrollIndicator: false,
      keyboardShouldPersistTaps: "handled",
      contentInsetAdjustmentBehavior: "automatic",
      children: [/*#__PURE__*/jsxs(View, {
        style: styles.menuHeader,
        children: [/*#__PURE__*/jsx(Text, {
          style: styles.screenTitle,
          children: "\u041C\u0435\u043D\u044E"
        }), /*#__PURE__*/jsx(View, {
          style: styles.menuLogo,
          children: /*#__PURE__*/jsx(Text, {
            style: styles.menuLogoText,
            children: "\u0413"
          })
        })]
      }), offline ? /*#__PURE__*/jsx(Text, {
        style: styles.notice,
        children: "\u041F\u043E\u043A\u0430\u0437\u044B\u0432\u0430\u0435\u043C \u043F\u043E\u0441\u043B\u0435\u0434\u043D\u0435\u0435 \u0437\u0430\u0433\u0440\u0443\u0436\u0435\u043D\u043D\u043E\u0435 \u043C\u0435\u043D\u044E."
      }) : null, null, currentTableSession ? /*#__PURE__*/jsxs(Card, {
        tone: "soft",
        children: [/*#__PURE__*/jsx(Text, {
          style: styles.cardTitleDark,
          children: `Вы за столом ${currentTableSession.table_number ?? currentTableSession.table_id}`
        }), orderItems.length ? orderItems.map(orderItem => /*#__PURE__*/jsxs(View, {
          style: styles.orderLine,
          children: [/*#__PURE__*/jsxs(View, {
            style: styles.dishBody,
            children: [/*#__PURE__*/jsx(Text, {
              style: styles.orderTitle,
              children: `${orderItem.menu_item_name ?? 'Позиция'} x${orderItem.quantity ?? 1}`
            }), /*#__PURE__*/jsx(Text, {
              style: styles.mutedDark,
              children: orderStatusLabels[orderItem.status] ?? orderItem.status
            })]
          }), /*#__PURE__*/jsx(Pill, {
            label: orderStatusLabels[orderItem.status] ?? orderItem.status,
            tone: orderItem.status === 'cancelled' ? 'bad' : orderItem.status === 'served' || orderItem.status === 'done' ? 'good' : orderItem.status === 'in_progress' ? 'info' : 'warn'
          })]
        }, orderItem.id)) : /*#__PURE__*/jsx(Text, {
          style: styles.mutedDark,
          children: "Заказ пока пуст. Добавьте позицию из меню."
        })]
      }) : null, /*#__PURE__*/jsx(Field, {
        label: "\u041F\u043E\u0438\u0441\u043A",
        placeholder: "\u041D\u0430\u0439\u0442\u0438 \u0431\u043B\u044E\u0434\u043E",
        value: query,
        onChangeText: onQuery
      }), /*#__PURE__*/jsx(ScrollView, {
        horizontal: true,
        nestedScrollEnabled: true,
        keyboardShouldPersistTaps: "handled",
        showsHorizontalScrollIndicator: false,
        decelerationRate: "fast",
        contentContainerStyle: styles.promoStrip,
        children: menuPromos.map(promo => /*#__PURE__*/jsx(Pressable, {
          onPress: () => onCategory(categories.includes(promo.category) ? promo.category : 'Все'),
          style: _ref7 => {
            var pressed = _ref7.pressed;
            return [styles.promoPressable, pressed ? styles.pressedSoft : null];
          },
          children: /*#__PURE__*/jsxs(LinearGradient, {
            colors: promo.colors,
            style: styles.promoCard,
            children: [/*#__PURE__*/jsx(Ionicons, {
              name: promo.icon,
              size: 28,
              color: '#fff8ea'
            }), /*#__PURE__*/jsx(Text, {
              style: styles.promoTitle,
              children: promo.title
            }), /*#__PURE__*/jsx(Text, {
              style: styles.promoText,
              children: promo.text
            })]
          })
        }, promo.title))
      }), /*#__PURE__*/jsx(ScrollView, {
        horizontal: true,
        nestedScrollEnabled: true,
        keyboardShouldPersistTaps: "handled",
        showsHorizontalScrollIndicator: false,
        decelerationRate: "fast",
        contentContainerStyle: styles.categoryStrip,
        children: categories.map(item => /*#__PURE__*/jsx(Pressable, {
          onPress: () => onCategory(item),
          style: [styles.categoryChip, category === item ? styles.categoryChipActive : null],
          children: /*#__PURE__*/jsx(Text, {
            style: [styles.categoryText, category === item ? styles.categoryTextActive : null],
        children: item
      })
        }, item))
      }), items.length ? items.map(item => /*#__PURE__*/jsx(MemoGuestDishCard, {
        item: item,
        onPress: () => onDishPress(item)
      }, item.id)) : /*#__PURE__*/jsxs(Card, {
        tone: "soft",
        children: [/*#__PURE__*/jsx(Text, {
          style: styles.cardTitleDark,
          children: query ? "\u041D\u0438\u0447\u0435\u0433\u043E \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u043E" : loading ? "\u0417\u0430\u0433\u0440\u0443\u0436\u0430\u0435\u043C \u043C\u0435\u043D\u044E" : "\u041C\u0435\u043D\u044E \u0441\u043A\u043E\u0440\u043E \u043F\u043E\u044F\u0432\u0438\u0442\u0441\u044F"
        }), /*#__PURE__*/jsx(Text, {
          style: styles.mutedDark,
          children: query ? "\u041F\u043E\u0438\u0449\u0438\u0442\u0435 \u043F\u043E \u043D\u0430\u0437\u0432\u0430\u043D\u0438\u044E, \u043A\u0430\u0442\u0435\u0433\u043E\u0440\u0438\u0438 \u0438\u043B\u0438 \u043E\u043F\u0438\u0441\u0430\u043D\u0438\u044E." : loading ? "\u041F\u0440\u043E\u0432\u0435\u0440\u044F\u0435\u043C \u0434\u043E\u0441\u0442\u0443\u043F \u043A \u0441\u0435\u0440\u0432\u0435\u0440\u0443." : "\u041A\u043E\u0433\u0434\u0430 \u0441\u0435\u0440\u0432\u0435\u0440 \u043E\u0442\u0434\u0430\u0441\u0442 \u043F\u043E\u0437\u0438\u0446\u0438\u0438, \u043E\u043D\u0438 \u043F\u043E\u044F\u0432\u044F\u0442\u0441\u044F \u0437\u0434\u0435\u0441\u044C \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0438."
        }), !loading ? /*#__PURE__*/jsx(SecondaryButton, {
          title: "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C \u043C\u0435\u043D\u044E",
          onPress: onRefresh
        }) : null]
      })]
    });
  }
  function GuestBonusScreen(_refBonus) {
    var offline = _refBonus.offline,
      profile = _refBonus.profile,
      onCopyCode = _refBonus.onCopyCode,
      onLogin = _refBonus.onLogin,
      onRefresh = _refBonus.onRefresh,
      onRegister = _refBonus.onRegister,
      onShowCode = _refBonus.onShowCode,
      onShowLevel = _refBonus.onShowLevel,
      onShareCode = _refBonus.onShareCode;
    var guest = profile?.guest ?? null;
    return /*#__PURE__*/jsxs(KeyboardAwareScrollView, {
      contentContainerStyle: styles.content,
      baseBottomPadding: 118,
      showsVerticalScrollIndicator: false,
      keyboardShouldPersistTaps: "handled",
      contentInsetAdjustmentBehavior: "automatic",
      children: [/*#__PURE__*/jsxs(View, {
        style: styles.headerLine,
        children: [/*#__PURE__*/jsx(Text, {
          style: styles.brand,
          children: "Горы"
        }), offline ? /*#__PURE__*/jsx(Text, {
          style: styles.offlineBadge,
          children: "нет связи"
        }) : null]
      }), /*#__PURE__*/jsx(Text, {
        style: styles.screenTitle,
        children: "Бонусная карта"
      }), guest ? /*#__PURE__*/jsxs(Fragment, {
        children: [/*#__PURE__*/jsx(BonusCard, {
          profile: profile
        }), /*#__PURE__*/jsx(LoyaltyProgress, {
          balance: guest.bonus_balance,
          level: guest.loyalty_level,
          onPress: onShowLevel
        }), /*#__PURE__*/jsxs(View, {
          style: styles.rowButtons,
          children: [/*#__PURE__*/jsx(SecondaryButton, {
            title: "Скопировать код",
            onPress: onCopyCode
          }), /*#__PURE__*/jsx(SecondaryButton, {
            title: "Поделиться",
            onPress: onShareCode
          }), /*#__PURE__*/jsx(SecondaryButton, {
            title: "QR-код",
            onPress: onShowCode
          })]
        }), /*#__PURE__*/jsx(Text, {
          style: styles.sectionTitle,
          children: "История бонусов"
        }), (profile?.transactions ?? []).slice(0, 12).map(transaction => /*#__PURE__*/jsx(TransactionLine, {
          transaction: transaction
        }, transaction.id)), /*#__PURE__*/jsx(SecondaryButton, {
          title: "Обновить карту",
          onPress: onRefresh
        })]
      }) : /*#__PURE__*/jsxs(Card, {
        tone: "soft",
        children: [/*#__PURE__*/jsx(Text, {
          style: styles.cardTitleDark,
          children: "Войдите в гостевой профиль"
        }), /*#__PURE__*/jsx(Text, {
          style: styles.mutedDark,
          children: "После входа здесь будет бонусная карта, баланс, QR-код, реферальный код и история начислений."
        }), /*#__PURE__*/jsxs(View, {
          style: styles.rowButtons,
          children: [/*#__PURE__*/jsx(PrimaryButton, {
            title: "Войти",
            onPress: onLogin
          }), /*#__PURE__*/jsx(SecondaryButton, {
            title: "Регистрация",
            onPress: onRegister
          })]
        })]
      })]
    });
  }
  function GuestRouteScreen(_ref6) {
    var offline = _ref6.offline,
      onCall = _ref6.onCall,
      onCopyAddress = _ref6.onCopyAddress,
      onOpenRoute = _ref6.onOpenRoute;
    return /*#__PURE__*/jsxs(KeyboardAwareScrollView, {
      contentContainerStyle: styles.content,
      baseBottomPadding: 118,
      showsVerticalScrollIndicator: false,
      keyboardShouldPersistTaps: "handled",
      contentInsetAdjustmentBehavior: "automatic",
      children: [/*#__PURE__*/jsxs(View, {
        style: styles.headerLine,
        children: [/*#__PURE__*/jsx(Text, {
          style: styles.brand,
          children: "\u0413\u043E\u0440\u044B"
        }), offline ? /*#__PURE__*/jsx(Text, {
          style: styles.offlineBadge,
          children: "\u043D\u0435\u0442 \u0441\u0432\u044F\u0437\u0438"
        }) : null]
      }), /*#__PURE__*/jsx(Text, {
        style: styles.screenTitle,
        children: "\u041A\u0430\u043A \u0434\u043E\u0431\u0440\u0430\u0442\u044C\u0441\u044F"
      }), /*#__PURE__*/jsxs(Card, {
        children: [/*#__PURE__*/jsxs(View, {
          style: styles.iconTitleRow,
          children: [/*#__PURE__*/jsx(Ionicons, {
            name: "restaurant-outline",
            size: 22,
            color: palette.burgundy
          }), /*#__PURE__*/jsx(Text, {
            style: styles.cardTitleDark,
            children: "\u0413\u043E\u0440\u044B"
          })]
        }), /*#__PURE__*/jsx(Text, {
          style: styles.mutedDark,
          children: RESTAURANT_ADDRESS
        }), /*#__PURE__*/jsxs(Text, {
          style: styles.mutedDark,
          children: ["\u0422\u0435\u043B\u0435\u0444\u043E\u043D: ", RESTAURANT_PHONE]
        }), /*#__PURE__*/jsxs(Text, {
          style: styles.mutedDark,
          children: ["\u0420\u0435\u0436\u0438\u043C \u0440\u0430\u0431\u043E\u0442\u044B: ", RESTAURANT_HOURS]
        })]
      }), /*#__PURE__*/jsxs(LinearGradient, {
        colors: ['#F4EFE4', '#E8DFD1', '#F7F1E7'],
        style: styles.mapPreview,
        children: [/*#__PURE__*/jsx(Image, {
          source: {
            uri: MAP_IMAGE_URL
          },
          style: styles.mapImage
        }), /*#__PURE__*/jsx(View, {
          style: styles.mapFade
        }), /*#__PURE__*/jsx(View, {
          style: styles.mapPin,
          children: /*#__PURE__*/jsx(Ionicons, {
            name: "location",
            size: 30,
            color: palette.goldSoft
          })
        }), /*#__PURE__*/jsx(Text, {
          style: styles.mapTitle,
          children: "\u0418\u0432\u0430\u043D\u043E\u0432\u043E, \u0421\u043E\u0432\u0435\u0442\u0441\u043A\u0430\u044F 36\u0430"
        }), /*#__PURE__*/jsx(Text, {
          style: styles.mapText,
          children: "\u041C\u044B \u043D\u0430\u0445\u043E\u0434\u0438\u043C\u0441\u044F \u0432 \u0446\u0435\u043D\u0442\u0440\u0435 \u0418\u0432\u0430\u043D\u043E\u0432\u0430. \u041F\u043E\u0441\u0442\u0440\u043E\u0439\u0442\u0435 \u043C\u0430\u0440\u0448\u0440\u0443\u0442 \u0447\u0435\u0440\u0435\u0437 \u042F\u043D\u0434\u0435\u043A\u0441 \u041A\u0430\u0440\u0442\u044B."
        })]
      }), /*#__PURE__*/jsxs(View, {
        style: styles.routeButtons,
        children: [/*#__PURE__*/jsx(PrimaryButton, {
          title: "\u041F\u043E\u0441\u0442\u0440\u043E\u0438\u0442\u044C \u043C\u0430\u0440\u0448\u0440\u0443\u0442",
          onPress: onOpenRoute
        }), /*#__PURE__*/jsx(SecondaryButton, {
          title: "\u041F\u043E\u0437\u0432\u043E\u043D\u0438\u0442\u044C",
          onPress: onCall
        }), /*#__PURE__*/jsx(SecondaryButton, {
          title: "\u0421\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u0430\u0434\u0440\u0435\u0441",
          onPress: onCopyAddress
        })]
      }), /*#__PURE__*/jsxs(Card, {
        tone: "soft",
        children: [/*#__PURE__*/jsx(InfoRow, {
          icon: "navigate-outline",
          text: "\u041F\u043E\u0441\u0442\u0440\u043E\u0438\u0442\u044C \u043C\u0430\u0440\u0448\u0440\u0443\u0442 \u0447\u0435\u0440\u0435\u0437 \u042F\u043D\u0434\u0435\u043A\u0441 \u041A\u0430\u0440\u0442\u044B"
        }), /*#__PURE__*/jsx(InfoRow, {
          icon: "business-outline",
          text: "\u0410\u0434\u0440\u0435\u0441: \u0421\u043E\u0432\u0435\u0442\u0441\u043A\u0430\u044F 36\u0430"
        }), /*#__PURE__*/jsx(InfoRow, {
          icon: "map-outline",
          text: "\u041F\u043E\u043B\u043D\u0430\u044F \u043A\u0430\u0440\u0442\u0430 \u043E\u0442\u043A\u0440\u043E\u0435\u0442\u0441\u044F \u0432 \u043F\u0440\u0438\u043B\u043E\u0436\u0435\u043D\u0438\u0438 \u043A\u0430\u0440\u0442 \u0438\u043B\u0438 \u0431\u0440\u0430\u0443\u0437\u0435\u0440\u0435"
        })]
      })]
    });
  }
  function BonusCard(_ref7) {
    var profile = _ref7.profile;
    var guest = profile?.guest;
    var card = profile?.card;
    if (!guest) return null;
    return /*#__PURE__*/jsxs(LinearGradient, {
      colors: ['#1b1714', '#3a241d', '#7a2638'],
      style: styles.bonusCard,
      children: [/*#__PURE__*/jsxs(View, {
        style: styles.bonusTop,
        children: [/*#__PURE__*/jsx(Text, {
          style: styles.bonusBrand,
          children: "\u0413\u043E\u0440\u044B"
        }), /*#__PURE__*/jsx(Text, {
          style: styles.bonusLevel,
          children: guest.loyalty_level_label ?? guest.loyalty_level
        })]
      }), /*#__PURE__*/jsx(View, {
        style: styles.mountainLine
      }), /*#__PURE__*/jsx(Text, {
        style: styles.bonusName,
        children: guest.name
      }), /*#__PURE__*/jsx(Text, {
        style: styles.bonusNumber,
        children: card?.card_number ?? 'Карта создаётся'
      }), /*#__PURE__*/jsxs(View, {
        style: styles.bonusBottom,
        children: [/*#__PURE__*/jsxs(View, {
          children: [/*#__PURE__*/jsx(Text, {
            style: styles.bonusCaption,
            children: "\u0411\u0430\u043B\u0430\u043D\u0441"
          }), /*#__PURE__*/jsxs(Text, {
            style: styles.bonusValue,
            children: [guest.bonus_balance, " \u0431\u043E\u043D\u0443\u0441\u043E\u0432"]
          })]
        }), /*#__PURE__*/jsxs(View, {
          children: [/*#__PURE__*/jsx(Text, {
            style: styles.bonusCaption,
            children: "\u041A\u043E\u0434"
          }), /*#__PURE__*/jsx(Text, {
            style: styles.bonusValueSmall,
            children: guest.referral_code
          })]
        })]
      })]
    });
  }
  function LoyaltyProgress(_ref8) {
    var balance = _ref8.balance,
      level = _ref8.level,
      onPress = _ref8.onPress;
    var next = loyaltyTiers.find(item => item.threshold > 0 && balance < item.threshold);
    var progress = next ? Math.min(balance / next.threshold, 1) : 1;
    var current = loyaltyTiers.find(item => item.key === level) ?? loyaltyTiers.slice().reverse().find(item => balance >= item.threshold) ?? loyaltyTiers[0];
    return /*#__PURE__*/jsx(Pressable, {
      onPress: onPress,
      style: _ref9 => {
        var pressed = _ref9.pressed;
        return pressed ? styles.pressedSoft : null;
      },
      children: /*#__PURE__*/jsxs(Card, {
        tone: "soft",
      children: [/*#__PURE__*/jsx(Text, {
        style: styles.cardTitleDark,
        children: "\u0423\u0440\u043E\u0432\u0435\u043D\u044C \u043B\u043E\u044F\u043B\u044C\u043D\u043E\u0441\u0442\u0438"
      }), /*#__PURE__*/jsx(Text, {
        style: styles.mutedDark,
        children: next ? `До уровня «${next.title}» осталось ${next.threshold - balance} бонусов` : 'Максимальный уровень'
      }), /*#__PURE__*/jsx(View, {
        style: styles.progressTrack,
        children: /*#__PURE__*/jsx(View, {
          style: [styles.progressFill, {
            width: `${progress * 100}%`
          }]
        })
      }), /*#__PURE__*/jsxs(Text, {
        style: styles.mutedDark,
        children: ["\u0422\u0435\u043A\u0443\u0449\u0438\u0439 \u0443\u0440\u043E\u0432\u0435\u043D\u044C: ", current.title]
      }), /*#__PURE__*/jsx(Text, {
        style: styles.linkText,
        children: "\u041F\u043E\u0441\u043C\u043E\u0442\u0440\u0435\u0442\u044C \u0443\u0440\u043E\u0432\u043D\u0438"
      })]
      })
    });
  }
  function ReferralCodeModal(_ref9) {
    var visible = _ref9.visible,
      profile = _ref9.profile,
      onClose = _ref9.onClose,
      onCopyCode = _ref9.onCopyCode,
      onShareCode = _ref9.onShareCode;
    var code = profile?.referral.code ?? profile?.guest?.referral_code ?? '';
    return /*#__PURE__*/jsxs(ModalSheet, {
      visible: visible,
      title: "\u041C\u043E\u0439 \u0440\u0435\u0444\u0435\u0440\u0430\u043B\u044C\u043D\u044B\u0439 \u043A\u043E\u0434",
      onClose: onClose,
      children: [/*#__PURE__*/jsxs(LinearGradient, {
        colors: ['#1b1714', '#3a241d', '#7a2638'],
        style: styles.referralModalCard,
        children: [/*#__PURE__*/jsx(Text, {
          style: styles.referralBrand,
          children: "\u0413\u043E\u0440\u044B"
        }), /*#__PURE__*/jsx(Text, {
          style: styles.referralSub,
          children: "\u041C\u043E\u0439 \u0440\u0435\u0444\u0435\u0440\u0430\u043B\u044C\u043D\u044B\u0439 \u043A\u043E\u0434"
        }), /*#__PURE__*/jsx(Text, {
          style: styles.referralBigCode,
          children: code || 'GOR00000'
        }), /*#__PURE__*/jsx(View, {
          style: styles.qrBox,
          children: /*#__PURE__*/jsx(QRCode, {
            value: code || 'GOR00000',
            size: 184,
            color: "#241915",
            backgroundColor: "#fff8ea"
          })
        }), /*#__PURE__*/jsx(Text, {
          style: styles.referralHint,
          children: "\u041F\u0440\u0438\u0433\u043B\u0430\u0441\u0438\u0442\u0435 \u0434\u0440\u0443\u0433\u0430: \u043E\u043D \u0432\u0432\u043E\u0434\u0438\u0442 \u044D\u0442\u043E\u0442 \u043A\u043E\u0434 \u043F\u0440\u0438 \u0440\u0435\u0433\u0438\u0441\u0442\u0440\u0430\u0446\u0438\u0438, \u0430 \u0431\u043E\u043D\u0443\u0441\u044B \u043F\u0430\u0434\u0430\u044E\u0442 \u043D\u0430 \u043A\u0430\u0440\u0442\u0443."
        })]
      }), /*#__PURE__*/jsxs(View, {
        style: styles.rowButtons,
        children: [/*#__PURE__*/jsx(PrimaryButton, {
          title: "\u0421\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u0442\u044C",
          onPress: onCopyCode
        }), /*#__PURE__*/jsx(SecondaryButton, {
          title: "\u041F\u043E\u0434\u0435\u043B\u0438\u0442\u044C\u0441\u044F",
          onPress: onShareCode
        })]
      })]
    });
  }
  function LoyaltyLevelModal(_ref10) {
    var visible = _ref10.visible,
      profile = _ref10.profile,
      onClose = _ref10.onClose;
    var guest = profile?.guest;
    var balance = Number(guest?.bonus_balance ?? 0);
    var current = loyaltyTiers.find(item => item.key === guest?.loyalty_level) ?? loyaltyTiers.slice().reverse().find(item => balance >= item.threshold) ?? loyaltyTiers[0];
    var next = loyaltyTiers.find(item => item.threshold > current.threshold);
    return /*#__PURE__*/jsxs(ModalSheet, {
      visible: visible,
      title: "\u0423\u0440\u043E\u0432\u043D\u0438 \u043B\u043E\u044F\u043B\u044C\u043D\u043E\u0441\u0442\u0438",
      onClose: onClose,
      children: [/*#__PURE__*/jsxs(Card, {
        tone: "dark",
        children: [/*#__PURE__*/jsx(Text, {
          style: styles.darkModalTitle,
          children: current.title
        }), /*#__PURE__*/jsxs(Text, {
          style: styles.darkModalText,
          children: [balance, " \u0431\u043E\u043D\u0443\u0441\u043E\u0432 \u043D\u0430 \u043A\u0430\u0440\u0442\u0435"]
        }), /*#__PURE__*/jsx(Text, {
          style: styles.darkModalText,
          children: next ? `До уровня «${next.title}» осталось ${Math.max(next.threshold - balance, 0)} бонусов` : 'У вас максимальный уровень'
        })]
      }), loyaltyTiers.map(tier => /*#__PURE__*/jsxs(Card, {
        tone: tier.key === current.key ? 'soft' : 'light',
        children: [/*#__PURE__*/jsxs(View, {
          style: styles.cardHeader,
          children: [/*#__PURE__*/jsx(Text, {
            style: styles.cardTitleDark,
            children: tier.title
          }), /*#__PURE__*/jsx(Pill, {
            label: tier.threshold === 0 ? 'старт' : `${tier.threshold} бонусов`,
            tone: tier.key === current.key ? 'good' : 'neutral'
          })]
        }), tier.benefits.map(benefit => /*#__PURE__*/jsx(InfoRow, {
          icon: "checkmark-circle-outline",
          text: benefit
        }, `${tier.key}-${benefit}`))]
      }, tier.key))]
    });
  }
  function BonusRedemptionCodeModal(_ref11) {
    var visible = _ref11.visible,
      token = _ref11.token,
      loading = _ref11.loading,
      onClose = _ref11.onClose,
      onRefresh = _ref11.onRefresh;
    var shortCode = token?.short_code ?? '000000';
    return /*#__PURE__*/jsxs(ModalSheet, {
      visible: visible,
      title: "\u041A\u043E\u0434 \u0434\u043B\u044F \u0441\u043F\u0438\u0441\u0430\u043D\u0438\u044F \u0431\u043E\u043D\u0443\u0441\u043E\u0432",
      onClose: onClose,
      children: [/*#__PURE__*/jsxs(LinearGradient, {
        colors: ['#1b1714', '#3a241d', '#7a2638'],
        style: styles.referralModalCard,
        children: [/*#__PURE__*/jsx(Text, {
          style: styles.referralBrand,
          children: "\u0413\u043E\u0440\u044B"
        }), /*#__PURE__*/jsx(Text, {
          style: styles.referralSub,
          children: "\u041F\u043E\u043A\u0430\u0436\u0438\u0442\u0435 QR \u0438\u043B\u0438 \u043A\u043E\u0434 \u0441\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A\u0443"
        }), loading ? /*#__PURE__*/jsx(Text, {
          style: styles.referralBigCode,
          children: "\u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430..."
        }) : /*#__PURE__*/jsx(Text, {
          style: styles.referralBigCode,
          children: shortCode
        }), /*#__PURE__*/jsx(View, {
          style: styles.qrBox,
          children: /*#__PURE__*/jsx(QRCode, {
            value: shortCode,
            size: 184,
            color: "#241915",
            backgroundColor: "#fff8ea"
          })
        }), /*#__PURE__*/jsx(Text, {
          style: styles.referralHint,
          children: "\u041A\u043E\u0434 \u0432\u0440\u0435\u043C\u0435\u043D\u043D\u044B\u0439 \u0438 \u0440\u0435\u0433\u0443\u043B\u044F\u0440\u043D\u043E \u043E\u0431\u043D\u043E\u0432\u043B\u044F\u0435\u0442\u0441\u044F."
        })]
      }), /*#__PURE__*/jsx(PrimaryButton, {
        title: loading ? "\u041E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u0435..." : "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C \u043A\u043E\u0434",
        disabled: loading,
        onPress: onRefresh
      })]
    });
  }
  function DishDetailModal(_refDishDetail) {
    var item = _refDishDetail.item,
      visible = _refDishDetail.visible,
      onClose = _refDishDetail.onClose;
    if (!item) {
      return /*#__PURE__*/jsx(ModalSheet, {
        visible: false,
        title: "",
        onClose: onClose
      });
    }
    return /*#__PURE__*/jsx(ModalSheet, {
      visible: visible,
      title: item.name,
      onClose: onClose,
      children: /*#__PURE__*/jsxs(View, {
        children: [item.photo_url ? /*#__PURE__*/jsx(Image, {
          source: { uri: item.photo_url },
          style: styles.dishDetailImage
        }) : /*#__PURE__*/jsx(LinearGradient, {
          colors: ['#533126', '#9b5534'],
          style: styles.dishDetailImage,
          children: /*#__PURE__*/jsx(Ionicons, {
            name: "restaurant-outline",
            size: 54,
            color: "#fff6df"
          })
        }), /*#__PURE__*/jsxs(View, {
          style: styles.cardHeader,
          children: [/*#__PURE__*/jsx(Text, {
            style: styles.dishDetailTitle,
            children: item.name
          }), /*#__PURE__*/jsxs(Text, {
            style: styles.price,
            children: [item.price, " ₽"]
          })]
        }), /*#__PURE__*/jsx(Text, {
          style: styles.mutedDark,
          children: item.description || item.composition || "Описание скоро появится"
        }), item.composition ? /*#__PURE__*/jsx(InfoRow, {
          icon: "leaf-outline",
          text: item.composition
        }) : null, item.weight ? /*#__PURE__*/jsx(InfoRow, {
          icon: "scale-outline",
          text: item.weight
        }) : null, !item.is_available ? /*#__PURE__*/jsx(Pill, {
          label: item.guest_status_text ?? "Временно недоступно",
          tone: "warn"
        }) : null]
      })
    });
  }
  function GuestDishCard(_ref9) {
    var item = _ref9.item,
      compact = _ref9.compact,
      onPress = _ref9.onPress;
    var badges = [Number(item.popularity ?? 0) >= 80 ? 'Популярное' : null, Number(item.spice_level ?? 0) > 0 ? 'Острое' : null, item.status === 'new' ? 'Новинка' : null, !item.is_available ? 'Временно недоступно' : null].filter(Boolean);
    return /*#__PURE__*/jsx(Pressable, {
      onPress: onPress,
      children: /*#__PURE__*/jsxs(View, {
        style: styles.dishRow,
        children: [/*#__PURE__*/jsx(LinearGradient, {
          colors: ['#533126', '#9b5534'],
          style: styles.dishImage,
          children: /*#__PURE__*/jsx(Ionicons, {
            name: "restaurant-outline",
            size: compact ? 24 : 30,
            color: "#fff6df"
          })
        }), /*#__PURE__*/jsxs(View, {
          style: styles.dishBody,
          children: [/*#__PURE__*/jsxs(View, {
            style: styles.cardHeader,
            children: [/*#__PURE__*/jsx(Text, {
              style: styles.dishTitle,
              children: item.name
            }), /*#__PURE__*/jsxs(Text, {
              style: styles.price,
              children: [item.price, " \u20BD"]
            })]
          }), /*#__PURE__*/jsx(Text, {
            style: styles.mutedDark,
            children: item.description || item.composition || 'Описание скоро появится'
          }), /*#__PURE__*/jsxs(View, {
            style: styles.badges,
            children: [item.weight ? /*#__PURE__*/jsx(Text, {
              style: styles.badge,
              children: item.weight
            }) : null, badges.map(badge => /*#__PURE__*/jsx(Text, {
              style: [styles.badge, badge === 'Временно недоступно' ? styles.badgeWarn : null],
              children: badge
            }, badge))]
          })]
        }), /*#__PURE__*/jsx(Ionicons, {
          name: "chevron-forward",
          size: 22,
          color: "#B7B1AA"
        })]
      })
    });
  }
const MemoGuestDishCard = /*#__PURE__*/(0, _react.memo)(GuestDishCard);
  function BirthdayPickerField(_refBirthday) {
    var value = _refBirthday.value,
      onChange = _refBirthday.onChange;
    var parts = String(value ?? '').split('-');
    const [visible, setVisible] = useState(false);
    const [year, setYear] = useState(parts[0] && parts[0].length === 4 ? parts[0] : birthdayYears[20]);
    const [month, setMonth] = useState(parts[1] ?? '01');
    const [day, setDay] = useState(parts[2] ?? '01');
    var label = value || 'Выбрать дату рождения';
    return /*#__PURE__*/jsxs(Fragment, {
      children: [/*#__PURE__*/jsx(Text, {
        style: styles.fieldLabel,
        children: "\u0414\u0430\u0442\u0430 \u0440\u043E\u0436\u0434\u0435\u043D\u0438\u044F"
      }), /*#__PURE__*/jsx(Pressable, {
        onPress: () => setVisible(true),
        style: styles.birthdayPickerButton,
        children: /*#__PURE__*/jsx(Text, {
          style: styles.birthdayPickerText,
          children: label
        })
      }), /*#__PURE__*/jsxs(ModalSheet, {
        visible: visible,
        title: "\u0414\u0430\u0442\u0430 \u0440\u043E\u0436\u0434\u0435\u043D\u0438\u044F",
        onClose: () => setVisible(false),
        children: [/*#__PURE__*/jsxs(View, {
          style: styles.birthdayColumns,
          children: [/*#__PURE__*/jsx(BirthdayColumn, {
            title: "\u0414\u0435\u043D\u044C",
            values: birthdayDays,
            selected: day,
            onSelect: setDay
          }), /*#__PURE__*/jsx(BirthdayColumn, {
            title: "\u041C\u0435\u0441\u044F\u0446",
            values: birthdayMonths,
            selected: month,
            onSelect: setMonth
          }), /*#__PURE__*/jsx(BirthdayColumn, {
            title: "\u0413\u043E\u0434",
            values: birthdayYears,
            selected: year,
            onSelect: setYear
          })]
        }), /*#__PURE__*/jsx(PrimaryButton, {
          title: "Выбрать",
          onPress: () => {
            var maxDay = new Date(Number(year), Number(month), 0).getDate();
            var safeDay = String(Math.min(Number(day), maxDay)).padStart(2, '0');
            onChange(`${year}-${month}-${safeDay}`);
            setVisible(false);
          }
        })]
      })]
    });
  }
  function BirthdayColumn(_refBirthdayColumn) {
    var title = _refBirthdayColumn.title,
      values = _refBirthdayColumn.values,
      selected = _refBirthdayColumn.selected,
      onSelect = _refBirthdayColumn.onSelect;
    return /*#__PURE__*/jsxs(View, {
      style: styles.birthdayColumn,
      children: [/*#__PURE__*/jsx(Text, {
        style: styles.birthdayColumnTitle,
        children: title
      }), /*#__PURE__*/jsx(ScrollView, {
        nestedScrollEnabled: true,
        style: styles.birthdayColumnScroll,
        children: values.map(item => /*#__PURE__*/jsx(Pressable, {
          onPress: () => onSelect(item),
          style: [styles.birthdayOption, selected === item ? styles.birthdayOptionActive : null],
          children: /*#__PURE__*/jsx(Text, {
            style: [styles.birthdayOptionText, selected === item ? styles.birthdayOptionTextActive : null],
            children: item
          })
        }, item))
      })]
    });
  }
  function InfoCard(_ref0) {
    var title = _ref0.title,
      value = _ref0.value,
      text = _ref0.text;
    return /*#__PURE__*/jsxs(Card, {
      tone: "soft",
      children: [/*#__PURE__*/jsx(Text, {
        style: styles.mutedDark,
        children: title
      }), /*#__PURE__*/jsx(Text, {
        style: styles.infoValue,
        children: value
      }), /*#__PURE__*/jsx(Text, {
        style: styles.mutedDark,
        children: text
      })]
    });
  }
  function InfoRow(_ref1) {
    var icon = _ref1.icon,
      text = _ref1.text,
      onPress = _ref1.onPress;
    const content = /*#__PURE__*/jsxs(View, {
      style: styles.infoRow,
      children: [/*#__PURE__*/jsx(Ionicons, {
        name: icon,
        size: 20,
        color: palette.burgundy
      }), /*#__PURE__*/jsx(Text, {
        style: styles.infoText,
        children: text
      })]
    });

    if (onPress) {
      return /*#__PURE__*/jsx(Pressable, {
        onPress: onPress,
        style: ({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }],
        children: content
      });
    }

    return content;
  }
  function TransactionLine(_ref10) {
    var transaction = _ref10.transaction;
    var positive = Number(transaction.amount) > 0;
    return /*#__PURE__*/jsxs(View, {
      style: styles.transactionLine,
      children: [/*#__PURE__*/jsxs(View, {
        style: styles.transactionText,
        children: [/*#__PURE__*/jsx(Text, {
          style: styles.transactionTitle,
          children: transactionLabels[transaction.type] ?? transaction.reason
        }), /*#__PURE__*/jsx(Text, {
          style: styles.mutedDark,
          children: new Date(transaction.created_at).toLocaleDateString('ru-RU')
        })]
      }), /*#__PURE__*/jsxs(Text, {
        style: [styles.transactionAmount, positive ? styles.transactionPlus : styles.transactionMinus],
        children: [positive ? '+' : '', transaction.amount]
      })]
    });
  }
  function GuestAuthModal(_ref11) {
    var visible = _ref11.visible,
      mode = _ref11.mode,
      onClose = _ref11.onClose,
      onSubmit = _ref11.onSubmit,
      onOAuthSuccess = _ref11.onOAuthSuccess;
    const [form, setForm] = useState({
        name: '',
        phone: '',
        birthday: '',
        referralCode: '',
        marketingConsent: true,
        termsAccepted: false
      });
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState(null);
    var isRegister = mode === 'register';

    return /*#__PURE__*/jsx(ModalSheet, {
      visible: visible,
      title: isRegister ? 'Регистрация гостя' : 'Вход гостя',
      onClose: onClose,
      children: /*#__PURE__*/jsxs(KeyboardAvoidingView, {
        behavior: Platform.OS === 'ios' ? 'padding' : 'height',
        children: [isRegister ? /*#__PURE__*/jsx(Field, {
          label: "\u0418\u043C\u044F",
          value: form.name,
          onChangeText: name => setForm({
            ...form,
            name
          }),
          placeholder: "\u041A\u0430\u043A \u043A \u0432\u0430\u043C \u043E\u0431\u0440\u0430\u0449\u0430\u0442\u044C\u0441\u044F"
        }) : null, /*#__PURE__*/jsx(Field, {
          label: "\u0422\u0435\u043B\u0435\u0444\u043E\u043D",
          value: form.phone,
          onChangeText: phone => setForm({
            ...form,
            phone: formatRussianPhoneInput(phone)
          }),
          placeholder: "+7 900 000-00-00",
          keyboardType: "phone-pad"
        }), isRegister ? /*#__PURE__*/jsxs(Fragment, {
          children: [/*#__PURE__*/jsx(BirthdayPickerField, {
            value: form.birthday,
            onChange: birthday => setForm({
              ...form,
              birthday
            })
          }), /*#__PURE__*/jsx(Field, {
            label: "\u041A\u043E\u0434 \u0434\u0440\u0443\u0433\u0430",
            value: form.referralCode,
            onChangeText: referralCode => setForm({
              ...form,
              referralCode
            }),
            placeholder: "\u041D\u0430\u043F\u0440\u0438\u043C\u0435\u0440 GOR12345",
            autoCapitalize: "characters"
          }), /*#__PURE__*/jsxs(Pressable, {
            onPress: () => setForm({
              ...form,
              termsAccepted: !form.termsAccepted
            }),
            style: styles.checkboxLine,
            children: [/*#__PURE__*/jsx(Ionicons, {
              name: form.termsAccepted ? 'checkbox-outline' : 'square-outline',
              size: 22,
              color: palette.burgundy
            }), /*#__PURE__*/jsx(Text, {
              style: styles.mutedDark,
              children: "Я принимаю пользовательское соглашение"
            })]
          }), /*#__PURE__*/jsxs(Pressable, {
            onPress: () => setForm({
              ...form,
              marketingConsent: !form.marketingConsent
            }),
            style: styles.checkboxLine,
            children: [/*#__PURE__*/jsx(Ionicons, {
              name: form.marketingConsent ? 'checkbox-outline' : 'square-outline',
              size: 22,
              color: palette.burgundy
            }), /*#__PURE__*/jsx(Text, {
              style: styles.mutedDark,
              children: "\u0425\u043E\u0447\u0443 \u043F\u043E\u043B\u0443\u0447\u0430\u0442\u044C \u043F\u0435\u0440\u0441\u043E\u043D\u0430\u043B\u044C\u043D\u044B\u0435 \u043F\u0440\u0435\u0434\u043B\u043E\u0436\u0435\u043D\u0438\u044F"
            })]
          })]
        }) : null, message ? /*#__PURE__*/jsx(Text, {
          style: styles.errorText,
          children: message
        }) : null, /*#__PURE__*/jsx(PrimaryButton, {
          title: loading ? 'Подождите...' : isRegister ? 'Создать профиль' : 'Войти',
          disabled: loading || (isRegister && !form.termsAccepted),
          onPress: async () => {
            if (!mode) return;
            setLoading(true);
            setMessage(null);
            try {
              await onSubmit(mode, form);
            } catch (error) {
              setMessage(error instanceof Error ? error.message : 'Не удалось выполнить действие.');
            } finally {
              setLoading(false);
            }
          },
        }), /*#__PURE__*/jsx(OAuthButtons, {
          apiUrl: getFixedApiUrl(),
          referralCode: form.referralCode,
          onSuccess: onOAuthSuccess,
          onError: (error) => setMessage(error)
        })]
      })
    });
  }
  function GuestEditProfileModal(_ref12) {
    var visible = _ref12.visible,
      profile = _ref12.profile,
      onClose = _ref12.onClose,
      onSubmit = _ref12.onSubmit;
    var guest = profile?.guest ?? null;
    const [form, setForm] = useState({
        name: '',
        phone: '',
        birthday: '',
        email: '',
        marketingConsent: true
      });
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState(null);
    useEffect(() => {
      if (!visible || !guest) return;
      setForm({
        name: guest.name ?? '',
        phone: formatRussianPhoneInput(guest.phone ?? ''),
        birthday: guest.birthday ?? '',
        email: guest.email ?? '',
        marketingConsent: Boolean(guest.marketing_consent)
      });
      setMessage(null);
    }, [visible, guest?.id]);
    return /*#__PURE__*/jsx(ModalSheet, {
      visible: visible,
      title: "\u0420\u0435\u0434\u0430\u043A\u0442\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u043F\u0440\u043E\u0444\u0438\u043B\u044C",
      onClose: onClose,
      children: /*#__PURE__*/jsxs(KeyboardAvoidingView, {
        behavior: Platform.OS === 'ios' ? 'padding' : 'height',
        style: styles.modalKeyboard,
        children: [/*#__PURE__*/jsx(Field, {
          label: "\u0418\u043C\u044F",
          value: form.name,
          onChangeText: name => setForm({
            ...form,
            name
          })
        }), /*#__PURE__*/jsx(Field, {
          label: "\u0422\u0435\u043B\u0435\u0444\u043E\u043D",
          value: form.phone,
          onChangeText: phone => setForm({
            ...form,
            phone: formatRussianPhoneInput(phone)
          }),
          keyboardType: "phone-pad"
        }), /*#__PURE__*/jsx(BirthdayPickerField, {
          value: form.birthday,
          onChange: birthday => setForm({
            ...form,
            birthday
          })
        }), /*#__PURE__*/jsx(Field, {
          label: "Email",
          value: form.email,
          onChangeText: email => setForm({
            ...form,
            email
          }),
          keyboardType: "email-address",
          autoCapitalize: "none"
        }), /*#__PURE__*/jsxs(Pressable, {
          onPress: () => setForm({
            ...form,
            marketingConsent: !form.marketingConsent
          }),
          style: styles.checkboxLine,
          children: [/*#__PURE__*/jsx(Ionicons, {
            name: form.marketingConsent ? 'checkbox-outline' : 'square-outline',
            size: 22,
            color: palette.burgundy
          }), /*#__PURE__*/jsx(Text, {
            style: styles.mutedDark,
            children: "\u041F\u043E\u043B\u0443\u0447\u0430\u0442\u044C \u043F\u0435\u0440\u0441\u043E\u043D\u0430\u043B\u044C\u043D\u044B\u0435 \u043F\u0440\u0435\u0434\u043B\u043E\u0436\u0435\u043D\u0438\u044F"
          })]
        }), message ? /*#__PURE__*/jsx(Text, {
          style: styles.errorText,
          children: message
        }) : null, /*#__PURE__*/jsx(PrimaryButton, {
          title: loading ? 'Сохраняем...' : 'Сохранить',
          disabled: loading,
          onPress: async () => {
            setLoading(true);
            setMessage(null);
            try {
              await onSubmit({
                name: form.name,
                phone: form.phone,
                birthday: form.birthday,
                email: form.email,
                marketing_consent: form.marketingConsent
              });
            } catch (error) {
              setMessage(error instanceof Error ? error.message : 'Не удалось сохранить профиль.');
            } finally {
              setLoading(false);
            }
          },
        })]
      })
    });
  }
  function StaffLoginModal(_ref13) {
    var visible = _ref13.visible,
      loading = _ref13.loading,
      message = _ref13.message,
      onClose = _ref13.onClose,
      onSubmit = _ref13.onSubmit,
      onRegister = _ref13.onRegister;
    const [mode, setMode] = useState('login');
    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    const [login, setLogin] = useState('');
    const [password, setPassword] = useState('');
    const isRegister = mode === 'register';
    return /*#__PURE__*/jsxs(ModalSheet, {
      visible: visible,
      title: isRegister ? "\u0420\u0435\u0433\u0438\u0441\u0442\u0440\u0430\u0446\u0438\u044F \u0441\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A\u0430" : "\u0412\u0445\u043E\u0434 \u0434\u043B\u044F \u0441\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A\u043E\u0432",
      onClose: onClose,
      children: /*#__PURE__*/jsxs(KeyboardAvoidingView, {
        behavior: Platform.OS === 'ios' ? 'padding' : 'height',
        style: styles.modalKeyboard,
        children: [/*#__PURE__*/jsx(SecondaryButton, {
        title: isRegister ? "\u0423\u0436\u0435 \u0435\u0441\u0442\u044C \u043F\u0440\u043E\u0444\u0438\u043B\u044C" : "\u0420\u0435\u0433. \u043D\u043E\u0432\u043E\u0433\u043E \u0440\u0430\u0431\u043E\u0442\u043D\u0438\u043A\u0430",
        compact: true,
        onPress: () => setMode(isRegister ? 'login' : 'register')
      }), isRegister ? /*#__PURE__*/jsx(Pill, {
        label: "\u041F\u043E\u0441\u043B\u0435 \u0441\u043E\u0437\u0434\u0430\u043D\u0438\u044F \u0443\u043F\u0440\u0430\u0432\u043B\u044F\u044E\u0449\u0438\u0439 \u043D\u0430\u0437\u043D\u0430\u0447\u0438\u0442 \u0440\u043E\u043B\u044C",
        tone: "warn"
      }) : null, isRegister ? /*#__PURE__*/jsx(Field, {
        label: "\u0418\u043C\u044F \u0438 \u0444\u0430\u043C\u0438\u043B\u0438\u044F",
        value: name,
        onChangeText: setName
      }) : null, isRegister ? /*#__PURE__*/jsx(Field, {
        label: "\u0422\u0435\u043B\u0435\u0444\u043E\u043D",
        value: phone,
        onChangeText: setPhone,
        keyboardType: "phone-pad"
      }) : null, /*#__PURE__*/jsx(Field, {
        label: "\u041B\u043E\u0433\u0438\u043D",
        value: login,
        onChangeText: setLogin,
        autoCapitalize: "none"
      }), /*#__PURE__*/jsx(Field, {
        label: "\u041F\u0430\u0440\u043E\u043B\u044C",
        value: password,
        onChangeText: setPassword,
        secureTextEntry: true,
        autoComplete: mode === 'login' ? "current-password" : "new-password",
        textContentType: mode === 'login' ? "password" : "newPassword"
      }), message ? /*#__PURE__*/jsx(Text, {
        style: styles.errorText,
        children: message
      }) : null, /*#__PURE__*/jsx(PrimaryButton, {
        title: loading ? 'Подождите...' : isRegister ? 'Создать профиль' : 'Войти в рабочую зону',
        disabled: loading,
        onPress: () => isRegister ? onRegister(name, phone, login, password) : onSubmit(login, password)
      })]
      })
    });
  }
const styles = StyleSheet.create({
    app: {
      flex: 1,
      backgroundColor: '#F5F0E7'
    },
    shell: {
      flex: 1
    },
    modalKeyboard: {
      gap: 10
    },
    pager: {
      flex: 1
    },
    connectionBanner: {
      marginHorizontal: 16,
      marginBottom: 8,
      borderRadius: _theme.radius.sm,
      paddingHorizontal: 12,
      paddingVertical: 10,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: palette.goldSoft
    },
    connectionBannerText: {
      flex: 1,
      color: palette.ink,
      fontSize: 12,
      fontWeight: '900'
    },
    page: {
      flex: 1
    },
    content: {
      paddingHorizontal: 18,
      paddingTop: 24,
      paddingBottom: 118,
      gap: 14
    },
    headerLine: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center'
    },
    brand: {
      color: palette.burgundy,
      fontSize: 28,
      fontWeight: '900',
      letterSpacing: 0
    },
    screenTitle: {
      color: '#080706',
      fontSize: 44,
      fontWeight: '900',
      letterSpacing: 0
    },
    sectionTitle: {
      color: '#080706',
      fontSize: 22,
      fontWeight: '900',
      letterSpacing: 0
    },
    notice: {
      padding: 12,
      borderRadius: _theme.radius.sm,
      backgroundColor: 'rgba(151, 38, 56, 0.08)',
      color: palette.burgundy,
      fontWeight: '800'
    },
    offlineBadge: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 99,
      color: palette.burgundy,
      backgroundColor: 'rgba(151, 38, 56, 0.09)',
      fontWeight: '800'
    },
    hero: {
      borderRadius: _theme.radius.md,
      padding: 22,
      gap: 12,
      overflow: 'hidden',
      ...shadow.card
    },
    heroTitle: {
      color: '#fff8ea',
      fontSize: 32,
      lineHeight: 38,
      fontWeight: '900',
      letterSpacing: 0
    },
    heroText: {
      color: 'rgba(255,248,234,0.78)',
      fontSize: 16,
      lineHeight: 23
    },
    heroActions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
      marginTop: 6
    },
    cardHeader: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 10
    },
    cardTitleDark: {
      color: palette.ink,
      fontSize: 19,
      fontWeight: '900'
    },
    mutedDark: {
      color: palette.inkMuted,
      fontSize: 14,
      lineHeight: 20
    },
    linkText: {
      color: palette.burgundy,
      fontWeight: '900'
    },
    rowButtons: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
      marginTop: 12
    },
    menuHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12
    },
    menuLogo: {
      width: 54,
      height: 54,
      borderRadius: 27,
      backgroundColor: palette.burgundy,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 3,
      borderColor: '#F5D68B'
    },
    menuLogoText: {
      color: '#FFF8EA',
      fontSize: 28,
      fontWeight: '900'
    },
    promoStrip: {
      gap: 12,
      paddingRight: 18
    },
    promoPressable: {
      width: 286
    },
    promoCard: {
      width: '100%',
      minHeight: 146,
      borderRadius: 18,
      padding: 18,
      justifyContent: 'flex-end',
      gap: 8,
      overflow: 'hidden'
    },
    promoTitle: {
      color: '#FFF8EA',
      fontSize: 23,
      lineHeight: 28,
      fontWeight: '900'
    },
    promoText: {
      color: 'rgba(255,248,234,0.82)',
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '800'
    },
    devLoginGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginTop: 10
    },
    cardGrid: {
      flexDirection: 'row',
      gap: 10
    },
    infoValue: {
      color: palette.ink,
      fontSize: 24,
      fontWeight: '900'
    },
    staffButton: {
      alignSelf: 'center',
      marginTop: 16,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 14,
      paddingVertical: 10
    },
    staffButtonText: {
      color: '#8B8178',
      fontWeight: '800'
    },
    bonusCard: {
      borderRadius: 22,
      padding: 20,
      minHeight: 220,
      justifyContent: 'space-between',
      ...shadow.card
    },
    bonusTop: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center'
    },
    bonusBrand: {
      color: palette.goldSoft,
      fontSize: 30,
      fontWeight: '900'
    },
    bonusLevel: {
      color: '#fff8ea',
      fontWeight: '900'
    },
    mountainLine: {
      height: 44,
      marginVertical: 10,
      borderBottomWidth: 2,
      borderColor: 'rgba(242, 212, 137, 0.42)',
      borderRadius: 24,
      transform: [{
        rotate: '-4deg'
      }]
    },
    bonusName: {
      color: '#fff8ea',
      fontSize: 22,
      fontWeight: '900'
    },
    bonusNumber: {
      color: 'rgba(255,248,234,0.68)',
      marginTop: 4,
      fontWeight: '700'
    },
    bonusBottom: {
      marginTop: 18,
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 16
    },
    bonusCaption: {
      color: 'rgba(255,248,234,0.62)',
      fontSize: 12,
      fontWeight: '800'
    },
    bonusValue: {
      color: palette.goldSoft,
      fontSize: 22,
      fontWeight: '900'
    },
    bonusValueSmall: {
      color: palette.goldSoft,
      fontSize: 16,
      fontWeight: '900'
    },
    progressTrack: {
      marginTop: 12,
      height: 10,
      borderRadius: 99,
      backgroundColor: 'rgba(74, 42, 29, 0.12)',
      overflow: 'hidden'
    },
    progressFill: {
      height: '100%',
      borderRadius: 99,
      backgroundColor: palette.burgundy
    },
    pressedSoft: {
      opacity: 0.82,
      transform: [{
        scale: 0.99
      }]
    },
    referralModalCard: {
      borderRadius: 24,
      padding: 18,
      alignItems: 'center',
      gap: 10,
      ...shadow.card
    },
    referralBrand: {
      color: palette.goldSoft,
      fontSize: 28,
      fontWeight: '900'
    },
    referralSub: {
      color: 'rgba(255,248,234,0.72)',
      fontSize: 13,
      fontWeight: '800'
    },
    referralBigCode: {
      color: '#fff8ea',
      fontSize: 30,
      fontWeight: '900',
      letterSpacing: 0
    },
    qrBox: {
      width: 206,
      height: 206,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 8,
      borderRadius: 18,
      backgroundColor: '#fff8ea',
      borderWidth: 1,
      borderColor: 'rgba(242, 212, 137, 0.7)'
    },
    qrCell: {
      width: 9,
      height: 9,
      borderRadius: 1,
      backgroundColor: '#fff8ea'
    },
    qrCellActive: {
      backgroundColor: '#241915'
    },
    qrMountainBadge: {
      position: 'absolute',
      left: 78,
      top: 78,
      width: 48,
      height: 48,
      borderRadius: 14,
      backgroundColor: '#FFF8EA',
      borderWidth: 2,
      borderColor: '#241915',
      alignItems: 'center',
      justifyContent: 'center'
    },
    qrMountainLine: {
      position: 'absolute',
      top: 12,
      left: 10,
      width: 28,
      height: 14,
      borderTopWidth: 3,
      borderLeftWidth: 3,
      borderColor: '#241915',
      borderRadius: 6,
      transform: [{
        rotate: '24deg'
      }]
    },
    qrMountainText: {
      marginTop: 12,
      color: '#241915',
      fontSize: 20,
      fontWeight: '900'
    },
    referralHint: {
      color: 'rgba(255,248,234,0.8)',
      fontSize: 13,
      lineHeight: 18,
      textAlign: 'center',
      fontWeight: '800'
    },
    darkModalTitle: {
      color: palette.goldSoft,
      fontSize: 26,
      fontWeight: '900'
    },
    darkModalText: {
      color: 'rgba(255,248,234,0.82)',
      fontSize: 14,
      lineHeight: 20,
      fontWeight: '800'
    },
    transactionLine: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: 'rgba(74, 42, 29, 0.08)'
    },
    transactionText: {
      flex: 1,
      paddingRight: 10
    },
    transactionTitle: {
      color: palette.ink,
      fontWeight: '900'
    },
    transactionAmount: {
      fontSize: 17,
      fontWeight: '900'
    },
    transactionPlus: {
      color: '#2d7d46'
    },
    transactionMinus: {
      color: palette.burgundy
    },
    offerLine: {
      marginTop: 10,
      paddingTop: 10,
      borderTopWidth: 1,
      borderTopColor: 'rgba(74, 42, 29, 0.08)'
    },
    offerTitle: {
      color: palette.ink,
      fontWeight: '900'
    },
    infoRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 10
    },
    infoText: {
      color: palette.ink,
      fontWeight: '800'
    },
    atmosphereGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10
    },
    atmosphereCard: {
      width: '48%',
      minHeight: 76,
      borderRadius: _theme.radius.md,
      borderWidth: 1,
      borderColor: 'rgba(74,42,29,0.10)',
      backgroundColor: '#FFF8EA',
      padding: 12,
      gap: 8,
      ...shadow.card
    },
    atmosphereText: {
      color: palette.ink,
      fontWeight: '900'
    },
    banquetTags: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginVertical: 12
    },
    tag: {
      overflow: 'hidden',
      borderRadius: 99,
      paddingHorizontal: 10,
      paddingVertical: 6,
      color: palette.burgundy,
      backgroundColor: 'rgba(151, 38, 61, 0.10)',
      fontWeight: '800'
    },
    categoryStrip: {
      gap: 8,
      paddingRight: 18
    },
    categoryChip: {
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 99,
      backgroundColor: '#FFF8EA',
      borderWidth: 1,
      borderColor: 'rgba(74,42,29,0.10)'
    },
    categoryChipActive: {
      backgroundColor: palette.burgundy,
      borderColor: palette.burgundy
    },
    categoryText: {
      color: palette.inkMuted,
      fontWeight: '800'
    },
    categoryTextActive: {
      color: '#FFF8EA'
    },
    dishRow: {
      flexDirection: 'row',
      gap: 12
    },
    dishImage: {
      width: 82,
      minHeight: 82,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center'
    },
    dishBody: {
      flex: 1,
      gap: 6
    },
    orderLine: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 8,
      borderTopWidth: 1,
      borderTopColor: 'rgba(74, 42, 29, 0.12)'
    },
    orderTitle: {
      color: palette.ink,
      fontSize: 15,
      fontWeight: '900'
    },
    addDishButton: {
      width: 42,
      height: 42,
      borderRadius: 21,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: palette.burgundy
    },
    dishTitle: {
      flex: 1,
      color: palette.ink,
      fontSize: 17,
      fontWeight: '900'
    },
    price: {
      color: palette.burgundy,
      fontSize: 16,
      fontWeight: '900'
    },
    badges: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
      marginTop: 4
    },
    badge: {
      overflow: 'hidden',
      borderRadius: 99,
      paddingHorizontal: 8,
      paddingVertical: 4,
      backgroundColor: 'rgba(74, 42, 29, 0.08)',
      color: palette.inkMuted,
      fontSize: 12,
      fontWeight: '800'
    },
    badgeWarn: {
      color: palette.burgundy,
      backgroundColor: 'rgba(151, 38, 61, 0.10)'
    },
    checkboxLine: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginVertical: 8
    },
    fieldLabel: {
      color: palette.ink,
      fontSize: 13,
      fontWeight: '900'
    },
    birthdayPickerButton: {
      minHeight: 48,
      justifyContent: 'center',
      borderRadius: _theme.radius.sm,
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderWidth: 1,
      borderColor: 'rgba(74, 42, 29, 0.16)',
      backgroundColor: '#FFF8EA'
    },
    birthdayPickerText: {
      color: palette.ink,
      fontSize: 15,
      fontWeight: '800'
    },
    birthdayColumns: {
      flexDirection: 'row',
      gap: 8
    },
    birthdayColumn: {
      flex: 1,
      minWidth: 82
    },
    birthdayColumnTitle: {
      color: palette.inkMuted,
      fontSize: 12,
      fontWeight: '900',
      marginBottom: 6
    },
    birthdayColumnScroll: {
      maxHeight: 230,
      borderRadius: _theme.radius.sm,
      backgroundColor: 'rgba(74, 42, 29, 0.05)'
    },
    birthdayOption: {
      minHeight: 40,
      alignItems: 'center',
      justifyContent: 'center',
      borderBottomWidth: 1,
      borderBottomColor: 'rgba(74, 42, 29, 0.07)'
    },
    birthdayOptionActive: {
      backgroundColor: palette.burgundy
    },
    birthdayOptionText: {
      color: palette.ink,
      fontSize: 15,
      fontWeight: '800'
    },
    birthdayOptionTextActive: {
      color: '#FFF8EA'
    },
    errorText: {
      color: palette.burgundy,
      fontWeight: '900',
      lineHeight: 20
    },
    iconTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8
    },
    mapPreview: {
      minHeight: 360,
      borderRadius: 26,
      padding: 20,
      justifyContent: 'flex-end',
      overflow: 'hidden',
      ...shadow.card
    },
    mapImage: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      width: '100%',
      height: '100%'
    },
    mapFade: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      height: 150,
      backgroundColor: 'rgba(255,248,234,0.86)'
    },
    mapRoad: {
      position: 'absolute',
      height: 22,
      borderRadius: 20,
      backgroundColor: '#FFFFFF',
      borderWidth: 1,
      borderColor: '#D4CABC'
    },
    mapRoadOne: {
      left: -30,
      right: -20,
      top: 92,
      transform: [{
        rotate: '-24deg'
      }]
    },
    mapRoadTwo: {
      left: 74,
      right: 46,
      top: 20,
      height: 18,
      transform: [{
        rotate: '82deg'
      }]
    },
    mapRoadThree: {
      left: 12,
      right: -40,
      bottom: 112,
      height: 18,
      transform: [{
        rotate: '18deg'
      }]
    },
    mapLabel: {
      position: 'absolute',
      left: 22,
      top: 34,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 99,
      backgroundColor: 'rgba(255,255,255,0.78)'
    },
    mapLabelText: {
      color: palette.inkMuted,
      fontSize: 12,
      fontWeight: '900'
    },
    mapPin: {
      position: 'absolute',
      top: 26,
      right: 26,
      width: 58,
      height: 58,
      borderRadius: 29,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: palette.burgundy,
      borderWidth: 4,
      borderColor: '#FFF8EA'
    },
    mapTitle: {
      color: palette.ink,
      fontSize: 26,
      fontWeight: '900',
      letterSpacing: 0
    },
    mapText: {
      marginTop: 8,
      color: palette.inkMuted,
      fontSize: 15,
      lineHeight: 22
    },
    routeButtons: {
      gap: 10
    },
    bottomNav: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      minHeight: 86,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 10,
      paddingTop: 8,
      paddingBottom: 12,
      borderTopWidth: 1,
      borderColor: 'rgba(0,0,0,0.08)',
      backgroundColor: 'rgba(255,255,255,0.98)'
    },
    navItem: {
      flex: 1,
      minWidth: 0,
      minHeight: 58,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 3,
      paddingVertical: 10,
      borderRadius: 14
    },
    navItemActive: {
      backgroundColor: 'rgba(74,42,29,0.06)'
    },
    navText: {
      color: '#A39E98',
      fontSize: 11,
      lineHeight: 13,
      fontWeight: '800',
      textAlign: 'center'
    },
    feedContent: {
      paddingHorizontal: 18,
      paddingTop: 18,
      paddingBottom: 118,
      gap: 14
    },
    feedMediaFrame: {
      width: '100%',
      minHeight: 320,
      borderRadius: 8,
      overflow: 'hidden',
      marginBottom: 12,
      backgroundColor: '#231916',
      alignItems: 'center',
      justifyContent: 'center'
    },
    feedMedia: {
      width: '100%',
      height: 360
    },
    feedPlayBadge: {
      position: 'absolute',
      left: 14,
      bottom: 14,
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(0,0,0,0.52)'
    },
    newsHeartBurst: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(0,0,0,0.08)'
    },
    newsSkeletonMedia: {
      width: '100%',
      height: 260,
      borderRadius: 8,
      backgroundColor: 'rgba(142,142,147,0.18)'
    },
    newsSkeletonMediaCompact: {
      height: 96
    },
    newsSkeletonLine: {
      marginTop: 14,
      height: 16,
      width: '82%',
      borderRadius: 8,
      backgroundColor: 'rgba(142,142,147,0.2)'
    },
    newsSkeletonLineShort: {
      marginTop: 9,
      height: 12,
      width: '56%',
      borderRadius: 8,
      backgroundColor: 'rgba(142,142,147,0.16)'
    },
    newsSkeletonActions: {
      marginTop: 14,
      flexDirection: 'row',
      gap: 10
    },
    newsSkeletonPill: {
      width: 66,
      height: 38,
      borderRadius: 8,
      backgroundColor: 'rgba(142,142,147,0.16)'
    },
    newsActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginTop: 12
    },
    newsActionButton: {
      minHeight: 40,
      minWidth: 66,
      borderRadius: 8,
      paddingHorizontal: 12,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      backgroundColor: 'rgba(74,42,29,0.07)'
    },
    newsLikeButton: {
      backgroundColor: 'rgba(142,142,147,0.12)'
    },
    newsLikeButtonActive: {
      backgroundColor: 'rgba(254,44,85,0.12)'
    },
    newsActionText: {
      color: palette.ink,
      fontSize: 13,
      fontWeight: '900'
    },
    newsLikeText: {
      color: '#8e8e93'
    },
    newsLikeTextActive: {
      color: '#fe2c55'
    },
    newsCommentsMore: {
      marginTop: 10,
      alignSelf: 'flex-start',
      paddingVertical: 8,
      paddingHorizontal: 2
    },
    newsCommentsMoreText: {
      color: palette.burgundy,
      fontSize: 13,
      fontWeight: '900'
    },
    commentsSheetBody: {
      gap: 10
    },
    commentLine: {
      marginTop: 10,
      paddingTop: 10,
      borderTopWidth: 1,
      borderTopColor: 'rgba(74,42,29,0.1)'
    },
    commentAuthor: {
      color: palette.ink,
      fontSize: 13,
      fontWeight: '900'
    },
    commentText: {
      marginTop: 2,
      color: palette.inkMuted,
      fontSize: 13,
      lineHeight: 18
    },
    commentComposer: {
      marginTop: 12,
      gap: 8
    },
    dishDetailImage: {
      width: '100%',
      height: 280,
      borderRadius: 8,
      marginBottom: 16,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#533126'
    },
    dishDetailTitle: {
      flex: 1,
      color: palette.ink,
      fontSize: 22,
      fontWeight: '900'
    },
    navTextActive: {
      color: '#24201D'
    }
  });
