/**
 * wGlobe — merkezi tip tanımları.
 * Uygulamanın tüm katmanları (servisler, context'ler, bileşenler) bu dosyadaki
 * sözleşmeleri paylaşır.
 */

// ─────────────────────────────────────────────────────────────
//  Coğrafya & Şehirler
// ─────────────────────────────────────────────────────────────

export type Continent =
  | 'Avrupa'
  | 'Asya'
  | 'Kuzey Amerika'
  | 'Güney Amerika'
  | 'Afrika'
  | 'Okyanusya';

export type VibeTag =
  | 'Gece Yarısı Cazı'
  | 'Yağmurlu Sokaklar'
  | 'Sabah Kahvesi'
  | 'Tropikal Ritimler'
  | 'Çöl Gün Batımı'
  | 'Okyanus Esintisi';

export interface City {
  id: string;
  name: string;
  country: string;
  /** Enlem, derece (-90 … 90) */
  lat: number;
  /** Boylam, derece (-180 … 180) */
  lng: number;
  /** IANA saat dilimi, ör. 'Europe/Istanbul' */
  timezone: string;
  /** ISO 3166-1 alpha-2, büyük harf, ör. 'TR' */
  countryCode: string;
  vibeTag: VibeTag;
  continent: Continent;
}

export interface Vector3Like {
  x: number;
  y: number;
  z: number;
}

/** Küre grubunun Euler açıları (radyan). Sıra: 'XYZ'. */
export interface GlobeRotation {
  x: number;
  y: number;
}

export interface SubsolarPoint {
  lat: number;
  lng: number;
}

// ─────────────────────────────────────────────────────────────
//  Küre Temaları
// ─────────────────────────────────────────────────────────────

export type GlobeThemeId = 'classic' | 'parchment' | 'night_lights' | 'swiss_minimal';

/** GLSL uniform'larına doğrudan beslenen renk/yoğunluk paketi. */
export interface GlobeShaderPalette {
  /** Derin okyanus (kutuplara/kenara doğru) */
  oceanDeep: string;
  /** Sığ okyanus (ekvatora/merkeze doğru) */
  oceanShallow: string;
  /** Enlem/boylam ızgara çizgileri */
  grid: string;
  /** Ekvator hattı */
  equator: string;
  /** Gece tarafı tonu */
  night: string;
  /** Gece tarafındaki şehir ışığı / parıltı tonu */
  nightGlow: string;
  /** Atmosfer halesi (fresnel) */
  atmosphere: string;
  /** Sahne arka planı */
  background: string;
  /** 0–1: ızgara opaklığı */
  gridOpacity: number;
  /** Derece cinsinden ızgara aralığı */
  gridSpacingDeg: number;
  /** 0–1: gece tarafının ne kadar karardığı */
  nightStrength: number;
  /** 0–1: gece ışıltısı (night_lights temasında yüksek) */
  nightGlowStrength: number;
  /** 0–1: atmosfer halesi yoğunluğu */
  atmosphereStrength: number;
  /** Terminatör (gün/gece sınırı) yumuşaklığı, 0.01–0.4 */
  terminatorSoftness: number;
}

export interface GlobeTheme {
  id: GlobeThemeId;
  name: string;
  description: string;
  isPremium: boolean;
  palette: GlobeShaderPalette;
  /** Koleksiyon ekranındaki önizleme kartının gradyan durakları */
  previewGradient: readonly [string, string, string];
  /** Pin rengi (varsayılan pirinç #C89D54) */
  markerColor: string;
}

// ─────────────────────────────────────────────────────────────
//  Radyo
// ─────────────────────────────────────────────────────────────

/** Radio Browser API'nin döndürdüğü ham istasyon nesnesi (kullandığımız alanlar). */
export interface RadioBrowserStation {
  changeuuid: string;
  stationuuid: string;
  serveruuid?: string | null;
  name: string;
  url: string;
  url_resolved: string;
  homepage: string;
  favicon: string;
  tags: string;
  country: string;
  countrycode: string;
  state: string;
  language: string;
  languagecodes: string;
  votes: number;
  lastchangetime_iso8601?: string | null;
  codec: string;
  bitrate: number;
  hls: number;
  lastcheckok: number;
  lastchecktime_iso8601?: string | null;
  clickcount: number;
  clicktrend: number;
  ssl_error: number;
  geo_lat?: number | null;
  geo_long?: number | null;
  has_extended_info?: boolean;
}

export type SupportedCodec = 'MP3' | 'AAC';

/** Uygulama içinde kullanılan normalize edilmiş istasyon. */
export interface RadioStation {
  uuid: string;
  name: string;
  streamUrl: string;
  homepage: string | null;
  favicon: string | null;
  countryCode: string;
  codec: SupportedCodec;
  bitrate: number;
  tags: string[];
  votes: number;
  clickCount: number;
  /** Global yedek listesinden mi geldi (SomaFM / Radio Paradise) */
  isFallback: boolean;
}

export type PlaybackStatus =
  | 'idle'
  | 'loading'
  | 'playing'
  | 'paused'
  | 'failover'
  | 'error';

export interface PlaybackQueue {
  countryCode: string;
  stations: RadioStation[];
  /** Ülkeye özgü istasyon sayısı; bu indeksten itibaren liste global yedektir */
  localCount: number;
}

// ─────────────────────────────────────────────────────────────
//  Hava Durumu
// ─────────────────────────────────────────────────────────────

