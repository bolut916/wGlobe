/**
 * wGlobe görsel kimlik token'ları.
 * Palet: gece mavisi zemin + pirinç (#C89D54) vurgu — "eski bir seyahat
 * radyosunun kadranı" hissi. Tüm UI renkleri buradan okunur.
 */
export const COLORS = {
  // Zemin katmanları (derinlik sırası: bg → surface → elevated)
  background: '#07090F',
  backgroundAlt: '#0B0F19',
  surface: '#111726',
  surfaceElevated: '#18203A',
  surfaceGlass: 'rgba(17, 23, 38, 0.72)',
  overlay: 'rgba(4, 6, 12, 0.6)',

  // Vurgu
  brass: '#C89D54',
  brassLight: '#E2C285',
  brassDark: '#9C7638',
  brassGlow: 'rgba(200, 157, 84, 0.35)',
  brassMuted: 'rgba(200, 157, 84, 0.14)',

  // Metin
  textPrimary: '#F4EFE6',
  textSecondary: '#B7B2A8',
  textTertiary: '#7D7A74',
  textInverse: '#07090F',

  // Çizgiler
  border: 'rgba(244, 239, 230, 0.08)',
  borderStrong: 'rgba(244, 239, 230, 0.16)',
  borderBrass: 'rgba(200, 157, 84, 0.45)',

  // Durum geri bildirimi
  success: '#6FCF97',
  successMuted: 'rgba(111, 207, 151, 0.14)',
  warning: '#F2C94C',
  error: '#EB5757',
  errorMuted: 'rgba(235, 87, 87, 0.14)',
  live: '#FF4D4F',
  info: '#7FA7E8',

  transparent: 'transparent',
} as const;

export type ColorToken = keyof typeof COLORS;

export const SPACING = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const RADII = {
  sm: 8,
  md: 12,
  lg: 18,
  xl: 24,
  sheet: 28,
  pill: 999,
} as const;

export const TYPOGRAPHY = {
  display: { fontSize: 40, lineHeight: 44, fontWeight: '700', letterSpacing: -1 },
  title: { fontSize: 28, lineHeight: 34, fontWeight: '700', letterSpacing: -0.5 },
  heading: { fontSize: 20, lineHeight: 26, fontWeight: '600', letterSpacing: -0.2 },
  body: { fontSize: 16, lineHeight: 22, fontWeight: '400', letterSpacing: 0 },
  bodyStrong: { fontSize: 16, lineHeight: 22, fontWeight: '600', letterSpacing: 0 },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '500', letterSpacing: 0.2 },
  overline: { fontSize: 11, lineHeight: 14, fontWeight: '700', letterSpacing: 1.6 },
  mono: { fontSize: 15, lineHeight: 20, fontWeight: '500', letterSpacing: 0.5, fontVariant: ['tabular-nums'] },
} as const;

/** 44pt minimum dokunma hedefi (Apple HIG / Material 48dp ile uyumlu) */
export const HIT_SLOP = { top: 10, bottom: 10, left: 10, right: 10 } as const;
export const MIN_TOUCH_TARGET = 44;
