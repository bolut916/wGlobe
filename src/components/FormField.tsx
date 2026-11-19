/**
 * Form alanı.
 *  - Odak: brass çerçeve bir OPACITY katmanıdır (renk animasyonu yerine) → GPU dostu, 180 ms
 *  - Hata: alan yatayda kısa bir sarsıntı (200 ms, sönümlenen genlik) + mesaj yukarıdan süzülür.
 *    Sarsıntı, kullanıcının bakışını hataya çeker ama cezalandırıcı değil: 6px, tek döngü.
 *  - Şifre: göz ikonu ile göster/gizle
 */
import * as Haptics from 'expo-haptics';
import { Eye, EyeOff, type LucideIcon } from 'lucide-react-native';
import { useEffect, useState, type ComponentRef, type Ref } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { COLORS, HIT_SLOP, RADII, SPACING, TYPOGRAPHY } from '@/constants/colors';
import { DURATION } from '@/constants/motion';
import { easeStandard, fadeIn, fadeOut } from '@/lib/animations';

export interface FormFieldProps extends Omit<TextInputProps, 'style'> {
  label: string;
  error?: string;
  icon?: LucideIcon;
  /** Her artışta (gönderim denemesi) hata varsa alan sarsılır */
  shakeKey?: number;
  secureToggle?: boolean;
  ref?: Ref<ComponentRef<typeof TextInput>>;
}

export function FormField({
  label,
  error,
  icon: Icon,
  shakeKey = 0,
  secureToggle = false,
  secureTextEntry,
  onFocus,
  onBlur,
  ref,
  ...inputProps
}: FormFieldProps) {
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(Boolean(secureTextEntry));
  const shakeX = useSharedValue(0);

  useEffect(() => {
    if (!error || shakeKey === 0) return;
    const step = DURATION.shake / 5;
    shakeX.value = withSequence(
      withTiming(-6, { duration: step }),
      withTiming(6, { duration: step }),
      withTiming(-4, { duration: step }),
      withTiming(3, { duration: step }),
      withTiming(0, { duration: step }),
    );
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
    // shakeKey değişimi tetikleyicidir; error değişince tek başına sarsma
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shakeKey]);

  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shakeX.value }] }));
  const focusRingStyle = useAnimatedStyle(() => ({
    opacity: withTiming(focused ? 1 : 0, { duration: DURATION.toggle, easing: easeStandard }),
  }));

  const hasError = Boolean(error);

  return (
    <View style={styles.wrapper}>
      <Text style={styles.label}>{label}</Text>
      <Animated.View style={[styles.field, hasError && styles.fieldError, shakeStyle]}>
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, styles.focusRing, hasError && styles.focusRingError, focusRingStyle]}
        />
        {Icon ? <Icon size={18} color={focused ? COLORS.brass : COLORS.textTertiary} strokeWidth={2} /> : null}
        <TextInput
          ref={ref}
          {...inputProps}
          secureTextEntry={secureToggle ? hidden : secureTextEntry}
          placeholderTextColor={COLORS.textTertiary}
          selectionColor={COLORS.brass}
          cursorColor={COLORS.brass}
          accessibilityLabel={label}
          accessibilityHint={error}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          style={styles.input}
        />
        {secureToggle ? (
          <Pressable
            onPress={() => setHidden((value) => !value)}
            hitSlop={HIT_SLOP}
            accessibilityRole="button"
            accessibilityLabel={hidden ? 'Şifreyi göster' : 'Şifreyi gizle'}
          >
            {hidden ? <Eye size={18} color={COLORS.textTertiary} /> : <EyeOff size={18} color={COLORS.textTertiary} />}
          </Pressable>
        ) : null}
      </Animated.View>
      {hasError ? (
        <Animated.Text
          key={error}
          entering={fadeIn(0, DURATION.toggle)}
          exiting={fadeOut(DURATION.press)}
          style={styles.error}
          accessibilityLiveRegion="polite"
        >
          {error}
        </Animated.Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: SPACING.xs + 2,
  },
  label: {
    ...TYPOGRAPHY.overline,
    color: COLORS.textSecondary,
  },
  field: {
    minHeight: 52,
    borderRadius: RADII.md,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    backgroundColor: COLORS.surface,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    gap: SPACING.md,
  },
  fieldError: {
    borderColor: 'rgba(235, 87, 87, 0.55)',
  },
  focusRing: {
    borderRadius: RADII.md,
    borderWidth: 1.5,
    borderColor: COLORS.brass,
    margin: -1,
  },
  focusRingError: {
    borderColor: COLORS.error,
  },
  input: {
    flex: 1,
    ...TYPOGRAPHY.body,
    color: COLORS.textPrimary,
    paddingVertical: SPACING.md,
  },
  error: {
    ...TYPOGRAPHY.caption,
    color: COLORS.error,
  },
});

export default FormField;
