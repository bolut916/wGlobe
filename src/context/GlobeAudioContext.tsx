/**
 * GlobeAudioContext — aktif şehir + canlı radyo motoru.
 *
 * Auto-Failover akışı (radyo asla sessiz kalmaz):
 *
 *   selectCity ──► buildPlaybackQueue: [ülke istasyonları…, global yedekler…]
 *                         │
 *                         ▼
 *                 startAttempt(i) ──► replace + play + 5 sn zamanlayıcı
 *                    │          │
 *        çalmaya başladı     hata / 5 sn doldu / akış bitti
 *                    │          │
 *                    ▼          ▼
 *               'playing'   failover → startAttempt(i + 1)   (status: 'failover')
 *               fade-in          │
 *                                └─ sıranın tamamı denendiyse → 'error'
 *
 * Her deneme bir "token" taşır: kullanıcı başka şehre geçtiğinde eski denemenin
 * gecikmeli olayları yeni denemeyi bozamaz.
 *
 * Ses geçişleri: başlarken 600 ms fade-in, istasyon/şehir değişiminde 200 ms
 * fade-out — ani kesilmeler kulağı yorar, yumuşak geçiş "ayar düğmesi çevirme"
 * hissi verir. Uyku zamanlayıcısı son 30 saniyede sesi karesel eğriyle kısar.
 */
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer, type AudioStatus } from 'expo-audio';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { CITIES, getCityById } from '@/constants/cities';
import { DURATION, SLEEP_FADE_MS } from '@/constants/motion';
import { RADIO_CONFIG } from '@/constants/radio';
import { STORAGE_KEYS } from '@/constants/storageKeys';
import { isAbortError } from '@/lib/http';
import { getString, setString } from '@/lib/storage';
import { buildPlaybackQueue, getNextIndex, reportStationClick } from '@/services/radioService';
import type {
  City,
  FavoriteStation,
  PlaybackQueue,
  PlaybackStatus,
  RadioStation,
  SleepTimerMinutes,
  SleepTimerState,
} from '@/types';

import { useUserData } from './UserDataContext';

type StatusWithError = AudioStatus & { error?: string | null };

export interface SleepTimerInfo extends SleepTimerState {
  remainingMs: number;
}

interface GlobeAudioContextValue {
  activeCity: City | null;
  queue: PlaybackQueue | null;
  currentStation: RadioStation | null;
  currentIndex: number;
  status: PlaybackStatus;
  isPlaying: boolean;
  /** loading veya failover — UI'da dönen halka */
  isBusy: boolean;
  isUsingFallback: boolean;
  selectCity: (city: City, options?: { autoplay?: boolean }) => void;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  next: () => void;
  stop: () => void;
  playFavorite: (favorite: FavoriteStation) => void;
  sleepTimer: SleepTimerInfo;
  setSleepTimer: (minutes: SleepTimerMinutes) => void;
  cancelSleepTimer: () => void;
}

const GlobeAudioContext = createContext<GlobeAudioContextValue | null>(null);

/** Hata olayları replace() sonrası eski kaynaktan gecikmeli gelebilir; bu pencerede yok sayılır */
const ERROR_GRACE_MS = 150;
const FADE_STEP_MS = 30;

function favoriteToStation(favorite: FavoriteStation): RadioStation {
  return {
    uuid: favorite.stationUuid,
    name: favorite.stationName,
    streamUrl: favorite.streamUrl,
    homepage: null,
    favicon: null,
    countryCode: favorite.countryCode,
    codec: favorite.streamUrl.toLowerCase().includes('aac') ? 'AAC' : 'MP3',
    bitrate: 0,
    tags: [],
    votes: 0,
    clickCount: 0,
    isFallback: favorite.stationUuid.startsWith('fallback-'),
  };
}

