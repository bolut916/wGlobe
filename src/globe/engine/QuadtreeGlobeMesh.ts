/**
 * Dynamic quadtree of Web Mercator tiles rendered on a sphere.
 *
 * One quadtree node ⇔ one XYZ tile (z, x, y). Geometry is a regular grid in
 * MERCATOR space, so the tile image maps onto it with plain linear UVs, and
 * every vertex is placed exactly on the sphere in float64 before being stored
 * relative to the tile centre (float32-safe). Each tile carries four skirts
 * that hide T-junction cracks between neighbours of different levels.
 * Latitudes beyond ±85.0511° (where Mercator ends) are closed by two polar
 * cap meshes.
 *
 * Per frame:
 *   1. traverse from the roots; cull with the view frustum and the horizon
 *      (Cesium-style occluder) BEFORE any request is issued;
 *   2. refine while the texel screen-space error exceeds the threshold, but
 *      only once all four (visible) children have settled textures (zero
 *      flicker), or after a timeout using the parent's UV sub-rect;
 *   3. every drawn tile cross-fades from its ancestor sub-rect to its own
 *      texture over `fadeDurationMs` (u_fadeProgress).
 */
import * as THREE from 'three';

import {
  computeHorizonCullingPoint,
  ecefToGeodetic,
  geodeticToEcef,
  isScaledPointOccluded,
  MERCATOR_MAX_LAT_RAD,
  mercatorTexelSize,
  nearestPointInBounds,
  normalize3,
  projectedSize,
  smootherstep,
  smoothstep,
  tileBounds,
  tileCount,
  tileXToLon,
  tileYToLat,
  type GeodeticRad,
  type TileBoundsRad,
  type Vec3,
} from '../math/sphericalMath';
import { createSurfaceMaterial, MAX_OVERLAYS, type SharedSurfaceUniforms, type SurfaceMaterial } from '../shaders/earthShaders';
import type { GlobeEngineConfig, OverlayLayerConfig, TileCoord, TileProviderConfig } from '../types/globe';
import type { TileCache, TileEntry } from './TileCacheAndLoader';

// ─────────────────────────────────────────────────────────────
//  Geometry builders
// ─────────────────────────────────────────────────────────────

export function segmentsForLevel(z: number): number {
  if (z <= 3) return 32;
  if (z <= 6) return 16;
  return 8;
}

interface GeometryBuffers {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  lonLat: Float32Array;
  indices: number[];
}

function makeGeometry(buffers: GeometryBuffers): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(buffers.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(buffers.normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(buffers.uvs, 2));
  geometry.setAttribute('a_lonLat', new THREE.BufferAttribute(buffers.lonLat, 2));
  const vertexCount = buffers.positions.length / 3;
  geometry.setIndex(new THREE.BufferAttribute(vertexCount < 65536 ? new Uint16Array(buffers.indices) : new Uint32Array(buffers.indices), 1));
  return geometry;
}

const scratchPoint: Vec3 = { x: 0, y: 0, z: 0 };

function writeVertex(
  buffers: GeometryBuffers,
  index: number,
  lat: number,
  lon: number,
  radius: number,
  center: Vec3,
  u: number,
  v: number,
): void {
  geodeticToEcef(scratchPoint, lat, lon, radius);
  buffers.positions[index * 3] = scratchPoint.x - center.x;
  buffers.positions[index * 3 + 1] = scratchPoint.y - center.y;
  buffers.positions[index * 3 + 2] = scratchPoint.z - center.z;
  const cosLat = Math.cos(lat);
  buffers.normals[index * 3] = cosLat * Math.cos(lon);
  buffers.normals[index * 3 + 1] = Math.sin(lat);
  buffers.normals[index * 3 + 2] = -cosLat * Math.sin(lon);
  buffers.uvs[index * 2] = u;
  buffers.uvs[index * 2 + 1] = v;
  buffers.lonLat[index * 2] = lon;
  buffers.lonLat[index * 2 + 1] = lat;
}

