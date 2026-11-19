/**
 * Pure double-precision spherical / geospatial math for the planetary engine.
 * No allocation in hot paths: every function that produces a vector writes into
 * a caller-supplied `out` object.
 *
 * Frame (ECEF sphere, meters):
 *   x =  r cosφ cosλ,  y = r sinφ,  z = −r cosφ sinλ
 */
import type { TileCoord } from '../types/globe';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;
export const TWO_PI = Math.PI * 2;
export const HALF_PI = Math.PI / 2;
/** Mean Earth radius (IUGG), meters. Web Mercator itself is defined on a sphere. */
export const EARTH_RADIUS_M = 6_371_008.8;
/** atan(sinh(π)): latitude where the square Web Mercator world ends. */
export const MERCATOR_MAX_LAT_RAD = Math.atan(Math.sinh(Math.PI));
export const MERCATOR_MAX_LAT_DEG = MERCATOR_MAX_LAT_RAD * RAD2DEG;

// ─────────────────────────────────────────────────────────────
//  Scalar helpers
// ─────────────────────────────────────────────────────────────

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** C2-continuous easing (zero velocity AND acceleration at both ends). */
export function smootherstep(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * x * (x * (x * 6 - 15) + 10);
}

/** Frame-rate independent exponential approach: returns the blend factor for `dt` seconds. */
export function dampFactor(lambda: number, dt: number): number {
  return 1 - Math.exp(-lambda * dt);
}

export function wrapLongitudeRad(lon: number): number {
  let v = (lon + Math.PI) % TWO_PI;
  if (v < 0) v += TWO_PI;
  return v - Math.PI;
}

export function wrapLongitudeDeg(lon: number): number {
  let v = (lon + 180) % 360;
  if (v < 0) v += 360;
  return v - 180;
}

/** Signed shortest angular difference b − a in (−π, π]. */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % TWO_PI;
  if (d > Math.PI) d -= TWO_PI;
  if (d <= -Math.PI) d += TWO_PI;
  return d;
}

// ─────────────────────────────────────────────────────────────
//  Vector helpers
// ─────────────────────────────────────────────────────────────

export function setVec3(out: Vec3, x: number, y: number, z: number): Vec3 {
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}

export function copyVec3(out: Vec3, v: Vec3): Vec3 {
  out.x = v.x;
  out.y = v.y;
  out.z = v.z;
  return out;
}

