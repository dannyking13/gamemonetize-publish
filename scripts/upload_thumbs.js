#!/usr/bin/env node
'use strict';
/* Upload 3 AI thumbnails to a game: reads custId (GameId) from editgame.php,
 * then multipart POSTs each jpg to upload_img.php (size 1/2/3). */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const SESSION = path.join(__dirname, '.gm_session.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const ID = process.argv[2];
const DIR = process.argv[3];
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), '[THUMB]', ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 1000 }, userAgent: UA, storageState: fs.existsSync(SESSION) ? SESSION : undefined });
  const page = await ctx.newPage();
  await page.goto('https://gamemonetize.com/account/index.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);
  if (/login/i.test(page.url())) {
    log('logging in...');
    const em = page.locator('input[type="email"]').first();
    await em.click(); await em.fill(process.env.GM_EMAIL || '');
    const pw = page.locator('input[name="password"]').first();
    await pw.click(); await pw.fill(process.env.GM_PASSWORD || '');
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(8000);
    fs.writeFileSync(SESSION, JSON.stringify(await ctx.storageState(), null, 2));
  }
  await page.goto(`https://gamemonetize.com/account/editgame.php?id=${ID}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000);
  const ids = await page.evaluate(() => {
    // GameId token lives in a readonly input[name="value"] (NOT named custId)
    let custId = '';
    document.querySelectorAll('input[name="value"]').forEach(i => {
      if (/^[a-z0-9]{32}$/.test(i.value || '')) custId = i.value;
    });
    if (!custId) custId = (document.querySelector('input[name="custId"]') || {}).value || '';
    return { custId };
  });
  log('ids:', JSON.stringify(ids));
  if (!ids.custId) { console.error('no custId found'); process.exit(1); }

  const files = [
    { f: 'thumb_512x384.jpg', size: 1 },
    { f: 'thumb_512x512.jpg', size: 2 },
    { f: 'thumb_512x340.jpg', size: 3 },
  ];
  for (const { f, size } of files) {
    const p = path.join(DIR, f);
    if (!fs.existsSync(p)) { log('MISSING', p); process.exit(1); }
    const resp = await ctx.request.post(`https://gamemonetize.com/account/upload_img.php?gameid=${ids.custId}&id=${ID}&size=${size}`, {
      multipart: { file: { name: f, mimeType: 'image/jpeg', buffer: fs.readFileSync(p) } },
    });
    log(`size=${size} -> HTTP`, resp.status(), (await resp.text()).slice(0, 80));
    await sleep(1500);
  }
  await browser.close();
  log('DONE');
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