/**
 * Mercator-uniform grid for tile (z, x, y) with skirts.
 * Grid vertex (i, j): i grows east, j grows south; uv = (i/N, j/N), v = 0 at
 * the north edge (textures are uploaded without Y flip). Triangles are CCW
 * seen from outside the sphere.
 */
export function buildTileGeometry(coord: TileCoord, radius: number, center: Vec3, skirtDepth: number): THREE.BufferGeometry {
  const n = segmentsForLevel(coord.z);
  const row = n + 1;
  const gridCount = row * row;
  const total = gridCount + 4 * row;
  const buffers: GeometryBuffers = {
    positions: new Float32Array(total * 3),
    normals: new Float32Array(total * 3),
    uvs: new Float32Array(total * 2),
    lonLat: new Float32Array(total * 2),
    indices: [],
  };
  const lons = new Float64Array(row);
  const lats = new Float64Array(row);
  for (let i = 0; i <= n; i += 1) lons[i] = tileXToLon(coord.x + i / n, coord.z);
  for (let j = 0; j <= n; j += 1) lats[j] = tileYToLat(coord.y + j / n, coord.z);

  const gridIndex = (i: number, j: number): number => j * row + i;
  for (let j = 0; j <= n; j += 1) {
    for (let i = 0; i <= n; i += 1) {
      writeVertex(buffers, gridIndex(i, j), lats[j] ?? 0, lons[i] ?? 0, radius, center, i / n, j / n);
    }
  }
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const a = gridIndex(i, j);
      const b = gridIndex(i, j + 1);
      const c = gridIndex(i + 1, j);
      const d = gridIndex(i + 1, j + 1);
      buffers.indices.push(a, b, c, c, b, d);
    }
  }

  // Skirts: boundary walked counter-clockwise seen from outside (interior on the left).
  const edges: Array<Array<[number, number]>> = [
    Array.from({ length: row }, (_, k) => [k, n] as [number, number]), // south, west → east
    Array.from({ length: row }, (_, k) => [n, n - k] as [number, number]), // east, south → north
    Array.from({ length: row }, (_, k) => [n - k, 0] as [number, number]), // north, east → west
    Array.from({ length: row }, (_, k) => [0, k] as [number, number]), // west, north → south
  ];
  let next = gridCount;
  const skirtRadius = radius - skirtDepth;
  for (const edge of edges) {
    const start = next;
    for (const [i, j] of edge) {
      writeVertex(buffers, next, lats[j] ?? 0, lons[i] ?? 0, skirtRadius, center, i / n, j / n);
      next += 1;
    }
    for (let k = 0; k < n; k += 1) {
      const e0 = edge[k];
      const e1 = edge[k + 1];
      if (!e0 || !e1) continue;
      const p0 = gridIndex(e0[0], e0[1]);
      const p1 = gridIndex(e1[0], e1[1]);
      const s0 = start + k;
      const s1 = start + k + 1;
      buffers.indices.push(p1, p0, s1, p0, s0, s1);
    }
  }
  return makeGeometry(buffers);
}

/**
 * Polar cap from ±85.0511° to the pole, with an outward skirt on its rim.
 * `rings` latitude bands × `segments` longitude slices.
 */
