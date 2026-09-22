#!/usr/bin/env python3
"""Generate GameMonetize-compliant thumbnails with FREE AI generation (NO account needed).

Same proven method as gamepix-publish/scripts/gen_assets.py: anonymous Gradio API
of Hugging Face Spaces running FLUX — a plain POST + SSE read gives an image URL;
no signup, no API key. Optional HF_TOKEN raises the ZeroGPU anonymous quota.
Backup engine when every HF Space is saturated: pollinations.ai (free, no key,
AI-generated) — SKILL.md §5.

Outputs (in --out-dir), JPG, no text:
  thumb_512x384.jpg   (dashboard slot size=1)
  thumb_512x512.jpg   (dashboard slot size=2)
  thumb_512x340.jpg   (dashboard slot size=3)

Rules enforced:
  - NO text on assets: prompts ban text/letters/logos/watermarks; --prompt must be
    a VISUAL description only (never ask it to draw the game title).
  - Exact GameMonetize dimensions (512x384, 512x512, 512x340), JPEG format.
  - 2 AI images are generated (landscape + square) and cover-cropped to the 3 sizes.
  - Submitted assets MUST be AI-generated: with --no-fallback (used by publish.js),
    an AI failure EXITS 1 instead of drawing PIL substitutes — STOP and report,
    never publish hand-made assets.

Usage:
  pip install pillow
  python3 gen_assets.py --prompt "two glowing neon orbs collecting gems on a dark \
starfield, vibrant cyan and magenta, clean vector style" --out-dir ./assets
"""
import argparse
import json
import os
import sys
import time
import urllib.request


def _load_token() -> str:
    """HF token (raises ZeroGPU anonymous quota). Env HF_TOKEN or scripts/.hf_token."""
    tok = os.environ.get("HF_TOKEN", "").strip()
    if tok:
        return tok
    here = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".hf_token")
    for p in (here, os.path.expanduser("~/.hf_token")):
        try:
            if os.path.isfile(p):
                with open(p) as f:
                    tok = f.read().strip()
                if tok:
                    return tok
        except OSError:
            pass
    return ""


TOKEN = _load_token()

SPACES = [
    {"name": "FLUX.1-schnell", "host": "black-forest-labs-flux-1-schnell.hf.space",
     "steps": 4, "extra": [], "timeout": 300},
    {"name": "FLUX.1-dev", "host": "black-forest-labs-flux-1-dev.hf.space",
     "steps": 28, "extra": [3.5], "timeout": 600},
]

NO_TEXT = ("no text, no letters, no words, no numbers, no typography, no logo, "
           "no watermark, no signature, no border frame")

WIDE_PROMPT = ("wide landscape game cover art: {p}, dynamic full scene, detailed "
               "background, cinematic lighting, vibrant colors, {n}")
SQUARE_PROMPT = ("square game art: {p}, centered composition, detailed background, "
                 "vibrant colors, {n}")

SIZES = [(512, 384), (512, 512), (512, 340)]


def _headers() -> dict:
    h = {"Content-Type": "application/json", "User-Agent": "Mozilla/5.0"}
    if TOKEN:
        h["Authorization"] = f"Bearer {TOKEN}"
    return h


def post_call(space: dict, prompt: str, width: int, height: int, seed: int) -> str:
    data = [prompt, seed, seed < 0, width, height, *space["extra"], space["steps"]]
    payload = json.dumps({"data": data}).encode()
    req = urllib.request.Request(
        f"https://{space['host']}/gradio_api/call/infer", data=payload,
        headers=_headers())
    with urllib.request.urlopen(req, timeout=60) as r:
        body = json.loads(r.read())
    event_id = body.get("event_id")
    if not event_id:
        raise RuntimeError(f"no event_id: {body}")
    return event_id


