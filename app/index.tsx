/**
 * wGlobe uygulaması: web sitesiyle aynı arayüz, yerel bir kabuğun içinde.
 *
 * Tek kaynak → iki ürün: arayüz https://bolut916.github.io/wGlobe/ adresinden gelir; her güncelleme hem siteye
 * hem uygulamaya aynı anda yansır. Kabuk, web'in tek başına yapamadıklarını üstlenir:
 *   • Ses yerel çalar: arka planda ve kilit ekranında sürer; kilit ekranı/kulaklık tuşları çalışır (NativeRadio)
 *   • Dokunuş titreşimi (expo-haptics)
 *   • Paylaşım kartı sistemin paylaşım menüsüyle (görsel + bağlantı)
 *   • wglobe://… bağlantıları uygulamayı o şehirde açar
 */
import * as Haptics from 'expo-haptics';
import * as Linking from 'expo-linking';
import * as Notifications from 'expo-notifications';
import * as Sharing from 'expo-sharing';
import * as FS from 'expo-file-system/legacy';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState, type ComponentType, type Ref } from 'react';
import { ActivityIndicator, Animated, BackHandler, Easing, Platform, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent, type WebViewProps } from 'react-native-webview';

import { NativeRadio } from '@/shell/NativeRadio';
import { configureAlarm, isAlarmResponse, setAlarm } from '@/shell/Alarm';
import { linkParams, parseWebMessage, type HapticName, type NativeMessage, type ShareMessage } from '@/shell/bridge';

const SITE_URL = 'https://bolut916.github.io/wGlobe/';
const SITE_ORIGIN = 'https://bolut916.github.io';
const BG = '#050B18';
// react-native-webview 14 tür tanımında props `never`e çöküyor; bileşenin gerçek imzasıyla sarmalanır.
const NativeWebView = WebView as unknown as ComponentType<WebViewProps & { ref?: Ref<WebView> }>;

/** Açılış adresi: paylaşılan bir bağlantıyla gelindiyse parametreleri siteye aktar. */
function startUri(initial: string | null): string {
  const p = linkParams(initial);
  if (!p) return SITE_URL;
  return SITE_URL + '?' + Object.entries(p).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}

const ignore = () => undefined;
const impact = (style: Haptics.ImpactFeedbackStyle) => void Haptics.impactAsync(style).catch(ignore);
const notify = (type: Haptics.NotificationFeedbackType) => void Haptics.notificationAsync(type).catch(ignore);
const later = (ms: number, fn: () => void) => { setTimeout(fn, ms); };

/** Web'in titreşim dili → iOS/Android titreşim motoru. Anlamlı adlar hissin kendisini taşır. */
function haptic(p: number | number[] | HapticName): void {
  if (typeof p === 'string') {
    switch (p) {
      case 'error': notify(Haptics.NotificationFeedbackType.Error); return;
      case 'warning': notify(Haptics.NotificationFeedbackType.Warning); return;
      case 'success': notify(Haptics.NotificationFeedbackType.Success); return;
      // Yayın bağlandı: yumuşak vuruş + 70 ms sonra hafif ikinci vuruş (kalp atışı)
      case 'connect': impact(Haptics.ImpactFeedbackStyle.Soft); later(70, () => impact(Haptics.ImpactFeedbackStyle.Light)); return;
      // Şehre varış: küre yerine oturdu — sert, kısa tek vuruş
      case 'arrive': impact(Haptics.ImpactFeedbackStyle.Rigid); return;
      // Küre/rozet açıldı: başarı + iki yükselen vuruş
      case 'unlock': notify(Haptics.NotificationFeedbackType.Success); later(160, () => impact(Haptics.ImpactFeedbackStyle.Light)); later(260, () => impact(Haptics.ImpactFeedbackStyle.Medium)); return;
      case 'double': impact(Haptics.ImpactFeedbackStyle.Light); later(60, () => impact(Haptics.ImpactFeedbackStyle.Light)); return;
      default: return;
    }
  }
  // Eski dizi biçimi (güncellenmemiş sayfa): başarı sayılır
  if (Array.isArray(p)) { notify(Haptics.NotificationFeedbackType.Success); return; }
  if (p <= 6) void Haptics.selectionAsync().catch(ignore);
  else if (p <= 10) impact(Haptics.ImpactFeedbackStyle.Light);
  else impact(Haptics.ImpactFeedbackStyle.Medium);
}

