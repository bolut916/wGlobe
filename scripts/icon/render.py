# wGlobe simgesi: gerçek uydu dokusuyla ortografik küre + atmosfer + yayın halkaları
import numpy as np, sys, math
from PIL import Image, ImageDraw, ImageFilter
import pathlib
P = str(pathlib.Path(__file__).resolve().parents[2] / 'prototype') + '/'
DAY = np.asarray(Image.open(P + 'earth-day.webp').convert('RGB'), dtype=np.float32) / 255
LIT = np.asarray(Image.open(P + 'earth-lights.jpg').convert('L'), dtype=np.float32) / 255
CLD = np.asarray(Image.open(P + 'earth-clouds.jpg').convert('L'), dtype=np.float32) / 255
H, W = LIT.shape
LIGHT = [-0.55, 0.5, 0.67]
LIGHTS = 1.25

def hexc(h): h = h.lstrip('#'); return np.array([int(h[i:i+2], 16) for i in (0, 2, 4)], dtype=np.float32) / 255

def render(S=2048, R=0.36, lon0=22, lat0=24, city=(28.98, 41.01), rings=True, bg=True, cx=0.5, cy=0.5, halo=True):
    y, x = np.mgrid[0:S, 0:S].astype(np.float32)
    nx = (x + 0.5 - cx * S) / (R * S); ny = -(y + 0.5 - cy * S) / (R * S)
    rr = nx * nx + ny * ny; inside = rr <= 1
    nz = np.sqrt(np.clip(1 - rr, 0, 1))
    # görüş koordinatından dünya koordinatına (lon0, lat0 merkezde)
    la0, lo0 = math.radians(lat0), math.radians(lon0)
    X = nz * math.cos(la0) - ny * math.sin(la0); Y = nx; Z = nz * math.sin(la0) + ny * math.cos(la0)
    lat = np.arcsin(np.clip(Z, -1, 1)); lon = np.arctan2(Y, X) + lo0
    u = ((lon / (2 * math.pi) + 0.5) % 1) * (W - 1); v = (0.5 - lat / math.pi) * (H - 1)
    ui, vi = u.astype(np.int32), v.astype(np.int32)
    day = DAY[vi, ui]; lit = LIT[vi, ui][..., None]; cld = CLD[vi, ui][..., None]
    L = np.array(LIGHT); L /= np.linalg.norm(L)
    nd = nx * L[0] + ny * L[1] + nz * L[2]
    t = np.clip((nd + 0.12) / 0.42, 0, 1); dayk = (t * t * (3 - 2 * t))[..., None]
    surf = day * (0.35 + 0.95 * np.clip(nd, 0, 1))[..., None]
    surf = surf * (1 - 0.55 * cld) + cld * 0.95 * np.clip(nd + 0.15, 0, 1)[..., None]
    night = hexc('#06102A') * 0.9 + np.clip(lit * 1.6, 0, 1) ** 1.25 * hexc('#FFD39A') * LIGHTS
    col = surf * dayk + night * (1 - dayk)
    # kenar: atmosferik mavi yansıma
    rim = np.clip(1 - nz, 0, 1)[..., None] ** 2.2
    col = col * (1 - 0.55 * rim) + hexc('#6FB0FF') * 0.75 * rim * (0.35 + 0.65 * dayk)
    # zemin
    if bg:
        d = np.sqrt(((x - cx * S) / S) ** 2 + ((y - (cy - 0.08) * S) / S) ** 2)
        base = hexc('#050B18') + (hexc('#123056') - hexc('#050B18')) * np.clip(1 - d / 0.62, 0, 1)[..., None] ** 1.6
    else:
        base = np.zeros((S, S, 3), np.float32)
    out = base.copy()
    if halo:
        r = np.sqrt(rr); g = np.clip(1 - (r - 1) / 0.16, 0, 1) * (r > 1)
        out = out + hexc('#6FB0FF')[None, None] * (g ** 2.4 * 0.55)[..., None]
    # yumuşak kenar (2 px)
    edge = np.clip((1 - np.sqrt(rr)) * R * S / 1.5, 0, 1)[..., None]
    out = out * (1 - edge) + col * edge
    alpha = None
    if not bg:
        a = np.clip(edge[..., 0] + (np.clip(1 - (np.sqrt(rr) - 1) / 0.16, 0, 1) * (rr > 1)) ** 2.4 * 0.55, 0, 1) if halo else edge[..., 0]
        alpha = a
    img = Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8))
    if alpha is not None: img.putalpha(Image.fromarray((alpha * 255).astype(np.uint8)))
    if rings and city:
        clat, clon = math.radians(city[1]), math.radians(city[0])
        Xw, Yw, Zw = math.cos(clat) * math.cos(clon - lo0), math.cos(clat) * math.sin(clon - lo0), math.sin(clat)
        sx = Yw; sy = -Xw * math.sin(la0) + Zw * math.cos(la0)
        px, py = cx * S + sx * R * S, cy * S - sy * R * S
        lay = Image.new('RGBA', (S, S), (0, 0, 0, 0)); dr = ImageDraw.Draw(lay)
        for rad, a, w in ((0.150, 0.42, 0.0085), (0.092, 0.85, 0.0095)):
            rp = rad * S; dr.ellipse((px - rp, py - rp, px + rp, py + rp), outline=(234, 244, 255, int(255 * a)), width=max(1, int(w * S)))
        glow = Image.new('RGBA', (S, S), (0, 0, 0, 0)); gd = ImageDraw.Draw(glow); gr = 0.05 * S
        gd.ellipse((px - gr, py - gr, px + gr, py + gr), fill=(169, 211, 255, 150)); glow = glow.filter(ImageFilter.GaussianBlur(0.02 * S))
        dot = Image.new('RGBA', (S, S), (0, 0, 0, 0)); dd = ImageDraw.Draw(dot); r0 = 0.026 * S
        dd.ellipse((px - r0, py - r0, px + r0, py + r0), fill=(255, 255, 255, 255))
        base_rgba = img.convert('RGBA')
        img = Image.alpha_composite(Image.alpha_composite(Image.alpha_composite(base_rgba, glow), lay), dot)
        if alpha is None: img = img.convert('RGB')
    return img

if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else 'icon-a.png'
    render().resize((1024, 1024), Image.LANCZOS).save(out)
    print('ok', out)
