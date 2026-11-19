/**
 * Tüm dokunulabilir yüzeylerin temeli.
 *  - Basış: 100 ms, scale → 0.96 (anticipation: "bastım" hissi gecikmesiz)
 *  - Bırakış: yay (spring) ile 1'e — küçük overshoot = follow-through
 * Yalnızca transform animasyonu; layout tetiklenmez.
 */
import * as Haptics from 'expo-haptics';
import type { ReactNode } from 'react';
import { Pressable, type GestureResponderEvent, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

import { HIT_SLOP } from '@/constants/colors';
import { DURATION, SPRING } from '@/constants/motion';
import { easePress } from '@/lib/animations';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export interface PressableScaleProps extends Omit<PressableProps, 'style' | 'children'> {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  scaleTo?: number;
  haptic?: 'selection' | 'light' | 'medium' | false;
}

export function PressableScale({
  children,
  style,
  scaleTo = 0.96,
  haptic = false,
  onPressIn,
  onPressOut,
  onPress,
  disabled,
  hitSlop = HIT_SLOP,
  ...rest
}: PressableScaleProps) {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const handlePressIn = (event: GestureResponderEvent) => {
    scale.value = withTiming(scaleTo, { duration: DURATION.press, easing: easePress });
    onPressIn?.(event);
  };

  const handlePressOut = (event: GestureResponderEvent) => {
    scale.value = withSpring(1, SPRING.button);
    onPressOut?.(event);
  };

  const handlePress = (event: GestureResponderEvent) => {
    if (haptic === 'selection') void Haptics.selectionAsync().catch(() => undefined);
    else if (haptic === 'light') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    else if (haptic === 'medium') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    onPress?.(event);
  };

  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      hitSlop={hitSlop}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={handlePress}
      style={[style, animatedStyle]}
    >
      {children}
    </AnimatedPressable>
  );
}

export default PressableScale;
