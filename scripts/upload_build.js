#!/usr/bin/env node
'use strict';
/* Upload a new zip build to an existing game.
 * Usage: node upload_build.js <numericId> <zipPath>
 * Gets the GameId token from editgame.php, then multipart POSTs the zip to
 * upload.php?gameid=<token>&id=<id> with mimeType application/x-zip-compressed. */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const SESSION = path.join(__dirname, '.gm_session.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const ID = process.argv[2];
const ZIP = process.argv[3];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), '[BUILD]', ...a);

(async () => {
  if (!ID || !ZIP || !fs.existsSync(ZIP)) { console.error('usage: node upload_build.js <numericId> <zip>'); process.exit(1); }
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
  const gotToken = await page.waitForFunction(() => {
    const inputs = Array.from(document.querySelectorAll('input[name="value"]'));
    return inputs.some(i => /^[a-z0-9]{32}$/.test(i.value || ''));
  }, { timeout: 30000 }).then(() => true).catch(() => false);
  if (!gotToken) { log('token not visible yet, reloading...'); await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(8000); }
  await page.waitForTimeout(2000);
  const ids = await page.evaluate(() => {
    let custId = '';
    document.querySelectorAll('input[name="value"]').forEach(i => {
      if (/^[a-z0-9]{32}$/.test(i.value || '')) custId = i.value;
    });
    if (!custId) custId = (document.querySelector('input[name="custId"]') || {}).value || '';
    return { custId };
  });
  log('ids:', JSON.stringify(ids));
  if (!ids.custId) { console.error('no GameId token found'); process.exit(1); }

  const buf = fs.readFileSync(ZIP);
  const name = path.basename(ZIP);
  const resp = await ctx.request.post(`https://gamemonetize.com/account/upload.php?gameid=${ids.custId}&id=${ID}`, {
    multipart: { file: { name, mimeType: 'application/x-zip-compressed', buffer: buf } },
    timeout: 240000,
  });
  const body = (await resp.text()).slice(0, 200);
  log('upload ->', resp.status(), body);
  await page.screenshot({ path: `/tmp/build_upload_${ID}.png` }).catch(() => {});
  await browser.close();
  if (resp.status() !== 200) process.exit(2);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
