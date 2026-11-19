/**
 * InteractiveGlobe — expo-gl + saf Three.js küre motoru.
 *
 * HAREKET SENARYOSU
 *  - Sürükleme: küre parmağa 1:1 yapışır (doğrudan manipülasyon = güven).
 *  - Bırakma: parmağın hızı eylemsizliğe aktarılır, her karede hız *= 0.95
 *    (kare hızından bağımsız: 0.95^(dt·60)). Fiziksel, ağır bir küre hissi.
 *  - Haptik: kullanıcı kaynaklı dönüşte her 15°'de bir selectionAsync — hızlı
 *    çevirince "tık tık tık", yavaşken seyrek: bir kadranın dişleri gibi.
 *  - Dokunma: Raycaster ile en yakın pin bulunur; küre en kısa açısal yoldan
 *    lerp ile şehri kameranın tam karşısına getirir (slow-out yerleşme).
 *  - Boşta: son etkileşimden 4 sn sonra ambiyans dönüşü 1.2 sn'de yumuşakça
 *    hızlanarak başlar (slow-in) — küre "nefes alır", asla aniden kalkmaz.
 *  - Tema değişimi: shader renkleri 700 ms'de easeInOutCubic ile morflanır.
 *  - Aktif şehir: pin büyür, etrafında 1.6 sn'lik nabız halkası yayılır.
 *  - İlk kare: GLView 600 ms'de belirir (siyah GL flaşı gizlenir).
 *  - Reduce Motion açıksa: ambiyans dönüşü yok, odak geçişi anlık.
 *
 * BELLEK
 *  Unmount'ta requestAnimationFrame iptal edilir; tüm geometry, material ve
 *  renderer dispose() edilir. Arka planda (AppState) ve `paused` iken render
 *  döngüsü tamamen durur.
 */
