#!/usr/bin/env node
'use strict';
/* Fetch the edit page of a game and dump status/ban-related text. */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const SESSION = path.join(__dirname, '.gm_session.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const ID = process.argv[2] || '86697';

(async () => {
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 1000 }, userAgent: UA, storageState: fs.existsSync(SESSION) ? SESSION : undefined });
  const page = await ctx.newPage();
  await page.goto(`https://gamemonetize.com/account/editgame.php?id=${ID}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(7000);
  if (/login/i.test(page.url())) { console.error('NOT LOGGED IN'); process.exit(1); }
  const info = await page.evaluate(() => {
    const t = document.body.innerText;
    const lines = t.split('\n').map(s => s.trim()).filter(Boolean);
    // grab lines around status keywords
    const kw = /banned|ban|reject|denied|review|status|reason|policy|violat|activ/i;
    const hits = lines.filter(l => kw.test(l)).slice(0, 40);
    const alerts = [...document.querySelectorAll('.alert, [class*="alert"], [class*="banner"], [class*="status"], [class*="message"]')]
      .map(e => (e.innerText || '').trim()).filter(Boolean).slice(0, 15);
    return { hits, alerts, head: lines.slice(0, 40) };
  });
  console.log(JSON.stringify(info, null, 1));
  await page.screenshot({ path: path.join(__dirname, 'banned_' + ID + '.png'), fullPage: false });
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
