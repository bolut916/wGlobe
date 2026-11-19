/**
 * Platform-independent orchestrator: owns the three.js renderer, the camera
 * controller, the tile cache and the quadtree, and runs one frame at a time.
 * The React Native component (and the web test harness) only supply a GL
 * context, a tile decoder and input events.
 *
 * Frame order:
 *   controller.update → camera-relative matrices + dynamic near/far →
 *   quadtree traversal (culling, SSE, requests, fades) → cache.pump (network) →
 *   cache.processUploads (GPU budget) → LRU eviction → clouds / atmosphere /
 *   pins → render.
 */
import * as THREE from 'three';

import { GlobeCameraController, type CameraControllerEvents } from '../controls/GlobeCameraController';
import {
  clamp,
  DEG2RAD,
  dot3,
  geodeticToEcef,
  horizonDistance,
  isScaledPointOccluded,
  setVec3,
  smoothstep,
  sunDirectionEcef,
  type Vec3,
} from '../math/sphericalMath';
import {
  createAtmosphereMaterial,
  createCloudMaterial,
  createPinMaterial,
  createSharedSurfaceUniforms,
  type SharedSurfaceUniforms,
} from '../shaders/earthShaders';
import type {
  DecodedTileImage,
  FlyToOptions,
  GlobalTextureSources,
  GlobeEngineConfig,
  GlobeFrameStats,
  GlobeMarker,
  GlobeStyleId,
  OverlayLayerConfig,
  TileImageDecoder,
  TileProviderConfig,
} from '../types/globe';
import { QuadtreeGlobeMesh } from './QuadtreeGlobeMesh';
import { disposeGpuTexture, TileCache, uploadGpuTexture, type GpuTexture } from './TileCacheAndLoader';

export const DEFAULT_ENGINE_CONFIG: GlobeEngineConfig = {
  radius: 6_371_008.8,
  sseThreshold: 1.75,
  sseHysteresis: 0.82,
  obliqueAttenuation: 0.5,
  minLevel: 2,
  maxLevel: 19,
  maxCachedTiles: 320,
  maxConcurrentRequests: 6,
  uploadsPerFrame: 4,
  abortAfterMs: 400,
  refineTimeoutMs: 2500,
  fadeDurationMs: 250,
  fovDeg: 40,
  minAltitude: 180,
  maxAltitude: 42_000_000,
  cloudFadeAltitude: 1_500_000,
  maxRetries: 2,
};

const ATMOSPHERE_SCALE = 1.025;
const CLOUD_SCALE = 1.006;
const CLOUD_DRIFT_PER_SECOND = 1 / 2600;
const SUN_REFRESH_MS = 10_000;
const PICK_RADIUS_PX = 30;

interface StylePreset {
  sunIntensity: number;
  lightsGain: number;
  ambient: number;
  saturation: number;
  sepia: number;
  cloudGain: number;
  aerial: number;
  bump: number;
  exposure: number;
}

export const STYLE_PRESETS: Readonly<Record<GlobeStyleId, StylePreset>> = {
  realistic: { sunIntensity: 1, lightsGain: 1.5, ambient: 0.03, saturation: 1.08, sepia: 0, cloudGain: 0.9, aerial: 1, bump: 0.9, exposure: 1.2 },
  parchment: { sunIntensity: 1, lightsGain: 0.25, ambient: 0.06, saturation: 0.55, sepia: 0.85, cloudGain: 0.3, aerial: 0.5, bump: 1.3, exposure: 1.3 },
  night: { sunIntensity: 0.07, lightsGain: 2.2, ambient: 0.04, saturation: 1.1, sepia: 0, cloudGain: 0.55, aerial: 1, bump: 0.6, exposure: 1.35 },
  mono: { sunIntensity: 1, lightsGain: 0.6, ambient: 0.035, saturation: 0, sepia: 0, cloudGain: 0.6, aerial: 0.7, bump: 1.1, exposure: 1.2 },
};

