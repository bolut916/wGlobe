// wGlobe · now-playing
// Canlı radyo yayınının ICY başlığından (StreamTitle) şu an çalan şarkıyı okur.
// Yayına 'Icy-MetaData: 1' ile bağlanır, yalnızca ilk metaint bayt + başlık bloğunu okur
// (en fazla ~70 KB, 7 sn), şarkı adını çıkarır ve bağlantıyı keser. Ses içeriği asla döndürülmez.
// Kimlik: uygulamanın herkese açık anahtarı (apikey) beklenir; JWT doğrulaması kapalı (anahtar yeni biçimde).
// Dağıtım: verify_jwt = false (kimliği fonksiyon kendisi denetler).
// Güvenlik (SSRF): yalnız https; ad, çözülen her IP adresi ve her yönlendirme adımı ayrı ayrı denetlenir —
// fonksiyon iç ağa, bulut meta veri adresine (169.254.169.254) ya da yerel makineye asla bağlanmaz.
// Kötüye kullanım: IP başına dakikada en fazla RATE_MAX istek (ısıl örnek başına, en iyi çaba).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const KEYS = new Set([
  "sb_publishable_C4Tm9rFGLt-y9I1WIig4Kg_gEdXloFn",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRvcm9kamtwZXZua2xoYXFhb3l0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTU3MTM0NDMsImV4cCI6MjExMTI4OTQ0M30.VN_Ojb5YK6Mj52JmRIlv64c3XzJyEu85L7giTm3n-SY",
]);
const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "apikey, authorization, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Max-Age": "86400",
};
// Bazı yayın sunucuları bilinmeyen istemcilere 403 verir: sırayla yaygın oynatıcı kimlikleriyle denenir.
const AGENTS = ["wGlobe/1.0 (now-playing)", "VLC/3.0.20 LibVLC/3.0.20", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"];
const MAX_METAINT = 65536;
const TIMEOUT_MS = 7000;
const MAX_REDIRECTS = 3;
const RATE_MAX = 120;
const RATE_WINDOW = 60000;

type Body = Record<string, unknown>;
type Entry = { at: number; ttl: number; body: Body };
const cache = new Map<string, Entry>();

function reply(body: Body, status = 200, maxAge = 15): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": `public, max-age=${maxAge}` },
  });
}

function remember(key: string, body: Body, ttl: number) {
  if (cache.size > 500) { const first = cache.keys().next().value; if (first !== undefined) cache.delete(first); }
  cache.set(key, { at: Date.now(), ttl, body });
}

function badHost(host: string): boolean {
  const h = host.toLowerCase();
  return !h || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") ||
    h.endsWith(".lan") || h.endsWith(".home") || h.startsWith("[") || h.includes(":") || /^[0-9.]+$/.test(h) || !h.includes(".");
}

// IPv4/IPv6 adresinin herkese açık internette olup olmadığı (özel, döngü, yerel bağlantı, CGNAT, çok noktaya
// yayın, ayrılmış ve belgeleme aralıkları reddedilir).
function publicV4(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b, c] = p as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}
function publicV6(ip: string): boolean {
  const h = ip.toLowerCase();
  const v4 = h.match(/^(?:0*:)*:?ffff:(\d+\.\d+\.\d+\.\d+)$/) || h.match(/^::(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) return publicV4(v4[1]!);
  if (h === "::" || h === "::1" || /^0*:(0*:)*0*1?$/.test(h)) return false;
  const first = parseInt(h.split(":")[0] || "0", 16);
  if (!Number.isFinite(first)) return false;
  if ((first & 0xfe00) === 0xfc00) return false;   // fc00::/7 özel
  if ((first & 0xffc0) === 0xfe80) return false;   // fe80::/10 yerel bağlantı
  if ((first & 0xff00) === 0xff00) return false;   // çok noktaya yayın
  if (first === 0x2001 && h.startsWith("2001:db8")) return false;  // belgeleme
  if (first === 0x64 && h.startsWith("64:ff9b")) return false;      // NAT64 (iç IPv4'e köprü olabilir)
  if (first === 0x2002) return false;                                // 6to4 (gömülü IPv4)
  return (first & 0xe000) === 0x2000;              // yalnız küresel tek noktaya yayın 2000::/3
}

const dnsOk = new Map<string, { at: number; ok: boolean }>();
async function resolvesPublic(host: string): Promise<boolean> {
  const hit = dnsOk.get(host);
  if (hit && Date.now() - hit.at < 300000) return hit.ok;
  let ok = false;
  try {
    const [a, aaaa] = await Promise.all([
      Deno.resolveDns(host, "A").catch(() => [] as string[]),
      Deno.resolveDns(host, "AAAA").catch(() => [] as string[]),
    ]);
    const all = [...a, ...aaaa];
    ok = all.length > 0 && a.every(publicV4) && aaaa.every(publicV6);
  } catch { ok = false; }
  if (dnsOk.size > 2000) dnsOk.clear();
  dnsOk.set(host, { at: Date.now(), ok });
  return ok;
}

/** Bağlanılabilir mi: https, kimlik bilgisi yok, geçerli port, herkese açık ad ve herkese açık IP. */
async function safeTarget(u: URL): Promise<boolean> {
  if (u.protocol !== "https:" || u.username || u.password) return false;
  if (u.port && !/^\d{2,5}$/.test(u.port)) return false;
  if (badHost(u.hostname)) return false;
  return await resolvesPublic(u.hostname.toLowerCase());
}

const hits = new Map<string, { start: number; n: number }>();
function limited(req: Request): boolean {
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0]!.trim() || req.headers.get("cf-connecting-ip") || "?";
  const now = Date.now(), h = hits.get(ip);
  if (!h || now - h.start > RATE_WINDOW) {
    if (hits.size > 5000) hits.clear();
    hits.set(ip, { start: now, n: 1 });
    return false;
  }
  h.n++;
  return h.n > RATE_MAX;
}

