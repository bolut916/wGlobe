/**
 * iOS ana ekran widget'ı (expo-widgets → WidgetKit/SwiftUI, @expo/ui bileşenleri).
 *
 * ÖNEMLİ: Yerleşim işlevi 'widget' yönergesiyle metne çevrilir ve widget uzantısının kendi JS çalışma ortamında
 * değerlendirilir. İşlev dışındaki hiçbir değişkene (sabitler dahil) erişemez; yalnız props, env ve @expo/ui
 * bileşen/değiştiricileri (çalışma ortamında genel adlar) kullanılabilir. Bu yüzden renkler işlevin içindedir.
 *
 * Tasarım Android ile aynı dil: küçükte cep sahnesi tam kaplar, metin cebin içinde; ortada sahne solda.
 * Şehrin yerel saati: zaman çizelgesi girişleri (dakikalık) env.date ile gelir, saat dilimi environment ile
 * şehre çevrilir. Çizelgenin son girişinde clock=false: eski bir saat asla gösterilmez.
 */
import { HStack, Image, Spacer, Text, VStack, ZStack } from '@expo/ui/swift-ui';
import {
  aspectRatio, background, clipShape, containerBackground, environment, font, foregroundStyle, frame, kerning, lineLimit, padding, resizable, shapes, widgetURL,
} from '@expo/ui/swift-ui/modifiers';
import { createWidget, type WidgetEnvironment } from 'expo-widgets';

import { TEXTS, WIDGET_NAME, deepLink, type WidgetProps } from './model';

export type IOSWidgetProps = WidgetProps & { clock: boolean };

const NowPlayingLayout = (p: IOSWidgetProps, env: WidgetEnvironment) => {
  'widget';
  const fg = '#EAF4FF', fg2 = '#E8F0FFA3', accent = '#A9D3FF', bg0 = '#050B18', bg1 = '#0E1C3A', pillText = '#0B1A33';
  const wide = env.widgetFamily === 'systemMedium' || env.widgetFamily === 'systemLarge' || env.widgetFamily === 'systemExtraLarge';
  const gradient = containerBackground({ type: 'linearGradient', colors: [bg1, bg0], startPoint: { x: 0, y: 0 }, endPoint: { x: 1, y: 1 } }, 'widget');
  const eyebrow = (
    <Text modifiers={[font({ size: 9, weight: 'semibold', design: 'monospaced' }), kerning(1.2), foregroundStyle(accent), lineLimit(1)]}>
      {'● ' + p.eyebrow}
    </Text>
  );

  // Boş durum: henüz hiçbir şey çalınmadı
  if (p.empty) {
    return (
      <VStack alignment="leading" spacing={3} modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'topLeading' }), padding({ all: 14 }), gradient, widgetURL(p.link)]}>
        <Text modifiers={[font({ size: 15, weight: 'bold' }), foregroundStyle(fg)]}>wGlobe</Text>
        <Spacer />
        <Text modifiers={[font({ size: wide ? 19 : 16, weight: 'bold' }), foregroundStyle(fg), lineLimit(2)]}>{p.emptyTitle}</Text>
        <Text modifiers={[font({ size: 11.5 }), foregroundStyle(fg2), lineLimit(2)]}>{p.emptyBody}</Text>
      </VStack>
    );
  }

  const showClock = p.clock && !!env.date;
  const clock = showClock ? (
    <Text date={env.date} dateStyle="time" modifiers={[font({ size: 12, weight: 'medium', design: 'monospaced' }), foregroundStyle(fg2), environment('timeZone', p.tz)]} />
  ) : null;

  if (!wide) {
    // Küçük: sahne tam kaplar (kenar boşlukları kapalı), metin cebin içinde
    return (
      <ZStack alignment="bottomLeading" modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity }), gradient, widgetURL(p.link)]}>
        {p.art ? <Image uiImage={p.art} modifiers={[resizable(), aspectRatio({ contentMode: 'fill' }), frame({ maxWidth: Infinity, maxHeight: Infinity })]} /> : null}
        <VStack alignment="leading" spacing={1} modifiers={[padding({ leading: 12, trailing: 12, bottom: 11 })]}>
          {eyebrow}
          <Text modifiers={[font({ size: 17, weight: 'bold' }), foregroundStyle(fg), lineLimit(1)]}>{p.city}</Text>
          <Text modifiers={[font({ size: 11.5 }), foregroundStyle(fg2), lineLimit(1)]}>{p.station}</Text>
        </VStack>
      </ZStack>
    );
  }

  // Orta: sahne solda kare, bilgiler sağda; tek parlak nesne "▶ Dinle"
  return (
    <HStack spacing={0} modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity }), gradient, widgetURL(p.link)]}>
      {p.art ? <Image uiImage={p.art} modifiers={[resizable(), aspectRatio({ ratio: 1, contentMode: 'fill' }), frame({ maxHeight: Infinity }), clipShape('rectangle')]} /> : null}
      <VStack alignment="leading" spacing={2} modifiers={[padding({ all: 14 }), frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'topLeading' })]}>
        {eyebrow}
        <Text modifiers={[font({ size: 20, weight: 'bold' }), foregroundStyle(fg), lineLimit(1)]}>{p.city}</Text>
        <HStack spacing={6}>
          <Text modifiers={[font({ size: 12 }), foregroundStyle(fg2), lineLimit(1)]}>{p.country}</Text>
          {clock}
        </HStack>
        <Text modifiers={[font({ size: 13 }), foregroundStyle(accent), lineLimit(1), padding({ top: 4 })]}>{p.station}</Text>
        <Spacer />
        <Text modifiers={[font({ size: 13, weight: 'bold' }), foregroundStyle(pillText), padding({ horizontal: 14, vertical: 7 }), background(fg, shapes.capsule())]}>
          {'▶  ' + p.listen}
        </Text>
      </VStack>
    </HStack>
  );
};

/** Uygulama hiç açılmadan önce widget galerisinde ve ilk eklemede görünen durum. */
const initial: IOSWidgetProps = {
  empty: true, city: '', country: '', station: '', tz: 'UTC', link: deepLink(null), art: '', clock: false, ...TEXTS.tr,
};

export const nowPlayingWidget = createWidget<IOSWidgetProps>(WIDGET_NAME, NowPlayingLayout, initial);