async function shareCard(m: ShareMessage): Promise<void> {
  const b64 = /^data:image\/jpeg;base64,(.+)$/.exec(m.image)?.[1];
  const file = b64 && FS.cacheDirectory ? `${FS.cacheDirectory}wglobe-paylas.jpg` : null;
  if (file && b64) { try { await FS.writeAsStringAsync(file, b64, { encoding: FS.EncodingType.Base64 }); } catch { /* görselsiz paylaşılır */ } }
  if (Platform.OS === 'ios') {
    // iOS: görsel + metin + bağlantı tek paylaşım menüsünde
    await Share.share(file ? { url: file, message: `${m.text}\n${m.url}` } : { message: `${m.text}\n${m.url}` }).catch(() => undefined);
    return;
  }
  // Android: görsel paylaşılır (bağlantı kartın üstünde yazılı); görsel yoksa metin + bağlantı
  if (file && (await Sharing.isAvailableAsync().catch(() => false))) {
    await Sharing.shareAsync(file, { mimeType: 'image/jpeg', dialogTitle: m.text }).catch(() => undefined);
  } else {
    await Share.share({ message: `${m.text}\n${m.url}` }).catch(() => undefined);
  }
}

export default function WGlobeShell() {
  const insets = useSafeAreaInsets();
  const web = useRef<WebView>(null);
  const radio = useRef<NativeRadio | null>(null);
  const canGoBack = useRef(false);
  const initialUrl = Linking.useLinkingURL();
  const [uri] = useState(() => startUri(initialUrl));
  const [phase, setPhase] = useState<'loading' | 'ready' | 'offline'>('loading');
  const [reloadKey, setReloadKey] = useState(0);
  const cover = useRef(new Animated.Value(1)).current;

  /** Yerel → web */
  const toWeb = useCallback((msg: NativeMessage) => {
    const js = `window.wglobeNative && window.wglobeNative(${JSON.stringify(JSON.stringify(msg))}); true;`;
    web.current?.injectJavaScript(js);
  }, []);

  // Radyolu alarm: bildirime dokunulunca web güneşin doğduğu şehri çalar. Uygulama bildirimle sıfırdan açıldıysa
  // mesaj sayfa yüklenene kadar bekletilir (web tarafı ayrıca açılış animasyonunun bitmesini bekler).
  const pendingAlarm = useRef(false);
  const pageReady = useRef(false);
  useEffect(() => {
    void configureAlarm();
    const fire = () => { if (pageReady.current) toWeb({ type: 'alarm:fire' }); else pendingAlarm.current = true; };
    const sub = Notifications.addNotificationResponseReceivedListener((r) => { if (isAlarmResponse(r)) fire(); });
    void Notifications.getLastNotificationResponseAsync().then((r) => {
      // Yalnız yeni dokunuş (son 2 dk): eski bir alarm her açılışta yeniden çalmasın
      if (isAlarmResponse(r) && r && Date.now() - r.notification.date < 120000) { fire(); void Notifications.clearLastNotificationResponseAsync().catch(() => undefined); }
    }).catch(() => undefined);
    return () => sub.remove();
  }, [toWeb]);

  useEffect(() => {
    void NativeRadio.configure();
    radio.current = new NativeRadio(toWeb);
    return () => { radio.current?.destroy(); radio.current = null; };
  }, [toWeb]);

  // Uygulama açıkken gelen paylaşım bağlantısı: o şehre git
  const handled = useRef<string | null>(initialUrl);
  useEffect(() => {
    if (!initialUrl || initialUrl === handled.current) return;
    handled.current = initialUrl;
    const p = linkParams(initialUrl);
    if (p) toWeb({ type: 'link', params: p });
  }, [initialUrl, toWeb]);

  // Android geri tuşu: önce web içinde geri, sonra uygulamadan çık
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (canGoBack.current) { web.current?.goBack(); return true; }
      return false;
    });
    return () => sub.remove();
  }, []);

  // Yükleme örtüsü: arayüz hazır olunca 420 ms'de söner (beyaz bir kare asla görünmez)
  useEffect(() => {
    if (phase !== 'ready') return;
    Animated.timing(cover, { toValue: 0, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [phase, cover]);

  const onMessage = useCallback((e: WebViewMessageEvent) => {
    const m = parseWebMessage(e.nativeEvent.data);
    if (!m) return;
    const r = radio.current;
    switch (m.type) {
      case 'audio:load': void r?.load(m); break;
      case 'audio:skipTo': r?.skipTo(m.loadId, m.index); break;
      case 'audio:pause': r?.pause(m.loadId); break;
      case 'audio:volume': r?.setVolume(m.v); break;
      case 'audio:art': void r?.setArtwork(m.loadId, m.artwork); break;
      case 'audio:nowplaying': r?.nowPlaying(m.loadId, m.index, m.title); break;
      case 'haptic': haptic(m.p); break;
      case 'share': void shareCard(m); break;
      case 'alarm:set': void setAlarm(m, toWeb); break;
    }
  }, [toWeb]);

  const retry = () => { setPhase('loading'); cover.setValue(1); setReloadKey((k) => k + 1); };

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <StatusBar style="light" />
      <NativeWebView
        key={reloadKey}
        ref={web}
        source={{ uri }}
        style={styles.web}
        containerStyle={styles.web}
        originWhitelist={['https://*']}
        javaScriptEnabled
        domStorageEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        allowsBackForwardNavigationGestures={false}
        bounces={false}
        overScrollMode="never"
        pullToRefreshEnabled={false}
        setSupportMultipleWindows={false}
        textZoom={100}
        webviewDebuggingEnabled={__DEV__}
        onMessage={onMessage}
        onLoadEnd={() => {
          setPhase((p) => (p === 'offline' ? p : 'ready'));
          pageReady.current = true;
          if (pendingAlarm.current) { pendingAlarm.current = false; setTimeout(() => toWeb({ type: 'alarm:fire' }), 600); }
        }}
        onError={() => setPhase('offline')}
        onHttpError={(e) => { if (e.nativeEvent.statusCode >= 500 || e.nativeEvent.url.replace(/[?#].*$/, '') === SITE_URL) setPhase('offline'); }}
        onNavigationStateChange={(s) => { canGoBack.current = s.canGoBack; }}
        onShouldStartLoadWithRequest={(req) => {
          // Site içinde kal; dış bağlantılar sistem tarayıcısında açılır
          if (req.url.startsWith(SITE_ORIGIN) || req.url.startsWith('about:') || req.url.startsWith('blob:') || req.url.startsWith('data:')) return true;
          void Linking.openURL(req.url).catch(() => undefined);
          return false;
        }}
      />
      <Animated.View pointerEvents={phase === 'ready' ? 'none' : 'auto'} style={[StyleSheet.absoluteFill, styles.cover, { opacity: cover }]}>
        <Text style={styles.logo}>w<Text style={styles.logoAccent}>Globe</Text></Text>
        {phase === 'offline' ? (
          <View style={styles.offline}>
            <Text style={styles.offTitle}>Bağlantı yok</Text>
            <Text style={styles.offBody}>Dünyanın radyolarına ulaşmak için internet gerekiyor.</Text>
            <Pressable onPress={retry} style={({ pressed }) => [styles.retry, pressed && { opacity: 0.6 }]} accessibilityRole="button">
              <Text style={styles.retryText}>Tekrar dene</Text>
            </Pressable>
          </View>
        ) : (
          <ActivityIndicator color="#CFE5FF" style={styles.spinner} />
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  web: { flex: 1, backgroundColor: BG },
  cover: { backgroundColor: BG, alignItems: 'center', justifyContent: 'center' },
  logo: { color: '#F2F7FF', fontSize: 34, fontWeight: '800', letterSpacing: -1.5 },
  logoAccent: { color: '#A9D3FF' },
  spinner: { marginTop: 28 },
  offline: { marginTop: 28, alignItems: 'center', paddingHorizontal: 32, gap: 10 },
  offTitle: { color: '#F2F7FF', fontSize: 20, fontWeight: '700' },
  offBody: { color: 'rgba(232,240,255,0.66)', fontSize: 15, lineHeight: 21, textAlign: 'center' },
  retry: { marginTop: 14, paddingHorizontal: 28, minHeight: 48, borderRadius: 24, backgroundColor: '#DCEEFF', justifyContent: 'center' },
  retryText: { color: '#061226', fontSize: 16, fontWeight: '700' },
});
