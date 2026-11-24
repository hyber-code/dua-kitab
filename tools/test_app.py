"""Drive the app in a headless phone-sized browser and report what works."""
import sys, glob, json, time
from playwright.sync_api import sync_playwright
URL = sys.argv[1]
exe = glob.glob("/home/claude/.cache/ms-playwright/chromium_headless_shell-*/*/chrome-headless-shell")[0]
res = []
def ok(name, cond, extra=""):
    res.append((name, bool(cond))); print(("PASS " if cond else "FAIL ") + name, extra)
with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path=exe)
    ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, has_touch=True, is_mobile=True,
                        user_agent="Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36")
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    pg.goto(URL + "?zones=1"); pg.wait_for_selector(".pg"); pg.wait_for_timeout(1500)
    cur = lambda: int(pg.inner_text("#cur"))
    ok("first open lands on Contents page 6", cur() == 6, cur())
    ok("200 pages built", pg.locator(".pg").count() == 200)
    pg.screenshot(path="shots/01-contents.png")
    # tap a contents row
    pg.locator('.pg[data-p="6"] .zone').nth(1).click(); pg.wait_for_timeout(600)
    ok("contents row jumps to page 19", cur() == 19, cur())
    ok("page image loaded", pg.evaluate("document.querySelector('.pg[data-p=\"19\"] img').naturalWidth") == 1288)
    pg.screenshot(path="shots/02-page19.png")
    ok("back chip shown", pg.is_visible("#backChip")); pg.click("#backChip"); pg.wait_for_timeout(400)
    ok("back chip returns to 6", cur() == 6, cur())
    # index
    pg.click("#bIndex"); pg.wait_for_timeout(300)
    ok("index lists 18 sections", pg.locator("#indexList li").count() == 18)
    pg.screenshot(path="shots/03-index.png")
    pg.fill("#indexSearch", "evening"); pg.wait_for_timeout(200)
    ok("search narrows to 1", pg.locator("#indexList li").count() == 1)
    pg.locator("#indexList li button.go").first.click(); pg.wait_for_timeout(600)
    ok("index jump to 127", cur() == 127, cur())
    # go to page
    pg.click("#pageBtn"); pg.fill("#gotoInput", "46"); pg.press("#gotoInput", "Enter"); pg.wait_for_timeout(600)
    ok("go to page 46", cur() == 46, cur())
    # bookmark
    pg.click("#bSave"); pg.wait_for_timeout(200)
    ok("bookmark saved", pg.evaluate("JSON.parse(localStorage['duakitab.v1']).marks") == [46])
    # highlight
    pg.click("#bHl"); pg.wait_for_timeout(200)
    box = pg.locator('.pg[data-p="46"] .sheet').bounding_box()
    y = box["y"] + box["height"] * 0.385
    pg.mouse.move(box["x"] + box["width"] * 0.1, y); pg.mouse.down()
    pg.mouse.move(box["x"] + box["width"] * 0.5, y + 2, steps=5); pg.mouse.move(box["x"] + box["width"] * 0.9, y + 3, steps=5); pg.mouse.up()
    pg.wait_for_timeout(200)
    ok("highlight stored", len(pg.evaluate("JSON.parse(localStorage['duakitab.v1']).hl['46']||[]")) == 1)
    pg.screenshot(path="shots/04-highlight.png")
    pg.click("#hlDone")
    # scroll moves the counter
    pg.evaluate("document.getElementById('reader').scrollBy(0, 1200)"); pg.wait_for_timeout(500)
    ok("scrolling updates page counter", cur() > 46, cur())
    # tap hides bars
    pg.mouse.click(195, 420); pg.wait_for_timeout(300)
    ok("tap hides bars", pg.evaluate("document.body.classList.contains('bars-off')"))
    pg.mouse.click(195, 420); pg.wait_for_timeout(300)
    # dark
    pg.click("#pageBtn"); pg.fill("#gotoInput", "46"); pg.press("#gotoInput", "Enter"); pg.wait_for_timeout(500)
    pg.click("#themeBtn"); pg.wait_for_timeout(300)
    ok("dark mode on", pg.evaluate("document.documentElement.classList.contains('dark')"))
    pg.screenshot(path="shots/05-dark.png")
    # bookmarks list
    pg.click("#bMarks"); pg.wait_for_timeout(300); pg.screenshot(path="shots/06-bookmarks.png")
    ok("bookmark list has 1 + highlight list has 1", pg.locator("#marksList li button.go").count() == 1 and pg.locator("#hlList li button.go").count() == 1)
    pg.click("#marks [data-close]"); pg.wait_for_timeout(300)
    # home + paged
    pg.click("#bHome"); pg.wait_for_timeout(400); pg.screenshot(path="shots/07-home.png")
    pg.click('#modeSeg [data-mode="paged"]'); pg.wait_for_timeout(600); pg.click("#hContinue"); pg.wait_for_timeout(500)
    ok("page-by-page keeps page 46", cur() == 46, cur())
    pg.screenshot(path="shots/08-paged.png")
    pg.click("#next"); pg.wait_for_timeout(700)
    ok("Next goes to 47", cur() == 47, cur())
    sl = pg.evaluate("document.getElementById('reader').scrollLeft")
    ok("right-to-left paging (negative scroll)", sl < 0, sl)
    pg.click("#prev"); pg.wait_for_timeout(700); ok("Prev back to 46", cur() == 46, cur())
    # offline copy
    for _ in range(60):
        n = pg.evaluate("caches.open('pages-e1').then(c=>c.keys()).then(k=>k.length)")
        if n >= 200: break
        pg.wait_for_timeout(1000)
    ok("all 200 pages saved for offline", n == 200, n)
    # reload offline, state remembered
    ctx.set_offline(True)
    pg.goto(URL); pg.wait_for_selector(".pg"); pg.wait_for_timeout(1500)
    ok("opens offline", pg.locator(".pg").count() == 200)
    ok("offline: remembers page 46", cur() == 46, cur())
    ok("offline: remembers dark + paged", pg.evaluate("document.documentElement.classList.contains('dark') && document.getElementById('reader').classList.contains('paged')"))
    pg.click("#pageBtn"); pg.fill("#gotoInput", "150"); pg.press("#gotoInput", "Enter"); pg.wait_for_timeout(1200)
    ok("offline: far page image shows", pg.evaluate("document.querySelector('.pg[data-p=\"150\"] img').naturalWidth") == 1288)
    pg.screenshot(path="shots/09-offline-p150.png")
    ok("no script errors", not errs, errs[:3])
    b.close()
bad = [n for n, c in res if not c]
print("\nSUMMARY: %d passed, %d failed" % (len(res) - len(bad), len(bad)), bad)
