/**
 * Tile streaming: provider presets, URL building, a priority-scheduled request
 * queue with AbortController cancellation, a budgeted GPU upload stage and an
 * LRU texture cache with explicit GPU disposal.
 *
 * Life cycle of one tile entry:
 *
 *   idle ──request()──▶ loading ──decode ok──▶ decoded ──upload()──▶ ready
 *     ▲                    │ └──404/204──▶ empty (permanent, children over-zoom)
 *     │                    └──error──▶ failed (retry with back-off, then permanent)
 *     └──────── abort (not wanted for `abortAfterMs`) ◀──┘
 *
 * GPU textures are raw WebGLTextures wrapped in THREE.ExternalTexture so the
 * upload path is identical on web (ImageBitmap) and native (expo-gl localUri).
 */
import * as THREE from 'three';

import { ancestorScaleOffset } from '../math/sphericalMath';
import {
  EmptyTileError,
  TileHttpError,
  type DecodedTileImage,
  type OverlayLayerConfig,
  type TileCoord,
  type TileDecodeRequest,
  type TileImageDecoder,
  type TileLoadState,
  type TileProviderConfig,
} from '../types/globe';

// ─────────────────────────────────────────────────────────────
//  Provider presets
// ─────────────────────────────────────────────────────────────

export const ESRI_WORLD_IMAGERY: TileProviderConfig = {
  id: 'esri-world-imagery',
  label: 'Esri World Imagery',
  // blankTile=false makes the server answer 404 instead of the grey
  // "Map data not yet available" placeholder, so we can over-zoom cleanly.
  urlTemplate: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?blankTile=false',
  minZoom: 0,
  maxZoom: 19,
  tileSize: 256,
  attribution: 'Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community',
  emptyTileOn404: true,
  fileExtension: 'jpg',
};

export const NASA_GIBS_BLUE_MARBLE: TileProviderConfig = {
  id: 'nasa-gibs-bluemarble',
  label: 'NASA GIBS Blue Marble',
  urlTemplate:
    'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg',
  minZoom: 0,
  maxZoom: 8,
  tileSize: 256,
  attribution: 'Imagery: NASA EOSDIS GIBS, Blue Marble',
  emptyTileOn404: true,
  fileExtension: 'jpg',
};

export function maptilerSatellite(apiKey: string): TileProviderConfig {
  return {
    id: 'maptiler-satellite-v2',
    label: 'MapTiler Satellite',
    urlTemplate: 'https://api.maptiler.com/tiles/satellite-v2/{z}/{x}/{y}.jpg?key={key}',
    apiKey,
    minZoom: 0,
    maxZoom: 20,
    tileSize: 512,
    attribution: '© MapTiler © OpenStreetMap contributors',
    emptyTileOn404: true,
    fileExtension: 'jpg',
  };
}

export function customProvider(config: Partial<TileProviderConfig> & Pick<TileProviderConfig, 'id' | 'urlTemplate' | 'attribution'>): TileProviderConfig {
  return {
    label: config.id,
    minZoom: 0,
    maxZoom: 19,
    tileSize: 256,
    emptyTileOn404: true,
    fileExtension: 'jpg',
    ...config,
  };
}

export const ESRI_REFERENCE_OVERLAY: OverlayLayerConfig = {
  id: 'esri-reference',
  label: 'Esri Boundaries & Places',
  urlTemplate: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}?blankTile=false',
  minZoom: 0,
  maxZoom: 19,
  tileSize: 256,
  attribution: 'Reference © Esri',
  emptyTileOn404: true,
  fileExtension: 'png',
  opacity: 0.9,
  blend: 'alpha',
};

export function buildTileUrl(provider: TileProviderConfig, coord: TileCoord): string {
  const subdomains = provider.subdomains ?? [];
  const sub = subdomains.length > 0 ? subdomains[(coord.x + coord.y) % subdomains.length] ?? '' : '';
  return provider.urlTemplate
    .replace('{z}', String(coord.z))
    .replace('{x}', String(coord.x))
    .replace('{y}', String(coord.y))
    .replace('{s}', sub)
    .replace('{r}', provider.retina ? '@2x' : '')
    .replace('{key}', encodeURIComponent(provider.apiKey ?? ''));
}

// ─────────────────────────────────────────────────────────────
//  Web decoder (fetch + createImageBitmap, decoded off the main thread)
// ─────────────────────────────────────────────────────────────

