/**
 * GLSL for the planetary engine. All materials are THREE.ShaderMaterial (not
 * Raw), so three.js prepends `#version 300 es`, the attribute/uniform built-ins
 * and the tone-mapping / colour-space functions selected on the renderer
 * (ACESFilmicToneMapping + SRGBColorSpace). Every fragment shader works in
 * LINEAR radiance and finishes with <tonemapping_fragment> + <colorspace_fragment>.
 *
 * World space handed to the GPU is CAMERA-RELATIVE: the camera sits at the
 * origin and every mesh is positioned at (meshCentreEcef − cameraEcef),
 * computed in float64 on the CPU. Large ECEF magnitudes therefore never reach
 * float32 vertex math, which removes jitter at street level.
 */
import * as THREE from 'three';

export const MAX_OVERLAYS = 2;

const GLSL_COMMON = /* glsl */ `
#define PI 3.141592653589793
#define TAU 6.283185307179586

vec3 srgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

/* Direct-sun transmittance through the atmosphere. Kasten–Young air mass,
   Rayleigh + aerosol extinction, normalised to 1 at the zenith. */
vec3 sunTransmittance(float mu) {
  float elevDeg = degrees(asin(clamp(mu, -1.0, 1.0)));
  float airMass = 1.0 / (max(mu, 0.0) + 0.50572 * pow(max(elevDeg + 6.07995, 0.5), -1.6364));
  return exp(-(vec3(0.046, 0.108, 0.265) + 0.07) * max(airMass - 1.0, 0.0));
}

/* Exponential-atmosphere column density (in units of "meters at sea-level
   density") along a straight segment between altitudes hA and hB. Exact for
   a linear altitude profile; the near-horizontal limit is handled analytically. */
float columnDensity(float hA, float hB, float len, float scaleHeight) {
  float dh = hA - hB;
  float eA = exp(-max(hA, 0.0) / scaleHeight);
  float eB = exp(-max(hB, 0.0) / scaleHeight);
  if (abs(dh) < 1.0) return len * 0.5 * (eA + eB);
  return len * (eB - eA) * scaleHeight / dh;
}
`;

// ─────────────────────────────────────────────────────────────
//  Surface (quadtree tiles + polar caps)
// ─────────────────────────────────────────────────────────────

export const SURFACE_VERTEX_SHADER = /* glsl */ `
#define PI 3.141592653589793
#define TAU 6.283185307179586
attribute vec2 a_lonLat;

uniform vec4 u_tileST;
uniform vec4 u_fallbackST;
uniform vec4 u_overlay0ST;
uniform vec4 u_overlay1ST;

varying vec2 v_tileUv;
varying vec2 v_fallbackUv;
varying vec2 v_overlay0Uv;
varying vec2 v_overlay1Uv;
varying vec2 v_equirectUv;
varying vec2 v_lonLat;
varying vec3 v_normal;
varying vec3 v_relPos;

void main() {
  vec4 rel = modelMatrix * vec4(position, 1.0);
  v_relPos = rel.xyz;
  v_normal = normal;
  v_lonLat = a_lonLat;
  v_tileUv = uv * u_tileST.xy + u_tileST.zw;
  v_fallbackUv = uv * u_fallbackST.xy + u_fallbackST.zw;
  v_overlay0Uv = uv * u_overlay0ST.xy + u_overlay0ST.zw;
  v_overlay1Uv = uv * u_overlay1ST.xy + u_overlay1ST.zw;
  v_equirectUv = vec2(a_lonLat.x / TAU + 0.5, 0.5 - a_lonLat.y / PI);
  gl_Position = projectionMatrix * viewMatrix * rel;
}
`;

