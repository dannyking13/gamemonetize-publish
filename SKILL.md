---
name: gamemonetize-publish
description: Integrate the GameMonetize SDK into ANY user-provided HTML5 game (any engine — Construct, Phaser, PixiJS, Unity WebGL, Godot, custom canvas) and publish it end-to-end on the GameMonetize developer dashboard — add game, get the GameId, inject it into SDK_OPTIONS, package the ZIP, upload (with the x-zip-compressed MIME trick), generate AI thumbnails (FLUX, no text), fill metadata, run the in-modal "Verify Game" SDK check by actually playing the game, then Request Activation. Use when the user wants to "publish a game on GameMonetize", "integrate gamemonetize sdk", "submit a game to gamemonetize", or "release an html5 game on gamemonetize".
version: 2.0.0
author: buffy
tags: [games, gamemonetize, sdk, playwright, publishing, ads]
---

# GameMonetize SDK Integration & Automated Publishing

This skill lets an AI agent take a **user-provided HTML5 game** (any engine, any
structure) and: (1) integrate the GameMonetize SDK correctly (events + ad
breaks, bridged onto the game's existing ad/pause calls if it came from another
portal), (2) generate the 3 required thumbnails with FREE AI generation
(FLUX — no text on assets), (3) package a compliant ZIP, and (4) publish it
end-to-end on `gamemonetize.com/account` via Playwright — from login to
**"Request activation"**, without any human interaction.

Everything below was validated in real end-to-end runs; the Verify recipe in
§1 (bridge v8 + one-tap robot) passed the official checker on 2026-09-22
(SDK_IMPLEMENTED → activation unlocked → "Cancel review" = submitted).

The **game is NOT created by the agent**: the user supplies the game (a folder
with `index.html` or an existing zip). The agent integrates the SDK, prepares
assets/metadata, and publishes.

## 0. Prerequisites

- Node.js + Playwright (`npm i playwright` + `npx playwright install chromium`)
- `xvfb-run` (Linux) — launch the browser **headed under Xvfb**, never plain
  headless (the dashboard tolerates headless for pure HTTP, but the Verify
  modal + IMA ads behave best headed; the gamepix skill's rule applies here too)
- Python3 + `pillow` for asset generation (`pip install pillow`)
- GameMonetize developer account: **email + password**. Credentials are read
  from env `GM_EMAIL` / `GM_PASSWORD`, or from the git-ignored
  `scripts/.gm_credentials` file (two lines: email, password).
- User agent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36`

## 1. Hard-won platform knowledge (read first!)

### Dashboard architecture (verified)
- There is **no** `gamemonetize.com/dashboard` (it's a 404). The dashboard is
  **`https://gamemonetize.com/account/index.php`**.
- Login: `https://gamemonetize.com/login` — plain form: `input[type="email"]`,
  `input[name="password"]`, `button[type="submit"]`. After login you land on
  `/account/index.php`. Save `storageState` to a session file and reuse it.
- Add game: `https://gamemonetize.com/account/gameadd.php` — fields
  `input[name="name"]` + `input[name="nameid"]` (auto-slugged), button
  **"Add Game"** → redirects to `/account/editgame.php?id=<numericId>`.
  **The numeric id is NOT the GameId** (see below).
- My games: `/account/games.php` — table rows with game name + "Edit Game"
  links (`editgame.php?id=<numericId>`).
- **Edit page (the everything page)**: `/account/editgame.php?id=<numericId>` —
  zip upload, 3 thumbnails, all metadata, "Verify Game", "Save Changes",
  "Request activation".

### GameId (critical!)
The **GameId is a 32-char token** (e.g. `tsoe9hidwrfs1435rnearr9yqvgxs6vu`),
not the numeric page id. Get it from the edit page — it appears in:
- `input[name="custId"]` → `value` attribute = the GameId,
- the "game URL" fields: `https://uncached.gamemonetize.com/<GameId>/` and
  `https://html5.gamemonetize.com/<GameId>/`.
Extract with: `page.$eval('input[name="custId"]', e => e.value)` or the regex
`/uncached\.gamemonetize\.com\/([a-z0-9]{32})\//` on `page.content()`.

### URLs of the live build
- **`https://uncached.gamemonetize.com/<GameId>/`** — fresh build, available
  seconds after upload. Use this to verify the build (fetch → expect 200 +
  your `index.html` content, with `sdk.js` and the GameId inside).
- `https://html5.gamemonetize.com/<GameId>/` — the public/CDN URL; may return
  403 until the game is verified/activated. The Verify modal uses
  `https://html5.gamemonetize.co/<GameId>/` (note `.co`) with
  `?m=account&__inmodal=true` params.

### The ZIP upload MIME trap (THE gotcha of the whole platform)
The dashboard uses **Dropzone.js** (4 instances on the edit page):
- instance #0 → zip upload, `upload.php?gameid=<GameId>&id=<numericId>`,
  accepts `application/zip,application/octet-stream,application/x-zip-compressed,multipart/x-zip,.zip`
- instances #1–3 → thumbnails, `upload_img.php?gameid=<GameId>&id=<numericId>&size=1|2|3`,
  accepts **`.jpg` only**, at exactly **512×384 (size=1), 512×512 (size=2),
  512×340 (size=3)**.

⚠️ **`page.setInputFiles()` on the Dropzone input sends the file with a MIME
type the server REJECTS**: the upload answers
`{"status":"The file you are trying to upload is not a .zip file. Please try again."}`
even though the file IS a zip. Filling Dropzone's hidden input does not help.

✅ **THE FIX — bypass Dropzone with a direct multipart POST** (same cookies:
use `context.request` of a logged-in context):
```js
const r = await ctx.request.post(
  `https://gamemonetize.com/account/upload.php?gameid=${gid}&id=${numId}`,
  { multipart: { file: { name: 'game.zip', mimeType: 'application/x-zip-compressed', buffer: zipBuf } } });