export class WebTileImageDecoder implements TileImageDecoder {
  async decode(request: TileDecodeRequest): Promise<DecodedTileImage> {
    const response = await fetch(request.url, {
      signal: request.signal,
      headers: request.provider.headers ? { ...request.provider.headers } : undefined,
      mode: 'cors',
      credentials: 'omit',
    });
    if (response.status === 404 || response.status === 204) {
      if (request.provider.emptyTileOn404) throw new EmptyTileError();
      throw new TileHttpError(response.status);
    }
    if (!response.ok) throw new TileHttpError(response.status);
    const blob = await response.blob();
    if (blob.size === 0) throw new EmptyTileError();
    const bitmap = await createImageBitmap(blob, {
      imageOrientation: 'none',
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'none',
    });
    if (request.signal.aborted) {
      bitmap.close();
      throw new DOMException('Aborted', 'AbortError');
    }
    return createBitmapImage(bitmap);
  }
}

export function createBitmapImage(bitmap: ImageBitmap): DecodedTileImage {
  let released = false;
  return {
    byteSize: bitmap.width * bitmap.height * 4 * (4 / 3),
    upload(gl) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    },
    release() {
      if (released) return;
      released = true;
      bitmap.close();
    },
  };
}

// ─────────────────────────────────────────────────────────────
//  GPU texture helper
// ─────────────────────────────────────────────────────────────

export interface GpuTexture {
  readonly glTexture: WebGLTexture;
  readonly texture: THREE.ExternalTexture;
  readonly byteSize: number;
}

export interface UploadOptions {
  wrapS: 'clamp' | 'repeat';
  mipmaps: boolean;
}

/** Anisotropy is queried once per context. */
const anisotropyCache = new WeakMap<object, { ext: EXT_texture_filter_anisotropic | null; max: number }>();

function getAnisotropy(gl: WebGL2RenderingContext): { ext: EXT_texture_filter_anisotropic | null; max: number } {
  const cached = anisotropyCache.get(gl);
  if (cached) return cached;
  let ext: EXT_texture_filter_anisotropic | null = null;
  let max = 1;
  try {
    ext = gl.getExtension('EXT_texture_filter_anisotropic');
    if (ext) max = Math.max(1, Number(gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT)) || 1);
  } catch {
    ext = null;
  }
  const value = { ext, max };
  anisotropyCache.set(gl, value);
  return value;
}

/**
 * Uploads a decoded image into a fresh GL texture with trilinear + maximum
 * anisotropic filtering. The caller must call `renderer.resetState()` after a
 * batch of uploads because GL bindings are changed behind three.js' back.
 */
export function uploadGpuTexture(gl: WebGL2RenderingContext, image: DecodedTileImage, options: UploadOptions): GpuTexture | null {
  const glTexture = gl.createTexture();
  if (!glTexture) return null;
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, glTexture);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  image.upload(gl);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, options.mipmaps ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, options.wrapS === 'repeat' ? gl.REPEAT : gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  if (options.mipmaps) gl.generateMipmap(gl.TEXTURE_2D);
  const aniso = getAnisotropy(gl);
  if (aniso.ext && aniso.max > 1) gl.texParameterf(gl.TEXTURE_2D, aniso.ext.TEXTURE_MAX_ANISOTROPY_EXT, aniso.max);
  gl.bindTexture(gl.TEXTURE_2D, null);
  const texture = new THREE.ExternalTexture(glTexture);
  return { glTexture, texture, byteSize: image.byteSize };
}

export function disposeGpuTexture(gl: WebGL2RenderingContext, gpu: GpuTexture): void {
  gpu.texture.dispose();
  gl.deleteTexture(gpu.glTexture);
}

// ─────────────────────────────────────────────────────────────
//  Cache entries
// ─────────────────────────────────────────────────────────────

export interface TileEntry {
  readonly key: string;
  readonly provider: TileProviderConfig;
  readonly coord: TileCoord;
  state: TileLoadState;
  gpu: GpuTexture | null;
  decoded: DecodedTileImage | null;
  controller: AbortController | null;
  /** Lower is more urgent. */
  priority: number;
  /** Last time (ms) the traversal asked for this tile. */
  lastWantedAt: number;
  /** Last frame the texture was bound for drawing (self or as fallback). */
  lastUsedFrame: number;
  retries: number;
  retryAt: number;
  /** Time (ms) the texture became ready; drives cross-fades. */
  readyAt: number;
}

export interface TileCacheOptions {
  maxCachedTiles: number;
  maxConcurrentRequests: number;
  uploadsPerFrame: number;
  abortAfterMs: number;
  maxRetries: number;
}

export interface ResolvedTexture {
  entry: TileEntry;
  /** [scaleU, scaleV, offsetU, offsetV] mapping node UV into this texture. */
  scaleOffset: [number, number, number, number];
}

function entryKey(providerId: string, z: number, x: number, y: number): string {
  return `${providerId}/${z}/${x}/${y}`;
}

function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: string }).name === 'AbortError';
}