export function buildPolarCapGeometry(north: boolean, radius: number, center: Vec3, rings: number, segments: number, skirtDepth: number): THREE.BufferGeometry {
  const row = segments + 1;
  const gridCount = row * (rings + 1);
  const total = gridCount + row;
  const buffers: GeometryBuffers = {
    positions: new Float32Array(total * 3),
    normals: new Float32Array(total * 3),
    uvs: new Float32Array(total * 2),
    lonLat: new Float32Array(total * 2),
    indices: [],
  };
  const sign = north ? 1 : -1;
  const latAt = (j: number): number => sign * (MERCATOR_MAX_LAT_RAD + (Math.PI / 2 - MERCATOR_MAX_LAT_RAD) * (j / rings));
  const lonAt = (i: number): number => -Math.PI + (2 * Math.PI * i) / segments;
  const index = (i: number, j: number): number => j * row + i;
  for (let j = 0; j <= rings; j += 1) {
    for (let i = 0; i <= segments; i += 1) {
      // At the pole every slice keeps its own longitude so equirect lookups stay seam-free.
      const lon = j === rings ? lonAt(i) + Math.PI / segments : lonAt(i);
      writeVertex(buffers, index(i, j), latAt(j), lon, radius, center, i / segments, j / rings);
    }
  }
  for (let j = 0; j < rings; j += 1) {
    for (let i = 0; i < segments; i += 1) {
      const a = index(i, j);
      const b = index(i + 1, j);
      const c = index(i, j + 1);
      const d = index(i + 1, j + 1);
      // j grows poleward: northward for the north cap (CCW = a,b,c), southward for the south cap.
      if (north) buffers.indices.push(a, b, c, b, d, c);
      else buffers.indices.push(a, c, b, b, c, d);
    }
  }
  const start = gridCount;
  for (let i = 0; i <= segments; i += 1) {
    writeVertex(buffers, start + i, latAt(0), lonAt(i), radius - skirtDepth, center, i / segments, 0);
  }
  for (let k = 0; k < segments; k += 1) {
    // Rim walked with the cap interior on the left: eastward (north cap) / westward (south cap).
    const k0 = north ? k : segments - k;
    const k1 = north ? k + 1 : segments - k - 1;
    const p0 = index(k0, 0);
    const p1 = index(k1, 0);
    const s0 = start + k0;
    const s1 = start + k1;
    buffers.indices.push(p1, p0, s1, p0, s0, s1);
  }
  return makeGeometry(buffers);
}

// ─────────────────────────────────────────────────────────────
//  Nodes
// ─────────────────────────────────────────────────────────────

interface Bounding {
  center: Vec3;
  radius: number;
  /** Scaled-space horizon culling point, or null (never horizon-cull). */
  horizonPoint: Vec3 | null;
}

function computeBounding(samples: Vec3[], meshCenter: Vec3, radius: number): Bounding {
  const center: Vec3 = { x: 0, y: 0, z: 0 };
  for (const p of samples) {
    center.x += p.x;
    center.y += p.y;
    center.z += p.z;
  }
  center.x /= samples.length;
  center.y /= samples.length;
  center.z /= samples.length;
  let r = 0;
  for (const p of samples) {
    const dx = p.x - center.x;
    const dy = p.y - center.y;
    const dz = p.z - center.z;
    r = Math.max(r, Math.sqrt(dx * dx + dy * dy + dz * dz));
  }
  const direction = normalize3({ x: 0, y: 0, z: 0 }, meshCenter);
  const horizonPoint: Vec3 = { x: 0, y: 0, z: 0 };
  const ok = computeHorizonCullingPoint(direction, samples, radius, horizonPoint);
  return { center, radius: r * 1.0005 + 1, horizonPoint: ok ? horizonPoint : null };
}

class TileNode {
  readonly coord: TileCoord;
  readonly bounds: TileBoundsRad;
  readonly meshCenter: Vec3;
  readonly bounding: Bounding;
  readonly skirtDepth: number;
  children: TileNode[] | null = null;
  mesh: THREE.Mesh<THREE.BufferGeometry, SurfaceMaterial> | null = null;
  refined = false;
  refineWaitStart = -1;
  lastVisitedFrame = -1;
  lastRenderedFrame = -1;
  visibilityFrame = -1;
  visible = false;
  culledBy: 'none' | 'frustum' | 'horizon' = 'none';
  fadeStart = -1;
  hadOwnTexture = false;

