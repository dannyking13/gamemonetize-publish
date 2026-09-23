#!/usr/bin/env python3
"""Prepare the 3 new games (Dark Hood / Frosty Rush / Pocket Golf) for GameMonetize.

Per game: copy repo -> neutralize old titles/branding -> replace stub
game-driver.js with the GM bridge (GameSnacks surface, v8 ad rules) ->
inject SDK snippet (placeholder __GM_GAME_ID__) into index.html <head> -> zip.
"""
import os, re, shutil, subprocess

ROOT = os.path.dirname(os.path.abspath(__file__))   # /sec/root/batch3
B3 = os.path.join(ROOT, 'b3')
OUT = os.path.join(ROOT, 'gm3')

GAMES = {
    'he-likes-the-darkness': {'dir': 'gm-darkhood', 'title': 'Dark Hood'},
    'build-a-snowman':       {'dir': 'gm-snowman',  'title': 'Frosty Rush'},
    'paper-golf':            {'dir': 'gm-golf',     'title': 'Pocket Golf'},
}

BRIDGE = open(os.path.join(ROOT, 'gs_bridge_gm.js'), encoding='utf-8').read()

SDK_SNIPPET = """<script type="text/javascript">
window.SDK_OPTIONS = {
  gameId: "__GM_GAME_ID__",
  onEvent: function (a) {
    switch (a.name) {
      case "SDK_GAME_START":
        break;
      case "SDK_GAME_PAUSE":
        break;
      case "SDK_READY":
        break;
    }
  }
};
(function (a, b, c) {
  var d = a.getElementsByTagName(b)[0];
  a.getElementById(c) || (a = a.createElement(b), a.id = c, a.src = "https://api.gamemonetize.com/sdk.js", d.parentNode.insertBefore(a, d))
})(document, "script", "gamemonetize-sdk");
</script>
"""

os.makedirs(OUT, exist_ok=True)

for src, cfg in GAMES.items():
    s = os.path.join(B3, src)
    d = os.path.join(OUT, cfg['dir'])
    if os.path.exists(d):
        shutil.rmtree(d)
    shutil.copytree(s, d)
    T = cfg['title']

    # 1) replace every stub game-driver.js with the GM bridge
    replaced = 0
    for dirpath, _dirs, files in os.walk(d):
        for fn_ in files:
            if fn_ == 'game-driver.js':
                with open(os.path.join(dirpath, fn_), 'w', encoding='utf-8') as f:
                    f.write(BRIDGE)
                replaced += 1

    # 2) index.html: retitle + SDK injection (first head element)
    ip = os.path.join(d, 'index.html')
    html = open(ip, encoding='utf-8').read()
    html = re.sub(r'<title>[^<]*</title>', '<title>%s</title>' % T, html)
    html = re.sub(r'(<meta\s+name="apple-mobile-web-app-title"\s+content=")[^"]*(")',
                  lambda m: m.group(1) + T + m.group(2), html)
    html = re.sub(r'(<meta\s+name="application-name"\s+content=")[^"]*(")',
                  lambda m: m.group(1) + T + m.group(2), html)
    html = re.sub(r'(<meta\s+name="author"\s+content=")[^"]*(")',
                  lambda m: m.group(1) + T + m.group(2), html)
    html = re.sub(r'(<meta\s+name="description"\s+content=")[^"]*(")',
                  lambda m: m.group(1) + T + m.group(2), html)
    # C3 PWA manifest would carry the old name -> drop the link
    html = re.sub(r'<link\s+rel="manifest"[^>]*>\s*', '', html)
    if '<head' in html:
        html = re.sub(r'(<head[^>]*>)', lambda m: m.group(1) + '\n' + SDK_SNIPPET, html, count=1)
    else:
        html = SDK_SNIPPET + html
    with open(ip, 'w', encoding='utf-8') as f:
        f.write(html)

    # 3) other title-bearing files
    am = os.path.join(d, 'appmanifest.json')          # C3 manifest (darkness)
    if os.path.exists(am):
        txt = open(am, encoding='utf-8').read()
        txt = re.sub(r'("name"\s*:\s*")[^"]*(")', lambda m: m.group(1) + T + m.group(2), txt, count=1)
        txt = re.sub(r'("short_name"\s*:\s*")[^"]*(")', lambda m: m.group(1) + T + m.group(2), txt, count=1)
        txt = re.sub(r'("description"\s*:\s*")[^"]*(")', lambda m: m.group(1) + T + m.group(2), txt, count=1)
        open(am, 'w', encoding='utf-8').write(txt)
    dj = os.path.join(d, 'data.js')                   # C3 runtime sets document.title (darkness)
    if os.path.exists(dj):
        txt = open(dj, encoding='utf-8', errors='replace').read()
        txt = txt.replace("'He Likes The Darkness'", "'" + T + "'")
        txt = txt.replace('"He Likes The Darkness"', '"' + T + '"')
        open(dj, 'w', encoding='utf-8').write(txt)
    i18n = os.path.join(d, 'assets', 'i18n')          # snowman: localized descriptions
    if os.path.isdir(i18n):
        for fn2 in os.listdir(i18n):
            if fn2.endswith('.json'):
                p2 = os.path.join(i18n, fn2)
                txt = open(p2, encoding='utf-8').read()
                txt = re.sub(r'Build [Aa] [Ss]nowman', T, txt)
                open(p2, 'w', encoding='utf-8').write(txt)

    # 4) zip
    zpath = os.path.join(ROOT, cfg['dir'] + '-v8.zip')
    if os.path.exists(zpath):
        os.remove(zpath)
    subprocess.run(['zip', '-qr', zpath, '.'], cwd=d, check=True)
    n = sum(len(f) for _r, _dd, f in os.walk(d))
    print(f"{cfg['dir']}: driver replaced x{replaced}, titles->'{T}', SDK injected, {n} files -> {zpath}")

print("done")
