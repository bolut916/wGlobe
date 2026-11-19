/**
 * Supabase istemcisi.
 * - Oturum, parçalı SecureStore adaptörüyle saklanır (bkz. secureStorage.ts).
 * - Uygulama ön plandayken token otomatik yenilenir, arka plana geçince durur.
 * - .env eksikse uygulama çökmez: `isSupabaseConfigured === false` olur ve
 *   uygulama yalnızca Misafir Modu ile çalışır.
 */
import 'react-native-url-polyfill/auto';

import { createClient, processLock, type SupabaseClient } from '@supabase/supabase-js';
import { AppState, Platform, type AppStateStatus } from 'react-native';

import type { Database } from '@/types';

import { secureStorage } from './secureStorage';

const rawUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? '';
const rawAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? '';

const PLACEHOLDER_URL = 'https://placeholder.supabase.co';
const PLACEHOLDER_KEY = 'public-anon-key-not-configured';

export const isSupabaseConfigured: boolean =
  rawUrl.startsWith('https://') &&
  !rawUrl.includes('YOUR-PROJECT-REF') &&
  rawAnonKey.length > 20 &&
  !rawAnonKey.startsWith('YOUR-');

if (!isSupabaseConfigured && __DEV__) {
  console.warn(
    '[supabase] EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY tanımlı değil. ' +
      'Uygulama yalnızca Misafir Modu ile çalışacak. .env.example dosyasına bakın.',
  );
}

export const supabase: SupabaseClient<Database> = createClient<Database>(
  isSupabaseConfigured ? rawUrl : PLACEHOLDER_URL,
  isSupabaseConfigured ? rawAnonKey : PLACEHOLDER_KEY,
  {
    auth: {
      storage: secureStorage,
      autoRefreshToken: isSupabaseConfigured,
      persistSession: true,
      detectSessionInUrl: false,
      lock: processLock,
      flowType: 'pkce',
    },
    global: {
      headers: { 'X-Client-Info': 'wglobe-mobile/1.0' },
    },
  },
);

// ─────────────────────────────────────────────────────────────
//  Ön plan / arka plan token yenileme yönetimi
// ─────────────────────────────────────────────────────────────
let appStateSubscription: { remove: () => void } | null = null;

function handleAppStateChange(state: AppStateStatus | string | null | undefined): void {
  if (!isSupabaseConfigured) return;
  if (state === 'active') {
    void supabase.auth.startAutoRefresh();
  } else {
    void supabase.auth.stopAutoRefresh();
  }
}

/** Kök layout'ta bir kez çağrılır; dönen fonksiyon dinleyiciyi kaldırır. */
export function registerSupabaseAppStateListener(): () => void {
  if (Platform.OS === 'web' || appStateSubscription) {
    return () => undefined;
  }
  appStateSubscription = AppState.addEventListener('change', handleAppStateChange);
  handleAppStateChange(AppState.currentState);
  return () => {
    appStateSubscription?.remove();
    appStateSubscription = null;
  };
}

export class SupabaseNotConfiguredError extends Error {
  constructor() {
    super('Bulut hesabı şu anda kullanılamıyor. Misafir olarak devam edebilirsiniz.');
    this.name = 'SupabaseNotConfiguredError';
  }
}

export function assertSupabaseConfigured(): void {
  if (!isSupabaseConfigured) {
    throw new SupabaseNotConfiguredError();
  }
}
