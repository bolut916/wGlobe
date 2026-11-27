#!/usr/bin/env python3
"""Uygulama simgesi: yarım ay dünya (sağda, biraz aşağıda) + solda radyo anteni.
Çalıştır: python3 scripts/icon/build.py  → assets/images/{icon,adaptive-icon,splash,favicon}.png, docs/magaza/simge-512.png
"""
import pathlib, sys
from PIL import Image, ImageDraw
HERE = pathlib.Path(__file__).resolve().parent; ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
import half_globe as hg
A = ROOT / 'assets' / 'images'
icon = hg.make('right').resize((1024, 1024), Image.LANCZOS)
icon.save(A / 'icon.png', optimize=True)                                    # iOS: 1024, şeffaflık yok
hg.make('right', o=1 / 6, k=2 / 3).resize((1024, 1024), Image.LANCZOS).save(A / 'adaptive-icon.png', optimize=True)  # Android: iç 72dp
icon.resize((64, 64), Image.LANCZOS).save(A / 'favicon.png', optimize=True)
icon.resize((512, 512), Image.LANCZOS).save(ROOT / 'docs' / 'magaza' / 'simge-512.png', optimize=True)
sp = icon.resize((600, 600), Image.LANCZOS).convert('RGBA'); m = Image.new('L', (600, 600), 0)
ImageDraw.Draw(m).rounded_rectangle((0, 0, 599, 599), radius=135, fill=255); sp.putalpha(m); sp.save(A / 'splash.png', optimize=True)
print('simgeler yazıldı')
