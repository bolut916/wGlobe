#!/usr/bin/env python3
"""Mağaza metinleri: tek kaynak + karakter sınırı denetimi → docs/magaza/metinler.md

App Store Connect sınırları: ad 30, alt başlık 30, tanıtım metni 170, açıklama 4000, anahtar kelimeler 100 (virgülle).
Google Play sınırları: başlık 30, kısa açıklama 80, tam açıklama 4000.
Çalıştır: python3 scripts/store-texts.py  (sınır aşılırsa hata verir, dosya yazılmaz)
"""
import pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

DESC = {
    'tr': """wGlobe, dünyanın canlı radyolarını gerçek bir uydu küresinin üstüne yerleştirir. Küreyi parmağınla çevir, bir şehre dokun; birkaç saniye içinde oranın yerel istasyonu çalmaya başlar.

DÜNYAYI DİNLE
• Dünyanın dört bir yanından binlerce canlı radyo istasyonu
• Çalan şarkının adı, şehrin yerel saati ve hava durumu
• Arka planda çalma, kilit ekranından kontrol
• Uyku zamanlayıcısı

KÜREYLE KEŞFET
• Uydu görüntüsüyle gerçek dünya; yaklaştıkça şehir adları belirir
• Zaman kaydırıcısı: dünyayı başka bir saatte gör; gece ile gündüzün sınırı ve şehir ışıkları birlikte akar
• Uçuş modu ve rastgele şehir: hiç duymadığın bir yere ışınlan
• Her gün yeni bir "Günün şehri"

GÜNE RADYOYLA BAŞLA
• Radyolu alarm: o an güneşin doğduğu bir şehrin radyosuyla uyan

LİSTELERLE DİNLE
• Ruh hâline göre listeler: Sabah Kahvesi, Gece Yarısı Cazı, Kuzey Işıkları ve daha fazlası
• "Dünya uyanıyor": şu an sabah olan şehirler, sırayla
• Favorilerin tek listede; ileri tuşu listedeki sıradaki şehre geçer

BİRİKTİR
• 100 küreden oluşan koleksiyon: gezdikçe yeni küre temaları açılır
• Pasaport: ziyaret ettiğin ülkeler ve şehirler, dinleme süren, rotan
• Favoriler; istersen ücretsiz hesap açıp verilerini cihazların arasında eşitle

ANA EKRANDA
• Son istasyon widget'ı: tek dokunuşla kaldığın yerden dinle

Reklam yok, takip yok, konum izni istemiyoruz. Hesap açmadan misafir olarak hemen başlayabilirsin.

wGlobe ücretsizdir. Beğenirsen Ayarlar'dan isteğe bağlı bir bahşişle geliştiriciye destek olabilirsin; bahşiş hiçbir özelliği açmaz.

Yayınlar radyo istasyonlarının kendisine aittir. İstasyon listesi, topluluk tarafından tutulan açık Radio Browser dizininden gelir.""",
    'en': """wGlobe puts the world's live radio on a real satellite globe. Spin the Earth with your finger, tap a city, and within seconds its local station starts playing.

HEAR THE WORLD
• Thousands of live radio stations from every corner of the planet
• The song that's playing, the city's local time and the weather
• Background playback with lock screen controls
• Sleep timer

EXPLORE THE GLOBE
• The real Earth in satellite imagery; city names appear as you zoom in
• Time scrubber: see the world at another hour, with the line between day and night and the city lights moving together
• Flight mode and random city: teleport somewhere you've never heard of
• A new City of the day, every day

WAKE UP TO RADIO
• Radio alarm: wake up to a station in a city where the sun is rising right now

LISTEN IN LISTS
• Mood lists: Morning Coffee, Midnight Jazz, Northern Lights and more
• "The world wakes up": cities where it's morning right now, one after another
• Your favorites in one list; the next button moves to the next city in the list

COLLECT
• A collection of 100 globes: new globe themes unlock as you travel
• Passport: the countries and cities you've visited, your listening time, your route
• Favorites; create a free account if you want to sync across devices

ON YOUR HOME SCREEN
• Last station widget: pick up where you left off with one tap

No ads, no tracking, no location permission. Start right away as a guest, no account needed.

wGlobe is free. If you enjoy it, you can support the developer with an optional tip in Settings; tips don't unlock anything.

Broadcasts belong to the radio stations themselves. The station list comes from the open, community-maintained Radio Browser directory.""",
}