export class TileCache {
  private readonly entries = new Map<string, TileEntry>();
  private readonly loading = new Set<TileEntry>();
  private readonly decodedQueue = new Set<TileEntry>();
  private readonly wantedThisFrame: TileEntry[] = [];
  private readyCount = 0;
  private disposed = false;
  private frame = 0;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly decoder: TileImageDecoder,
    private readonly options: TileCacheOptions,
    private readonly onTileReady: () => void,
  ) {}

  get size(): number {
    return this.readyCount;
  }

  get activeRequests(): number {
    return this.loading.size;
  }

  get pendingRequests(): number {
    return this.wantedThisFrame.length;
  }

  beginFrame(frame: number): void {
    this.frame = frame;
    this.wantedThisFrame.length = 0;
  }

  getEntry(provider: TileProviderConfig, coord: TileCoord): TileEntry {
    const key = entryKey(provider.id, coord.z, coord.x, coord.y);
    let entry = this.entries.get(key);
    if (!entry) {
      entry = {
        key,
        provider,
        coord: { z: coord.z, x: coord.x, y: coord.y },
        state: 'idle',
        gpu: null,
        decoded: null,
        controller: null,
        priority: Number.POSITIVE_INFINITY,
        lastWantedAt: 0,
        lastUsedFrame: -1,
        retries: 0,
        retryAt: 0,
        readyAt: 0,
      };
      this.entries.set(key, entry);
    }
    return entry;
  }

  peekEntry(provider: TileProviderConfig, z: number, x: number, y: number): TileEntry | undefined {
    return this.entries.get(entryKey(provider.id, z, x, y));
  }

  /** Marks a tile as wanted this frame. Keeps the most urgent priority seen. */
  request(provider: TileProviderConfig, coord: TileCoord, priority: number, now: number): TileEntry {
    const entry = this.getEntry(provider, coord);
    if (entry.lastWantedAt !== now) {
      entry.priority = priority;
      entry.lastWantedAt = now;
      if (entry.state === 'idle' || entry.state === 'loading' || (entry.state === 'failed' && entry.retries <= this.options.maxRetries)) {
        this.wantedThisFrame.push(entry);
      }
    } else if (priority < entry.priority) {
      entry.priority = priority;
    }
    return entry;
  }

  /**
   * True when the tile will never improve any further: it is uploaded, the
   * server has no imagery for it, or it failed permanently.
   */
  isSettled(entry: TileEntry): boolean {
    return entry.state === 'ready' || entry.state === 'empty' || (entry.state === 'failed' && entry.retries > this.options.maxRetries);
  }

  /**
   * Finds the deepest uploaded texture for `coord` at or above `targetZ`,
   * walking up the ancestor chain. Marks every returned entry as used.
   */
  resolve(provider: TileProviderConfig, coord: TileCoord, targetZ: number, minZ: number): ResolvedTexture | null {
    const start = Math.min(targetZ, coord.z);
    for (let z = start; z >= minZ; z -= 1) {
      const d = coord.z - z;
      const entry = this.entries.get(entryKey(provider.id, z, coord.x >> d, coord.y >> d));
      if (entry && entry.state === 'ready' && entry.gpu) {
        entry.lastUsedFrame = this.frame;
        return { entry, scaleOffset: ancestorScaleOffset(coord, z, [1, 1, 0, 0]) };
      }
    }
    return null;
  }

  /** Pins a tile (and implicitly protects it from LRU eviction this frame). */
  touch(entry: TileEntry): void {
    entry.lastUsedFrame = this.frame;
  }

  /** Network scheduling: abort stale requests, start the most urgent ones. */
  pump(now: number): void {
    if (this.disposed) return;

    for (const entry of this.loading) {
      if (now - entry.lastWantedAt > this.options.abortAfterMs) {
        entry.controller?.abort();
        entry.controller = null;
        entry.state = 'idle';
        this.loading.delete(entry);
      }
    }

    const free = this.options.maxConcurrentRequests - this.loading.size;
    if (free <= 0) return;

    const candidates = this.wantedThisFrame.filter(
      (e) => (e.state === 'idle' || (e.state === 'failed' && e.retries <= this.options.maxRetries && now >= e.retryAt)) && e.lastWantedAt === now,
    );
    candidates.sort((a, b) => a.priority - b.priority);
    const count = Math.min(free, candidates.length);
    for (let i = 0; i < count; i += 1) {
      const entry = candidates[i];
      if (entry) this.startLoad(entry);
    }
  }

  private startLoad(entry: TileEntry): void {
    const controller = new AbortController();
    entry.controller = controller;
    entry.state = 'loading';
    this.loading.add(entry);
    const url = buildTileUrl(entry.provider, entry.coord);
    this.decoder
      .decode({ url, provider: entry.provider, coord: entry.coord, signal: controller.signal })
      .then((image) => {
        if (this.disposed || controller.signal.aborted || entry.controller !== controller) {
          image.release();
          return;
        }
        this.loading.delete(entry);
        entry.controller = null;
        entry.decoded = image;
        entry.state = 'decoded';
        this.decodedQueue.add(entry);
      })
      .catch((error: unknown) => {
        if (entry.controller !== controller) return;
        this.loading.delete(entry);
        entry.controller = null;
        if (this.disposed) return;
        if (isAbortError(error) || controller.signal.aborted) {
          entry.state = 'idle';
          return;
        }
        if (error instanceof EmptyTileError) {
          entry.state = 'empty';
          this.onTileReady();
          return;
        }
        const permanent = error instanceof TileHttpError && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429;
        entry.retries = permanent ? this.options.maxRetries + 1 : entry.retries + 1;
        entry.retryAt = Date.now() + 500 * 2 ** Math.min(entry.retries, 6);
        entry.state = 'failed';
        if (entry.retries > this.options.maxRetries) this.onTileReady();
      });
  }

  /**
   * Uploads up to `uploadsPerFrame` decoded images, most urgent first.
   * Returns the number of uploads (caller resets three.js GL state if > 0).
   */
  processUploads(now: number): number {
    if (this.decodedQueue.size === 0) return 0;
    const queue = [...this.decodedQueue].sort((a, b) => {
      const aw = a.lastWantedAt === now ? 0 : 1;
      const bw = b.lastWantedAt === now ? 0 : 1;
      return aw - bw || a.priority - b.priority;
    });
    let uploads = 0;
    for (const entry of queue) {
      if (uploads >= this.options.uploadsPerFrame) break;
      this.decodedQueue.delete(entry);
      const image = entry.decoded;
      entry.decoded = null;
      if (!image) continue;
      try {
        const gpu = uploadGpuTexture(this.gl, image, { wrapS: 'clamp', mipmaps: true });
        if (gpu) {
          entry.gpu = gpu;
          entry.state = 'ready';
          entry.readyAt = now;
          entry.lastUsedFrame = this.frame;
          this.readyCount += 1;
        } else {
          entry.state = 'idle';
        }
      } catch {
        entry.retries += 1;
        entry.retryAt = Date.now() + 1000;
        entry.state = 'failed';
      } finally {
        image.release();
      }
      uploads += 1;
    }
    if (uploads > 0) this.onTileReady();
    return uploads;
  }

  /**
   * LRU eviction down to the texture budget. Textures bound this frame (drawn
   * tiles AND their fallback ancestors) are never evicted.
   */
  evict(): void {
    if (this.readyCount > this.options.maxCachedTiles) {
      const ready: TileEntry[] = [];
      for (const entry of this.entries.values()) {
        if (entry.state === 'ready' && entry.lastUsedFrame !== this.frame) ready.push(entry);
      }
      ready.sort((a, b) => a.lastUsedFrame - b.lastUsedFrame || b.coord.z - a.coord.z);
      let excess = this.readyCount - this.options.maxCachedTiles;
      for (const entry of ready) {
        if (excess <= 0) break;
        this.releaseEntry(entry);
        this.entries.delete(entry.key);
        excess -= 1;
      }
    }

    // Metadata of settled-empty / idle entries is tiny but unbounded; trim it.
    const metadataLimit = this.options.maxCachedTiles * 6;
    if (this.entries.size > metadataLimit) {
      for (const entry of this.entries.values()) {
        if (this.entries.size <= metadataLimit) break;
        if (entry.state !== 'ready' && entry.state !== 'loading' && entry.state !== 'decoded' && this.frame - entry.lastUsedFrame > 120) {
          this.entries.delete(entry.key);
        }
      }
    }
  }

  private releaseEntry(entry: TileEntry): void {
    entry.controller?.abort();
    entry.controller = null;
    this.loading.delete(entry);
    if (entry.decoded) {
      entry.decoded.release();
      entry.decoded = null;
    }
    this.decodedQueue.delete(entry);
    if (entry.gpu) {
      disposeGpuTexture(this.gl, entry.gpu);
      entry.gpu = null;
      this.readyCount -= 1;
    }
    entry.state = 'idle';
  }

  /** Drops every tile of a provider (used when the user switches providers). */
  purgeProvider(providerId: string): void {
    for (const entry of [...this.entries.values()]) {
      if (entry.provider.id === providerId) {
        this.releaseEntry(entry);
        this.entries.delete(entry.key);
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const entry of this.entries.values()) this.releaseEntry(entry);
    this.entries.clear();
    this.loading.clear();
    this.decodedQueue.clear();
    this.readyCount = 0;
    this.decoder.dispose?.();
  }
}
