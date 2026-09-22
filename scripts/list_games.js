#!/usr/bin/env node
'use strict';
/* List all games in My Games: name, numeric id, GameId, activation state. */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const SESSION = path.join(__dirname, '.gm_session.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

(async () => {
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 1000 }, userAgent: UA, storageState: fs.existsSync(SESSION) ? SESSION : undefined });
  const page = await ctx.newPage();
  await page.goto('https://gamemonetize.com/account/games.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000);
  if (/login/i.test(page.url())) { console.error('NOT LOGGED IN'); process.exit(1); }
  const games = await page.evaluate(() => {
    const rows = [];
    document.querySelectorAll('a[href*="editgame.php?id="]').forEach(a => {
      const href = a.getAttribute('href') || '';
      const id = (href.match(/id=(\d+)/) || [])[1];
      const row = a.closest('tr') || a.parentElement;
      const txt = (row ? row.innerText : a.innerText).replace(/\s+/g, ' ').slice(0, 160);
      rows.push({ id, name: (a.innerText || '').trim().slice(0, 60), txt });
    });
    return rows;
  });
  console.log(JSON.stringify(games, null, 1));
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
