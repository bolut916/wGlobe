import type { RadioStation } from '@/types';

const envBase = process.env.EXPO_PUBLIC_RADIO_BROWSER_BASE?.trim();

/**
 * Radio Browser sunucuları. Ana sunucu yanıt vermezse sıradaki aynaya geçilir.
 * (API topluluk tarafından işletilir; tek bir sunucuya bağımlı kalmamak gerekir.)
 */
export const RADIO_BROWSER_SERVERS: readonly string[] = Array.from(
  new Set(
    [
      envBase && envBase.startsWith('https://') ? envBase.replace(/\/+$/, '') : null,
      'https://de1.api.radio-browser.info',
      'https://de2.api.radio-browser.info',
      'https://fi1.api.radio-browser.info',
    ].filter((value): value is string => Boolean(value)),
  ),
);

export const RADIO_CONFIG = {
  /** Ülke başına istenen istasyon sayısı */
  limit: 15,
  /** API isteği zaman aşımı (ms) */
  requestTimeoutMs: 7000,
  /** Bir istasyonun çalmaya başlaması için tanınan süre — aşılırsa failover (ms) */
  playbackStartTimeoutMs: 5000,
  /** Ülke istasyon listesi önbellek ömrü (ms) */
  cacheTtlMs: 10 * 60 * 1000,
  /** Radio Browser, istemcilerin kendini tanıtmasını ister */
  userAgent: 'wGlobe/1.0 (Expo; React Native)',
  /** Kabul edilen codec etiketleri → normalize edilmiş codec */
  codecAliases: {
    MP3: 'MP3',
    'MPEG': 'MP3',
    'AUDIO/MPEG': 'MP3',
    AAC: 'AAC',
    'AAC+': 'AAC',
    AACP: 'AAC',
    'HE-AAC': 'AAC',
    'AUDIO/AAC': 'AAC',
    'AUDIO/AACP': 'AAC',
  } as Readonly<Record<string, 'MP3' | 'AAC'>>,
} as const;

/**
 * Global yedek yayınlar — ülkeden hiçbir yayın alınamazsa radyo asla
 * sessiz kalmasın. Hepsi HTTPS, hepsi MP3/AAC, hepsi reklamsız ve
 * dinleyici destekli istasyonlar.
 */
export const GLOBAL_FALLBACK_STATIONS: readonly RadioStation[] = [
  {
    uuid: 'fallback-somafm-groovesalad',
    name: 'SomaFM · Groove Salad',
    streamUrl: 'https://ice1.somafm.com/groovesalad-128-mp3',
    homepage: 'https://somafm.com/groovesalad/',
    favicon: 'https://somafm.com/img/groovesalad120.png',
    countryCode: 'US',
    codec: 'MP3',
    bitrate: 128,
    tags: ['ambient', 'downtempo', 'chillout'],
    votes: 0,
    clickCount: 0,
    isFallback: true,
  },
  {
    uuid: 'fallback-radioparadise-main',
    name: 'Radio Paradise · Main Mix',
    streamUrl: 'https://stream.radioparadise.com/mp3-192',
    homepage: 'https://radioparadise.com/',
    favicon: 'https://img.radioparadise.com/source/27/channel_logo/chan_0.png',
    countryCode: 'US',
    codec: 'MP3',
    bitrate: 192,
    tags: ['eclectic', 'rock', 'world'],
    votes: 0,
    clickCount: 0,
    isFallback: true,
  },
  {
    uuid: 'fallback-somafm-secretagent',
    name: 'SomaFM · Secret Agent',
    streamUrl: 'https://ice1.somafm.com/secretagent-128-mp3',
    homepage: 'https://somafm.com/secretagent/',
    favicon: 'https://somafm.com/img/secretagent120.png',
    countryCode: 'US',
    codec: 'MP3',
    bitrate: 128,
    tags: ['lounge', 'spy', 'jazz'],
    votes: 0,
    clickCount: 0,
    isFallback: true,
  },
  {
    uuid: 'fallback-radioparadise-mellow',
    name: 'Radio Paradise · Mellow Mix',
    streamUrl: 'https://stream.radioparadise.com/mellow-192',
    homepage: 'https://radioparadise.com/',
    favicon: 'https://img.radioparadise.com/source/27/channel_logo/chan_1.png',
    countryCode: 'US',
    codec: 'MP3',
    bitrate: 192,
    tags: ['mellow', 'acoustic', 'chill'],
    votes: 0,
    clickCount: 0,
    isFallback: true,
  },
  {
    uuid: 'fallback-somafm-dronezone',
    name: 'SomaFM · Drone Zone',
    streamUrl: 'https://ice2.somafm.com/dronezone-128-mp3',
    homepage: 'https://somafm.com/dronezone/',
    favicon: 'https://somafm.com/img/dronezone120.png',
    countryCode: 'US',
    codec: 'MP3',
    bitrate: 128,
    tags: ['ambient', 'space', 'drone'],
    votes: 0,
    clickCount: 0,
    isFallback: true,
  },
  {
    uuid: 'fallback-radioparadise-aac',
    name: 'Radio Paradise · Main Mix (AAC)',
    streamUrl: 'https://stream.radioparadise.com/aac-128',
    homepage: 'https://radioparadise.com/',
    favicon: 'https://img.radioparadise.com/source/27/channel_logo/chan_0.png',
    countryCode: 'US',
    codec: 'AAC',
    bitrate: 128,
    tags: ['eclectic', 'rock', 'world'],
    votes: 0,
    clickCount: 0,
    isFallback: true,
  },
] as const;
