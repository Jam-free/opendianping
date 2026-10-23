from playwright.sync_api import sync_playwright
import re
R=["home","friends","friend-y","shop-1","import","import-loading","import-preview","import-done","locate","locate-note-2","locate-done","invite","accept","shop-7"]
errs=[]
with sync_playwright() as p:
  b=p.chromium.launch();pg=b.new_page(viewport={"width":375,"height":812},device_scale_factor=2)
  pg.on("pageerror",lambda e:errs.append(str(e)))
  pg.goto("file:///workspace/feimao-design/v3-swiss/index.html")
  seen=set()
  for r in R:
    pg.goto(f"file:///workspace/feimao-design/v3-swiss/index.html#{r}");pg.wait_for_timeout(250)
    pg.screenshot(path=f"shot-{r}.png")
    for h in pg.eval_on_selector_all("a[href^='#']","e=>e.map(x=>x.getAttribute('href'))"): seen.add(h)
    # overlap: text overflow & content behind bar at bottom scroll
    ov=pg.evaluate("""()=>[...document.querySelectorAll('.name,.meta,.rec,.dist,.kv span,h1')].filter(e=>e.scrollWidth>e.clientWidth+1&&getComputedStyle(e).textOverflow!='ellipsis').map(e=>e.textContent)""")
    if ov: errs.append((r,"overflow",ov))
  ok={x.split('-')[0] for x in R}
  for h in seen:
    pg.goto("file:///workspace/feimao-design/v3-swiss/index.html"+h);pg.wait_for_timeout(100)
    if not pg.inner_text("#app").strip(): errs.append(("dead",h))
  # font check
  print(pg.evaluate("document.fonts.check('16px \"Noto Sans CJK SC\"')"), pg.evaluate("document.fonts.check('48px Oswald')"))
  print("links",len(seen),sorted(seen)); print("errs",errs)
  b.close()
