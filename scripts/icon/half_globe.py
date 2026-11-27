# Yarım ay dünya + radyo anteni; side='right' (küre sağda) / 'left'
import math, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
import render
S = 2048
ICE2, WARM = (234, 244, 255), (255, 150, 72)

def make(side='right', cy=0.68, R=0.56, ant_deg=None, tip=(0.29, 0.20), o=0.0, k=1.0):
    # o, k: çerçeve dönüşümü (Android uyarlanabilir simge için iç %66,7'lik alan: o=1/6, k=2/3)
    sgn = 1 if side == 'right' else -1
    cx = 0.99 if side == 'right' else 0.01
    cx, cy, R = o + cx * k, o + cy * k, R * k
    tip = (o + tip[0] * k, o + tip[1] * k) if side == 'right' else (1 - (o + (1 - tip[0]) * k), o + tip[1] * k)
    Sk = S * k
    render.LIGHT = [-0.75 * sgn, 0.32, 0.58]; render.LIGHTS = 1.9
    g = render.render(S=S, R=R, lon0=48 if side == 'right' else -32, lat0=22, rings=False, cx=cx, cy=cy, bg=True).convert('RGBA')
    # boş tarafa hafif gökyüzü ışıması (anten ucunun arkası)
    tx, ty = tip[0] * S, tip[1] * S
    sky = Image.new('RGBA', (S, S)); ImageDraw.Draw(sky).ellipse((tx - 0.42 * Sk, ty - 0.42 * Sk, tx + 0.42 * Sk, ty + 0.42 * Sk), fill=(40, 80, 150, 70))
    g = Image.alpha_composite(g, sky.filter(ImageFilter.GaussianBlur(Sk * 0.12)))
    L = Image.new('RGBA', (S, S)); d = ImageDraw.Draw(L)
    # anten tabanı: ucu gösteren doğrultuda yüzeyde
    gx, gy = cx * S, cy * S
    ang = math.atan2(ty - gy, tx - gx)
    bx, by = gx + R * S * math.cos(ang), gy + R * S * math.sin(ang)
    # taban (küre yüzeyinde küçük kubbe)
    kr = Sk * 0.034; d.ellipse((bx - kr, by - kr, bx + kr, by + kr), fill=(200, 222, 245, 255))
    # teleskopik çubuk: üç kademe, uca doğru incelir
    for i in range(3):
        t0, t1 = i / 3, (i + 1) / 3
        w = int(Sk * (0.024 - 0.0055 * i))
        p0 = (bx + (tx - bx) * t0, by + (ty - by) * t0); p1 = (bx + (tx - bx) * t1, by + (ty - by) * t1)
        d.line((p0, p1), fill=ICE2 + (255,), width=w)
        if i: r = w * 0.8; d.ellipse((p0[0] - r, p0[1] - r, p0[0] + r, p0[1] + r), fill=ICE2 + (255,))
    # dalgalar: anten doğrultusuna dik iki yana
    perp = math.degrees(ang) + 90
    for rr, al in ((0.085, 255), (0.14, 185), (0.195, 110)):
        Rw = rr * Sk
        for base in (perp, perp + 180):
            d.arc((tx - Rw, ty - Rw, tx + Rw, ty + Rw), base - 38, base + 38, fill=ICE2 + (al,), width=int(Sk * 0.021))
    g = Image.alpha_composite(g, L.filter(ImageFilter.GaussianBlur(Sk * 0.012)))
    g = Image.alpha_composite(g, L)
    # uç: turuncu, ışımalı
    T = Image.new('RGBA', (S, S)); td = ImageDraw.Draw(T); r = Sk * 0.034
    td.ellipse((tx - r, ty - r, tx + r, ty + r), fill=WARM + (255,))
    halo = Image.new('RGBA', (S, S)); ImageDraw.Draw(halo).ellipse((tx - r * 2.6, ty - r * 2.6, tx + r * 2.6, ty + r * 2.6), fill=WARM + (170,))
    g = Image.alpha_composite(g, halo.filter(ImageFilter.GaussianBlur(Sk * 0.03)))
    g = Image.alpha_composite(g, T)
    hl = Image.new('RGBA', (S, S)); r2 = r * 0.42; ImageDraw.Draw(hl).ellipse((tx - r2 - r * 0.25, ty - r2 - r * 0.25, tx + r2 - r * 0.25, ty + r2 - r * 0.25), fill=(255, 232, 210, 220))
    g = Image.alpha_composite(g, hl.filter(ImageFilter.GaussianBlur(Sk * 0.004)))
    return g.convert('RGB')

if __name__ == '__main__':
    for side in ('right', 'left'):
        make(side).resize((1024, 1024), Image.LANCZOS).save(f'antenna-{side}.png'); print('ok', side)
