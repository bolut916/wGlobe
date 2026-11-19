import type { LucideIcon } from 'lucide-react-native';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { COLORS, MIN_TOUCH_TARGET } from '@/constants/colors';

import { PressableScale } from './PressableScale';

export interface IconButtonProps {
  icon: LucideIcon;
  onPress: () => void;
  accessibilityLabel: string;
  size?: number;
  color?: string;
  variant?: 'glass' | 'brass' | 'plain';
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  fill?: string;
}

/** 44pt minimum dokunma hedefli yuvarlak ikon butonu */
export function IconButton({
  icon: Icon,
  onPress,
  accessibilityLabel,
  size = 20,
  color,
  variant = 'glass',
  style,
  disabled,
  fill,
}: IconButtonProps) {
  const background =
    variant === 'brass' ? COLORS.brass : variant === 'glass' ? COLORS.surfaceGlass : COLORS.transparent;
  const iconColor = color ?? (variant === 'brass' ? COLORS.textInverse : COLORS.textPrimary);
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      haptic="selection"
      scaleTo={0.9}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={[
        styles.base,
        { backgroundColor: background, borderColor: variant === 'glass' ? COLORS.border : COLORS.transparent },
        disabled ? styles.disabled : null,
        style,
      ]}
    >
      <Icon size={size} color={iconColor} fill={fill ?? 'transparent'} strokeWidth={2} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  base: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    borderRadius: MIN_TOUCH_TARGET / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  disabled: {
    opacity: 0.4,
  },
});

export default IconButton;
