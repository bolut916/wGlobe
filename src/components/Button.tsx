/**
 * Birincil eylem butonu. Loading durumunda etiket ile spinner arasında
 * 180 ms çapraz geçiş — buton boyutu ASLA değişmez (layout zıplaması yok).
 */
import type { LucideIcon } from 'lucide-react-native';
import { ActivityIndicator, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';

import { COLORS, MIN_TOUCH_TARGET, RADII, SPACING, TYPOGRAPHY } from '@/constants/colors';
import { DURATION } from '@/constants/motion';
import { easeStandard } from '@/lib/animations';

import { PressableScale } from './PressableScale';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  icon?: LucideIcon;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
}

const VARIANTS: Record<ButtonVariant, { background: string; text: string; border: string }> = {
  primary: { background: COLORS.brass, text: COLORS.textInverse, border: COLORS.brass },
  secondary: { background: COLORS.surfaceGlass, text: COLORS.textPrimary, border: COLORS.borderStrong },
  ghost: { background: COLORS.transparent, text: COLORS.textSecondary, border: COLORS.transparent },
  danger: { background: COLORS.errorMuted, text: COLORS.error, border: 'rgba(235, 87, 87, 0.35)' },
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  icon: Icon,
  loading = false,
  disabled = false,
  style,
  accessibilityHint,
}: ButtonProps) {
  const palette = VARIANTS[variant];
  const isDisabled = disabled || loading;

  const labelStyle = useAnimatedStyle(() => ({
    opacity: withTiming(loading ? 0 : 1, { duration: DURATION.toggle, easing: easeStandard }),
    transform: [{ scale: withTiming(loading ? 0.94 : 1, { duration: DURATION.toggle, easing: easeStandard }) }],
  }));
  const spinnerStyle = useAnimatedStyle(() => ({
    opacity: withTiming(loading ? 1 : 0, { duration: DURATION.toggle, easing: easeStandard }),
  }));

  return (
    <PressableScale
      onPress={onPress}
      disabled={isDisabled}
      haptic={variant === 'primary' ? 'light' : 'selection'}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      style={[
        styles.base,
        { backgroundColor: palette.background, borderColor: palette.border, opacity: disabled && !loading ? 0.5 : 1 },
        style,
      ]}
    >
      <Animated.View style={[styles.content, labelStyle]}>
        {Icon ? <Icon size={18} color={palette.text} strokeWidth={2.2} /> : null}
        <Text style={[styles.label, { color: palette.text }]} numberOfLines={1}>
          {label}
        </Text>
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, styles.spinner, spinnerStyle]} pointerEvents="none">
        <ActivityIndicator color={palette.text} />
      </Animated.View>
      <View />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: MIN_TOUCH_TARGET + 8,
    borderRadius: RADII.pill,
    borderWidth: 1,
    paddingHorizontal: SPACING.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  label: {
    ...TYPOGRAPHY.bodyStrong,
  },
  spinner: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default Button;