export const SURFACE_FRAGMENT_SHADER = /* glsl */ `
precision highp float;

uniform sampler2D u_tileTexture;
uniform sampler2D u_fallbackTexture;
uniform sampler2D u_baseTexture;
uniform sampler2D u_nightTexture;
uniform sampler2D u_cloudTexture;
uniform sampler2D u_waterMask;
uniform sampler2D u_overlay0;
uniform sampler2D u_overlay1;

uniform float u_hasTile;
uniform float u_hasFallback;
uniform float u_hasBase;
uniform float u_hasNight;
uniform float u_hasClouds;
uniform float u_hasWaterMask;
uniform float u_fadeProgress;
uniform float u_isCap;
uniform float u_tileTexelSize;
uniform float u_bumpStrength;
uniform float u_zoomDetail;

uniform float u_overlay0Opacity;
uniform float u_overlay1Opacity;
uniform float u_overlay0Screen;
uniform float u_overlay1Screen;

uniform vec3 u_sunDirection;
uniform vec3 u_cameraEcef;
uniform float u_radius;
uniform float u_atmosphereHeight;
uniform float u_cloudOffset;
uniform float u_cloudShadow;
uniform float u_sunIntensity;
uniform float u_lightsGain;
uniform float u_ambient;
uniform float u_saturation;
uniform float u_sepia;
uniform float u_aerialStrength;
uniform float u_sharpen;
uniform float u_clarity;
uniform float u_clarityStyleSaturation;
uniform vec3 u_oceanColor;
uniform vec3 u_iceColor;
uniform vec3 u_hazeNear;
uniform vec3 u_hazeFar;

varying vec2 v_tileUv;
varying vec2 v_fallbackUv;
varying vec2 v_overlay0Uv;
varying vec2 v_overlay1Uv;
varying vec2 v_equirectUv;
varying vec2 v_lonLat;
varying vec3 v_normal;
varying vec3 v_relPos;

${GLSL_COMMON}

/* Colour of the planet where no tile imagery exists yet (or beyond ±85.05°). */
vec3 baseAlbedo(vec2 equirectUv, float lat) {
  vec3 base = u_hasBase > 0.5 ? srgbToLinear(texture2D(u_baseTexture, equirectUv).rgb) : u_oceanColor;
  /* Polar blend: sea ice / ocean in the Arctic, continental ice in the Antarctic. */
  float polar = smoothstep(radians(80.0), radians(85.0511), abs(lat));
  float iceFraction = lat > 0.0 ? clamp(luma(base) * 2.2, 0.55, 0.95) : 0.97;
  vec3 cap = mix(u_oceanColor, u_iceColor, iceFraction);
  return mix(base, mix(base, cap, 0.55), polar);
}

/* Heuristic water mask from imagery colour (sRGB): dark, blue-dominant pixels. */
float waterFromColor(vec3 srgb) {
  float lum = luma(srgb);
  float blueOverRed = smoothstep(0.0, 0.05, srgb.b - srgb.r * 1.15);
  float blueOverGreen = smoothstep(-0.02, 0.04, srgb.b - srgb.g * 0.9);
  float dark = 1.0 - smoothstep(0.10, 0.22, lum);
  return clamp(blueOverRed * blueOverGreen * dark, 0.0, 1.0);
}

vec3 linearToSrgb(vec3 c) {
  c = max(c, 0.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}

/*
 * One 3×3 neighbourhood, two results:
 *  - an UNSHARP-MASKED colour: c + amount·(c − gauss3x3), the delta clamped
 *    to ±0.14 so edges gain micro-contrast without ringing halos;
 *  - the Sobel luminance gradient (d/du, d/dv) for the relief bump.
 * stepUv is the kernel spacing in UV. It is one texel when magnified and grows
 * with the pixel footprint when minified, so the kernel always sharpens the
 * mip level actually being displayed and never aliases.
 */
vec3 sampleSharp(sampler2D tex, vec2 uv, vec2 stepUv, float amount, out vec2 grad) {
  vec3 c  = texture2D(tex, uv).rgb;
  vec3 t  = texture2D(tex, uv + vec2(0.0, -stepUv.y)).rgb;
  vec3 b  = texture2D(tex, uv + vec2(0.0, stepUv.y)).rgb;
  vec3 l  = texture2D(tex, uv + vec2(-stepUv.x, 0.0)).rgb;
  vec3 r  = texture2D(tex, uv + vec2(stepUv.x, 0.0)).rgb;
  vec3 tl = texture2D(tex, uv + vec2(-stepUv.x, -stepUv.y)).rgb;
  vec3 tr = texture2D(tex, uv + vec2(stepUv.x, -stepUv.y)).rgb;
  vec3 bl = texture2D(tex, uv + vec2(-stepUv.x, stepUv.y)).rgb;
  vec3 br = texture2D(tex, uv + vec2(stepUv.x, stepUv.y)).rgb;
  vec3 blur = (4.0 * c + 2.0 * (t + b + l + r) + (tl + tr + bl + br)) / 16.0;
  vec3 sharp = clamp(c + clamp((c - blur) * amount, -0.14, 0.14), 0.0, 1.0);
  float gx = (luma(tr) + 2.0 * luma(r) + luma(br)) - (luma(tl) + 2.0 * luma(l) + luma(bl));
  float gy = (luma(bl) + 2.0 * luma(b) + luma(br)) - (luma(tl) + 2.0 * luma(t) + luma(tr));
  grad = vec2(gx, gy) * 0.125;
  return sharp;
}

/* UV kernel spacing that follows the displayed mip level (≥ 1 texel). */
vec2 kernelStep(vec2 uv, float texel) {
  vec2 footprint = max(abs(dFdx(uv)), abs(dFdy(uv))) / texel;
  return vec2(texel) * max(vec2(1.0), footprint);
}

void main() {
  vec3 n = normalize(v_normal);
  vec3 L = normalize(u_sunDirection);
  vec3 viewRay = v_relPos;
  float viewDist = length(viewRay);
  vec3 V = -viewRay / max(viewDist, 1e-3);
  float lat = v_lonLat.y;

  /* Derivatives first: they must be evaluated in uniform control flow. */
  vec2 tileStep = kernelStep(v_tileUv, u_tileTexelSize);
  vec2 fallbackStep = kernelStep(v_fallbackUv, u_tileTexelSize);

  /* ── Albedo: own tile ⇄ ancestor sub-rect fallback ⇄ global base ─────── */
  /* The texture that dominates the pixel gets the full 3×3 unsharp mask. */
  vec2 grad = vec2(0.0);
  vec3 srgb;
  if (u_hasTile > 0.5) {
    vec3 tileSrgb = sampleSharp(u_tileTexture, v_tileUv, tileStep, u_sharpen, grad);
    vec3 fallbackSrgb = u_hasFallback > 0.5
      ? texture2D(u_fallbackTexture, v_fallbackUv).rgb
      : linearToSrgb(baseAlbedo(v_equirectUv, lat));
    srgb = mix(fallbackSrgb, tileSrgb, u_fadeProgress);
  } else if (u_hasFallback > 0.5) {
    srgb = sampleSharp(u_fallbackTexture, v_fallbackUv, fallbackStep, u_sharpen, grad);
  } else {
    srgb = linearToSrgb(baseAlbedo(v_equirectUv, lat));
  }
  vec3 albedo = srgbToLinear(srgb);
  /* Tiles converge exactly onto the cap colour at ±85.0511° → no seam. */
  float capBlend = u_isCap > 0.5 ? 1.0 : smoothstep(radians(83.0), radians(85.0511), abs(lat));
  albedo = mix(albedo, baseAlbedo(v_equirectUv, lat), capBlend);

  /* Overlays (labels / boundaries) composite in sRGB like the source map. */
  if (u_overlay0Opacity > 0.0) {
    vec4 o = texture2D(u_overlay0, v_overlay0Uv);
    vec3 ol = srgbToLinear(o.rgb);
    vec3 screenMix = 1.0 - (1.0 - albedo) * (1.0 - ol);
    albedo = mix(albedo, mix(ol, screenMix, u_overlay0Screen), o.a * u_overlay0Opacity);
  }
  if (u_overlay1Opacity > 0.0) {
    vec4 o = texture2D(u_overlay1, v_overlay1Uv);
    vec3 ol = srgbToLinear(o.rgb);
    vec3 screenMix = 1.0 - (1.0 - albedo) * (1.0 - ol);
    albedo = mix(albedo, mix(ol, screenMix, u_overlay1Screen), o.a * u_overlay1Opacity);
  }

  /* ── Water mask ────────────────────────────────────────────────────── */
  float water = waterFromColor(srgb);
  if (u_hasWaterMask > 0.5) {
    float mask = texture2D(u_waterMask, v_equirectUv).r;
    water = mix(mask, mask * water + (1.0 - mask) * water * 0.35, u_zoomDetail);
  }
  water = mix(water, lat > 0.0 ? 0.25 : 0.0, capBlend);

  /* ── Tangent frame and Sobel luminance bump ───────────────────────── */
  vec3 east = vec3(n.z, 0.0, -n.x);
  float eastLen = length(east);
  east = eastLen > 1e-5 ? east / eastLen : vec3(1.0, 0.0, 0.0);
  vec3 north = cross(n, east);
  vec3 Nb = n;
  if (u_bumpStrength > 0.0 && capBlend < 1.0) {
    /* u grows east, v grows south: height slope east = gx, north = −gy. */
    float k = u_bumpStrength * (1.0 - water) * (1.0 - capBlend);
    Nb = normalize(n - k * (grad.x * east - grad.y * north));
  }

  /* ── Sun, sky and clouds ──────────────────────────────────────────── */
  float mu = dot(n, L);
  vec3 T = sunTransmittance(mu);
  float sunDisc = smoothstep(-0.0047, 0.0047, mu);
  float shadow = 1.0;
  float cloudHere = 0.0;
  if (u_hasClouds > 0.5 && u_cloudShadow > 0.0) {
    vec2 cuv = v_equirectUv + vec2(u_cloudOffset, 0.0);
    cloudHere = texture2D(u_cloudTexture, cuv).r;
    /* Shadow sampled toward the sun: cloud-deck height / tan(elevation). */
    vec3 ps = normalize(n + (L - n * mu) * (0.0012 / max(mu, 0.12)));
    vec2 suv = vec2(atan(-ps.z, ps.x) / TAU + 0.5 + u_cloudOffset, 0.5 - asin(clamp(ps.y, -1.0, 1.0)) / PI);
    shadow = 1.0 - 0.55 * texture2D(u_cloudTexture, suv).r * u_cloudShadow;
  }
  vec3 direct = T * max(dot(Nb, L), 0.0) * sunDisc * shadow * u_sunIntensity;
  float skyK = smoothstep(-0.309, 0.08, mu);
  skyK *= skyK;
  vec3 skyColor = mix(vec3(0.85, 0.42, 0.25), vec3(0.32, 0.5, 1.0), smoothstep(-0.05, 0.25, mu));
  vec3 sky = skyColor * 0.07 * skyK * u_sunIntensity * (0.55 + 0.45 * shadow);
  vec3 color = albedo * (direct + sky + vec3(0.55, 0.7, 1.0) * u_ambient);

  /* ── Ocean: GGX specular glint + Schlick sky reflection (F0 = 0.02) ── */
  vec3 H = normalize(L + V);
  float NoH = max(dot(n, H), 0.0);
  float NoV = max(dot(n, V), 1e-4);
  float NoL = max(mu, 0.0);
  float VoH = max(dot(V, H), 0.0);
  float roughness = mix(0.105, 0.06, u_zoomDetail);
  float a2 = roughness * roughness;
  float dd = NoH * NoH * (a2 - 1.0) + 1.0;
  float D = a2 / (PI * dd * dd);
  float F = 0.02 + 0.98 * pow(1.0 - VoH, 5.0);
  float Vis = 0.5 / (NoL * sqrt(NoV * NoV * (1.0 - a2) + a2) + NoV * sqrt(NoL * NoL * (1.0 - a2) + a2) + 1e-5);
  color += water * T * (D * F * Vis * PI * NoL) * sunDisc * shadow * u_sunIntensity;
  color += water * (0.02 + 0.98 * pow(1.0 - NoV, 5.0)) * skyColor * 0.06 * skyK * u_sunIntensity;

  /* ── City lights: after civil twilight, dimmed under cloud ────────── */
  if (u_hasNight > 0.5) {
    float li = texture2D(u_nightTexture, v_equirectUv).r;
    li = li * li * (0.35 + 0.65 * li);
    /* Real time: lights after civil twilight. Night style (dim sun): lights everywhere. */
    float dark = mix(1.0, 1.0 - smoothstep(-0.12, 0.03, mu), smoothstep(0.1, 0.6, u_sunIntensity));
    color += mix(vec3(1.0, 0.55, 0.22), vec3(1.0, 0.86, 0.66), li) * li * dark * u_lightsGain * (1.0 - 0.7 * cloudHere) * (1.0 - water);
  }

  /* ── Aerial perspective: extinction + in-scattering along the view ray ─ */
  if (u_aerialStrength > 0.0) {
    vec3 camE = u_cameraEcef;
    vec3 dir = -V;
    float topR = u_radius + u_atmosphereHeight;
    float camR = length(camE);
    float tStart = 0.0;
    if (camR > topR) {
      float b = dot(camE, dir);
      float c = camR * camR - topR * topR;
      float disc = max(b * b - c, 0.0);
      tStart = clamp(-b - sqrt(disc), 0.0, viewDist);
    }
    vec3 startE = camE + dir * tStart;
    float hStart = length(startE) - u_radius;
    float hEnd = length(camE + viewRay) - u_radius;
    float len = viewDist - tStart;
    float column = columnDensity(hStart, hEnd, len, 8000.0);
    vec3 betaR = vec3(5.8e-6, 13.5e-6, 33.1e-6);
    float betaM = 3.0e-6;
    vec3 extinction = exp(-(betaR + betaM) * column * u_aerialStrength);
    float sunLit = smoothstep(-0.15, 0.25, mu);
    /* (1 − e^(−βτ)) is already spectral (Rayleigh ∝ λ⁻⁴), so the palette only tints it lightly. */
    vec3 hazeTint = mix(vec3(1.0), mix(u_hazeNear, u_hazeFar, clamp(1.0 - extinction.g, 0.0, 1.0)), 0.25);
    vec3 inscatter = (1.0 - extinction) * hazeTint * (0.08 + 0.92 * sunLit) * u_sunIntensity * 0.16;
    float forward = pow(max(dot(dir, L), 0.0), 12.0);
    inscatter += (1.0 - extinction.g) * vec3(1.0, 0.85, 0.65) * forward * 0.25 * sunLit * u_sunIntensity;
    color = color * extinction + inscatter;
  }

  /* ── Style grade (themes) ─────────────────────────────────────────── */
  float lum = luma(color);
  color = mix(vec3(lum), color, u_saturation);
  color = mix(color, lum * vec3(1.28, 1.0, 0.72), u_sepia);

  gl_FragColor = vec4(max(color, 0.0), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>

  /*
   * ── Clarity mode (regional / city zoom) ─────────────────────────────
   * Bypasses lighting, night darkening, aerial haze AND the ACES curve: the
   * pixel becomes the (sharpened) imagery itself in true sRGB at 100 %
   * brightness. Blended in by altitude so the orbital view keeps its sunlit,
   * physically shaded look.
   */
  if (u_clarity > 0.0) {
    vec3 clear = albedo;
    float clearLum = luma(clear);
    clear = mix(vec3(clearLum), clear, u_clarityStyleSaturation);
    clear = mix(clear, clearLum * vec3(1.28, 1.0, 0.72), u_sepia);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, linearToSrgb(clear), u_clarity);
  }
}
`;

