#!/usr/bin/env node
'use strict';
/* Read-only status probe: login -> editgame.php?id=<ID> -> report
 * review state ("Cancel review" present?), activation buttons state, game name. */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const ID = process.argv[2];
if (!ID) { console.error('usage: node status_probe.js <numericId>'); process.exit(1); }
const ROOT = path.join(__dirname);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

(async () => {
  const browser = await chromium.launch({ headless: false, args: ['--disable-blink-features=AutomationControlled'] });
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 1000 }, userAgent: UA });
  const page = await ctx.newPage();
  const log = (...a) => console.log(new Date().toISOString().slice(11, 19), '[PROBE]', ...a);

  await page.goto('https://gamemonetize.com/account/login.php', { waitUntil: 'domcontentloaded' });
  const em = page.locator('input[type="email"], input[name="email"]').first();
  await em.click(); await em.fill(process.env.GM_EMAIL || '');
  const pw = page.locator('input[type="password"]').first();
  await pw.click(); await pw.fill(process.env.GM_PASSWORD || '');
  await page.locator('button[type="submit"], input[type="submit"]').first().click();
  await page.waitForURL(/account|dashboard|games/, { timeout: 30000 }).catch(() => {});
  log('logged in');

  await page.goto(`https://gamemonetize.com/account/editgame.php?id=${ID}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);

  const name = await page.locator('input[name="name"], input[name="title"]').first().inputValue().catch(() => '(?)');
  const body = await page.content();
  const cancelReview = /cancel review/i.test(body);
  const requestAct = /request activation/i.test(body);
  const disabled = await page.$$eval('button, input[type="submit"]', els =>
    els.filter(e => /activation/i.test(e.textContent || e.value || ''))
       .map(e => e.disabled || e.classList.contains('disabled')));
  log(`id=${ID} name="${name}"`);
  log(`"Cancel review" visible: ${cancelReview}  -> ${cancelReview ? 'IN REVIEW' : 'NOT in review'}`);
  log(`"Request activation" visible: ${requestAct}, disabled states: ${JSON.stringify(disabled)}`);
  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