import { GLView, type ExpoWebGLRenderingContext } from 'expo-gl';
import * as Haptics from 'expo-haptics';
import { memo, useCallback, useEffect, useRef } from 'react';
import { AppState, PanResponder, StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import * as THREE from 'three';

import { CITIES } from '@/constants/cities';
import { COLORS } from '@/constants/colors';
import { DURATION, GLOBE_PHYSICS } from '@/constants/motion';
import { getGlobeTheme, hexToRgbNormalized } from '@/constants/themes';
import { easeEnter, easeInOutCubic } from '@/lib/animations';
import { DEG2RAD, RAD2DEG, clamp, getFocusRotation, getSunDirection, latLngToVector3, lerp, lerpAngle, shortestAngleDelta } from '@/lib/geo';
import type { City, GlobeShaderPalette, GlobeThemeId } from '@/types';

import { ATMOSPHERE_FRAGMENT_SHADER, ATMOSPHERE_VERTEX_SHADER, GLOBE_FRAGMENT_SHADER, GLOBE_VERTEX_SHADER } from './globe/shaders';

export interface InteractiveGlobeProps {
  themeId: GlobeThemeId;
  cities?: readonly City[];
  activeCityId?: string | null;
  onCitySelect?: (city: City) => void;
  /** false: dokunma/sürükleme kapalı (açılış ekranı ambiyans küresi) */
  interactive?: boolean;
  autoRotate?: boolean;
  showMarkers?: boolean;
  /** true: render döngüsü durur (sekme görünür değilken pil tasarrufu) */
  paused?: boolean;
  cameraDistance?: number;
  /** Küreyi görünüm yüksekliğinin bu oranı kadar yukarı kaydırır (sheet açıkken şehir görünür kalsın) */
  verticalOffset?: number;
  style?: StyleProp<ViewStyle>;
  onReady?: () => void;
}

// ─────────────────────────────────────────────────────────────
//  Sabitler
// ─────────────────────────────────────────────────────────────
const GLOBE_RADIUS = 1;
const MARKER_ALTITUDE = 1.012;
const ATMOSPHERE_SCALE = 1.14;
const MARKER_CORE_RADIUS = 0.013;
const MARKER_HALO_RADIUS = 0.03;
const MARKER_HIT_RADIUS = 0.075;
/** Pin isabeti yoksa, küre üzerindeki dokunuşa bu açı içindeki en yakın şehir seçilir (~14°) */
const NEAREST_CITY_MAX_ANGLE = 0.25;
const SUN_UPDATE_INTERVAL_MS = 10_000;
const ACTIVE_MARKER_SCALE = 1.9;
const STAR_COUNT = 900;
/** expo-gl'in desteklemediği pixelStorei parametreleri (konsolu boğan uyarıları önler) */
const UNSUPPORTED_PIXEL_STORE = new Set([0x9240, 0x9241, 0x9243]);

type ColorKey = 'oceanDeep' | 'oceanShallow' | 'grid' | 'equator' | 'night' | 'nightGlow' | 'atmosphere';
type FloatKey = 'gridOpacity' | 'gridSpacingDeg' | 'nightStrength' | 'nightGlowStrength' | 'atmosphereStrength' | 'terminatorSoftness';

const COLOR_UNIFORMS: Record<ColorKey, string> = {
  oceanDeep: 'uOceanDeep',
  oceanShallow: 'uOceanShallow',
  grid: 'uGrid',
  equator: 'uEquator',
  night: 'uNight',
  nightGlow: 'uNightGlow',
  atmosphere: 'uAtmosphere',
};

const FLOAT_UNIFORMS: Record<FloatKey, string> = {
  gridOpacity: 'uGridOpacity',
  gridSpacingDeg: 'uGridSpacing',
  nightStrength: 'uNightStrength',
  nightGlowStrength: 'uNightGlowStrength',
  atmosphereStrength: 'uAtmosphereStrength',
  terminatorSoftness: 'uTerminatorSoftness',
};

/** Shader uniform'larının ara-değer (morf) temsili; renkler ham sRGB vec3 */
interface NumericPalette {
  colors: Record<ColorKey, THREE.Vector3>;
  floats: Record<FloatKey, number>;
  background: THREE.Vector3;
  starOpacity: number;
}

function toNumericPalette(palette: GlobeShaderPalette): NumericPalette {
  const vec = (hex: string) => new THREE.Vector3(...hexToRgbNormalized(hex));
  const background = vec(palette.background);
  const luminance = 0.2126 * background.x + 0.7152 * background.y + 0.0722 * background.z;
  return {
    colors: {
      oceanDeep: vec(palette.oceanDeep),
      oceanShallow: vec(palette.oceanShallow),
      grid: vec(palette.grid),
      equator: vec(palette.equator),
      night: vec(palette.night),
      nightGlow: vec(palette.nightGlow),
      atmosphere: vec(palette.atmosphere),
    },
    floats: {
      gridOpacity: palette.gridOpacity,
      gridSpacingDeg: palette.gridSpacingDeg,
      nightStrength: palette.nightStrength,
      nightGlowStrength: palette.nightGlowStrength,
      atmosphereStrength: palette.atmosphereStrength,
      terminatorSoftness: palette.terminatorSoftness,
    },
    background,
    // Açık zeminli temalarda (parşömen değil, İsviçre) yıldız yok
    starOpacity: luminance < 0.25 ? 0.85 : 0,
  };
}

function clonePalette(palette: NumericPalette): NumericPalette {
  const colors = {} as Record<ColorKey, THREE.Vector3>;
  (Object.keys(palette.colors) as ColorKey[]).forEach((key) => {
    colors[key] = palette.colors[key].clone();
  });
  return { colors, floats: { ...palette.floats }, background: palette.background.clone(), starOpacity: palette.starOpacity };
}

interface Scene3D {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  globeGroup: THREE.Group;
  globeMesh: THREE.Mesh;
  globeMaterial: THREE.ShaderMaterial;
  atmosphereMaterial: THREE.ShaderMaterial;
  stars: THREE.Points;
  starMaterial: THREE.PointsMaterial;
  markerCores: THREE.Mesh[];
  markerHalos: THREE.Mesh[];
  hitMeshes: THREE.Mesh[];
  pulseRing: THREE.Mesh;
  pulseMaterial: THREE.MeshBasicMaterial;
  cityVectors: THREE.Vector3[];
  raycaster: THREE.Raycaster;
  width: number;
  height: number;
}

function InteractiveGlobeComponent({
  themeId,
  cities = CITIES,
  activeCityId = null,
  onCitySelect,
  interactive = true,
  autoRotate = true,
  showMarkers = true,
  paused = false,
  cameraDistance = 3.4,
  verticalOffset = 0,
  style,
  onReady,
}: InteractiveGlobeProps) {
  const reduceMotion = useReducedMotion();

  // ── Prop aynaları (render döngüsü React'tan bağımsız çalışır) ──
  const citiesRef = useRef(cities);
  const onCitySelectRef = useRef(onCitySelect);
  onCitySelectRef.current = onCitySelect;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const interactiveRef = useRef(interactive);
  interactiveRef.current = interactive;
  const autoRotateRef = useRef(autoRotate);
  autoRotateRef.current = autoRotate && !reduceMotion;
  const reduceMotionRef = useRef(reduceMotion);
  reduceMotionRef.current = reduceMotion;
  const showMarkersRef = useRef(showMarkers);
  showMarkersRef.current = showMarkers;
  const verticalOffsetTargetRef = useRef(verticalOffset);
  verticalOffsetTargetRef.current = verticalOffset;
  const cameraDistanceRef = useRef(cameraDistance);
  cameraDistanceRef.current = cameraDistance;

  // ── Motor durumu ───────────────────────────────────────────
  const sceneRef = useRef<Scene3D | null>(null);
  const glRef = useRef<ExpoWebGLRenderingContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef(0);
  const disposedRef = useRef(false);
  const pausedRef = useRef(paused);
  const appActiveRef = useRef(AppState.currentState === 'active');
  const firstFrameRef = useRef(false);

  const rotationRef = useRef({ x: 0.35, y: -1.2 });
  const velocityRef = useRef({ x: 0, y: 0 });
  const draggingRef = useRef(false);
  const userSpinRef = useRef(false); // eylemsizlik kullanıcıdan mı geliyor (haptik için)
  const focusTargetRef = useRef<{ x: number; y: number } | null>(null);
  const lastInteractionRef = useRef(0);
  const lastHapticBucketRef = useRef(0);
  const lastHapticAtRef = useRef(0);
  const verticalOffsetRef = useRef(verticalOffset);
  const activeIndexRef = useRef(-1);
  const activeScaleRef = useRef<number[]>([]);
  const lastSunUpdateRef = useRef(0);

  const currentPaletteRef = useRef<NumericPalette>(toNumericPalette(getGlobeTheme(themeId).palette));
  const fromPaletteRef = useRef<NumericPalette | null>(null);
  const toPaletteRef = useRef<NumericPalette | null>(null);
  const themeMorphStartRef = useRef(0);

  const viewSizeRef = useRef({ width: 1, height: 1 });

  const opacity = useSharedValue(0);
  const revealStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  // ─────────────────────────────────────────────────────────────
  //  Uniform uygulama
  // ─────────────────────────────────────────────────────────────
  const applyPalette = useCallback((palette: NumericPalette) => {
    const s = sceneRef.current;
    if (!s) return;
    const uniforms = s.globeMaterial.uniforms;
    (Object.keys(COLOR_UNIFORMS) as ColorKey[]).forEach((key) => {
      (uniforms[COLOR_UNIFORMS[key]]?.value as THREE.Vector3 | undefined)?.copy(palette.colors[key]);
    });
    (Object.keys(FLOAT_UNIFORMS) as FloatKey[]).forEach((key) => {
      const uniform = uniforms[FLOAT_UNIFORMS[key]];
      if (!uniform) return;
      uniform.value = key === 'gridSpacingDeg' ? palette.floats[key] * DEG2RAD : palette.floats[key];
    });
    (s.atmosphereMaterial.uniforms.uAtmosphere?.value as THREE.Vector3 | undefined)?.copy(palette.colors.atmosphere);
    if (s.atmosphereMaterial.uniforms.uAtmosphereStrength) {
      s.atmosphereMaterial.uniforms.uAtmosphereStrength.value = palette.floats.atmosphereStrength;
    }
    // Clear color sRGB → Three.js renk yönetimi (setRGB + SRGBColorSpace)
    const bg = palette.background;
    s.renderer.setClearColor(new THREE.Color().setRGB(bg.x, bg.y, bg.z, THREE.SRGBColorSpace), 1);
    s.starMaterial.opacity = palette.starOpacity;
    s.stars.visible = palette.starOpacity > 0.01;
  }, []);

  // Tema değişince morf başlat
  useEffect(() => {
    const target = toNumericPalette(getGlobeTheme(themeId).palette);
    if (!sceneRef.current) {
      currentPaletteRef.current = target;
      return;
    }
    fromPaletteRef.current = clonePalette(currentPaletteRef.current);
    toPaletteRef.current = target;
    themeMorphStartRef.current = Date.now();
  }, [themeId]);

  // Aktif şehir değişince odakla
  useEffect(() => {
    const index = activeCityId ? citiesRef.current.findIndex((city) => city.id === activeCityId) : -1;
    activeIndexRef.current = index;
    const city = index >= 0 ? citiesRef.current[index] : undefined;
    if (!city) return;
    const target = getFocusRotation(city.lat, city.lng, GLOBE_PHYSICS.maxPitch);
    // Hedef yaw'ı mevcut sarım (wrap) sayısına taşı ki lerp en kısa yoldan gitsin
    target.y = rotationRef.current.y + shortestAngleDelta(rotationRef.current.y, target.y);
    focusTargetRef.current = target;
    velocityRef.current = { x: 0, y: 0 };
    userSpinRef.current = false;
    lastInteractionRef.current = Date.now();
  }, [activeCityId]);

  // ─────────────────────────────────────────────────────────────
  //  Render döngüsü
  // ─────────────────────────────────────────────────────────────
  const renderFrame = useCallback(
    (time: number) => {
      rafRef.current = null;
      const s = sceneRef.current;
      const gl = glRef.current;
      if (!s || !gl || disposedRef.current) return;

      const now = Date.now();
      const dt = lastFrameRef.current ? Math.min(0.05, (time - lastFrameRef.current) / 1000) : 1 / 60;
      lastFrameRef.current = time;
      const frames = dt * 60; // 60 fps'e normalize edilmiş kare sayısı

      const rotation = rotationRef.current;
      const velocity = velocityRef.current;

      // 1) Dönüş fiziği ──────────────────────────────────────
      if (draggingRef.current) {
        // PanResponder rotasyonu doğrudan yazar
      } else if (focusTargetRef.current) {
        const target = focusTargetRef.current;
        const t = reduceMotionRef.current ? 1 : 1 - (1 - GLOBE_PHYSICS.focusLerp) ** frames;
        rotation.y = lerpAngle(rotation.y, target.y, t);
        rotation.x = lerp(rotation.x, target.x, t);
        if (
          Math.abs(shortestAngleDelta(rotation.y, target.y)) < GLOBE_PHYSICS.focusEpsilon &&
          Math.abs(rotation.x - target.x) < GLOBE_PHYSICS.focusEpsilon
        ) {
          rotation.y = target.y;
          rotation.x = target.x;
          focusTargetRef.current = null;
        }
      } else if (Math.abs(velocity.x) > GLOBE_PHYSICS.minVelocity || Math.abs(velocity.y) > GLOBE_PHYSICS.minVelocity) {
        rotation.y += velocity.y * frames;
        rotation.x = clamp(rotation.x + velocity.x * frames, -GLOBE_PHYSICS.maxPitch, GLOBE_PHYSICS.maxPitch);
        const decay = GLOBE_PHYSICS.damping ** frames;
        velocity.x *= decay;
        velocity.y *= decay;
      } else {
        velocity.x = 0;
        velocity.y = 0;
        userSpinRef.current = false;
        if (autoRotateRef.current) {
          const idleFor = now - lastInteractionRef.current - GLOBE_PHYSICS.idleResumeDelayMs;
          if (idleFor > 0) {
            const ramp = easeInOutCubic(Math.min(1, idleFor / DURATION.idleRampIn));
            rotation.y += GLOBE_PHYSICS.idleSpin * ramp * frames;
          }
        }
      }
      s.globeGroup.rotation.set(rotation.x, rotation.y, 0, 'XYZ');

      // 2) Haptik kadran ─────────────────────────────────────
      if (draggingRef.current || userSpinRef.current) {
        const bucket = Math.floor((rotation.y * RAD2DEG) / GLOBE_PHYSICS.hapticStepDeg);
        if (bucket !== lastHapticBucketRef.current) {
          lastHapticBucketRef.current = bucket;
          if (now - lastHapticAtRef.current >= GLOBE_PHYSICS.hapticMinIntervalMs) {
            lastHapticAtRef.current = now;
            void Haptics.selectionAsync().catch(() => undefined);
          }
        }
      } else {
        lastHapticBucketRef.current = Math.floor((rotation.y * RAD2DEG) / GLOBE_PHYSICS.hapticStepDeg);
      }

      // 3) Tema morfu ────────────────────────────────────────
      if (fromPaletteRef.current && toPaletteRef.current) {
        const raw = reduceMotionRef.current ? 1 : Math.min(1, (now - themeMorphStartRef.current) / DURATION.themeMorph);
        const e = easeInOutCubic(raw);
        const from = fromPaletteRef.current;
        const to = toPaletteRef.current;
        const current = currentPaletteRef.current;
        (Object.keys(current.colors) as ColorKey[]).forEach((key) => {
          current.colors[key].lerpVectors(from.colors[key], to.colors[key], e);
        });
        (Object.keys(current.floats) as FloatKey[]).forEach((key) => {
          current.floats[key] = lerp(from.floats[key], to.floats[key], e);
        });
        // Izgara aralığı morflanırken çizgiler "kayar" — aralık yarı yolda atlasın
        current.floats.gridSpacingDeg = e < 0.5 ? from.floats.gridSpacingDeg : to.floats.gridSpacingDeg;
        current.background.lerpVectors(from.background, to.background, e);
        current.starOpacity = lerp(from.starOpacity, to.starOpacity, e);
        applyPalette(current);
        if (raw >= 1) {
          fromPaletteRef.current = null;
          toPaletteRef.current = null;
        }
      }

      // 4) Güneş (gerçek UTC) ────────────────────────────────
      if (now - lastSunUpdateRef.current > SUN_UPDATE_INTERVAL_MS) {
        lastSunUpdateRef.current = now;
        const sun = getSunDirection(new Date(now));
        (s.globeMaterial.uniforms.uSunDirection?.value as THREE.Vector3 | undefined)?.set(sun.x, sun.y, sun.z);
      }
      if (s.globeMaterial.uniforms.uTime) s.globeMaterial.uniforms.uTime.value = (now % 100_000) / 1000;

      // 5) Pinler + aktif şehir nabzı ────────────────────────
      const markersVisible = showMarkersRef.current;
      const activeIndex = activeIndexRef.current;
      const scales = activeScaleRef.current;
      const scaleT = 1 - 0.82 ** frames;
      for (let i = 0; i < s.markerCores.length; i += 1) {
        const core = s.markerCores[i];
        const halo = s.markerHalos[i];
        if (!core || !halo) continue;
        core.visible = markersVisible;
        halo.visible = markersVisible;
        const target = i === activeIndex ? ACTIVE_MARKER_SCALE : 1;
        const value = lerp(scales[i] ?? 1, target, scaleT);
        scales[i] = value;
        core.scale.setScalar(value);
        halo.scale.setScalar(value);
      }
      const activeVector = activeIndex >= 0 ? s.cityVectors[activeIndex] : undefined;
      if (markersVisible && activeVector) {
        s.pulseRing.visible = true;
        s.pulseRing.position.copy(activeVector);
        s.pulseRing.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), activeVector.clone().normalize());
        const phase = reduceMotionRef.current ? 0.35 : (now % DURATION.pulseLoop) / DURATION.pulseLoop;
        const eased = 1 - (1 - phase) ** 3; // ease-out: hızlı yayıl, yavaş sön
        s.pulseRing.scale.setScalar(1 + eased * 2.2);
        s.pulseMaterial.opacity = (1 - phase) * 0.85;
      } else {
        s.pulseRing.visible = false;
      }

      // 6) Kamera dikey ofseti (sheet koreografisi) ─────────
      const offsetT = reduceMotionRef.current ? 1 : 1 - 0.9 ** frames;
      verticalOffsetRef.current = lerp(verticalOffsetRef.current, verticalOffsetTargetRef.current, offsetT);
      const w = gl.drawingBufferWidth;
      const h = gl.drawingBufferHeight;
      if (w !== s.width || h !== s.height) {
        s.width = w;
        s.height = h;
        s.renderer.setSize(w, h, false);
        s.camera.aspect = w / Math.max(1, h);
      }
      s.camera.position.z = lerp(s.camera.position.z, cameraDistanceRef.current, offsetT);
      if (Math.abs(verticalOffsetRef.current) > 0.0005) {
        s.camera.setViewOffset(w, h, 0, verticalOffsetRef.current * h, w, h);
      } else {
        s.camera.clearViewOffset();
      }
      s.camera.updateProjectionMatrix();

      // 7) Çiz ───────────────────────────────────────────────
      s.renderer.render(s.scene, s.camera);
      gl.endFrameEXP();

      if (!firstFrameRef.current) {
        firstFrameRef.current = true;
        opacity.value = withTiming(1, { duration: DURATION.globeReveal, easing: easeEnter });
        onReadyRef.current?.();
      }

      if (!pausedRef.current && appActiveRef.current) {
        rafRef.current = requestAnimationFrame(renderFrame);
      }
    },
    [applyPalette, opacity],
  );

  const startLoop = useCallback(() => {
    if (rafRef.current !== null || disposedRef.current || !sceneRef.current) return;
    if (pausedRef.current || !appActiveRef.current) return;
    lastFrameRef.current = 0;
    rafRef.current = requestAnimationFrame(renderFrame);
  }, [renderFrame]);

  const stopLoop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  useEffect(() => {
    pausedRef.current = paused;
    if (paused) stopLoop();
    else startLoop();
  }, [paused, startLoop, stopLoop]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      appActiveRef.current = state === 'active';
      if (appActiveRef.current) startLoop();
      else stopLoop();
    });
    return () => subscription.remove();
  }, [startLoop, stopLoop]);

  // ─────────────────────────────────────────────────────────────
  //  Sahne kurulumu
  // ─────────────────────────────────────────────────────────────
  const onContextCreate = useCallback(
    (gl: ExpoWebGLRenderingContext) => {
      if (disposedRef.current) return;
      glRef.current = gl;

      const originalPixelStorei = gl.pixelStorei.bind(gl);
      gl.pixelStorei = (pname: number, param: number | boolean) => {
        if (UNSUPPORTED_PIXEL_STORE.has(pname)) return;
        originalPixelStorei(pname, param as number);
      };

      const width = gl.drawingBufferWidth;
      const height = gl.drawingBufferHeight;

      // Three.js bir DOM canvas bekler; expo-gl'de minimal bir taklit yeterli
      const fakeCanvas = {
        width,
        height,
        clientWidth: width,
        clientHeight: height,
        style: {},
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        getContext: () => gl,
      };

      const renderer = new THREE.WebGLRenderer({
        canvas: fakeCanvas as unknown as HTMLCanvasElement,
        context: gl as unknown as WebGL2RenderingContext,
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance',
      });
      renderer.setPixelRatio(1);
      renderer.setSize(width, height, false);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(35, width / Math.max(1, height), 0.1, 100);
      camera.position.set(0, 0, cameraDistanceRef.current);
      camera.lookAt(0, 0, 0);

      // Küre
      const globeGroup = new THREE.Group();
      scene.add(globeGroup);

      const globeGeometry = new THREE.SphereGeometry(GLOBE_RADIUS, 96, 64);
      const sun = getSunDirection();
      const globeMaterial = new THREE.ShaderMaterial({
        vertexShader: GLOBE_VERTEX_SHADER,
        fragmentShader: GLOBE_FRAGMENT_SHADER,
        uniforms: {
          uOceanDeep: { value: new THREE.Vector3() },
          uOceanShallow: { value: new THREE.Vector3() },
          uGrid: { value: new THREE.Vector3() },
          uEquator: { value: new THREE.Vector3() },
          uNight: { value: new THREE.Vector3() },
          uNightGlow: { value: new THREE.Vector3() },
          uAtmosphere: { value: new THREE.Vector3() },
          uGridOpacity: { value: 0 },
          uGridSpacing: { value: 15 * DEG2RAD },
          uNightStrength: { value: 0 },
          uNightGlowStrength: { value: 0 },
          uAtmosphereStrength: { value: 0 },
          uTerminatorSoftness: { value: 0.1 },
          uTime: { value: 0 },
          uSunDirection: { value: new THREE.Vector3(sun.x, sun.y, sun.z) },
        },
      });
      const globeMesh = new THREE.Mesh(globeGeometry, globeMaterial);
      globeGroup.add(globeMesh);
      lastSunUpdateRef.current = Date.now();

      // Atmosfer (dönmez — ışık kameraya göre sabit)
      const atmosphereGeometry = new THREE.SphereGeometry(GLOBE_RADIUS * ATMOSPHERE_SCALE, 64, 48);
      const atmosphereMaterial = new THREE.ShaderMaterial({
        vertexShader: ATMOSPHERE_VERTEX_SHADER,
        fragmentShader: ATMOSPHERE_FRAGMENT_SHADER,
        uniforms: {
          uAtmosphere: { value: new THREE.Vector3() },
          uAtmosphereStrength: { value: 0 },
        },
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
      });
      scene.add(new THREE.Mesh(atmosphereGeometry, atmosphereMaterial));

      // Yıldız alanı
      const starPositions = new Float32Array(STAR_COUNT * 3);
      for (let i = 0; i < STAR_COUNT; i += 1) {
        const u = Math.random() * 2 - 1;
        const theta = Math.random() * Math.PI * 2;
        const r = 18 + Math.random() * 12;
        const s = Math.sqrt(1 - u * u);
        starPositions[i * 3] = r * s * Math.cos(theta);
        starPositions[i * 3 + 1] = r * u;
        starPositions[i * 3 + 2] = r * s * Math.sin(theta);
      }
      const starGeometry = new THREE.BufferGeometry();
      starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
      const starMaterial = new THREE.PointsMaterial({
        color: 0xf4efe6,
        size: 2,
        sizeAttenuation: false,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
      });
      const stars = new THREE.Points(starGeometry, starMaterial);
      scene.add(stars);

      // Şehir pinleri — tüm pinler 3 geometri + 3 materyali paylaşır
      const coreGeometry = new THREE.SphereGeometry(MARKER_CORE_RADIUS, 12, 12);
      const haloGeometry = new THREE.SphereGeometry(MARKER_HALO_RADIUS, 16, 16);
      const hitGeometry = new THREE.SphereGeometry(MARKER_HIT_RADIUS, 8, 8);
      const coreMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(COLORS.brass) });
      const haloMaterial = new THREE.MeshBasicMaterial({
        color: new THREE.Color(COLORS.brassLight),
        transparent: true,
        opacity: 0.3,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const hitMaterial = new THREE.MeshBasicMaterial({ visible: false });

      const markerCores: THREE.Mesh[] = [];
      const markerHalos: THREE.Mesh[] = [];
      const hitMeshes: THREE.Mesh[] = [];
      const cityVectors: THREE.Vector3[] = [];

      citiesRef.current.forEach((city, index) => {
        const p = latLngToVector3(city.lat, city.lng, MARKER_ALTITUDE);
        const position = new THREE.Vector3(p.x, p.y, p.z);
        cityVectors.push(position);

        const core = new THREE.Mesh(coreGeometry, coreMaterial);
        core.position.copy(position);
        globeGroup.add(core);
        markerCores.push(core);

        const halo = new THREE.Mesh(haloGeometry, haloMaterial);
        halo.position.copy(position);
        globeGroup.add(halo);
        markerHalos.push(halo);

        const hit = new THREE.Mesh(hitGeometry, hitMaterial);
        hit.position.copy(position);
        hit.userData.cityIndex = index;
        globeGroup.add(hit);
        hitMeshes.push(hit);
      });
      activeScaleRef.current = citiesRef.current.map(() => 1);

      const pulseGeometry = new THREE.RingGeometry(0.026, 0.032, 48);
      const pulseMaterial = new THREE.MeshBasicMaterial({
        color: new THREE.Color(COLORS.brassLight),
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const pulseRing = new THREE.Mesh(pulseGeometry, pulseMaterial);
      pulseRing.visible = false;
      globeGroup.add(pulseRing);

      sceneRef.current = {
        renderer,
        scene,
        camera,
        globeGroup,
        globeMesh,
        globeMaterial,
        atmosphereMaterial,
        stars,
        starMaterial,
        markerCores,
        markerHalos,
        hitMeshes,
        pulseRing,
        pulseMaterial,
        cityVectors,
        raycaster: new THREE.Raycaster(),
        width,
        height,
      };

      applyPalette(currentPaletteRef.current);
      startLoop();
    },
    [applyPalette, startLoop],
  );

  // ─────────────────────────────────────────────────────────────
  //  Unmount: tam temizlik
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
      stopLoop();
      const s = sceneRef.current;
      sceneRef.current = null;
      if (!s) return;
      const geometries = new Set<THREE.BufferGeometry>();
      const materials = new Set<THREE.Material>();
      s.scene.traverse((object) => {
        const renderable = object as THREE.Mesh | THREE.Points;
        if (renderable.geometry) geometries.add(renderable.geometry);
        const material = renderable.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(material)) material.forEach((m) => materials.add(m));
        else if (material) materials.add(material);
      });
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
      s.scene.clear();
      s.renderer.dispose();
      glRef.current = null;
    };
  }, [stopLoop]);

  // ─────────────────────────────────────────────────────────────
  //  Dokunma: tap → Raycaster
  // ─────────────────────────────────────────────────────────────
  const handleTap = useCallback((x: number, y: number) => {
    const s = sceneRef.current;
    if (!s) return;
    const { width, height } = viewSizeRef.current;
    const ndc = new THREE.Vector2((x / width) * 2 - 1, -(y / height) * 2 + 1);
    s.raycaster.setFromCamera(ndc, s.camera);

    let cityIndex = -1;
    const worldPosition = new THREE.Vector3();

    // 1) Doğrudan pin isabeti (yalnızca kameraya bakan yarıküre)
    if (showMarkersRef.current) {
      const hits = s.raycaster.intersectObjects(s.hitMeshes, false);
      for (const hit of hits) {
        hit.object.getWorldPosition(worldPosition);
        if (worldPosition.z > 0.12) {
          cityIndex = hit.object.userData.cityIndex as number;
          break;
        }
      }
    }

    // 2) Küre yüzeyine dokunuldu: açısal olarak en yakın şehir
    if (cityIndex < 0) {
      const globeHit = s.raycaster.intersectObject(s.globeMesh, false)[0];
      if (globeHit) {
        const local = s.globeGroup.worldToLocal(globeHit.point.clone()).normalize();
        let bestDot = Math.cos(NEAREST_CITY_MAX_ANGLE);
        s.cityVectors.forEach((vector, index) => {
          const dot = local.dot(vector.clone().normalize());
          if (dot > bestDot) {
            bestDot = dot;
            cityIndex = index;
          }
        });
      }
    }

    const city = cityIndex >= 0 ? citiesRef.current[cityIndex] : undefined;
    if (!city) return;

    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    activeIndexRef.current = cityIndex;
    const target = getFocusRotation(city.lat, city.lng, GLOBE_PHYSICS.maxPitch);
    target.y = rotationRef.current.y + shortestAngleDelta(rotationRef.current.y, target.y);
    focusTargetRef.current = target;
    velocityRef.current = { x: 0, y: 0 };
    onCitySelectRef.current?.(city);
  }, []);

  // ─────────────────────────────────────────────────────────────
  //  Sürükleme: PanResponder
  // ─────────────────────────────────────────────────────────────
  const gestureRef = useRef({ lastDx: 0, lastDy: 0, startedAt: 0 });
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => interactiveRef.current,
      onMoveShouldSetPanResponder: () => interactiveRef.current,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        draggingRef.current = true;
        userSpinRef.current = false;
        focusTargetRef.current = null; // kullanıcı her zaman otomatik odaktan önceliklidir
        velocityRef.current = { x: 0, y: 0 };
        gestureRef.current = { lastDx: 0, lastDy: 0, startedAt: Date.now() };
        lastInteractionRef.current = Date.now();
        lastHapticBucketRef.current = Math.floor((rotationRef.current.y * RAD2DEG) / GLOBE_PHYSICS.hapticStepDeg);
      },
      onPanResponderMove: (_event, gesture) => {
        const g = gestureRef.current;
        const ddx = gesture.dx - g.lastDx;
        const ddy = gesture.dy - g.lastDy;
        g.lastDx = gesture.dx;
        g.lastDy = gesture.dy;
        const rotation = rotationRef.current;
        rotation.y += ddx * GLOBE_PHYSICS.dragSensitivity;
        rotation.x = clamp(rotation.x + ddy * GLOBE_PHYSICS.dragSensitivity, -GLOBE_PHYSICS.maxPitch, GLOBE_PHYSICS.maxPitch);
        lastInteractionRef.current = Date.now();
      },
      onPanResponderRelease: (event, gesture) => {
        draggingRef.current = false;
        lastInteractionRef.current = Date.now();
        const duration = Date.now() - gestureRef.current.startedAt;
        const isTap =
          Math.abs(gesture.dx) < GLOBE_PHYSICS.tapSlop &&
          Math.abs(gesture.dy) < GLOBE_PHYSICS.tapSlop &&
          duration < GLOBE_PHYSICS.tapMaxDurationMs;
        if (isTap) {
          handleTap(event.nativeEvent.locationX, event.nativeEvent.locationY);
          return;
        }
        // px/ms → rad/kare (16.67 ms)
        const toRadPerFrame = (pxPerMs: number) =>
          clamp(pxPerMs * 16.67 * GLOBE_PHYSICS.dragSensitivity, -GLOBE_PHYSICS.maxVelocity, GLOBE_PHYSICS.maxVelocity);
        velocityRef.current = { x: toRadPerFrame(gesture.vy) * 0.6, y: toRadPerFrame(gesture.vx) };
        userSpinRef.current = true;
      },
      onPanResponderTerminate: () => {
        draggingRef.current = false;
        lastInteractionRef.current = Date.now();
      },
    }),
  ).current;

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    viewSizeRef.current = { width: Math.max(1, width), height: Math.max(1, height) };
  }, []);

  return (
    <View
      style={[styles.container, style]}
      onLayout={onLayout}
      pointerEvents={interactive ? 'auto' : 'none'}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel="Etkileşimli dünya küresi"
      accessibilityHint={interactive ? 'Döndürmek için sürükleyin, bir şehri seçmek için dokunun' : undefined}
      {...(interactive ? panResponder.panHandlers : {})}
    >
      <Animated.View style={[StyleSheet.absoluteFill, revealStyle]}>
        <GLView style={StyleSheet.absoluteFill} onContextCreate={onContextCreate} />
      </Animated.View>
    </View>
  );
}

export const InteractiveGlobe = memo(InteractiveGlobeComponent);
export default InteractiveGlobe;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    overflow: 'hidden',
  },
});
