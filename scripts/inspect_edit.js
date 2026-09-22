#!/usr/bin/env node
'use strict';
/* Inspect the editgame.php form: all selects/inputs/checkboxes names + options. */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const SESSION = path.join(__dirname, '.gm_session.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const ID = process.argv[2] || '86712';

(async () => {
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 1000 }, userAgent: UA, storageState: fs.existsSync(SESSION) ? SESSION : undefined });
  const page = await ctx.newPage();
  await page.goto(`https://gamemonetize.com/account/editgame.php?id=${ID}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000);
  if (/login/i.test(page.url())) { console.error('NOT LOGGED IN'); process.exit(1); }
  const info = await page.evaluate(() => {
    const out = { selects: [], checkboxes: [], textareas: [] };
    document.querySelectorAll('select').forEach(s => {
      out.selects.push({
        name: s.name, id: s.id, multiple: s.multiple, visible: !!(s.offsetParent || s.getClientRects().length),
        opts: [...s.options].slice(0, 12).map(o => o.text),
        nOpts: s.options.length,
      });
    });
    document.querySelectorAll('input[type="checkbox"]').forEach(c => out.checkboxes.push({ name: c.name, checked: c.checked, visible: !!(c.offsetParent || c.getClientRects().length) }));
    document.querySelectorAll('textarea').forEach(t => out.textareas.push({ name: t.name, visible: !!(t.offsetParent || t.getClientRects().length) }));
    return out;
  });
  console.log(JSON.stringify(info, null, 1));
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
