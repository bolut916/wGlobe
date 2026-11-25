/**
 * Yerel radyo: web arayüzünün istasyon sırası, kilit ekranına bağlı bir yerel çalma listesi olur.
 *
 * - Uygulama arka plandayken ve ekran kilitliyken çalmaya devam eder.
 * - Kilit ekranı / Denetim Merkezi / kulaklık tuşları: oynat-duraklat, sonraki-önceki istasyon.
 * - Bir istasyon 9 sn içinde çalmaya başlamazsa sıradakine geçilir; hepsi düşerse web'e bildirilir.
 * - Her durum değişikliği (çalıyor / tamponda / sıra değişti) web'e 'audio:state' olarak gider.
 */
import { createAudioPlaylist, setAudioModeAsync, type AudioPlaylist, type AudioPlaylistStatus } from 'expo-audio';
import * as FS from 'expo-file-system/legacy';

import type { AudioLoadMessage, AudioStateMessage, Track } from './bridge';

const START_TIMEOUT_MS = 9000;
const RESUME_RELOAD_MS = 30000;   // uzun duraklatmadan sonra canlı yayın baştan bağlanır (bayat tampon çalmasın)

type Sub = { remove: () => void };

export class NativeRadio {
  private pl: AudioPlaylist | null = null;
  private subs: Sub[] = [];
  private loadId = 0;
  private tracks: Track[] = [];
  private artist = '';
  private album = 'wGlobe';
  private artworkUrl: string | undefined;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private tried = 0;
  private lastSent = '';
  private pausedAt = 0;
  private everPlayed = false;

  constructor(private readonly emit: (msg: AudioStateMessage) => void) {}

