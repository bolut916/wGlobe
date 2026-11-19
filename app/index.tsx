/**
 * Giriş kapısı: oturum varsa veya Misafir Modu aktifse küreye,
 * yoksa karşılama ekranına yönlendirir.
 */
import { Redirect } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { COLORS } from '@/constants/colors';
import { useAuth } from '@/context/AuthContext';

export default function Index() {
  const { mode } = useAuth();

  if (mode === 'loading') {
    // Splash hâlâ görünür; arka plan rengi splash ile aynı (geçişte flaş yok)
    return <View style={styles.placeholder} />;
  }
  if (mode === 'authenticated' || mode === 'guest') {
    return <Redirect href="/(tabs)/globe" />;
  }
  return <Redirect href="/(auth)/welcome" />;
}

const styles = StyleSheet.create({
  placeholder: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
});
