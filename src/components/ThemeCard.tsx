/**
 * Küre materyali kartı. Seçili çerçeve bir opacity katmanıdır (180 ms);
 * kilit rozeti, kilit açıldığında yay ile küçülüp kaybolur.
 */
import { LinearGradient } from 'expo-linear-gradient';
import { Check, Lock } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, withSpring, withTiming } from 'react-native-reanimated';

import { COLORS, RADII, SPACING, TYPOGRAPHY } from '@/constants/colors';
import { DURATION, SPRING } from '@/constants/motion';
import { easeStandard } from '@/lib/animations';
import type { GlobeTheme } from '@/types';

import { PressableScale } from './PressableScale';

interface ThemeCardProps {
  theme: GlobeTheme;
  isPreviewing: boolean;
  isSelected: boolean;
  isUnlocked: boolean;
  onPress: () => void;
}

export function ThemeCard({ theme, isPreviewing, isSelected, isUnlocked, onPress }: ThemeCardProps) {
  const ringStyle = useAnimatedStyle(() => ({
    opacity: withTiming(isPreviewing ? 1 : 0, { duration: DURATION.toggle, easing: easeStandard }),
  }));
  const lockStyle = useAnimatedStyle(() => ({
    opacity: withTiming(isUnlocked ? 0 : 1, { duration: DURATION.toggle }),
    transform: [{ scale: withSpring(isUnlocked ? 0.4 : 1, SPRING.pop) }],
  }));
  const status = isSelected ? 'Kullanılıyor' : isUnlocked ? (theme.isPremium ? 'Açık' : 'Ücretsiz') : 'Kilitli';

  return (
    <PressableScale
      onPress={onPress}
      haptic="selection"
      accessibilityRole="button"
      accessibilityLabel={`${theme.name} teması, ${status}`}
      accessibilityState={{ selected: isPreviewing }}
      style={styles.card}
    >
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.ring, ringStyle]} />
      <View style={styles.preview}>
        <LinearGradient
          colors={theme.previewGradient}
          start={{ x: 0.15, y: 0.1 }}
          end={{ x: 0.9, y: 1 }}
          style={styles.sphere}
        />
        <View style={[styles.equator, { backgroundColor: theme.palette.equator }]} />
        <View style={[styles.meridian, { borderColor: theme.palette.grid }]} />
        <Animated.View style={[styles.lockBadge, lockStyle]}>
          <Lock size={12} color={COLORS.textPrimary} />
        </Animated.View>
      </View>
      <View style={styles.texts}>
        <View style={styles.titleRow}>
          <Text style={styles.name}>{theme.name}</Text>
          {isSelected ? <Check size={16} color={COLORS.brass} strokeWidth={2.5} /> : null}
        </View>
        <Text style={styles.description} numberOfLines={2}>
          {theme.description}
        </Text>
        <Text style={[styles.status, !isUnlocked && styles.statusLocked]}>{status.toLocaleUpperCase('tr-TR')}</Text>
      </View>
    </PressableScale>
  );
}

const SPHERE = 64;

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.lg,
    padding: SPACING.lg,
    borderRadius: RADII.lg,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  ring: {
    borderRadius: RADII.lg,
    borderWidth: 1.5,
    borderColor: COLORS.brass,
    margin: -1,
  },
  preview: {
    width: SPHERE,
    height: SPHERE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sphere: {
    width: SPHERE,
    height: SPHERE,
    borderRadius: SPHERE / 2,
  },
  equator: {
    position: 'absolute',
    width: SPHERE,
    height: 1.5,
    opacity: 0.9,
  },
  meridian: {
    position: 'absolute',
    width: SPHERE * 0.5,
    height: SPHERE,
    borderRadius: SPHERE / 2,
    borderWidth: 1,
    opacity: 0.45,
  },
  lockBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surfaceElevated,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
  },
  texts: {
    flex: 1,
    gap: 3,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  name: {
    ...TYPOGRAPHY.bodyStrong,
    color: COLORS.textPrimary,
  },
  description: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textSecondary,
  },
  status: {
    ...TYPOGRAPHY.overline,
    color: COLORS.brass,
    marginTop: 2,
  },
  statusLocked: {
    color: COLORS.textTertiary,
  },
});

export default ThemeCard;
