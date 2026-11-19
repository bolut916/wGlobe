import type { GlobeTheme, GlobeThemeId } from '@/types';

/**
 * Dört küre materyali. Her tema prosedürel GLSL shader'ına uniform olarak
 * beslenir; geometri ve sahne değişmez, sadece "malzeme" değişir.
 */
export const GLOBE_THEMES: Readonly<Record<GlobeThemeId, GlobeTheme>> = {
  classic: {
    id: 'classic',
    name: 'Klasik',
    description: 'Derin lacivert okyanuslar ve pirinç meridyenler. Yolculuğun başladığı küre.',
    isPremium: false,
    markerColor: '#C89D54',
    previewGradient: ['#0B1A33', '#143A63', '#C89D54'],
    palette: {
      oceanDeep: '#061226',
      oceanShallow: '#16406E',
      grid: '#C89D54',
      equator: '#E2C285',
      night: '#02050C',
      nightGlow: '#F5C46B',
      atmosphere: '#5FA8FF',
      background: '#07090F',
      gridOpacity: 0.28,
      gridSpacingDeg: 15,
      nightStrength: 0.78,
      nightGlowStrength: 0.12,
      atmosphereStrength: 0.55,
      terminatorSoftness: 0.18,
    },
  },
  parchment: {
    id: 'parchment',
    name: 'Parşömen',
    description: 'Eski bir kâşifin haritası: sepya mürekkep, solgun kâğıt, mum ışığı gecesi.',
    isPremium: true,
    markerColor: '#8C3B1F',
    previewGradient: ['#E9DBBE', '#C9B08A', '#6B4A2B'],
    palette: {
      oceanDeep: '#B89D72',
      oceanShallow: '#EADCBF',
      grid: '#5C3D22',
      equator: '#8C3B1F',
      night: '#3A2816',
      nightGlow: '#FFB45E',
      atmosphere: '#F3E2BF',
      background: '#1A130C',
      gridOpacity: 0.42,
      gridSpacingDeg: 10,
      nightStrength: 0.55,
      nightGlowStrength: 0.08,
      atmosphereStrength: 0.35,
      terminatorSoftness: 0.28,
    },
  },
  night_lights: {
    id: 'night_lights',
    name: 'Gece Işıkları',
    description: 'Uzaydan bakan bir astronotun gözü: gece tarafında şehirler kehribar gibi parlar.',
    isPremium: true,
    markerColor: '#FFD27A',
    previewGradient: ['#010208', '#0A1430', '#FFB547'],
    palette: {
      oceanDeep: '#010309',
      oceanShallow: '#0A1A3A',
      grid: '#3D5A99',
      equator: '#FFB547',
      night: '#000105',
      nightGlow: '#FFB547',
      atmosphere: '#3B7BFF',
      background: '#000004',
      gridOpacity: 0.16,
      gridSpacingDeg: 20,
      nightStrength: 0.92,
      nightGlowStrength: 0.7,
      atmosphereStrength: 0.85,
      terminatorSoftness: 0.1,
    },
  },
  swiss_minimal: {
    id: 'swiss_minimal',
    name: 'İsviçre Minimal',
    description: 'Grid, kontrast, kırmızı ekvator. Gereksiz hiçbir şey yok.',
    isPremium: true,
    markerColor: '#E30613',
    previewGradient: ['#F5F5F2', '#D9D9D4', '#E30613'],
    palette: {
      oceanDeep: '#CFCFCA',
      oceanShallow: '#F7F7F4',
      grid: '#111111',
      equator: '#E30613',
      night: '#8A8A86',
      nightGlow: '#FFFFFF',
      atmosphere: '#FFFFFF',
      background: '#EDEDE8',
      gridOpacity: 0.5,
      gridSpacingDeg: 15,
      nightStrength: 0.35,
      nightGlowStrength: 0,
      atmosphereStrength: 0.15,
      terminatorSoftness: 0.02,
    },
  },
};

export const THEME_ORDER: readonly GlobeThemeId[] = ['classic', 'parchment', 'night_lights', 'swiss_minimal'];

export const DEFAULT_THEME_ID: GlobeThemeId = 'classic';

/** Ücretsiz olarak açık gelen temalar */
export const FREE_THEME_IDS: readonly GlobeThemeId[] = THEME_ORDER.filter((id) => !GLOBE_THEMES[id].isPremium);

export function isGlobeThemeId(value: unknown): value is GlobeThemeId {
  return typeof value === 'string' && (THEME_ORDER as readonly string[]).includes(value);
}

export function getGlobeTheme(id: GlobeThemeId | null | undefined): GlobeTheme {
  return id && isGlobeThemeId(id) ? GLOBE_THEMES[id] : GLOBE_THEMES[DEFAULT_THEME_ID];
}

/** "#RRGGBB" → [r, g, b] (0–1), GLSL vec3 uniform'ları için */
export function hexToRgbNormalized(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const value = Number.parseInt(full, 16);
  if (Number.isNaN(value) || full.length !== 6) {
    return [1, 1, 1];
  }
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}
