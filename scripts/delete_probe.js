#!/usr/bin/env node
'use strict';
/* Probe: does the GameMonetize dashboard offer game deletion?
 * Checks the edit page + games list for delete links/buttons/endpoints. */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const SESSION = path.join(__dirname, '.gm_session.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const ID = process.argv[2] || '86712';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), '[DEL]', ...a);

(async () => {
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 1000 }, userAgent: UA, storageState: fs.existsSync(SESSION) ? SESSION : undefined });
  const page = await ctx.newPage();
  await page.goto('https://gamemonetize.com/account/index.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);
  if (/login/i.test(page.url())) { console.error('login needed'); process.exit(1); }

  // scan the games list for any delete control
  await page.goto('https://gamemonetize.com/account/games.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);
  const listInfo = await page.evaluate(() => {
    const hits = [];
    document.querySelectorAll('a,button,input[type="submit"],[onclick]').forEach(el => {
      const t = ((el.innerText || el.value || el.getAttribute('onclick') || '') + ' ' + (el.className || '')).toLowerCase();
      if (/delete|remove|suppr|trash|drop game/.test(t)) {
        hits.push({ tag: el.tagName, text: (el.innerText || el.value || '').slice(0, 40), onclick: (el.getAttribute('onclick') || '').slice(0, 80), href: (el.href || '').slice(0, 90) });
      }
    });
    return { url: location.href, hits: hits.slice(0, 10) };
  });
  log('games.php delete controls:', JSON.stringify(listInfo, null, 1));

  // scan the edit page
  await page.goto(`https://gamemonetize.com/account/editgame.php?id=${ID}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);
  const editInfo = await page.evaluate(() => {
    const hits = [];
    document.querySelectorAll('a,button,input[type="submit"],[onclick]').forEach(el => {
      const t = ((el.innerText || el.value || el.getAttribute('onclick') || '') + ' ' + (el.className || '')).toLowerCase();
      if (/delete|remove|suppr|trash|drop game/.test(t)) {
        hits.push({ tag: el.tagName, text: (el.innerText || el.value || '').slice(0, 40), onclick: (el.getAttribute('onclick') || '').slice(0, 80), href: (el.href || '').slice(0, 90) });
      }
    });
    return { url: location.href, hits: hits.slice(0, 10) };
  });
  log(`editgame ${ID} delete controls:`, JSON.stringify(editInfo, null, 1));

  await page.screenshot({ path: path.join(__dirname, 'delete_probe.png'), fullPage: false });
  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
