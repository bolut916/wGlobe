/**
 * wGlobe hareket sistemi — tek doğruluk kaynağı.
 *
 * Felsefe: wGlobe bir "dinleme yolculuğu". Hareket heyecandan çok
 * SAKİN MERAK uyandırmalı: küre ağır, fiziksel ve güvenilir; UI katmanı
 * hafif, kısa ve geri planda. Hiçbir süre rastgele değil:
 *
 *  ┌──────────────┬──────────────┬─────────────────────────────────────┐
 *  │ Katman       │ Süre         │ Kullanım                            │
 *  ├──────────────┼──────────────┼─────────────────────────────────────┤
 *  │ micro        │ 100–200 ms   │ press, hover, toggle, ikon değişimi │
 *  │ standard     │ 200–400 ms   │ kart, sheet, modal, sekme içeriği   │
 *  │ sequence     │ 400 ms +     │ sayfa, açılış koreografisi, küre    │
 *  └──────────────┴──────────────┴─────────────────────────────────────┘
 *
 * Tüm UI animasyonları yalnızca transform + opacity üzerinde çalışır.
 */

export const DURATION = {
  /** Basılma geri bildirimi (scale 0.96) — parmağın altında anında hissedilmeli */
  press: 100,
  /** Basılmanın bırakılması; follow-through için press'ten biraz uzun */
  release: 160,
  /** Toggle / ikon çapraz geçişi */
  toggle: 180,
  /** Hata sallanması (tek döngü) */
  shake: 200,
  /** Kart girişi, liste öğesi */
  card: 280,
  /** Bottom sheet açılışı */
  sheetOpen: 360,
  /** Bottom sheet kapanışı — çıkış girişten kısa: kullanıcı "gitti" dediğinde beklemez */
  sheetClose: 240,
  /** Modal / tam ekran katman */
  modal: 320,
  /** Ekran (route) geçişi */
  page: 450,
  /** Açılış (welcome) koreografisinin toplam süresi */
  intro: 1200,
  /** Küreyi seçilen şehre döndürme (lerp tabanlı, yaklaşık yerleşme süresi) */
  globeFocus: 900,
  /** Radyo ses yükselmesi (fade-in) */
  audioFadeIn: 600,
  /** İstasyon değişiminde ses çapraz geçişi */
  audioCrossfade: 400,
  /** Küre teması değişiminde shader renklerinin morf süresi */
  themeMorph: 700,
  /** Küre ilk karesinden sonra GLView'in belirme süresi (siyah flaşı gizler) */
  globeReveal: 600,
  /** Aktif şehir halkasının bir nabız döngüsü */
  pulseLoop: 1600,
  /** Canlı yayın noktasının nefes döngüsü */
  breathe: 1200,
  /** Ambiyans dönüşünün yumuşakça hızlanma süresi (slow-in) */
  idleRampIn: 1200,
} as const;

/** Kademeli giriş gecikmeleri (stagger) */
export const STAGGER = {
  /** Liste öğeleri arası */
  list: 50,
  /** Kartlar arası (daha büyük kütle → daha geniş aralık) */
  card: 70,
  /** Hero → ikincil bileşen başlama gecikmesi */
  heroToSecondary: 160,
  /** Sheet içindeki satırlar (şehir adı → saat → hava → kontroller) */
  sheetRows: 45,
  /** Liste staggers'ının üst sınırı: 8. öğeden sonrası beklemez */
  maxItems: 8,
} as const;

/**
 * Cubic-bezier eğrileri [x1, y1, x2, y2].
 * Reanimated: Easing.bezier(...EASING.standard)
 * CSS:        cubic-bezier(0.2, 0, 0, 1)
 */
export const EASING = {
  /** Varsayılan: hızlı başla, yumuşak yerleş (slow-out) */
  standard: [0.2, 0, 0, 1] as const,
  /** Ekrana giren eleman: belirgin deceleration */
  enter: [0.05, 0.7, 0.1, 1] as const,
  /** Ekrandan çıkan eleman: hızlanarak ayrıl (slow-in) */
  exit: [0.3, 0, 0.8, 0.15] as const,
  /** Simetrik — döngüsel, nefes alan hareketler (canlı göstergesi) */
  inOut: [0.65, 0, 0.35, 1] as const,
  /** Basılma: neredeyse lineer, gecikmesiz */
  press: [0.4, 0, 1, 1] as const,
};

/** Spring konfigürasyonları (Reanimated withSpring ile birebir) */
export const SPRING = {
  /** Buton bırakma — küçük overshoot ile follow-through */
  button: { damping: 15, stiffness: 320, mass: 0.6 },
  /** Bottom sheet — ağır ama yaylı; "fiziksel bir kart" hissi */
  sheet: { damping: 22, stiffness: 220, mass: 0.9 },
  /** Kart / chip seçimi */
  gentle: { damping: 18, stiffness: 180, mass: 1 },
  /** Pin vurgusu — canlı bir "pop" */
  pop: { damping: 10, stiffness: 260, mass: 0.5 },
} as const;

/** Küre fiziği — InteractiveGlobe bu değerleri doğrudan kullanır */
export const GLOBE_PHYSICS = {
  /** Her karede hız *= damping → ağır, eylemsiz dönüş */
  damping: 0.95,
  /** Piksel → radyan dönüşüm katsayısı (sürükleme hassasiyeti) */
  dragSensitivity: 0.005,
  /** Bu hızın altındaki dönüş durmuş sayılır (rad/kare) */
  minVelocity: 0.0001,
  /** Hız tavanı: fırlatma ne kadar sert olursa olsun kontrol kaybolmaz */
  maxVelocity: 0.12,
  /** Seçilen şehre odaklanırken kare başına lerp katsayısı */
  focusLerp: 0.085,
  /** Odak hedefi bu açı farkının altına inince tamamlanmış sayılır (rad) */
  focusEpsilon: 0.0015,
  /** Haptics.selectionAsync() tetikleme adımı (derece) */
  hapticStepDeg: 15,
  /** Art arda haptik arası minimum süre — motoru boğmamak için (ms) */
  hapticMinIntervalMs: 40,
  /** Kimse dokunmadığında ambiyans dönüşü (rad/kare) */
  idleSpin: 0.0009,
  /** Son etkileşimden sonra ambiyans dönüşünün başlama gecikmesi (ms) */
  idleResumeDelayMs: 4000,
  /** Kutup dönüşünü sınırlar — küre takla atmaz */
  maxPitch: Math.PI / 2.4,
  /** Tap olarak sayılması için maksimum parmak hareketi (px) */
  tapSlop: 8,
  /** Tap olarak sayılması için maksimum süre (ms) */
  tapMaxDurationMs: 250,
} as const;

/** Uyku zamanlayıcısı fade-out süresi: son 30 saniyede ses yavaşça kısılır */
export const SLEEP_FADE_MS = 30_000;
