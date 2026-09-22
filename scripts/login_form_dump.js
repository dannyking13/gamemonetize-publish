#!/usr/bin/env node
'use strict';
/* Dump login form structure: inputs, captchas, hidden fields (defensive). */
const { chromium } = require('playwright');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), '[FORM]', ...a);

(async () => {
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 1000 }, userAgent: UA });
  const page = await ctx.newPage();
  await page.goto('https://gamemonetize.com/account/login.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);
  const forms = await page.evaluate(() => {
    const out = { forms: [], iframes: [] };
    try {
      Array.from(document.querySelectorAll('form')).forEach((f, i) => {
        const inputs = [];
        try {
          Array.from(f.querySelectorAll('input, button')).forEach(e => {
            inputs.push({ tag: e.tagName, type: e.getAttribute('type') || '', name: e.getAttribute('name') || '', visible: !!e.offsetParent });
          });
        } catch (e2) {}
        const captcha = !!f.querySelector('.g-recaptcha') || !!f.querySelector('[class*="captcha"]');
        out.forms.push({ i, action: String(f.getAttribute('action') || ''), captcha, inputs });
      });
      Array.from(document.querySelectorAll('iframe')).forEach(f => out.iframes.push(f.src));
    } catch (e3) { out.err = String(e3); }
    return out;
  });
  console.log(JSON.stringify(forms, null, 1));
  await page.screenshot({ path: '/tmp/login_form.png', fullPage: true });
  log('fill + submit');
  const em = page.locator('input[type="email"]').first();
  await em.fill(process.env.GM_EMAIL || '');
  const pw = page.locator('input[type="password"]').first();
  await pw.fill(process.env.GM_PASSWORD || '');
  await page.locator('button[type="submit"]').first().click();
  await sleep(9000);
  log('url:', page.url());
  const t = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
  const m = t.match(/(opps|error|invalid|incorrect|banned|disable|captcha)[^.]*/i);
  log('error text:', m ? m[0].slice(0, 150) : '(none)');
  await page.screenshot({ path: '/tmp/login_after.png', fullPage: true });
  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
