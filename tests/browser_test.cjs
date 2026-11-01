// Real Chrome (puppeteer-core + @sparticuz/chromium) against tests/serve_fake.py on :8099.
// Run: NODE_PATH=<dir with node_modules> node tests/browser_test.cjs      Screenshots land in /tmp/shots
const chromium = require('@sparticuz/chromium').default || require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');
const http = require('http'), fs = require('fs');
const B = 'http://localhost:8099', SITE = 'http://127.0.0.1:8100';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const api = async (p, o = {}, t) => { const r = await fetch(B + '/api' + p, { method: o.method || (o.json ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: o.json ? JSON.stringify(o.json) : undefined }); return r.json(); };
let n = 0; const ok = m => console.log('  ok ' + (++n) + ' ' + m);
const must = (c, m) => { if (!c) throw new Error(m); };
fs.mkdirSync('/tmp/shots', { recursive: true });

(async () => {
  const t = (await api('/auth/login', { json: { email: 'owner@test.dev', password: 'owner-password-123' } })).token;
  await api('/admin/platform-keys/groq', { method: 'PUT', json: { key: 'gsk_abcdefghijk' } }, t);
  const bid = (await api('/bots', { json: { name: 'Acme Bot' } }, t)).id;
  const key = (await api('/bots/' + bid, {}, t)).public_key;
  await api(`/bots/${bid}/sources/text`, { json: { title: 'Hours', content: 'Acme opens at nine am and closes at five pm every weekday. Refunds take seven days.' } }, t);
  const allow = d => api('/bots/' + bid, { method: 'PATCH', json: { allowed_domains: d } }, t);
  const page = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Acme</title></head><body style="font-family:sans-serif;margin:0;padding:24px"><h1>Acme Plumbing</h1><p>Customer website content. Call us today.</p><script src="${B}/widget.js" data-bot="${key}" async></script></body></html>`;
  const srv = http.createServer((q, s) => { s.setHeader('content-type', 'text/html'); s.end(page); }).listen(8100);
  const br = await puppeteer.launch({ args: [...chromium.args.filter(a => !['--single-process', '--no-zygote'].includes(a)), '--no-sandbox'], executablePath: await chromium.executablePath(), headless: 'shell' });

  const open = async (url, vp = { width: 1100, height: 700 }) => {
    const ctx = await br.createBrowserContext();  // fresh profile = empty HTTP cache, like a first-time visitor
    const p = await ctx.newPage(); await p.setViewport(vp);
    p.logs = []; p.on('console', m => p.logs.push(m.text()));
    await p.goto(url, { waitUntil: 'networkidle0' }); await sleep(600);
    p.fab = () => p.evaluate(() => { const h = [...document.body.children].find(e => e.shadowRoot); if (!h) return null; const r = h.shadowRoot.querySelector('.fab').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, vw: innerWidth, vh: innerHeight }; });
    return p;
  };
  const inView = f => f && f.w > 40 && f.x >= 0 && f.y >= 0 && f.x + f.w <= f.vw && f.y + f.h <= f.vh;

  // 1. the dashboard's own test page must show the bubble even when an allowlist is set (this was the bug)
  await allow(['127.0.0.1']);
  let p = await open(`${B}/demo?bot=${key}`);
  must(inView(await p.fab()), 'demo page: bubble not visible'); must((await p.$eval('#status', e => e.textContent)).includes('Bot found'), 'demo status text');
  await p.screenshot({ path: '/tmp/shots/1_demo.png' }); await p.close(); ok('"Open test page" shows the bubble with an allowlist set');

  // 2. real customer site: bubble visible bottom-right, chat works end to end
  p = await open(SITE + '/');
  const f = await p.fab(); must(inView(f), 'customer site: bubble not visible'); must(f.x > f.vw / 2 && f.y > f.vh / 2, 'bubble not bottom-right');
  await p.evaluate(() => [...document.body.children].find(e => e.shadowRoot).shadowRoot.querySelector('.fab').click());
  await sleep(300);
  await p.evaluate(() => { const ta = [...document.body.children].find(e => e.shadowRoot).shadowRoot.querySelector('textarea'); ta.focus(); });
  await p.keyboard.type('When do you open?'); await p.keyboard.press('Enter');
  await p.waitForFunction(() => [...document.body.children].find(e => e.shadowRoot).shadowRoot.querySelector('.log').textContent.includes('Hello from the bot.'), { timeout: 8000 });
  await p.screenshot({ path: '/tmp/shots/2_chat_desktop.png' });
  const panel = await p.evaluate(() => { const r = [...document.body.children].find(e => e.shadowRoot).shadowRoot.querySelector('.panel').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, vw: innerWidth, vh: innerHeight }; });
  must(inView(panel), 'panel overflows the viewport'); await p.close(); ok('customer site: bubble bottom-right, panel opens, typed message gets a streamed reply');

  // 3. phone viewport: panel goes full screen
  p = await open(SITE + '/', { width: 390, height: 780, isMobile: true, hasTouch: true });
  await p.evaluate(() => [...document.body.children].find(e => e.shadowRoot).shadowRoot.querySelector('.fab').click()); await sleep(300);
  const mp = await p.evaluate(() => { const r = [...document.body.children].find(e => e.shadowRoot).shadowRoot.querySelector('.panel').getBoundingClientRect(); return { w: r.width, h: r.height, vw: innerWidth, vh: innerHeight }; });
  must(mp.w >= mp.vw - 1 && mp.h >= mp.vh - 1, 'mobile panel not full-screen: ' + JSON.stringify(mp));
  await p.screenshot({ path: '/tmp/shots/3_chat_mobile.png' }); await p.close(); ok('phone: panel is full screen');

  // 4. site NOT in the allowlist: hidden, and the console says exactly why
  await allow(['acme.example']);
  p = await open(SITE + '/');
  must(!(await p.fab()), 'bubble must not show on a site outside the allowlist');
  must(p.logs.some(l => l.includes('[AIChat]') && l.includes('Allowed websites')), 'no helpful console message: ' + p.logs.join(' | ')); await p.close(); ok('disallowed site: hidden, console explains "add it under Allowed websites"');
  p = await open(`${B}/demo?bot=${key}`); must(inView(await p.fab()), 'demo must still work'); await p.close(); ok('test page still works for the owner');

  // 5. dashboard in real Chrome: login, install tab diagnostics
  await allow(['127.0.0.1']);
  p = await open(B + '/', { width: 1280, height: 900 });
  await p.type('#em', 'owner@test.dev'); await p.type('#pw', 'owner-password-123'); await p.click('form[data-form=login] button');
  await p.waitForSelector('.layout'); await p.screenshot({ path: '/tmp/shots/4_dash_bots.png' });
  await p.goto(`${B}/#/bot/${bid}/install`, { waitUntil: 'networkidle0' }); await p.waitForSelector('.checks');
  const checks = await p.$$eval('.chk', els => els.map(e => e.className + ' ' + e.textContent));
  must(checks.length >= 4 && checks.slice(0, 3).every(c => c.includes('ok')), 'health checks: ' + checks.join(' / '));
  await p.type('#cs', SITE + '/'); await p.click('form[data-form=checksite] button');
  await p.waitForFunction(() => document.getElementById('siteresult').textContent.includes('snippet'), { timeout: 8000 }).catch(() => {});
  const site = await p.$eval('#siteresult', e => e.textContent);
  await p.screenshot({ path: '/tmp/shots/5_dash_install.png', fullPage: true });
  console.log('   site check says:', site.slice(0, 220));
  for (const h of ['knowledge', 'settings', 'chats']) { await p.goto(`${B}/#/bot/${bid}/${h}`, { waitUntil: 'networkidle0' }); await sleep(300); await p.screenshot({ path: `/tmp/shots/6_dash_${h}.png`, fullPage: true }); }
  for (const h of ['admin/clients', 'admin/models', 'admin/settings', 'keys', 'account']) { await p.goto(`${B}/#/${h}`, { waitUntil: 'networkidle0' }); await sleep(300); await p.screenshot({ path: `/tmp/shots/7_${h.replace('/', '_')}.png`, fullPage: true }); }
  ok('dashboard works in real Chrome; install tab shows the health checklist'); await p.close();
  // 6. an ordinary client clicks Manage, even when the server answers 502 (sleeping free-tier instance) on the first try
  await api('/admin/clients', { json: { email: 'cl@x.com', name: 'Client', password: 'client-pass-1', plan: 'starter', days: 30 } }, t);
  p = await open(B + '/', { width: 1200, height: 900 });
  await p.type('#em', 'cl@x.com'); await p.type('#pw', 'client-pass-1'); await p.click('form[data-form=login] button'); await p.waitForSelector('.layout');
  await p.type('#nb', 'Client Bot'); await p.click('form[data-form=newbot] button'); await p.waitForFunction(() => document.querySelector('main').innerText.includes('Paste text'));
  await p.goto(B + '/#/bots', { waitUntil: 'networkidle0' });
  await p.setRequestInterception(true); let failed = 0;
  p.on('request', rq => { if (rq.url().match(/\/api\/bots\/\d+$/) && rq.method() === 'GET' && failed < 2) { failed++; rq.respond({ status: 502, contentType: 'text/html', body: '<html>Bad gateway</html>' }); } else rq.continue(); });
  await p.waitForSelector('a[href^="#/bot/"]'); await sleep(500);
  await p.click('a[href^="#/bot/"]');
  await p.waitForFunction(() => document.querySelector('main').innerText.includes('Paste text'), { timeout: 15000 });
  must(failed === 2, 'expected two simulated 502s, got ' + failed);
  await p.screenshot({ path: '/tmp/shots/8_client_manage.png' }); await p.close(); ok('client clicks Manage: survives two 502s from a sleeping server and loads');
  await br.close(); srv.close(); console.log('BROWSER PASSED'); process.exit(0);
})().catch(e => { console.error('BROWSER FAILED:', e.message); process.exit(1); });
