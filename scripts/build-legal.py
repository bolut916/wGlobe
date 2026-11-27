# wGlobe yasal sayfaları: statik, JavaScript'siz, TR + EN, uygulamanın tasarım dili. Çıktı: prototype/{privacy,support,delete-account}/index.html
import html, os, sys
OUT = sys.argv[1]
CONTACT = 'destek@wglobe.app'
UPDATED_TR, UPDATED_EN = '27 Kasım 2026', 'November 27, 2026'

CSS = """
@font-face{font-family:'Geist';font-style:normal;font-display:swap;font-weight:100 900;src:url(../lib/fonts/geist-latin-ext-wght-normal.woff2) format('woff2');unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF}
@font-face{font-family:'Geist';font-style:normal;font-display:swap;font-weight:100 900;src:url(../lib/fonts/geist-latin-wght-normal.woff2) format('woff2');unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}
@font-face{font-family:'Bricolage Grotesque';font-style:normal;font-display:swap;font-weight:200 800;src:url(../lib/fonts/bricolage-grotesque-latin-ext-opsz-normal.woff2) format('woff2');unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF}
@font-face{font-family:'Bricolage Grotesque';font-style:normal;font-display:swap;font-weight:200 800;src:url(../lib/fonts/bricolage-grotesque-latin-opsz-normal.woff2) format('woff2');unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}
:root{color-scheme:dark;--bg:#050B18;--card:rgba(12,22,44,.6);--fg:#E8F0FF;--fg2:rgba(232,240,255,.72);--fg3:rgba(232,240,255,.5);--hair:rgba(232,240,255,.09);--a:#A9D3FF}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:radial-gradient(1200px 600px at 50% -200px,#10224A 0%,var(--bg) 60%) fixed,var(--bg);color:var(--fg);font:400 16px/1.65 Geist,system-ui,-apple-system,sans-serif}
main{max-width:720px;margin:0 auto;padding:max(28px,env(safe-area-inset-top)) 20px calc(64px + env(safe-area-inset-bottom))}
.brand{display:inline-block;font:800 22px/1 'Bricolage Grotesque',Geist,sans-serif;letter-spacing:-.05em;color:var(--fg);text-decoration:none}
.brand span{color:var(--a)}
nav.lang{float:right;font-size:13px;margin-top:4px}
nav.lang a{color:var(--fg2);text-decoration:none;padding:6px 10px;border-radius:999px;box-shadow:inset 0 0 0 1px var(--hair)}
h1{font:700 clamp(30px,7vw,40px)/1.1 'Bricolage Grotesque',Geist,sans-serif;letter-spacing:-.03em;margin:40px 0 6px}
.meta{color:var(--fg3);font-size:13px;margin:0 0 28px}
section.lang-block{margin-top:8px}
h2{font:650 19px/1.3 Geist,sans-serif;margin:34px 0 8px;letter-spacing:-.01em}
p,li{color:var(--fg2)}
a{color:var(--a)}
ul{padding-left:20px}
li{margin:6px 0}
.card{background:var(--card);box-shadow:inset 0 0 0 1px var(--hair);border-radius:22px;padding:18px 20px;margin:18px 0}
.card b{color:var(--fg)}
table{width:100%;border-collapse:collapse;font-size:14.5px;margin:12px 0}
th,td{text-align:left;vertical-align:top;padding:10px 8px;border-bottom:1px solid var(--hair)}
th{color:var(--fg);font-weight:600}
td{color:var(--fg2)}
hr{border:0;border-top:1px solid var(--hair);margin:56px 0 8px}
footer{color:var(--fg3);font-size:13px;margin-top:40px}
footer a{color:var(--fg2)}
@media (max-width:520px){table,thead,tbody,tr,th,td{display:block}thead{display:none}tr{padding:8px 0;border-bottom:1px solid var(--hair)}td{border:0;padding:3px 0}td:first-child{color:var(--fg);font-weight:600}}
"""

