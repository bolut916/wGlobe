/*
 * wGlobe görüntü işçisi. Ana thread'i hiç meşgul etmez; animasyonlar sırasında kasma olmaz.
 *
 * 1) Eşdikdörtgen → Mercator:  { id, url, size, alpha }
 *    alpha=true  → bulut katmanı: beyaz (235) + alfa = parlaklık × 1.08 (PNG)
 *    alpha=false → renkli görüntü (JPEG)
 * 2) Gece katmanı:              { id, type: 'night', size, lightsUrl, sun: { lat, lng } }
 *    Güneşin gerçek konumuna göre gece tarafı (Mercator kare, PNG, alfa): güneş ufkun 4° üstünden
 *    10° altına inerken lacivert gölge koyulaşır, gece tarafında şehir ışıkları yanar.
 * Çıktı: { id, blob } ya da { id, error }
 */
let lights = null;   // { px, w, h } — ilk gece işinde bir kez yüklenir
async function loadPixels(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('HTTP ' + response.status);
  const bitmap = await createImageBitmap(await response.blob());
  const w = bitmap.width, h = bitmap.height;
  const cv = new OffscreenCanvas(w, h), cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(bitmap, 0, 0); bitmap.close();
  return { px: cx.getImageData(0, 0, w, h).data, w, h };
}
async function nightLayer({ size, lightsUrl, sun }) {
  if (!lights && lightsUrl) { try { lights = await loadPixels(lightsUrl); } catch (e) { lights = { px: null, w: 0, h: 0 }; } }
  const M = size, out = new OffscreenCanvas(M, M), oc = out.getContext('2d'), img = oc.createImageData(M, M), d = img.data;
  const D2R = Math.PI / 180, sd = Math.sin(sun.lat * D2R), cd = Math.cos(sun.lat * D2R);
  const cosDL = new Float32Array(M), lCol = new Int32Array(M);
  for (let x = 0; x < M; x++) {
    const lng = (x + 0.5) / M * 360 - 180;
    cosDL[x] = Math.cos((lng - sun.lng) * D2R);
    if (lights && lights.px) lCol[x] = Math.min(lights.w - 1, Math.floor((x + 0.5) / M * lights.w)) * 4;
  }
  const ss = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
  for (let y = 0; y < M; y++) {
    const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 0.5) / M)));
    const sl = Math.sin(lat), cl = Math.cos(lat);
    const lRow = lights && lights.px ? Math.min(lights.h - 1, Math.max(0, Math.floor((90 - lat / D2R) / 180 * lights.h))) * lights.w * 4 : -1;
    for (let x = 0, o = y * M * 4; x < M; x++, o += 4) {
      const alt = Math.asin(Math.max(-1, Math.min(1, sl * sd + cl * cd * cosDL[x]))) / D2R;
      const night = ss(4, -10, alt);
      if (night <= 0.002) { d[o + 3] = 0; continue; }
      let li = 0;
      if (lRow >= 0) { li = lights.px[lRow + lCol[x]] / 255; li = li * li * (0.35 + 0.65 * li); }
      const k = Math.min(1, li * 1.5) * night;
      d[o] = 6 + (255 - 6) * k; d[o + 1] = 12 + (206 - 12) * k; d[o + 2] = 30 + (140 - 30) * k;
      d[o + 3] = Math.min(255, night * (0.64 + 0.36 * Math.min(1, li * 1.7)) * 255);
    }
  }
  oc.putImageData(img, 0, 0);
  return out.convertToBlob({ type: 'image/png' });
}
self.onmessage = async (event) => {
  const { id } = event.data;
  try {
    if (event.data.type === 'night') { self.postMessage({ id, blob: await nightLayer(event.data) }); return; }
    const { url, size, alpha } = event.data;
    const src = await loadPixels(url);
    const Ws = src.w, Hs = src.h, M = size, px = src.px;
    const out = new OffscreenCanvas(M, M);
    const oc = out.getContext('2d');
    const img = oc.createImageData(M, M);
    const d = img.data;
    const colOf = new Int32Array(M);
    for (let x = 0; x < M; x++) colOf[x] = Math.floor((x + 0.5) / M * Ws) * 4;
    const R2D = 180 / Math.PI;
    for (let y = 0; y < M; y++) {
      const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 0.5) / M))) * R2D;
      const row = Math.min(Hs - 1, Math.max(0, Math.floor((90 - lat) / 180 * Hs))) * Ws * 4;
      for (let x = 0, o = y * M * 4; x < M; x++, o += 4) {
        const i = row + colOf[x];
        if (alpha) { d[o] = d[o + 1] = d[o + 2] = 235; d[o + 3] = Math.min(255, px[i] * 1.08); }
        else { d[o] = px[i]; d[o + 1] = px[i + 1]; d[o + 2] = px[i + 2]; d[o + 3] = 255; }
      }
    }
    oc.putImageData(img, 0, 0);
    const blob = await out.convertToBlob(alpha ? { type: 'image/png' } : { type: 'image/jpeg', quality: 0.92 });
    self.postMessage({ id, blob });
  } catch (error) {
    self.postMessage({ id, error: String(error && error.message || error) });
  }
};