export function dot3(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function length3(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

export function distance3(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function normalize3(out: Vec3, v: Vec3): Vec3 {
  const len = length3(v);
  if (len === 0) return setVec3(out, 0, 0, 0);
  return setVec3(out, v.x / len, v.y / len, v.z / len);
}

export function cross3(out: Vec3, a: Vec3, b: Vec3): Vec3 {
  const x = a.y * b.z - a.z * b.y;
  const y = a.z * b.x - a.x * b.z;
  const z = a.x * b.y - a.y * b.x;
  return setVec3(out, x, y, z);
}

export function scaleAdd3(out: Vec3, a: Vec3, b: Vec3, s: number): Vec3 {
  return setVec3(out, a.x + b.x * s, a.y + b.y * s, a.z + b.z * s);
}

/** Rodrigues rotation of `v` around unit `axis` by `angle` radians. */
export function rotateAroundAxis(out: Vec3, v: Vec3, axis: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const d = dot3(axis, v) * (1 - c);
  const cx = axis.y * v.z - axis.z * v.y;
  const cy = axis.z * v.x - axis.x * v.z;
  const cz = axis.x * v.y - axis.y * v.x;
  return setVec3(out, v.x * c + cx * s + axis.x * d, v.y * c + cy * s + axis.y * d, v.z * c + cz * s + axis.z * d);
}

/**
 * Spherical linear interpolation between unit vectors. Handles the antipodal case
 * by choosing a deterministic perpendicular great circle.
 */
export function slerpUnit(out: Vec3, a: Vec3, b: Vec3, t: number): Vec3 {
  const cosTheta = clamp(dot3(a, b), -1, 1);
  if (cosTheta > 0.9999995) {
    return normalize3(out, setVec3(out, lerp(a.x, b.x, t), lerp(a.y, b.y, t), lerp(a.z, b.z, t)));
  }
  if (cosTheta < -0.9999995) {
    const axis: Vec3 = { x: 0, y: 0, z: 0 };
    cross3(axis, a, Math.abs(a.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 });
    normalize3(axis, axis);
    return rotateAroundAxis(out, a, axis, Math.PI * t);
  }
  const theta = Math.acos(cosTheta);
  const sinTheta = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / sinTheta;
  const wb = Math.sin(t * theta) / sinTheta;
  return setVec3(out, a.x * wa + b.x * wb, a.y * wa + b.y * wb, a.z * wa + b.z * wb);
}

// ─────────────────────────────────────────────────────────────
//  Geodetic ↔ ECEF
// ─────────────────────────────────────────────────────────────

export function geodeticToEcef(out: Vec3, latRad: number, lonRad: number, radius: number): Vec3 {
  const cosLat = Math.cos(latRad);
  return setVec3(out, radius * cosLat * Math.cos(lonRad), radius * Math.sin(latRad), -radius * cosLat * Math.sin(lonRad));
}

export interface GeodeticRad {
  lat: number;
  lon: number;
  /** Distance from the sphere centre, meters. */
  r: number;
}

export function ecefToGeodetic(v: Vec3, out: GeodeticRad = { lat: 0, lon: 0, r: 0 }): GeodeticRad {
  const r = length3(v);
  out.r = r;
  out.lat = r > 0 ? Math.asin(clamp(v.y / r, -1, 1)) : 0;
  out.lon = Math.atan2(-v.z, v.x);
  return out;
}

/** Local tangent frame at a geodetic point (unit vectors). */
export function enuBasis(latRad: number, lonRad: number, east: Vec3, north: Vec3, up: Vec3): void {
  const sLat = Math.sin(latRad);
  const cLat = Math.cos(latRad);
  const sLon = Math.sin(lonRad);
  const cLon = Math.cos(lonRad);
  setVec3(up, cLat * cLon, sLat, -cLat * sLon);
  setVec3(east, -sLon, 0, -cLon);
  setVec3(north, -sLat * cLon, cLat, sLat * sLon);
}

/** Central angle between two geodetic points (haversine, numerically stable). */
export function centralAngle(latA: number, lonA: number, latB: number, lonB: number): number {
  const dLat = latB - latA;
  const dLon = lonB - lonA;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(latA) * Math.cos(latB) * Math.sin(dLon / 2) ** 2;
  return 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

// ─────────────────────────────────────────────────────────────
//  Web Mercator tile math (EPSG:3857, XYZ / "slippy" scheme)
// ─────────────────────────────────────────────────────────────

export function tileCount(z: number): number {
  return 2 ** z;
}

/** West edge longitude of tile column `x` at zoom `z` (radians). */
export function tileXToLon(x: number, z: number): number {
  return (x / tileCount(z)) * TWO_PI - Math.PI;
}

/** North edge latitude of tile row `y` at zoom `z` (radians). Accepts fractional rows. */
export function tileYToLat(y: number, z: number): number {
  return Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / tileCount(z))));
}

/** Fractional tile column of a longitude. */
export function lonToTileX(lonRad: number, z: number): number {
  return ((lonRad + Math.PI) / TWO_PI) * tileCount(z);
}

/** Fractional tile row of a latitude (clamped to the Mercator square). */
export function latToTileY(latRad: number, z: number): number {
  const lat = clamp(latRad, -MERCATOR_MAX_LAT_RAD, MERCATOR_MAX_LAT_RAD);
  const mercY = Math.log(Math.tan(Math.PI / 4 + lat / 2));
  return ((1 - mercY / Math.PI) / 2) * tileCount(z);
}

export interface TileBoundsRad {
  west: number;
  east: number;
  north: number;
  south: number;
}

export function tileBounds(z: number, x: number, y: number): TileBoundsRad {
  return {
    west: tileXToLon(x, z),
    east: tileXToLon(x + 1, z),
    north: tileYToLat(y, z),
    south: tileYToLat(y + 1, z),
  };
}

export function tileKey(z: number, x: number, y: number): string {
  return `${z}/${x}/${y}`;
}

export function parentCoord(coord: TileCoord): TileCoord | null {
  if (coord.z === 0) return null;
  return { z: coord.z - 1, x: coord.x >> 1, y: coord.y >> 1 };
}

/**
 * Maps the UV space of tile `child` into the UV space of its ancestor at
 * `ancestorZ`. Returns [scaleU, scaleV, offsetU, offsetV] such that
 *   uvAncestor = uvChild · scale + offset   (v = 0 at the north edge).
 */
export function ancestorScaleOffset(child: TileCoord, ancestorZ: number, out: [number, number, number, number]): [number, number, number, number] {
  const d = child.z - ancestorZ;
  if (d <= 0) {
    out[0] = 1;
    out[1] = 1;
    out[2] = 0;
    out[3] = 0;
    return out;
  }
  const n = 2 ** d;
  const scale = 1 / n;
  const ax = child.x >> d;
  const ay = child.y >> d;
  out[0] = scale;
  out[1] = scale;
  out[2] = (child.x - ax * n) * scale;
  out[3] = (child.y - ay * n) * scale;
  return out;
}

/** Ground size of one texel of a Web Mercator tile at latitude `latRad` (meters). */
export function mercatorTexelSize(z: number, tileSize: number, latRad: number, radius: number): number {
  return (TWO_PI * radius * Math.cos(latRad)) / (tileCount(z) * tileSize);
}

/**
 * Screen-space projected size of a world-space length viewed at `distance`
 * through a perspective camera (pixels).
 */
export function projectedSize(worldSize: number, distance: number, viewportHeightPx: number, fovYRad: number): number {
  return (worldSize * viewportHeightPx) / (2 * Math.max(distance, 1e-3) * Math.tan(fovYRad / 2));
}

/**
 * Nearest point of a tile's geodetic rectangle to a geodetic location
 * (lat/lon clamped independently; the rectangle edges are parallels/meridians).
 * Longitudes are compared on the circle so the antimeridian is handled.
 */
export function nearestPointInBounds(latRad: number, lonRad: number, b: TileBoundsRad, out: { lat: number; lon: number }): { lat: number; lon: number } {
  out.lat = clamp(latRad, b.south, b.north);
  const center = (b.west + b.east) / 2;
  const half = (b.east - b.west) / 2;
  const rel = angleDelta(center, lonRad);
  out.lon = center + clamp(rel, -half, half);
  return out;
}

// ─────────────────────────────────────────────────────────────
//  Ray / sphere
// ─────────────────────────────────────────────────────────────

/**
 * Nearest non-negative intersection distance of a ray with a centred sphere,
 * or −1 when the ray misses. `dir` must be unit length.
 */
export function raySphere(origin: Vec3, dir: Vec3, radius: number): number {
  const b = dot3(origin, dir);
  const c = dot3(origin, origin) - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const s = Math.sqrt(disc);
  const t0 = -b - s;
  if (t0 >= 0) return t0;
  const t1 = -b + s;
  return t1 >= 0 ? t1 : -1;
}

/** Distance from a point at `altitude` to its geometric horizon on a sphere. */
export function horizonDistance(altitude: number, radius: number): number {
  const h = Math.max(altitude, 0);
  return Math.sqrt(h * (2 * radius + h));
}

// ─────────────────────────────────────────────────────────────
//  Horizon culling (Cesium EllipsoidalOccluder, specialised to a sphere)
// ─────────────────────────────────────────────────────────────

/**
 * Magnitude along `scaledDirection` of the horizon-culling point that is at
 * least as visible as `scaledPosition` (both in units of the radius).
 * Returns +∞ when no such point exists (the tile spans > 90° of arc).
 */
function horizonMagnitude(scaledPosition: Vec3, scaledDirection: Vec3): number {
  let magSq = dot3(scaledPosition, scaledPosition);
  let mag = Math.sqrt(magSq);
  const dx = scaledPosition.x / mag;
  const dy = scaledPosition.y / mag;
  const dz = scaledPosition.z / mag;
  magSq = Math.max(1, magSq);
  mag = Math.max(1, mag);
  const cosAlpha = dx * scaledDirection.x + dy * scaledDirection.y + dz * scaledDirection.z;
  const cx = dy * scaledDirection.z - dz * scaledDirection.y;
  const cy = dz * scaledDirection.x - dx * scaledDirection.z;
  const cz = dx * scaledDirection.y - dy * scaledDirection.x;
  const sinAlpha = Math.sqrt(cx * cx + cy * cy + cz * cz);
  const cosBeta = 1 / mag;
  const sinBeta = Math.sqrt(magSq - 1) * cosBeta;
  const denom = cosAlpha * cosBeta - sinAlpha * sinBeta;
  return denom <= 1e-9 ? Number.POSITIVE_INFINITY : 1 / denom;
}

/**
 * Computes the scaled-space horizon-culling point of a set of world positions:
 * if this single point is below the horizon, every position is.
 * Returns false when the point cannot be computed (never cull such a tile).
 */
export function computeHorizonCullingPoint(directionUnit: Vec3, positions: readonly Vec3[], radius: number, out: Vec3): boolean {
  let maxMag = 0;
  const scaled: Vec3 = { x: 0, y: 0, z: 0 };
  for (const p of positions) {
    setVec3(scaled, p.x / radius, p.y / radius, p.z / radius);
    const m = horizonMagnitude(scaled, directionUnit);
    if (!Number.isFinite(m)) return false;
    if (m > maxMag) maxMag = m;
  }
  setVec3(out, directionUnit.x * maxMag, directionUnit.y * maxMag, directionUnit.z * maxMag);
  return true;
}

/**
 * True when a scaled-space point is hidden behind the sphere as seen from a
 * scaled-space camera position (|camera| > 1).
 */
export function isScaledPointOccluded(cameraScaled: Vec3, pointScaled: Vec3): boolean {
  const vhMagSq = dot3(cameraScaled, cameraScaled) - 1;
  if (vhMagSq <= 0) return false;
  const vtx = pointScaled.x - cameraScaled.x;
  const vty = pointScaled.y - cameraScaled.y;
  const vtz = pointScaled.z - cameraScaled.z;
  const vtDotVc = -(vtx * cameraScaled.x + vty * cameraScaled.y + vtz * cameraScaled.z);
  if (vtDotVc <= vhMagSq) return false;
  const vtMagSq = vtx * vtx + vty * vty + vtz * vtz;
  return (vtDotVc * vtDotVc) / vtMagSq > vhMagSq;
}

// ─────────────────────────────────────────────────────────────
//  Sun
// ─────────────────────────────────────────────────────────────

/**
 * Subsolar point (NOAA general solar position, ≈ 0.1° accuracy).
 * Returns latitude/longitude in radians.
 */
export function subsolarPoint(date: Date): { lat: number; lon: number } {
  const year = date.getUTCFullYear();
  const startOfYear = Date.UTC(year, 0, 1);
  const dayOfYear = Math.floor((date.getTime() - startOfYear) / 86_400_000) + 1;
  const hours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const isLeap = new Date(Date.UTC(year, 1, 29)).getUTCMonth() === 1;
  const gamma = (TWO_PI / (isLeap ? 366 : 365)) * (dayOfYear - 1 + (hours - 12) / 24);
  const eqTime =
    229.18 *
    (0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma) - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma));
  const decl =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);
  return { lat: decl, lon: wrapLongitudeRad(-15 * (hours - 12 + eqTime / 60) * DEG2RAD) };
}

/** Unit ECEF vector pointing at the sun. */
export function sunDirectionEcef(date: Date, out: Vec3): Vec3 {
  const p = subsolarPoint(date);
  return geodeticToEcef(out, p.lat, p.lon, 1);
}
