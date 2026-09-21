# GameMonetize dashboard map (verified Sept 2026)

All URLs relative to `https://gamemonetize.com`.

## URLs

| Page | URL | Notes |
|---|---|---|
| Login | `/login` | `input[type="email"]`, `input[name="password"]`, `button[type="submit"]` |
| Dashboard home | `/account/index.php` | revenue summary; `/dashboard` is a 404 |
| Add game | `/account/gameadd.php` | `input[name="name"]` (+auto `nameid`), button "Add Game" |
| My games | `/account/games.php` | rows: thumb, name, date, "Edit Game" link |
| Edit game | `/account/editgame.php?id=<numericId>` | THE page: upload, thumbs, metadata, verify, activation |
| Live build (fresh) | `https://uncached.gamemonetize.com/<GameId>/` | 200 seconds after zip upload |
| Live build (CDN) | `https://html5.gamemonetize.com/<GameId>/` | may 403 until verified/activated |
| Verify iframe | `https://html5.gamemonetize.co/<GameId>/?...&__inmodal=true` | note `.co` domain |

## Two different ids

- **numericId** — page/dashboard id, in URLs (`editgame.php?id=86697`).
- **GameId** — the real SDK id: 32-char `[a-z0-9]` token. Sources on the edit
  page: `input[name="custId"]` value, or the game URL fields, or regex
  `uncached\.gamemonetize\.com\/([a-z0-9]{32})\/`.

## Dropzone.js instances on editgame.php

| # | Endpoint | Accepts | Size |
|---|---|---|---|
| 0 | `upload.php?gameid=<GameId>&id=<numericId>` | zip | whole build |
| 1 | `upload_img.php?...&size=1` | `.jpg` only | **512×384** |
| 2 | `upload_img.php?...&size=2` | `.jpg` only | **512×512** |
| 3 | `upload_img.php?...&size=3` | `.jpg` only | **512×340** |

⚠️ Playwright `setInputFiles` on Dropzone's hidden input → server answers
`{"status":"The file you are trying to upload is not a .zip file."}`.
Always upload via **direct multipart POST** with
`mimeType: 'application/x-zip-compressed'` (zip) / `'image/jpeg'` (thumbs),
using the logged-in `context.request` (same cookies).

Zip success response: `{"status":"Your .zip file was uploaded and unpacked."}`

## Metadata form (editgame.php)

| Field | Selector | Notes |
|---|---|---|
| Name | `input[name="name"]` | |
| Categories | `select[name="category[]"]` (multi) | **min 2**; native select works |
| Tags | `select[name="tags[]"]` (multi, select2 UI) | 579 options; set via JS + `change` event |
| Description | `textarea[name="desc"]` | original text |
| Controls | `textarea[name="control"]` | input explanation |
| Width / Height | `input[name="width"]` / `input[name="height"]` | real game viewport (e.g. 960/540) |
| Mobile | `input[name="mobiledevices"]` (checkbox) | |

Save: `button:has-text("Save Changes")` — plain POST back to editgame.php.

## Verify Game flow

1. Click `a:has-text("Verify Game")` → custom modal
   `.sparkling-modal-frame` with `iframe#modal-frame` (900×600) loading the game.
2. The checker validates: real `sdk.js` loaded, `SDK_OPTIONS.gameId` == this
   GameId, and **`sdk.showBanner()` actually called** during the session.
3. When valid, it posts `{"type":"SDK_IMPLEMENTED"}` (visible via
   `page.on('console')` message logging) and a real Google IMA ad plays
   (frames from `imasdk.googleapis.com` appear).
4. **Close the modal and RELOAD the edit page** — the
   `input[name="activation"]` state is server-rendered at load; it loses
   `disabled` only after a fresh page load.
5. Click `input[name="activation"]:not([disabled])` (accept any `dialog`) →
   page shows **"Cancel review"** = submitted.

## Review behavior (differs from GamePix!)

- The build is **NOT locked** during review: re-upload a zip anytime.
- "Cancel review" (both edit-page buttons become this) withdraws the submission.
- No JWT/Bearer API — everything rides on session cookies.
