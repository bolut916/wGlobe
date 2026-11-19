/**
 * Reanimated ön ayarları — motion.ts token'larının Reanimated karşılıkları.
 * Ekranlar süre/eğri yazmaz; buradaki fabrikaları kullanır.
 */
import { Easing, FadeIn, FadeInDown, FadeOut } from 'react-native-reanimated';

import { DURATION, EASING, STAGGER } from '@/constants/motion';

export const easeStandard = Easing.bezier(...EASING.standard);
export const easeEnter = Easing.bezier(...EASING.enter);
export const easeExit = Easing.bezier(...EASING.exit);
export const easeInOut = Easing.bezier(...EASING.inOut);
export const easePress = Easing.bezier(...EASING.press);

/** Stagger gecikmesi; STAGGER.maxItems'tan sonrası beklemez (uzun listelerde gecikme birikmesin) */
export function staggerDelay(index: number, step: number = STAGGER.list, base = 0): number {
  return base + Math.min(index, STAGGER.maxItems) * step;
}

/**
 * Aşağıdan yukarı süzülerek giriş. 25px yerine 12px: UI öğeleri "zıplamaz",
 * yerine oturur. Süre kart katmanında (280ms), enter eğrisiyle.
 */
export function enterUp(index = 0, options: { base?: number; step?: number; duration?: number } = {}) {
  return FadeInDown.delay(staggerDelay(index, options.step ?? STAGGER.list, options.base ?? 0))
    .duration(options.duration ?? DURATION.card)
    .easing(easeEnter)
    .withInitialValues({ opacity: 0, transform: [{ translateY: 12 }] });
}

export function fadeIn(delay = 0, duration: number = DURATION.card) {
  return FadeIn.delay(delay).duration(duration).easing(easeEnter);
}

export function fadeOut(duration: number = DURATION.sheetClose) {
  return FadeOut.duration(duration).easing(easeExit);
}

/** JS tarafı için (Three.js render döngüsü) */
export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

export function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}