def page(slug, title_tr, title_en, tr_html, en_html):
    t = f"""<!doctype html><html lang="tr"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="referrer" content="strict-origin-when-cross-origin">
<title>{html.escape(title_tr)} · wGlobe</title>
<meta name="description" content="wGlobe — {html.escape(title_tr)} / {html.escape(title_en)}">
<style>{CSS}</style></head>
<body><main>
<a class="brand" href="../">w<span>Globe</span></a>
<nav class="lang" aria-label="Dil / Language"><a href="#en" lang="en">English ↓</a></nav>
<section class="lang-block" id="tr" lang="tr">
<h1>{html.escape(title_tr)}</h1>
<p class="meta">Son güncelleme: {UPDATED_TR}</p>
{tr_html}
</section>
<hr>
<section class="lang-block" id="en" lang="en">
<h1>{html.escape(title_en)}</h1>
<p class="meta">Last updated: {UPDATED_EN}</p>
{en_html}
</section>
<footer><a href="../privacy/">Gizlilik · Privacy</a> · <a href="../support/">Destek · Support</a> · <a href="../delete-account/">Hesap silme · Delete account</a></footer>
</main></body></html>
"""
    d = os.path.join(OUT, slug); os.makedirs(d, exist_ok=True)
    open(os.path.join(d, 'index.html'), 'w').write(t)

M = f'<a href="mailto:{CONTACT}">{CONTACT}</a>'

