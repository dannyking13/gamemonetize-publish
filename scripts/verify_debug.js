#!/usr/bin/env node
'use strict';
/* Deep debug of the Verify Game modal: inspect INSIDE the game iframe.
 * Usage: node verify_debug.js <numericId> [seconds] */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const SESSION = path.join(__dirname, '.gm_session.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const ID = process.argv[2] || '86712';
const SECONDS = parseInt(process.argv[3] || '75', 10);

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 1000 }, userAgent: UA, storageState: fs.existsSync(SESSION) ? SESSION : undefined });
  await ctx.addInitScript(() => {
    try {
      window.addEventListener('message', e => {
        try { console.log('[DBGMSG]' + String(typeof e.data === 'object' ? JSON.stringify(e.data) : e.data).slice(0, 200)); } catch (x) {}
      });
      let _sdk;
      Object.defineProperty(window, 'sdk', {
        configurable: true,
        get: () => _sdk,
        set: v => {
          _sdk = v;
          console.log('[DBGMSG]{"type":"SDK_SET"}');
          if (v && typeof v.showBanner === 'function') {
            const orig = v.showBanner.bind(v);
            try { v.showBanner = function () { console.log('[DBGMSG]{"type":"SHOW_BANNER_CALLED"}'); return orig.apply(null, arguments); }; } catch (e) {}
          }
        },
      });
    } catch (e) {}
  });
  const page = await ctx.newPage();
  page.on('console', m => {
    const t = m.text();
    if (t.includes('[DBGMSG]')) console.log('  <frame>', t.replace('[DBGMSG]', ''));
  });
  page.on('dialog', d => { console.log('DIALOG:', d.message()); d.accept().catch(() => {}); });

  await page.goto(`https://gamemonetize.com/account/editgame.php?id=${ID}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000);
  await page.locator('a:has-text("Verify Game")').first().click();
  await page.waitForTimeout(9000);

  const frameEl = await page.$('#modal-frame');
  if (!frameEl) { console.log('NO #modal-frame'); process.exit(1); }
  const box = await frameEl.boundingBox();
  console.log('iframe box:', JSON.stringify(box));
  for (const f of page.frames()) console.log('FRAME:', f.url().slice(0, 120));

  // find the game frame (the actual build iframe, not the parent page!)
  const gameFrame = page.frames().find(f => /html5\.gamemonetize\.co\//.test(f.url())) || null;
  if (!gameFrame) console.log('!! no gamemonetize frame found');
  else {
    try {
      const st = await gameFrame.evaluate(() => ({
        url: location.href.slice(0, 100),
        canvas: !!document.querySelector('canvas'),
        sdkType: typeof window.sdk,
        sdkOptionsGameId: (window.SDK_OPTIONS || {}).gameId || null,
        bridge: !!(window.PokiSDK && window.PokiSDK.__gmBridge),
        pokiType: typeof window.PokiSDK,
        title: (document.title || '').slice(0, 40),
      }));
      console.log('GAME FRAME STATE:', JSON.stringify(st, null, 1));
    } catch (e) { console.log('frame eval failed:', String(e).slice(0, 150)); }
  }

  // play blindly and watch
  const t0 = Date.now();
  let i = 0;
  while ((Date.now() - t0) / 1000 < SECONDS) {
    i++;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.move(box.x + 80 + Math.random() * (box.width - 160), box.y + box.height / 2);
    if (i % 5 === 0) for (const k of ['Space', 'Enter']) await page.keyboard.press(k).catch(() => {});
    await sleep(900);
    if (i % 10 === 0 && gameFrame) {
      try {
        const st = await gameFrame.evaluate(() => ({
          sdk: typeof window.sdk,
          bridge: !!(window.PokiSDK && window.PokiSDK.__gmBridge),
          canvas: !!document.querySelector('canvas'),
          bannerCalls: window.__bannerCalls || 0,
        }));
        console.log(`  t=${i}s frame:`, JSON.stringify(st));
        await page.screenshot({ path: path.join(__dirname, `verify_t${i}.png`) });
      } catch (e) { console.log(`  t=${i}s frame eval err`); }
    }
  }
  await page.screenshot({ path: path.join(__dirname, 'verify_debug.png') });
  console.log('screenshot saved');
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
