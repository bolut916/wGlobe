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

export type WebMessage = AudioLoadMessage | AudioSkipMessage | AudioPauseMessage | AudioVolumeMessage | AudioArtMessage | AudioNowPlayingMessage | HapticMessage | ShareMessage | AlarmSetMessage;

export type AudioStateMessage = { type: 'audio:state'; loadId: number; index: number; playing: boolean; buffering: boolean; failed: boolean };
export type LinkMessage = { type: 'link'; params: Record<string, string> };
/** Kilit ekranı / kulaklık ileri-geri tuşu: web dünyanın başka yerine (ya da bir önceki yere) gider */
export type RemoteMessage = { type: 'remote'; action: 'next' | 'prev' };
/** Alarm kuruldu/kapandı ya da kurulamadı (reason: bildirim izni yok / hata) */
export type AlarmStatusMessage = { type: 'alarm:status'; ok: boolean; enabled: boolean; hour?: number; minute?: number; reason?: 'permission' | 'error' };
/** Alarm bildirimine dokunuldu: web, güneşin doğduğu şehrin radyosunu başlatır */
export type AlarmFireMessage = { type: 'alarm:fire' };
export type NativeMessage = AudioStateMessage | LinkMessage | RemoteMessage | AlarmStatusMessage | AlarmFireMessage;

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
    default:
      return null;
  }
}

/** wglobe://… ya da https://bolut916.github.io/wGlobe/?c=… bağlantısındaki paylaşım parametreleri */
export function linkParams(url: string | null | undefined): Record<string, string> | null {
  if (!url) return null;
  const q = url.indexOf('?'); if (q < 0) return null;
  const out: Record<string, string> = {};
  url.slice(q + 1).split('#')[0]!.split('&').forEach((pair) => {
    const [k, v = ''] = pair.split('=');
    if (!k) return;
    try { out[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' ')); } catch { /* bozuk parça */ }
  });
  return out.c ? out : null;
}
