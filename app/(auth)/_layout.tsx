import { Redirect, Stack } from 'expo-router';

import { COLORS } from '@/constants/colors';
import { DURATION } from '@/constants/motion';
import { useAuth } from '@/context/AuthContext';

export default function AuthLayout() {
  const { mode } = useAuth();

  // Üye zaten giriş yaptıysa auth ekranlarının anlamı yok.
  // Misafir burada kalabilir: "Hesap Oluştur ve Verilerini Eşitle" akışı buradan geçer.
  if (mode === 'authenticated') {
    return <Redirect href="/(tabs)/globe" />;
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: COLORS.background },
        animation: 'slide_from_right',
        animationDuration: DURATION.page,
      }}
    >
      <Stack.Screen name="welcome" options={{ animation: 'fade' }} />
      <Stack.Screen name="login" />
      <Stack.Screen name="register" />
    </Stack>
  );
}
