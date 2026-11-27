/**
 * Ana ekran widget'ı — iki platformun ortak veri modeli.
 *
 * Tasarım: uygulamanın "cep sahnesi" (yarısı cebe girmiş küre) kilit ekranı kapağıyla aynı dil. Küçük boyutta
 * sahne tam kaplar, metin cebin içinde durur; orta boyutta sahne solda, bilgiler sağda. Dokununca uygulama
 * son istasyonla açılır (paylaşım bağlantısının aynısı).
 *
 * Akış: web (istasyon bağlandı) → 'widget:update' köprü mesajı (bridge.ts'de doğrulanır) → WidgetStore
 * görseli ve durumu diske yazar → platform widget'ı yenilenir. Android'de widget uygulama kapalıyken de bu
 * dosyalardan çizilir (widget-task-handler).
 */
export const WIDGET_NAME = 'NowPlaying';
export const WIDGET_SCHEME = 'wglobe';

export type WidgetLang = 'tr' | 'en';

/** Widget'ın çizim verisi (iki platformda aynı alanlar). */
export type WidgetProps = {
  empty: boolean;
  city: string;
  country: string;
  station: string;
  /** IANA saat dilimi (iOS'ta şehrin canlı saati) */
  tz: string;
  /** Dokununca açılacak adres */
  link: string;
  /** Kapak görselinin dosya adresi (file://…); yoksa boş */
  art: string;
  eyebrow: string;
  listen: string;
  emptyTitle: string;
  emptyBody: string;
};

/** Diskte saklanan durum: dile bağlı metinler çizim anında eklenir. */
export type WidgetState = {
  v: 1;
  lang: WidgetLang;
  city: string;
  country: string;
  station: string;
  tz: string;
  params: Record<string, string>;
  hasArt: boolean;
  at: number;
} | {
  v: 1;
  lang: WidgetLang;
  empty: true;
  at: number;
};

export const TEXTS: Record<WidgetLang, { eyebrow: string; listen: string; emptyTitle: string; emptyBody: string }> = {
  tr: { eyebrow: 'SON İSTASYON', listen: 'Dinle', emptyTitle: 'Dünyayı dinle', emptyBody: 'Bir şehre dokun, radyosu burada belirsin.' },
  en: { eyebrow: 'LAST STATION', listen: 'Listen', emptyTitle: 'Listen to the world', emptyBody: 'Tap a city and its radio shows up here.' },
};

/** wglobe://?c=…&st=… — uygulama açılınca web bunu paylaşılan bağlantı gibi işler (bridge.linkParams). */
export function deepLink(params: Record<string, string> | null): string {
  if (!params || !params.c) return `${WIDGET_SCHEME}://`;
  const q = Object.keys(params).sort().map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k]!)}`).join('&');
  return `${WIDGET_SCHEME}://?${q}`;
}

/** Cihaz dili (Hermes Intl): Türkçe dışındaki her şey İngilizce — web arayüzüyle aynı kural. */
export function deviceLang(): WidgetLang {
  try {
    const loc = Intl.DateTimeFormat().resolvedOptions().locale || '';
    return /^tr\b/i.test(loc) ? 'tr' : 'en';
  } catch {
    return 'tr';
  }
}

export function toProps(state: WidgetState | null, artUri: string, fallbackLang: WidgetLang): WidgetProps {
  const lang = state ? state.lang : fallbackLang;
  const t = TEXTS[lang];
  if (!state || 'empty' in state) {
    return { empty: true, city: '', country: '', station: '', tz: 'UTC', link: deepLink(null), art: '', ...t };
  }
  return {
    empty: false,
    city: state.city,
    country: state.country,
    station: state.station,
    tz: state.tz,
    link: deepLink(state.params),
    art: state.hasArt ? artUri : '',
    ...t,
  };
}

/** Bozuk ya da eski biçimli kayıt asla widget'ı çökertmez: doğrulanamazsa null (boş durum çizilir). */
export function parseState(raw: string | null): WidgetState | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (!o || o.v !== 1 || (o.lang !== 'tr' && o.lang !== 'en') || typeof o.at !== 'number') return null;
    if (o.empty === true) return { v: 1, lang: o.lang, empty: true, at: o.at };
    const str = (v: unknown, max: number) => (typeof v === 'string' && v.length <= max ? v : null);
    const city = str(o.city, 60), country = str(o.country, 60), station = str(o.station, 80), tz = str(o.tz, 64);
    if (!city || country === null || !station || !tz || !o.params || typeof o.params !== 'object') return null;
    const params: Record<string, string> = {};
    for (const [k, v] of Object.entries(o.params as Record<string, unknown>)) if (typeof v === 'string' && v.length <= 600 && /^[a-z]{1,3}$/.test(k)) params[k] = v;
    if (!params.c) return null;
    return { v: 1, lang: o.lang, city, country, station, tz, params, hasArt: o.hasArt === true, at: o.at };
  } catch {
    return null;
  }
}
