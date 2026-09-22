#!/usr/bin/env node
'use strict';
/* List ALL category options from the editgame.php select (scroll it to force
 * lazy rendering, then read option texts + values). */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const SESSION = path.join(__dirname, '.gm_session.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

(async () => {
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 1000 }, userAgent: UA, storageState: fs.existsSync(SESSION) ? SESSION : undefined });
  const page = await ctx.newPage();
  await page.goto('https://gamemonetize.com/account/editgame.php?id=86716', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000);
  if (/login/i.test(page.url())) { console.error('NOT LOGGED IN'); process.exit(1); }

  const cats = await page.evaluate(() => new Promise(resolve => {
    const sel = document.querySelector('select[name="category[]"]');
    if (!sel) return resolve(null);
    const seen = new Map();
    const collect = () => [...sel.options].forEach(o => seen.set(o.value, o.text.trim()));
    collect();
    // scroll through the select to force lazy option rendering
    let down = 0;
    const iv = setInterval(() => {
      sel.scrollTop += 40; down++;
      collect();
      if (down > 40) {
        clearInterval(iv);
        sel.scrollTop = 0;
        resolve([...seen.entries()].map(([value, text]) => ({ value, text })));
      }
    }, 60);
  }));
  console.log(JSON.stringify(cats, null, 1));
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
