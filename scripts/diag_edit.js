#!/usr/bin/env node
'use strict';
/* Diagnose editgame.php?id=<ID>: page text summary, verify link, activation state. */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const SESSION = path.join(__dirname, '.gm_session.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const ID = process.argv[2];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), '[DIAG]', ...a);

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
  log('url:', page.url());
  const info = await page.evaluate(() => {
    const t = document.body.innerText.replace(/\s+/g, ' ');
    const verify = !!Array.from(document.querySelectorAll('a')).find(a => /verify/i.test(a.innerText));
    const cancel = /cancel review/i.test(t);
    const act = Array.from(document.querySelectorAll('input[name="activation"]')).map(e => e.disabled);
    const name = (document.querySelector('input[name="name"]') || {}).value || '';
    const cats = Array.from(document.querySelectorAll('select[name="categories[]"] option:checked')).map(o => o.textContent.trim());
    const selects = Array.from(document.querySelectorAll('select')).map(s => ({
      name: s.getAttribute('name') || '',
      sel: Array.from(s.selectedOptions || []).map(o => o.textContent.trim()),
    }));
    const desc = ((document.querySelector('textarea[name="desc"]') || document.querySelector('textarea[name="description"]') || {}).value || '').slice(0, 60);
    return { verify, cancel, act, name, cats, desc, selects, snippet: t.slice(0, 400) };
  });
  console.log(JSON.stringify(info, null, 1));
  await page.screenshot({ path: path.join(__dirname, `diag_${ID}.png`), fullPage: false });
  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
