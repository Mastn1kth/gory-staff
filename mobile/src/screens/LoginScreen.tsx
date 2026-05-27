import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';

import { getFixedApiUrl } from '../data/api';
import { palette } from '../theme';
import { Card, Field, KeyboardAwareScrollView, Pill, PrimaryButton } from '../components/ui';

export function LoginScreen({
  onLogin,
  onRegister,
  loading,
  message,
}: {
  onLogin: (apiUrl: string, login: string, password: string) => void;
  onRegister: (apiUrl: string, name: string, phone: string, login: string, password: string) => void;
  loading: boolean;
  message?: string | null;
}) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [apiUrl] = useState(getFixedApiUrl());

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.select({ ios: 'padding', android: 'height' })} style={styles.keyboard}>
        <KeyboardAwareScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          baseBottomPadding={80}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
          showsVerticalScrollIndicator={false}
        >
          <LinearGradient colors={['#21140F', '#4A2A1D', '#7A2637']} style={styles.hero}>
            <Text style={styles.appName}>Горы</Text>
            <Text style={styles.title}>Рабочее приложение персонала ресторана</Text>
            <Text style={styles.subtitle}>Вход только для сотрудников: план зала, брони, стоп-лист, смены и задачи.</Text>
          </LinearGradient>

          <View style={styles.content}>
            <Card>
              <View style={styles.form}>
                <View style={styles.modeRow}>
                  <Pressable
                    style={[styles.modeButton, mode === 'login' ? styles.modeButtonActive : null]}
                    onPress={() => setMode('login')}
                  >
                    <Text style={[styles.modeText, mode === 'login' ? styles.modeTextActive : null]}>Вход</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.modeButton, mode === 'register' ? styles.modeButtonActive : null]}
                    onPress={() => {
                      setMode('register');
                    }}
                  >
                    <Text style={[styles.modeText, mode === 'register' ? styles.modeTextActive : null]}>Создать профиль</Text>
                  </Pressable>
                </View>
                {mode === 'register' ? <Pill label="После создания управляющий назначит роль" tone="warn" /> : null}
                {mode === 'register' ? (
                  <>
                    <Field label="Имя и фамилия" value={name} onChangeText={setName} />
                    <Field label="Телефон" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
                  </>
                ) : null}
                <Field label="Логин" value={login} onChangeText={setLogin} autoCapitalize="none" />
                <Field
                  label="Пароль"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  textContentType={mode === 'login' ? 'password' : 'newPassword'}
                />
                {message ? <Text style={styles.error}>{message}</Text> : null}
                <PrimaryButton
                  title={loading ? 'Подождите...' : mode === 'login' ? 'Войти' : 'Создать профиль'}
                  disabled={loading}
                  onPress={() => {
                    if (mode === 'login') {
                      onLogin(apiUrl, login, password);
                    } else {
                      onRegister(apiUrl, name, phone, login, password);
                    }
                  }}
                />
              </View>
            </Card>
          </View>
        </KeyboardAwareScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: palette.background,
  },
  keyboard: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: 80,
  },
  hero: {
    paddingHorizontal: 22,
    paddingTop: 22,
    paddingBottom: 20,
  },
  appName: {
    color: palette.goldSoft,
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 0,
  },
  title: {
    marginTop: 12,
    color: palette.textOnDark,
    fontSize: 31,
    lineHeight: 36,
    fontWeight: '900',
  },
  subtitle: {
    marginTop: 10,
    color: palette.textMutedOnDark,
    fontSize: 15,
    lineHeight: 22,
  },
  content: {
    flex: 1,
    padding: 16,
    gap: 16,
  },
  form: {
    gap: 13,
  },
  modeRow: {
    flexDirection: 'row',
    gap: 8,
    padding: 4,
    borderRadius: 12,
    backgroundColor: 'rgba(74, 42, 29, 0.08)',
  },
  modeButton: {
    flex: 1,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
  },
  modeButtonActive: {
    backgroundColor: palette.gold,
  },
  modeText: {
    color: palette.inkMuted,
    fontSize: 14,
    fontWeight: '900',
  },
  modeTextActive: {
    color: palette.ink,
  },
  error: {
    color: palette.red,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.75,
  },
});
