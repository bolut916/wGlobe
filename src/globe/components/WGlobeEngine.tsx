/**
 * <WGlobeEngine /> — React Native host for the planetary tile engine.
 *
 * Responsibilities kept here (everything else is platform independent):
 *  - expo-gl context bootstrap (three.js needs a canvas-shaped object)
 *  - native tile decoding: expo-file-system download into a persistent disk
 *    cache, uploaded by expo-gl straight from the local file URI
 *  - bundled equirect textures through expo-asset
 *  - multi-touch input → GlobeCameraController (pointer API)
 *  - haptic detents, city picking, attribution, render-loop lifecycle
 *
 * Motion: the canvas fades in over 600 ms (standard ease-out) once the first
 * frame with imagery is on screen, so the black GL clear never flashes.
 * City focus flights use the controller's great-circle parabola (≈1–3.8 s).
 */
import { Asset } from 'expo-asset';
import { Directory, File, Paths } from 'expo-file-system';
import { GLView, type ExpoWebGLRenderingContext } from 'expo-gl';
import * as Haptics from 'expo-haptics';
import { memo, useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { PixelRatio, Platform, StyleSheet, Text, View, type GestureResponderEvent, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import type { City, GlobeThemeId } from '@/types';

import { GlobeRenderer } from '../engine/GlobeRenderer';
import { createBitmapImage, ESRI_WORLD_IMAGERY, WebTileImageDecoder } from '../engine/TileCacheAndLoader';
import {
  EmptyTileError,
  TileHttpError,
  type CameraPose,
  type DecodedTileImage,
  type FlyToOptions,
  type GlobeEngineConfig,
  type GlobeFrameStats,
  type GlobeMarker,
  type GlobeStyleId,
  type OverlayLayerConfig,
  type TileDecodeRequest,
  type TileImageDecoder,
  type TileProviderConfig,
} from '../types/globe';

// ─────────────────────────────────────────────────────────────
//  Native tile decoder (persistent disk cache + expo-gl localUri upload)
// ─────────────────────────────────────────────────────────────

type ExpoTexImage = {
  texImage2D(target: number, level: number, internalFormat: number, format: number, type: number, source: { localUri: string }): void;
};

const TILE_CACHE_DIR = 'wglobe-tiles';
const DISK_CACHE_MAX_BYTES = 220 * 1024 * 1024;
const DISK_CACHE_TRIM_TO_BYTES = 160 * 1024 * 1024;

function localUriImage(localUri: string, byteSize: number): DecodedTileImage {
  return {
    byteSize,
    upload(gl) {
      (gl as unknown as ExpoTexImage).texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, { localUri });
    },
    release() {
      // The file stays on disk: it is the persistent tile cache.
    },
  };
}

function statusFromError(error: unknown): number | null {
  const message = error instanceof Error ? error.message : String(error);
  const match = /\b([1-5]\d\d)\b/.exec(message);
  return match ? Number(match[1]) : null;
}

export class NativeTileImageDecoder implements TileImageDecoder {
  private readonly root: Directory;

  constructor() {
    this.root = new Directory(Paths.cache, TILE_CACHE_DIR);
    if (!this.root.exists) this.root.create({ intermediates: true, idempotent: true });
  }

  private fileFor(provider: TileProviderConfig, z: number, x: number, y: number): File {
    const dir = new Directory(this.root, provider.id);
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    return new File(dir, `${z}_${x}_${y}.${provider.fileExtension}`);
  }

  async decode(request: TileDecodeRequest): Promise<DecodedTileImage> {
    const { provider, coord } = request;
    const byteSize = provider.tileSize * provider.tileSize * 4 * (4 / 3);
    const file = this.fileFor(provider, coord.z, coord.x, coord.y);
    if (file.exists && (file.size ?? 0) > 0) return localUriImage(file.uri, byteSize);
    try {
      const downloaded = await File.downloadFileAsync(request.url, file, {
        headers: provider.headers ? { ...provider.headers } : undefined,
        idempotent: true,
        signal: request.signal,
      });
      if ((downloaded.size ?? 0) === 0) {
        if (downloaded.exists) downloaded.delete();
        throw new EmptyTileError();
      }
      return localUriImage(downloaded.uri, byteSize);
    } catch (error) {
      if (error instanceof EmptyTileError) throw error;
      if (request.signal.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
      if (file.exists) file.delete();
      const status = statusFromError(error);
      if (status !== null && (status === 404 || status === 204) && provider.emptyTileOn404) throw new EmptyTileError();
      if (status !== null) throw new TileHttpError(status);
      throw error;
    }
  }

  /** Keeps the disk cache bounded: oldest files go first. */
  trimDiskCache(): void {
    try {
      const files: Array<{ file: File; size: number; mtime: number }> = [];
      let total = 0;
      const walk = (dir: Directory): void => {
        for (const item of dir.list()) {
          if (item instanceof Directory) walk(item);
          else {
            const info = item.info();
            const size = info.size ?? 0;
            total += size;
            files.push({ file: item, size, mtime: info.modificationTime ?? 0 });
          }
        }
      };
      walk(this.root);
      if (total <= DISK_CACHE_MAX_BYTES) return;
      files.sort((a, b) => a.mtime - b.mtime);
      for (const entry of files) {
        if (total <= DISK_CACHE_TRIM_TO_BYTES) break;
        entry.file.delete();
        total -= entry.size;
      }
    } catch {
      // Cache trimming is best-effort; a failure must never affect rendering.
    }
  }
}

// ─────────────────────────────────────────────────────────────
//  Bundled equirect textures
// ─────────────────────────────────────────────────────────────

const GLOBAL_TEXTURE_MODULES = {
  baseDay: require('../../../assets/globe/earth-base.jpg') as number,
  nightLights: require('../../../assets/globe/earth-lights.jpg') as number,
  clouds: require('../../../assets/globe/earth-clouds.jpg') as number,
  waterMask: require('../../../assets/globe/earth-water.jpg') as number,
};

async function loadBundledImage(moduleId: number): Promise<DecodedTileImage | undefined> {
  try {
    const asset = Asset.fromModule(moduleId);
    await asset.downloadAsync();
    if (Platform.OS === 'web') {
      const response = await fetch(asset.localUri ?? asset.uri);
      const bitmap = await createImageBitmap(await response.blob(), { imageOrientation: 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
      return createBitmapImage(bitmap);
    }
    const uri = asset.localUri ?? asset.uri;
    return localUriImage(uri, (asset.width ?? 2048) * (asset.height ?? 1024) * 4 * (4 / 3));
  } catch {
    return undefined;
  }
}

// ─────────────────────────────────────────────────────────────
//  Component
// ─────────────────────────────────────────────────────────────

export interface WGlobeEngineHandle {
  flyTo(options: FlyToOptions): void;
  getPose(): CameraPose | null;
  getStats(): GlobeFrameStats | null;
}

export interface WGlobeEngineProps {
  themeId: GlobeThemeId;
  cities?: readonly City[];
  activeCityId?: string | null;
  onCitySelect?: (city: City) => void;
  /** false: no touch input (ambient globe) */
  interactive?: boolean;
  autoRotate?: boolean;
  showMarkers?: boolean;
  /** true: render loop stops (tab not visible) */
  paused?: boolean;
  /** Shifts the globe up by this fraction of the view height. */
  verticalOffset?: number;
  /** Camera range used when focusing the active city (meters). */
  focusAltitude?: number;
  initialView?: { lat: number; lon: number; altitude: number };
  provider?: TileProviderConfig;
  overlays?: readonly OverlayLayerConfig[];
  config?: Partial<GlobeEngineConfig>;
  showAttribution?: boolean;
  style?: StyleProp<ViewStyle>;
  onReady?: () => void;
  onInteractionStart?: () => void;
  onStats?: (stats: GlobeFrameStats) => void;
  ref?: Ref<WGlobeEngineHandle>;
}

const THEME_TO_STYLE: Readonly<Record<GlobeThemeId, GlobeStyleId>> = {
  classic: 'realistic',
  parchment: 'parchment',
  night_lights: 'night',
  swiss_minimal: 'mono',
};

const MARKER_COLOR = '#C89D54';
const MARKER_ACTIVE_COLOR = '#F5D08A';
/** expo-gl rejects these pixelStorei parameters (FLIP_Y, PREMULTIPLY_ALPHA, COLORSPACE_CONVERSION). */
const UNSUPPORTED_PIXEL_STORE = new Set([0x9240, 0x9241, 0x9243]);
const IDLE_FRAME_INTERVAL_MS = 1000 / 30;
const STATS_INTERVAL_MS = 500;

function nowMs(): number {
  return performance.now();
}

function WGlobeEngineComponent({
  themeId,
  cities = [],
  activeCityId = null,
  onCitySelect,
  interactive = true,
  autoRotate = false,
  showMarkers = true,
  paused = false,
  verticalOffset = 0,
  focusAltitude = 1_400_000,
  initialView,
  provider = ESRI_WORLD_IMAGERY,
  overlays,
  config,
  showAttribution = true,
  style,
  onReady,
  onInteractionStart,
  onStats,
  ref,
}: WGlobeEngineProps) {
  const engineRef = useRef<GlobeRenderer | null>(null);
  const glRef = useRef<ExpoWebGLRenderingContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastRenderRef = useRef(0);
  const lastStatsRef = useRef(0);
  const disposedRef = useRef(false);
  const readyRef = useRef(false);
  const firstFrameRef = useRef(-1);
  const layoutRef = useRef({ width: 0, height: 0 });
  const decoderRef = useRef<NativeTileImageDecoder | null>(null);
  const [glKey, setGlKey] = useState(0);
  const opacity = useSharedValue(0);

  // Latest props for callbacks created once.
  const propsRef = useRef({ cities, onCitySelect, interactive, paused, onReady, onInteractionStart, onStats });
  propsRef.current = { cities, onCitySelect, interactive, paused, onReady, onInteractionStart, onStats };

  const fadeStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  // ── Render loop ─────────────────────────────────────────────
  const stopLoop = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }, []);

  const tick = useCallback(() => {
    rafRef.current = null;
    const engine = engineRef.current;
    const gl = glRef.current;
    if (!engine || !gl || disposedRef.current || propsRef.current.paused) return;
    const now = nowMs();
    // Full rate while anything moves or streams; 30 fps otherwise (cloud drift, pin pulse).
    if (engine.wantsFrame || now - lastRenderRef.current >= IDLE_FRAME_INTERVAL_MS) {
      const stats = engine.frame(now);
      gl.endFrameEXP?.();
      lastRenderRef.current = now;
      if (firstFrameRef.current < 0) firstFrameRef.current = now;
      // Reveal once the root imagery is on the GPU, or after 1.5 s (offline: base texture).
      if (!readyRef.current && (stats.cachedTextures >= 8 || now - firstFrameRef.current > 1500)) {
        readyRef.current = true;
        opacity.value = withTiming(1, { duration: 600, easing: Easing.out(Easing.cubic) });
        propsRef.current.onReady?.();
      }
      if (propsRef.current.onStats && now - lastStatsRef.current > STATS_INTERVAL_MS) {
        lastStatsRef.current = now;
        propsRef.current.onStats(stats);
      }
    }
    rafRef.current = requestAnimationFrame(tick);
  }, [opacity]);

  const startLoop = useCallback(() => {
    if (rafRef.current === null && !disposedRef.current) rafRef.current = requestAnimationFrame(tick);
  }, [tick]);

  // ── Context bootstrap ───────────────────────────────────────
  const onContextCreate = useCallback(
    (gl: ExpoWebGLRenderingContext) => {
      if (disposedRef.current) return;
      glRef.current = gl;
      if (Platform.OS !== 'web') {
        const original = gl.pixelStorei.bind(gl);
        gl.pixelStorei = (pname: number, param: number | boolean) => {
          if (UNSUPPORTED_PIXEL_STORE.has(pname)) return;
          original(pname, param as number);
        };
      }
      const width = gl.drawingBufferWidth;
      const height = gl.drawingBufferHeight;
      const canvas =
        Platform.OS === 'web' && (gl as unknown as WebGL2RenderingContext).canvas
          ? ((gl as unknown as WebGL2RenderingContext).canvas as HTMLCanvasElement)
          : ({
              width,
              height,
              clientWidth: width,
              clientHeight: height,
              style: {},
              addEventListener: () => undefined,
              removeEventListener: () => undefined,
              getContext: () => gl,
            } as unknown as HTMLCanvasElement);

      let decoder: TileImageDecoder;
      if (Platform.OS === 'web') decoder = new WebTileImageDecoder();
      else {
        const nativeDecoder = new NativeTileImageDecoder();
        decoderRef.current = nativeDecoder;
        decoder = nativeDecoder;
        setTimeout(() => nativeDecoder.trimDiskCache(), 4000);
      }

      const layoutWidth = layoutRef.current.width || width / PixelRatio.get();
      const pixelRatio = width / Math.max(1, layoutWidth);
      const engine = new GlobeRenderer({
        gl: gl as unknown as WebGL2RenderingContext,
        canvas,
        width,
        height,
        pixelRatio,
        decoder,
        provider,
        overlays: overlays ?? [],
        config: { ...(Platform.OS === 'web' ? { maxConcurrentRequests: 8 } : null), ...config },
        initialView,
        antialias: true,
        events: {
          onDetent: () => {
            void Haptics.selectionAsync().catch(() => undefined);
          },
          onTap: (x, y) => {
            const current = engineRef.current;
            if (!current) return;
            const marker = current.pickMarker(x, y);
            if (!marker) return;
            const city = propsRef.current.cities.find((c) => c.id === marker.id);
            if (city) {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
              propsRef.current.onCitySelect?.(city);
            }
          },
          onInteractionStart: () => propsRef.current.onInteractionStart?.(),
        },
      });
      engineRef.current = engine;
      engine.setStyle(THEME_TO_STYLE[themeId]);
      engine.setVerticalOffset(verticalOffset);
      engine.controller.autoRotate = autoRotate;
      engine.controller.enabled = interactive;

      void Promise.all([
        loadBundledImage(GLOBAL_TEXTURE_MODULES.baseDay),
        loadBundledImage(GLOBAL_TEXTURE_MODULES.nightLights),
        loadBundledImage(GLOBAL_TEXTURE_MODULES.clouds),
        loadBundledImage(GLOBAL_TEXTURE_MODULES.waterMask),
      ]).then(([baseDay, nightLights, clouds, waterMask]) => {
        const current = engineRef.current;
        if (!current || disposedRef.current || current !== engine) {
          for (const image of [baseDay, nightLights, clouds, waterMask]) image?.release();
          return;
        }
        current.setGlobalTextures({ baseDay, nightLights, clouds, waterMask });
      });

      if (Platform.OS === 'web') {
        const element = (gl as unknown as WebGL2RenderingContext).canvas as HTMLCanvasElement | undefined;
        element?.addEventListener(
          'wheel',
          (event: WheelEvent) => {
            event.preventDefault();
            const rect = element.getBoundingClientRect();
            engineRef.current?.controller.wheel(event.clientX - rect.left, event.clientY - rect.top, event.deltaY, nowMs());
            engineRef.current?.requestFrame();
          },
          { passive: false },
        );
      }
      setGlKey((k) => k + 1);
      startLoop();
    },
    // The context is created once; later prop changes flow through the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // ── Prop → engine synchronisation ───────────────────────────
  useEffect(() => {
    engineRef.current?.setStyle(THEME_TO_STYLE[themeId]);
  }, [themeId, glKey]);

  useEffect(() => {
    engineRef.current?.setVerticalOffset(verticalOffset);
  }, [verticalOffset, glKey]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.controller.autoRotate = autoRotate;
    engine.controller.enabled = interactive;
    if (!interactive) engine.controller.pointerCancel();
  }, [autoRotate, interactive, glKey]);

  useEffect(() => {
    engineRef.current?.setProvider(provider);
  }, [provider, glKey]);

  useEffect(() => {
    engineRef.current?.setOverlays(overlays ?? []);
  }, [overlays, glKey]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const markers: GlobeMarker[] = showMarkers
      ? cities.map((c) => ({ id: c.id, lat: c.lat, lon: c.lng, color: c.id === activeCityId ? MARKER_ACTIVE_COLOR : MARKER_COLOR }))
      : [];
    engine.setMarkers(markers, activeCityId);
  }, [cities, activeCityId, showMarkers, glKey]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !activeCityId) return;
    const city = cities.find((c) => c.id === activeCityId);
    if (!city) return;
    const pose = engine.controller.getPose();
    engine.flyTo({ lat: city.lat, lon: city.lng, altitude: Math.min(pose.altitude, focusAltitude) });
    // Only a change of the active city triggers a flight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCityId, glKey]);

  useEffect(() => {
    if (paused) stopLoop();
    else if (engineRef.current) {
      engineRef.current.requestFrame();
      startLoop();
    }
  }, [paused, startLoop, stopLoop]);

  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
      stopLoop();
      engineRef.current?.dispose();
      engineRef.current = null;
      glRef.current = null;
    };
  }, [stopLoop]);

  useImperativeHandle(
    ref,
    () => ({
      flyTo: (options) => engineRef.current?.flyTo(options),
      getPose: () => engineRef.current?.controller.getPose() ?? null,
      getStats: () => engineRef.current?.stats ?? null,
    }),
    [],
  );

  // ── Input ───────────────────────────────────────────────────
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    layoutRef.current = { width, height };
    const gl = glRef.current;
    const engine = engineRef.current;
    if (gl && engine && width > 0) engine.setSize(gl.drawingBufferWidth, gl.drawingBufferHeight, gl.drawingBufferWidth / width);
  }, []);

  const activeTouches = useRef(new Set<number>());

  const syncTouches = useCallback((event: GestureResponderEvent, phase: 'start' | 'move' | 'end') => {
    const engine = engineRef.current;
    if (!engine) return;
    const now = nowMs();
    const touches = event.nativeEvent.touches;
    const present = new Set<number>();
    for (const t of touches) {
      const id = Number(t.identifier);
      present.add(id);
      if (!activeTouches.current.has(id)) {
        activeTouches.current.add(id);
        engine.controller.pointerDown(id, t.locationX, t.locationY, now);
      } else if (phase === 'move') {
        engine.controller.pointerMove(id, t.locationX, t.locationY, now);
      }
    }
    for (const id of [...activeTouches.current]) {
      if (!present.has(id)) {
        activeTouches.current.delete(id);
        engine.controller.pointerUp(id, now);
      }
    }
    engine.requestFrame();
  }, []);

  const responderHandlers = interactive
    ? {
        onStartShouldSetResponder: () => true,
        onMoveShouldSetResponder: () => true,
        onResponderTerminationRequest: () => false,
        onResponderGrant: (e: GestureResponderEvent) => syncTouches(e, 'start'),
        onResponderMove: (e: GestureResponderEvent) => syncTouches(e, 'move'),
        onResponderRelease: (e: GestureResponderEvent) => syncTouches(e, 'end'),
        onResponderTerminate: () => {
          activeTouches.current.clear();
          engineRef.current?.controller.pointerCancel();
        },
      }
    : {};

  return (
    <View style={[styles.root, style]} onLayout={onLayout}>
      <Animated.View style={[StyleSheet.absoluteFill, fadeStyle]} {...responderHandlers}>
        <GLView style={StyleSheet.absoluteFill} onContextCreate={onContextCreate} msaaSamples={4} />
      </Animated.View>
      {showAttribution ? (
        <View style={styles.attribution} pointerEvents="none">
          <Text style={styles.attributionText} numberOfLines={2}>
            {[provider.attribution, ...(overlays ?? []).map((o) => o.attribution)].join(' · ')}
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
    backgroundColor: '#030508',
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

export const WGlobeEngine = memo(WGlobeEngineComponent);
export default WGlobeEngine;
