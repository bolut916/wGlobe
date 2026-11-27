/**
 * Widget durumu: diske yazılır (uygulama kapalıyken widget buradan çizilir), sonra platform widget'ı yenilenir.
 * Görsel her güncellemede yeni bir dosya adıyla yazılır, durum ona işaret eder, eski dosya sonra silinir:
 * widget yarım yazılmış bir görseli asla okumaz ve iOS görsel önbelleği eski kapakta takılı kalmaz.
 * Tüm hatalar sessizce yutulur: widget bir yan özelliktir, uygulamayı asla düşürmez.
 */
import * as FS from 'expo-file-system/legacy';

import type { WidgetUpdateMessage } from '@/shell/bridge';

import { deviceLang, parseState, toProps, type WidgetProps, type WidgetState } from './model';
import { artDirectory, publishWidget } from './publish';

const STATE_NAME = 'wglobe-widget.json';
const ART_PREFIX = 'wglobe-widget-art-';

const statePath = (): string | null => (FS.documentDirectory ? FS.documentDirectory + STATE_NAME : null);
const artPath = (at: number): string | null => { const d = artDirectory(); return d ? `${d}${ART_PREFIX}${at}.jpg` : null; };

export async function readState(): Promise<WidgetState | null> {
  const p = statePath(); if (!p) return null;
  try {
    const info = await FS.getInfoAsync(p);
    return info.exists ? parseState(await FS.readAsStringAsync(p)) : null;
  } catch { return null; }
}

/** Widget'ın şu anki çizim verisi (Android görev işleyicisi uygulama kapalıyken de bunu çağırır). */
export async function loadProps(): Promise<WidgetProps> {
  const s = await readState();
  const art = s && !('empty' in s) && s.hasArt ? artPath(s.at) : null;
  let artOk = false;
  if (art) { try { artOk = (await FS.getInfoAsync(art)).exists; } catch { artOk = false; } }
  return toProps(s, artOk && art ? art : '', deviceLang());
}

async function writeState(s: WidgetState): Promise<void> {
  const p = statePath(); if (!p) return;
  const tmp = p + '.tmp';
  await FS.writeAsStringAsync(tmp, JSON.stringify(s));
  await FS.moveAsync({ from: tmp, to: p });
}

/** Eski kapak dosyalarını temizle (yalnız bu önekle başlayanlar, şimdiki hariç). */
async function sweepArt(keep: number | null): Promise<void> {
  const d = artDirectory(); if (!d) return;
  try {
    const names = await FS.readDirectoryAsync(d);
    await Promise.all(names
      .filter((n) => n.startsWith(ART_PREFIX) && n !== `${ART_PREFIX}${keep}.jpg`)
      .map((n) => FS.deleteAsync(d + n, { idempotent: true }).catch(() => undefined)));
  } catch { /* dizin yok */ }
}

let last = '';
let chain: Promise<void> = Promise.resolve();

/** Web'den gelen (bridge.ts'de doğrulanmış) güncelleme. Sıraya alınır: iki hızlı güncelleme birbirini ezmez. */
export function updateFromWeb(m: WidgetUpdateMessage): Promise<void> {
  chain = chain.then(() => apply(m)).catch(() => undefined);
  return chain;
}

async function apply(m: WidgetUpdateMessage): Promise<void> {
  // Aynı istasyon + aynı görsel tekrar gelirse disk ve widget yeniden yazılmaz
  const sig = JSON.stringify([m.lang, m.city, m.country, m.station, m.tz, m.params, m.art ? m.art.length : 0, m.art ? m.art.slice(-64) : '']);
  if (sig === last) return;
  const at = Date.now();
  let hasArt = false;
  const art = m.art ? artPath(at) : null;
  if (m.art && art) {
    try {
      await FS.writeAsStringAsync(art, m.art.slice(m.art.indexOf(',') + 1), { encoding: FS.EncodingType.Base64 });
      hasArt = true;
    } catch { hasArt = false; }
  }
  const state: WidgetState = { v: 1, lang: m.lang, city: m.city, country: m.country, station: m.station, tz: m.tz, params: m.params, hasArt, at };
  await writeState(state);
  last = sig;
  await publishWidget(toProps(state, hasArt && art ? art : '', m.lang));
  await sweepArt(hasArt ? at : null);
}

/** Uygulama açılışı: hiç kayıt yoksa boş durumu cihaz dilinde yaz; varsa widget'ı kayıtla tazele. */
export async function ensureWidget(): Promise<void> {
  try {
    const s = await readState();
    if (!s) {
      const empty: WidgetState = { v: 1, lang: deviceLang(), empty: true, at: Date.now() };
      await writeState(empty);
    }
    await publishWidget(await loadProps());
  } catch { /* widget yok ya da desteklenmiyor */ }
}