def wait_result(space: dict, event_id: str) -> str:
    url = f"https://{space['host']}/gradio_api/call/infer/{event_id}"
    with urllib.request.urlopen(url, timeout=space["timeout"]) as r:
        ev = None
        for raw in r:
            line = raw.decode("utf-8", "replace").rstrip("\n\r")
            if line.startswith("event: "):
                ev = line[7:]
            elif line.startswith("data: ") and ev == "complete":
                data = json.loads(line[6:])
                if not data or not data[0]:
                    raise RuntimeError("empty result (busy or quota) — retry")
                return data[0]["url"]
            elif line.startswith("data: ") and ev == "error":
                raise RuntimeError(f"generation error: {line[6:][:150]}")
    raise RuntimeError("SSE ended without result")


def download(url: str, out: str) -> None:
    req = urllib.request.Request(url, headers=_headers())
    with urllib.request.urlopen(req, timeout=120) as r, open(out, "wb") as f:
        f.write(r.read())


def gen_image_pollinations(prompt: str, width: int, height: int, seed: int,
                           retries: int = 4, backoff: int = 15) -> str:
    """Backup engine when every HF Space is saturated: pollinations.ai.
    Free, no key, AI-generated; retry a few times on 500/429 (SKILL.md §5)."""
    import urllib.parse
    last = None
    url = ("https://image.pollinations.ai/prompt/" + urllib.parse.quote(prompt)
           + f"?width={width}&height={height}&nologo=true&seed={seed}")
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=180) as r:
                ctype = r.headers.get("Content-Type", "")
                if not ctype.startswith("image/"):
                    raise RuntimeError(f"unexpected content-type: {ctype}")
                return url
        except Exception as e:  # noqa: BLE001
            last = e
            print(f"  pollinations try {i+1}/{retries}: {e}")
            if i < retries - 1:
                time.sleep(backoff * (i + 1))
    raise RuntimeError(f"pollinations failed: {last}")


def gen_source(prompt: str, width: int, height: int, seed: int, retries: int,
               out_path: str) -> None:
    """FLUX (HF Spaces) first; pollinations.ai only when every Space fails."""
    try:
        url = gen_image(prompt, width, height, seed, retries)
        download(url, out_path)
        return
    except Exception as e:  # noqa: BLE001
        print(f"  all HF Spaces failed ({e}) — falling back to pollinations.ai")
    url = gen_image_pollinations(prompt, width, height, seed, retries)
    download(url, out_path)


def gen_image(prompt: str, width: int, height: int, seed: int,
              retries: int = 4, backoff: int = 20) -> str:
    last = None
    for i in range(retries):
        for space in SPACES:
            try:
                eid = post_call(space, prompt, width, height, seed + i)
                return wait_result(space, eid)
            except Exception as e:  # noqa: BLE001
                last = e
                print(f"  try {i+1}/{retries} via {space['name']}: {e}")
        if i < retries - 1:
            wait = backoff * (i + 1)
            print(f"  all spaces busy — waiting {wait}s (quota is rolling)...")
            time.sleep(wait)
    raise RuntimeError(f"AI generation failed after {retries} rounds: {last}")