# ─────────────── GİZLİLİK ───────────────
priv_tr = f"""
<div class="card"><b>Kısaca:</b> wGlobe reklam göstermez, kullanıcıyı izlemez, analiz/izleme aracı kullanmaz ve konumunu istemez.
Hesap açmazsan verilerin yalnızca cihazında kalır. Hesap açarsan favorilerin ve damgaların, cihazların arasında eşitlenmek için
Avrupa Birliği'ndeki (Frankfurt) bir sunucuda saklanır ve hesabını sildiğinde tamamen silinir.</div>

<h2>1. Veri sorumlusu ve iletişim</h2>
<p>wGlobe uygulaması ve wglobe.app sitesi bağımsız bir geliştirici tarafından sunulur. Gizlilikle ilgili her soru ve talep için: {M}</p>

<h2>2. Hangi verileri işliyoruz?</h2>
<table><thead><tr><th>Veri</th><th>Ne zaman</th><th>Neden</th><th>Nerede</th></tr></thead><tbody>
<tr><td>E-posta adresi ve şifre (şifre geri çözülemez biçimde, özetlenerek)</td><td>Yalnızca hesap açarsan</td><td>Giriş yapabilmen, şifre sıfırlama e-postası</td><td>Supabase (AB, Frankfurt)</td></tr>
<tr><td>Favori istasyonlar, kaydettiğin şarkılar, ziyaret ettiğin şehirler (damgalar), açtığın küreler, tercihlerin, toplam dinleme süresi ve basit sayaçlar</td><td>Yalnızca hesap açarsan</td><td>Cihazların arasında eşitleme</td><td>Supabase (AB, Frankfurt)</td></tr>
<tr><td>Aynı veriler ve uygulama ayarları</td><td>Her zaman</td><td>Uygulamanın çalışması</td><td>Yalnızca senin cihazında</td></tr>
<tr><td>IP adresi ve teknik bağlantı kayıtları</td><td>Sunuculara her bağlantıda</td><td>Hizmetin güvenliği ve kötüye kullanımın önlenmesi</td><td>İlgili hizmet sağlayıcıda, kısa süreli</td></tr>
</tbody></table>
<p>Konum iznini istemeyiz ve kullanmayız. Hava durumu ve istasyon araması, cihazının konumuyla değil, haritada <b>senin seçtiğin şehrin</b> koordinatlarıyla yapılır.
Rehberine, fotoğraflarına, mikrofonuna veya kamerana erişmeyiz.</p>

<h2>3. Üçüncü taraf hizmetler</h2>
<p>Uygulamanın çalışması için aşağıdaki hizmetlere bağlanılır. Bu hizmetler bağlantı sırasında IP adresini görebilir; onlara kimlik bilgin gönderilmez.</p>
<ul>
<li><b>Supabase</b> (altyapı; veriler AB'de, Frankfurt) — hesap kullanırsan hesap ve eşitleme için. Ayrıca herkes için: o an çalan şarkının adını okuyabilmek amacıyla dinlediğin istasyonun yayın adresi gönderilir (kimlik bilgisi gönderilmez).</li>
<li><b>Radio Browser</b> (radio-browser.info) — açık radyo dizini; seçtiğin şehrin yakınındaki istasyonları bulmak için.</li>
<li><b>Radyo istasyonlarının yayın sunucuları</b> — dinlediğin yayın doğrudan istasyonun sunucusundan gelir.</li>
<li><b>Open-Meteo</b> — seçtiğin şehrin hava durumu ve şehir araması için.</li>
<li><b>Esri (ArcGIS)</b> — kürenin uydu görüntüsü karoları için.</li>
<li><b>Apple App Store / Google Play</b> — yalnızca isteğe bağlı bahşiş verirsen ödemeyi tamamen onlar işler; ödeme bilgilerini biz görmeyiz.</li>
</ul>
<p>Bir şarkıyı Spotify'da ya da Apple Music'te aramak için bağlantıya dokunursan o hizmetin sayfası açılır ve kendi gizlilik politikası geçerli olur.</p>

<h2>4. Yapmadıklarımız</h2>
<ul><li>Reklam göstermiyoruz, verilerini satmıyoruz ve kimseyle pazarlama amacıyla paylaşmıyoruz.</li>
<li>Seni uygulamalar ve siteler arasında izlemiyoruz; analiz, reklam ya da izleme kütüphanesi kullanmıyoruz.</li>
<li>Yazı tipleri dahil tüm site dosyaları kendi sunucumuzdan gelir.</li></ul>

<h2>5. Saklama süresi ve silme</h2>
<p>Hesap verilerin, hesabını silene kadar saklanır. Hesabını <b>Profil → Ayarlar → Hesabı sil</b> yoluyla istediğin an kalıcı olarak silebilirsin;
hesabın ve ona bağlı tüm veriler sunucudan hemen silinir. Uygulamaya erişemiyorsan <a href="../delete-account/">hesap silme sayfasındaki</a> adımları izle.
Cihazındaki veriler, uygulamayı silince ya da tarayıcı verilerini temizleyince silinir. Teknik bağlantı kayıtları hizmet sağlayıcılarda kısa süre tutulur.</p>

<h2>6. Hakların</h2>
<p>6698 sayılı Kişisel Verilerin Korunması Kanunu (KVKK) ve Avrupa Birliği Genel Veri Koruma Tüzüğü (GDPR) kapsamında; verilerine erişme, düzeltme,
silme, işlemeyi kısıtlama, itiraz etme ve verilerini taşınabilir biçimde alma haklarına sahipsin. Taleplerin için {M} adresine yaz; en geç 30 gün içinde yanıtlarız.
Ayrıca Kişisel Verileri Koruma Kurumu'na ya da bulunduğun ülkedeki veri koruma otoritesine şikâyette bulunabilirsin.</p>
<p>Verilerin hesap ve eşitleme hizmetini sunabilmemiz için (sözleşmenin ifası) ve hizmetin güvenliğini sağlamak için (meşru menfaat) işlenir.</p>

<h2>7. Çocuklar</h2>
<p>wGlobe 13 yaşın altındaki çocuklara yönelik değildir ve bilerek onlardan kişisel veri toplamayız. Radyo yayınlarının içeriğini istasyonlar belirler.</p>

<h2>8. Güvenlik</h2>
<p>Tüm bağlantılar şifrelidir (HTTPS). Hesap verilerin, yalnızca senin görebileceğin şekilde satır düzeyinde güvenlik kurallarıyla korunur; şifreler geri çözülemez biçimde saklanır.</p>

<h2>9. Değişiklikler</h2>
<p>Bu politikayı güncellersek bu sayfadaki tarihi değiştiririz; önemli değişiklikleri uygulama içinde de duyururuz.</p>
"""
priv_en = f"""
<div class="card"><b>In short:</b> wGlobe shows no ads, does not track you, uses no analytics or tracking tools and never asks for your location.
Without an account your data stays only on your device. With an account, your favorites and stamps are stored on a server in the
European Union (Frankfurt) to sync between your devices, and they are fully erased when you delete your account.</div>

<h2>1. Who we are and how to reach us</h2>
<p>The wGlobe app and the wglobe.app website are provided by an independent developer. For any privacy question or request: {M}</p>

<h2>2. What data we process</h2>
<table><thead><tr><th>Data</th><th>When</th><th>Why</th><th>Where</th></tr></thead><tbody>
<tr><td>Email address and password (stored as an irreversible hash)</td><td>Only if you create an account</td><td>Signing in, password reset emails</td><td>Supabase (EU, Frankfurt)</td></tr>
<tr><td>Favorite stations, saved songs, cities you visited (stamps), unlocked globes, your preferences, total listening time and simple counters</td><td>Only if you create an account</td><td>Syncing between your devices</td><td>Supabase (EU, Frankfurt)</td></tr>
<tr><td>The same data and app settings</td><td>Always</td><td>Making the app work</td><td>Only on your device</td></tr>
<tr><td>IP address and technical connection logs</td><td>On every connection to a server</td><td>Security and abuse prevention</td><td>At the respective provider, briefly</td></tr>
</tbody></table>
<p>We never ask for or use location permission. Weather and station search use the coordinates of <b>the city you pick</b> on the map, not your device's location.
We do not access your contacts, photos, microphone or camera.</p>

<h2>3. Third-party services</h2>
<p>The app connects to the services below to work. They can see your IP address while connecting; no account information is sent to them.</p>
<ul>
<li><b>Supabase</b> (infrastructure; data in the EU, Frankfurt) — for your account and sync if you use one. Also for everyone: the stream address of the station you're listening to is sent so the current song title can be read (no account information is sent).</li>
<li><b>Radio Browser</b> (radio-browser.info) — an open radio directory, to find stations near the city you pick.</li>
<li><b>Radio stations' streaming servers</b> — the stream you listen to comes directly from the station's server.</li>
<li><b>Open-Meteo</b> — weather and city search for the city you pick.</li>
<li><b>Esri (ArcGIS)</b> — satellite imagery tiles for the globe.</li>
<li><b>Apple App Store / Google Play</b> — only if you choose to leave an optional tip; they process the payment entirely and we never see payment details.</li>
</ul>
<p>If you tap a link to search a song on Spotify or Apple Music, that service's page opens and its own privacy policy applies.</p>

<h2>4. What we don't do</h2>
<ul><li>We don't show ads, sell your data or share it with anyone for marketing.</li>
<li>We don't track you across apps or websites and use no analytics, advertising or tracking libraries.</li>
<li>All website files, including fonts, are served from our own server.</li></ul>

<h2>5. Retention and deletion</h2>
<p>Account data is kept until you delete your account. You can permanently delete it at any time via <b>Profile → Settings → Delete account</b>;
your account and all its data are removed from the server immediately. If you can't access the app, follow the steps on the <a href="../delete-account/#en">account deletion page</a>.
Data on your device is removed when you uninstall the app or clear your browser data. Technical connection logs are kept briefly by the providers.</p>

<h2>6. Your rights</h2>
<p>Under the EU General Data Protection Regulation (GDPR) and Turkey's Personal Data Protection Law (KVKK), you have the right to access, correct,
delete, restrict or object to processing of your data and to receive it in a portable format. Write to {M}; we reply within 30 days.
You may also lodge a complaint with your local data protection authority.</p>
<p>We process your data to provide the account and sync service (performance of a contract) and to keep the service secure (legitimate interest).</p>

<h2>7. Children</h2>
<p>wGlobe is not directed to children under 13 and we do not knowingly collect their personal data. Radio content is determined by the stations.</p>

<h2>8. Security</h2>
<p>All connections are encrypted (HTTPS). Account data is protected by row-level security so that only you can see it; passwords are stored as irreversible hashes.</p>

<h2>9. Changes</h2>
<p>If we update this policy we change the date on this page and announce important changes in the app.</p>
"""
page('privacy', 'Gizlilik Politikası', 'Privacy Policy', priv_tr, priv_en)

