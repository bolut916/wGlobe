/**
 * Open-Meteo anlık hava durumu servisi (anahtar gerektirmez).
 * GET /v1/forecast?latitude={lat}&longitude={lng}&current_weather=true
 */
import { UNKNOWN_WEATHER, WEATHER_CONFIG, WMO_WEATHER_CODES } from '@/constants/weather';
import { fetchJson } from '@/lib/http';
import type { City, OpenMeteoCurrentWeatherResponse, WeatherIconName, WeatherInfo } from '@/types';

interface CacheEntry {
  data: WeatherInfo;
  expiresAt: number;
}

const weatherCache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<WeatherInfo>>();

/** ~1 km hassasiyet yeterli; aynı şehir için tek önbellek girdisi */
const cacheKey = (lat: number, lng: number) => `${lat.toFixed(2)},${lng.toFixed(2)}`;

export function describeWeatherCode(code: number, isDay = true): { description: string; icon: WeatherIconName } {
  const descriptor = WMO_WEATHER_CODES[code] ?? UNKNOWN_WEATHER;
  return {
    description: descriptor.description,
    icon: !isDay && descriptor.nightIcon ? descriptor.nightIcon : descriptor.icon,
  };
}

export function formatTemperature(celsius: number): string {
  const rounded = Math.round(celsius);
  // "-0°C" görünmesin
  return `${Object.is(rounded, -0) ? 0 : rounded}°C`;
}

function buildUrl(lat: number, lng: number): string {
  const params = [
    `latitude=${encodeURIComponent(lat.toFixed(4))}`,
    `longitude=${encodeURIComponent(lng.toFixed(4))}`,
    'current_weather=true',
  ].join('&');
  return `${WEATHER_CONFIG.baseUrl}/v1/forecast?${params}`;
}

function parseResponse(response: OpenMeteoCurrentWeatherResponse): WeatherInfo {
  const current = response.current_weather;
  if (!current || typeof current.temperature !== 'number' || typeof current.weathercode !== 'number') {
    throw new Error('Open-Meteo yanıtında current_weather alanı yok');
  }
  const isDay = current.is_day === 1;
  const { description, icon } = describeWeatherCode(current.weathercode, isDay);
  return {
    temperature: current.temperature,
    temperatureLabel: formatTemperature(current.temperature),
    weatherCode: current.weathercode,
    description,
    icon,
    isDay,
    windSpeed: current.windspeed,
    windDirection: current.winddirection,
    observedAt: current.time,
    fetchedAt: Date.now(),
  };
}

export interface FetchWeatherOptions {
  signal?: AbortSignal;
  force?: boolean;
}

/**
 * Anlık hava durumu. Hata durumunda fırlatır; UI katmanı bunu sessizce
 * "Hava durumu alınamadı" satırına çevirir (radyo akışını asla bloklamaz).
 */
export async function fetchWeather(lat: number, lng: number, options: FetchWeatherOptions = {}): Promise<WeatherInfo> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw new RangeError(`Geçersiz koordinat: ${lat}, ${lng}`);
  }

  const key = cacheKey(lat, lng);
  const cached = weatherCache.get(key);
  if (!options.force && cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const pending = inflight.get(key);
  if (pending && !options.force) return pending;

  const request = (async () => {
    try {
      const response = await fetchJson<OpenMeteoCurrentWeatherResponse>(buildUrl(lat, lng), {
        timeoutMs: WEATHER_CONFIG.requestTimeoutMs,
        signal: options.signal,
      });
      const data = parseResponse(response);
      weatherCache.set(key, { data, expiresAt: Date.now() + WEATHER_CONFIG.cacheTtlMs });
      return data;
    } catch (error) {
      // Süresi dolmuş önbellek, hiç veri olmamasından iyidir
      if (cached) return cached.data;
      throw error;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, request);
  return request;
}

export function fetchWeatherForCity(city: Pick<City, 'lat' | 'lng'>, options?: FetchWeatherOptions): Promise<WeatherInfo> {
  return fetchWeather(city.lat, city.lng, options);
}

export function clearWeatherCache(): void {
  weatherCache.clear();
  inflight.clear();
}