export function GlobeAudioProvider({ children }: { children: ReactNode }) {
  const { recordVisit } = useUserData();
  const recordVisitRef = useRef(recordVisit);
  recordVisitRef.current = recordVisit;

  // ── React durumu (UI'ı besler) ─────────────────────────────
  const [activeCity, setActiveCity] = useState<City | null>(null);
  const [queue, setQueue] = useState<PlaybackQueue | null>(null);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [status, setStatusState] = useState<PlaybackStatus>('idle');
  const [sleepState, setSleepState] = useState<SleepTimerState>({ minutes: null, endsAt: null, isFading: false });
  const [sleepRemainingMs, setSleepRemainingMs] = useState(0);

  // ── Motor durumu (ref: olay dinleyicileri her zaman güncel değeri görür) ──
  const playerRef = useRef<AudioPlayer | null>(null);
  const activeCityRef = useRef<City | null>(null);
  const queueRef = useRef<PlaybackQueue | null>(null);
  const indexRef = useRef(-1);
  const statusRef = useRef<PlaybackStatus>('idle');
  const attemptTokenRef = useRef(0);
  const attemptStartedAtRef = useRef(0);
  const startedRef = useRef(false);
  const failedAttemptsRef = useRef(0);
  const wantsPlaybackRef = useRef(false);
  const startTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const queueAbortRef = useRef<AbortController | null>(null);
  const baseVolumeRef = useRef(1);
  const sleepFactorRef = useRef(1);

  function getPlayer(): AudioPlayer {
    if (!playerRef.current) {
      playerRef.current = createAudioPlayer(null);
    }
    return playerRef.current;
  }

  function setStatus(next: PlaybackStatus): void {
    statusRef.current = next;
    setStatusState(next);
  }

  function targetVolume(): number {
    return baseVolumeRef.current * sleepFactorRef.current;
  }

  function stopFade(): void {
    if (fadeTimerRef.current) {
      clearInterval(fadeTimerRef.current);
      fadeTimerRef.current = null;
    }
  }

  /** Sesi smoothstep eğrisiyle hedefe taşır (lineer fade kulağa "basamaklı" gelir). */
  function fadeVolume(target: number, duration: number, onDone?: () => void): void {
    const player = getPlayer();
    stopFade();
    const from = player.volume;
    if (duration <= 0 || Math.abs(from - target) < 0.01) {
      player.volume = target;
      onDone?.();
      return;
    }
    const startedAt = Date.now();
    fadeTimerRef.current = setInterval(() => {
      const t = Math.min(1, (Date.now() - startedAt) / duration);
      const eased = t * t * (3 - 2 * t);
      player.volume = from + (target - from) * eased;
      if (t >= 1) {
        stopFade();
        onDone?.();
      }
    }, FADE_STEP_MS);
  }

  function clearStartTimeout(): void {
    if (startTimeoutRef.current) {
      clearTimeout(startTimeoutRef.current);
      startTimeoutRef.current = null;
    }
  }

  function updateLockScreen(station: RadioStation): void {
    const city = activeCityRef.current;
    try {
      getPlayer().setActiveForLockScreen(true, {
        title: station.name,
        artist: city ? `${city.name}, ${city.country}` : 'wGlobe',
        albumTitle: station.isFallback ? 'wGlobe · Global Yayın' : 'wGlobe · Canlı Radyo',
        artworkUrl: station.favicon ?? undefined,
      });
    } catch {
      // Kilit ekranı kontrolleri desteklenmiyorsa (web) sessizce geç
    }
  }

  function startAttempt(index: number, isFailover: boolean): void {
    const currentQueue = queueRef.current;
    const station = currentQueue?.stations[index];
    if (!currentQueue || !station) {
      setStatus('error');
      return;
    }

    const token = ++attemptTokenRef.current;
    clearStartTimeout();
    stopFade();
    startedRef.current = false;
    attemptStartedAtRef.current = Date.now();
    indexRef.current = index;
    setCurrentIndex(index);
    setStatus(isFailover ? 'failover' : 'loading');

    const player = getPlayer();
    try {
      player.volume = 0;
      player.replace({ uri: station.streamUrl });
      player.play();
    } catch {
      failover(token);
      return;
    }

    startTimeoutRef.current = setTimeout(() => {
      if (token === attemptTokenRef.current && !startedRef.current) {
        failover(token);
      }
    }, RADIO_CONFIG.playbackStartTimeoutMs);
  }

  function failover(token: number): void {
    if (token !== attemptTokenRef.current || !wantsPlaybackRef.current) return;
    const currentQueue = queueRef.current;
    if (!currentQueue || currentQueue.stations.length === 0) {
      setStatus('error');
      return;
    }
    failedAttemptsRef.current += 1;
    if (failedAttemptsRef.current >= currentQueue.stations.length) {
      // Yerel + global sıranın tamamı denendi: büyük olasılıkla cihaz çevrimdışı
      clearStartTimeout();
      wantsPlaybackRef.current = false;
      attemptTokenRef.current += 1;
      getPlayer().pause();
      setStatus('error');
      return;
    }
    startAttempt(getNextIndex(currentQueue, indexRef.current), true);
  }

  function onStarted(token: number): void {
    if (token !== attemptTokenRef.current) return;
    startedRef.current = true;
    clearStartTimeout();
    failedAttemptsRef.current = 0;
    setStatus('playing');
    fadeVolume(targetVolume(), DURATION.audioFadeIn);

    const station = queueRef.current?.stations[indexRef.current];
    const city = activeCityRef.current;
    if (station) {
      reportStationClick(station);
      updateLockScreen(station);
      void setString(STORAGE_KEYS.lastStationUuid, station.uuid);
    }
    if (city) void recordVisitRef.current(city);
  }

  function handleStatus(nextStatus: StatusWithError): void {
    if (!wantsPlaybackRef.current) return;
    const token = attemptTokenRef.current;
    const hasError =
      Boolean(nextStatus.error) || nextStatus.playbackState === 'failed' || nextStatus.playbackState === 'error';

    if (hasError) {
      if (Date.now() - attemptStartedAtRef.current > ERROR_GRACE_MS) failover(token);
      return;
    }
    if (!startedRef.current && nextStatus.isLoaded && nextStatus.playing && !nextStatus.isBuffering) {
      onStarted(token);
    } else if (startedRef.current && nextStatus.didJustFinish) {
      // Canlı yayın "bitmez"; bittiyse sunucu bağlantıyı kesmiştir
      failover(token);
    }
  }

  async function loadQueue(city: City, preferred?: RadioStation): Promise<PlaybackQueue | null> {
    queueAbortRef.current?.abort();
    const controller = new AbortController();
    queueAbortRef.current = controller;
    setStatus('loading');
    try {
      const built = await buildPlaybackQueue(city.countryCode, { signal: controller.signal });
      if (controller.signal.aborted) return null;
      const finalQueue: PlaybackQueue = preferred
        ? {
            ...built,
            stations: [preferred, ...built.stations.filter((station) => station.uuid !== preferred.uuid && station.streamUrl !== preferred.streamUrl)],
            localCount: built.localCount + (preferred.isFallback ? 0 : 1),
          }
        : built;
      queueRef.current = finalQueue;
      setQueue(finalQueue);
      indexRef.current = 0;
      setCurrentIndex(0);
      return finalQueue;
    } catch (error) {
      if (isAbortError(error) || controller.signal.aborted) return null;
      setStatus('error');
      return null;
    }
  }

  async function play(): Promise<void> {
    const city = activeCityRef.current;
    if (!city) return;
    wantsPlaybackRef.current = true;
    failedAttemptsRef.current = 0;
    sleepFactorRef.current = sleepFactorRef.current > 0 ? sleepFactorRef.current : 1;

    if (!queueRef.current || queueRef.current.countryCode !== city.countryCode) {
      const loaded = await loadQueue(city);
      if (!loaded || activeCityRef.current?.id !== city.id || !wantsPlaybackRef.current) return;
    }
    // Canlı yayında "devam et" eski tamponu çalar; kaynağı yeniden yükleyip canlıya dön
    startAttempt(Math.max(0, indexRef.current), false);
  }

  function pause(): void {
    wantsPlaybackRef.current = false;
    attemptTokenRef.current += 1;
    clearStartTimeout();
    queueAbortRef.current?.abort();
    const wasAudible = statusRef.current === 'playing';
    setStatus('paused');
    if (wasAudible) {
      fadeVolume(0, DURATION.audioCrossfade / 2, () => getPlayer().pause());
    } else {
      stopFade();
      getPlayer().pause();
    }
  }

  function next(): void {
    const currentQueue = queueRef.current;
    if (!currentQueue) {
      void play();
      return;
    }
    wantsPlaybackRef.current = true;
    failedAttemptsRef.current = 0;
    const nextIndex = getNextIndex(currentQueue, indexRef.current);
    const token = ++attemptTokenRef.current;
    clearStartTimeout();
    setStatus('loading');
    fadeVolume(0, DURATION.audioCrossfade / 2, () => {
      if (token === attemptTokenRef.current && wantsPlaybackRef.current) startAttempt(nextIndex, false);
    });
  }

  function selectCity(city: City, options: { autoplay?: boolean } = {}): void {
    const autoplay = options.autoplay ?? true;
    const isSameCity = activeCityRef.current?.id === city.id;
    activeCityRef.current = city;
    setActiveCity(city);
    void setString(STORAGE_KEYS.lastCityId, city.id);

    if (isSameCity && ['playing', 'loading', 'failover'].includes(statusRef.current)) return;

    if (!isSameCity) {
      queueRef.current = null;
      setQueue(null);
      indexRef.current = -1;
      setCurrentIndex(-1);
    }
    if (!autoplay) return;

    // Eski şehrin sesi, yeni sıra yüklenirken yumuşakça çekilir
    if (statusRef.current === 'playing') {
      attemptTokenRef.current += 1;
      fadeVolume(0, DURATION.audioCrossfade / 2);
    }
    void play();
  }

  function playFavorite(favorite: FavoriteStation): void {
    const city =
      CITIES.find((item) => item.name === favorite.cityName) ??
      CITIES.find((item) => item.countryCode === favorite.countryCode) ??
      activeCityRef.current ??
      CITIES[0];
    if (!city) return;
    activeCityRef.current = city;
    setActiveCity(city);
    void setString(STORAGE_KEYS.lastCityId, city.id);
    wantsPlaybackRef.current = true;
    failedAttemptsRef.current = 0;
    if (statusRef.current === 'playing') {
      attemptTokenRef.current += 1;
      fadeVolume(0, DURATION.audioCrossfade / 2);
    }
    void (async () => {
      const loaded = await loadQueue(city, favoriteToStation(favorite));
      if (loaded && wantsPlaybackRef.current && activeCityRef.current?.id === city.id) startAttempt(0, false);
    })();
  }

  function stop(): void {
    pause();
    setStatus('idle');
    try {
      getPlayer().setActiveForLockScreen(false);
    } catch {
      // yok say
    }
  }

  // Dinleyiciler her render'da güncel fonksiyonları görsün
  const engineRef = useRef({ handleStatus, play, pause, next, selectCity, playFavorite, stop, fadeVolume, targetVolume });
  engineRef.current = { handleStatus, play, pause, next, selectCity, playFavorite, stop, fadeVolume, targetVolume };

  // ── Kurulum: ses oturumu, olay dinleyicisi, son şehir ────────
  useEffect(() => {
    let mounted = true;
    void setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'doNotMix',
      allowsRecording: false,
      shouldRouteThroughEarpiece: false,
    }).catch((error: unknown) => {
      if (__DEV__) console.warn('[audio] ses modu ayarlanamadı', error);
    });

    const player = getPlayer();
    const subscription = player.addListener('playbackStatusUpdate', (nextStatus) => {
      engineRef.current.handleStatus(nextStatus as StatusWithError);
    });

    void getString(STORAGE_KEYS.lastCityId).then((cityId) => {
      if (!mounted || !cityId || activeCityRef.current) return;
      const city = getCityById(cityId);
      if (city) engineRef.current.selectCity(city, { autoplay: false });
    });

    return () => {
      mounted = false;
      subscription.remove();
      clearStartTimeout();
      stopFade();
      queueAbortRef.current?.abort();
      try {
        player.remove();
      } catch {
        // zaten serbest bırakılmış
      }
      playerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Uyku zamanlayıcısı ─────────────────────────────────────
  const sleepEndsAt = sleepState.endsAt;
  useEffect(() => {
    if (!sleepEndsAt) return;
    let lastSecond = -1;
    const tick = () => {
      const remaining = sleepEndsAt - Date.now();
      if (remaining <= 0) {
        clearInterval(interval);
        engineRef.current.pause();
        sleepFactorRef.current = 1;
        setSleepState({ minutes: null, endsAt: null, isFading: false });
        setSleepRemainingMs(0);
        return;
      }
      if (remaining <= SLEEP_FADE_MS) {
        const linear = remaining / SLEEP_FADE_MS;
        sleepFactorRef.current = linear * linear;
        if (!fadeTimerRef.current && statusRef.current === 'playing' && playerRef.current) {
          playerRef.current.volume = engineRef.current.targetVolume();
        }
        setSleepState((previous) => (previous.isFading ? previous : { ...previous, isFading: true }));
      }
      const second = Math.ceil(remaining / 1000);
      if (second !== lastSecond) {
        lastSecond = second;
        setSleepRemainingMs(second * 1000);
      }
    };
    const interval = setInterval(tick, 250);
    tick();
    return () => clearInterval(interval);
  }, [sleepEndsAt]);

  const setSleepTimer = useCallback((minutes: SleepTimerMinutes) => {
    sleepFactorRef.current = 1;
    if (statusRef.current === 'playing') {
      engineRef.current.fadeVolume(engineRef.current.targetVolume(), DURATION.audioCrossfade);
    }
    const endsAt = Date.now() + minutes * 60_000;
    setSleepState({ minutes, endsAt, isFading: false });
    setSleepRemainingMs(minutes * 60_000);
  }, []);

  const cancelSleepTimer = useCallback(() => {
    sleepFactorRef.current = 1;
    if (statusRef.current === 'playing') {
      engineRef.current.fadeVolume(engineRef.current.targetVolume(), DURATION.audioCrossfade);
    }
    setSleepState({ minutes: null, endsAt: null, isFading: false });
    setSleepRemainingMs(0);
  }, []);

  // ── Kararlı (stable) dış API ───────────────────────────────
  const stableSelectCity = useCallback((city: City, options?: { autoplay?: boolean }) => engineRef.current.selectCity(city, options), []);
  const stablePlay = useCallback(() => void engineRef.current.play(), []);
  const stablePause = useCallback(() => engineRef.current.pause(), []);
  const stableNext = useCallback(() => engineRef.current.next(), []);
  const stableStop = useCallback(() => engineRef.current.stop(), []);
  const stablePlayFavorite = useCallback((favorite: FavoriteStation) => engineRef.current.playFavorite(favorite), []);
  const stableToggle = useCallback(() => {
    const current = statusRef.current;
    if (current === 'playing' || current === 'loading' || current === 'failover') engineRef.current.pause();
    else void engineRef.current.play();
  }, []);

  const value = useMemo<GlobeAudioContextValue>(() => {
    const currentStation = queue && currentIndex >= 0 ? (queue.stations[currentIndex] ?? null) : null;
    return {
      activeCity,
      queue,
      currentStation,
      currentIndex,
      status,
      isPlaying: status === 'playing',
      isBusy: status === 'loading' || status === 'failover',
      isUsingFallback: Boolean(currentStation?.isFallback),
      selectCity: stableSelectCity,
      play: stablePlay,
      pause: stablePause,
      toggle: stableToggle,
      next: stableNext,
      stop: stableStop,
      playFavorite: stablePlayFavorite,
      sleepTimer: { ...sleepState, remainingMs: sleepRemainingMs },
      setSleepTimer,
      cancelSleepTimer,
    };
  }, [
    activeCity,
    queue,
    currentIndex,
    status,
    sleepState,
    sleepRemainingMs,
    stableSelectCity,
    stablePlay,
    stablePause,
    stableToggle,
    stableNext,
    stableStop,
    stablePlayFavorite,
    setSleepTimer,
    cancelSleepTimer,
  ]);

  return <GlobeAudioContext.Provider value={value}>{children}</GlobeAudioContext.Provider>;
}

export function useGlobeAudio(): GlobeAudioContextValue {
  const context = useContext(GlobeAudioContext);
  if (!context) throw new Error('useGlobeAudio, GlobeAudioProvider içinde kullanılmalı');
  return context;
}
