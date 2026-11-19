/**
 * Self-contained HTML page that runs MapLibre GL JS (globe projection) inside a
 * WebView (iOS / Android) or an iframe (web). The page streams Esri World
 * Imagery XYZ tiles directly, draws the city pins, and talks to React Native
 * through a tiny JSON message protocol:
 *
 *   page → RN   { type: 'ready' } · { type: 'select', id } · { type: 'interaction' }
 *               { type: 'detent' } · { type: 'error', message } · { type: 'fatal', message }
 *   RN → page   { type: 'setActive', id, flyTo?: { lat, lon, zoom } } · { type: 'flyTo', lat, lon, zoom }
 *               { type: 'setTheme', theme } · { type: 'setPadding', bottomFraction }
 *               { type: 'setAutoRotate', value } · { type: 'setInteractive', value }
 *               { type: 'setPaused', value } · { type: 'setCities', cities }
 *
 * Motion:
 *  - City focus: MapLibre flyTo (van Wijk & Nuij optimal path: zooms out, travels
 *    the great circle, zooms in), curve 1.42, speed 1.1.
 *  - Sheet open/close: padding easeTo 320 ms, ease-out cubic.
 *  - Active pin: 1.6 s breathing ring (radius 10→26 px, opacity 0.55→0) at 30 fps.
 *  - Idle spin: 3°/s, only above zoom 3.5, starts 3.5 s after the last touch.
 */

