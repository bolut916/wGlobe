# Geliştiriciye destek (bahşiş) — mağaza kurulumu

Uygulamadaki **Ayarlar → wGlobe'u destekle** kartı üç bahşiş sunar. Kod hazır; ürünlerin App Store Connect ve
Google Play Console'da **birebir aynı kimliklerle** tanımlanması gerekir. Ürün bulunamazsa kart "Mağazaya şu an
ulaşılamıyor" der ve uygulama başka hiçbir yerde etkilenmez.

| Kimlik (iki mağazada aynı) | Tür | Görünen ad (TR / EN) | Önerilen fiyat |
|---|---|---|---|
| `com.wglobe.app.tip.song`  | Tüketilebilir (Consumable) | Bir şarkı / A song | 0,99 USD seviyesi |
| `com.wglobe.app.tip.album` | Tüketilebilir (Consumable) | Bir albüm / An album | 2,99 USD seviyesi |
| `com.wglobe.app.tip.night` | Tüketilebilir (Consumable) | Bir yayın gecesi / A night on air | 6,99 USD seviyesi |

Fiyatları uygulama yazmaz; mağaza her ülkede yerel para birimi ve vergiyle gösterir.

## Neden bu yol (inceleme kuralları)

- **App Store 3.1.1:** "Apps may use in-app purchase currencies to enable customers to "tip" the developer or
  digital content providers in the app." → Bahşiş, uygulama içi satın alma (IAP) ile alınır.
- Dış ödeme bağlantısı (PayPal, Buy Me a Coffee vb.) **yoktur**. ABD dışındaki mağazalarda yasak; ABD'de serbest
  olsa da tek, küresel ve risksiz yol IAP'dir.
- Bahşişler **tüketilebilir**: tekrar verilebilir, hiçbir özelliği açmaz, "Satın alımları geri yükle" gerekmez.
  Kartta açıkça yazar: "Bahşişler isteğe bağlıdır ve hiçbir özelliği açmaz".
- Hesap gerekmez: misafir kullanıcı da bahşiş verebilir.
- Google Play: dijital içerik/geliştiriciye ödeme Google Play Faturalandırma ile alınır (aynı tüketilebilir ürünler).
- Uygulama hiçbir satın alma verisini sunucuya göndermez; teşekkür sayacı yalnız cihazda tutulur.

## 1. App Store Connect

1. **Business (İş) → Agreements:** "Paid Apps" sözleşmesi, banka ve vergi bilgileri **Active** olmalı.
   (Ücretsiz uygulamada bile IAP için zorunlu.)
2. **Uygulama → Monetization → In-App Purchases → (+)**, tür **Consumable**. Her biri için:
   - Reference Name: `Bahşiş · Bir şarkı` (yalnız sende görünür)
   - Product ID: tablodaki kimlik (sonradan değiştirilemez)
   - Price: tablodaki seviye
   - Localizations — Türkçe: Ad "Bir şarkı", açıklama "wGlobe'a küçük bir bahşiş. Hiçbir özelliği açmaz."
     İngilizce: "A song" / "A small tip for wGlobe. Doesn't unlock anything."
   - **Review Information → Screenshot:** `docs/appstore/iap-review-tr.png` (ya da `-en`)
   - Review Notes: "Tip jar: Settings (gear icon on the Profile tab) → Support wGlobe. Consumable tips, they
     unlock no features."
3. **İlk IAP'ler yeni bir uygulama sürümüyle birlikte gönderilir:** sürüm sayfasında "In-App Purchases and
   Subscriptions" bölümünden üç ürünü seç, sonra sürümü incelemeye gönder.
4. **App Privacy:** değişiklik gerekmez (satın alma bilgisi toplanmıyor; ödemeyi Apple işler).
5. (Önerilir) **App Store Small Business Program**'a başvur: yıllık 1 M USD altında komisyon %15.
6. **Test:** Users and Access → Sandbox → test hesabı oluştur; TestFlight derlemesinde Ayarlar'dan bahşiş ver.
   Sandbox'ta para çekilmez.

App Group (`group.com.wglobe.app`, widget için) ve In-App Purchase yeteneği EAS derlemesinde otomatik eklenir.

## 2. Google Play Console

1. **Ödeme profili / satıcı hesabı** kurulu olmalı (Setup → Payments profile).
2. Ürün oluşturabilmek için önce **faturalandırma izni içeren bir derleme** (bu sürüm) bir test kanalına
   (Internal testing) yüklenmelidir. İzin, `expo-iap` tarafından otomatik eklenir.
3. **Monetize → Products → One-time products → Create:** kimlik tablodaki ile aynı, ad/açıklama TR ve EN,
   fiyat; **Activate**. (Tüketme işlemini uygulama yapar; Play'de ayrıca "consumable" seçeneği yoktur.)
4. **Settings → License testing:** kendi Gmail adresini test kullanıcısı yap; test satın alımları ücretsiz olur.
5. Google'ın hizmet ücreti: ilk 1 M USD için %15.

## 3. Uygulamanın davranışı (kontrol listesi)

- Ayarlar açılınca ürünler mağazadan istenir; fiyatlar gelene kadar iskelet görünür.
- Bahşişe dokununca mağaza penceresi açılır; aynı anda ikinci satın alma başlatılamaz.
- **Başarı:** kalp yükselir, kıvılcımlar dağılır, "Desteğin için teşekkürler" satırı görünür, titreşim.
- **Vazgeçme:** sessizce geri döner. **Hata:** kısa sallanma + bildirim.
- **Onay bekliyor** (Ask to Buy / Android bekleyen ödeme): bildirim; onaylanınca bir sonraki açılışta teşekkür.
- Satın alma sırasında uygulama kapanırsa işlem bir sonraki açılışta tamamlanır ve tüketilir (Android'de
  tüketilmeyen satın alma 3 gün sonra iade edilir — bu yüzden her işlem mutlaka bitirilir).
- Web sitesinde (tarayıcıda) ödeme yoktur; kart "Bahşiş yalnızca uygulamada" der.

Kod: `src/shell/Tips.ts` (yerel), `src/shell/bridge.ts` (`TIP_SKUS`, mesaj doğrulama),
`prototype/index.html` → `TipJar` (kart ve hareket).
