#!/usr/bin/env node
'use strict';
/* Debug the GameMonetize login flow: print what happens after submit. */
const { chromium } = require('playwright');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), '[LOGIN]', ...a);

(async () => {
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 1000 }, userAgent: UA });
  const page = await ctx.newPage();
  page.on('dialog', d => { log('DIALOG:', d.message().slice(0, 120)); d.accept().catch(() => {}); });
  await page.goto('https://gamemonetize.com/account/login.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);
  const em = page.locator('input[type="email"]').first();
  await em.click(); await em.fill(process.env.GM_EMAIL || '');
  const pw = page.locator('input[name="password"]').first();
  await pw.click(); await pw.fill(process.env.GM_PASSWORD || '');
  log('submitting...');
  await page.locator('button[type="submit"]').first().click();
  await sleep(10000);
  log('url now:', page.url());
  const txt = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 500);
  log('body:', txt);
  await page.screenshot({ path: '/tmp/login_debug.png' });
  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
