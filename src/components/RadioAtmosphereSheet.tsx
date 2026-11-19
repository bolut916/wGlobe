/**
 * RadioAtmosphereSheet — şehir seçildiğinde açılan "atmosfer kartı".
 *
 * KOREOGRAFİ
 *  Giriş  : sheet aşağıdan yay ile gelir (SPRING.sheet, ağır ve fiziksel),
 *           içerik satırları 45 ms arayla süzülür:
 *           şehir adı → saat → hava → istasyon → kontroller
 *           (göz önce "neredeyim", sonra "ne zaman", sonra "ne dinliyorum" sorusunu cevaplar)
 *  Çıkış  : 240 ms exit eğrisiyle aşağı — girişten kısa, kullanıcı beklemez
 *  Sürükle: aşağı çekince parmağı izler, yukarıda lastik direnç (×0.25);
 *           110 px veya hızlı fırlatma → kapanır, aksi hâlde yayla geri oturur
 *  Şehir değişimi: sheet yerinde kalır, içerik yeniden kademeli girer
 *
 * DURUM GERİ BİLDİRİMİ
 *  Oynat butonu: Play ⇄ Pause çapraz geçiş (180 ms) + yüklenirken dönen halka.
 *  Favori: kalp "pop" yayı + başarı haptiği.
 */
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { Globe2, Heart, Pause, Play, Radio, SkipForward, Wind, X } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { PanResponder, Platform, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { COLORS, RADII, SPACING, TYPOGRAPHY } from '@/constants/colors';
import { DURATION, SPRING, STAGGER } from '@/constants/motion';
import { useGlobeAudio } from '@/context/GlobeAudioContext';
import { useUserData } from '@/context/UserDataContext';
import { useCityClock } from '@/hooks/useCityClock';
import { useWeather } from '@/hooks/useWeather';
import { easeExit, easeStandard, enterUp, fadeIn } from '@/lib/animations';
import { countryCodeToFlag } from '@/lib/flags';
import type { City, PlaybackStatus } from '@/types';

import { IconButton } from './IconButton';
import { PressableScale } from './PressableScale';
import { WeatherIcon } from './WeatherIcon';

interface RadioAtmosphereSheetProps {
  visible: boolean;
  city: City | null;
  onClose: () => void;
}

const DISMISS_DISTANCE = 110;
const DISMISS_VELOCITY = 0.9;
const OFFSCREEN = 800;

function statusLine(status: PlaybackStatus, isFallback: boolean, codec?: string, bitrate?: number): string {
  switch (status) {
    case 'loading':
      return 'Yayın aranıyor…';
    case 'failover':
      return 'Yayın yanıt vermedi, sıradakine geçiliyor…';
    case 'playing':
      if (isFallback) return 'Bu ülkeden canlı yayın bulunamadı · Global yayın';
      return [codec, bitrate ? `${bitrate} kbps` : null, 'Canlı'].filter(Boolean).join(' · ');
    case 'error':
      return 'Şu an yayın alınamıyor. Bağlantını kontrol edip tekrar dene.';
    case 'paused':
      return 'Duraklatıldı';
    default:
      return 'Dinlemek için oynat’a dokun';
  }
}

function PlayButton({ active, busy, onPress }: { active: boolean; busy: boolean; onPress: () => void }) {
  const spin = useSharedValue(0);

  useEffect(() => {
    if (busy) {
      spin.value = 0;
      spin.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.linear }), -1, false);
    } else {
      cancelAnimation(spin);
      spin.value = 0;
    }
  }, [busy, spin]);

  const playStyle = useAnimatedStyle(() => ({
    opacity: withTiming(active ? 0 : 1, { duration: DURATION.toggle, easing: easeStandard }),
    transform: [{ scale: withTiming(active ? 0.6 : 1, { duration: DURATION.toggle, easing: easeStandard }) }],
  }));
  const pauseStyle = useAnimatedStyle(() => ({
    opacity: withTiming(active ? 1 : 0, { duration: DURATION.toggle, easing: easeStandard }),
    transform: [{ scale: withTiming(active ? 1 : 0.6, { duration: DURATION.toggle, easing: easeStandard }) }],
  }));
  const ringStyle = useAnimatedStyle(() => ({
    opacity: withTiming(busy ? 1 : 0, { duration: DURATION.toggle }),
    transform: [{ rotate: `${spin.value * 360}deg` }],
  }));

  return (
    <PressableScale
      onPress={onPress}
      haptic="medium"
      scaleTo={0.92}
      accessibilityRole="button"
      accessibilityLabel={active ? 'Duraklat' : 'Oynat'}
      accessibilityState={{ busy }}
      style={styles.playButton}
    >
      <Animated.View pointerEvents="none" style={[styles.playRing, ringStyle]} />
      <Animated.View style={[styles.playIcon, playStyle]}>
        <Play size={26} color={COLORS.textInverse} fill={COLORS.textInverse} />
      </Animated.View>
      <Animated.View style={[styles.playIcon, pauseStyle]}>
        <Pause size={26} color={COLORS.textInverse} fill={COLORS.textInverse} />
      </Animated.View>
    </PressableScale>
  );
}

