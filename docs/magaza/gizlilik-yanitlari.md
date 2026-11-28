# Gizlilik formları: App Store "App Privacy" + Google Play "Data safety"

Bu yanıtlar uygulamanın gerçek veri akışından çıkarıldı (Supabase şeması: `supabase/migrations/`, gizlilik
politikası: `prototype/privacy/`). Uygulama değişirse burayı ve politikayı birlikte güncelle.

## Veri akışının özeti

| Veri | Ne zaman | Nereye | Kimliğe bağlı mı |
|---|---|---|---|
| E-posta, şifre (Supabase'de karma olarak) | Yalnız hesap açılırsa | Supabase (AB, Frankfurt) | Evet |
| Kullanıcı kimliği (UUID) | Yalnız hesap açılırsa | Supabase | Evet |
| Favori istasyonlar, ziyaret edilen şehirler, kaydedilen şarkılar, açılan küreler, tercihler, dinleme süresi | Yalnız hesap açılırsa (eşitleme) | Supabase | Evet |
| Çalan istasyonun yayın adresi (şarkı adını okumak için) | Bir istasyon çalarken, herkes için | Supabase Edge Function, kaydedilmez | Hayır |
| Seçilen şehrin koordinatı (hava durumu) | Şehir açılınca | Open-Meteo | Hayır (kullanıcının konumu değil) |
| İstasyon araması | Şehir açılınca | Radio Browser | Hayır |
| Bahşiş ödemesi | Kullanıcı isterse | Apple / Google (uygulama sunucuya bir şey göndermez) | Uygulama toplamaz |

Yok olanlar: reklam, analiz/istatistik SDK'sı, çökme raporlama, konum izni, takip (tracking), reklam kimliği,
kişiler, fotoğraflar, mikrofon.

---

## App Store Connect → App Privacy

**Data Collection:** "Yes, we collect data from this app"

| Kategori → Tür | Kullanım amacı (Purpose) | Kimliğe bağlı (Linked to user) | Takip (Tracking) |
|---|---|---|---|
| Contact Info → **Email Address** | App Functionality | Yes | No |
| Identifiers → **User ID** | App Functionality | Yes | No |
| Usage Data → **Product Interaction** (favoriler, ziyaretler, dinleme süresi) | App Functionality | Yes | No |
| User Content → **Other User Content** (kaydedilen şarkılar, açılan küreler, tercihler) | App Functionality | Yes | No |

İşaretlenmeyecekler: Location, Purchases (bahşişi Apple işler, uygulama kaydetmez), Diagnostics, Browsing/Search
History (aramalar sunucuda saklanmaz), Device ID, Advertising Data.

- **Privacy Policy URL:** `https://wglobe.app/privacy/` (alan adı bağlanana kadar `https://bolut916.github.io/wGlobe/privacy/`)
- **User Privacy Choices URL (isteğe bağlı):** `https://wglobe.app/delete-account/`
- Apple, hesap açılabilen her uygulamada **uygulama içinden hesap silme** ister (5.1.1(v)): alt çubuktaki Ayarlar
  sekmesi → Hesabı sil. Hazır.

## Google Play Console → App content → Data safety

**Does your app collect or share any of the required user data types?** Yes

**Is all of the user data collected by your app encrypted in transit?** Yes (yalnız HTTPS; `usesCleartextTraffic: false`)

**Which of the following methods of account creation does your app support?** Username and password (e-posta + şifre)

**Delete account URL:** `https://wglobe.app/delete-account/`
(alan adı bağlanana kadar `https://bolut916.github.io/wGlobe/delete-account/`)

**Do you provide a way for users to request that some or all of their data is deleted, without requiring them to
delete their account?** Yes (favoriler ve kayıtlar uygulama içinden tek tek silinebilir). Emin değilsen No de;
hesap silme zaten zorunlu olan kısım.

| Veri türü | Collected | Shared | İsteğe bağlı mı (optional) | Amaç |
|---|---|---|---|---|
| Personal info → **Email address** | Yes | No | Yes (misafir modu var) | Account management, App functionality |
| Personal info → **User IDs** | Yes | No | Yes | Account management, App functionality |
| App activity → **App interactions** (favoriler, ziyaretler, dinleme süresi) | Yes | No | Yes | App functionality |
| App activity → **Other user-generated content** (kaydedilen şarkılar, tercihler) | Yes | No | Yes | App functionality |

"Shared" hep **No**: Supabase, Open-Meteo ve Radio Browser bizim adımıza hizmet veren işleyicilerdir (service
provider); Google'ın tanımına göre bu paylaşım sayılmaz. Bahşişte ödeme bilgisini Google Play işler; uygulama
toplamaz, beyan edilmez.

Ephemeral (geçici) işlenen ve beyan gerekmeyen: şarkı adı için gönderilen yayın adresi, hava durumu için şehir
koordinatı.

## İki mağazada ortak diğer formlar

- **Reklam içeriyor mu?** Hayır.
- **Hedef kitle:** 13 yaş ve üzeri (Play "Target audience": 13–15, 16–17, 18+). 13 yaş altını seçme: o zaman
  "Families" politikası devreye girer ve radyo yayınları denetlenemez.
- **Yaş derecelendirmesi:** Radyo yayınlarını uygulama denetlemez (şarkı sözleri, haber, sohbet). Dürüst yanıt:
  - Apple: "Profanity or Crude Humor" → **Infrequent/Mild**, "Mature or Suggestive Themes" → **Infrequent/Mild**,
    diğerleri None. "Unrestricted Web Access" → **No** (uygulama tarayıcı değildir; dış bağlantılar sistem
    tarayıcısında açılır). Beklenen sonuç 13+ civarı.
  - Google (IARC anketi): kategori olarak oyun dışı / müzik-radyo uygulamasına en yakın seçenek; "kullanıcılar
    birbiriyle etkileşebilir mi" **Hayır**, "dijital ürün satın alınabilir mi" **Evet** (bahşiş); küfür/argo
    sorusunda radyo yayınları için dürüstçe "hafif, seyrek" seçeneği.
- **Şifreleme (export compliance):** `ITSAppUsesNonExemptEncryption = false` app.json'da tanımlı; Apple her
  yüklemede sormaz. (Yalnız standart HTTPS kullanılıyor.)
- **Üçüncü taraf içerik (Apple, Content Rights):** "Does your app contain, show, or access third-party content?" →
  **Yes**. Uygulama, istasyonların kendi herkese açık yayınlarını oynatır ve açık Radio Browser dizinini kullanır;
  içerik barındırmaz. Bu soruya "haklara sahibim" demek senin beyanındır; emin değilsen bir hukukçuya danış.
