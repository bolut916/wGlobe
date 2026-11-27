/**
 * Android: react-native-android-widget. Görsel uygulamanın kendi belgeler dizinindedir (widget aynı süreçte
 * çizilir); RemoteViews'a data: adresi olarak verilir. Widget hiç eklenmemişse istek sessizce düşer.
 */
import * as FS from 'expo-file-system/legacy';
import { requestWidgetUpdate } from 'react-native-android-widget';

import { WIDGET_NAME, type WidgetProps } from './model';
import { NowPlayingAndroid } from './NowPlayingAndroid';

export const artDirectory = (): string | null => FS.documentDirectory ?? null;

export async function artData(uri: string): Promise<string | null> {
  if (!uri) return null;
  try {
    const b64 = await FS.readAsStringAsync(uri, { encoding: FS.EncodingType.Base64 });
    return b64 ? `data:image/jpeg;base64,${b64}` : null;
  } catch { return null; }
}

export async function publishWidget(p: WidgetProps): Promise<void> {
  const art = await artData(p.art);
  try {
    await requestWidgetUpdate({
      widgetName: WIDGET_NAME,
      renderWidget: (info) => <NowPlayingAndroid {...p} artData={art} width={info.width} height={info.height} />,
      widgetNotFound: () => undefined,
    });
  } catch { /* widget yok */ }
}
