/**
 * wGlobe prosedürel küre shader'ları (doku yok — tamamen matematik).
 *
 * GLSL ES 1.0 sözdizimiyle yazıldı; Three.js WebGL2 bağlamında bunları otomatik
 * olarak GLSL ES 3.00'e çevirir (varying → in/out, gl_FragColor → pc_fragColor).
 * fwidth() ES 3.00'te çekirdek fonksiyondur; ızgara çizgileri her yakınlaşmada
 * tam 1–1.5 piksel kalınlığında, aliasing'siz çizilir.
 *
 * Koordinat sözleşmesi lib/geo.ts ile birebir aynıdır:
 *   lat = asin(n.y)
 *   lng = atan2(n.z, −n.x) − π
 */

export const GLOBE_VERTEX_SHADER = /* glsl */ `
varying vec3 vObjNormal;
varying vec3 vViewNormal;
varying vec3 vViewPosition;

void main() {
  vObjNormal = normalize(position);
  vViewNormal = normalize(normalMatrix * normal);
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vViewPosition = mvPosition.xyz;
  gl_Position = projectionMatrix * mvPosition;
}
`;

export const GLOBE_FRAGMENT_SHADER = /* glsl */ `
precision highp float;

uniform vec3 uOceanDeep;
uniform vec3 uOceanShallow;
uniform vec3 uGrid;
uniform vec3 uEquator;
uniform vec3 uNight;
uniform vec3 uNightGlow;
uniform vec3 uAtmosphere;

uniform float uGridOpacity;
uniform float uGridSpacing;        // radyan
uniform float uNightStrength;
uniform float uNightGlowStrength;
uniform float uAtmosphereStrength;
uniform float uTerminatorSoftness;
uniform float uTime;

uniform vec3 uSunDirection;        // küre-yerel uzayda birim vektör

varying vec3 vObjNormal;
varying vec3 vViewNormal;
varying vec3 vViewPosition;

#define PI 3.141592653589793

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 4; i++) {
    value += amplitude * noise(p);
    p *= 2.03;
    amplitude *= 0.5;
  }
  return value;
}

/* Küre üzerinde dikişsiz gürültü: iki düzlemsel izdüşümün karışımı */
float sphereNoise(vec3 n, float scale) {
  return 0.5 * fbm(n.xy * scale + 3.7) + 0.5 * fbm(n.yz * scale - 1.9);
}

/* Bir koordinat ekseninde düzenli ızgara çizgisi; w = piksel başına değişim */
float gridLine(float coord, float spacing, float w) {
  float c = coord / spacing;
  float d = abs(fract(c - 0.5) - 0.5);
  float px = max(w / spacing, 1e-5);
  return 1.0 - smoothstep(0.0, px * 1.25, d);
}

void main() {
  vec3 n = normalize(vObjNormal);

  // ── Enlem / boylam ────────────────────────────────────────
  float lat = asin(clamp(n.y, -1.0, 1.0));
  float lngA = atan(n.z, -n.x);       // dikiş: 180. meridyen
  float lngB = atan(-n.z, n.x);       // dikiş: 0. meridyen (π kaydırılmış)
  // atan'ın sıçradığı dikişte fwidth patlar; iki parametrelemenin küçüğü dikişsizdir
  float wLng = min(fwidth(lngA), fwidth(lngB));
  float wLat = fwidth(lat);

  // ── Izgara + ekvator ─────────────────────────────────────
  float latLines = gridLine(lat, uGridSpacing, wLat);
  float lngLines = gridLine(lngA, uGridSpacing, wLng);
  float poleFade = 1.0 - smoothstep(0.86, 0.985, abs(n.y)); // meridyenler kutupta yığılmasın
  float grid = max(latLines, lngLines * poleFade);

  float equatorHalfWidth = 0.0035;
  float equator = 1.0 - smoothstep(equatorHalfWidth, equatorHalfWidth + wLat * 1.5, abs(lat));

  // ── Okyanus derinliği ────────────────────────────────────
  vec3 viewNormal = normalize(vViewNormal);
  vec3 viewDir = normalize(-vViewPosition);
  float facing = clamp(dot(viewNormal, viewDir), 0.0, 1.0);

  float depthNoise = sphereNoise(n, 2.4);
  float latitudeDepth = 1.0 - abs(n.y);
  float depth = clamp(0.25 + 0.5 * depthNoise + 0.25 * latitudeDepth, 0.0, 1.0);
  vec3 ocean = mix(uOceanDeep, uOceanShallow, depth * (0.55 + 0.45 * facing));

  // ── Güneş / terminatör ───────────────────────────────────
  float sunDot = dot(n, normalize(uSunDirection));
  float day = smoothstep(-uTerminatorSoftness, uTerminatorSoftness, sunDot);

  vec3 dayColor = ocean * (0.78 + 0.32 * max(sunDot, 0.0));
  vec3 nightColor = mix(ocean, uNight, uNightStrength);
  vec3 color = mix(nightColor, dayColor, day);

  // Alacakaranlık şeridi: terminatör boyunca ince sıcak bir ışık
  float twilight = 1.0 - smoothstep(0.0, uTerminatorSoftness * 1.8 + 0.02, abs(sunDot));
  color += uNightGlow * twilight * 0.06;

  // ── Izgara katmanı (gece tarafında hafifçe söner) ─────────
  color = mix(color, uGrid, grid * uGridOpacity * (0.5 + 0.5 * day));
  color = mix(color, uEquator, equator * clamp(uGridOpacity * 2.2, 0.0, 1.0));

  // ── Gece ışıkları (prosedürel yerleşim kümeleri) ──────────
  if (uNightGlowStrength > 0.001) {
    vec2 cellUv = vec2(lngA, lat) * 26.0;
    float cellHash = hash(floor(cellUv));
    vec2 local = fract(cellUv) - 0.5;
    float point = 1.0 - smoothstep(0.04, 0.2, length(local));
    float cluster = smoothstep(0.5, 0.66, sphereNoise(n, 5.0));
    float sparkle = step(0.86, cellHash) * point * cluster;
    float twinkle = 0.78 + 0.22 * sin(uTime * 1.7 + cellHash * 40.0);
    color += uNightGlow * sparkle * twinkle * uNightGlowStrength * (1.0 - day) * 1.4;
  }

  // ── Kenar halesi (fresnel) ───────────────────────────────
  float fresnel = pow(1.0 - facing, 3.0);
  color = mix(color, uAtmosphere, fresnel * uAtmosphereStrength * 0.55 * (0.35 + 0.65 * day));

  gl_FragColor = vec4(color, 1.0);
}
`;

/** Atmosfer: arka yüzü çizilen biraz büyük küre, toplamalı (additive) karışım */
export const ATMOSPHERE_VERTEX_SHADER = /* glsl */ `
varying vec3 vViewNormal;

void main() {
  vViewNormal = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const ATMOSPHERE_FRAGMENT_SHADER = /* glsl */ `
precision highp float;

uniform vec3 uAtmosphere;
uniform float uAtmosphereStrength;

varying vec3 vViewNormal;

void main() {
  float intensity = pow(clamp(0.68 - dot(normalize(vViewNormal), vec3(0.0, 0.0, 1.0)), 0.0, 1.0), 2.6);
  float alpha = intensity * uAtmosphereStrength;
  gl_FragColor = vec4(uAtmosphere * alpha, alpha);
}
`;
