import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Ionicons } from '@expo/vector-icons';
import {
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  type ScrollViewProps,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  useWindowDimensions,
  View,
} from 'react-native';

import { palette, radius, shadow } from '../theme';
import { haptics } from '../utils/haptics';
import { keyboardAwareBottomPadding } from './keyboardAvoidance';
import { nextPasswordVisible, passwordSecureTextEntry } from './passwordVisibility';

export function ScreenScroll({ children }: { children: ReactNode }) {
  return (
    <KeyboardAwareScrollView
      style={styles.screen}
      contentContainerStyle={styles.screenContent}
      baseBottomPadding={112}
      showsVerticalScrollIndicator={false}
      removeClippedSubviews={false}
      keyboardShouldPersistTaps="handled"
      overScrollMode="never"
    >
      {children}
    </KeyboardAwareScrollView>
  );
}

export function Card({ children, tone = 'light' }: { children: ReactNode; tone?: 'light' | 'dark' | 'soft' }) {
  return <View style={[styles.card, tone === 'dark' ? styles.cardDark : tone === 'soft' ? styles.cardSoft : null]}>{children}</View>;
}

export function SectionTitle({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <View style={styles.sectionTitleRow}>
      <View style={styles.sectionTitleText}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

export function PrimaryButton({
  title,
  onPress,
  disabled,
  compact,
}: {
  title: string;
  onPress?: () => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const handlePress = useCallback(() => {
    if (!disabled) {
      haptics.medium();
      onPress?.();
    }
  }, [disabled, onPress]);

  return (
    <Pressable
      disabled={disabled}
      onPress={handlePress}
      style={({ pressed }) => [
        styles.primaryButton,
        compact ? styles.compactButton : null,
        disabled ? styles.buttonDisabled : null,
        pressed ? styles.pressed : null,
      ]}
    >
      <Text style={styles.primaryButtonText}>{title}</Text>
    </Pressable>
  );
}

export function SecondaryButton({
  title,
  onPress,
  danger,
  compact,
}: {
  title: string;
  onPress?: () => void;
  danger?: boolean;
  compact?: boolean;
}) {
  const handlePress = useCallback(() => {
    haptics.light();
    onPress?.();
  }, [onPress]);

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [
        styles.secondaryButton,
        compact ? styles.compactButton : null,
        danger ? styles.secondaryDanger : null,
        pressed ? styles.pressed : null,
      ]}
    >
      <Text style={[styles.secondaryButtonText, danger ? styles.secondaryDangerText : null]}>{title}</Text>
    </Pressable>
  );
}

export function Pill({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'info' | 'dark' }) {
  return (
    <View
      style={[
        styles.pill,
        tone === 'good' ? styles.pillGood : null,
        tone === 'warn' ? styles.pillWarn : null,
        tone === 'bad' ? styles.pillBad : null,
        tone === 'info' ? styles.pillInfo : null,
        tone === 'dark' ? styles.pillDark : null,
      ]}
    >
      <Text style={[styles.pillText, tone === 'dark' ? styles.pillTextDark : null]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const KeyboardAwareScrollContext = createContext<(() => void) | null>(null);

type FocusedInput = {
  measureInWindow?: (callback: (x: number, y: number, width: number, height: number) => void) => void;
};
type FieldFocusEvent = Parameters<NonNullable<TextInputProps['onFocus']>>[0];

function currentFocusedInput() {
  const textInputWithState = TextInput as typeof TextInput & {
    State?: {
      currentlyFocusedInput?: () => FocusedInput | null;
    };
  };
  return textInputWithState.State?.currentlyFocusedInput?.() ?? null;
}

function useKeyboardAwareScroll(baseBottomPadding: number, keyboardExtraPadding = 24, focusMargin = 28) {
  const scrollRef = useRef<ScrollView>(null);
  const scrollYRef = useRef(0);
  const keyboardHeightRef = useRef(0);
  const { height: windowHeight } = useWindowDimensions();
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const liftFocusedInput = useCallback(
    (nextKeyboardHeight: number) => {
      if (nextKeyboardHeight <= 0) return;
      setTimeout(() => {
        const input = currentFocusedInput();
        if (!input?.measureInWindow) return;
        input.measureInWindow((_x, y, _width, inputHeight) => {
          const keyboardTop = windowHeight - nextKeyboardHeight;
          const inputBottom = y + inputHeight + focusMargin;
          const hiddenBy = inputBottom - keyboardTop;
          if (hiddenBy <= 0) return;
          scrollRef.current?.scrollTo({ y: Math.max(0, scrollYRef.current + hiddenBy), animated: true });
        });
      }, Platform.OS === 'ios' ? 90 : 140);
    },
    [focusMargin, windowHeight],
  );

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (event) => {
      const nextHeight = event.endCoordinates?.height ?? 0;
      keyboardHeightRef.current = nextHeight;
      setKeyboardHeight(nextHeight);
      liftFocusedInput(nextHeight);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      keyboardHeightRef.current = 0;
      setKeyboardHeight(0);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [liftFocusedInput]);

  const onKeyboardAwareScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollYRef.current = event.nativeEvent.contentOffset.y;
  }, []);

  const requestFocusLift = useCallback(() => {
    liftFocusedInput(keyboardHeightRef.current);
  }, [liftFocusedInput]);

  const bottomPadding = useMemo(
    () => keyboardAwareBottomPadding(baseBottomPadding, keyboardHeight, keyboardExtraPadding),
    [baseBottomPadding, keyboardExtraPadding, keyboardHeight],
  );

  return {
    bottomPadding,
    onKeyboardAwareScroll,
    requestFocusLift,
    scrollRef,
  };
}

export function KeyboardAwareScrollView({
  baseBottomPadding = 0,
  children,
  contentContainerStyle,
  focusMargin = 28,
  keyboardExtraPadding = 24,
  keyboardDismissMode = 'on-drag',
  keyboardShouldPersistTaps = 'handled',
  nestedScrollEnabled = true,
  onScroll,
  scrollEventThrottle = 16,
  ...props
}: ScrollViewProps & {
  baseBottomPadding?: number;
  children: ReactNode;
  focusMargin?: number;
  keyboardExtraPadding?: number;
}) {
  const { bottomPadding, onKeyboardAwareScroll, requestFocusLift, scrollRef } = useKeyboardAwareScroll(
    baseBottomPadding,
    keyboardExtraPadding,
    focusMargin,
  );

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      onKeyboardAwareScroll(event);
      onScroll?.(event);
    },
    [onKeyboardAwareScroll, onScroll],
  );

  return (
    <KeyboardAwareScrollContext.Provider value={requestFocusLift}>
      <ScrollView
        {...props}
        ref={scrollRef}
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
        contentContainerStyle={[contentContainerStyle, { paddingBottom: bottomPadding }]}
        keyboardDismissMode={keyboardDismissMode}
        keyboardShouldPersistTaps={keyboardShouldPersistTaps}
        nestedScrollEnabled={nestedScrollEnabled}
        onScroll={handleScroll}
        scrollEventThrottle={scrollEventThrottle}
      >
        {children}
      </ScrollView>
    </KeyboardAwareScrollContext.Provider>
  );
}

