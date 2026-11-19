/**
 * AsyncStorage anahtarları. `isGuest` şartname gereği düz anahtar olarak
 * tutulur; diğerleri çakışmayı önlemek için `wglobe:` ön ekiyle saklanır.
 * Hassas veri (oturum belirteçleri) burada DEĞİL, SecureStore'da tutulur.
 */
export const STORAGE_KEYS = {
  isGuest: 'isGuest',
  guestFavorites: 'wglobe:guest:favorites',
  guestVisited: 'wglobe:guest:visited',
  selectedTheme: 'wglobe:theme:selected',
  unlockedThemes: 'wglobe:theme:unlocked',
  lastCityId: 'wglobe:globe:lastCityId',
  lastStationUuid: 'wglobe:radio:lastStationUuid',
  volume: 'wglobe:radio:volume',
  onboardingSeen: 'wglobe:onboarding:seen',
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

/** SecureStore'da Supabase oturumu için kullanılan anahtar ön eki */
export const SECURE_STORE_PREFIX = 'wglobe.secure';
