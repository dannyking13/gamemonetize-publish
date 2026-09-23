#!/usr/bin/env node
'use strict';
/* Rename a game: node rename_game.js <numericId> <newName>
 * Fills input[name="name"] on editgame.php and clicks Save Changes. */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const SESSION = path.join(__dirname, '.gm_session.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const ID = process.argv[2];
const NAME = process.argv[3];
if (!ID || !NAME) { console.error('usage: node rename_game.js <numericId> <newName>'); process.exit(1); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), '[REN]', ...a);

(async () => {
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 1000 }, userAgent: UA, storageState: fs.existsSync(SESSION) ? SESSION : undefined });
  const page = await ctx.newPage();
  page.on('dialog', d => d.accept().catch(() => {}));
  await page.goto('https://gamemonetize.com/account/index.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);
  if (/login/i.test(page.url())) {
    const em = page.locator('input[type="email"]').first();
    await em.click(); await em.fill(process.env.GM_EMAIL || '');
    const pw = page.locator('input[name="password"]').first();
    await pw.click(); await pw.fill(process.env.GM_PASSWORD || '');
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(8000);
    fs.writeFileSync(SESSION, JSON.stringify(await ctx.storageState(), null, 2));
  }
  await page.goto(`https://gamemonetize.com/account/editgame.php?id=${ID}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);
  const nameField = page.locator('input[name="name"]').first();
  const old = await nameField.inputValue();
  await nameField.fill(NAME);
  await page.locator('button:has-text("Save Changes"), input[value="Save Changes"], button:has-text("Save")').first().click();
  await page.waitForTimeout(6000);
  // verify persisted
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  const now = await page.locator('input[name="name"]').first().inputValue();
  log(`${ID}: "${old}" -> "${now}" ${now === NAME ? 'OK' : 'MISMATCH!'}`);
  await browser.close();
  process.exit(now === NAME ? 0 : 2);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