export interface GlobeHtmlCity {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

export type GlobeHtmlTheme = 'classic' | 'parchment' | 'night_lights' | 'swiss_minimal';

export interface GlobeHtmlConfig {
  /** Pinned MapLibre GL JS version (CDN). */
  maplibreVersion: string;
  /** Optional override of the library base URL (folder holding maplibre-gl.js/.css). */
  libraryBaseUrl?: string;
  tileUrl: string;
  tileSize: number;
  sourceMaxZoom: number;
  cameraMaxZoom: number;
  attribution: string;
  cities: GlobeHtmlCity[];
  activeId: string | null;
  theme: GlobeHtmlTheme;
  interactive: boolean;
  autoRotate: boolean;
  bottomPaddingFraction: number;
  initial: { lat: number; lon: number; zoom: number };
  markerColor: string;
  markerActiveColor: string;
  background: string;
}

export const MAPLIBRE_VERSION = '5.24.0';

export const ESRI_WORLD_IMAGERY_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

export const ESRI_ATTRIBUTION = 'Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community';

export function buildGlobeHtml(config: GlobeHtmlConfig): string {
  // `<` is escaped so a city name can never close the <script> element.
  const json = JSON.stringify(config).replace(/</g, '\\u003c');
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
<style>
  html, body, #map { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: ${config.background}; }
  body { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; touch-action: none; }
  .maplibregl-canvas { outline: none; }
  #status { position: absolute; left: 0; right: 0; top: 46%; text-align: center; font: 500 13px -apple-system, system-ui, sans-serif;
            color: rgba(255,255,255,0.55); letter-spacing: 0.2px; opacity: 0; transition: opacity 240ms ease-out; pointer-events: none; }
  #status.on { opacity: 1; }
</style>
</head>
<body>
<div id="map"></div>
<div id="status"></div>
<script>
(function () {
  'use strict';
  var CONFIG = ${json};

  // ── Bridge ──────────────────────────────────────────────────
  function send(message) {
    try {
      if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(message));
      else if (window.parent && window.parent !== window) window.parent.postMessage({ __wglobe: true, payload: message }, '*');
    } catch (e) { /* bridge unavailable */ }
  }
  var statusEl = document.getElementById('status');
  function setStatus(text) {
    statusEl.textContent = text || '';
    statusEl.className = text ? 'on' : '';
  }

  // ── Library loading (unpkg, then jsDelivr) ───────────────────
  var bases = CONFIG.libraryBaseUrl
    ? [CONFIG.libraryBaseUrl]
    : ['https://unpkg.com/maplibre-gl@' + CONFIG.maplibreVersion + '/dist/',
       'https://cdn.jsdelivr.net/npm/maplibre-gl@' + CONFIG.maplibreVersion + '/dist/'];

  function loadLibrary(index) {
    if (index >= bases.length) {
      setStatus('Harita yüklenemedi · bağlantını kontrol et');
      send({ type: 'fatal', message: 'maplibre-gl could not be loaded' });
      return;
    }
    var css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = bases[index] + 'maplibre-gl.css';
    document.head.appendChild(css);
    var script = document.createElement('script');
    script.src = bases[index] + 'maplibre-gl.js';
    script.onload = start;
    script.onerror = function () { css.remove(); script.remove(); loadLibrary(index + 1); };
    document.head.appendChild(script);
  }

  // ── Themes: raster colour grading only (imagery stays daylight-lit) ──
  var THEMES = {
    classic:       { 'raster-saturation': 0.12, 'raster-contrast': 0.08, 'raster-brightness-min': 0, 'raster-brightness-max': 1, 'raster-hue-rotate': 0 },
    parchment:     { 'raster-saturation': -0.6, 'raster-contrast': 0.1, 'raster-brightness-min': 0.1, 'raster-brightness-max': 1, 'raster-hue-rotate': 18 },
    night_lights:  { 'raster-saturation': -0.1, 'raster-contrast': 0.18, 'raster-brightness-min': 0, 'raster-brightness-max': 0.82, 'raster-hue-rotate': 0 },
    swiss_minimal: { 'raster-saturation': -1, 'raster-contrast': 0.22, 'raster-brightness-min': 0.04, 'raster-brightness-max': 1, 'raster-hue-rotate': 0 }
  };

  function cityFeatures(cities) {
    return {
      type: 'FeatureCollection',
      features: cities.map(function (c) {
        return { type: 'Feature', properties: { id: c.id, name: c.name }, geometry: { type: 'Point', coordinates: [c.lon, c.lat] } };
      })
    };
  }

  var map = null;
  var state = {
    activeId: CONFIG.activeId,
    interactive: CONFIG.interactive,
    autoRotate: CONFIG.autoRotate,
    paused: false,
    bottomFraction: CONFIG.bottomPaddingFraction,
    lastInteraction: 0,
    detentLon: null,
    userMoving: false
  };
  var pending = [];
  var ready = false;

  function padding() {
    return { top: 0, left: 0, right: 0, bottom: Math.round(window.innerHeight * state.bottomFraction * 2) };
  }

  function applyInteractive() {
    var handlers = ['dragPan', 'scrollZoom', 'boxZoom', 'dragRotate', 'keyboard', 'doubleClickZoom', 'touchZoomRotate', 'touchPitch'];
    handlers.forEach(function (name) {
      var h = map[name];
      if (!h) return;
      if (state.interactive) h.enable(); else h.disable();
    });
  }

  function applyActiveFilter() {
    var id = state.activeId || '';
    map.setFilter('city-pulse', ['==', ['get', 'id'], id]);
    map.setPaintProperty('city-core', 'circle-color', ['case', ['==', ['get', 'id'], id], CONFIG.markerActiveColor, CONFIG.markerColor]);
    map.setPaintProperty('city-core', 'circle-radius', ['case', ['==', ['get', 'id'], id], 7, 5]);
  }

  var flight = null;
  function flyTo(lat, lon, zoom) {
    // flyTo() first stops any running flight (firing its moveend), so the new
    // target is recorded only after the call.
    map.flyTo({ center: [lon, lat], zoom: zoom, padding: padding(), curve: 1.42, speed: 1.1, essential: true }, { wglobeFlight: true });
    flight = { lat: lat, lon: lon, zoom: zoom };
  }

  function receive(message) {
    if (!message || typeof message !== 'object') return;
    if (!ready) { pending.push(message); return; }
    switch (message.type) {
      case 'setActive':
        state.activeId = message.id || null;
        applyActiveFilter();
        if (message.flyTo) flyTo(message.flyTo.lat, message.flyTo.lon, message.flyTo.zoom);
        break;
      case 'flyTo':
        flyTo(message.lat, message.lon, message.zoom);
        break;
      case 'setTheme': {
        var paint = THEMES[message.theme] || THEMES.classic;
        Object.keys(paint).forEach(function (k) { map.setPaintProperty('satellite', k, paint[k]); });
        break;
      }
      case 'setPadding':
        state.bottomFraction = message.bottomFraction || 0;
        // A padding change must never cancel a city flight: continue the flight
        // from where it is, now aiming at the new padded focus point.
        if (flight) flyTo(flight.lat, flight.lon, flight.zoom);
        else map.easeTo({ padding: padding(), duration: 320, easing: function (t) { return 1 - Math.pow(1 - t, 3); } });
        break;
      case 'setAutoRotate':
        state.autoRotate = !!message.value;
        break;
      case 'setInteractive':
        state.interactive = !!message.value;
        applyInteractive();
        break;
      case 'setPaused':
        state.paused = !!message.value;
        if (!state.paused) requestAnimationFrame(animate);
        break;
      case 'setCities':
        map.getSource('cities').setData(cityFeatures(message.cities || []));
        break;
    }
  }
  window.__wglobe = { receive: receive };
  window.addEventListener('message', function (event) {
    var data = event.data;
    if (typeof data === 'string') { try { data = JSON.parse(data); } catch (e) { return; } }
    if (data && data.__wglobeToPage) receive(data.payload);
  });
  document.addEventListener('message', function (event) {
    try { var data = JSON.parse(event.data); if (data && data.__wglobeToPage) receive(data.payload); } catch (e) { /* ignore */ }
  });

  // ── Animation loop: pin pulse + idle spin (30 fps, stops when paused) ──
  var lastFrame = 0;
  function animate(now) {
    if (!map || state.paused) return;
    requestAnimationFrame(animate);
    if (now - lastFrame < 33) return;
    var dt = lastFrame ? Math.min((now - lastFrame) / 1000, 0.1) : 0;
    lastFrame = now;
    if (state.activeId) {
      var phase = (now % 1600) / 1600;
      var eased = 1 - Math.pow(1 - phase, 3);
      map.setPaintProperty('city-pulse', 'circle-radius', 10 + 16 * eased);
      map.setPaintProperty('city-pulse', 'circle-stroke-opacity', 0.55 * (1 - phase));
    }
    var idle = Date.now() - state.lastInteraction > 3500;
    if (state.autoRotate && idle && !state.userMoving && !map.isMoving() && map.getZoom() < 3.5) {
      var strength = Math.min(1, (3.5 - map.getZoom()) / 1.5);
      var c = map.getCenter();
      map.setCenter([c.lng - 3 * strength * dt, c.lat]);
    }
  }

  function markInteraction() {
    state.lastInteraction = Date.now();
    send({ type: 'interaction' });
  }

  // ── Map ─────────────────────────────────────────────────────
  function start() {
    var maplibregl = window.maplibregl;
    if (!maplibregl) { loadLibrary(bases.length); return; }
    var theme = THEMES[CONFIG.theme] || THEMES.classic;
    var paint = { 'raster-fade-duration': 220, 'raster-resampling': 'linear' };
    Object.keys(theme).forEach(function (k) { paint[k] = theme[k]; });

    map = new maplibregl.Map({
      container: 'map',
      pixelRatio: Math.min(window.devicePixelRatio || 1, 3),
      attributionControl: false,
      center: [CONFIG.initial.lon, CONFIG.initial.lat],
      zoom: CONFIG.initial.zoom,
      minZoom: 0.6,
      maxZoom: CONFIG.cameraMaxZoom,
      maxPitch: 70,
      dragRotate: true,
      touchPitch: true,
      fadeDuration: 200,
      maxTileCacheSize: 600,
      cancelPendingTileRequestsWhileZooming: true,
      style: {
        version: 8,
        projection: { type: 'globe' },
        sky: {
          'sky-color': '#0b1d3a',
          'horizon-color': '#38bdf8',
          'sky-horizon-blend': 0.6,
          'horizon-fog-blend': 0.5,
          'fog-color': '#1d4ed8',
          'fog-ground-blend': 0,
          'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 7, 0]
        },
        sources: {
          satellite: {
            type: 'raster',
            tiles: [CONFIG.tileUrl],
            tileSize: CONFIG.tileSize,
            maxzoom: CONFIG.sourceMaxZoom,
            attribution: CONFIG.attribution
          },
          cities: { type: 'geojson', data: cityFeatures(CONFIG.cities) }
        },
        layers: [
          { id: 'space', type: 'background', paint: { 'background-color': '#0a1424' } },
          { id: 'satellite', type: 'raster', source: 'satellite', paint: paint },
          {
            id: 'city-pulse', type: 'circle', source: 'cities', filter: ['==', ['get', 'id'], CONFIG.activeId || ''],
            paint: { 'circle-radius': 10, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-width': 2, 'circle-stroke-color': CONFIG.markerActiveColor, 'circle-stroke-opacity': 0.5, 'circle-pitch-alignment': 'map' }
          },
          {
            id: 'city-core', type: 'circle', source: 'cities',
            paint: { 'circle-radius': 5, 'circle-color': CONFIG.markerColor, 'circle-stroke-width': 1.5, 'circle-stroke-color': '#ffffff', 'circle-stroke-opacity': 0.9, 'circle-pitch-alignment': 'map' }
          },
          {
            id: 'city-hit', type: 'circle', source: 'cities',
            paint: { 'circle-radius': 22, 'circle-color': '#000000', 'circle-opacity': 0, 'circle-pitch-alignment': 'map' }
          }
        ]
      }
    });

    window.__wglobe.map = map; // exposed for diagnostics / automated tests
    map.on('load', function () {
      applyInteractive();
      applyActiveFilter();
      map.setPadding(padding());
      setStatus('');
      ready = true;
      var queued = pending; pending = [];
      queued.forEach(receive);
      send({ type: 'ready' });
      requestAnimationFrame(animate);
    });

    map.on('error', function (event) {
      var message = event && event.error && event.error.message ? event.error.message : 'map error';
      send({ type: 'error', message: message });
    });

    ['dragstart', 'zoomstart', 'rotatestart', 'pitchstart'].forEach(function (name) {
      map.on(name, function (event) {
        if (event.originalEvent) { state.userMoving = true; flight = null; markInteraction(); }
      });
    });
    map.on('moveend', function (event) {
      if (event && event.wglobeFlight) flight = null;
      // Only a user gesture restarts the idle timer; the idle spin's own setCenter must not.
      if (state.userMoving) state.lastInteraction = Date.now();
      state.userMoving = false;
    });
    map.on('move', function (event) {
      if (!event.originalEvent) return;
      var lon = map.getCenter().lng;
      if (state.detentLon === null) state.detentLon = lon;
      var delta = ((lon - state.detentLon + 540) % 360) - 180;
      if (Math.abs(delta) >= 15) { state.detentLon = lon; send({ type: 'detent' }); }
    });

    map.on('click', function (event) {
      markInteraction();
      var p = event.point;
      var hits = map.queryRenderedFeatures([[p.x - 18, p.y - 18], [p.x + 18, p.y + 18]], { layers: ['city-hit'] });
      if (!hits.length) return;
      var best = null, bestDistance = Infinity;
      hits.forEach(function (feature) {
        var coords = feature.geometry.coordinates;
        var sp = map.project(coords);
        var d = Math.hypot(sp.x - p.x, sp.y - p.y);
        if (d < bestDistance) { bestDistance = d; best = feature; }
      });
      if (best) send({ type: 'select', id: best.properties.id });
    });

    window.addEventListener('resize', function () { map.resize(); map.setPadding(padding()); });
  }

  setStatus('Küre yükleniyor');
  loadLibrary(0);
})();
</script>
</body>
</html>`;
}
