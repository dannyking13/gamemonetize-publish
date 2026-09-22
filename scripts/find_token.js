#!/usr/bin/env node
'use strict';
/* Find the 32-char GameId token on editgame.php and where it lives. */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const SESSION = path.join(__dirname, '.gm_session.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const ID = process.argv[2];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), '[TOK]', ...a);

(async () => {
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 1000 }, userAgent: UA, storageState: fs.existsSync(SESSION) ? SESSION : undefined });
  const page = await ctx.newPage();
  await page.goto('https://gamemonetize.com/account/index.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);
  if (/login/i.test(page.url())) { console.error('NOT LOGGED IN'); process.exit(1); }
  await page.goto(`https://gamemonetize.com/account/editgame.php?id=${ID}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000);
  const res = await page.evaluate(() => {
    const html = document.documentElement.innerHTML;
    const tokens = {};
    // 32-char lowercase alnum tokens with their surrounding 80 chars
    const re = /[a-z0-9]{32}/g;
    let m, n = 0;
    while ((m = re.exec(html)) && n < 10) {
      const t = m[0];
      if (/^(https|images|assets|fonts|static)/.test(t)) continue;
      const ctxStr = html.slice(Math.max(0, m.index - 90), m.index + 42).replace(/\s+/g, ' ');
      if (!tokens[t]) { tokens[t] = ctxStr; n++; }
    }
    const inputs = Array.from(document.querySelectorAll('input, textarea')).map(e => ({
      name: e.getAttribute('name') || '', type: e.getAttribute('type') || '', val: (e.value || '').slice(0, 50),
    })).filter(x => x.name);
    return { tokens, inputs };
  });
  console.log('TOKENS:', JSON.stringify(res.tokens, null, 1));
  console.log('INPUTS:', JSON.stringify(res.inputs, null, 1));
  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