// success body: {"status":"Your .zip file was uploaded and unpacked."}
```
`application/x-zip-compressed` + filename ending in `.zip` is the combination
the server accepts. Thumbnails: same call to `upload_img.php?...&size=N` with
`mimeType: 'image/jpeg'`, name ending `.jpg`.

The build goes live on `uncached.gamemonetize.com/<GameId>/` within seconds of
the "unpacked" response (poll 3–4×/5s to confirm).

### ⚠️ CDN cache = 10 years per file, per GameId (campaign-proven)
Served files (from `html5.gamemonetize.co/<GameId>/…`, where the Verify modal
loads the build) are cached with `cache-control: max-age=315360000` (TEN
YEARS) — verified via response headers. The `html5.gamemonetize.com/<GameId>`
301-chain also funnels into that cache (`max-age=432000` at the first hop).

Consequences:
- **Re-uploading a zip to an EXISTING game NEVER updates what the Verify modal
  serves.** `uncached.gamemonetize.com` has the new build; the modal CDN keeps
  serving the old one forever.
- **If the served build must change → create a NEW game draft** (new GameId =
  cold cache). The FIRST zip uploaded to a token is the one the checker will
  see. Decide the build version BEFORE the first upload.
- Sanity check before verifying: `curl -sL
  https://html5.gamemonetize.co/<GameId>/<changed-file> | grep -c <vN-marker>`
  (a version marker string from your driver) — must be > 0.

### Verify Game — EXACT working recipe (validated 2026-09-22)
Clicking `a:has-text("Verify Game")` opens a modal (`.sparkling-modal-frame`)
with iframe `#modal-frame` → `https://html5.gamemonetize.co/<GameId>/?m=account&__inmodal=true`.
The checker posts `{"type":"SDK_IMPLEMENTED"}` to the top window **only when a
real Google IMA ad completes** (IMA `CONTENT_RESUME_REQUESTED` → SDK posts
`SDK_IMPLEMENTED`). Decoded from the obfuscated sdk.js — there is no shortcut.

Key facts:
- **The SDK fires NOTHING on its own at `SDK_READY`.** No auto-preroll. If an
  ad request appears without a call, it came from game code.