  constructor(
    coord: TileCoord,
    readonly parent: TileNode | null,
    radius: number,
  ) {
    this.coord = coord;
    this.bounds = tileBounds(coord.z, coord.x, coord.y);
    const midLat = tileYToLat(coord.y + 0.5, coord.z);
    const midLon = (this.bounds.west + this.bounds.east) / 2;
    this.meshCenter = geodeticToEcef({ x: 0, y: 0, z: 0 }, midLat, midLon, radius);
    const steps = coord.z < 6 ? 4 : 2;
    const samples: Vec3[] = [];
    for (let j = 0; j <= steps; j += 1) {
      const lat = tileYToLat(coord.y + j / steps, coord.z);
      for (let i = 0; i <= steps; i += 1) {
        samples.push(geodeticToEcef({ x: 0, y: 0, z: 0 }, lat, tileXToLon(coord.x + i / steps, coord.z), radius));
      }
    }
    this.bounding = computeBounding(samples, this.meshCenter, radius);
    const arc = radius * (this.bounds.east - this.bounds.west) * Math.cos(midLat);
    this.skirtDepth = Math.max(arc * 0.05, 2);
  }
}

// ─────────────────────────────────────────────────────────────
//  Frame context
// ─────────────────────────────────────────────────────────────

export interface QuadtreeFrameContext {
  /** Camera with position (0,0,0) and the real orientation (camera-relative rendering). */
  camera: THREE.PerspectiveCamera;
  /** Camera position in ECEF, float64. */
  cameraEcef: Vec3;
  frustum: THREE.Frustum;
  viewportHeightPx: number;
  now: number;
  frame: number;
}

export interface QuadtreeFrameStats {
  renderedTiles: number;
  visitedNodes: number;
  culledFrustum: number;
  culledHorizon: number;
  deepestLevel: number;
  animating: boolean;
}

const tmpSphere = new THREE.Sphere();
const tmpVec = new THREE.Vector3();
const tmpNearest = { lat: 0, lon: 0 };
const tmpGeo: GeodeticRad = { lat: 0, lon: 0, r: 0 };
const tmpScaledCam: Vec3 = { x: 0, y: 0, z: 0 };

const CAP_RINGS = 16;
const CAP_SEGMENTS = 128;

export class QuadtreeGlobeMesh {
  readonly group = new THREE.Group();
  private roots: TileNode[] = [];
  private caps: Array<{ north: boolean; mesh: THREE.Mesh<THREE.BufferGeometry, SurfaceMaterial>; bounding: Bounding; center: Vec3 }> = [];
  private provider: TileProviderConfig;
  private overlays: OverlayLayerConfig[] = [];
  private renderedThisFrame: TileNode[] = [];
  private renderedPrevious = new Set<TileNode>();
  private stats: QuadtreeFrameStats = { renderedTiles: 0, visitedNodes: 0, culledFrustum: 0, culledHorizon: 0, deepestLevel: 0, animating: false };
  private ctx: QuadtreeFrameContext | null = null;

  constructor(
    private readonly cache: TileCache,
    private readonly shared: SharedSurfaceUniforms,
    private readonly config: GlobeEngineConfig,
    provider: TileProviderConfig,
  ) {
    this.provider = provider;
    this.group.name = 'quadtree-globe';
    this.buildRoots();
    this.buildCaps();
  }

  private buildRoots(): void {
    const z = this.config.minLevel;
    const count = tileCount(z);
    for (let y = 0; y < count; y += 1) {
      for (let x = 0; x < count; x += 1) {
        this.roots.push(new TileNode({ z, x, y }, null, this.config.radius));
      }
    }
  }

  private buildCaps(): void {
    const radius = this.config.radius;
    for (const north of [true, false]) {
      const sign = north ? 1 : -1;
      const center = geodeticToEcef({ x: 0, y: 0, z: 0 }, sign * Math.PI / 2, 0, radius);
      const capArc = radius * (Math.PI / 2 - MERCATOR_MAX_LAT_RAD);
      const geometry = buildPolarCapGeometry(north, radius, center, CAP_RINGS, CAP_SEGMENTS, capArc * 0.1);
      const material = createSurfaceMaterial(this.shared, true);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.name = north ? 'north-cap' : 'south-cap';
      this.group.add(mesh);
      const samples: Vec3[] = [];
      for (let i = 0; i < 16; i += 1) {
        samples.push(geodeticToEcef({ x: 0, y: 0, z: 0 }, sign * MERCATOR_MAX_LAT_RAD, (i / 16) * 2 * Math.PI - Math.PI, radius));
      }
      samples.push(center);
      this.caps.push({ north, mesh, bounding: computeBounding(samples, center, radius), center });
    }
  }