  static async configure(): Promise<void> {
    try {
      await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: 'doNotMix' });
    } catch {
      // Ses modu ayarlanamazsa çalma yine de denenir (yalnız arka plan/kilit ekranı etkilenir).
    }
  }

  async load(msg: AudioLoadMessage): Promise<void> {
    this.destroy();
    if (!msg.tracks.length) { this.send({ failed: true }); return; }
    this.loadId = msg.loadId;
    this.tracks = msg.tracks;
    this.artist = msg.meta.artist;
    this.album = msg.meta.album || 'wGlobe';
    this.artworkUrl = await saveArtwork(msg.meta.artwork, msg.loadId);
    this.tried = 0; this.everPlayed = false;
    const pl = createAudioPlaylist({ sources: msg.tracks.map((t) => ({ uri: t.url })), loop: 'none', updateInterval: 500 });
    this.pl = pl;
    this.subs.push(
      pl.addListener('playlistStatusUpdate', (s: AudioPlaylistStatus) => this.onStatus(s)),
      pl.addListener('trackChanged', (d: { currentIndex: number }) => this.onTrack(d.currentIndex)),
    );
    const index = clampIndex(msg.index, msg.tracks.length);
    pl.skipTo(index);
    pl.play();
    pl.setActiveForLockScreen(true, this.metadata(index), { showNextTrack: true, showPreviousTrack: true, isLiveStream: true });
    this.arm();
  }

  /** Web'deki oynat/sonraki/önceki: aynı istasyon kısa süre duraklatıldıysa kaldığı yerden, değilse yeniden bağlanır. */
  skipTo(loadId: number, index: number): void {
    const pl = this.pl; if (!pl || loadId !== this.loadId) return;
    const i = clampIndex(index, this.tracks.length);
    const resume = i === pl.currentIndex && this.pausedAt && Date.now() - this.pausedAt < RESUME_RELOAD_MS;
    if (!resume) pl.skipTo(i);
    pl.play(); this.pausedAt = 0; this.tried = 0;
    this.arm();
  }

  pause(loadId?: number): void {
    const pl = this.pl; if (!pl || (loadId !== undefined && loadId !== this.loadId)) return;
    this.disarm(); pl.pause(); this.pausedAt = Date.now();
  }

  /** Kilit ekranı kapağı sonradan gelir (web onu küre görüntüsünden çizer) */
  async setArtwork(loadId: number, dataUrl: string): Promise<void> {
    if (loadId !== this.loadId || !this.pl) return;
    const uri = await saveArtwork(dataUrl, loadId);
    if (!uri || loadId !== this.loadId || !this.pl) return;
    this.artworkUrl = uri;
    try { this.pl.updateLockScreenMetadata(this.metadata(this.pl.currentIndex)); } catch { /* kilit ekranı kapalı */ }
  }

  /** Uyku zamanlayıcısının sönüşü */
  setVolume(v: number): void { if (this.pl) this.pl.volume = Math.max(0, Math.min(1, v)); }

  destroy(): void {
    this.disarm();
    this.subs.forEach((s) => s.remove()); this.subs = [];
    if (this.pl) {
      try { this.pl.clearLockScreenControls(); } catch { /* zaten temiz */ }
      try { this.pl.pause(); this.pl.destroy(); } catch { /* yok edilmiş */ }
    }
    this.pl = null; this.lastSent = '';
  }

  private metadata(index: number) {
    const t = this.tracks[index];
    return { title: t ? t.title : 'wGlobe', artist: this.artist, albumTitle: this.album, artworkUrl: this.artworkUrl };
  }

  private onTrack(index: number): void {
    const pl = this.pl; if (!pl) return;
    try { pl.updateLockScreenMetadata(this.metadata(index)); } catch { /* kilit ekranı kapalı */ }
    this.arm();
    this.report(pl.currentStatus);
  }

  private onStatus(s: AudioPlaylistStatus): void {
    if (s.playing && !s.isBuffering) { this.disarm(); this.tried = 0; this.everPlayed = true; this.pausedAt = 0; }
    else if (!s.playing && this.everPlayed && !this.watchdog && !this.pausedAt) this.pausedAt = Date.now();   // kilit ekranından duraklatıldı
    this.report(s);
  }

  private report(s: AudioPlaylistStatus): void {
    this.send({ index: s.currentIndex, playing: s.playing && !s.isBuffering, buffering: s.isBuffering || (s.playing && !s.isLoaded) });
  }

  private send(part: Partial<AudioStateMessage>): void {
    const msg: AudioStateMessage = { type: 'audio:state', loadId: this.loadId, index: part.index ?? 0, playing: !!part.playing, buffering: !!part.buffering, failed: !!part.failed };
    const key = JSON.stringify(msg);
    if (key === this.lastSent) return;
    this.lastSent = key; this.emit(msg);
  }

  /** Bekçi: istasyon 9 sn'de çalmazsa sıradakine; hepsi denendiyse 'failed' */
  private arm(): void {
    this.disarm();
    this.watchdog = setTimeout(() => {
      this.watchdog = null;
      const pl = this.pl; if (!pl) return;
      const s = pl.currentStatus;
      if (s.playing && !s.isBuffering) return;
      this.tried += 1;
      if (this.tried >= this.tracks.length) { pl.pause(); this.send({ index: s.currentIndex, failed: true }); return; }
      pl.skipTo((s.currentIndex + 1) % this.tracks.length); pl.play();
      this.arm();
    }, START_TIMEOUT_MS);
  }

  private disarm(): void { if (this.watchdog) { clearTimeout(this.watchdog); this.watchdog = null; } }
}

function clampIndex(i: number, n: number): number { return Number.isInteger(i) && i >= 0 && i < n ? i : 0; }

/** Kilit ekranı kapağı: web'in gönderdiği küre görüntüsü önbellekte bir dosyaya yazılır. */
async function saveArtwork(dataUrl: string | null | undefined, id: number): Promise<string | undefined> {
  if (!dataUrl || !FS.cacheDirectory) return undefined;
  const m = /^data:image\/(jpeg|png);base64,(.+)$/.exec(dataUrl);
  if (!m || !m[2]) return undefined;
  const uri = `${FS.cacheDirectory}wglobe-kapak-${id % 4}.${m[1] === 'png' ? 'png' : 'jpg'}`;
  try { await FS.writeAsStringAsync(uri, m[2], { encoding: FS.EncodingType.Base64 }); return uri; } catch { return undefined; }
}