function decode(bytes: Uint8Array): string {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return new TextDecoder("windows-1252").decode(bytes); }
}

function clean(raw: string): string | null {
  const t = raw.replace(/\u0000/g, "").replace(/\s+/g, " ").trim();
  if (t.length < 2 || t.length > 300) return null;
  if (/^(-+|unknown|n\/?a|null|undefined|untitled|\.+|-\s*-)$/i.test(t)) return null;
  return t;
}

async function readTitle(url: string, agent: string, deadline: number): Promise<Body> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.max(500, deadline - Date.now()));
  try {
    // Yönlendirmeler elle izlenir: her yeni adres bağlanmadan önce yeniden denetlenir
    let res: Response | null = null, at = new URL(url);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (hop > 0 && !(await safeTarget(at))) return { title: null, reason: "blocked" };
      const r = await fetch(at, { headers: { "Icy-MetaData": "1", "User-Agent": agent, "Accept": "*/*" }, redirect: "manual", signal: ctrl.signal });
      if (r.status >= 300 && r.status < 400 && r.headers.get("location")) {
        try { await r.body?.cancel(); } catch { /* yok */ }
        try { at = new URL(r.headers.get("location")!, at); } catch { return { title: null, reason: "fetch" }; }
        continue;
      }
      res = r; break;
    }
    if (!res) return { title: null, reason: "redirects" };
    const metaint = parseInt(res.headers.get("icy-metaint") || "", 10);
    if (!res.ok || !res.body) { try { await res.body?.cancel(); } catch { /* yok */ } return { title: null, reason: "http-" + res.status }; }
    if (!Number.isFinite(metaint) || metaint <= 0 || metaint > MAX_METAINT) { try { await res.body.cancel(); } catch { /* yok */ } return { title: null, reason: "no-icy" }; }
    const need = metaint + 1 + 255 * 16;
    const buf = new Uint8Array(need);
    let got = 0, metaLen = -1;
    const reader = res.body.getReader();
    try {
      while (true) {
        if (got > metaint && metaLen < 0) metaLen = buf[metaint] * 16;
        if (metaLen >= 0 && got >= metaint + 1 + metaLen) break;
        const { value, done } = await reader.read();
        if (done || !value) break;
        const n = Math.min(value.length, need - got);
        buf.set(value.subarray(0, n), got); got += n;
        if (got >= need) { if (metaLen < 0) metaLen = buf[metaint] * 16; break; }
      }
    } finally { try { await reader.cancel(); } catch { /* yok */ } }
    if (metaLen <= 0 || got < metaint + 1 + metaLen) return { title: null, reason: metaLen === 0 ? "empty" : "short" };
    const meta = decode(buf.subarray(metaint + 1, metaint + 1 + metaLen));
    const m = meta.match(/StreamTitle='([\s\S]*?)';/) || meta.match(/StreamTitle='([\s\S]*?)'?\u0000*$/);
    const title = m ? clean(m[1]) : null;
    if (!title) return { title: null, reason: "empty" };
    const i = title.indexOf(" - ");
    return i > 0 ? { title, artist: title.slice(0, i).trim(), song: title.slice(i + 3).trim() } : { title, artist: null, song: title };
  } catch (e) {
    return { title: null, reason: (e as Error).name === "AbortError" ? "timeout" : "fetch" };
  } finally { clearTimeout(timer); }
}

async function lookup(url: string): Promise<Body> {
  const deadline = Date.now() + TIMEOUT_MS;
  let last: Body = { title: null, reason: "fetch" };
  for (const agent of AGENTS) {
    last = await readTitle(url, agent, deadline);
    if (last.reason !== "http-403" && last.reason !== "http-401") return last;
    if (Date.now() > deadline - 800) break;
  }
  return last;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "GET") return reply({ error: "method" }, 405, 0);
  const key = req.headers.get("apikey") || new URL(req.url).searchParams.get("apikey") || "";
  if (!KEYS.has(key)) return reply({ error: "unauthorized" }, 401, 0);
  if (limited(req)) return reply({ error: "rate" }, 429, 30);
  const raw = new URL(req.url).searchParams.get("url") || "";
  let target: URL;
  try { target = new URL(raw); } catch { return reply({ error: "url" }, 400, 0); }
  target.hash = "";
  const k = target.toString();
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < hit.ttl) return reply(hit.body, 200, Math.max(1, Math.round((hit.ttl - (Date.now() - hit.at)) / 1000)));
  if (raw.length > 600 || !(await safeTarget(target))) return reply({ error: "url" }, 400, 0);
  const body = await lookup(k);
  const ttl = body.title ? 15000 : body.reason === "no-icy" ? 600000 : 60000;
  remember(k, body, ttl);
  return reply(body, 200, Math.round(ttl / 1000));
});