  get activeProvider(): TileProviderConfig {
    return this.provider;
  }

  setProvider(provider: TileProviderConfig): void {
    if (provider.id === this.provider.id) return;
    const previous = this.provider;
    this.provider = provider;
    this.forEachNode((node) => {
      node.hadOwnTexture = false;
      node.fadeStart = -1;
      node.refined = false;
      node.refineWaitStart = -1;
    });
    this.cache.purgeProvider(previous.id);
  }

  setOverlays(overlays: readonly OverlayLayerConfig[]): void {
    const nextIds = new Set(overlays.map((o) => o.id));
    for (const old of this.overlays) if (!nextIds.has(old.id)) this.cache.purgeProvider(old.id);
    this.overlays = overlays.slice(0, MAX_OVERLAYS);
    this.shared.u_overlay0Screen.value = this.overlays[0]?.blend === 'screen' ? 1 : 0;
    this.shared.u_overlay1Screen.value = this.overlays[1]?.blend === 'screen' ? 1 : 0;
  }

  private forEachNode(fn: (node: TileNode) => void): void {
    const stack = [...this.roots];
    while (stack.length > 0) {
      const node = stack.pop();
      if (!node) continue;
      fn(node);
      if (node.children) stack.push(...node.children);
    }
  }

  // ── Culling ──────────────────────────────────────────────────

  private testVisibility(node: TileNode, ctx: QuadtreeFrameContext): boolean {
    if (node.visibilityFrame === ctx.frame) return node.visible;
    node.visibilityFrame = ctx.frame;
    const b = node.bounding;
    tmpSphere.center.set(b.center.x - ctx.cameraEcef.x, b.center.y - ctx.cameraEcef.y, b.center.z - ctx.cameraEcef.z);
    tmpSphere.radius = b.radius;
    if (!ctx.frustum.intersectsSphere(tmpSphere)) {
      node.visible = false;
      node.culledBy = 'frustum';
      return false;
    }
    if (b.horizonPoint && isScaledPointOccluded(tmpScaledCam, b.horizonPoint)) {
      node.visible = false;
      node.culledBy = 'horizon';
      return false;
    }
    node.visible = true;
    node.culledBy = 'none';
    return true;
  }

  // ── Screen-space error ───────────────────────────────────────

  /** Projected size (px) of one texel of this node's imagery at its nearest point. */
  private screenSpaceError(node: TileNode, ctx: QuadtreeFrameContext): number {
    nearestPointInBounds(tmpGeo.lat, tmpGeo.lon, node.bounds, tmpNearest);
    const p = geodeticToEcef(scratchPoint, tmpNearest.lat, tmpNearest.lon, this.config.radius);
    const dx = p.x - ctx.cameraEcef.x;
    const dy = p.y - ctx.cameraEcef.y;
    const dz = p.z - ctx.cameraEcef.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const texel = mercatorTexelSize(node.coord.z, this.provider.tileSize, tmpNearest.lat, this.config.radius);
    let sse = projectedSize(texel, distance, ctx.viewportHeightPx, ctx.camera.fov * (Math.PI / 180));
    if (this.config.obliqueAttenuation > 0 && distance > 0) {
      // Foreshortening: |cos| between the surface normal and the view ray.
      const r = this.config.radius;
      const cosIncidence = Math.abs((dx * p.x + dy * p.y + dz * p.z) / (distance * r));
      sse *= 1 - this.config.obliqueAttenuation * (1 - Math.max(cosIncidence, 0.25));
    }
    return sse;
  }