- **`showBanner` does not exist in sdk.js** — it is installed on the `sdk`
  object by the page snippet. Calls to it only turn into a REAL IMA request if
  they happen **inside a genuine user-gesture task** (pointerdown/keydown).
  Timer/boot/flush calls either fail silently or get the ad request cancelled
  (`AD_CANCELED "Advertisement has been canceled"`).
- **ONE tap, then SILENCE.** Robot clicking during the 10–15s ad playback
  cancels the IMA cycle (multiple `SHOW_BANNER` calls cancel the pending ad).
  The old 35-clicks-per-round robot ALWAYS failed this way. Exactly one real
  click inside the frame, then ≥45s of no input, is what validated.

Working robot flow (see `scripts/activate.js`):
1. Open the modal, find the `html5.gamemonetize.co/` frame.
2. ONE `frame.click('canvas')` (real coordinates, inside the frame) — the
   in-game bridge fires THE single `showBanner()` inside that gesture task.
3. Observe silently ≥45s (the ad plays 10–15s) for `SDK_IMPLEMENTED` in
   console/postMessage. Do not click again.
4. Close modal, **reload `editgame.php`**, check
   `input[name="activation"]:not([disabled])` (server-rendered unlock), click
   **Request activation**, confirm **"Cancel review"** appears = submitted.

Never verified with: queued boot breaks flushed on first interaction (cancels
the in-gesture ad), timer-fired open ad (no gesture → AD_CANCELED),
multi-click "playing" (kills the cycle mid-playback).

⚠️ The **"Request activation" button state is SERVER-RENDERED at page load**.
Nothing changes live in the modal flow. After a successful verify you must
**close the modal and RELOAD `editgame.php`** — then `input[name="activation"]`
loses its `disabled` attribute. Then click it (accept any `dialog`), and the
page now shows **"Cancel review"** = the game is submitted to their content
team. (Unlike GamePix, GameMonetize has a "Cancel review" button — the build
is NOT locked while in review; you can re-upload a new zip anytime.)

### Ad policy (enforced by review)
- Frequency-cap `sdk.showBanner()` (≥45s between calls) and only at natural
  breaks (game over, level end) — never timer-based mid-gameplay.
- MANDATORY: on `SDK_GAME_PAUSE` pause the game loop AND mute all audio;
  on `SDK_GAME_START` resume + unmute. Background audio during ads = reject.
- One ad flow at a time; never call `showBanner()` re-entrantly. While an ad
  cycle is in flight, ANY further `showBanner()` cancels it.

### The ONE-AD boot rule for bridged engines (v8 bridge — the proven pattern)
Engines like Construct call `commercialBreak()` during boot/loading. That call
must NOT produce a `showBanner()` (no gesture yet → never serves, and it can
cancel the checker's later ad). The validated bridge (`gm_bridge_poki.js` in
the campaign, pattern below):
1. Boot-time breaks are **queued** (promise pending, engine paused).
2. The **first real interaction** (pointerdown/keydown, capture) fires **the
   single open `showBanner()` inside the gesture task**, pushes the queue's
   resolver into the `SDK_GAME_START` resume list (12s hard timeout fallback).
3. After that, breaks flow normally through the 45s frequency cap.
4. No timers, no boot flush, no gesture re-fire — ONE ad in ONE gesture.

```js
var queuedBoot = [], bootAdDone = false, lastBreak = 0;
var RESUME = [];                                  // released by SDK_GAME_START
function markInteraction() {                      // pointerdown/keydown capture
  if (bootAdDone) return; bootAdDone = true;
  var s = window.sdk, w = queuedBoot.splice(0);
  lastBreak = Date.now();
  if (s && s.showBanner) try { s.showBanner(); } catch (e) {}
  if (w.length) {                                 // release queued boot breaks
    var fin = function () { w.forEach(function (r) { try { r(); } catch (e) {} }); };
    RESUME.push(fin); setTimeout(fin, 12000);
  }
}
document.addEventListener('pointerdown', markInteraction, true);
document.addEventListener('keydown', markInteraction, true);
// commercialBreak(): if (!bootAdDone) { queuedBoot.push(resolve); return; }
```

## 2. Integrate the SDK (mandatory first script)

