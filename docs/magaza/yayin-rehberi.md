# wGlobe yayın rehberi: alan adından mağazaya

Kod ve belgeler hazır. Aşağıdaki adımları **senin** yapman gerekiyor: hesaplar, ödemeler ve kimlik doğrulama başkası
adına yapılamaz. Her adımın sonunda bana haber verdiğin noktalar **"→ Claude"** ile işaretli.

**Sıra neden böyle:** Google, yeni kişisel geliştirici hesaplarında üretime çıkmadan önce **12 test kullanıcısının
14 gün kesintisiz** kapalı testte kalmasını istiyor. En uzun bekleme bu, o yüzden Google hesabı en başta.

---

## 1. Alan adı: wglobe.app (bugün, ~15 dk)

1. **Satın al:** Cloudflare Registrar önerilir (aracı kâr eklemez, DNS ve e-posta yönlendirme aynı yerde).
   Başka bir kayıt şirketi de olur.
2. **`.app` uzantısı yalnız HTTPS ile açılır** (tarayıcılara gömülü HSTS). Sertifika çıkana kadar site
   görünmez. Bu normal, aşağıdaki 4. adımdan sonra kendiliğinden düzelir.
3. **DNS kayıtları** (Cloudflare'de bulut simgesi **gri / DNS only** olmalı; turuncu olursa GitHub sertifika
   veremez):

   | Tür | Ad | Değer |
   |---|---|---|
   | A | `@` | `185.199.108.153` |
   | A | `@` | `185.199.109.153` |
   | A | `@` | `185.199.110.153` |
   | A | `@` | `185.199.111.153` |
   | AAAA | `@` | `2606:50c0:8000::153` |
   | AAAA | `@` | `2606:50c0:8001::153` |
   | AAAA | `@` | `2606:50c0:8002::153` |
   | AAAA | `@` | `2606:50c0:8003::153` |
   | CNAME | `www` | `bolut916.github.io` |

4. **→ Claude:** "Alan adı hazır" de. Ben şunları yaparım:
   - GitHub Pages'e özel alan adını bağlarım.
   - Uygulamadaki ve kabuktaki adresleri `https://wglobe.app/` yaparım.
   - Eski `github.io` adreslerini yeni adrese yönlendiririm.
   - Testleri çalıştırırım.

   Sonra GitHub'da *Settings → Pages → Enforce HTTPS* kutusunu işaretlersin (sertifika çıkınca açılır,
   genelde 15 dk – 1 saat).
5. **Destek e-postası:** Cloudflare → alan adı → *Email → Email Routing*.
   - `destek@wglobe.app` adresini kendi gelen kutuna yönlendir.
   - Cloudflare MX/TXT kayıtlarını kendisi ekler.
   - Bu adres gizlilik ve destek sayfalarında yazıyor; mağazalar da çalıştığını kontrol eder.

## 2. Hesap e-postaları: özel SMTP (alan adından sonra, ~20 dk)

Supabase'in yerleşik e-posta servisi yalnız proje ekibinin adreslerine ve saatte birkaç e-posta gönderir. Gerçek
kullanıcılar kayıt onayı alamaz.

1. Resend, Postmark veya Amazon SES gibi bir servise kaydol. Resend'in ücretsiz katmanı başlangıç için yeter.
2. Alan adını doğrula: servisin verdiği SPF/DKIM kayıtlarını Cloudflare DNS'e ekle.
3. Supabase → *Authentication → Emails → SMTP Settings*:
   - Gönderen: `wGlobe <no-reply@wglobe.app>`
   - Servisin verdiği sunucu, port ve şifre
4. Supabase → *Authentication → URL Configuration*:
   - **Site URL:** `https://wglobe.app/`
   - **Redirect URLs:** `https://wglobe.app/**` ekle. Geçiş bitene kadar eski `github.io` satırını silme.
5. **→ Claude:** "SMTP hazır" de. Gerçek bir kayıtla onay e-postasını uçtan uca test ederim.

## 3. Google Play geliştirici hesabı (bugün başlat)

1. <https://play.google.com/console/signup>: **kişisel hesap** (Personal), tek seferlik 25 USD.
2. Kimlik doğrulaması istenir (kimlik belgesi + adres). Onay birkaç gün sürebilir.
3. Onay gelince: *Create app*.
   - Ad: `wGlobe: Dünya Radyosu`
   - Varsayılan dil: Türkçe
   - Tür: App
   - Fiyat: Free
4. **12 test kullanıcısı bul:** arkadaş, aile; her birinin Gmail adresi gerekir. 14 gün boyunca testten
   çıkmamaları gerekiyor.

> Şirket (Organization) hesabıyla açarsan 12 kişi / 14 gün kuralı yok, ama D-U-N-S numarası gerekir.

## 4. Apple Developer Program (bugün başlat)

1. <https://developer.apple.com/programs/enroll/>: **Individual** (bireysel), yıllık 99 USD.
   - Apple kimliğinde iki adımlı doğrulama açık olmalı.
   - Mağazada satıcı adı olarak **kendi adın** görünür. "wGlobe" görünsün istersen şirket hesabı ve D-U-N-S
     gerekir.
2. Onay genelde 1–2 gün.
3. Onay gelince **App Store Connect → Business**: "Paid Apps" sözleşmesi, banka ve vergi formları. Uygulama
   ücretsiz olsa da bahşiş (uygulama içi satın alma) için zorunlu.

## 5. Expo / EAS: bulutta derleme (Mac gerekmez)

