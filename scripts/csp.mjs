// İçerik Güvenliği Politikası (CSP): yayın sırasında dist/index.html'e eklenir.
// Satır içi betiğin SHA-256 parmak izi her yayında yeniden hesaplanır; böylece yalnızca bu betik ve
// sitenin kendi lib/ dosyaları çalışabilir. Sızdırılmış bir <script>, olay niteliği ya da javascript: bağlantısı çalışmaz.
//   node scripts/csp.mjs <html dosyası> <sitenin temel adresi>
//   ör. node scripts/csp.mjs dist/index.html https://bolut916.github.io/wGlobe/
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const [file, base] = process.argv.slice(2);
if (!file || !base || !/^https?:\/\/[^/]+\/(.*\/)?$/.test(base)) { console.error('kullanım: node scripts/csp.mjs <html> <temel-adres/>'); process.exit(2); }
let html = readFileSync(file, 'utf8');
if (html.includes('http-equiv="Content-Security-Policy"')) { console.error('CSP zaten var'); process.exit(1); }

const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
if (inline.length !== 1) { console.error(`beklenen 1 satır içi betik, bulunan ${inline.length}`); process.exit(1); }
const external = [...html.matchAll(/<script\s+src="([^"]+)"/g)].map((m) => m[1]);
const bad = external.filter((u) => !/^lib\/[\w.-]+\.js$/.test(u));
if (bad.length) { console.error('lib/ dışından betik:', bad.join(', ')); process.exit(1); }
if (/\son[a-z]+=\s*["']/i.test(html.replace(/<script>[\s\S]*?<\/script>/g, '')) || html.includes('javascript:')) { console.error('satır içi olay niteliği ya da javascript: bağlantısı var'); process.exit(1); }

const hash = createHash('sha256').update(inline[0], 'utf8').digest('base64');
const lib = new URL('lib/', base).href;
const policy = [
  "default-src 'self'",
  `script-src 'sha256-${hash}' ${lib}`,
  `worker-src ${lib} blob:`,
  "connect-src 'self' https: data: blob:",          // radyo sunucuları, hava durumu, Supabase, harita karoları, yayın ön kontrolü
  "img-src 'self' data: blob: https:",
  "media-src 'self' https: data: blob:",            // canlı yayınlar her yerden (yalnız https)
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",                           // yazı tipleri sitenin kendisinden (lib/fonts)
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "manifest-src 'self'",
].join('; ');
const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}">`;
if (!html.includes('<meta charset="utf-8">')) { console.error('<meta charset> bulunamadı'); process.exit(1); }
html = html.replace('<meta charset="utf-8">', `<meta charset="utf-8">${meta}<meta name="referrer" content="strict-origin-when-cross-origin">`);
writeFileSync(file, html);
console.log(`CSP eklendi · betik sha256-${hash.slice(0, 12)}… · ${external.length} lib betiği`);
