/**
 * Küre matematiği — Three.js'ten bağımsız saf fonksiyonlar.
 *
 * Koordinat sözleşmesi (three-globe / Three.js SphereGeometry UV'leriyle uyumlu):
 *   - +Y kuzey kutbu
 *   - lng = 0 (Greenwich) +X ekseni yönünde
 *   - Kamera +Z ekseninde, orijine bakıyor
 *
 *   φ (polar)   = (90 − lat) · π/180
 *   θ (azimut)  = (lng + 180) · π/180
 *   x = −r · sin φ · cos θ
 *   y =  r · cos φ
 *   z =  r · sin φ · sin θ
 */
import type { GlobeRotation, SubsolarPoint, Vector3Like } from '@/types';

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;
export const TWO_PI = Math.PI * 2;
export const EARTH_RADIUS_KM = 6371;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/** Enlem/boylamı küre yüzeyindeki (x, y, z) noktasına çevirir. */
export function latLngToVector3(lat: number, lng: number, radius = 1): Vector3Like {
  const phi = (90 - lat) * DEG2RAD;
  const theta = (lng + 180) * DEG2RAD;
  const sinPhi = Math.sin(phi);
  return {
    x: -radius * sinPhi * Math.cos(theta),
    y: radius * Math.cos(phi),
    z: radius * sinPhi * Math.sin(theta),
  };
}

/** latLngToVector3'ün tersi: yüzey noktası → enlem/boylam (derece). */
export function vector3ToLatLng(point: Vector3Like): { lat: number; lng: number } {
  const radius = Math.hypot(point.x, point.y, point.z) || 1;
  const lat = 90 - Math.acos(clamp(point.y / radius, -1, 1)) * RAD2DEG;
  const theta = Math.atan2(point.z, -point.x);
  const lng = normalizeLongitude(theta * RAD2DEG - 180);
  return { lat, lng };
}

export function normalizeLongitude(lng: number): number {
  let value = ((lng + 180) % 360 + 360) % 360 - 180;
  if (value === -180) value = 180;
  return value;
}

/** Açıyı (−π, π] aralığına indirger. */
export function normalizeAngle(angle: number): number {
  let value = angle % TWO_PI;
  if (value <= -Math.PI) value += TWO_PI;
  if (value > Math.PI) value -= TWO_PI;
  return value;
}

/** from → to arasındaki EN KISA açısal fark; küre hiçbir zaman "uzun yoldan" dönmez. */
export function shortestAngleDelta(from: number, to: number): number {
  return normalizeAngle(to - from);
}

/** Açılar için lerp: 359° → 1° geçişi 2° olarak yapılır, 358° olarak değil. */
export function lerpAngle(from: number, to: number, t: number): number {
  return from + shortestAngleDelta(from, to) * t;
}

/**
 * Bir şehri kameranın (+Z) tam karşısına getiren küre grubu rotasyonu.
 * Euler sırası 'XYZ' (Three.js varsayılanı): vektöre önce Y, sonra X uygulanır.
 *
 *  - Y ekseninde: noktanın azimutu atan2(x, z) = π/2 + lng → −(π/2 + lng) kadar döndür
 *  - X ekseninde: nokta artık YZ düzleminde, yüksekliği = lat → lat kadar döndür
 */
export function getFocusRotation(lat: number, lng: number, maxPitch = Math.PI / 2.4): GlobeRotation {
  return {
    x: clamp(lat * DEG2RAD, -maxPitch, maxPitch),
    y: normalizeAngle(-(Math.PI / 2 + lng * DEG2RAD)),
  };
}

/** İki konum arasındaki merkez açısı (radyan), haversine. */
export function angularDistance(latA: number, lngA: number, latB: number, lngB: number): number {
  const dLat = (latB - latA) * DEG2RAD;
  const dLng = (lngB - lngA) * DEG2RAD;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(latA * DEG2RAD) * Math.cos(latB * DEG2RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function greatCircleDistanceKm(latA: number, lngA: number, latB: number, lngB: number): number {
  return angularDistance(latA, lngA, latB, lngB) * EARTH_RADIUS_KM;
}

/**
 * Güneşin tam tepede olduğu nokta (subsolar point) — NOAA yaklaşımı,
 * ±0.1° doğruluk. Terminatör çizgisi bu noktaya göre hesaplanır:
 *   gündüz ⇔ dot(yüzeyNormali, güneşYönü) > 0
 */
export function getSubsolarPoint(date: Date = new Date()): SubsolarPoint {
  const startOfYear = Date.UTC(date.getUTCFullYear(), 0, 1);
  const dayOfYear = Math.floor((date.getTime() - startOfYear) / 86_400_000) + 1;
  const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;

  const isLeap = new Date(Date.UTC(date.getUTCFullYear(), 1, 29)).getUTCMonth() === 1;
  const daysInYear = isLeap ? 366 : 365;

  // Kesirli yıl açısı (radyan)
  const gamma = (TWO_PI / daysInYear) * (dayOfYear - 1 + (utcHours - 12) / 24);

  // Zaman denklemi (dakika)
  const equationOfTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));

  // Güneş deklinasyonu (radyan)
  const declination =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);

  return {
    lat: declination * RAD2DEG,
    lng: normalizeLongitude(-15 * (utcHours - 12 + equationOfTime / 60)),
  };
}

/** Küre-yerel uzayda birim güneş yönü vektörü (shader uniform'u). */
export function getSunDirection(date: Date = new Date()): Vector3Like {
  const { lat, lng } = getSubsolarPoint(date);
  return latLngToVector3(lat, lng, 1);
}

/** Verilen konumda güneş ufkun üzerinde mi? */
export function isDaylightAt(lat: number, lng: number, date: Date = new Date()): boolean {
  const sun = getSunDirection(date);
  const point = latLngToVector3(lat, lng, 1);
  return point.x * sun.x + point.y * sun.y + point.z * sun.z > 0;
}