def fit_jpg(path_in: str, path_out: str, w: int, h: int) -> str:
    """Exact-size center-crop + resize -> JPEG quality 88."""
    from PIL import Image
    img = Image.open(path_in).convert("RGB")
    sw, sh = img.size
    ta, sa = w / h, sw / sh
    if sa > ta:
        nw = int(sh * ta)
        img = img.crop(((sw - nw) // 2, 0, (sw + nw) // 2, sh))
    else:
        nh = int(sw / ta)
        img = img.crop((0, (sh - nh) // 2, sw, (sh + nh) // 2))
    img = img.resize((w, h), Image.LANCZOS)
    img.save(path_out, "JPEG", quality=88, optimize=True)
    return path_out


def make_thumbs(prompt: str, out_dir: str, seed: int, retries: int) -> list[str]:
    tmp = os.path.join(out_dir, ".gen_tmp_wide")
    tmp2 = os.path.join(out_dir, ".gen_tmp_square")

    print("[1/3] Generating wide art (1024x768)...")
    gen_source(WIDE_PROMPT.format(p=prompt, n=NO_TEXT), 1024, 768, seed, retries, tmp)

    print("[2/3] Generating square art (1024x1024)...")
    gen_source(SQUARE_PROMPT.format(p=prompt, n=NO_TEXT), 1024, 1024, seed + 100, retries, tmp2)

    outs = []
    for (w, h) in SIZES:
        src = tmp if (w != h) else tmp2
        # 512x384 and 512x340 from the wide art; 512x512 from the square art
        p = fit_jpg(src, os.path.join(out_dir, f"thumb_{w}x{h}.jpg"), w, h)
        outs.append(p)
        print(f"      -> {p} ({os.path.getsize(p)} bytes)")
    for t in (tmp, tmp2):
        if os.path.exists(t):
            os.remove(t)
    return outs


def fallback_pil(out_dir: str) -> list[str]:
    """Last-resort text-free neon thumbs (PIL) so publishing never blocks."""
    from PIL import Image, ImageDraw
    import math
    outs = []
    for (w, h) in SIZES:
        img = Image.new("RGB", (w, h), (7, 8, 15))
        d = ImageDraw.Draw(img)
        for b in os.urandom(w * h // 1500):
            d.point((b * 131 % w, b * 197 % h), fill=(159, 180, 216))
        cy1, cy2 = h // 3, 2 * h // 3
        d.line([(0, h // 2), (w, h // 2)], fill=(120, 140, 190), width=1)
        r = min(w, h) // 10
        for (cx, cy, col) in [(w // 4, cy1, (34, 224, 255)), (3 * w // 4, cy2, (255, 62, 165))]:
            glow = Image.new("RGB", (w, h), (0, 0, 0))
            dg = ImageDraw.Draw(glow)
            for i in range(8, 0, -1):
                dg.ellipse([cx - r - i * 2, cy - r - i * 2, cx + r + i * 2, cy + r + i * 2],
                           fill=(col[0] // (i * 3 + 1), col[1] // (i * 3 + 1), col[2] // (i * 3 + 1)))
            img = Image.blend(img, glow, 0.35)
            d = ImageDraw.Draw(img)
            d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=col)
            d.ellipse([cx - r // 3, cy - r // 3, cx, cy], fill=(255, 255, 255))
        # hex gems
        for i in range(3):
            gx = w * (i + 1) // 4
            gy = cy2 if i % 2 == 0 else cy1
            col = (255, 62, 165) if i % 2 == 0 else (34, 224, 255)
            pts = [(gx + r // 2 * math.cos(a), gy + r // 2 * math.sin(a))
                   for a in [k * math.pi / 3 for k in range(6)]]
            d.polygon(pts, outline=col, width=3)
        p = os.path.join(out_dir, f"thumb_{w}x{h}.jpg")
        img.save(p, "JPEG", quality=88, optimize=True)
        outs.append(p)
    return outs


def main() -> None:
    ap = argparse.ArgumentParser(description="AI GameMonetize thumbnails (3 JPGs), no account needed")
    ap.add_argument("--prompt", required=True,
                    help="VISUAL description of the game (no text to render!)")
    ap.add_argument("--out-dir", default=".")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--retries", type=int, default=4)
    ap.add_argument("--no-fallback", action="store_true")
    args = ap.parse_args()
    os.makedirs(args.out_dir, exist_ok=True)

    try:
        thumbs = make_thumbs(args.prompt, args.out_dir, args.seed, args.retries)
    except Exception as e:  # noqa: BLE001
        if args.no_fallback:
            print(f"ERROR {e}", file=sys.stderr)
            sys.exit(1)
        print(f"WARNING AI generation unavailable ({e}) — using PIL fallback thumbs.")
        thumbs = fallback_pil(args.out_dir)

    for p in thumbs:
        print(f"  {p}  ({os.path.getsize(p)} bytes)")
    print("Done — 3 text-free GameMonetize thumbnails (512x384, 512x512, 512x340).")


if __name__ == "__main__":
    main()
