# gamemonetize-publish

AI-driven skill to **integrate the GameMonetize SDK into any user-provided HTML5
game and publish it end-to-end** on the GameMonetize developer dashboard — no
human interaction. Companion skill to
[`gamepix-publish`](https://github.com/dannyking13/gamepix-publish)
(same structure, same AI-asset method).

## What it does

1. **SDK integration** — inserts the official `SDK_OPTIONS` + `sdk.js` loader
   into the game's `index.html`, wires `SDK_GAME_PAUSE` (pause + MUTE) /
   `SDK_GAME_START` (resume + unmute), and adds frequency-capped
   `sdk.showBanner()` ad breaks at natural moments (game over, level end).
   Games coming from Poki/GameSnacks/GameDistribution keep their ad calls —
   they get bridged onto GameMonetize instead of being stripped.
2. **AI thumbnails** — generates the 3 required JPGs
   (512×384, 512×512, 512×340) with FLUX via Hugging Face's anonymous Gradio
   API: **no account, no API key**, text-free by construction (same method as
   gamepix-publish; pollinations.ai as backup engine when every Space is
   saturated). Submitted assets MUST be AI-generated: the PIL fallback is
   DISABLED for submissions (`--no-fallback`) — if every engine fails,
   publishing STOPS and the problem is reported. Thumbnails are persisted in
   `assets/<game-slug>/` so they survive between sessions and can be reused
   via `GM_THUMB_DIR`.
3. **ZIP packaging** — `index.html` at the archive root, all paths relative.
4. **Dashboard automation (Playwright)** — login → Add Game → capture the
   32-char **GameId** → inject it into `SDK_OPTIONS` → direct multipart upload
   of the zip (the `application/x-zip-compressed` MIME is mandatory — Dropzone
   rejects Playwright's default) → upload the 3 thumbnails → fill metadata
   (categories ≥2, tags, description, controls, dimensions) → **Verify Game**
   by actually PLAYING the game inside the verify modal until the checker
   posts `SDK_IMPLEMENTED` → reload → **Request activation** → confirm
   "Cancel review".

## Layout

```
SKILL.md                  ← the skill: read this first (platform knowledge, SDK doc, gotchas)
scripts/publish.js        ← one-shot end-to-end publisher (env-var driven)
scripts/activate.js       ← verify + request activation ONLY (re-run a stuck game)
scripts/gen_assets.py     ← AI thumbnails (FLUX anonymous + pollinations backup, 3 exact GM sizes)
scripts/.gm_credentials   ← git-ignored: line1 = email, line2 = password (or use GM_EMAIL/GM_PASSWORD)
scripts/.hf_token         ← git-ignored: optional HF token to raise FLUX quota
scripts/.gm_session.json  ← saved browser session (created automatically)
references/dashboard-map.md ← verified URL + selector map of the dashboard
assets/<game-slug>/        ← persisted generated thumbnails (reused via GM_THUMB_DIR)
LICENSE                    ← MIT
```

## Quick start

```bash
npm i playwright && npx playwright install chromium   # once
pip install pillow                                    # once

GM_EMAIL=you@example.com GM_PASSWORD='secret' \
GM_TITLE="My Game" GM_GAME_DIR=./my-game \
GM_CATEGORIES="Arcade,Hypercasual,Action" \
GM_TAGS="1 Player,Arcade,HTML5,Hypercasual,Mobile" \
GM_DESC="Original 200-400 char description..." \
GM_CONTROLS="Desktop: mouse / arrows. Mobile: touch and drag." \
GM_WIDTH=960 GM_HEIGHT=540 \
GM_PROMPT="neon arcade orbs and gems on a dark space background, vibrant colors" \
xvfb-run -a node scripts/publish.js
```

Options: `GM_ZIP` (skip packaging), `GM_THUMB_DIR` (skip AI gen),
`GM_EXISTING_ID` (edit an existing game), `GM_INJECT_SDK=true`,
`GM_SKIP_VERIFY`, `GM_SKIP_ACTIVATE`.

## Validated end-to-end (Sept 2026)

Game "Gemini Rush": created → GameId `tsoe9hid…` extracted and injected →
zip uploaded + unpacked → build live on
`uncached.gamemonetize.com/<GameId>/` → verify modal played → real Google IMA
ad served → `{"type":"SDK_IMPLEMENTED"}` → activation requested →
"Cancel review" shown.

## Notes

- The game itself is **user-provided** — the agent only integrates the SDK,
  prepares assets/metadata, and publishes.
- Unlike GamePix, GameMonetize does NOT lock the build during review: you can
  re-upload a new zip anytime, and "Cancel review" withdraws the submission.
- The SDK doc: https://gamemonetize.com/sdk ·
  https://github.com/MonetizeGame/GameMonetize.com-SDK