export interface GlobeRendererOptions {
  gl: WebGL2RenderingContext;
  /** A canvas, or an object with the canvas fields three.js reads (expo-gl). */
  canvas: HTMLCanvasElement;
  /** Drawing-buffer size in device pixels. */
  width: number;
  height: number;
  pixelRatio: number;
  decoder: TileImageDecoder;
  provider: TileProviderConfig;
  overlays?: readonly OverlayLayerConfig[];
  config?: Partial<GlobeEngineConfig>;
  initialView?: { lat: number; lon: number; altitude: number };
  events?: CameraControllerEvents;
  background?: string;
  antialias?: boolean;
}

export class GlobeRenderer {
  readonly config: GlobeEngineConfig;
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controller: GlobeCameraController;
  readonly cache: TileCache;
  readonly quadtree: QuadtreeGlobeMesh;
  readonly shared: SharedSurfaceUniforms;

  private readonly gl: WebGL2RenderingContext;
  private readonly frustum = new THREE.Frustum();
  private readonly projView = new THREE.Matrix4();
  private readonly cameraEcef: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly clouds: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private readonly atmosphere: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private readonly pins: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private globalTextures: GpuTexture[] = [];
  private markers: GlobeMarker[] = [];
  private markerEcef: Vec3[] = [];
  private activeMarkerId: string | null = null;
  private widthPx: number;
  private heightPx: number;
  private pixelRatio: number;
  private verticalOffset = 0;
  private frameIndex = 0;
  private lastFrameTime = -1;
  private lastSunUpdate = -Infinity;
  private sunDateOverride: Date | null = null;
  private style: StylePreset = STYLE_PRESETS.realistic;
  private disposed = false;
  private needsFrame = true;
  private lastStats: GlobeFrameStats = {
    renderedTiles: 0,
    visitedNodes: 0,
    culledFrustum: 0,
    culledHorizon: 0,
    cachedTextures: 0,
    pendingRequests: 0,
    activeRequests: 0,
    uploadsThisFrame: 0,
    deepestLevel: 0,
    altitude: 0,
  };

