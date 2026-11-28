/**
 * Web arayüzü ↔ yerel kabuk mesajları. Web tarafı: prototype/index.html içindeki "UYGULAMA KÖPRÜSÜ".
 * Web → yerel: window.ReactNativeWebView.postMessage(JSON)
 * Yerel → web: window.wglobeNative(JSON)
 */
export type Track = { url: string; title: string };

export type AudioLoadMessage = {
  type: 'audio:load';
  loadId: number;
  index: number;
  tracks: Track[];
  meta: { artist: string; album?: string; artwork?: string | null };
};
export type AudioSkipMessage = { type: 'audio:skipTo'; loadId: number; index: number };
export type AudioPauseMessage = { type: 'audio:pause'; loadId: number };
export type AudioVolumeMessage = { type: 'audio:volume'; v: number };
export type AudioArtMessage = { type: 'audio:art'; loadId: number; artwork: string };
/** Şu an çalan şarkı (web, yayının ICY başlığından okur): kilit ekranında başlık olur; null → istasyon adı */
export type AudioNowPlayingMessage = { type: 'audio:nowplaying'; loadId: number; index: number; title: string | null };
/** Titreşim: sayı (kısa tık), eski dizi biçimi ya da anlamlı ad (bkz. HAPTIC_NAMES) */
export const HAPTIC_NAMES = ['error', 'warning', 'success', 'connect', 'arrive', 'unlock', 'double'] as const;
export type HapticName = (typeof HAPTIC_NAMES)[number];
export type HapticMessage = { type: 'haptic'; p: number | number[] | HapticName };
export type ShareMessage = { type: 'share'; image: string; url: string; text: string; title?: string };
/** Radyolu alarm: her gün hour:minute'te sesli bildirim (title/body web'in dilinde gelir) */
export type AlarmSetMessage = { type: 'alarm:set'; enabled: boolean; hour: number; minute: number; title: string; body: string };

/**
 * Geliştiriciye destek (uygulama içi bahşiş). Yalnız bu üç tüketilebilir ürün satın alınabilir; bahşiş hiçbir
 * özelliği açmaz (App Store 3.1.1: "Apps may use in-app purchase currencies to enable customers to tip the developer").
 * Kimlikler App Store Connect ve Google Play Console'da birebir aynı tanımlanır.
 */
export const TIP_SKUS = ['com.wglobe.app.tip.song', 'com.wglobe.app.tip.album', 'com.wglobe.app.tip.night'] as const;
export type TipSku = (typeof TIP_SKUS)[number];
export type TipLoadMessage = { type: 'tip:load' };
export type TipBuyMessage = { type: 'tip:buy'; id: TipSku };
export type TipProduct = { id: TipSku; price: string };
/** Mağaza ürünleri (fiyatlar mağazanın yerel biçiminde) ya da ulaşılamadı */
export type TipProductsMessage = { type: 'tip:products'; items: TipProduct[]; error?: 'unavailable' };
/** Satın alma sonucu. late: uygulama kapanmışken ya da onay beklerken tamamlanmış eski bir bahşiş */
export type TipResultMessage = { type: 'tip:result'; id: string; status: 'success' | 'cancelled' | 'pending' | 'error'; late?: boolean };

export type WebMessage = TipLoadMessage | TipBuyMessage | WidgetUpdateMessage | AudioLoadMessage | AudioSkipMessage | AudioPauseMessage | AudioVolumeMessage | AudioArtMessage | AudioNowPlayingMessage | HapticMessage | ShareMessage | AlarmSetMessage;

export type AudioStateMessage = { type: 'audio:state'; loadId: number; index: number; playing: boolean; buffering: boolean; failed: boolean };
export type LinkMessage = { type: 'link'; params: Record<string, string> };
/** Kilit ekranı / kulaklık ileri-geri tuşu: web dünyanın başka yerine (ya da bir önceki yere) gider */
export type RemoteMessage = { type: 'remote'; action: 'next' | 'prev' };
/** Alarm kuruldu/kapandı ya da kurulamadı (reason: bildirim izni yok / hata) */
export type AlarmStatusMessage = { type: 'alarm:status'; ok: boolean; enabled: boolean; hour?: number; minute?: number; reason?: 'permission' | 'error' };
/** Alarm bildirimine dokunuldu: web, güneşin doğduğu şehrin radyosunu başlatır */
export type AlarmFireMessage = { type: 'alarm:fire' };
export type NativeMessage = AudioStateMessage | LinkMessage | RemoteMessage | AlarmStatusMessage | AlarmFireMessage | TipProductsMessage | TipResultMessage;