  private priorityOf(node: TileNode, ctx: QuadtreeFrameContext): number {
    tmpVec.set(node.meshCenter.x - ctx.cameraEcef.x, node.meshCenter.y - ctx.cameraEcef.y, node.meshCenter.z - ctx.cameraEcef.z);
    tmpVec.applyMatrix4(ctx.camera.matrixWorldInverse);
    let screenDistance = 2;
    if (tmpVec.z < 0) {
      tmpVec.applyMatrix4(ctx.camera.projectionMatrix);
      screenDistance = Math.min(Math.hypot(tmpVec.x, tmpVec.y), 2);
    }
    return node.coord.z * 10 + screenDistance * 5;
  }

  private targetLevel(z: number): number {
    return Math.min(z, this.provider.maxZoom);
  }

  private targetEntry(node: TileNode, priority: number, ctx: QuadtreeFrameContext): TileEntry {
    const tz = this.targetLevel(node.coord.z);
    const d = node.coord.z - tz;
    return this.cache.request(this.provider, { z: tz, x: node.coord.x >> d, y: node.coord.y >> d }, priority, ctx.now);
  }

  // ── Traversal ────────────────────────────────────────────────

  update(ctx: QuadtreeFrameContext): QuadtreeFrameStats {
    this.ctx = ctx;
    this.renderedThisFrame = [];
    this.stats = { renderedTiles: 0, visitedNodes: 0, culledFrustum: 0, culledHorizon: 0, deepestLevel: 0, animating: false };
    ecefToGeodetic(ctx.cameraEcef, tmpGeo);
    tmpScaledCam.x = ctx.cameraEcef.x / this.config.radius;
    tmpScaledCam.y = ctx.cameraEcef.y / this.config.radius;
    tmpScaledCam.z = ctx.cameraEcef.z / this.config.radius;

    // Request order is resolved later by the cache (priority = z·10 + screen distance·5).
    for (const root of this.roots) this.visit(root, ctx);

    const current = new Set(this.renderedThisFrame);
    for (const node of this.renderedPrevious) {
      if (!current.has(node) && node.mesh) node.mesh.visible = false;
    }
    for (const node of this.renderedThisFrame) this.drawNode(node, ctx);
    this.renderedPrevious = current;

    this.updateCaps(ctx);
    if (ctx.frame % 90 === 0) this.prune(ctx.frame);
    this.stats.renderedTiles = this.renderedThisFrame.length;
    return this.stats;
  }

  private visit(node: TileNode, ctx: QuadtreeFrameContext): void {
    node.lastVisitedFrame = ctx.frame;
    this.stats.visitedNodes += 1;
    if (!this.testVisibility(node, ctx)) {
      if (node.culledBy === 'frustum') this.stats.culledFrustum += 1;
      else this.stats.culledHorizon += 1;
      node.refined = false;
      node.refineWaitStart = -1;
      return;
    }

    const priority = this.priorityOf(node, ctx);
    const own = this.targetEntry(node, priority, ctx);
    const sse = this.screenSpaceError(node, ctx);
    const threshold = node.refined ? this.config.sseThreshold * this.config.sseHysteresis : this.config.sseThreshold;
    const maxLevel = Math.min(this.config.maxLevel, this.provider.maxZoom);
    const wantsRefine = node.coord.z < maxLevel && sse > threshold && own.state !== 'empty';

    if (wantsRefine) {
      if (!node.children) node.children = this.createChildren(node);
      let allSettled = true;
      for (const child of node.children) {
        if (!this.testVisibility(child, ctx)) continue;
        const entry = this.targetEntry(child, this.priorityOf(child, ctx), ctx);
        // Uploaded-but-not-yet-drawn children are pinned so LRU pressure cannot livelock refinement.
        if (entry.state === 'ready') this.cache.touch(entry);
        if (!this.cache.isSettled(entry)) allSettled = false;
      }
      if (!allSettled) {
        if (node.refineWaitStart < 0) node.refineWaitStart = ctx.now;
        if (ctx.now - node.refineWaitStart > this.config.refineTimeoutMs && this.cache.isSettled(own)) allSettled = true;
      }
      if (allSettled) {
        node.refined = true;
        node.refineWaitStart = -1;
        for (const child of node.children) this.visit(child, ctx);
        return;
      }
    } else {
      node.refineWaitStart = -1;
    }
    node.refined = false;
    this.renderedThisFrame.push(node);
    if (node.coord.z > this.stats.deepestLevel) this.stats.deepestLevel = node.coord.z;
  }