Insert in `<head>` or before the game scripts in `index.html`:

```html
<script type="text/javascript">
window.SDK_OPTIONS = {
  gameId: "THE_32_CHAR_GAME_ID",
  onEvent: function (a) {
    switch (a.name) {
      case "SDK_GAME_START":
        // advertisement done, resume game logic and unmute audio
        break;
      case "SDK_GAME_PAUSE":
        // advertisement ready, pause game logic and MUTE audio
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
```

Ad call (at natural breaks, frequency-capped):
```js
if (typeof sdk !== 'undefined' && sdk.showBanner) sdk.showBanner();
```

Leave the GameId as the placeholder `__GM_GAME_ID__` in the file if you prefer:
`scripts/publish.js` injects the real GameId automatically after creating the
game (`GM_GAME_ID_PLACEHOLDER`, default `__GM_GAME_ID__`, or it replaces the
existing `gameId: "..."` value in `SDK_OPTIONS` when `GM_INJECT_SDK=true`).

### 2a. Games coming from another portal: install the AD BRIDGE
If the user's game calls another platform's SDK (Poki, GameSnacks,
GameDistribution…), grep the code and bridge those calls onto GameMonetize
**instead of stripping them** — the game already pauses itself around its own
ad-break flow, which is exactly what the SDK expects:

| Game calls | Bridge to |
|---|---|
| `PokiSDK.commercialBreak()` / `GameSnacks.ad.break({type:"next"})` / GD `showAd()` | pause+mute locally, `sdk.showBanner()`, resume+unmute in the `SDK_GAME_START` event |
| `PokiSDK.rewardedBreak()` / reward flows | `sdk.showBanner()` before granting the reward (resume logic gates the reward on ad completion) |
| `PokiSDK.gameLoadingFinished()` / `GameSnacks.game.ready()` | nothing needed (SDK handles itself) |
| mute/pause helpers | wire them into `SDK_GAME_PAUSE` / `SDK_GAME_START` |

Minimal bridge pattern (load before game scripts):
```js
window.__gmAdBreak = function (onDone) {
  var done = false;
  var finish = function () { if (!done) { done = true; onDone && onDone(); } };
  window.__gmResumeHook = finish;           // SDK_GAME_START calls this
  if (typeof sdk !== 'undefined' && sdk.showBanner) sdk.showBanner();
  setTimeout(finish, 8000);                  // hard timeout: never freeze gameplay
};
```
…and in `SDK_OPTIONS.onEvent`: `case "SDK_GAME_START": window.__gmResumeHook && window.__gmResumeHook();`

