/**
 * Android ana ekran widget'ı (react-native-android-widget → RemoteViews).
 *
 * Görsel hiyerarşi (widget durağandır; "hareket" gözün yolunda): üst etiket → şehir (en büyük) → istasyon.
 * Orta boyutta tek parlak nesne "▶ Dinle" düğmesidir — eylem çağrısı tartışmasız.
 *  - Küçük (2×2): cep sahnesi tam kaplar; metin sahnenin koyu "cep" bölgesinde (altta) durur.
 *  - Orta (4×2 ve üstü, en/boy ≥ 1,6): sahne solda kare, bilgiler sağda.
 * Her yüzey dokununca uygulamayı son istasyonla açar (OPEN_URI → wglobe://?c=…).
 */
import { FlexWidget, ImageWidget, OverlapWidget, TextWidget } from 'react-native-android-widget';

import type { WidgetProps } from './model';

const C = {
  bg0: '#050B18',
  bg1: '#0E1C3A',
  fg: '#EAF4FF',
  fg2: '#E8F0FFA3',
  accent: '#A9D3FF',
  pill: '#EAF4FF',
  pillText: '#0B1A33',
} as const;

export type AndroidWidgetProps = WidgetProps & {
  /** Kapak görseli (data:image/jpeg;base64,…) ya da null */
  artData: string | null;
  width: number;
  height: number;
};

function Eyebrow({ text }: { text: string }) {
  return <TextWidget text={`● ${text}`} maxLines={1} style={{ fontSize: 9, color: C.accent, letterSpacing: 0.14, fontFamily: 'monospace' }} />;
}

export function NowPlayingAndroid(p: AndroidWidgetProps) {
  const click = { clickAction: 'OPEN_URI' as const, clickActionData: { uri: p.link } };
  const W = Math.max(40, Math.round(p.width || 150));
  const H = Math.max(40, Math.round(p.height || 150));
  const wide = W >= H * 1.6;

  // Boş durum: henüz hiçbir şey çalınmadı
  if (p.empty) {
    return (
      <FlexWidget
        {...click}
        accessibilityLabel={`wGlobe · ${p.emptyTitle}`}
        style={{ height: 'match_parent', width: 'match_parent', padding: 14, borderRadius: 22, justifyContent: 'space-between',
          backgroundGradient: { from: C.bg1, to: C.bg0, orientation: 'TL_BR' } }}
      >
        <TextWidget text="wGlobe" style={{ fontSize: 15, fontWeight: '700', color: C.fg }} />
        <FlexWidget style={{ flexDirection: 'column' }}>
          <TextWidget text={p.emptyTitle} maxLines={2} truncate="END" style={{ fontSize: wide ? 19 : 16, fontWeight: '700', color: C.fg }} />
          <TextWidget text={p.emptyBody} maxLines={2} truncate="END" style={{ fontSize: 11.5, color: C.fg2, marginTop: 3 }} />
        </FlexWidget>
      </FlexWidget>
    );
  }

  const label = `${p.city}, ${p.country} · ${p.station}`;

  if (!wide) {
    // Küçük: sahne tam kaplar, metin cebin içinde
    return (
      <OverlapWidget {...click} accessibilityLabel={label} style={{ height: 'match_parent', width: 'match_parent', borderRadius: 22, overflow: 'hidden', backgroundColor: C.bg0 }}>
        {p.artData ? (
          <ImageWidget image={p.artData as `data:image${string}`} imageWidth={W} imageHeight={H} resizeMode="cover" style={{ height: 'match_parent', width: 'match_parent' }} />
        ) : (
          <FlexWidget style={{ height: 'match_parent', width: 'match_parent', backgroundGradient: { from: C.bg1, to: C.bg0, orientation: 'TOP_BOTTOM' } }} />
        )}
        <FlexWidget style={{ height: 'match_parent', width: 'match_parent', flexDirection: 'column', justifyContent: 'flex-end', paddingHorizontal: 12, paddingBottom: 11 }}>
          <Eyebrow text={p.eyebrow} />
          <TextWidget text={p.city} maxLines={1} truncate="END" style={{ fontSize: 17, fontWeight: '700', color: C.fg, marginTop: 2 }} />
          <TextWidget text={p.station} maxLines={1} truncate="END" style={{ fontSize: 11.5, color: C.fg2 }} />
        </FlexWidget>
      </OverlapWidget>
    );
  }

  // Orta: sahne solda kare, bilgiler sağda
  return (
    <FlexWidget
      {...click}
      accessibilityLabel={label}
      style={{ height: 'match_parent', width: 'match_parent', flexDirection: 'row', borderRadius: 22, overflow: 'hidden',
        backgroundGradient: { from: C.bg1, to: C.bg0, orientation: 'TL_BR' } }}
    >
      {p.artData ? (
        <ImageWidget image={p.artData as `data:image${string}`} imageWidth={H} imageHeight={H} resizeMode="cover" style={{ height: H, width: H }} />
      ) : null}
      <FlexWidget style={{ flex: 1, height: 'match_parent', flexDirection: 'column', justifyContent: 'space-between', padding: 14 }}>
        <FlexWidget style={{ flexDirection: 'column', width: 'match_parent' }}>
          <Eyebrow text={p.eyebrow} />
          <TextWidget text={p.city} maxLines={1} truncate="END" style={{ fontSize: 20, fontWeight: '700', color: C.fg, marginTop: 3 }} />
          <TextWidget text={p.country} maxLines={1} truncate="END" style={{ fontSize: 12, color: C.fg2 }} />
          <TextWidget text={p.station} maxLines={1} truncate="END" style={{ fontSize: 13, color: C.accent, marginTop: 6 }} />
        </FlexWidget>
        <FlexWidget {...click} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: C.pill }}>
          <TextWidget text={`▶  ${p.listen}`} style={{ fontSize: 13, fontWeight: '700', color: C.pillText }} />
        </FlexWidget>
      </FlexWidget>
    </FlexWidget>
  );
}