T = {
    'tr': {
        'as_name': 'wGlobe – Dünya Radyosu',
        'as_subtitle': 'Çevir, dokun, dünyayı dinle',
        'as_promo': 'Dünyayı bir küre gibi çevir, bir şehre dokun ve oranın canlı radyosu çalsın. Geceyi ve gündüzü kaydır, gün doğumunda başka bir şehrin radyosuyla uyan.',
        'as_keywords': 'canlı,fm,istasyon,küre,harita,müzik,internet,şehir,alarm,gündoğumu,seyahat,caz,haber,ülke,yabancı',
        'gp_title': 'wGlobe: Dünya Radyosu',
        'gp_short': 'Küreyi çevir, bir şehre dokun, oranın canlı radyosunu dinle.',
        'captions': [
            ('Küreyi çevir,', 'dünyayı dinle'),
            ('Bir şehre dokun,', 'radyosu çalsın'),
            ('Geceyi ve gündüzü', 'parmağınla kaydır'),
            ('Gezdikçe', '100 küre aç'),
            ('Pasaportun:', 'ülkeler, şehirler, rotan'),
            ('Ruh hâline göre', 'dünyayı sırayla dinle'),
        ],
    },
    'en': {
        'as_name': 'wGlobe – World Radio',
        'as_subtitle': 'Spin the globe, hear the world',
        'as_promo': 'Spin the Earth, tap a city and hear its live radio in seconds. Slide day into night, and wake up to a station in a city where the sun is rising.',
        'as_keywords': 'live,fm,stations,globe,map,music,internet,city,alarm,sunrise,travel,jazz,news,country,abroad',
        'gp_title': 'wGlobe: World Radio',
        'gp_short': 'Spin the globe, tap a city and hear its live radio.',
        'captions': [
            ('Spin the globe.', 'Hear the world.'),
            ('Tap a city.', 'Its radio plays.'),
            ('Slide day', 'into night'),
            ('Unlock 100 globes', 'as you travel'),
            ('Your passport:', 'countries, cities, routes'),
            ('Play the world', 'by mood'),
        ],
    },
}

LIMITS = {'as_name': 30, 'as_subtitle': 30, 'as_promo': 170, 'as_keywords': 100, 'gp_title': 30, 'gp_short': 80}

def check():
    bad = []
    for lang, t in T.items():
        for k, lim in LIMITS.items():
            if len(t[k]) > lim: bad.append(f'{lang}.{k}: {len(t[k])} > {lim}')
        if len(DESC[lang]) > 4000: bad.append(f'{lang}.desc: {len(DESC[lang])} > 4000')
        kws = t['as_keywords'].split(',')
        if any(k != k.strip() or not k for k in kws): bad.append(f'{lang}.keywords: boşluk/boş öğe')
        name_words = {w.lower() for w in t['as_name'].replace('–', ' ').split()}
        if name_words & {k.lower() for k in kws}: bad.append(f'{lang}.keywords: addaki kelime tekrarı')
    return bad

def md():
    out = ['# Mağaza metinleri (App Store + Google Play)', '',
           '> Bu dosya `scripts/store-texts.py` ile üretilir; metni orada değiştir, betiği yeniden çalıştır. Betik karakter',
           '> sınırlarını denetler (App Store: ad/alt başlık 30, tanıtım 170, anahtar kelime 100, açıklama 4000; Google Play:',
           '> başlık 30, kısa açıklama 80, tam açıklama 4000).', '']
    names = {'tr': 'Türkçe (birincil dil)', 'en': 'İngilizce (English, U.S.)'}
    for lang in ('tr', 'en'):
        t = T[lang]
        out += [f'## {names[lang]}', '', '### App Store Connect', '',
                '| Alan | Metin | Karakter |', '|---|---|---|',
                f"| Ad (Name) | {t['as_name']} | {len(t['as_name'])}/30 |",
                f"| Alt başlık (Subtitle) | {t['as_subtitle']} | {len(t['as_subtitle'])}/30 |",
                f"| Tanıtım metni (Promotional Text) | {t['as_promo']} | {len(t['as_promo'])}/170 |",
                f"| Anahtar kelimeler (Keywords) | `{t['as_keywords']}` | {len(t['as_keywords'])}/100 |", '',
                f'**Açıklama (Description)** — {len(DESC[lang])}/4000', '', '```text', DESC[lang], '```', '',
                '### Google Play Console', '',
                '| Alan | Metin | Karakter |', '|---|---|---|',
                f"| Uygulama adı (App name) | {t['gp_title']} | {len(t['gp_title'])}/30 |",
                f"| Kısa açıklama (Short description) | {t['gp_short']} | {len(t['gp_short'])}/80 |", '',
                '**Tam açıklama (Full description):** App Store açıklamasının aynısı.', '',
                '### Ekran görüntüsü başlıkları', '']
        out += [f'{i}. {a} {b}' for i, (a, b) in enumerate(t['captions'], 1)]
        out.append('')
    return '\n'.join(out)

if __name__ == '__main__':
    bad = check()
    if bad:
        print('SINIR AŞILDI:\n  ' + '\n  '.join(bad)); sys.exit(1)
    p = ROOT / 'docs' / 'magaza' / 'metinler.md'; p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(md() + '\n', encoding='utf-8')
    for lang, t in T.items():
        print(lang, {k: len(t[k]) for k in LIMITS}, 'desc', len(DESC[lang]))
    print('yazıldı', p.relative_to(ROOT))
