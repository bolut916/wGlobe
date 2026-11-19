/**
 * Uyku Zamanlayıcısı — 15 / 30 / 60 dk. Son 30 sn'de ses yavaşça kısılır.
 * İlerleme çubuğu scaleX ile küçülür (transformOrigin: left) — width animasyonu yok.
 */
import { Moon, Timer, X } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, withTiming } from 'react-native-reanimated';

import { COLORS, RADII, SPACING, TYPOGRAPHY } from '@/constants/colors';
import { DURATION } from '@/constants/motion';
import { useGlobeAudio } from '@/context/GlobeAudioContext';
import { easeStandard } from '@/lib/animations';
import { formatCountdown } from '@/lib/time';
import type { SleepTimerMinutes } from '@/types';

import { PressableScale } from './PressableScale';

const OPTIONS: SleepTimerMinutes[] = [15, 30, 60];

export function SleepTimerCard() {
  const { sleepTimer, setSleepTimer, cancelSleepTimer, isPlaying } = useGlobeAudio();
  const active = sleepTimer.minutes !== null;
  const progress = active && sleepTimer.minutes ? sleepTimer.remainingMs / (sleepTimer.minutes * 60_000) : 0;

  const barStyle = useAnimatedStyle(() => ({
    // Her saniye lineer akar: zaman lineerdir, eğri sahte bir hızlanma hissi verirdi
    transform: [{ scaleX: withTiming(Math.max(0, Math.min(1, progress)), { duration: 1000, easing: Easing.linear }) }],
  }));
  const cancelStyle = useAnimatedStyle(() => ({
    opacity: withTiming(active ? 1 : 0, { duration: DURATION.toggle, easing: easeStandard }),
    transform: [{ scale: withTiming(active ? 1 : 0.8, { duration: DURATION.toggle, easing: easeStandard }) }],
  }));

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.iconWrap}>
          {sleepTimer.isFading ? <Moon size={18} color={COLORS.brass} /> : <Timer size={18} color={COLORS.brass} />}
        </View>
        <View style={styles.texts}>
          <Text style={styles.title}>Uyku Zamanlayıcısı</Text>
          <Text style={styles.caption}>
            {active
              ? sleepTimer.isFading
                ? 'Ses yavaşça kısılıyor…'
                : 'Süre dolunca radyo yumuşakça susar.'
              : isPlaying
                ? 'Radyoyu belirli bir süre sonra kapat.'
                : 'Radyo çalarken de, önceden de kurabilirsin.'}
          </Text>
        </View>
        <Animated.View style={cancelStyle} pointerEvents={active ? 'auto' : 'none'}>
          <PressableScale
            onPress={cancelSleepTimer}
            haptic="selection"
            accessibilityRole="button"
            accessibilityLabel="Zamanlayıcıyı iptal et"
            style={styles.cancel}
          >
            <X size={16} color={COLORS.textSecondary} />
          </PressableScale>
        </Animated.View>
      </View>

      {active ? (
        <View style={styles.countdownRow}>
          <Text style={styles.countdown} accessibilityLabel={`Kalan süre ${formatCountdown(sleepTimer.remainingMs)}`}>
            {formatCountdown(sleepTimer.remainingMs)}
          </Text>
          <View style={styles.track}>
            <Animated.View style={[styles.bar, barStyle]} />
          </View>
        </View>
      ) : null}

      <View style={styles.options}>
        {OPTIONS.map((minutes) => {
          const selected = sleepTimer.minutes === minutes;
          return (
            <PressableScale
              key={minutes}
              onPress={() => setSleepTimer(minutes)}
              haptic="light"
              accessibilityRole="button"
              accessibilityLabel={`${minutes} dakika`}
              accessibilityState={{ selected }}
              style={[styles.option, selected && styles.optionSelected]}
            >
              <Text style={[styles.optionText, selected && styles.optionTextSelected]}>{minutes} dk</Text>
            </PressableScale>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: SPACING.lg,
    borderRadius: RADII.lg,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: SPACING.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.brassMuted,
  },
  texts: {
    flex: 1,
    gap: 2,
  },
  title: {
    ...TYPOGRAPHY.bodyStrong,
    color: COLORS.textPrimary,
  },
  caption: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textSecondary,
  },
  cancel: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surfaceElevated,
  },
  countdownRow: {
    gap: SPACING.sm,
  },
  countdown: {
    ...TYPOGRAPHY.mono,
    fontSize: 28,
    lineHeight: 34,
    color: COLORS.textPrimary,
  },
  track: {
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.surfaceElevated,
    overflow: 'hidden',
  },
  bar: {
    height: 4,
    width: '100%',
    borderRadius: 2,
    backgroundColor: COLORS.brass,
    transformOrigin: 'left',
  },
  options: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  option: {
    flex: 1,
    minHeight: 44,
    borderRadius: RADII.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
  },
  optionSelected: {
    backgroundColor: COLORS.brass,
    borderColor: COLORS.brass,
  },
  optionText: {
    ...TYPOGRAPHY.bodyStrong,
    color: COLORS.textPrimary,
  },
  optionTextSelected: {
    color: COLORS.textInverse,
  },
});

export default SleepTimerCard;
