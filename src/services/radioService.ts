/**
 * Radio Browser servis katmanı.
 *
 * Sorumluluk ayrımı:
 *  - Bu dosya: istasyon KEŞFİ (API, filtreleme, normalize, önbellek, ayna sunucular).
 *  - GlobeAudioContext (Bölüm 3): istasyon ÇALMA (5 sn zaman aşımı, failover,
 *    global yedeğe düşme). Sıra `buildPlaybackQueue` ile hazırlanır.
 */
import { GLOBAL_FALLBACK_STATIONS, RADIO_BROWSER_SERVERS, RADIO_CONFIG } from '@/constants/radio';
import { fetchJson, isAbortError } from '@/lib/http';
import type { PlaybackQueue, RadioBrowserStation, RadioStation, SupportedCodec } from '@/types';

interface CacheEntry {
  stations: RadioStation[];
  expiresAt: number;
}

const stationCache = new Map<string, CacheEntry>();
const inflightRequests = new Map<string, Promise<RadioStation[]>>();

/** Son başarılı yanıt veren sunucu; sonraki istekler önce ona gider (yapışkan ayna). */
let preferredServerIndex = 0;

// ─────────────────────────────────────────────────────────────
//  Filtreleme & normalize
// ─────────────────────────────────────────────────────────────

export function normalizeCodec(codec: string | null | undefined): SupportedCodec | null {
  if (!codec) return null;
  const key = codec.trim().toUpperCase();
  // "MP3,H.264" gibi birleşik etiketlerde ilk ses codec'ine bak
  const primary = key.split(/[,;/ ]+/)[0] ?? key;
  return RADIO_CONFIG.codecAliases[key] ?? RADIO_CONFIG.codecAliases[primary] ?? null;
}

function pickStreamUrl(raw: RadioBrowserStation): string | null {
  const candidates = [raw.url_resolved, raw.url].map((value) => value?.trim()).filter(Boolean) as string[];
  return candidates.find((value) => value.toLowerCase().startsWith('https://')) ?? null;
}

/**
 * Şartname filtreleri:
 *  1. Akış URL'si https:// ile başlamalı (ATS / cleartext kapalı)
 *  2. lastcheckok === 1 (Radio Browser'ın son sağlık kontrolü başarılı)
 *  3. Codec MP3 veya AAC (expo-audio'nun iki platformda da güvenle çaldığı formatlar)
 * Ek güvenlik:
 *  4. ssl_error yok — sertifika hatalı akış iOS'ta sessizce takılır
 *  5. HLS değil — HLS manifestleri ayrı bir oynatma yolu gerektirir; tutarlılık için dışarıda
 */
export function isPlayableStation(raw: RadioBrowserStation): boolean {
  if (raw.lastcheckok !== 1) return false;
  if (raw.ssl_error === 1) return false;
  if (raw.hls === 1) return false;
  if (!pickStreamUrl(raw)) return false;
  return normalizeCodec(raw.codec) !== null;
}

function parseTags(tags: string | null | undefined): string[] {
  if (!tags) return [];
  return tags
    .split(',')
    .map((tag) => tag.trim().toLowerCase())
    .filter((tag) => tag.length > 0 && tag.length <= 32)
    .slice(0, 6);
}

function cleanName(name: string): string {
  const trimmed = name.replace(/\s+/g, ' ').trim();
  return trimmed.length > 0 ? trimmed : 'İsimsiz İstasyon';
}

export function toRadioStation(raw: RadioBrowserStation): RadioStation | null {
  const streamUrl = pickStreamUrl(raw);
  const codec = normalizeCodec(raw.codec);
  if (!streamUrl || !codec) return null;

  const favicon = raw.favicon?.trim();
  const homepage = raw.homepage?.trim();

  return {
    uuid: raw.stationuuid,
    name: cleanName(raw.name),
    streamUrl,
    homepage: homepage && homepage.startsWith('https://') ? homepage : null,
    favicon: favicon && favicon.startsWith('https://') ? favicon : null,
    countryCode: (raw.countrycode || '').toUpperCase(),
    codec,
    bitrate: Number.isFinite(raw.bitrate) ? raw.bitrate : 0,
    tags: parseTags(raw.tags),
    votes: raw.votes ?? 0,
    clickCount: raw.clickcount ?? 0,
    isFallback: false,
  };
}

/** Aynı akışı veya aynı isimli kopyaları tekilleştirir; API sırasını (clickcount) korur. */
function dedupeStations(stations: RadioStation[]): RadioStation[] {
  const seenUrls = new Set<string>();
  const seenNames = new Set<string>();
  const result: RadioStation[] = [];
  for (const station of stations) {
    const urlKey = station.streamUrl.toLowerCase().replace(/\/+$/, '');
    const nameKey = station.name.toLocaleLowerCase('tr-TR');
    if (seenUrls.has(urlKey) || seenNames.has(nameKey)) continue;
    seenUrls.add(urlKey);
    seenNames.add(nameKey);
    result.push(station);
  }
  return result;
}