// ─────────────────────────────────────────────────────────────
//  Clouds (drifting sphere at R · 1.006)
// ─────────────────────────────────────────────────────────────

export const CLOUD_VERTEX_SHADER = /* glsl */ `
varying vec3 v_normal;
varying vec2 v_uv;
varying vec3 v_relPos;
void main() {
  vec4 rel = modelMatrix * vec4(position, 1.0);
  v_relPos = rel.xyz;
  v_normal = normal;
  v_uv = vec2(uv.x, 1.0 - uv.y);
  gl_Position = projectionMatrix * viewMatrix * rel;
}
`;

export const CLOUD_FRAGMENT_SHADER = /* glsl */ `
precision highp float;
uniform sampler2D u_cloudTexture;
uniform float u_cloudOffset;
uniform float u_cloudOpacity;
uniform vec3 u_sunDirection;
uniform float u_sunIntensity;
uniform float u_ambient;
varying vec3 v_normal;
varying vec2 v_uv;
varying vec3 v_relPos;
${GLSL_COMMON}
void main() {
  float c = texture2D(u_cloudTexture, v_uv + vec2(u_cloudOffset, 0.0)).r;
  float alpha = clamp(c * 1.08, 0.0, 1.0) * u_cloudOpacity;
  if (alpha < 0.002) discard;
  vec3 n = normalize(v_normal);
  float mu = dot(n, normalize(u_sunDirection));
  vec3 T = sunTransmittance(mu);
  float lit = (0.18 + 0.82 * max(mu, 0.0)) * smoothstep(-0.035, 0.09, mu);
  float skyK = smoothstep(-0.309, 0.08, mu);
  skyK *= skyK;
  /* Grazing view through the deck thickens the clouds (limb brightening). */
  float grazing = 1.0 - abs(dot(n, normalize(-v_relPos)));
  alpha = clamp(alpha * (1.0 + grazing * 0.6), 0.0, 1.0);
  vec3 col = vec3(0.82) * (T * lit * u_sunIntensity + vec3(0.35, 0.5, 1.0) * 0.07 * skyK * u_sunIntensity) + vec3(0.55, 0.7, 1.0) * u_ambient * 0.8;
  gl_FragColor = vec4(col * alpha, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ─────────────────────────────────────────────────────────────
//  Atmosphere shell (BackSide, additive, R · 1.025)
// ─────────────────────────────────────────────────────────────

export const ATMOSPHERE_VERTEX_SHADER = /* glsl */ `
varying vec3 v_relPos;
void main() {
  vec4 rel = modelMatrix * vec4(position, 1.0);
  v_relPos = rel.xyz;
  gl_Position = projectionMatrix * viewMatrix * rel;
}
`;

export const ATMOSPHERE_FRAGMENT_SHADER = /* glsl */ `
precision highp float;
uniform vec3 u_cameraEcef;
uniform vec3 u_sunDirection;
uniform float u_radius;
uniform float u_shellRadius;
uniform float u_intensity;
uniform float u_sunIntensity;
uniform vec3 u_innerColor;
uniform vec3 u_outerColor;
varying vec3 v_relPos;
${GLSL_COMMON}
void main() {
  vec3 dir = normalize(v_relPos);
  vec3 cam = u_cameraEcef;
  /* Closest approach of the view ray to the planet centre ("impact parameter"). */
  float tClosest = -dot(cam, dir);
  vec3 closest = tClosest > 0.0 ? cam + dir * tClosest : cam;
  float closestR = length(closest);
  float thickness = u_shellRadius - u_radius;
  float h = clamp((closestR - u_radius) / thickness, 0.0, 1.0);
  /* Fresnel-like rim: densest right above the limb, vanishing at the shell edge. */
  float rim = exp(-h * 4.0) * (1.0 - smoothstep(0.82, 1.0, h));
  float fresnel = pow(1.0 - clamp(abs(dot(normalize(closest), dir)), 0.0, 1.0), 2.0);
  vec3 limbNormal = closest / max(closestR, 1.0);
  vec3 L = normalize(u_sunDirection);
  float sunSide = smoothstep(-0.28, 0.35, dot(limbNormal, L));
  float forward = pow(max(dot(dir, L), 0.0), 8.0);
  vec3 color = mix(u_outerColor, u_innerColor, exp(-h * 2.5));
  color = mix(color, vec3(1.0, 0.62, 0.38), (1.0 - smoothstep(-0.05, 0.22, dot(limbNormal, L))) * sunSide * 0.6);
  float intensity = rim * mix(0.35, 1.0, fresnel) * (sunSide + forward * 0.8) * u_intensity * u_sunIntensity;
  gl_FragColor = vec4(color * intensity, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ─────────────────────────────────────────────────────────────
//  City pins (screen-space points)
// ─────────────────────────────────────────────────────────────

export const PIN_VERTEX_SHADER = /* glsl */ `
attribute vec3 a_color;
attribute float a_size;
attribute float a_active;
uniform float u_pixelRatio;
uniform float u_time;
varying vec3 v_color;
varying float v_active;
void main() {
  v_color = a_color;
  v_active = a_active;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float pulse = a_active > 0.5 ? 1.0 + 0.12 * sin(u_time * 3.2) : 1.0;
  gl_PointSize = a_size * u_pixelRatio * pulse;
}
`;

export const PIN_FRAGMENT_SHADER = /* glsl */ `
precision highp float;
varying vec3 v_color;
varying float v_active;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r = length(p);
  float aa = fwidth(r) * 1.5;
  float core = 1.0 - smoothstep(0.42 - aa, 0.42 + aa, r);
  float ring = (1.0 - smoothstep(0.86 - aa, 0.86 + aa, r)) * smoothstep(0.62 - aa, 0.62 + aa, r) * (0.55 + 0.45 * v_active);
  float alpha = max(core, ring);
  if (alpha < 0.01) discard;
  vec3 col = mix(v_color, vec3(1.0), core * 0.35);
  gl_FragColor = vec4(col * alpha, alpha);
  #include <colorspace_fragment>
}
`;

// ─────────────────────────────────────────────────────────────
//  Shared uniforms + material factories
// ─────────────────────────────────────────────────────────────

export interface SharedSurfaceUniforms {
  u_baseTexture: THREE.IUniform<THREE.Texture | null>;
  u_nightTexture: THREE.IUniform<THREE.Texture | null>;
  u_cloudTexture: THREE.IUniform<THREE.Texture | null>;
  u_waterMask: THREE.IUniform<THREE.Texture | null>;
  u_hasBase: THREE.IUniform<number>;
  u_hasNight: THREE.IUniform<number>;
  u_hasClouds: THREE.IUniform<number>;
  u_hasWaterMask: THREE.IUniform<number>;
  u_sunDirection: THREE.IUniform<THREE.Vector3>;
  u_cameraEcef: THREE.IUniform<THREE.Vector3>;
  u_radius: THREE.IUniform<number>;
  u_atmosphereHeight: THREE.IUniform<number>;
  u_cloudOffset: THREE.IUniform<number>;
  u_cloudShadow: THREE.IUniform<number>;
  u_sunIntensity: THREE.IUniform<number>;
  u_lightsGain: THREE.IUniform<number>;
  u_ambient: THREE.IUniform<number>;
  u_saturation: THREE.IUniform<number>;
  u_sepia: THREE.IUniform<number>;
  u_aerialStrength: THREE.IUniform<number>;
  /** Unsharp-mask amount (0 = off, 0.6–1.0 = crisp). */
  u_sharpen: THREE.IUniform<number>;
  /** 0 = physically lit orbital look, 1 = unlit true-colour imagery. */
  u_clarity: THREE.IUniform<number>;
  /** Theme saturation applied in clarity mode (1 = untouched true colour). */
  u_clarityStyleSaturation: THREE.IUniform<number>;
  u_bumpStrength: THREE.IUniform<number>;
  u_oceanColor: THREE.IUniform<THREE.Color>;
  u_iceColor: THREE.IUniform<THREE.Color>;
  u_hazeNear: THREE.IUniform<THREE.Color>;
  u_hazeFar: THREE.IUniform<THREE.Color>;
  u_overlay0Screen: THREE.IUniform<number>;
  u_overlay1Screen: THREE.IUniform<number>;
}

/** Colours are given in sRGB hex and converted to linear for the shader. */
function linearColor(hex: string): THREE.Color {
  return new THREE.Color().setStyle(hex, THREE.SRGBColorSpace);
}

export function createSharedSurfaceUniforms(radius: number, atmosphereHeight: number): SharedSurfaceUniforms {
  return {
    u_baseTexture: { value: null },
    u_nightTexture: { value: null },
    u_cloudTexture: { value: null },
    u_waterMask: { value: null },
    u_hasBase: { value: 0 },
    u_hasNight: { value: 0 },
    u_hasClouds: { value: 0 },
    u_hasWaterMask: { value: 0 },
    u_sunDirection: { value: new THREE.Vector3(1, 0, 0) },
    u_cameraEcef: { value: new THREE.Vector3() },
    u_radius: { value: radius },
    u_atmosphereHeight: { value: atmosphereHeight },
    u_cloudOffset: { value: 0 },
    u_cloudShadow: { value: 1 },
    u_sunIntensity: { value: 1 },
    u_lightsGain: { value: 1.4 },
    u_ambient: { value: 0.012 },
    u_saturation: { value: 1.08 },
    u_sepia: { value: 0 },
    u_aerialStrength: { value: 1 },
    u_sharpen: { value: 0.8 },
    u_clarity: { value: 0 },
    u_clarityStyleSaturation: { value: 1 },
    u_bumpStrength: { value: 0.9 },
    u_oceanColor: { value: linearColor('#0a2440') },
    u_iceColor: { value: linearColor('#e6eef5') },
    u_hazeNear: { value: linearColor('#38bdf8') },
    u_hazeFar: { value: linearColor('#1d4ed8') },
    u_overlay0Screen: { value: 0 },
    u_overlay1Screen: { value: 0 },
  };
}

export interface TileMaterialUniforms {
  u_tileTexture: THREE.IUniform<THREE.Texture | null>;
  u_fallbackTexture: THREE.IUniform<THREE.Texture | null>;
  u_overlay0: THREE.IUniform<THREE.Texture | null>;
  u_overlay1: THREE.IUniform<THREE.Texture | null>;
  u_hasTile: THREE.IUniform<number>;
  u_hasFallback: THREE.IUniform<number>;
  u_fadeProgress: THREE.IUniform<number>;
  u_isCap: THREE.IUniform<number>;
  u_tileTexelSize: THREE.IUniform<number>;
  u_zoomDetail: THREE.IUniform<number>;
  u_overlay0Opacity: THREE.IUniform<number>;
  u_overlay1Opacity: THREE.IUniform<number>;
  u_tileST: THREE.IUniform<THREE.Vector4>;
  u_fallbackST: THREE.IUniform<THREE.Vector4>;
  u_overlay0ST: THREE.IUniform<THREE.Vector4>;
  u_overlay1ST: THREE.IUniform<THREE.Vector4>;
}

export type SurfaceMaterial = THREE.ShaderMaterial & { uniforms: SharedSurfaceUniforms & TileMaterialUniforms };

/**
 * One material per tile. Uniform OBJECTS from `shared` are referenced, not
 * copied, so global state (sun, camera, style) updates once for every tile,
 * and the identical shader source makes three.js reuse a single GL program.
 */
export function createSurfaceMaterial(shared: SharedSurfaceUniforms, isCap: boolean): SurfaceMaterial {
  const own: TileMaterialUniforms = {
    u_tileTexture: { value: null },
    u_fallbackTexture: { value: null },
    u_overlay0: { value: null },
    u_overlay1: { value: null },
    u_hasTile: { value: 0 },
    u_hasFallback: { value: 0 },
    u_fadeProgress: { value: 1 },
    u_isCap: { value: isCap ? 1 : 0 },
    u_tileTexelSize: { value: 1 / 256 },
    u_zoomDetail: { value: 0 },
    u_overlay0Opacity: { value: 0 },
    u_overlay1Opacity: { value: 0 },
    u_tileST: { value: new THREE.Vector4(1, 1, 0, 0) },
    u_fallbackST: { value: new THREE.Vector4(1, 1, 0, 0) },
    u_overlay0ST: { value: new THREE.Vector4(1, 1, 0, 0) },
    u_overlay1ST: { value: new THREE.Vector4(1, 1, 0, 0) },
  };
  const material = new THREE.ShaderMaterial({
    vertexShader: SURFACE_VERTEX_SHADER,
    fragmentShader: SURFACE_FRAGMENT_SHADER,
    uniforms: { ...shared, ...own },
    side: THREE.FrontSide,
    depthTest: true,
    depthWrite: true,
  });
  return material as SurfaceMaterial;
}

export function createCloudMaterial(shared: SharedSurfaceUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: CLOUD_VERTEX_SHADER,
    fragmentShader: CLOUD_FRAGMENT_SHADER,
    uniforms: {
      u_cloudTexture: shared.u_cloudTexture,
      u_cloudOffset: shared.u_cloudOffset,
      u_sunDirection: shared.u_sunDirection,
      u_sunIntensity: shared.u_sunIntensity,
      u_ambient: shared.u_ambient,
      u_cloudOpacity: { value: 1 },
    },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  });
}

export function createAtmosphereMaterial(shared: SharedSurfaceUniforms, shellRadius: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: ATMOSPHERE_VERTEX_SHADER,
    fragmentShader: ATMOSPHERE_FRAGMENT_SHADER,
    uniforms: {
      u_cameraEcef: shared.u_cameraEcef,
      u_sunDirection: shared.u_sunDirection,
      u_sunIntensity: shared.u_sunIntensity,
      u_radius: shared.u_radius,
      u_shellRadius: { value: shellRadius },
      u_intensity: { value: 1.6 },
      u_innerColor: { value: linearColor('#38bdf8') },
      u_outerColor: { value: linearColor('#1d4ed8') },
    },
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
  });
}

export function createPinMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: PIN_VERTEX_SHADER,
    fragmentShader: PIN_FRAGMENT_SHADER,
    uniforms: {
      u_pixelRatio: { value: 1 },
      u_time: { value: 0 },
    },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    toneMapped: false,
  });
}