  private createChildren(node: TileNode): TileNode[] {
    const { z, x, y } = node.coord;
    const radius = this.config.radius;
    return [
      new TileNode({ z: z + 1, x: x * 2, y: y * 2 }, node, radius),
      new TileNode({ z: z + 1, x: x * 2 + 1, y: y * 2 }, node, radius),
      new TileNode({ z: z + 1, x: x * 2, y: y * 2 + 1 }, node, radius),
      new TileNode({ z: z + 1, x: x * 2 + 1, y: y * 2 + 1 }, node, radius),
    ];
  }

  // ── Drawing ──────────────────────────────────────────────────

  private ensureMesh(node: TileNode): THREE.Mesh<THREE.BufferGeometry, SurfaceMaterial> {
    if (node.mesh) return node.mesh;
    const geometry = buildTileGeometry(node.coord, this.config.radius, node.meshCenter, node.skirtDepth);
    const material = createSurfaceMaterial(this.shared, false);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = true;
    mesh.name = `tile-${node.coord.z}-${node.coord.x}-${node.coord.y}`;
    this.group.add(mesh);
    node.mesh = mesh;
    return mesh;
  }

  private drawNode(node: TileNode, ctx: QuadtreeFrameContext): void {
    const mesh = this.ensureMesh(node);
    mesh.visible = true;
    mesh.position.set(node.meshCenter.x - ctx.cameraEcef.x, node.meshCenter.y - ctx.cameraEcef.y, node.meshCenter.z - ctx.cameraEcef.z);
    const u = mesh.material.uniforms;
    const coord = node.coord;
    const targetZ = this.targetLevel(coord.z);

    const own = this.cache.resolve(this.provider, coord, targetZ, targetZ);
    const fallback = this.cache.resolve(this.provider, coord, targetZ - 1, 0);
    const wasRendered = node.lastRenderedFrame === ctx.frame - 1;
    const fadeMs = this.config.fadeDurationMs;

    if (own) {
      if (!wasRendered) {
        // Fresh by refinement → fade in from the parent's sub-rect.
        // Fresh by coarsening or panning → show immediately.
        const parentWasShown = node.parent !== null && node.parent.lastRenderedFrame === ctx.frame - 1;
        node.fadeStart = parentWasShown ? ctx.now : ctx.now - fadeMs;
      } else if (!node.hadOwnTexture) {
        node.fadeStart = ctx.now;
      }
      node.hadOwnTexture = true;
      u.u_tileTexture.value = own.entry.gpu?.texture ?? null;
      u.u_tileST.value.set(own.scaleOffset[0], own.scaleOffset[1], own.scaleOffset[2], own.scaleOffset[3]);
      u.u_hasTile.value = 1;
      const progress = fadeMs > 0 ? smootherstep((ctx.now - node.fadeStart) / fadeMs) : 1;
      u.u_fadeProgress.value = progress;
      if (progress < 1) this.stats.animating = true;
    } else {
      node.hadOwnTexture = false;
      u.u_tileTexture.value = null;
      u.u_hasTile.value = 0;
      u.u_fadeProgress.value = 0;
    }

    if (fallback) {
      u.u_fallbackTexture.value = fallback.entry.gpu?.texture ?? null;
      u.u_fallbackST.value.set(fallback.scaleOffset[0], fallback.scaleOffset[1], fallback.scaleOffset[2], fallback.scaleOffset[3]);
      u.u_hasFallback.value = 1;
    } else {
      u.u_fallbackTexture.value = null;
      u.u_hasFallback.value = 0;
    }

    // Overlays: request the matching level and draw the best available ancestor.
    for (let k = 0; k < MAX_OVERLAYS; k += 1) {
      const layer = this.overlays[k];
      const texUniform = k === 0 ? u.u_overlay0 : u.u_overlay1;
      const stUniform = k === 0 ? u.u_overlay0ST : u.u_overlay1ST;
      const opacityUniform = k === 0 ? u.u_overlay0Opacity : u.u_overlay1Opacity;
      if (!layer || coord.z < layer.minZoom) {
        texUniform.value = null;
        opacityUniform.value = 0;
        continue;
      }
      const oz = Math.min(coord.z, layer.maxZoom);
      const d = coord.z - oz;
      this.cache.request(layer, { z: oz, x: coord.x >> d, y: coord.y >> d }, this.priorityOf(node, ctx) + 4, ctx.now);
      const resolved = this.cache.resolve(layer, coord, oz, layer.minZoom);
      if (resolved) {
        texUniform.value = resolved.entry.gpu?.texture ?? null;
        stUniform.value.set(resolved.scaleOffset[0], resolved.scaleOffset[1], resolved.scaleOffset[2], resolved.scaleOffset[3]);
        opacityUniform.value = layer.opacity;
      } else {
        texUniform.value = null;
        opacityUniform.value = 0;
      }
    }

    u.u_tileTexelSize.value = 1 / this.provider.tileSize;
    u.u_zoomDetail.value = smoothstep(6, 11, coord.z);
    node.lastRenderedFrame = ctx.frame;
  }

