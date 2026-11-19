/**
 * <MapLibreGlobe /> — production 3D globe for wGlobe.
 *
 * Rendering is delegated to MapLibre GL JS (globe projection) running inside a
 * hardware-accelerated WebView on iOS/Android and an iframe on web. MapLibre
 * streams Esri World Imagery XYZ tiles (256 px, z0–18) at the device's native
 * pixel ratio, so every zoom level shows the real multi-resolution imagery.
 *
 * Motion:
 *  - The surface fades in over 400 ms (ease-out cubic) once MapLibre reports
 *    `load`, so the WebView's first blank paint is never visible.
 *  - City focus: MapLibre flyTo (zoom-out → great circle → zoom-in parabola).
 *  - Sheet open/close: camera padding eases over 320 ms.
 *  - Haptics: selection tick every 15° of user rotation, light impact on a pin tap.
 */
import * as Haptics from 'expo-haptics';
import { memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ComponentType, type Ref } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { WebView, type WebViewMessageEvent, type WebViewProps } from 'react-native-webview';

import type { City, GlobeThemeId } from '@/types';

import {
  buildGlobeHtml,
  ESRI_ATTRIBUTION,
  ESRI_WORLD_IMAGERY_URL,
  MAPLIBRE_VERSION,
  type GlobeHtmlCity,
  type GlobeHtmlConfig,
} from '../maplibre/globeHtml';

export interface MapLibreGlobeHandle {
  flyTo(options: { lat: number; lon: number; zoom?: number }): void;
}

export interface MapLibreGlobeProps {
  themeId: GlobeThemeId;
  cities?: readonly City[];
  activeCityId?: string | null;
  onCitySelect?: (city: City) => void;
  /** false: no touch input (ambient globe) */
  interactive?: boolean;
  autoRotate?: boolean;
  /** true: animation loop inside the page stops (tab not visible) */
  paused?: boolean;
  /** Shifts the camera focus up by this fraction of the view height. */
  verticalOffset?: number;
  /** Zoom level used when flying to the active city (9 ≈ whole city, 13 ≈ districts). */
  focusZoom?: number;
  initialView?: { lat: number; lon: number; zoom: number };
  showAttribution?: boolean;
  /** Temporary on-screen badge: zoom, loaded satellite tiles, last tile error. */
  debug?: boolean;
  style?: StyleProp<ViewStyle>;
  onReady?: () => void;
  onInteractionStart?: () => void;
  ref?: Ref<MapLibreGlobeHandle>;
}

type PageMessage =
  | { type: 'ready' }
  | { type: 'select'; id: string }
  | { type: 'interaction' }
  | { type: 'detent' }
  | { type: 'error'; message: string }
  | { type: 'fatal'; message: string };

type HostMessage =
  | { type: 'setActive'; id: string | null; flyTo?: { lat: number; lon: number; zoom: number } }
  | { type: 'flyTo'; lat: number; lon: number; zoom: number }
  | { type: 'setTheme'; theme: GlobeThemeId }
  | { type: 'setPadding'; bottomFraction: number }
  | { type: 'setAutoRotate'; value: boolean }
  | { type: 'setInteractive'; value: boolean }
  | { type: 'setPaused'; value: boolean }
  | { type: 'setCities'; cities: GlobeHtmlCity[] };

/**
 * react-native-webview declares `class WebView<P = undefined> extends
 * Component<WebViewProps & P>`; with the default `P` the props collapse to
 * `never` under TypeScript 6. Re-type the same runtime component correctly.
 */
const NativeWebView = WebView as unknown as ComponentType<WebViewProps & { ref?: Ref<WebView> }>;

const BACKGROUND = '#030508';
const MARKER_COLOR = '#C89D54';
const MARKER_ACTIVE_COLOR = '#F5D08A';
const DEFAULT_VIEW = { lat: 30, lon: 25, zoom: 1.7 };

function toHtmlCities(cities: readonly City[]): GlobeHtmlCity[] {
  return cities.map((c) => ({ id: c.id, name: c.name, lat: c.lat, lon: c.lng }));
}

