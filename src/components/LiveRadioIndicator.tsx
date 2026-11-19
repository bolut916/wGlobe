/**
 * Sol üst canlı radyo göstergesi — durum bir bakışta okunmalı:
 *   playing   → kırmızı nefes alan nokta + "CANLI" + 3 çubuklu ekolayzer
 *   loading   → pirinç nokta yavaş yanıp söner + "Bağlanıyor"
 *   failover  → pirinç nokta + "Sıradaki yayın"
 *   error     → gri nokta + "Yayın yok"
 *   idle/paused → sönük nokta + şehir adı
 * Döngüler yalnızca opacity/scale (transform) üzerinde; layout değişmez.
 */
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { COLORS, RADII, SPACING, TYPOGRAPHY } from '@/constants/colors';
import { DURATION } from '@/constants/motion';
import { easeInOut } from '@/lib/animations';
import type { PlaybackStatus } from '@/types';

import { PressableScale } from './PressableScale';

interface LiveRadioIndicatorProps {
  status: PlaybackStatus;
  stationName?: string | null;
  cityName?: string | null;
  onPress?: () => void;
}

const LABELS: Record<PlaybackStatus, string> = {
  idle: 'Radyo kapalı',
  paused: 'Duraklatıldı',
  loading: 'Bağlanıyor',
  failover: 'Sıradaki yayın',
  playing: 'CANLI',
  error: 'Yayın yok',
};

function EqualizerBar({ active, duration, delay }: { active: boolean; duration: number; delay: number }) {
  const scale = useSharedValue(0.35);
  useEffect(() => {
    if (active) {
      scale.value = withRepeat(
        withSequence(
          withTiming(1, { duration: duration / 2, easing: easeInOut }),
          withTiming(0.3 + (delay % 3) * 0.1, { duration: duration / 2, easing: easeInOut }),
        ),
        -1,
        true,
      );
    } else {
      cancelAnimation(scale);
      scale.value = withTiming(0.35, { duration: DURATION.toggle });
    }
  }, [active, duration, delay, scale]);
  const style = useAnimatedStyle(() => ({ transform: [{ scaleY: scale.value }] }));
  return <Animated.View style={[styles.bar, style]} />;
}

export function LiveRadioIndicator({ status, stationName, cityName, onPress }: LiveRadioIndicatorProps) {
  const pulse = useSharedValue(1);
  const isPlaying = status === 'playing';
  const isBusy = status === 'loading' || status === 'failover';

  useEffect(() => {
    if (isPlaying || isBusy) {
      pulse.value = withRepeat(
        withTiming(isBusy ? 0.25 : 0.45, { duration: isBusy ? DURATION.breathe / 2 : DURATION.breathe, easing: easeInOut }),
        -1,
        true,
      );
    } else {
      cancelAnimation(pulse);
      pulse.value = withTiming(1, { duration: DURATION.toggle });
    }
  }, [isPlaying, isBusy, pulse]);

  const dotStyle = useAnimatedStyle(() => ({ opacity: pulse.value, transform: [{ scale: 0.85 + pulse.value * 0.15 }] }));

  const dotColor = isPlaying ? COLORS.live : isBusy ? COLORS.brass : status === 'error' ? COLORS.textTertiary : COLORS.textTertiary;
  const subtitle = isPlaying || isBusy ? stationName : cityName;

  return (
    <PressableScale
      onPress={onPress}
      disabled={!onPress}
      haptic="selection"
      accessibilityRole="button"
      accessibilityLabel={`Radyo durumu: ${LABELS[status]}${subtitle ? `, ${subtitle}` : ''}`}
      style={styles.container}
    >
      <Animated.View style={[styles.dot, { backgroundColor: dotColor }, dotStyle]} />
      <View style={styles.texts}>
        <Text style={[styles.label, isPlaying && styles.labelLive]} numberOfLines={1}>
          {LABELS[status]}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {isPlaying ? (
        <View style={styles.equalizer}>
          <EqualizerBar active duration={620} delay={0} />
          <EqualizerBar active duration={480} delay={1} />
          <EqualizerBar active duration={720} delay={2} />
        </View>
      ) : null}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    borderRadius: RADII.pill,
    backgroundColor: COLORS.surfaceGlass,
    borderWidth: 1,
    borderColor: COLORS.border,
    maxWidth: 220,
    minHeight: 44,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  texts: {
    flexShrink: 1,
  },
  label: {
    ...TYPOGRAPHY.overline,
    color: COLORS.textSecondary,
  },
  labelLive: {
    color: COLORS.textPrimary,
  },
  subtitle: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textPrimary,
    maxWidth: 150,
  },
  equalizer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
    height: 14,
  },
  bar: {
    width: 3,
    height: 14,
    borderRadius: 1.5,
    backgroundColor: COLORS.brass,
    transformOrigin: 'bottom',
  },
});

export default LiveRadioIndicator;