// ─────────────────────────────────────────────────────────────
//  API
// ─────────────────────────────────────────────────────────────

function buildCountryPath(countryCode: string): string {
  const params = [
    `limit=${RADIO_CONFIG.limit}`,
    'order=clickcount',
    'reverse=true',
    'hidebroken=true',
  ].join('&');
  return `/json/stations/bycountrycodeexact/${encodeURIComponent(countryCode)}?${params}`;
}

/** Sunucuları yapışkan sırayla dener; biri başarılı olunca onu tercih edilen yapar. */
async function requestWithMirrors<T>(path: string, signal?: AbortSignal): Promise<T> {
  const servers = RADIO_BROWSER_SERVERS;
  let lastError: unknown = new Error('Radio Browser sunucusu yapılandırılmamış');

  for (let attempt = 0; attempt < servers.length; attempt += 1) {
    const index = (preferredServerIndex + attempt) % servers.length;
    const base = servers[index];
    if (!base) continue;
    try {
      const data = await fetchJson<T>(`${base}${path}`, {
        timeoutMs: RADIO_CONFIG.requestTimeoutMs,
        signal,
        headers: { 'User-Agent': RADIO_CONFIG.userAgent },
      });
      preferredServerIndex = index;
      return data;
    } catch (error) {
      if (isAbortError(error) && signal?.aborted) throw error;
      lastError = error;
    }
  }
  throw lastError;
}

export interface FetchStationsOptions {
  signal?: AbortSignal;
  /** Önbelleği yok say */
  force?: boolean;
}

/**
 * Bir ülkenin çalınabilir istasyonlarını döndürür (en popülerden başlayarak).
 * Ağ hatasında boş dizi döner — çağıran taraf global yedeğe düşer, kullanıcı hata görmez.
 */
export async function fetchStationsByCountry(
  countryCode: string,
  options: FetchStationsOptions = {},
): Promise<RadioStation[]> {
  const code = countryCode.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return [];

  const cached = stationCache.get(code);
  if (!options.force && cached && cached.expiresAt > Date.now()) {
    return cached.stations;
  }

  const inflight = inflightRequests.get(code);
  if (inflight && !options.force) return inflight;

  const request = (async () => {
    try {
      const raw = await requestWithMirrors<RadioBrowserStation[]>(buildCountryPath(code), options.signal);
      const stations = dedupeStations(
        (Array.isArray(raw) ? raw : [])
          .filter(isPlayableStation)
          .map(toRadioStation)
          .filter((station): station is RadioStation => station !== null),
      );
      stationCache.set(code, { stations, expiresAt: Date.now() + RADIO_CONFIG.cacheTtlMs });
      return stations;
    } catch (error) {
      if (isAbortError(error)) throw error;
      if (__DEV__) console.warn(`[radioService] ${code} istasyonları alınamadı`, error);
      // Eski önbellek varsa süresi dolmuş olsa bile kullan (bayat veri > sessizlik)
      return cached?.stations ?? [];
    } finally {
      inflightRequests.delete(code);
    }
  })();

  inflightRequests.set(code, request);
  return request;
}

/** Global yedek listesinin karıştırılmış kopyası — her seferinde aynı istasyon gelmesin. */
export function getFallbackStations(shuffle = true): RadioStation[] {
  const list = [...GLOBAL_FALLBACK_STATIONS];
  if (!shuffle) return list;
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = list[i];
    const b = list[j];
    if (a && b) {
      list[i] = b;
      list[j] = a;
    }
  }
  return list;
}

/**
 * Oynatma sırası: [ülke istasyonları…, global yedekler…].
 * GlobeAudioContext bu sırada ilerler; `localCount` indeksine ulaşıldığında
 * UI "Yerel yayın bulunamadı, global yayına geçildi" bilgisini gösterebilir.
 */
export async function buildPlaybackQueue(
  countryCode: string,
  options: FetchStationsOptions = {},
): Promise<PlaybackQueue> {
  let local: RadioStation[] = [];
  try {
    local = await fetchStationsByCountry(countryCode, options);
  } catch (error) {
    if (isAbortError(error)) throw error;
    local = [];
  }
  const localUrls = new Set(local.map((station) => station.streamUrl));
  const fallback = getFallbackStations().filter((station) => !localUrls.has(station.streamUrl));
  return {
    countryCode: countryCode.toUpperCase(),
    stations: [...local, ...fallback],
    localCount: local.length,
  };
}

export function getNextIndex(queue: PlaybackQueue, currentIndex: number): number {
  if (queue.stations.length === 0) return -1;
  return (currentIndex + 1) % queue.stations.length;
}

/**
 * Radio Browser'a "dinlendi" bildirimi — popülerlik sıralamasını besler.
 * Ateşle-unut; global yedekler bildirilmez.
 */
export function reportStationClick(station: RadioStation): void {
  if (station.isFallback) return;
  void requestWithMirrors<unknown>(`/json/url/${encodeURIComponent(station.uuid)}`).catch(() => undefined);
}

export function clearRadioCache(): void {
  stationCache.clear();
  inflightRequests.clear();
}
