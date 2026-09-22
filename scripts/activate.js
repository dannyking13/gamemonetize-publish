#!/usr/bin/env node
'use strict';
/* Verify + Request activation ONLY (no re-upload) — for games whose zip/metadata
 * are already on the dashboard. Fits in a 10-min window.
 * Usage: node activate.js <numericId> */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const SESSION = path.join(__dirname, '.gm_session.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const ID = process.argv[2];
if (!ID) { console.error('usage: node activate.js <numericId>'); process.exit(1); }

const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), '[ACT]', ...a);

async function login(ctx, page) {
  await page.goto('https://gamemonetize.com/account/index.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);
  if (!/login/i.test(page.url())) return;
  log('logging in...');
  const em = page.locator('input[type="email"]').first();
  await em.click(); await em.fill(process.env.GM_EMAIL || '');
  const pw = page.locator('input[name="password"]').first();
  await pw.click(); await pw.fill(process.env.GM_PASSWORD || '');
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(8000);
  fs.writeFileSync(SESSION, JSON.stringify(await ctx.storageState(), null, 2));
  await page.goto(`https://gamemonetize.com/account/editgame.php?id=${ID}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);
}

(async () => {
  const browser = await chromium.launch({ headless: false, args: ['--disable-blink-features=AutomationControlled'] });
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 1000 }, userAgent: UA, storageState: fs.existsSync(SESSION) ? SESSION : undefined });
  await ctx.addInitScript(() => {
    try {
      window.addEventListener('message', e => {
        try { console.log('[GMMSG]' + String(typeof e.data === 'object' ? JSON.stringify(e.data) : e.data).slice(0, 200)); } catch (x) {}
      });
      let _sdk;
      Object.defineProperty(window, 'sdk', {
        configurable: true,
        get: () => _sdk,
        set: v => {
          _sdk = v;
          if (v && typeof v.showBanner === 'function') {
            const orig = v.showBanner.bind(v);
            try { v.showBanner = function () { window.__bannerCalls = (window.__bannerCalls || 0) + 1; console.log('[GMMSG]{"type":"SHOW_BANNER_CALLED"}'); return orig.apply(null, arguments); }; } catch (e) {}
          }
        },
      });
    } catch (e) {}
  });
  const page = await ctx.newPage();
  // auto-accept ANY dialog from the very start — a stray alert() would block every action
  page.on('dialog', d => { log('dialog:', d.message().slice(0, 80)); d.accept().catch(() => {}); });
  await login(ctx, page);

  await page.goto(`https://gamemonetize.com/account/editgame.php?id=${ID}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);

  // already in review? (Cancel review present => done)
  const body0 = await page.evaluate(() => document.body.innerText);
  if (/cancel review/i.test(body0)) { log('ALREADY IN REVIEW — nothing to do'); await browser.close(); process.exit(0); }

  log('opening Verify Game modal...');
  await page.locator('a:has-text("Verify Game")').first().click();
  await page.waitForTimeout(9000);
  const frameEl = await page.$('#modal-frame');
  if (!frameEl) { console.error('no verify modal iframe'); process.exit(1); }
  const box = await frameEl.boundingBox();

  let implemented = false;
  const onConsole = m => {
    const t = m.text();
    if (/SDK_IMPLEMENTED/.test(t)) { implemented = true; log('>>> SDK_IMPLEMENTED observed!'); }
    if (/SHOW_BANNER_CALLED/.test(t)) log('>>> sdk.showBanner() called by the game');
    if (/ima:\/\//.test(t)) {
      const type = (t.match(/"type":"([^"]+)"/) || [])[1];
      if (type && !/remainingTime|cookieUpdate|fetchAdTagUrl|videoPlayback/.test(type)) log('[IMA]', type, t.slice(0, 220));
    }
    if (/\[EV\] /.test(t)) log('[EVT]', t.slice(5, 60));
  };
  page.on('console', onConsole);

  const gameFrame = page.frames().find(f => /html5\.gamemonetize\.co\//.test(f.url())) || null;
  if (gameFrame) {
    try {
      const st = await gameFrame.evaluate(() => ({
        sdk: typeof window.sdk,
        bridge: !!(window.PokiSDK && window.PokiSDK.__gmBridge),
        banner: window.__bannerCalls || 0,
        ref: document.referrer.slice(0, 90),
        anc: (window.location.ancestorOrigins && window.location.ancestorOrigins[0]) || '',
        v8: typeof window.__gmDriverV8 !== 'undefined' || !!document.documentElement.outerHTML.includes('undefined') || String(window.PokiSDK && window.PokiSDK.commercialBreak).indexOf('queuedBoot') >= 0,
      }));
      log('game frame state:', JSON.stringify(st));
    } catch (e) {}
  }

  // ONE real tap inside the frame (the v8 bridge fires the open ad in-gesture),
  // then SILENT observation — extra clicks during ad playback break the cycle.
  for (let round = 0; round < 1 && !implemented; round++) {
    log(`tap round ${round + 1}: one gesture, then watching 45s...`);
    if (gameFrame) {
      try { await gameFrame.click('canvas', { timeout: 3000, position: { x: 300, y: 300 } }); }
      catch (e) { await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2).catch(() => {}); }
    } else {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2).catch(() => {});
    }
    for (let i = 0; i < 45 && !implemented; i++) await sleep(1000);
    if (gameFrame) {
      try { const st = await gameFrame.evaluate(() => ({ banner: window.__bannerCalls || 0 })); log(`  bannerCalls after round ${round + 1}:`, st.banner); } catch (e) {}
    }
  }
  page.off('console', onConsole);
  log(implemented ? 'SDK verification PASSED' : 'SDK_IMPLEMENTED NOT observed — activation will likely stay locked');

  const close = page.locator('.sparkling-modal-close').first();
  if (await close.count()) { await close.click(); await sleep(2000); log('modal closed'); }

  // reload => server-rendered activation state refreshes
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  const states = await page.$$eval('input[name="activation"]', els => els.map(e => e.disabled));
  log('activation buttons disabled?', JSON.stringify(states));
  if (states.every(d => d)) {
    log('ACTIVATION STILL LOCKED — CDN may serve an old build in the modal; retry later.');
    await page.screenshot({ path: path.join(__dirname, 'activate_locked_' + ID + '.png') });
    await browser.close(); process.exit(2);
  }
  page.on('dialog', d => { log('dialog:', d.message()); d.accept().catch(() => {}); });
  await page.locator('input[name="activation"]:not([disabled])').first().click();
  log('clicked Request activation');
  await page.waitForTimeout(8000);
  const txt = await page.evaluate(() => document.body.innerText);
  const ok = /cancel review/i.test(txt);
  log(ok ? 'SUCCESS — "Cancel review" => SUBMITTED' : 'WARNING: "Cancel review" not found');
  await browser.close();
  process.exit(ok ? 0 : 3);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