function parseMessage(raw: unknown): PageMessage | null {
  let data = raw;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== 'object' || typeof (data as { type?: unknown }).type !== 'string') return null;
  return data as PageMessage;
}

function MapLibreGlobeComponent({
  themeId,
  cities = [],
  activeCityId = null,
  onCitySelect,
  interactive = true,
  autoRotate = false,
  paused = false,
  verticalOffset = 0,
  focusZoom = 9,
  initialView = DEFAULT_VIEW,
  showAttribution = true,
  debug = false,
  style,
  onReady,
  onInteractionStart,
  ref,
}: MapLibreGlobeProps) {
  const webViewRef = useRef<WebView>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const readyRef = useRef(false);
  const queueRef = useRef<HostMessage[]>([]);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const opacity = useSharedValue(0);
  const fadeStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  const propsRef = useRef({ cities, onCitySelect, onReady, onInteractionStart });
  propsRef.current = { cities, onCitySelect, onReady, onInteractionStart };

  // The page is built once per mount/reload; later changes travel as messages.
  const html = useMemo(() => {
    const active = cities.find((c) => c.id === activeCityId);
    const config: GlobeHtmlConfig = {
      maplibreVersion: MAPLIBRE_VERSION,
      tileUrl: ESRI_WORLD_IMAGERY_URL,
      tileSize: 256,
      sourceMaxZoom: 18,
      cameraMaxZoom: 19,
      attribution: ESRI_ATTRIBUTION,
      cities: toHtmlCities(cities),
      activeId: activeCityId,
      theme: themeId,
      interactive,
      autoRotate,
      bottomPaddingFraction: verticalOffset,
      initial: active ? { lat: active.lat, lon: active.lng, zoom: focusZoom } : initialView,
      markerColor: MARKER_COLOR,
      markerActiveColor: MARKER_ACTIVE_COLOR,
      background: BACKGROUND,
      debug,
    };
    return buildGlobeHtml(config);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey]);

  // ── Host → page ─────────────────────────────────────────────
  const deliver = useCallback((message: HostMessage) => {
    if (Platform.OS === 'web') {
      iframeRef.current?.contentWindow?.postMessage({ __wglobeToPage: true, payload: message }, '*');
    } else {
      const script = `window.__wglobe && window.__wglobe.receive(${JSON.stringify(message)}); true;`;
      webViewRef.current?.injectJavaScript(script);
    }
  }, []);

  const post = useCallback(
    (message: HostMessage) => {
      if (readyRef.current) deliver(message);
      else queueRef.current.push(message);
    },
    [deliver],
  );

  // ── Page → host ─────────────────────────────────────────────
  const handlePageMessage = useCallback(
    (message: PageMessage) => {
      switch (message.type) {
        case 'ready': {
          readyRef.current = true;
          setFailed(false);
          const queued = queueRef.current;
          queueRef.current = [];
          queued.forEach(deliver);
          opacity.value = withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) });
          propsRef.current.onReady?.();
          break;
        }
        case 'select': {
          const city = propsRef.current.cities.find((c) => c.id === message.id);
          if (city) {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
            propsRef.current.onCitySelect?.(city);
          }
          break;
        }
        case 'interaction':
          propsRef.current.onInteractionStart?.();
          break;
        case 'detent':
          void Haptics.selectionAsync().catch(() => undefined);
          break;
        case 'fatal':
          setFailed(true);
          break;
        case 'error':
          // Individual tile failures are expected on flaky networks; MapLibre retries
          // and keeps the parent tile on screen, so nothing is surfaced to the user.
          break;
      }
    },
    [deliver, opacity],
  );

  const onWebViewMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const message = parseMessage(event.nativeEvent.data);
      if (message) handlePageMessage(message);
    },
    [handlePageMessage],
  );

  useEffect(() => {
    if (Platform.OS !== 'web') return undefined;
    const listener = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data as { __wglobe?: boolean; payload?: unknown } | undefined;
      if (!data || !data.__wglobe) return;
      const message = parseMessage(data.payload);
      if (message) handlePageMessage(message);
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, [handlePageMessage]);

  // ── Prop → page synchronisation ─────────────────────────────
  const firstSync = useRef(true);
  useEffect(() => {
    if (firstSync.current) {
      firstSync.current = false;
      return;
    }
    const city = cities.find((c) => c.id === activeCityId);
    post({
      type: 'setActive',
      id: activeCityId,
      flyTo: city ? { lat: city.lat, lon: city.lng, zoom: focusZoom } : undefined,
    });
    // Only a change of the active city triggers a flight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCityId]);

  useEffect(() => post({ type: 'setTheme', theme: themeId }), [themeId, post]);
  useEffect(() => post({ type: 'setPadding', bottomFraction: verticalOffset }), [verticalOffset, post]);
  useEffect(() => post({ type: 'setAutoRotate', value: autoRotate }), [autoRotate, post]);
  useEffect(() => post({ type: 'setInteractive', value: interactive }), [interactive, post]);
  useEffect(() => post({ type: 'setPaused', value: paused }), [paused, post]);
  useEffect(() => post({ type: 'setCities', cities: toHtmlCities(cities) }), [cities, post]);

  useImperativeHandle(
    ref,
    () => ({
      flyTo: ({ lat, lon, zoom }) => post({ type: 'flyTo', lat, lon, zoom: zoom ?? focusZoom }),
    }),
    [post, focusZoom],
  );

  const reload = useCallback(() => {
    readyRef.current = false;
    queueRef.current = [];
    opacity.value = 0;
    setFailed(false);
    setReloadKey((k) => k + 1);
  }, [opacity]);

  return (
    <View style={[styles.root, style]}>
      <Animated.View style={[StyleSheet.absoluteFill, fadeStyle]} pointerEvents={interactive ? 'auto' : 'none'}>
        {Platform.OS === 'web' ? (
          <iframe
            key={reloadKey}
            ref={iframeRef}
            srcDoc={html}
            title="wGlobe"
            style={{ border: 0, width: '100%', height: '100%', background: BACKGROUND, display: 'block' }}
          />
        ) : (
          <NativeWebView
            key={reloadKey}
            ref={webViewRef}
            source={{ html, baseUrl: 'https://wglobe.app/' }}
            originWhitelist={['*']}
            onMessage={onWebViewMessage}
            javaScriptEnabled
            domStorageEnabled
            scrollEnabled={false}
            bounces={false}
            overScrollMode="never"
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
            setSupportMultipleWindows={false}
            androidLayerType="hardware"
            cacheEnabled
            onContentProcessDidTerminate={reload}
            onRenderProcessGone={reload}
            style={styles.webView}
            containerStyle={styles.webView}
          />
        )}
      </Animated.View>

      {failed ? (
        <Pressable onPress={reload} style={styles.retry} accessibilityRole="button" accessibilityLabel="Küreyi yeniden yükle">
          <Text style={styles.retryText}>Bağlantı yok · tekrar dene</Text>
        </Pressable>
      ) : null}

      {showAttribution ? (
        <View style={styles.attribution} pointerEvents="none">
          <Text style={styles.attributionText} numberOfLines={2}>
            {ESRI_ATTRIBUTION} · MapLibre
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: BACKGROUND,
  },
  webView: {
    flex: 1,
    backgroundColor: BACKGROUND,
  },
  retry: {
    position: 'absolute',
    alignSelf: 'center',
    top: '48%',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  retryText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 13,
  },
  attribution: {
    position: 'absolute',
    left: 8,
    right: 8,
    bottom: 4,
    alignItems: 'flex-end',
  },
  attributionText: {
    fontSize: 9,
    lineHeight: 12,
    color: 'rgba(255,255,255,0.5)',
    textAlign: 'right',
  },
});

export const MapLibreGlobe = memo(MapLibreGlobeComponent);
export default MapLibreGlobe;