function FavoriteButton({ active, disabled, onPress }: { active: boolean; disabled: boolean; onPress: () => void }) {
  const scale = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <PressableScale
      onPress={() => {
        scale.value = withSequence(withTiming(1.25, { duration: DURATION.press }), withSpring(1, SPRING.pop));
        onPress();
      }}
      disabled={disabled}
      scaleTo={0.9}
      accessibilityRole="button"
      accessibilityLabel={active ? 'Favorilerden çıkar' : 'Favorilere ekle'}
      accessibilityState={{ selected: active, disabled }}
      style={[styles.sideButton, disabled && styles.disabled]}
    >
      <Animated.View style={style}>
        <Heart size={22} color={active ? COLORS.brass : COLORS.textPrimary} fill={active ? COLORS.brass : 'transparent'} />
      </Animated.View>
    </PressableScale>
  );
}

export function RadioAtmosphereSheet({ visible, city, onClose }: RadioAtmosphereSheetProps) {
  const { status, currentStation, isBusy, isPlaying, isUsingFallback, toggle, next, queue } = useGlobeAudio();
  const { isFavorite, toggleFavorite } = useUserData();

  const [renderedCity, setRenderedCity] = useState<City | null>(visible ? city : null);
  const heightRef = useRef(360);
  const translateY = useSharedValue(OFFSCREEN);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clock = useCityClock(renderedCity?.timezone);
  const weather = useWeather(renderedCity);

  // ── Giriş / çıkış ──────────────────────────────────────────
  useEffect(() => {
    if (clearTimerRef.current) {
      clearTimeout(clearTimerRef.current);
      clearTimerRef.current = null;
    }
    if (visible && city) {
      setRenderedCity(city);
      translateY.value = withSpring(0, SPRING.sheet);
    } else {
      translateY.value = withTiming(heightRef.current + 48, { duration: DURATION.sheetClose, easing: easeExit });
      clearTimerRef.current = setTimeout(() => setRenderedCity(null), DURATION.sheetClose + 20);
    }
    return () => {
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    };
  }, [visible, city, translateY]);

  // ── Sürükleyerek kapatma ───────────────────────────────────
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dy) > 6 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
      onPanResponderMove: (_event, gesture) => {
        translateY.value = gesture.dy > 0 ? gesture.dy : gesture.dy * 0.25;
      },
      onPanResponderRelease: (_event, gesture) => {
        if (gesture.dy > DISMISS_DISTANCE || gesture.vy > DISMISS_VELOCITY) {
          void Haptics.selectionAsync().catch(() => undefined);
          onCloseRef.current();
        } else {
          translateY.value = withSpring(0, SPRING.sheet);
        }
      },
      onPanResponderTerminate: () => {
        translateY.value = withSpring(0, SPRING.sheet);
      },
    }),
  ).current;

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));

  const onLayout = (event: LayoutChangeEvent) => {
    heightRef.current = event.nativeEvent.layout.height;
  };

  if (!renderedCity) return null;

  const favorite = currentStation ? isFavorite(currentStation.uuid) : false;
  const handleFavorite = () => {
    if (!currentStation || !renderedCity) return;
    toggleFavorite(currentStation, renderedCity)
      .then((added) => {
        void Haptics.notificationAsync(
          added ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning,
        ).catch(() => undefined);
      })
      .catch(() => {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
      });
  };

  const rowEnter = (index: number) => enterUp(index, { step: STAGGER.sheetRows, base: 80 });
  const stationTitle =
    currentStation?.name ?? (status === 'loading' ? 'İstasyonlar taranıyor' : `${renderedCity.country} radyoları`);

  return (
    <Animated.View style={[styles.sheet, sheetStyle]} onLayout={onLayout} accessibilityViewIsModal={false}>
      {Platform.OS === 'ios' ? (
        <BlurView intensity={45} tint="dark" style={StyleSheet.absoluteFill} />
      ) : null}
      <View style={[StyleSheet.absoluteFill, styles.sheetTint]} />

      <View {...panResponder.panHandlers} style={styles.dragZone}>
        <View style={styles.handle} />
      </View>

      <View key={renderedCity.id} style={styles.content}>
        {/* 1 — Şehir */}
        <Animated.View entering={rowEnter(0)} style={styles.headerRow} {...panResponder.panHandlers}>
          <View style={styles.headerTexts}>
            <Text style={styles.overline}>
              {countryCodeToFlag(renderedCity.countryCode)}  {renderedCity.country.toLocaleUpperCase('tr-TR')} · {renderedCity.vibeTag}
            </Text>
            <Text style={styles.cityName} numberOfLines={1} accessibilityRole="header">
              {renderedCity.name}
            </Text>
          </View>
          <IconButton icon={X} onPress={onClose} accessibilityLabel="Kartı kapat" size={18} />
        </Animated.View>

        {/* 2 — Saat & 3 — Hava */}
        <Animated.View entering={rowEnter(1)} style={styles.infoRow}>
          <View style={styles.infoBlock}>
            <Text style={styles.clock} accessibilityLabel={`Yerel saat ${clock?.time ?? ''}`}>
              {clock?.time ?? '--:--:--'}
            </Text>
            <Text style={styles.infoMeta} numberOfLines={1}>
              {clock ? `${clock.date} · ${clock.utcOffset} · ${clock.relative}` : ' '}
            </Text>
          </View>
          <View style={styles.divider} />
          <View style={[styles.infoBlock, styles.weatherBlock]}>
            {weather.data ? (
              <Animated.View key={weather.data.fetchedAt} entering={fadeIn(0, DURATION.toggle)} style={styles.weatherInner}>
                <View style={styles.weatherTop}>
                  <WeatherIcon name={weather.data.icon} size={22} />
                  <Text style={styles.temperature}>{weather.data.temperatureLabel}</Text>
                </View>
                <Text style={styles.infoMeta} numberOfLines={1}>
                  {weather.data.description}
                </Text>
                <View style={styles.windRow}>
                  <Wind size={12} color={COLORS.textTertiary} />
                  <Text style={styles.windText}>{Math.round(weather.data.windSpeed)} km/s</Text>
                </View>
              </Animated.View>
            ) : (
              <Text style={styles.infoMeta}>{weather.isLoading ? 'Hava durumu…' : (weather.error ?? ' ')}</Text>
            )}
          </View>
        </Animated.View>

        {/* 4 — İstasyon */}
        <Animated.View entering={rowEnter(2)} style={styles.stationRow}>
          <View style={[styles.stationIcon, isPlaying && styles.stationIconLive]}>
            {isUsingFallback ? (
              <Globe2 size={18} color={COLORS.brass} />
            ) : (
              <Radio size={18} color={isPlaying ? COLORS.brass : COLORS.textSecondary} />
            )}
          </View>
          <Animated.View key={currentStation?.uuid ?? status} entering={fadeIn(0, DURATION.toggle)} style={styles.stationTexts}>
            <Text style={styles.stationName} numberOfLines={1}>
              {stationTitle}
            </Text>
            <Text
              style={[styles.stationStatus, status === 'error' && styles.stationStatusError]}
              numberOfLines={2}
              accessibilityLiveRegion="polite"
            >
              {statusLine(status, isUsingFallback, currentStation?.codec, currentStation?.bitrate)}
            </Text>
          </Animated.View>
        </Animated.View>

        {/* 5 — Kontroller */}
        <Animated.View entering={rowEnter(3)} style={styles.controls}>
          <FavoriteButton active={favorite} disabled={!currentStation} onPress={handleFavorite} />
          <PlayButton active={isPlaying || isBusy} busy={isBusy} onPress={toggle} />
          <PressableScale
            onPress={next}
            haptic="selection"
            scaleTo={0.9}
            disabled={!queue || queue.stations.length < 2}
            accessibilityRole="button"
            accessibilityLabel="Sonraki istasyon"
            style={[styles.sideButton, (!queue || queue.stations.length < 2) && styles.disabled]}
          >
            <SkipForward size={22} color={COLORS.textPrimary} />
          </PressableScale>
        </Animated.View>
      </View>
    </Animated.View>
  );
}

