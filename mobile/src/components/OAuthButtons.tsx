import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { palette } from '../theme';
import { guestOAuthLogin } from '../data/api';
import type { GuestSession } from '../data/api';

WebBrowser.maybeCompleteAuthSession();

interface OAuthButtonsProps {
  onSuccess: (session: GuestSession) => void;
  onError: (error: string) => void;
  apiUrl: string;
  referralCode?: string;
}

export function OAuthButtons({ onSuccess, onError, apiUrl, referralCode }: OAuthButtonsProps) {
  const [loading, setLoading] = useState<'yandex' | 'vk' | null>(null);

  const handleOAuth = async (provider: 'yandex' | 'vk') => {
    setLoading(provider);
    try {
      const redirectUri = `gory-staff://oauth/${provider}`;
      const query = [
        `mobile_redirect_uri=${encodeURIComponent(redirectUri)}`,
        referralCode ? `referral_code=${encodeURIComponent(referralCode)}` : null,
      ].filter(Boolean).join('&');

      // 1. Получаем URL авторизации
      const urlResponse = await fetch(`${apiUrl}/oauth/${provider}/url?${query}`);

      if (!urlResponse.ok) {
        throw new Error('Не удалось получить URL авторизации');
      }

      const { url } = await urlResponse.json();

      // 2. Открываем браузер для авторизации
      const result = await WebBrowser.openAuthSessionAsync(url, redirectUri);

      if (result.type === 'success' && result.url) {
        // 3. Парсим code из URL
        const urlObj = new URL(result.url);
        const code = urlObj.searchParams.get('code');
        const error = urlObj.searchParams.get('error');

        if (error) {
          throw new Error(`Ошибка ${provider}: ${error}`);
        }

        if (!code) {
          throw new Error('Не получен код авторизации');
        }

        // 4. Обмениваем code на токен через нашу функцию
        const session = await guestOAuthLogin(apiUrl, provider, code, referralCode, redirectUri);
        onSuccess(session);
      } else if (result.type === 'cancel') {
        // Пользователь отменил
        setLoading(null);
      }
    } catch (error) {
      console.error(`${provider} OAuth error:`, error);
      onError(error instanceof Error ? error.message : `Ошибка входа через ${provider === 'yandex' ? 'Яндекс' : 'ВКонтакте'}`);
    } finally {
      setLoading(null);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.divider}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>или войти через</Text>
        <View style={styles.dividerLine} />
      </View>

      <View style={styles.buttons}>
        <Pressable
          style={[styles.oauthButton, styles.yandexButton, loading === 'yandex' && styles.buttonDisabled]}
          onPress={() => handleOAuth('yandex')}
          disabled={loading !== null}
        >
          {loading === 'yandex' ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              <Ionicons name="logo-yahoo" size={20} color="#fff" />
              <Text style={styles.oauthButtonText}>Яндекс</Text>
            </>
          )}
        </Pressable>

        <Pressable
          style={[styles.oauthButton, styles.vkButton, loading === 'vk' && styles.buttonDisabled]}
          onPress={() => handleOAuth('vk')}
          disabled={loading !== null}
        >
          {loading === 'vk' ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              <Ionicons name="logo-vk" size={20} color="#fff" />
              <Text style={styles.oauthButtonText}>ВКонтакте</Text>
            </>
          )}
        </Pressable>
      </View>

      {loading && (
        <Text style={styles.loadingText}>
          Открываем {loading === 'yandex' ? 'Яндекс' : 'ВКонтакте'}...
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 16,
    marginBottom: 8,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#E5E1DC',
  },
  dividerText: {
    marginHorizontal: 12,
    fontSize: 13,
    color: '#A39E98',
    fontWeight: '500',
  },
  buttons: {
    flexDirection: 'row',
    gap: 12,
  },
  oauthButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    gap: 8,
  },
  yandexButton: {
    backgroundColor: '#FC3F1D',
  },
  vkButton: {
    backgroundColor: '#0077FF',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  oauthButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  loadingText: {
    marginTop: 12,
    textAlign: 'center',
    fontSize: 13,
    color: '#A39E98',
  },
});
