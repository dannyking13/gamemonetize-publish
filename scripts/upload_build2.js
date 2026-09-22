#!/usr/bin/env node
'use strict';
/* Upload zip via in-page fetch() from editgame.php (session cookies + referrer). */
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
  if (!ID || !ZIP || !fs.existsSync(ZIP)) { console.error('usage: node upload_build2.js <numericId> <zip>'); process.exit(1); }
  const buf = fs.readFileSync(ZIP);
  const b64 = buf.toString('base64');
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 1000 }, userAgent: UA, storageState: fs.existsSync(SESSION) ? SESSION : undefined });
  const page = await ctx.newPage();
  page.on('dialog', d => { log('dialog:', d.message().slice(0, 100)); d.accept().catch(() => {}); });
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
  const res = await page.evaluate(async ({ b64, gid }) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    // find GameId token
    let custId = '';
    document.querySelectorAll('input[name="value"]').forEach(i => {
      if (/^[a-z0-9]{32}$/.test(i.value || '')) custId = i.value;
    });
    if (!custId) return { err: 'no token' };
    const fd = new FormData();
    fd.append('file', new Blob([bytes], { type: 'application/x-zip-compressed' }), 'build.zip');
    const r = await fetch(`https://gamemonetize.com/account/upload.php?gameid=${custId}&id=${gid}`, {
      method: 'POST', body: fd, credentials: 'include',
    });
    const t = await r.text();
    return { status: r.status, body: t.slice(0, 200) };
  }, { b64, gid: ID });
  console.log('RESULT:', JSON.stringify(res).slice(0, 300));
  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