const PLAY_SIZE = 68;

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: SPACING.md,
    right: SPACING.md,
    bottom: SPACING.md,
    borderRadius: RADII.sheet,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.border,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 16,
  },
  sheetTint: {
    backgroundColor: Platform.OS === 'ios' ? 'rgba(11, 15, 25, 0.62)' : 'rgba(17, 23, 38, 0.97)',
  },
  dragZone: {
    alignItems: 'center',
    paddingTop: SPACING.sm + 2,
    paddingBottom: SPACING.xs,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.borderStrong,
  },
  content: {
    paddingHorizontal: SPACING.xl,
    paddingBottom: SPACING.xl,
    gap: SPACING.lg,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
  },
  headerTexts: {
    flex: 1,
    gap: 2,
  },
  overline: {
    ...TYPOGRAPHY.overline,
    color: COLORS.brass,
  },
  cityName: {
    ...TYPOGRAPHY.title,
    color: COLORS.textPrimary,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: COLORS.brassMuted,
    borderRadius: RADII.lg,
    padding: SPACING.lg,
    gap: SPACING.lg,
  },
  infoBlock: {
    flex: 1.3,
    justifyContent: 'center',
    gap: 2,
  },
  weatherBlock: {
    flex: 1,
  },
  weatherInner: {
    gap: 2,
  },
  divider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.borderBrass,
  },
  clock: {
    ...TYPOGRAPHY.mono,
    fontSize: 26,
    lineHeight: 32,
    color: COLORS.textPrimary,
  },
  infoMeta: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textSecondary,
  },
  weatherTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  temperature: {
    ...TYPOGRAPHY.heading,
    color: COLORS.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  windRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  windText: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textTertiary,
  },
  stationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
  },
  stationIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surfaceElevated,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  stationIconLive: {
    borderColor: COLORS.borderBrass,
  },
  stationTexts: {
    flex: 1,
    gap: 2,
  },
  stationName: {
    ...TYPOGRAPHY.bodyStrong,
    color: COLORS.textPrimary,
  },
  stationStatus: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textSecondary,
  },
  stationStatusError: {
    color: COLORS.error,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
    paddingTop: SPACING.xs,
  },
  sideButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surfaceElevated,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  disabled: {
    opacity: 0.4,
  },
  playButton: {
    width: PLAY_SIZE,
    height: PLAY_SIZE,
    borderRadius: PLAY_SIZE / 2,
    backgroundColor: COLORS.brass,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: COLORS.brass,
    shadowOpacity: 0.45,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  playIcon: {
    position: 'absolute',
  },
  playRing: {
    position: 'absolute',
    width: PLAY_SIZE + 10,
    height: PLAY_SIZE + 10,
    borderRadius: (PLAY_SIZE + 10) / 2,
    borderWidth: 2,
    borderColor: COLORS.brassLight,
    borderTopColor: 'transparent',
    borderRightColor: 'transparent',
  },
});

export default RadioAtmosphereSheet;
