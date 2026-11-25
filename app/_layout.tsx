/**
 * Kök layout: uygulamanın tamamı tek ekrandır (app/index.tsx) — web sitesiyle aynı arayüzü taşıyan yerel kabuk.
 */
import * as SplashScreen from 'expo-splash-screen';
import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

void SplashScreen.preventAutoHideAsync().catch(() => undefined);
SplashScreen.setOptions({ duration: 400, fade: true });

export default function RootLayout() {
  // Kabuğun kendi yükleme örtüsü var: açılış görseli ilk karede yumuşakça ona devreder
  useEffect(() => { void SplashScreen.hideAsync().catch(() => undefined); }, []);
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#050B18' }, animation: 'none' }}>
          <Stack.Screen name="index" />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: '#050B18' } });
