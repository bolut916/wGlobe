/**
 * Oturum durumu: Supabase oturumu + Misafir Modu.
 *
 *   loading        → ilk açılış, SecureStore / AsyncStorage okunuyor
 *   authenticated  → geçerli Supabase oturumu var
 *   guest          → AsyncStorage'da isGuest = 'true'
 *   signed_out     → hiçbiri
 *
 * Misafir üye olur / giriş yaparsa yerel verisi otomatik olarak buluta eşitlenir.
 */
import type { Session, User } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { getAuthErrorMessage } from '@/lib/authErrors';
import { getIsGuest, setIsGuest } from '@/lib/storage';
import { assertSupabaseConfigured, isSupabaseConfigured, supabase } from '@/lib/supabase';
import { clearLocalUserData, deleteAccount as deleteAccountRequest, syncGuestDataToCloud } from '@/services/userDataService';
import type { AuthMode } from '@/types';

export interface SignUpResult {
  /** Supabase projesinde e-posta doğrulaması açıksa true: oturum, link tıklanınca açılır */
  needsEmailConfirmation: boolean;
}

interface AuthContextValue {
  mode: AuthMode;
  session: Session | null;
  user: User | null;
  userId: string | null;
  isGuest: boolean;
  isAuthenticated: boolean;
  isCloudAvailable: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<SignUpResult>;
  signOut: () => Promise<void>;
  continueAsGuest: () => Promise<void>;
  deleteAccount: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isReady, setIsReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [guest, setGuest] = useState(false);
  const guestRef = useRef(false);
  guestRef.current = guest;

  // ── İlk yükleme + oturum değişikliklerini dinle ─────────────
  useEffect(() => {
    let mounted = true;

    (async () => {
      const [storedGuest, sessionResult] = await Promise.all([
        getIsGuest(),
        isSupabaseConfigured
          ? supabase.auth.getSession().catch(() => ({ data: { session: null } }))
          : Promise.resolve({ data: { session: null } }),
      ]);
      if (!mounted) return;
      setSession(sessionResult.data.session);
      setGuest(storedGuest);
      setIsReady(true);
    })();

    if (!isSupabaseConfigured) {
      return () => {
        mounted = false;
      };
    }

    // Not: Bu geri çağırmanın içinde başka bir supabase çağrısı await edilmemeli
    // (auth kilidiyle kilitlenme riski). Sadece durumu güncelliyoruz.
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (mounted) setSession(nextSession);
    });

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  /** Misafir verisini buluta taşır; başarısız olsa bile girişi engellemez. */
  const migrateGuestData = useCallback(async (userId: string) => {
    if (!guestRef.current) return;
    try {
      await syncGuestDataToCloud(userId);
    } catch (error) {
      if (__DEV__) console.warn('[auth] misafir verisi eşitlenemedi', error);
    }
    await setIsGuest(false);
    setGuest(false);
  }, []);

  const signIn = useCallback(
    async (email: string, password: string) => {
      try {
        assertSupabaseConfigured();
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        if (data.user) await migrateGuestData(data.user.id);
        setSession(data.session);
      } catch (error) {
        throw new Error(getAuthErrorMessage(error));
      }
    },
    [migrateGuestData],
  );

  const signUp = useCallback(
    async (email: string, password: string): Promise<SignUpResult> => {
      try {
        assertSupabaseConfigured();
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        // E-posta zaten kayıtlıysa Supabase (numaralandırma koruması için) hata yerine
        // kimliği olmayan sahte bir kullanıcı döndürür.
        if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
          throw { code: 'user_already_exists' };
        }
        if (data.session && data.user) {
          await migrateGuestData(data.user.id);
          setSession(data.session);
          return { needsEmailConfirmation: false };
        }
        return { needsEmailConfirmation: true };
      } catch (error) {
        throw new Error(getAuthErrorMessage(error));
      }
    },
    [migrateGuestData],
  );

  const signOut = useCallback(async () => {
    if (session && isSupabaseConfigured) {
      const { error } = await supabase.auth.signOut();
      if (error) {
        // Ağ yoksa en azından cihazdaki oturumu kapat
        await supabase.auth.signOut({ scope: 'local' });
      }
      await clearLocalUserData();
    } else {
      // Misafir modundan çıkış: yerel favoriler/pasaport cihazda kalır,
      // kullanıcı tekrar misafir olursa kaldığı yerden devam eder.
      await setIsGuest(false);
    }
    setSession(null);
    setGuest(false);
  }, [session]);

  const continueAsGuest = useCallback(async () => {
    await setIsGuest(true);
    setGuest(true);
  }, []);

  const deleteAccount = useCallback(async () => {
    try {
      await deleteAccountRequest();
    } catch (error) {
      throw new Error(getAuthErrorMessage(error));
    }
    setSession(null);
    setGuest(false);
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    const mode: AuthMode = !isReady ? 'loading' : session ? 'authenticated' : guest ? 'guest' : 'signed_out';
    return {
      mode,
      session,
      user: session?.user ?? null,
      userId: session?.user.id ?? null,
      isGuest: mode === 'guest',
      isAuthenticated: mode === 'authenticated',
      isCloudAvailable: isSupabaseConfigured,
      signIn,
      signUp,
      signOut,
      continueAsGuest,
      deleteAccount,
    };
  }, [isReady, session, guest, signIn, signUp, signOut, continueAsGuest, deleteAccount]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth, AuthProvider içinde kullanılmalı');
  return context;
}
