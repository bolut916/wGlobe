/**
 * iOS: expo-widgets. Görseller uygulama ile widget uzantısının paylaştığı App Group dizinine yazılır
 * (widgetsDirectory, file:///…/ExpoWidgets/). App Group yoksa (null) görselsiz çizilir.
 * Şehrin saati için 3 saatlik dakikalık zaman çizelgesi verilir; son girişte saat gizlenir.
 */
import { widgetsDirectory } from 'expo-widgets';

import type { WidgetProps } from './model';
import { nowPlayingWidget, type IOSWidgetProps } from './NowPlayingIOS';

const CLOCK_HOURS = 3;

export const artDirectory = (): string | null => {
  const d = widgetsDirectory;
  return typeof d === 'string' && d.startsWith('file://') ? (d.endsWith('/') ? d : d + '/') : null;
};

export async function publishWidget(p: WidgetProps): Promise<void> {
  try {
    if (p.empty) { nowPlayingWidget.updateSnapshot({ ...p, clock: false }); return; }
    const now = Date.now(), minute = 60_000, first = Math.floor(now / minute) * minute;
    const entries: { date: Date; props: IOSWidgetProps }[] = [{ date: new Date(now), props: { ...p, clock: true } }];
    for (let t = first + minute; t <= now + CLOCK_HOURS * 3_600_000; t += minute) entries.push({ date: new Date(t), props: { ...p, clock: true } });
    entries.push({ date: new Date(first + CLOCK_HOURS * 3_600_000 + minute), props: { ...p, clock: false } });
    nowPlayingWidget.updateTimeline(entries);
  } catch { /* widget uzantısı yok */ }
}