# ─────────────── HESAP SİLME ───────────────
del_tr = f"""
<p>wGlobe hesabını ve ona bağlı tüm verileri istediğin an kalıcı olarak silebilirsin.</p>
<div class="card"><b>Uygulamadan (en hızlı yol)</b>
<ol><li>wGlobe'u aç ve <b>Profil</b> sekmesine geç.</li><li>Sağ üstteki <b>Ayarlar</b> (dişli) düğmesine dokun.</li>
<li><b>Hesabı sil</b>'e dokun ve onayla.</li></ol>
Hesabın ve tüm verilerin sunucudan <b>hemen</b> silinir.</div>
<div class="card"><b>Uygulamaya erişemiyorsan</b><br>
Kayıtlı e-posta adresinden {M} adresine "Hesabımı sil" konulu bir e-posta gönder. Kimliğini doğruladıktan sonra hesabını en geç 30 gün içinde sileriz ve sana bildiririz.</div>
<h2>Neler silinir?</h2>
<ul><li>E-posta adresin ve şifren (hesap bilgilerin)</li><li>Favori istasyonların ve kaydettiğin şarkılar</li><li>Ziyaret ettiğin şehirler (damgalar), açtığın küreler, tercihlerin, dinleme süren ve sayaçlar</li></ul>
<h2>Neler kalır?</h2>
<ul><li>Hiçbir hesap verisi saklanmaz.</li><li>Bahşiş verdiysen, ödeme kaydı Apple ya da Google'da kendi politikalarına göre tutulur (bu kayıtlar bize ait değildir).</li>
<li>Cihazındaki veriler uygulamayı sildiğinde silinir.</li></ul>
"""
del_en = f"""
<p>You can permanently delete your wGlobe account and all associated data at any time.</p>
<div class="card"><b>From the app (fastest)</b>
<ol><li>Open wGlobe and go to the <b>Profile</b> tab.</li><li>Tap the <b>Settings</b> (gear) button at the top right.</li>
<li>Tap <b>Delete account</b> and confirm.</li></ol>
Your account and all your data are removed from the server <b>immediately</b>.</div>
<div class="card"><b>If you can't access the app</b><br>
Email {M} from your registered address with the subject "Delete my account". After verifying your identity we delete your account within 30 days and let you know.</div>
<h2>What is deleted</h2>
<ul><li>Your email address and password (account credentials)</li><li>Your favorite stations and saved songs</li><li>Visited cities (stamps), unlocked globes, preferences, listening time and counters</li></ul>
<h2>What remains</h2>
<ul><li>No account data is kept.</li><li>If you left a tip, Apple or Google keep the payment record under their own policies (we don't hold these records).</li>
<li>Data on your device is removed when you uninstall the app.</li></ul>
"""
page('delete-account', 'Hesabını sil', 'Delete your account', del_tr, del_en)

