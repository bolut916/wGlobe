import type { WmoDescriptor } from '@/types';

/**
 * WMO hava durumu kodları (Open-Meteo `weathercode`) → Türkçe açıklama + ikon.
 * Kaynak: WMO 4677 sadeleştirilmiş tablo, Open-Meteo dokümantasyonu.
 */
export const WMO_WEATHER_CODES: Readonly<Record<number, WmoDescriptor>> = {
  0: { description: 'Açık', icon: 'sun', nightIcon: 'moon' },
  1: { description: 'Çoğunlukla açık', icon: 'cloud-sun', nightIcon: 'cloud-moon' },
  2: { description: 'Parçalı bulutlu', icon: 'cloud-sun', nightIcon: 'cloud-moon' },
  3: { description: 'Kapalı', icon: 'cloud' },
  45: { description: 'Sisli', icon: 'cloud-fog' },
  48: { description: 'Kırağı yapan sis', icon: 'cloud-fog' },
  51: { description: 'Hafif çisenti', icon: 'cloud-drizzle' },
  53: { description: 'Çisenti', icon: 'cloud-drizzle' },
  55: { description: 'Yoğun çisenti', icon: 'cloud-drizzle' },
  56: { description: 'Hafif donan çisenti', icon: 'cloud-drizzle' },
  57: { description: 'Yoğun donan çisenti', icon: 'cloud-drizzle' },
  61: { description: 'Yağmurlu', icon: 'cloud-rain' },
  63: { description: 'Orta şiddetli yağmur', icon: 'cloud-rain' },
  65: { description: 'Şiddetli yağmur', icon: 'cloud-rain' },
  66: { description: 'Hafif donan yağmur', icon: 'cloud-hail' },
  67: { description: 'Şiddetli donan yağmur', icon: 'cloud-hail' },
  71: { description: 'Hafif kar yağışı', icon: 'cloud-snow' },
  73: { description: 'Kar yağışlı', icon: 'cloud-snow' },
  75: { description: 'Yoğun kar yağışı', icon: 'snowflake' },
  77: { description: 'Kar taneleri', icon: 'snowflake' },
  80: { description: 'Hafif sağanak', icon: 'cloud-rain' },
  81: { description: 'Sağanak yağış', icon: 'cloud-rain' },
  82: { description: 'Şiddetli sağanak', icon: 'cloud-rain' },
  85: { description: 'Hafif kar sağanağı', icon: 'cloud-snow' },
  86: { description: 'Yoğun kar sağanağı', icon: 'cloud-snow' },
  95: { description: 'Gök gürültülü fırtına', icon: 'cloud-lightning' },
  96: { description: 'Hafif dolulu fırtına', icon: 'cloud-hail' },
  99: { description: 'Şiddetli dolulu fırtına', icon: 'cloud-hail' },
};

export const UNKNOWN_WEATHER: WmoDescriptor = { description: 'Bilinmiyor', icon: 'cloud' };

export const WEATHER_CONFIG = {
  baseUrl: (process.env.EXPO_PUBLIC_OPEN_METEO_BASE?.trim() || 'https://api.open-meteo.com').replace(/\/+$/, ''),
  requestTimeoutMs: 8000,
  /** Open-Meteo modelleri 15 dk'da bir güncellenir; 10 dk önbellek yeterli */
  cacheTtlMs: 10 * 60 * 1000,
} as const;
