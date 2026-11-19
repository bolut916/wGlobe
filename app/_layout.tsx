/**
 * Kök layout: sağlayıcı zinciri + splash yönetimi.
 *
 *   GestureHandlerRootView
 *    └ SafeAreaProvider
 *       └ AuthProvider            (oturum / misafir)
 *          └ UserDataProvider      (favoriler, pasaport, tema — kullanıcıya bağlı)
 *             └ GlobeAudioProvider (aktif şehir + radyo motoru — ziyaret kaydı için UserData'ya bağlı)
 */
import * as SplashScreen from 'expo-splash-screen';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { COLORS } from '@/constants/colors';
import { DURATION } from '@/constants/motion';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { GlobeAudioProvider } from '@/context/GlobeAudioContext';
import { UserDataProvider } from '@/context/UserDataContext';
import { registerSupabaseAppStateListener } from '@/lib/supabase';

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

SplashScreen.setOptions({ duration: DURATION.page, fade: true });

/** Oturum durumu çözülene kadar splash ekranda kalır: yanlış ekranın bir kare görünmesi önlenir. */
function SplashGate() {
  const { mode } = useAuth();
  useEffect(() => {
    if (mode !== 'loading') {
      void SplashScreen.hideAsync().catch(() => undefined);
    }
  }, [mode]);
  return null;
}

export default function RootLayout() {
  useEffect(() => registerSupabaseAppStateListener(), []);

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <AuthProvider>
          <UserDataProvider>
            <GlobeAudioProvider>
              <SplashGate />
              <StatusBar style="light" />
              <Stack
                screenOptions={{
                  headerShown: false,
                  contentStyle: { backgroundColor: COLORS.background },
                  animation: 'fade',
                  animationDuration: DURATION.page,
                }}
              >
                <Stack.Screen name="index" options={{ animation: 'none' }} />
                <Stack.Screen name="(auth)" />
                <Stack.Screen name="(tabs)" options={{ gestureEnabled: false }} />
              </Stack>
            </GlobeAudioProvider>
          </UserDataProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
});
