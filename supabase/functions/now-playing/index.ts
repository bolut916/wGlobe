// wGlobe · now-playing
// Canlı radyo yayınının ICY başlığından (StreamTitle) şu an çalan şarkıyı okur.
// Yayına 'Icy-MetaData: 1' ile bağlanır, yalnızca ilk metaint bayt + başlık bloğunu okur
// (en fazla ~70 KB, 7 sn), şarkı adını çıkarır ve bağlantıyı keser. Ses içeriği asla döndürülmez.
// Kimlik: uygulamanın herkese açık anahtarı (apikey) beklenir; JWT doğrulaması kapalı (anahtar yeni biçimde).
// Dağıtım: verify_jwt = false (kimliği fonksiyon kendisi denetler).
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
    const res = await fetch(url, { headers: { "Icy-MetaData": "1", "User-Agent": agent, "Accept": "*/*" }, redirect: "follow", signal: ctrl.signal });
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
  const raw = new URL(req.url).searchParams.get("url") || "";
  let target: URL;
  try { target = new URL(raw); } catch { return reply({ error: "url" }, 400, 0); }
  if (target.protocol !== "https:" || raw.length > 600 || target.username || target.password || badHost(target.hostname) || (target.port && !/^\d{2,5}$/.test(target.port))) return reply({ error: "url" }, 400, 0);
  const k = target.toString();
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < hit.ttl) return reply(hit.body, 200, Math.max(1, Math.round((hit.ttl - (Date.now() - hit.at)) / 1000)));
  const body = await lookup(k);
  const ttl = body.title ? 15000 : body.reason === "no-icy" ? 600000 : 60000;
  remember(k, body, ttl);
  return reply(body, 200, Math.round(ttl / 1000));
});