  constructor(options: GlobeRendererOptions) {
    this.config = { ...DEFAULT_ENGINE_CONFIG, ...options.config };
    this.gl = options.gl;
    this.widthPx = options.width;
    this.heightPx = options.height;
    this.pixelRatio = options.pixelRatio;

    this.renderer = new THREE.WebGLRenderer({
      canvas: options.canvas,
      context: options.gl,
      antialias: options.antialias ?? true,
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(options.width, options.height, false);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = this.style.exposure;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(new THREE.Color().setStyle(options.background ?? '#030508', THREE.SRGBColorSpace), 1);
    this.renderer.sortObjects = true;

    this.camera = new THREE.PerspectiveCamera(this.config.fovDeg, options.width / Math.max(1, options.height), 1, 1e8);
    this.camera.matrixAutoUpdate = true;

    this.shared = createSharedSurfaceUniforms(this.config.radius, this.config.radius * (ATMOSPHERE_SCALE - 1));

    this.cache = new TileCache(
      options.gl,
      options.decoder,
      {
        maxCachedTiles: this.config.maxCachedTiles,
        maxConcurrentRequests: this.config.maxConcurrentRequests,
        uploadsPerFrame: this.config.uploadsPerFrame,
        abortAfterMs: this.config.abortAfterMs,
        maxRetries: this.config.maxRetries,
      },
      () => {
        this.needsFrame = true;
      },
    );

    this.quadtree = new QuadtreeGlobeMesh(this.cache, this.shared, this.config, options.provider);
    this.quadtree.setOverlays(options.overlays ?? []);
    this.scene.add(this.quadtree.group);

    const cloudMaterial = createCloudMaterial(this.shared);
    this.clouds = new THREE.Mesh(new THREE.SphereGeometry(this.config.radius * CLOUD_SCALE, 160, 96), cloudMaterial);
    this.clouds.frustumCulled = false;
    this.clouds.renderOrder = 2;
    this.clouds.visible = false;
    this.scene.add(this.clouds);

    const shellRadius = this.config.radius * ATMOSPHERE_SCALE;
    this.atmosphere = new THREE.Mesh(new THREE.SphereGeometry(shellRadius, 128, 80), createAtmosphereMaterial(this.shared, shellRadius));
    this.atmosphere.frustumCulled = false;
    this.atmosphere.renderOrder = 3;
    this.scene.add(this.atmosphere);

    const pinGeometry = new THREE.BufferGeometry();
    this.pins = new THREE.Points(pinGeometry, createPinMaterial());
    this.pins.frustumCulled = false;
    this.pins.renderOrder = 4;
    this.scene.add(this.pins);

    const initial = options.initialView ?? { lat: 30, lon: 20, altitude: 18_000_000 };
    this.controller = new GlobeCameraController(this.camera, this.config, initial, options.events);
    this.controller.setViewport(options.width / options.pixelRatio, options.height / options.pixelRatio);
    this.updateProjection();
  }

  // ── Configuration ───────────────────────────────────────────

  setSize(width: number, height: number, pixelRatio: number): void {
    this.widthPx = Math.max(1, Math.floor(width));
    this.heightPx = Math.max(1, Math.floor(height));
    this.pixelRatio = pixelRatio;
    this.renderer.setSize(this.widthPx, this.heightPx, false);
    this.controller.setViewport(this.widthPx / pixelRatio, this.heightPx / pixelRatio);
    this.updateProjection();
    this.needsFrame = true;
  }

  /**
   * Shifts the globe up by `fraction` of the view height (e.g. to keep the
   * focused city visible above a bottom sheet). Implemented as a principal
   * point shift, so picking stays exact.
   */
  setVerticalOffset(fraction: number): void {
    this.verticalOffset = clamp(fraction, -0.45, 0.45);
    this.updateProjection();
    this.needsFrame = true;
  }

  private updateProjection(): void {
    this.camera.aspect = this.widthPx / this.heightPx;
    const shift = Math.round(this.verticalOffset * this.heightPx);
    if (shift !== 0) this.camera.setViewOffset(this.widthPx, this.heightPx, 0, shift, this.widthPx, this.heightPx);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  setProvider(provider: TileProviderConfig): void {
    this.quadtree.setProvider(provider);
    this.needsFrame = true;
  }

  setOverlays(overlays: readonly OverlayLayerConfig[]): void {
    this.quadtree.setOverlays(overlays);
    this.needsFrame = true;
  }

  setStyle(styleId: GlobeStyleId): void {
    this.style = STYLE_PRESETS[styleId];
    const s = this.shared;
    s.u_sunIntensity.value = this.style.sunIntensity;
    s.u_lightsGain.value = this.style.lightsGain;
    s.u_ambient.value = this.style.ambient;
    s.u_saturation.value = this.style.saturation;
    s.u_sepia.value = this.style.sepia;
    s.u_aerialStrength.value = this.style.aerial;
    s.u_bumpStrength.value = this.style.bump;
    this.renderer.toneMappingExposure = this.style.exposure;
    this.needsFrame = true;
  }

  /** Freeze the sun at a given instant (null = real time). */
  setSunDate(date: Date | null): void {
    this.sunDateOverride = date;
    this.lastSunUpdate = -Infinity;
    this.needsFrame = true;
  }

  /** Uploads bundled equirect textures (base imagery, lights, clouds, water mask). */
  setGlobalTextures(sources: GlobalTextureSources & { waterMask?: DecodedTileImage }): void {
    const upload = (image: DecodedTileImage | undefined): GpuTexture | null => {
      if (!image) return null;
      try {
        const gpu = uploadGpuTexture(this.gl, image, { wrapS: 'repeat', mipmaps: true });
        if (gpu) this.globalTextures.push(gpu);
        return gpu;
      } finally {
        image.release();
      }
    };
    const s = this.shared;
    const base = upload(sources.baseDay);
    if (base) {
      s.u_baseTexture.value = base.texture;
      s.u_hasBase.value = 1;
    }
    const lights = upload(sources.nightLights);
    if (lights) {
      s.u_nightTexture.value = lights.texture;
      s.u_hasNight.value = 1;
    }
    const clouds = upload(sources.clouds);
    if (clouds) {
      s.u_cloudTexture.value = clouds.texture;
      s.u_hasClouds.value = 1;
    }
    const water = upload(sources.waterMask);
    if (water) {
      s.u_waterMask.value = water.texture;
      s.u_hasWaterMask.value = 1;
    }
    this.renderer.resetState();
    this.needsFrame = true;
  }

  setMarkers(markers: readonly GlobeMarker[], activeId: string | null): void {
    this.markers = markers.slice();
    this.activeMarkerId = activeId;
    this.markerEcef = this.markers.map((m) => geodeticToEcef({ x: 0, y: 0, z: 0 }, m.lat * DEG2RAD, m.lon * DEG2RAD, this.config.radius));
    const geometry = this.pins.geometry;
    const count = this.markers.length;
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const active = new Float32Array(count);
    const c = new THREE.Color();
    this.markers.forEach((m, i) => {
      c.setStyle(m.color, THREE.SRGBColorSpace);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
      const isActive = m.id === activeId;
      sizes[i] = isActive ? 22 : 13;
      active[i] = isActive ? 1 : 0;
    });
    geometry.setAttribute('a_color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('a_size', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('a_active', new THREE.BufferAttribute(active, 1));
    geometry.setDrawRange(0, count);
    this.needsFrame = true;
  }

  flyTo(options: FlyToOptions): void {
    this.controller.flyTo(options, nowMs());
    this.needsFrame = true;
  }

  get stats(): GlobeFrameStats {
    return this.lastStats;
  }

  /** True when something changed and a frame should be drawn. */
  get wantsFrame(): boolean {
    return this.needsFrame;
  }

  requestFrame(): void {
    this.needsFrame = true;
  }

  // ── Picking ─────────────────────────────────────────────────

  /** Nearest visible marker within PICK_RADIUS_PX of a layout-pixel point. */
  pickMarker(x: number, y: number): GlobeMarker | null {
    const cam = this.controller.cameraEcef({ x: 0, y: 0, z: 0 });
    const scaledCam: Vec3 = { x: cam.x / this.config.radius, y: cam.y / this.config.radius, z: cam.z / this.config.radius };
    const layoutW = this.widthPx / this.pixelRatio;
    const layoutH = this.heightPx / this.pixelRatio;
    const v = new THREE.Vector3();
    let best: GlobeMarker | null = null;
    let bestDist = PICK_RADIUS_PX;
    this.markers.forEach((marker, i) => {
      const p = this.markerEcef[i];
      if (!p) return;
      const scaledP: Vec3 = { x: p.x / this.config.radius, y: p.y / this.config.radius, z: p.z / this.config.radius };
      if (isScaledPointOccluded(scaledCam, scaledP)) return;
      v.set(p.x - cam.x, p.y - cam.y, p.z - cam.z).project(this.camera);
      if (v.z > 1 || v.z < -1) return;
      const sx = (v.x * 0.5 + 0.5) * layoutW;
      const sy = (-v.y * 0.5 + 0.5) * layoutH;
      const d = Math.hypot(sx - x, sy - y);
      if (d < bestDist) {
        bestDist = d;
        best = marker;
      }
    });
    return best;
  }

  // ── Frame ───────────────────────────────────────────────────

  /** Runs one frame. `now` in milliseconds (performance.now()). */
  frame(now: number): GlobeFrameStats {
    if (this.disposed) return this.lastStats;
    const dt = this.lastFrameTime < 0 ? 1 / 60 : (now - this.lastFrameTime) / 1000;
    this.lastFrameTime = now;
    this.frameIndex += 1;
    const moving = this.controller.update(dt, now);

    // Camera-relative world: camera at origin, ECEF position kept in float64.
    this.controller.cameraEcef(this.cameraEcef);
    const camR = Math.sqrt(dot3(this.cameraEcef, this.cameraEcef));
    const altitude = camR - this.config.radius;
    const shellRadius = this.config.radius * ATMOSPHERE_SCALE;
    this.camera.near = clamp(altitude * 0.08, 0.5, 2_000_000);
    this.camera.far =
      (horizonDistance(altitude, this.config.radius) + Math.sqrt(shellRadius * shellRadius - this.config.radius * this.config.radius)) * 1.05 +
      Math.max(0, shellRadius - camR) * 2;
    this.updateProjection();
    this.camera.updateMatrixWorld(true);
    this.projView.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projView);

    // Sun (real time unless overridden).
    if (now - this.lastSunUpdate > SUN_REFRESH_MS) {
      const sun = sunDirectionEcef(this.sunDateOverride ?? new Date(), { x: 0, y: 0, z: 0 });
      this.shared.u_sunDirection.value.set(sun.x, sun.y, sun.z);
      this.lastSunUpdate = now;
    }
    this.shared.u_cameraEcef.value.set(this.cameraEcef.x, this.cameraEcef.y, this.cameraEcef.z);
    this.shared.u_cloudOffset.value = (this.shared.u_cloudOffset.value + dt * CLOUD_DRIFT_PER_SECOND) % 1;

    // Quadtree → network → GPU uploads → eviction.
    this.cache.beginFrame(this.frameIndex);
    const qt = this.quadtree.update({
      camera: this.camera,
      cameraEcef: this.cameraEcef,
      frustum: this.frustum,
      viewportHeightPx: this.heightPx,
      now,
      frame: this.frameIndex,
    });
    this.cache.pump(now);
    const uploads = this.cache.processUploads(now);
    this.cache.evict();

    // Clouds fade 1 → 0 between cloudFadeAltitude and a third of it.
    const cloudOpacity = smoothstep(this.config.cloudFadeAltitude / 3, this.config.cloudFadeAltitude, altitude) * this.style.cloudGain * this.shared.u_hasClouds.value;
    this.clouds.material.uniforms.u_cloudOpacity!.value = cloudOpacity;
    this.clouds.visible = cloudOpacity > 0.001;
    this.clouds.position.set(-this.cameraEcef.x, -this.cameraEcef.y, -this.cameraEcef.z);
    this.atmosphere.position.set(-this.cameraEcef.x, -this.cameraEcef.y, -this.cameraEcef.z);
    this.shared.u_cloudShadow.value = smoothstep(this.config.cloudFadeAltitude / 6, this.config.cloudFadeAltitude, altitude);

    this.updatePins(altitude, now);

    if (uploads > 0) this.renderer.resetState();
    this.renderer.render(this.scene, this.camera);
    this.needsFrame = moving || qt.animating || this.cache.activeRequests > 0 || this.cache.pendingRequests > 0 || this.controller.isFlying;

    this.lastStats = {
      renderedTiles: qt.renderedTiles,
      visitedNodes: qt.visitedNodes,
      culledFrustum: qt.culledFrustum,
      culledHorizon: qt.culledHorizon,
      cachedTextures: this.cache.size,
      pendingRequests: this.cache.pendingRequests,
      activeRequests: this.cache.activeRequests,
      uploadsThisFrame: uploads,
      deepestLevel: qt.deepestLevel,
      altitude,
    };
    return this.lastStats;
  }

  private updatePins(altitude: number, now: number): void {
    const count = this.markers.length;
    this.pins.visible = count > 0;
    if (count === 0) return;
    const attribute = this.pins.geometry.getAttribute('position') as THREE.BufferAttribute;
    const lift = Math.max(25, altitude * 0.003);
    const tmp: Vec3 = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < count; i += 1) {
      const p = this.markerEcef[i];
      if (!p) continue;
      const scale = (this.config.radius + lift) / this.config.radius;
      setVec3(tmp, p.x * scale - this.cameraEcef.x, p.y * scale - this.cameraEcef.y, p.z * scale - this.cameraEcef.z);
      attribute.setXYZ(i, tmp.x, tmp.y, tmp.z);
    }
    attribute.needsUpdate = true;
    const u = this.pins.material.uniforms;
    u.u_pixelRatio!.value = this.pixelRatio;
    u.u_time!.value = now / 1000;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.quadtree.dispose();
    this.cache.dispose();
    for (const gpu of this.globalTextures) disposeGpuTexture(this.gl, gpu);
    this.globalTextures = [];
    this.clouds.geometry.dispose();
    this.clouds.material.dispose();
    this.atmosphere.geometry.dispose();
    this.atmosphere.material.dispose();
    this.pins.geometry.dispose();
    this.pins.material.dispose();
    this.renderer.dispose();
  }
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