# ─────────────── DESTEK ───────────────
sup_tr = f"""
<div class="card"><b>Bize ulaş:</b> {M}<br>Genellikle birkaç gün içinde yanıt veririz. Bir hata bildiriyorsan cihaz modelini ve uygulama sürümünü (Ayarlar'ın en altında) yazman çok yardımcı olur.</div>
<h2>Sık sorulanlar</h2>
<p><b>Nasıl dinlerim?</b><br>Küreyi çevir ve bir şehre dokun; o şehrin canlı radyoları çalmaya başlar. Ara çubuğuyla şehir, ülke ya da istasyon da bulabilirsin.</p>
<p><b>Bir istasyon çalmıyor.</b><br>Yayınları istasyonlar sunar; bazıları geçici olarak kapalı olabilir. wGlobe sırayla çalışan bir sonraki yayına geçer. Bir süre sonra tekrar dene.</p>
<p><b>Hesap açmam gerekiyor mu?</b><br>Hayır. Misafir olarak her şeyi kullanabilirsin; hesap yalnızca favorilerini ve damgalarını cihazların arasında eşitlemek içindir.</p>
<p><b>Şifremi unuttum.</b><br>Giriş ekranındaki "Şifremi unuttum" bağlantısına dokun; sıfırlama bağlantısı e-postana gelir.</p>
<p><b>Hesabımı nasıl silerim?</b><br>Profil → Ayarlar → Hesabı sil. Ayrıntılar: <a href="../delete-account/">hesap silme</a>.</p>
<p><b>Bahşiş ne işe yarar?</b><br>Tamamen isteğe bağlıdır ve hiçbir özelliği açmaz; wGlobe herkes için aynıdır. Bahşişler uygulamanın geliştirilmesine destek olur. Ödemeyi App Store / Google Play işler.</p>
<p><b>Gizlilik</b><br>Reklam ve izleme yok; konumunu istemeyiz. Ayrıntılar: <a href="../privacy/">gizlilik politikası</a>.</p>
"""
sup_en = f"""
<div class="card"><b>Contact us:</b> {M}<br>We usually reply within a few days. If you're reporting a bug, your device model and the app version (at the bottom of Settings) help a lot.</div>
<h2>FAQ</h2>
<p><b>How do I listen?</b><br>Spin the globe and tap a city; its live radio starts playing. You can also find a city, country or station with the search bar.</p>
<p><b>A station doesn't play.</b><br>Streams are provided by the stations and some may be temporarily offline. wGlobe moves on to the next working stream. Try again later.</p>
<p><b>Do I need an account?</b><br>No. You can use everything as a guest; an account only syncs your favorites and stamps between your devices.</p>
<p><b>I forgot my password.</b><br>Tap "Forgot password" on the sign-in screen and a reset link will arrive by email.</p>
<p><b>How do I delete my account?</b><br>Profile → Settings → Delete account. Details: <a href="../delete-account/#en">account deletion</a>.</p>
<p><b>What are tips for?</b><br>They are entirely optional and unlock nothing; wGlobe is the same for everyone. Tips support the app's development. Payments are handled by the App Store / Google Play.</p>
<p><b>Privacy</b><br>No ads, no tracking, and we never ask for your location. Details: <a href="../privacy/#en">privacy policy</a>.</p>
"""
page('support', 'Destek', 'Support', sup_tr, sup_en)
print('ok')