export function Field({ label, style, onFocus, ...props }: TextInputProps & { label: string }) {
  const requestKeyboardLift = useContext(KeyboardAwareScrollContext);
  const canRevealPassword = Boolean(props.secureTextEntry);
  const [passwordVisible, setPasswordVisible] = useState(canRevealPassword);
  const effectiveSecureTextEntry = passwordSecureTextEntry(Boolean(props.secureTextEntry), passwordVisible);
  const handleFocus = useCallback(
    (event: FieldFocusEvent) => {
      onFocus?.(event);
      requestKeyboardLift?.();
    },
    [onFocus, requestKeyboardLift],
  );
  const togglePasswordVisibility = useCallback(() => {
    haptics.light();
    setPasswordVisible((current) => nextPasswordVisible(current));
  }, []);

  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.fieldInputWrap}>
        <TextInput
          {...props}
          autoCapitalize={canRevealPassword ? 'none' : props.autoCapitalize}
          autoCorrect={canRevealPassword ? false : props.autoCorrect}
          onFocus={handleFocus}
          placeholderTextColor="rgba(117, 95, 82, 0.62)"
          secureTextEntry={effectiveSecureTextEntry}
          style={[styles.field, canRevealPassword ? styles.fieldWithAction : null, props.multiline ? styles.fieldMulti : null, style]}
        />
        {canRevealPassword ? (
          <Pressable
            accessibilityLabel={passwordVisible ? 'Скрыть пароль' : 'Показать пароль'}
            accessibilityRole="button"
            hitSlop={10}
            onPress={togglePasswordVisibility}
            style={({ pressed }) => [styles.passwordVisibilityButton, pressed ? styles.pressed : null]}
          >
            <Ionicons name={passwordVisible ? 'eye-off-outline' : 'eye-outline'} size={22} color={palette.inkMuted} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export function MetricCard({ label, value, detail }: { label: string; value: string | number; detail?: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
      {detail ? <Text style={styles.metricDetail}>{detail}</Text> : null}
    </View>
  );
}

const avatarPresetColors: Record<string, string> = {
  graphite: '#2B2521',
  burgundy: '#7A2638',
  gold: '#9B6B2F',
  green: '#3E5F4A',
  clay: '#8A513A',
};

export function Avatar({ uri, name, size = 46 }: { uri?: string | null; name: string; size?: number }) {
  const initials = name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const preset = uri?.startsWith('preset:') ? uri.replace('preset:', '') : null;
  if (preset) {
    return (
      <View
        style={[
          styles.avatarFallback,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: avatarPresetColors[preset] ?? palette.burgundy,
          },
        ]}
      >
        <Text style={styles.avatarText}>{initials}</Text>
      </View>
    );
  }
  if (uri) {
    return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: palette.surfaceSoft }} />;
  }
  return (
    <View style={[styles.avatarFallback, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={styles.avatarText}>{initials}</Text>
    </View>
  );
}

export function ModalSheet({
  visible,
  title,
  children,
  onClose,
}: {
  visible: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const { bottomPadding, onKeyboardAwareScroll, requestFocusLift, scrollRef } = useKeyboardAwareScroll(28, 32, 36);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalKeyboard}>
        <View style={styles.modalSheet}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{title}</Text>
            <SecondaryButton title="Закрыть" onPress={onClose} compact />
          </View>
          <KeyboardAwareScrollContext.Provider value={requestFocusLift}>
          <ScrollView
            ref={scrollRef}
            automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
            showsVerticalScrollIndicator={false}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
            onScroll={onKeyboardAwareScroll}
            scrollEventThrottle={16}
            contentContainerStyle={[styles.modalContent, { paddingBottom: bottomPadding }]}
          >
            {children}
          </ScrollView>
          </KeyboardAwareScrollContext.Provider>
        </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

export function EmptyState({ title, text }: { title: string; text?: string }) {
  return (
    <Card tone="soft">
      <Text style={styles.emptyTitle}>{title}</Text>
      {text ? <Text style={styles.emptyText}>{text}</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  screenContent: {
    padding: 16,
    paddingBottom: 112,
    gap: 14,
  },
  card: {
    backgroundColor: palette.surface,
    borderRadius: radius.md,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(74, 42, 29, 0.12)',
    ...shadow.card,
  },
  cardDark: {
    backgroundColor: palette.brown,
    borderColor: 'rgba(255, 248, 234, 0.12)',
  },
  cardSoft: {
    backgroundColor: palette.surfaceAlt,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  sectionTitleText: {
    flex: 1,
  },
  sectionTitle: {
    color: palette.ink,
    fontSize: 22,
    fontWeight: '900',
  },
  sectionSubtitle: {
    marginTop: 4,
    color: palette.inkMuted,
    fontSize: 14,
    lineHeight: 20,
  },
  primaryButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: radius.sm,
    backgroundColor: palette.burgundy,
    ...shadow.button,
  },
  compactButton: {
    minHeight: 38,
    paddingHorizontal: 12,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  primaryButtonText: {
    color: palette.textOnDark,
    fontSize: 15,
    fontWeight: '800',
  },
  secondaryButton: {
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: 'rgba(255, 248, 234, 0.72)',
  },
  secondaryDanger: {
    borderColor: 'rgba(182, 61, 54, 0.5)',
    backgroundColor: palette.dangerSoft,
  },
  secondaryButtonText: {
    color: palette.ink,
    fontSize: 14,
    fontWeight: '800',
  },
  secondaryDangerText: {
    color: palette.red,
  },
  pressed: {
    opacity: 0.82,
    transform: [{ scale: 0.99 }],
  },
  pill: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: palette.surfaceSoft,
  },
  pillGood: {
    backgroundColor: palette.successSoft,
  },
  pillWarn: {
    backgroundColor: palette.goldSoft,
  },
  pillBad: {
    backgroundColor: palette.dangerSoft,
  },
  pillInfo: {
    backgroundColor: palette.infoSoft,
  },
  pillDark: {
    backgroundColor: palette.burgundy,
  },
  pillText: {
    color: palette.ink,
    fontSize: 12,
    fontWeight: '800',
  },
  pillTextDark: {
    color: palette.textOnDark,
  },
  fieldWrap: {
    gap: 6,
  },
  fieldInputWrap: {
    position: 'relative',
  },
  fieldLabel: {
    color: palette.inkMuted,
    fontSize: 13,
    fontWeight: '800',
  },
  field: {
    minHeight: 48,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: '#FFFDF8',
    color: palette.ink,
    paddingHorizontal: 13,
    fontSize: 16,
  },
  fieldWithAction: {
    paddingRight: 48,
  },
  passwordVisibilityButton: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  },
  fieldMulti: {
    minHeight: 92,
    paddingTop: 12,
    textAlignVertical: 'top',
  },
  metric: {
    flex: 1,
    minWidth: 104,
    backgroundColor: palette.surface,
    borderRadius: radius.md,
    padding: 13,
    borderWidth: 1,
    borderColor: 'rgba(215, 169, 74, 0.32)',
  },
  metricLabel: {
    color: palette.inkMuted,
    fontSize: 12,
    fontWeight: '800',
  },
  metricValue: {
    marginTop: 7,
    color: palette.ink,
    fontSize: 24,
    fontWeight: '900',
  },
  metricDetail: {
    marginTop: 2,
    color: palette.inkMuted,
    fontSize: 12,
  },
  avatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.goldSoft,
  },
  avatarText: {
    color: palette.brown,
    fontSize: 15,
    fontWeight: '900',
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(20, 10, 6, 0.58)',
  },
  modalKeyboard: {
    flex: 1,
    justifyContent: 'flex-end',
    width: '100%',
  },
  modalSheet: {
    maxHeight: '88%',
    paddingTop: 12,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    backgroundColor: palette.surface,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  modalTitle: {
    flex: 1,
    color: palette.ink,
    fontSize: 22,
    fontWeight: '900',
  },
  modalContent: {
    paddingHorizontal: 16,
    paddingBottom: 28,
    gap: 12,
  },
  emptyTitle: {
    color: palette.ink,
    fontSize: 17,
    fontWeight: '900',
  },
  emptyText: {
    marginTop: 6,
    color: palette.inkMuted,
    fontSize: 14,
    lineHeight: 20,
  },
});
