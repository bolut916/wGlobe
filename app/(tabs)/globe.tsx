/**
 * Küre ekranı.
 *
 * KOREOGRAFİ
 *  - Şehir seçilince: küre şehri merkeze döndürür VE kamera görünümü yukarı
 *    kayar (verticalOffset), sheet aşağıdan yükselir → şehir hiçbir an sheet'in
 *    altında kalmaz. İki hareket aynı anda başlar, farklı fiziklerle biter
 *    (küre lerp, sheet yay): tek bir "sahne değişimi" gibi okunur.
 *  - Rastgele Şehir: shuffle ikonu 320 ms'de 180° döner + orta haptik.
 *  - İpucu yazısı: boşta 1 sn sonra belirir, ilk seçimde 240 ms'de söner.
 */
import * as Haptics from 'expo-haptics';
import { Shuffle } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { InteractiveGlobe } from '@/components/InteractiveGlobe';
import { LiveRadioIndicator } from '@/components/LiveRadioIndicator';
import { PressableScale } from '@/components/PressableScale';
import { RadioAtmosphereSheet } from '@/components/RadioAtmosphereSheet';
import { CITIES, getRandomCity } from '@/constants/cities';
import { COLORS, RADII, SPACING, TYPOGRAPHY } from '@/constants/colors';
import { DURATION } from '@/constants/motion';
import { useGlobeAudio } from '@/context/GlobeAudioContext';
import { useUserData } from '@/context/UserDataContext';
import { useScreenFocus } from '@/hooks/useScreenFocus';
import { easeStandard, fadeIn, fadeOut } from '@/lib/animations';
import type { City } from '@/types';

export default function GlobeScreen() {
  const focused = useScreenFocus();
  const { selectedTheme } = useUserData();
  const { activeCity, selectCity, status, currentStation } = useGlobeAudio();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);

  const shuffleRotation = useSharedValue(0);
  const shuffleStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${shuffleRotation.value}deg` }] }));

  const handleSelect = useCallback(
    (city: City) => {
      setHasInteracted(true);
      setSheetOpen(true);
      selectCity(city);
    },
    [selectCity],
  );

  const handleShuffle = () => {
    shuffleRotation.value = withTiming(shuffleRotation.value + 180, { duration: 320, easing: easeStandard });
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    handleSelect(getRandomCity(activeCity?.id));
  };

  return (
    <View style={styles.root}>
      <InteractiveGlobe
        themeId={selectedTheme}
        cities={CITIES}
        activeCityId={activeCity?.id ?? null}
        onCitySelect={handleSelect}
        interactive
        autoRotate={!sheetOpen}
        paused={!focused}
        verticalOffset={sheetOpen ? 0.17 : 0}
      />

      <SafeAreaView style={styles.topBar} edges={['top']} pointerEvents="box-none">
        <View style={styles.topRow} pointerEvents="box-none">
          <LiveRadioIndicator
            status={status}
            stationName={currentStation?.name}
            cityName={activeCity?.name}
            onPress={activeCity ? () => setSheetOpen(true) : undefined}
          />
          <PressableScale
            onPress={handleShuffle}
            scaleTo={0.9}
            accessibilityRole="button"
            accessibilityLabel="Rastgele şehir"
            accessibilityHint="Küreyi rastgele bir şehre döndürür ve radyosunu açar"
            style={styles.shuffle}
          >
            <Animated.View style={shuffleStyle}>
              <Shuffle size={20} color={COLORS.textPrimary} />
            </Animated.View>
          </PressableScale>
        </View>
      </SafeAreaView>

      {!hasInteracted && !sheetOpen ? (
        <Animated.View entering={fadeIn(1000, DURATION.modal)} exiting={fadeOut()} style={styles.hint} pointerEvents="none">
          <Text style={styles.hintText}>Küreyi çevir · bir şehre dokun</Text>
        </Animated.View>
      ) : null}

      <RadioAtmosphereSheet visible={sheetOpen && activeCity !== null} city={activeCity} onClose={() => setSheetOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
  },
  shuffle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surfaceGlass,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  hint: {
    position: 'absolute',
    bottom: SPACING.xxl,
    alignSelf: 'center',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    borderRadius: RADII.pill,
    backgroundColor: COLORS.surfaceGlass,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  hintText: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textSecondary,
  },
});
