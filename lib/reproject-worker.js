/*
 * wGlobe görüntü işçisi: eşdikdörtgen (enlem-boylam) bir görseli Mercator kareye çevirir.
 * Ana thread'i hiç meşgul etmez; intro animasyonu sırasında kasma olmaz.
 *
 * Girdi:  { id, url, size, alpha }
 *   alpha=true  → bulut katmanı: beyaz (235) + alfa = parlaklık × 1.08 (PNG)
 *   alpha=false → renkli görüntü (JPEG)
 * Çıktı:  { id, blob } ya da { id, error }
 */
self.onmessage = async (event) => {
  const { id, url, size, alpha } = event.data;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const bitmap = await createImageBitmap(await response.blob());
    const Ws = bitmap.width, Hs = bitmap.height, M = size;
    const sourceCanvas = new OffscreenCanvas(Ws, Hs);
    const sx = sourceCanvas.getContext('2d', { willReadFrequently: true });
    sx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const px = sx.getImageData(0, 0, Ws, Hs).data;
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
