/**
 * Shared type contracts for the wGlobe planetary engine.
 *
 * Units used across the engine:
 *  - Distances: meters
 *  - Angles in public APIs: degrees; internally: radians
 *  - World frame: Earth-Centred, Earth-Fixed (ECEF) sphere, matching the app's
 *    `latLngToVector3` convention:
 *        x =  R cos(lat) cos(lon)
 *        y =  R sin(lat)          (+Y = north pole)
 *        z = −R cos(lat) sin(lon)
 */

export interface GeoPoint {
  /** Latitude in degrees, −90 … 90 */
  lat: number;
  /** Longitude in degrees, −180 … 180 */
  lon: number;
}

export interface CameraPose extends GeoPoint {
  /** Height of the orbit target range above the surface, meters */
  altitude: number;
  /** Compass heading of the view, degrees (0 = looking north) */
  heading: number;
  /** Tilt away from straight-down, degrees (0 = nadir view) */
  tilt: number;
}

export interface FlyToOptions extends GeoPoint {
  /** Target camera altitude (meters). Defaults to the current altitude. */
  altitude?: number;
  /** Flight duration in milliseconds. Defaults to an arc-length based duration. */
  duration?: number;
  /** Final heading in degrees. Defaults to 0 (north up). */
  heading?: number;
  /** Final tilt in degrees. Defaults to 0 (nadir). */
  tilt?: number;
  /** Invoked once when the flight ends (`completed === false` when interrupted). */
  onComplete?: (completed: boolean) => void;
}

export interface TileCoord {
  z: number;
  x: number;
  y: number;
}

/** A raster XYZ tile source in Web Mercator (EPSG:3857). */
export interface TileProviderConfig {
  /** Stable identifier; used in cache keys and on-disk file names. [a-z0-9_-] */
  id: string;
  label: string;
  /**
   * URL template. Supported tokens: {z} {x} {y} {s} (subdomain) {key} (apiKey)
   * {r} (retina suffix "@2x" when `retina` is true, otherwise empty).
   */
  urlTemplate: string;
  subdomains?: readonly string[];
  apiKey?: string;
  minZoom: number;
  /** Deepest zoom level the server provides. Deeper nodes over-zoom this level. */
  maxZoom: number;
  /** Pixel size of one tile edge (256 or 512). */
  tileSize: number;
  /** Mandatory, user-visible attribution string. */
  attribution: string;
  headers?: Readonly<Record<string, string>>;
  /** When true, HTTP 404/204 means "no imagery here" instead of an error. */
  emptyTileOn404: boolean;
  retina?: boolean;
  /** File extension used for the native disk cache. */
  fileExtension: 'jpg' | 'png' | 'webp';
}

export interface OverlayLayerConfig extends TileProviderConfig {
  /** 0 … 1 */
  opacity: number;
  /** Composite mode in the surface shader. */
  blend: 'alpha' | 'screen';
}

export type TileLoadState = 'idle' | 'loading' | 'decoded' | 'ready' | 'empty' | 'failed';

/**
 * A decoded image waiting for GPU upload. Implementations are platform specific
 * (ImageBitmap on web, a local file URI consumed by expo-gl on native).
 */
export interface DecodedTileImage {
  /** Bytes the decoded image will occupy on the GPU (approximate, for budgeting). */
  readonly byteSize: number;
  /** Issue `texImage2D` into the texture currently bound to TEXTURE_2D. */
  upload(gl: WebGL2RenderingContext): void;
  /** Free CPU-side resources. Called exactly once, after upload or on abort. */
  release(): void;
}

export interface TileDecodeRequest {
  url: string;
  provider: TileProviderConfig;
  coord: TileCoord;
  signal: AbortSignal;
}

/** Thrown by decoders to mark a tile that definitively has no imagery. */
export class EmptyTileError extends Error {
  constructor(message = 'Tile has no imagery') {
    super(message);
    this.name = 'EmptyTileError';
  }
}

/** Thrown by decoders for HTTP status failures. */
export class TileHttpError extends Error {
  readonly status: number;

  constructor(status: number, message?: string) {
    super(message ?? `Tile request failed with HTTP ${status}`);
    this.name = 'TileHttpError';
    this.status = status;
  }
}

export interface TileImageDecoder {
  decode(request: TileDecodeRequest): Promise<DecodedTileImage>;
  /** Optional cleanup of persistent caches (native disk cache). */
  dispose?(): void;
}

/** Bundled equirectangular textures used for lights, clouds and the global fallback. */
export interface GlobalTextureSources {
  /** Equirect day imagery; ultimate fallback under unloaded tiles and polar caps. */
  baseDay?: DecodedTileImage;
  /** Equirect night-lights luminance. */
  nightLights?: DecodedTileImage;
  /** Equirect cloud coverage (luminance = opacity). */
  clouds?: DecodedTileImage;
}

export type GlobeStyleId = 'realistic' | 'parchment' | 'night' | 'mono';

export interface GlobeMarker {
  id: string;
  lat: number;
  lon: number;
  /** CSS hex color (#RRGGBB) */
  color: string;
}

export interface GlobeEngineConfig {
  /** Sphere radius, meters. */
  radius: number;
  /** Screen-space error threshold in device pixels (1.5 … 2 recommended). */
  sseThreshold: number;
  /** A refined node coarsens again only below threshold × hysteresis. */
  sseHysteresis: number;
  /** Fraction of the oblique foreshortening applied to SSE (0 = none, 1 = full). */
  obliqueAttenuation: number;
  /** Quadtree level rendered at minimum (roots). */
  minLevel: number;
  /** Absolute deepest geometry level. */
  maxLevel: number;
  /** LRU budget of GPU tile textures. */
  maxCachedTiles: number;
  /** Parallel network requests. */
  maxConcurrentRequests: number;
  /** GPU uploads allowed per frame. */
  uploadsPerFrame: number;
  /** Requests not wanted for this long are aborted (ms). */
  abortAfterMs: number;
  /** Refine with fallback textures if children are still loading after this long (ms). */
  refineTimeoutMs: number;
  /** Tile cross-fade duration (ms). */
  fadeDurationMs: number;
  /** Camera vertical field of view, degrees. */
  fovDeg: number;
  minAltitude: number;
  maxAltitude: number;
  /** Clouds (and their shadows) are fully hidden at or below this altitude (m). */
  cloudCutoffAltitude: number;
  /** Above this altitude the surface is physically lit (orbital look). */
  clarityStartAltitude: number;
  /** Below this altitude the surface is unlit true-colour imagery (100 % clarity). */
  clarityFullAltitude: number;
  /** Retry count for transient tile failures. */
  maxRetries: number;
}

export interface GlobeFrameStats {
  renderedTiles: number;
  visitedNodes: number;
  culledFrustum: number;
  culledHorizon: number;
  cachedTextures: number;
  pendingRequests: number;
  activeRequests: number;
  uploadsThisFrame: number;
  deepestLevel: number;
  altitude: number;
}

export interface ViewportSize {
  /** Drawing buffer width in device pixels. */
  width: number;
  /** Drawing buffer height in device pixels. */
  height: number;
  /** Device pixels per layout point. */
  pixelRatio: number;
}
