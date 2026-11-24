"""Make the app icons from the title calligraphy on the book cover."""
import sys, os
from PIL import Image, ImageOps, ImageDraw
src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
page = Image.open(src).convert("L")
crop = page.crop((400, 700, 1010, 920))
mask = ImageOps.invert(crop)
bb = mask.point(lambda v: 255 if v > 60 else 0).getbbox()
mask = mask.crop(bb)
def icon(size, frac, name, frame=True):
    im = Image.new("RGB", (size, size), (20, 83, 45))
    d = ImageDraw.Draw(im)
    if frame:
        m = round(size * 0.07)
        d.rounded_rectangle((m, m, size - m, size - m), radius=round(size * 0.08), outline=(212, 175, 55), width=max(2, size // 90))
    w = round(size * frac); h = round(mask.size[1] * w / mask.size[0])
    mk = mask.resize((w, h), Image.LANCZOS)
    im.paste((255, 255, 255), ((size - w) // 2, (size - h) // 2), mk)
    im.save(os.path.join(out, name), optimize=True)
icon(512, 0.72, "icon-512.png")
icon(192, 0.72, "icon-192.png")
icon(180, 0.74, "apple-touch-icon.png", frame=False)
icon(512, 0.56, "icon-maskable-512.png", frame=False)
print("icons written, calligraphy crop", mask.size)