export type WeatherIconName =
  | 'sun'
  | 'moon'
  | 'cloud-sun'
  | 'cloud-moon'
  | 'cloud'
  | 'cloud-fog'
  | 'cloud-drizzle'
  | 'cloud-rain'
  | 'cloud-snow'
  | 'snowflake'
  | 'cloud-lightning'
  | 'cloud-hail';

export interface WmoDescriptor {
  description: string;
  icon: WeatherIconName;
  /** Gece için alternatif ikon (açık / az bulutlu gökyüzü) */
  nightIcon?: WeatherIconName;
}

export interface WeatherInfo {
  temperature: number;
  temperatureLabel: string;
  weatherCode: number;
  description: string;
  icon: WeatherIconName;
  isDay: boolean;
  windSpeed: number;
  windDirection: number;
  /** Open-Meteo'nun ölçüm zamanı (ISO, GMT) */
  observedAt: string;
  /** İstemcinin veriyi aldığı an (epoch ms) */
  fetchedAt: number;
}

/** Open-Meteo `current_weather=true` yanıtı */
export interface OpenMeteoCurrentWeatherResponse {
  latitude: number;
  longitude: number;
  generationtime_ms: number;
  utc_offset_seconds: number;
  timezone: string;
  timezone_abbreviation: string;
  elevation: number;
  current_weather_units?: Record<string, string>;
  current_weather: {
    time: string;
    interval?: number;
    temperature: number;
    windspeed: number;
    winddirection: number;
    is_day: number;
    weathercode: number;
  };
}

// ─────────────────────────────────────────────────────────────
//  Kullanıcı verisi
// ─────────────────────────────────────────────────────────────

export interface FavoriteStation {
  id: string;
  userId: string | null;
  stationUuid: string;
  stationName: string;
  streamUrl: string;
  cityName: string;
  countryCode: string;
  createdAt: string;
}

export type NewFavoriteStation = Omit<FavoriteStation, 'id' | 'userId' | 'createdAt'>;

export interface VisitedCity {
  id: string;
  userId: string | null;
  cityId: string;
  cityName: string;
  visitedAt: string;
}

export interface Profile {
  id: string;
  email: string | null;
  selectedTheme: GlobeThemeId;
  unlockedThemes: GlobeThemeId[];
  createdAt: string;
}

export interface MoodCollection {
  id: string;
  title: string;
  subtitle: string;
  vibeTag: VibeTag;
  /** lucide ikon adı (bileşen katmanında eşlenir) */
  icon: 'moon-star' | 'cloud-rain' | 'coffee' | 'palmtree' | 'sunset' | 'waves';
  accent: string;
  gradient: readonly [string, string];
}

// ─────────────────────────────────────────────────────────────
//  Kimlik doğrulama
// ─────────────────────────────────────────────────────────────

export type AuthMode = 'loading' | 'guest' | 'authenticated' | 'signed_out';

export interface FieldErrors {
  [field: string]: string | undefined;
}

export type FormResult<T> =
  | { success: true; data: T }
  | { success: false; errors: FieldErrors };

// ─────────────────────────────────────────────────────────────
//  Uyku zamanlayıcısı
// ─────────────────────────────────────────────────────────────

export type SleepTimerMinutes = 15 | 30 | 60;

export interface SleepTimerState {
  minutes: SleepTimerMinutes | null;
  /** Bitiş anı (epoch ms) */
  endsAt: number | null;
  isFading: boolean;
}

// ─────────────────────────────────────────────────────────────
//  Supabase veritabanı tipleri
//  (`supabase gen types typescript` çıktısıyla aynı şekil; Row tipleri
//  bilinçli olarak `type` alias'tır — interface, supabase-js'in
//  Record<string, unknown> kısıtını karşılamaz.)
// ─────────────────────────────────────────────────────────────

export type ProfileRow = {
  id: string;
  email: string | null;
  selected_theme: GlobeThemeId;
  unlocked_themes: GlobeThemeId[];
  created_at: string;
};

export type FavoriteStationRow = {
  id: string;
  user_id: string;
  station_uuid: string;
  station_name: string;
  stream_url: string;
  city_name: string;
  country_code: string;
  created_at: string;
};

export type VisitedCityRow = {
  id: string;
  user_id: string;
  city_id: string;
  city_name: string;
  visited_at: string;
};

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: ProfileRow;
        Insert: {
          id: string;
          email?: string | null;
          selected_theme?: GlobeThemeId;
          unlocked_themes?: GlobeThemeId[];
          created_at?: string;
        };
        Update: {
          id?: string;
          email?: string | null;
          selected_theme?: GlobeThemeId;
          unlocked_themes?: GlobeThemeId[];
          created_at?: string;
        };
        Relationships: [];
      };
      favorite_stations: {
        Row: FavoriteStationRow;
        Insert: {
          id?: string;
          user_id: string;
          station_uuid: string;
          station_name: string;
          stream_url: string;
          city_name: string;
          country_code: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          station_uuid?: string;
          station_name?: string;
          stream_url?: string;
          city_name?: string;
          country_code?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      visited_cities: {
        Row: VisitedCityRow;
        Insert: {
          id?: string;
          user_id: string;
          city_id: string;
          city_name: string;
          visited_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          city_id?: string;
          city_name?: string;
          visited_at?: string;
        };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      delete_user: {
        Args: Record<PropertyKey, never>;
        Returns: undefined;
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
