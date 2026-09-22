#!/usr/bin/env node
'use strict';
/*
 * GameMonetize end-to-end publisher (validated Sept 2026).
 * Pipeline: login -> add game -> GameId -> inject SDK -> zip -> upload ->
 * thumbnails -> metadata -> Save -> Verify Game (play until SDK_IMPLEMENTED)
 * -> reload -> Request activation -> confirm "Cancel review".
 *
 * Env vars (all via `GM_*`; see SKILL.md §4 for the full table):
 *   required : GM_EMAIL, GM_PASSWORD, GM_TITLE, GM_GAME_DIR
 *   metadata : GM_CATEGORIES, GM_TAGS, GM_DESC, GM_CONTROLS, GM_WIDTH, GM_HEIGHT
 *   assets   : GM_PROMPT (AI thumbs), GM_THUMB_DIR (reuse existing thumbs)
 *   zip      : GM_ZIP (reuse an existing zip; otherwise packaged from GM_GAME_DIR)
 *   advanced : GM_EXISTING_ID (edit existing game), GM_INJECT_SDK=true,
 *              GM_SKIP_VERIFY, GM_SKIP_ACTIVATE
 */
const { chromium } = require('playwright');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SESSION = path.join(ROOT, '.gm_session.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const PLACEHOLDER = process.env.GM_GAME_ID_PLACEHOLDER || '__GM_GAME_ID__';

const env = (k, d) => (process.env[k] !== undefined ? process.env[k] : d);
const CFG = {
  email: env('GM_EMAIL', ''), password: env('GM_PASSWORD', ''),
  title: env('GM_TITLE', ''), gameDir: env('GM_GAME_DIR', ''),
  zip: env('GM_ZIP', ''), categories: env('GM_CATEGORIES', 'Arcade,Hypercasual'),
  tags: env('GM_TAGS', '1 Player,Arcade,HTML5,Hypercasual,Mobile'),
  desc: env('GM_DESC', ''), controls: env('GM_CONTROLS', ''),
  width: env('GM_WIDTH', '960'), height: env('GM_HEIGHT', '540'),
  prompt: env('GM_PROMPT', ''), thumbDir: env('GM_THUMB_DIR', ''),
  existingId: env('GM_EXISTING_ID', ''), injectSdk: env('GM_INJECT_SDK', '') === 'true',
  skipVerify: env('GM_SKIP_VERIFY', '') === 'true',
  skipActivate: env('GM_SKIP_ACTIVATE', '') === 'true',
};
if (!CFG.email || !CFG.password) {
  const credFile = path.join(ROOT, '.gm_credentials');
  if (fs.existsSync(credFile)) {
    const [e, p] = fs.readFileSync(credFile, 'utf8').split('\n').map(s => s.trim());
    CFG.email = CFG.email || e; CFG.password = CFG.password || p;
  }
}
if (!CFG.email || !CFG.password) { console.error('FATAL: GM_EMAIL/GM_PASSWORD (or scripts/.gm_credentials) required'); process.exit(1); }
if (!CFG.title && !CFG.existingId) { console.error('FATAL: GM_TITLE or GM_EXISTING_ID required'); process.exit(1); }

const log = (...a) => console.log(new Date().toISOString().slice(0, 19).replace('T', ' '), '[GM]', ...a);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let NUM_ID = CFG.existingId;   // numeric page id (editgame.php?id=)
let GAME_ID = null;            // 32-char GameId

// ---------------------------------------------------------------- browser
async function launch() {
  const browser = await chromium.launch({ headless: false, args: ['--disable-blink-features=AutomationControlled'] });
  const ctx = await browser.newContext({
    viewport: { width: 1360, height: 1000 }, userAgent: UA,
    storageState: fs.existsSync(SESSION) ? SESSION : undefined,
  });
  // hooks in every frame: log postMessages (SDK_IMPLEMENTED!) + count showBanner calls
  await ctx.addInitScript(() => {
    try {
      window.__bannerCalls = 0;
      window.addEventListener('message', function (e) {
        try { console.log('[GMMSG]' + String(typeof e.data === 'object' ? JSON.stringify(e.data) : e.data).slice(0, 200)); } catch (x) {}
      });
      let _sdk;
      Object.defineProperty(window, 'sdk', {
        configurable: true,
        get: () => _sdk,
        set: (v) => {
          _sdk = v;
          if (v && typeof v.showBanner === 'function') {
            const orig = v.showBanner.bind(v);
            try { v.showBanner = function () { window.__bannerCalls++; console.log('[GMMSG]{"type":"SHOW_BANNER_CALLED"}'); return orig.apply(null, arguments); }; } catch (e) {}
          }
        },
      });
    } catch (e) {}
  });
  return { browser, ctx };
}

async function login(ctx, page) {
  const ensure = async () => {
    await page.goto('https://gamemonetize.com/account/index.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(4000);
    if (!/login/i.test(page.url())) return true;
    log('logging in...');
    const em = page.locator('input[type="email"]').first();
    await em.click(); await em.fill(CFG.email);
    const pw = page.locator('input[name="password"]').first();
    await pw.click(); await pw.fill(CFG.password);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(8000);
    fs.writeFileSync(SESSION, JSON.stringify(await ctx.storageState(), null, 2));
    await page.goto('https://gamemonetize.com/account/index.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);
    return !/login/i.test(page.url());
  };
  for (let i = 0; i < 2; i++) if (await ensure()) { log('logged in as', CFG.email); return; }
  throw new Error('login failed');
}

// ---------------------------------------------------------------- steps
async function createGame(page) {
  await page.goto('https://gamemonetize.com/account/gameadd.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);
  await page.locator('input[name="name"]').first().fill(CFG.title);
  // nameid is server/JS-auto-slugged from name and usually INVISIBLE — only fill it if visible & empty
  const nameid = page.locator('input[name="nameid"]').first();
  if (await nameid.count() && !(await nameid.inputValue()) && await nameid.isVisible().catch(() => false)) {
    await nameid.fill(CFG.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
  }
  await page.locator('button:has-text("Add Game")').first().click();
  await page.waitForTimeout(6000);
  const m = page.url().match(/editgame\.php\?id=(\d+)/);
  if (!m) throw new Error('game creation failed — no redirect to editgame: ' + page.url());
  log('game created, numeric id =', m[1]);
  return m[1];
}

async function extractGameId(page) {
  await page.goto(`https://gamemonetize.com/account/editgame.php?id=${NUM_ID}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);
  const gid = await page.$eval('input[name="custId"]', e => e.value).catch(() => null);
  if (!gid || !/^[a-z0-9]{32}$/.test(gid)) {
    const html = await page.content();
    const m = html.match(/uncached\.gamemonetize\.com\/([a-z0-9]{32})\//);
    if (!m) throw new Error('GameId not found on edit page');
    return m[1];
  }
  return gid;
}

async function injectGameId() {
  const indexPath = path.join(CFG.gameDir, 'index.html');
  if (!fs.existsSync(indexPath)) throw new Error('index.html not found in GM_GAME_DIR: ' + CFG.gameDir);
  let html = fs.readFileSync(indexPath, 'utf8');
  if (html.includes(GAME_ID)) { log('GameId already present in index.html'); return; }
  if (html.includes(PLACEHOLDER)) {
    html = html.replace(PLACEHOLDER, GAME_ID);
  } else if (CFG.injectSdk || /SDK_OPTIONS/.test(html)) {
    // target the gameId INSIDE SDK_OPTIONS (not another SDK's gameId that may appear earlier)
    html = html.replace(/SDK_OPTIONS[\s\S]{0,400}?gameId:\s*["']([a-zA-Z0-9_-]*)["']/, m => m.replace(/gameId:\s*["']([a-zA-Z0-9_-]*)["']/, `gameId: "${GAME_ID}"`));
    if (!html.includes(`gameId: "${GAME_ID}"`)) throw new Error('could not inject GameId — no SDK_OPTIONS gameId found. Add the SDK snippet (SKILL.md §2).');
  } else {
    throw new Error('index.html has no SDK integration and GM_INJECT_SDK is not set. Integrate the SDK first (SKILL.md §2).');
  }
  fs.writeFileSync(indexPath, html);
  log('GameId injected into', indexPath);
}

async function packageZip() {
  if (CFG.zip) { log('using provided zip:', CFG.zip); return CFG.zip; }
  const zipPath = path.join(ROOT, `${CFG.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'game'}.zip`);
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  // -x excludes OS/editor junk; index.html must sit at the archive ROOT
  execSync(`cd "${path.resolve(CFG.gameDir)}" && zip -q -r "${zipPath}" . -x "*.DS_Store" -x "Thumbs.db" -x "*.git*" -x "node_modules/*" -x ".agents/*" -x ".vscode/*"`, { stdio: 'inherit' });
  const kb = (fs.statSync(zipPath).size / 1024).toFixed(1);
  log('zip packaged:', zipPath, `(${kb} KB)`);
  return zipPath;
}

async function uploadZip(ctx, zipPath) {
  const buf = fs.readFileSync(zipPath);
  const url = `https://gamemonetize.com/account/upload.php?gameid=${GAME_ID}&id=${NUM_ID}`;
  const r = await ctx.request.post(url, {
    multipart: { file: { name: 'game.zip', mimeType: 'application/x-zip-compressed', buffer: buf } },
    timeout: 120000,
  });
  const body = await r.text();
  log('zip upload:', r.status(), body.slice(0, 120));
  if (!/uploaded and unpacked/i.test(body)) throw new Error('zip upload rejected: ' + body);
  // poll live URL
  for (let i = 0; i < 6; i++) {
    await sleep(5000);
    const resp = await ctx.request.get(`https://uncached.gamemonetize.com/${GAME_ID}/`, { timeout: 20000 }).catch(() => null);
    if (resp && resp.status() === 200) {
      const t = await resp.text().catch(() => '');
      if (/sdk\.js/.test(t) && t.length > 200) { log('BUILD LIVE at uncached.gamemonetize.com/' + GAME_ID + '/'); return; }
    }
    log('waiting for build to go live... (' + (i + 1) + '/6)');
  }
  log('WARNING: build not confirmed live yet (may still process) — continuing');
}

async function ensureThumbs() {
  const sizes = ['512x384', '512x512', '512x340'];
  if (CFG.thumbDir) {
    const found = sizes.map(s => path.join(CFG.thumbDir, `thumb_${s}.jpg`));
    if (found.every(fs.existsSync)) { log('reusing existing thumbnails from', CFG.thumbDir); return found; }
    log('thumb dir incomplete — regenerating with AI');
  }
  if (!CFG.prompt) throw new Error('GM_PROMPT required to generate thumbnails (or set GM_THUMB_DIR)');
  // PERSIST assets in the repo (SKILL.md §3), never in /tmp or a git-ignored dir:
  // out-dir = <repo>/assets/<game-slug>/ so thumbnails survive between sessions.
  const slug = (CFG.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'game');
  const outDir = path.join(ROOT, '..', 'assets', slug);
  fs.mkdirSync(outDir, { recursive: true });
  // --no-fallback: submitted assets MUST be AI-generated. If AI fails => STOP, never submit hand-made assets.
  execSync(`python3 "${path.join(ROOT, 'gen_assets.py')}" --no-fallback --prompt ${JSON.stringify(CFG.prompt)} --out-dir "${outDir}"`, { stdio: 'inherit' });
  return sizes.map(s => path.join(outDir, `thumb_${s}.jpg`));
}

async function uploadThumbs(ctx, thumbs) {
  for (let i = 0; i < 3; i++) {
    const buf = fs.readFileSync(thumbs[i]);
    const r = await ctx.request.post(
      `https://gamemonetize.com/account/upload_img.php?gameid=${GAME_ID}&id=${NUM_ID}&size=${i + 1}`,
      { multipart: { file: { name: 'thumb.jpg', mimeType: 'image/jpeg', buffer: buf } }, timeout: 60000 });
    const body = await r.text();
    log(`thumb size=${i + 1} (${path.basename(thumbs[i])}):`, r.status(), body.slice(0, 80));
    if (r.status() !== 200) throw new Error(`thumbnail size=${i + 1} upload failed (HTTP ${r.status()}): ${body}`);
  }
}

async function fillMetadata(page) {
  await page.goto(`https://gamemonetize.com/account/editgame.php?id=${NUM_ID}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);

  // name
  await page.locator('input[name="name"]').first().fill(CFG.title);

  // categories (min 2) — native multi-select; set via JS (Playwright selectOption fails on actionability here)
  const wanted = CFG.categories.split(',').map(s => s.trim()).filter(Boolean);
  const setSel = await page.evaluate((names) => {
    const sel = document.querySelector('select[name="category[]"]');
    if (!sel) return [];
    [...sel.options].forEach(o => { o.selected = false; });   // clear stale selections first
    const out = [];
    [...sel.options].forEach(o => { if (names.includes(o.text)) { o.selected = true; out.push(o.text); } });
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return out;
  }, wanted);
  // NEVER auto-fill extra categories beyond the requested list: read the platform limit
  // (min 2 here) and fail loudly if the provided list can't satisfy it.
  if (setSel.length < 2) throw new Error('only ' + setSel.length + ' valid category(ies) in GM_CATEGORIES (' + setSel.join(', ') + ') — dashboard requires >= 2. Fix GM_CATEGORIES with exact dashboard option names.');
  log('categories set:', setSel.join(', '), '(' + setSel.length + '/2 min — nothing auto-added)');

  // tags — select2-backed multi-select: set underlying options via JS + change event
  const tagNames = CFG.tags.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const picked = await page.evaluate((names) => {
    const sel = document.querySelector('select[name="tags[]"]');
    if (!sel) return [];
    const out = [];
    [...sel.options].forEach(o => { if (names.includes((o.text || '').toLowerCase())) { o.selected = true; out.push(o.text); } });
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return out;
  }, tagNames);
  log('tags set:', JSON.stringify(picked));

  // description / controls / dimensions
  if (CFG.desc) await page.locator('textarea[name="desc"]').fill(CFG.desc);
  if (CFG.controls) await page.locator('textarea[name="control"]').fill(CFG.controls);
  await page.locator('input[name="width"]').fill(CFG.width);
  await page.locator('input[name="height"]').fill(CFG.height);
  // mobile checkbox: leave as-is if checked, else check
  const mob = page.locator('input[name="mobiledevices"]').first();
  if (await mob.count() && !(await mob.isChecked())) await mob.check().catch(() => {});

  await page.locator('button:has-text("Save Changes")').first().click();
  await page.waitForTimeout(6000);
  log('metadata saved (url:', page.url() + ')');

  // SKILL.md §4: re-check the fields persisted after saving (plain form POST — silent drops happen)
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  const persisted = await page.evaluate(() => {
    const name = (document.querySelector('input[name="name"]') || {}).value || '';
    const cats = [...document.querySelectorAll('select[name="category[]"] option:checked')].map(o => o.text);
    const desc = (document.querySelector('textarea[name="desc"]') || {}).value || '';
    return { name, cats, desc };
  });
  const problems = [];
  if (CFG.title && persisted.name !== CFG.title) problems.push(`name not persisted ("${persisted.name}")`);
  if (CFG.desc && persisted.desc !== CFG.desc) problems.push(`desc not persisted (${persisted.desc.length}/${CFG.desc.length} chars)`);
  const wantedCats = CFG.categories.split(',').map(s => s.trim()).filter(Boolean);
  if (wantedCats.length && wantedCats.some(c => !persisted.cats.includes(c))) problems.push(`categories not persisted (got: ${persisted.cats.join(', ')})`);
  if (problems.length) throw new Error('metadata save NOT confirmed: ' + problems.join('; '));
  log('metadata verified after save (name, categories, desc persisted)');
}

async function verifyGame(ctx, page) {
  // ⚠️ ONE real tap inside the frame, then SILENCE (SKILL.md §1: the proven recipe,
  // validated 2026-09-22). The old multi-click robot cancels the IMA ad cycle:
  // extra clicks during the 10–15s ad playback abort it (AD_CANCELED).
  log('opening Verify Game modal...');
  await page.locator('a:has-text("Verify Game")').first().click();
  await page.waitForTimeout(9000);

  const frameEl = await page.$('#modal-frame');
  if (!frameEl) throw new Error('verify modal iframe not found');
  const box = await frameEl.boundingBox();
  if (!box) throw new Error('verify modal iframe has no bounding box');

  let implemented = false;
  const onConsole = (m) => {
    const t = m.text();
    if (/SDK_IMPLEMENTED/.test(t)) { implemented = true; log('>>> SDK_IMPLEMENTED observed!'); }
    if (/SHOW_BANNER_CALLED/.test(t)) log('>>> sdk.showBanner() called by the game');
  };
  page.on('console', onConsole);

  // The game's bridge fires the single open showBanner() INSIDE this gesture task.
  const gameFrame = page.frames().find(f => /html5\.gamemonetize\.co\//.test(f.url())) || null;
  if (gameFrame) {
    try { await gameFrame.click('canvas', { timeout: 3000, position: { x: 300, y: 300 } }); log('ONE tap inside the game frame — now silent'); }
    catch (e) { await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2).catch(() => {}); log('canvas click failed — one tap on the iframe instead'); }
  } else {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2).catch(() => {});
    log('ONE tap on the iframe — now silent');
  }

  // Observe silently >= 45s (the ad plays 10–15s). Do NOT click again.
  for (let i = 0; i < 45 && !implemented; i++) await sleep(1000);
  page.off('console', onConsole);

  if (!implemented) log('WARNING: SDK_IMPLEMENTED not observed — see SKILL.md gotchas (served build version / gesture / IMA traffic). Try scripts/activate.js later.');
  else log('SDK verification PASSED');

  // close modal
  const close = page.locator('.sparkling-modal-close').first();
  if (await close.count()) { await close.click(); await sleep(2000); log('modal closed'); }
  return implemented;
}

async function requestActivation(page) {
  // the button state is server-rendered: RELOAD first
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  const states = await page.$$eval('input[name="activation"]', els => els.map(e => e.disabled));
  log('activation buttons disabled?', JSON.stringify(states));
  if (states.every(d => d)) throw new Error('Request activation still disabled — verification did not register. Re-run with GM_EXISTING_ID=' + NUM_ID);

  page.on('dialog', d => { log('dialog:', d.message()); d.accept().catch(() => {}); });
  await page.locator('input[name="activation"]:not([disabled])').first().click();
  log('clicked Request activation');
  await page.waitForTimeout(8000);
  const txt = await page.evaluate(() => document.body.innerText);
  const ok = /cancel review/i.test(txt);
  log(ok ? 'SUCCESS — game shows "Cancel review" => SUBMITTED for review' : 'WARNING: "Cancel review" not found — check dashboard manually');
  return ok;
}

// ---------------------------------------------------------------- main
(async () => {
  const { browser, ctx } = await launch();
  const page = await ctx.newPage();

  await login(ctx, page);

  // 1. game (create or reuse)
  if (!NUM_ID) NUM_ID = await createGame(page);
  log('edit page: https://gamemonetize.com/account/editgame.php?id=' + NUM_ID);

  // 2. GameId
  GAME_ID = await extractGameId(page);
  log('GameId =', GAME_ID);

  // 3. inject + zip
  if (CFG.gameDir) { await injectGameId(); }
  const zipPath = await packageZip();

  // 4. zip upload
  await uploadZip(ctx, zipPath);

  // 5. thumbnails
  const thumbs = await ensureThumbs();
  await uploadThumbs(ctx, thumbs);

  // 6. metadata
  await fillMetadata(page);

  // 7. verify (play until SDK_IMPLEMENTED)
  if (!CFG.skipVerify) {
    const ok = await verifyGame(ctx, page);
    if (!ok) log('proceeding anyway — activation check will tell the truth');
  } else log('GM_SKIP_VERIFY set — skipping verify');

  // 8. activation
  if (!CFG.skipActivate) {
    await requestActivation(page);
  } else log('GM_SKIP_ACTIVATE set — stopping before activation');

  await page.screenshot({ path: path.join(ROOT, 'gm_publish_final.png'), fullPage: true });
  log('SUMMARY: numericId=' + NUM_ID, 'GameId=' + GAME_ID, 'live=https://uncached.gamemonetize.com/' + GAME_ID + '/');
  await browser.close();
})().catch((e) => { console.error('[GM] FATAL', e); process.exit(1); });