/** Gelen mesajı doğrular (WebView içeriği güvenilir olsa da yapı bozuksa sessizce yok sayılır). */
export function parseWebMessage(raw: string): WebMessage | null {
  let m: unknown;
  try { m = JSON.parse(raw); } catch { return null; }
  if (!m || typeof m !== 'object') return null;
  const o = m as Record<string, unknown>;
  switch (o.type) {
    case 'audio:load':
      if (typeof o.loadId !== 'number' || typeof o.index !== 'number' || !Array.isArray(o.tracks) || !o.meta || typeof o.meta !== 'object') return null;
      if (!o.tracks.every((t) => t && typeof t === 'object' && typeof (t as Track).url === 'string' && /^https:\/\//i.test((t as Track).url) && typeof (t as Track).title === 'string')) return null;
      return o as unknown as AudioLoadMessage;
    case 'audio:skipTo':
      return typeof o.loadId === 'number' && typeof o.index === 'number' ? (o as unknown as AudioSkipMessage) : null;
    case 'audio:pause':
      return typeof o.loadId === 'number' ? (o as unknown as AudioPauseMessage) : null;
    case 'audio:art':
      return typeof o.loadId === 'number' && typeof o.artwork === 'string' ? (o as unknown as AudioArtMessage) : null;
    case 'audio:nowplaying':
      return typeof o.loadId === 'number' && typeof o.index === 'number' && (o.title === null || (typeof o.title === 'string' && o.title.length <= 300))
        ? (o as unknown as AudioNowPlayingMessage) : null;
    case 'audio:volume':
      return typeof o.v === 'number' ? (o as unknown as AudioVolumeMessage) : null;
    case 'haptic':
      return typeof o.p === 'number' || Array.isArray(o.p) || (typeof o.p === 'string' && (HAPTIC_NAMES as readonly string[]).includes(o.p)) ? (o as unknown as HapticMessage) : null;
    case 'alarm:set': {
      const okNum = (v: unknown, max: number) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max;
      const okStr = (v: unknown) => typeof v === 'string' && v.length > 0 && v.length <= 200;
      return typeof o.enabled === 'boolean' && okNum(o.hour, 23) && okNum(o.minute, 59) && okStr(o.title) && okStr(o.body) ? (o as unknown as AlarmSetMessage) : null;
    }
    case 'share':
      return typeof o.image === 'string' && typeof o.url === 'string' && typeof o.text === 'string' ? (o as unknown as ShareMessage) : null;
    case 'tip:load':
      return { type: 'tip:load' };
    case 'tip:buy':
      return typeof o.id === 'string' && (TIP_SKUS as readonly string[]).includes(o.id) ? { type: 'tip:buy', id: o.id as TipSku } : null;
    case 'widget:update': {
      // Her alan ayrı doğrulanır; yeni nesne kurulur (gelen nesnenin fazladan alanları asla taşınmaz)
      const city = cleanText(o.city, 60), station = cleanText(o.station, 80);
      const params = cleanLinkParams(o.params);
      const tz = typeof o.tz === 'string' && o.tz.length <= 64 && TZ_RE.test(o.tz) ? o.tz : 'UTC';
      const art = typeof o.art === 'string' && o.art.length <= WIDGET_ART_MAX && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(o.art) ? o.art : null;
      if (!city || !station || !params) return null;
      return { type: 'widget:update', lang: o.lang === 'en' ? 'en' : 'tr', city, country: cleanText(o.country, 60), station, tz, params, art };
    }
    default:
      return null;
  }
}

/**
 * Ana ekran widget'ı: son çalınan istasyon. Web, istasyon bağlanınca gönderir; yerel kabuk görseli diske yazar ve
 * widget'ı yeniler. params, widget'a dokununca uygulamayı aynı istasyonla açan paylaşım bağlantısının alanlarıdır.
 */
export type WidgetUpdateMessage = {
  type: 'widget:update';
  lang: 'tr' | 'en';
  city: string;
  country: string;
  station: string;
  tz: string;
  params: Record<string, string>;
  art: string | null;
};
const WIDGET_ART_MAX = 700_000;
const TZ_RE = /^(?:UTC|GMT|Etc\/GMT[+-]\d{1,2}|[A-Za-z]+(?:\/[A-Za-z0-9_+-]+){1,2})$/;
const cleanText = (v: unknown, max: number) => typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : '';

/** wglobe://… ya da https://wglobe.app/?c=… bağlantısındaki paylaşım parametreleri */
/** Paylaşım bağlantısının okunan alanları; başka hiçbir anahtar siteye aktarılmaz. */
const LINK_KEYS = new Set(['c', 'n', 'co', 'cc', 'la', 'lo', 'tz', 's', 'st', 'su', 'sn']);
const LINK_MAX = 600;

/** Nesne biçimindeki paylaşım parametrelerini (widget bağlantısı) aynı beyaz listeyle süzer; 'c' yoksa null. */
export function cleanLinkParams(v: unknown): Record<string, string> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const out: Record<string, string> = {};
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    if (!LINK_KEYS.has(k) || typeof raw !== 'string') continue;
    const d = raw.replace(/[\u0000-\u001f\u007f]/g, '');
    if (d.length <= LINK_MAX) out[k] = d;
  }
  return out.c ? out : null;
}

export function linkParams(url: string | null | undefined): Record<string, string> | null {
  if (!url || url.length > 4096) return null;
  const q = url.indexOf('?'); if (q < 0) return null;
  const out: Record<string, string> = {};
  url.slice(q + 1).split('#')[0]!.split('&').forEach((pair) => {
    const eq = pair.indexOf('=');
    const k = eq < 0 ? pair : pair.slice(0, eq), v = eq < 0 ? '' : pair.slice(eq + 1);
    if (!LINK_KEYS.has(k)) return;
    try {
      // Denetim karakterleri atılır; değerler sitede ayrıca doğrulanır ve kaçışlanır
      const d = decodeURIComponent(v.replace(/\+/g, ' ')).replace(/[\u0000-\u001f\u007f]/g, '');
      if (d.length <= LINK_MAX) out[k] = d;
    } catch { /* bozuk parça */ }
  });
  return out.c ? out : null;
}