1. <https://expo.dev/signup> ücretsiz hesap aç.
2. Bilgisayarında (Node.js kurulu olmalı) depo klasöründe:
   ```bash
   npm install
   npx eas-cli@latest login
   npx eas-cli@latest init        # app.json'a projectId ekler; oluşan değişikliği bana gönder ya da commit'le
   ```
3. **→ Claude:** `eas init` sonucunu (app.json'daki `extra.eas.projectId` satırı) gönder; depoya işlerim.
4. iOS derlemesi:
   ```bash
   npx eas-cli@latest build -p ios --profile production
   ```
   EAS, Apple hesabına girmeni ister. Sertifika, profil, App Group ve uygulama içi satın alma yeteneğini kendisi
   oluşturur.
5. Android derlemesi:
   ```bash
   npx eas-cli@latest build -p android --profile production
   ```
   Çıkan `.aab` dosyasını Play Console'a yükleyeceksin.

## 6. Google Play'e yükleme

1. *Testing → Internal testing → Create release* → `.aab` yükle. Kendi hesabınla dene.
2. *Monetize → Products → One-time products*: üç bahşiş (`docs/bahsis-kurulumu.md`, kimlikler birebir aynı).
3. *App content* formları (yanıtlar `docs/magaza/gizlilik-yanitlari.md` dosyasında):

   | Form | Yanıt |
   |---|---|
   | Privacy policy | `https://wglobe.app/privacy/` |
   | Ads | No |
   | App access | "All functionality is available without special access" (misafir modu) |
   | Content rating | IARC anketi |
   | Target audience | 13+ |
   | News app | No |
   | Data safety | gizlilik-yanitlari.md'deki tablo |
   | **Foreground service** | `FOREGROUND_SERVICE_MEDIA_PLAYBACK`: "Media playback", açıklama: "Plays the live radio station the user started, in the background and from the lock screen." İstenen kısa video: uygulamada bir şehir çal, ana ekrana dön, ses sürüyor, kilit ekranı kontrolleri görünüyor (30 sn yeter). |

4. *Store listing*:
   - Metinler: `docs/magaza/metinler.md`
   - Simge (512×512): `docs/magaza/simge-512.png`
   - Öne çıkan görsel (1024×500): `docs/magaza/ekran/tr/play-feature-1024x500.jpg` (EN: `en/`)
   - Telefon ekran görüntüleri (1080×2160): `docs/magaza/ekran/tr/play-1…5.jpg` (EN: `en/`). Play, uzun kenarı
     kısa kenarın 2 katından fazla olan görüntüyü kabul etmez; iPhone görüntüleri bu yüzden ayrı.
5. *Testing → Closed testing*: 12 kişinin e-postasıyla liste oluştur, katılım bağlantısını gönder, **14 gün**
   bekle.
6. 14 gün dolunca *Dashboard → Apply for production* formu (testte ne öğrendin, kısa yanıtlar), sonra üretim
   sürümü.

## 7. App Store'a gönderme

1. App Store Connect → *Apps → (+) New App*:
   - Platform: iOS
   - Ad: `wGlobe – Dünya Radyosu`
   - Birincil dil: Türkçe
   - Bundle ID: `com.wglobe.app`
   - SKU: `wglobe-ios`
2. İngilizce yerelleştirmeyi ekle (*App Information → Localizable Information → English (U.S.)*). İki dilde
   metinler: `docs/magaza/metinler.md`
3. **6,9" ekran görüntüleri** (1320×2868): `docs/magaza/ekran/tr/appstore-6.9-1…5.jpg` ve `en/` karşılıkları. Apple bunlardan
   küçük ekranları kendisi üretir.
4. *App Privacy*, *Age Rating*, *Content Rights*: `docs/magaza/gizlilik-yanitlari.md`
5. Kategori: **Music** (ikincil: Travel). Fiyat: Free.
6. Uygulama içi satın almalar: `docs/bahsis-kurulumu.md`. İlk sürümle birlikte seçilip gönderilir.
7. Derlemeyi gönder:
   ```bash
   npx eas-cli@latest submit -p ios --latest
   ```
   Derleme birkaç dakika sonra *TestFlight*'ta görünür. Önce kendi telefonunda TestFlight ile dene.
8. **App Review Information**:
   - Sign-in required: **No**. Notes:
     ```text
     No login is needed: tap "Continue as guest" on the first screen. Spin the globe and tap any city dot to play
     its live radio. Optional account (email + password) only syncs favorites between devices; it can be deleted
     in Profile → Settings (gear) → Delete account.
     Tip jar: Profile → Settings → Support wGlobe (consumable tips, they unlock nothing).
     Radio streams are public broadcasts from the stations, listed via the open Radio Browser directory.
     Background audio is used only to keep playing the station the user started.
     ```
   - İletişim bilgileri: adın, telefonun, `destek@wglobe.app`
9. *Add for Review → Submit*. İnceleme genelde 24–48 saat.

## Benden bekleyenler (→ Claude)

| Ne zaman | Ne yaparım |
|---|---|
| Alan adı DNS'i girilince | Pages özel alan adı, uygulamadaki adresler, yönlendirmeler, tam test |
| SMTP bağlanınca | Kayıt → onay e-postası → giriş uçtan uca testi |
| `eas init` sonrası | projectId'yi depoya işlerim |
| İlk TestFlight / iç test derlemesinden sonra | Sorun çıkarsa günlüklerden düzeltirim |
| İnceleme reddederse | Ret gerekçesini getir; yanıt metnini ve düzeltmeyi hazırlarım |
