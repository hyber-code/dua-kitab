#!/usr/bin/env python3
"""Build the Dua Kitab web app assets from the book PDF (and Word file for titles).

Usage:
  .venv/bin/python build.py BOOK.pdf BOOK.docx SITE_DIR EDITION

Steps: render every page, trim the outer white margin, save small sharp
WebP images, read the Contents list, and write data.json for the app.
Full output is saved to build-log.txt next to this script.
"""
import sys, os, re, json, subprocess, zipfile, glob, shutil, datetime
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
LOG = open(os.path.join(HERE, "build-log.txt"), "w")


def log(*a):
    s = " ".join(str(x) for x in a)
    print(s)
    LOG.write(s + "\n")


RENDER_W = 1400
CROP = (56, 56, 1344, 1756)  # trims white outside the border (measured on all pages)


def palette_image():
    cols = []
    for i in range(16):
        v = round(i * 255 / 15)
        cols.append((v, v, v))
    for i in range(1, 7):  # white -> red
        v = round(255 - i * 255 / 6)
        cols.append((255, v, v))
    for v in (170, 85):  # red -> black
        cols.append((v, 0, 0))
    flat = [c for col in cols for c in col]
    flat += flat[:3] * (256 - len(cols))
    p = Image.new("P", (1, 1))
    p.putpalette(flat)
    return p


def render(pdf, work):
    full = os.path.join(work, "full")
    if len(glob.glob(os.path.join(full, "p-*.png"))) == 0:
        os.makedirs(full, exist_ok=True)
        subprocess.run(["pdftoppm", "-scale-to-x", str(RENDER_W), "-scale-to-y", "-1",
                        "-png", pdf, os.path.join(full, "p")], check=True)
    return sorted(glob.glob(os.path.join(full, "p-*.png")))


def contents_from_docx(docx):
    x = zipfile.ZipFile(docx).read("word/document.xml").decode("utf8")
    paras = []
    for p in re.findall(r"<w:p[ >].*?</w:p>", x, re.S):
        t = "".join(re.findall(r"<w:t[^>]*>([^<]*)</w:t>", p)).strip()
        st = re.search(r'<w:pStyle w:val="([^"]+)"', p)
        if t:
            paras.append((st.group(1) if st else "", re.sub(r"\s+", " ", t)))
    start = next(i for i, (s, t) in enumerate(paras) if "Contents" in t and s == "Title")
    sections = []
    for s, t in paras[start + 1:]:
        if s == "Title":
            break
        m = re.match(r"^(\d{1,3})\s*-\s*(.+)$", t)
        if m:
            sections.append({"page": int(m.group(1)), "en": m.group(2).replace("’", "'"), "ur": ""})
        elif sections:
            sections[-1]["ur"] = (sections[-1]["ur"] + " " + t).strip()
    return sections


def contents_zones(pdf, sections, npages):
    """Tap areas on the printed Contents pages, as fractions of the trimmed page."""
    pages_by_num = {s["page"] for s in sections}
    zones = {}
    sx = RENDER_W / 612.0
    cw, ch = CROP[2] - CROP[0], CROP[3] - CROP[1]
    prev_target = None
    for pno in range(1, min(npages, 30) + 1):
        out = subprocess.run(["pdftotext", "-f", str(pno), "-l", str(pno), "-bbox", pdf, "-"],
                             capture_output=True, text=True, check=True).stdout
        words = [(float(a), float(b), float(c), float(d), w) for a, b, c, d, w in re.findall(
            r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)</word>', out)]
        if not any("Contents" in w[4] for w in words if w[1] < 95):
            continue
        body = [w for w in words if 95 < w[1] < 690]
        entries = []
        for w in body:
            m = re.match(r"^(\d{2,3})-", w[4])
            if m and w[0] < 80 and int(m.group(1)) in pages_by_num:
                entries.append((w[1], int(m.group(1))))
        entries.sort()
        if not body:
            continue
        bottom = max(w[3] for w in body) + 10
        rows = []
        first_y = entries[0][0] - 6 if entries else bottom
        if prev_target and any(w[1] < first_y - 4 for w in body):
            rows.append((98, first_y, prev_target))  # entry continued from the page before
        for i, (y, target) in enumerate(entries):
            y2 = entries[i + 1][0] - 6 if i + 1 < len(entries) else bottom
            rows.append((y - 6, y2, target))
        zl = []
        for y1, y2, target in rows:
            top = (y1 * sx - CROP[1]) / ch
            hgt = (y2 - y1) * sx / ch
            zl.append({"y": round(top, 4), "h": round(hgt, 4), "to": target})
        if zl:
            zones[str(pno)] = zl
        if entries:
            prev_target = entries[-1][1]
    return zones


def main():
    pdf, docx, site, edition = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
    work = os.path.join(HERE, "work")
    files = render(pdf, work)
    n = len(files)
    log("pages rendered:", n)
    outdir = os.path.join(site, "pages", "e%d" % edition)
    if os.path.isdir(outdir):
        shutil.rmtree(outdir)
    os.makedirs(outdir)
    pal = palette_image()
    total = 0
    for i, f in enumerate(files, 1):
        im = Image.open(f).convert("RGB")
        assert im.size[0] == RENDER_W, "unexpected page size %s on page %d" % (im.size, i)
        im = im.crop(CROP).quantize(palette=pal, dither=Image.Dither.NONE).convert("RGB")
        o = os.path.join(outdir, "%03d.webp" % i)
        im.save(o, "WEBP", lossless=True, method=6)
        total += os.path.getsize(o)
    log("page images: %d files, %.1f MB, each %dx%d" % (n, total / 1e6, CROP[2] - CROP[0], CROP[3] - CROP[1]))

    sections = contents_from_docx(docx)
    log("sections found in Word file:", len(sections))
    bad = [s for s in sections if not (1 <= s["page"] <= n)]
    assert not bad, "section page out of range"
    zones = contents_zones(pdf, sections, n)
    log("contents pages with tap areas:", ", ".join(sorted(zones, key=int)),
        "| tap areas:", sum(len(v) for v in zones.values()))
    data = {
        "title": "Dua Kitab",
        "edition": edition,
        "editionDate": datetime.date.today().isoformat(),
        "pages": n,
        "pageW": CROP[2] - CROP[0],
        "pageH": CROP[3] - CROP[1],
        "contentsPage": int(min(zones, key=int)) if zones else 1,
        "sections": sections,
        "zones": zones,
        # For future editions: {"<old edition>": {"map": {"<old page>": <new page>}, "changed": [<new pages>]}}
        "migrations": {},
    }
    with open(os.path.join(site, "data.json"), "w", encoding="utf8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=1)
    log("wrote data.json")
    log("SUMMARY: edition %d, %d pages, %.1f MB of page images, %d sections" % (edition, n, total / 1e6, len(sections)))


if __name__ == "__main__":
    main()