  private updateCaps(ctx: QuadtreeFrameContext): void {
    for (const cap of this.caps) {
      const b = cap.bounding;
      tmpSphere.center.set(b.center.x - ctx.cameraEcef.x, b.center.y - ctx.cameraEcef.y, b.center.z - ctx.cameraEcef.z);
      tmpSphere.radius = b.radius;
      const visible = ctx.frustum.intersectsSphere(tmpSphere) && !(b.horizonPoint && isScaledPointOccluded(tmpScaledCam, b.horizonPoint));
      cap.mesh.visible = visible;
      if (!visible) continue;
      cap.mesh.position.set(cap.center.x - ctx.cameraEcef.x, cap.center.y - ctx.cameraEcef.y, cap.center.z - ctx.cameraEcef.z);
    }
  }

  // ── Memory ───────────────────────────────────────────────────

  /** Disposes subtrees that have not been visited for ~5 s. */
  private prune(frame: number): void {
    const staleBefore = frame - 300;
    const stack = [...this.roots];
    while (stack.length > 0) {
      const node = stack.pop();
      if (!node || !node.children) continue;
      if (!node.refined && node.children.every((c) => this.subtreeStale(c, staleBefore))) {
        for (const child of node.children) this.disposeSubtree(child);
        node.children = null;
      } else {
        stack.push(...node.children);
      }
    }
  }

  private subtreeStale(node: TileNode, staleBefore: number): boolean {
    if (node.lastVisitedFrame >= staleBefore) return false;
    return node.children ? node.children.every((c) => this.subtreeStale(c, staleBefore)) : true;
  }

  private disposeSubtree(node: TileNode): void {
    if (node.children) for (const child of node.children) this.disposeSubtree(child);
    node.children = null;
    this.disposeNodeMesh(node);
    this.renderedPrevious.delete(node);
  }

  private disposeNodeMesh(node: TileNode): void {
    if (!node.mesh) return;
    this.group.remove(node.mesh);
    node.mesh.geometry.dispose();
    node.mesh.material.dispose();
    node.mesh = null;
  }

  get lastContext(): QuadtreeFrameContext | null {
    return this.ctx;
  }

  dispose(): void {
    for (const root of this.roots) this.disposeSubtree(root);
    this.roots = [];
    for (const cap of this.caps) {
      this.group.remove(cap.mesh);
      cap.mesh.geometry.dispose();
      cap.mesh.material.dispose();
    }
    this.caps = [];
    this.renderedPrevious.clear();
  }
}
