/**
 * EXPO_PUBLIC_* ortam değişkenleri — Metro bunları derleme anında satır içine gömer.
 * (`expo start` ayrıca expo-env.d.ts üretir; bu dosya CI'da tsc'nin
 * o dosya olmadan da geçmesini sağlar.)
 */
declare const process: {
  env: {
    readonly NODE_ENV?: 'development' | 'production' | 'test';
    readonly EXPO_PUBLIC_SUPABASE_URL?: string;
    readonly EXPO_PUBLIC_SUPABASE_ANON_KEY?: string;
    readonly EXPO_PUBLIC_RADIO_BROWSER_BASE?: string;
    readonly EXPO_PUBLIC_OPEN_METEO_BASE?: string;
  };
};