- For games from other portals, install the **v8 boot-ad bridge** (§1 "ONE-AD
  boot rule"): queue boot breaks, fire the single open ad inside the first
  real gesture task. Reference implementation used in the successful run:
  C3 games — `game-driver.js` replacing the Poki stub, `commercialBreak()` →
  queued-then-flushed on first interaction, `rewardedBreak()` → resolve on
  `SDK_GAME_START` with the 45s cap.

## 3. Compliance checklist (review will fail otherwise)

- ZIP with **`index.html` at the archive ROOT** (not inside a folder). Small build.
- All resources relative paths; no external links/analytics/third-party ad SDKs.
- Mute audio during `SDK_GAME_PAUSE` (hard requirement — see §1).
- Works in an iframe (the Verify modal runs it at 900×600; set
  `width`/`height` metadata to your real viewport).
- Thumbnails: **3 JPGs — 512×384, 512×512, 512×340** — representative of the
  game, **NO text/names/logos on assets** — generate with AI (§5).
- Description: original, meaningful, no AI boilerplate. Controls field:
  explain input (mouse/drag/keys), Desktop + Mobile.
- Categories: **min 2**. Tags: pick ~8–10 relevant ones (they are required).

### Asset generation rules (MANDATORY)
- **Submitted thumbnails MUST be AI-generated** (FLUX via `scripts/gen_assets.py`
  or the pollinations.ai image API — a real AI engine, no key; retry on 500/429).
- **NEVER generate/substitute assets yourself** (no PIL fallback, no hand-drawn,
  no procedurally drawn art in the submission). If the AI generation fails or the
  quota is exhausted: **STOP and report the problem to the user** — do not publish
  with substitute assets.
- `publish.js` runs `gen_assets.py --no-fallback` accordingly: any AI failure
  aborts the pipeline before upload.
- Use the optional HF token file `scripts/.hf_token` (or `HF_TOKEN` env) to raise
  the anonymous ZeroGPU quota — BUT verify the token actually works first: an
  invalid/expired token makes HF Spaces fail where anonymous requests succeed
  (observed). Test with a 1-off generation before bulk runs.
- **PERSIST generated assets in the repo**, never in `/tmp`:
  `gamemonetize-publish/assets/<game-slug>/thumb_512x{384,512,340}.jpg`.
  /tmp gets wiped between sessions — assets were lost and re-generated that
  way. `gen_assets.py --out-dir` points there; publish.js re-uploads from
  there (`GM_THUMB_DIR=assets/<game-slug>`).
- Keep the SOURCE images too (square + wide) when regenerating sizes is cheaper
  than re-generating art.

### Dashboard limits — ALWAYS read them, never exceed
- Read the actual field limits (min/max, required counts) from the dashboard page
  and/or `references/dashboard-map.md` before filling anything.
- Categories: the dashboard requires **min 2** — provide exactly the categories
  you intend (from the dashboard's own 21 options), **never auto-fill extras** to
  "reach" a minimum; if the provided list can't satisfy the minimum, FAIL and ask.
- Same discipline everywhere: description length, tags count, image sizes/dims.

### Game naming rule (IMPORTANT — read before publishing)
The GitHub repo name / project folder name is just an **internal label** — the
games shipped by this workflow carry **NO name inside the build** (no title in
the zip, no text on the assets). Therefore:
- **NEVER** blindly reuse the GitHub repo/folder name as the game title.
- At publish time, the agent **chooses the game name itself**, right before
  going live: a fresh, catchy, **on-topic** title that reflects what the game
  actually does (read the code, play the game first). Not off-topic, not
  generic ("My Game", "Untitled"), not a clone of a famous title.
- The chosen title becomes `GM_TITLE` (dashboard name + nameid slug + zip
  filename). Assets stay text-free (§5) — the title lives ONLY in the
  dashboard metadata.

## 4. Automated publishing via Playwright

Full working implementation: `scripts/publish.js` (this repo). Usage:

```bash
GM_EMAIL=you@example.com GM_PASSWORD='secret' \
GM_TITLE="My Game" GM_GAME_DIR=./my-game \
GM_CATEGORIES="Arcade,Hypercasual,Action" GM_TAGS="1 Player,Avoid,HTML5,Mobile" \
GM_DESC="Original 200-400 char description..." \
GM_CONTROLS="Desktop: mouse / arrows. Mobile: touch and drag." \
GM_WIDTH=960 GM_HEIGHT=540 \
GM_PROMPT="neon arcade orbs and gems on a dark space background, vibrant colors, clean vector style" \
xvfb-run -a node scripts/publish.js
# optional: GM_ZIP=game.zip (skip packaging), GM_THUMB_DIR=./assets (skip AI gen),
#           GM_EXISTING_ID=86697 (edit an existing game instead of creating one)
```

The script performs, in order (each step verified):
1. Login (re-login if redirected to /login; saves `scripts/.gm_session.json`).
2. Create the game via `gameadd.php` (or reuse `GM_EXISTING_ID`) → capture the
   numeric id from the redirect to `editgame.php?id=<numericId>`.
3. Extract the **GameId** from `input[name="custId"]`.
4. Inject the GameId into `index.html` (placeholder replacement).
5. Package the ZIP (`index.html` at root) if `GM_ZIP` not provided.
6. Direct-multipart upload of the ZIP (x-zip-compressed) → expect
   `"Your .zip file was uploaded and unpacked."` → poll
   `uncached.gamemonetize.com/<GameId>/` until 200.
7. Generate (or reuse) the 3 JPG thumbnails → direct-multipart upload to
   `upload_img.php?...&size=1/2/3`.
8. Fill metadata: name, categories (≥2), tags, desc, controls, width/height,
   mobile checkbox → **Save Changes**.
9. **Verify Game**: open the modal, fire **ONE real click inside `#modal-frame`**
   (the in-game bridge fires the open ad inside that gesture task), then
   observe silently ≥45s for `SDK_IMPLEMENTED`. Do not click during ad
   playback. Close the modal.
10. Reload the edit page → confirm `input[name="activation"]` is enabled →
    click **Request activation** (auto-accept dialogs) → confirm the page now
    shows **"Cancel review"**.

### Gotchas that will bite you
- The zip MIME trap (§1) — never use Dropzone's input for the zip.
- The activation button only unlocks after a **page reload** post-verify.
- If verification fails (`SDK_IMPLEMENTED` never seen): check the served build
  version first (CDN cache, §1) — the modal may be running an OLD build. Then
  check `sdk.showBanner()` fired (gesture reached the canvas) and that IMA
  network requests followed (`gampad/ads` / `pagead`). showBanner without IMA
  traffic = no gesture context = bridge/boot issue. **Do NOT mash clicks** —
  clicks during ad playback abort the cycle.
- `https://gamemonetize.com/dashboard` is a 404; always use `/account/...`.
- The tags `<select>` is a select2 widget with 579 options; set the underlying
  `select[name="tags[]"]` options via JS + `change` event (works fine), or
  drive the select2 UI with real clicks.
- Metadata Save is a plain form POST back to `editgame.php` — re-check the
  fields persisted after saving.

## 5. Creating thumbnails with FREE AI generation (mandatory method)

Use `scripts/gen_assets.py` — same proven method as the gamepix-publish skill:
**FLUX via anonymous Gradio API of Hugging Face Spaces**, no account, no API
key. Optional `HF_TOKEN` (env or `scripts/.hf_token`) raises the quota.

```bash
pip install pillow
python3 scripts/gen_assets.py \
  --prompt "two glowing neon orbs collecting gems on a dark starfield, \
vibrant cyan and magenta, clean vector style" \
  --out-dir ./assets
# -> assets/thumb_512x384.jpg + assets/thumb_512x512.jpg + assets/thumb_512x340.jpg
```

Rules (same as gamepix):
- `--prompt` is a **VISUAL description of the game only** — NEVER render the
  title or any words. The script appends a no-text ban-suffix to every prompt.
- Generates 2 images (landscape 1024×768 + square 1024×1024), then cover-crops
  to the 3 exact GM sizes and saves as JPEG (quality 88, well under limits).
- Spaces tried in order: `FLUX.1-schnell` (fast) then `FLUX.1-dev`, with
  exponential backoff (anonymous ZeroGPU quota is per-IP and rolling).
- ⚠️ The PIL fallback is **DISABLED for submissions** (`--no-fallback`): if all
  AI attempts fail, the script **exits non-zero and publishing stops**. The
  fallback output is only for local mock testing, never for a live upload.
- Backup AI engine when every HF Space is saturated: pollinations.ai
  (`https://image.pollinations.ai/prompt/<urlencoded>?width=768&height=768&nologo=true&seed=<rand>`
  — free, no key, AI-generated; retry a few times on 500/429). Cover-crop the
  two source images into the 3 GM sizes with the same rules (no text).

## 6. What "done" looks like

- `uncached.gamemonetize.com/<GameId>/` serves your build (200, contains
  `sdk.js` + your GameId).
- Edit page shows **"Cancel review"** (activation requested) instead of the
  disabled "Request activation" inputs.
- My Games list shows the game with its release date set.
- Notify the user: submitted, their content team reviews (usually a few days);
  the build can be updated anytime by re-uploading a zip (no review lock);
  "Cancel review" withdraws it.

## References

- SDK doc: https://gamemonetize.com/sdk and
  https://github.com/MonetizeGame/GameMonetize.com-SDK
- Dashboard: https://gamemonetize.com/account/index.php (login: /login)
- Related skill: `gamepix-publish` (same asset-generation method, same
  Playwright style, GamePix dashboard automation)
