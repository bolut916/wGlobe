/**
 * Karşılama ekranı.
 *
 * AÇILIŞ KOREOGRAFİSİ (toplam ≈ 1.2 sn — "perde açılıyor")
 *   0 ms     küre ilk karesini çizince 600 ms'de belirir, aynı anda
 *            scale 1.08 → 1 ile 1.2 sn'de yerine oturur (kamera "nefes verir")
 *   250 ms   üst başlık "DÜNYAYI DİNLE"
 *   330 ms   logo "wGlobe"
 *   450 ms   slogan
 *   650 ms   + 70 ms arayla 3 buton (birincil eylem önce: misafir — sürtünmesiz giriş)
 * Hero (küre) → kimlik (logo) → vaat (slogan) → eylem (butonlar).
 */
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Compass, LogIn, UserPlus } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { InteractiveGlobe } from '@/components/InteractiveGlobe';
import { COLORS, SPACING, TYPOGRAPHY } from '@/constants/colors';
import { DURATION, STAGGER } from '@/constants/motion';
import { useAuth } from '@/context/AuthContext';
import { easeEnter, enterUp } from '@/lib/animations';

export default function WelcomeScreen() {
  const { continueAsGuest } = useAuth();
  const [isStartingGuest, setIsStartingGuest] = useState(false);

  const globeScale = useSharedValue(1.08);
  useEffect(() => {
    globeScale.value = withTiming(1, { duration: DURATION.intro, easing: easeEnter });
  }, [globeScale]);
  const globeStyle = useAnimatedStyle(() => ({ transform: [{ scale: globeScale.value }] }));

  const handleGuest = async () => {
    setIsStartingGuest(true);
    try {
      await continueAsGuest();
      router.replace('/(tabs)/globe');
    } finally {
      setIsStartingGuest(false);
    }
  };

  const buttonBase = 650;

  return (
    <View style={styles.root}>
      <Animated.View style={[styles.globe, globeStyle]}>
        <InteractiveGlobe themeId="classic" interactive={false} autoRotate showMarkers cameraDistance={2.9} verticalOffset={0.12} />
      </Animated.View>

      <LinearGradient
        pointerEvents="none"
        colors={['rgba(7,9,15,0)', 'rgba(7,9,15,0.55)', COLORS.background]}
        locations={[0.25, 0.55, 0.82]}
        style={StyleSheet.absoluteFill}
      />

      <SafeAreaView style={styles.content} edges={['bottom']}>
        <View style={styles.brand}>
          <Animated.Text entering={enterUp(0, { base: 250 })} style={styles.overline}>
            DÜNYAYI DİNLE
          </Animated.Text>
          <Animated.Text
            entering={enterUp(0, { base: 330, duration: 450 })}
            style={styles.logo}
            accessibilityRole="header"
          >
            w<Text style={styles.logoAccent}>Globe</Text>
          </Animated.Text>
          <Animated.Text entering={enterUp(0, { base: 450 })} style={styles.tagline}>
            Küreyi çevir, bir şehre dokun.{'\n'}O an orada çalan canlı radyoyu dinle.
          </Animated.Text>
        </View>

        <View style={styles.actions}>
          <Animated.View entering={enterUp(0, { base: buttonBase, step: STAGGER.card })}>
            <Button
              label="Misafir Olarak Devam Et"
              icon={Compass}
              onPress={handleGuest}
              loading={isStartingGuest}
              accessibilityHint="Hesap oluşturmadan küreyi keşfetmeye başlar"
            />
          </Animated.View>
          <Animated.View entering={enterUp(1, { base: buttonBase, step: STAGGER.card })}>
            <Button label="Giriş Yap" icon={LogIn} variant="secondary" onPress={() => router.push('/(auth)/login')} />
          </Animated.View>
          <Animated.View entering={enterUp(2, { base: buttonBase, step: STAGGER.card })}>
            <Button label="Üye Ol" icon={UserPlus} variant="ghost" onPress={() => router.push('/(auth)/register')} />
          </Animated.View>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  globe: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  content: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: SPACING.xl,
    paddingBottom: SPACING.lg,
    gap: SPACING.xxl,
  },
  brand: {
    gap: SPACING.sm,
  },
  overline: {
    ...TYPOGRAPHY.overline,
    color: COLORS.brass,
  },
  logo: {
    fontSize: 56,
    lineHeight: 60,
    fontWeight: '800',
    letterSpacing: -2,
    color: COLORS.textPrimary,
  },
  logoAccent: {
    color: COLORS.brass,
  },
  tagline: {
    ...TYPOGRAPHY.body,
    color: COLORS.textSecondary,
  },
  actions: {
    gap: SPACING.md,
  },
});
