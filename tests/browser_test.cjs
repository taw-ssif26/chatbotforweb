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
  p = await open(B + '/app', { width: 1280, height: 900 });
  await p.type('#em', 'owner@test.dev'); await p.type('#pw', 'owner-password-123'); await p.click('form[data-form=login] button');
  await p.waitForSelector('.layout'); await p.screenshot({ path: '/tmp/shots/4_dash_bots.png' });
  await p.goto(`${B}/app#/bot/${bid}/install`, { waitUntil: 'networkidle0' }); await p.waitForSelector('.checks');
  const checks = await p.$$eval('.chk', els => els.map(e => e.className + ' ' + e.textContent));
  must(checks.length >= 4 && checks.slice(0, 3).every(c => c.includes('ok')), 'health checks: ' + checks.join(' / '));
  await p.type('#cs', SITE + '/'); await p.click('form[data-form=checksite] button');
  await p.waitForFunction(() => document.getElementById('siteresult').textContent.includes('snippet'), { timeout: 8000 }).catch(() => {});
  const site = await p.$eval('#siteresult', e => e.textContent);
  await p.screenshot({ path: '/tmp/shots/5_dash_install.png', fullPage: true });
  console.log('   site check says:', site.slice(0, 220));
  for (const h of ['knowledge', 'settings', 'chats']) { await p.goto(`${B}/app#/bot/${bid}/${h}`, { waitUntil: 'networkidle0' }); await sleep(300); await p.screenshot({ path: `/tmp/shots/6_dash_${h}.png`, fullPage: true }); }
  for (const h of ['admin/clients', 'admin/models', 'admin/settings', 'keys', 'account']) { await p.goto(`${B}/app#/${h}`, { waitUntil: 'networkidle0' }); await sleep(300); await p.screenshot({ path: `/tmp/shots/7_${h.replace('/', '_')}.png`, fullPage: true }); }
  ok('dashboard works in real Chrome; install tab shows the health checklist'); await p.close();
  // 6. an ordinary client clicks Manage, even when the server answers 502 (sleeping free-tier instance) on the first try
  await api('/admin/clients', { json: { email: 'cl@x.com', name: 'Client', password: 'client-pass-1', plan: 'starter', days: 30 } }, t);
  p = await open(B + '/app', { width: 1200, height: 900 });
  await p.type('#em', 'cl@x.com'); await p.type('#pw', 'client-pass-1'); await p.click('form[data-form=login] button'); await p.waitForSelector('.layout');
  await p.type('#nb', 'Client Bot'); await p.click('form[data-form=newbot] button'); await p.waitForFunction(() => document.querySelector('main').innerText.includes('Paste text'));
  await p.goto(B + '/app#/bots', { waitUntil: 'networkidle0' });
  await p.setRequestInterception(true); let failed = 0;
  p.on('request', rq => { if (rq.url().match(/\/api\/bots\/\d+$/) && rq.method() === 'GET' && failed < 2) { failed++; rq.respond({ status: 502, contentType: 'text/html', body: '<html>Bad gateway</html>' }); } else rq.continue(); });
  await p.waitForSelector('a[href^="#/bot/"]'); await sleep(500);
  await p.click('a[href^="#/bot/"]');
  await p.waitForFunction(() => document.querySelector('main').innerText.includes('Paste text'), { timeout: 15000 });
  must(failed === 2, 'expected two simulated 502s, got ' + failed);
  await p.screenshot({ path: '/tmp/shots/8_client_manage.png' }); await p.close(); ok('client clicks Manage: survives two 502s from a sleeping server and loads');
  // 7. a client changes their password with an emailed code (the fake server writes every email to /tmp/emails.log)
  fs.writeFileSync('/tmp/emails.log', '');
  p = await open(B + '/app', { width: 1200, height: 900 });
  await p.type('#em', 'cl@x.com'); await p.type('#pw', 'client-pass-1'); await p.click('form[data-form=login] button'); await p.waitForSelector('.layout');
  await p.goto(B + '/app#/account', { waitUntil: 'networkidle0' }); await p.waitForSelector('form[data-form=pwcode]');
  await p.type('#o', 'client-pass-1'); await p.type('#nw', 'brand-new-pass-9'); await p.click('form[data-form=pwcode] button');
  await p.waitForSelector('#pc');
  const mail = JSON.parse(fs.readFileSync('/tmp/emails.log', 'utf8').trim().split('\n').pop());
  must(mail.to === 'cl@x.com' && /verification code/i.test(mail.subject), 'code email not sent: ' + JSON.stringify(mail));
  must((await p.$eval('#pwcard', e => e.innerText)).includes('c***@x.com'), 'masked address not shown');
  const code = mail.text.match(/\b(\d{6})\b/)[1], wrongCode = code === '000000' ? '111111' : '000000';
  await p.type('#pc', wrongCode); await p.click('form[data-form=pwconfirm] button');
  await p.waitForFunction(() => document.getElementById('toast').className.includes('bad'), { timeout: 5000 });
  must((await p.$eval('#toast', e => e.textContent)).includes('wrong or has expired'), 'wrong-code message missing');
  await p.screenshot({ path: '/tmp/shots/9_code_step.png' });
  await p.$eval('#pc', e => { e.value = ''; }); await p.type('#pc', code); await p.click('form[data-form=pwconfirm] button');
  await p.waitForFunction(() => document.getElementById('toast').textContent.includes('Password changed'), { timeout: 8000 });
  await p.evaluate(() => localStorage.clear()); await p.goto(B + '/app', { waitUntil: 'networkidle0' });
  await p.type('#em', 'cl@x.com'); await p.type('#pw', 'client-pass-1'); await p.click('form[data-form=login] button');
  await p.waitForFunction(() => document.getElementById('toast').className.includes('bad'), { timeout: 5000 });   // the old password no longer works
  await p.$eval('#pw', e => { e.value = ''; }); await p.type('#pw', 'brand-new-pass-9'); await p.click('form[data-form=login] button'); await p.waitForSelector('.layout');
  await p.close(); ok('client changes password in the UI: code emailed, wrong code rejected, right code accepted, new password works');

  // 9. owner edits the landing page in the dashboard; a visitor sees offers, ad, bar, contact buttons, demo bot; sends a request
  const ownerLogin = async pg => { await pg.type('#em', 'owner@test.dev'); await pg.type('#pw', 'owner-password-123'); await pg.click('form[data-form=login] button'); await pg.waitForSelector('.layout'); };
  p = await open(B + '/app', { width: 1280, height: 1000 });
  must((await p.$eval('#logincontacts', e => e.textContent)) !== undefined, 'login contact box');
  await ownerLogin(p);
  await p.goto(B + '/app#/admin/landing', { waitUntil: 'networkidle0' }); await p.waitForSelector('form[data-form=sitesave]');
  await p.$eval('#sh', e => { e.value = ''; }); await p.type('#sh', 'Chat that sells while you sleep');
  await p.select('#sd', key);
  await p.click('[data-act=addcontact]'); const rows = await p.$$('[data-contact]'); await (await rows[rows.length - 1].$('[name=cvalue]')).type('+880 1700-000000');
  await p.click('[data-act=addcontact]'); const rows2 = await p.$$('[data-contact]'); const last = rows2[rows2.length - 1];
  await last.$eval('[name=ctype]', e => { e.value = 'email'; }); await (await last.$('[name=cvalue]')).type('hello@example.com');
  await p.$eval('form[data-form=sitesave] button:not([type=button])', e => e.click());
  await p.waitForFunction(() => document.getElementById('toast').textContent === 'Landing page updated', { timeout: 6000 });
  const addPromo = async (kind, fields, ends) => {
    await p.click(`[data-act=newpromo][data-kind=${kind}]`); await p.waitForSelector('dialog[open] form[data-form=promosave]');
    for (const [sel, val] of Object.entries(fields)) await p.type(`dialog ${sel}`, val);
    if (ends) await p.$eval('dialog #pe', (e, v) => { e.value = v; }, ends);
    await p.$eval('dialog form button:not([type=button])', e => e.click());
    await p.waitForFunction(() => !document.querySelector('dialog[open]') && document.getElementById('toast').textContent === 'Saved', { timeout: 6000 }); await sleep(400);
  };
  await addPromo('offer', { '#pt': 'Launch week', '#px': 'Half price setup for the first five customers.', '#pb': 'Limited time', '#pp': '$9', '#po': '$18', '#pc': 'Claim it' }, '2099-01-01T00:00');
  await addPromo('bar', { '#pt': 'Free setup this month' });
  await addPromo('ad', { '#pt': 'Need a website too?', '#px': 'I build fast, clean sites for small businesses.', '#pc': 'See my work' });
  await p.screenshot({ path: '/tmp/shots/10_owner_landing_editor.png', fullPage: true });
  ok('owner edits headline, demo bot, contact channels and adds an offer, a top bar and an ad in the UI');

  const v = await open(B + '/', { width: 1280, height: 900 });
  await v.waitForSelector('.offer'); await sleep(500);
  const lp = await v.evaluate(() => ({ h1: document.querySelector('h1').textContent, offer: document.querySelector('.offer').innerText, bar: document.getElementById('bar').innerText,
    ad: document.querySelector('.ad') && document.querySelector('.ad').innerText, wa: [...document.querySelectorAll('.channel')].map(a => a.href), demo: !document.getElementById('demobtn').hidden,
    noSignup: ![...document.querySelectorAll('a, button')].some(e => /sign ?up|register|free trial|start free/i.test(e.textContent)) }));
  must(lp.h1 === 'Chat that sells while you sleep', 'headline ' + lp.h1);
  must(lp.offer.includes('Launch week') && lp.offer.includes('$9') && lp.offer.includes('$18') && /Ends in/.test(lp.offer) && lp.offer.includes('Claim it'), 'offer card: ' + lp.offer);
  must(lp.bar.includes('Free setup this month') && !/null|undefined/.test(lp.bar), 'bar text: ' + lp.bar); must(lp.ad && lp.ad.includes('Need a website too?'), 'ad banner');
  must(lp.wa.some(h => h.startsWith('https://wa.me/8801700000000')) && lp.wa.includes('mailto:hello@example.com'), 'contact links ' + lp.wa.join(','));
  must(lp.demo, 'demo button'); must(lp.noSignup, 'landing page must not have a sign-up / register / free-trial button or link');
  await v.waitForFunction(() => [...document.body.children].some(e => e.shadowRoot), { timeout: 8000 });
  const con = await v.evaluate(() => { const a = document.getElementById('console'), r = a.getBoundingClientRect(), p = getComputedStyle(document.getElementById('pill')).display; return { text: a.textContent.trim(), href: a.getAttribute('href'), visible: r.width > 40 && r.top >= 0 && r.top < 80, pill: p }; });
  must(con.text === 'Console' && con.href === '/app' && con.visible, 'Console button in the header: ' + JSON.stringify(con)); must(con.pill === 'none', 'floating pill must be phone-only');
  await v.screenshot({ path: '/tmp/shots/11_landing_light.png', fullPage: true });
  await v.click('#themebtn'); await v.click('#themebtn');   // auto -> light -> dark
  const dark = await v.evaluate(() => ({ t: document.documentElement.dataset.theme, bg: getComputedStyle(document.body).backgroundColor }));
  must(dark.t === 'dark' && dark.bg === 'rgb(8, 12, 25)', 'dark mode: ' + JSON.stringify(dark));
  await v.screenshot({ path: '/tmp/shots/12_landing_dark.png', fullPage: true });
  await v.type('#ln', 'Rina'); await v.type('#lc', 'rina@shop.com'); await v.type('#lm', 'I run a bakery website'); await v.click('#leadform button');
  await v.waitForFunction(() => document.getElementById('formmsg').classList.contains('ok'), { timeout: 6000 });
  await v.close(); ok('visitor sees the live landing page (offer + countdown, bar, ad, contact buttons, demo bubble), dark mode works, and sends an access request');

  const m = await open(B + '/', { width: 390, height: 800, isMobile: true, hasTouch: true });
  await m.waitForSelector('.offer'); await sleep(400);
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  must(overflow <= 1, 'landing page scrolls sideways on a phone by ' + overflow + 'px');
  const nv = await m.evaluate(() => { const r = q => document.querySelector(q).getBoundingClientRect(), c = r('#console'), mb = r('#menubtn'), b = r('#brand');
    return { href: document.getElementById('console').getAttribute('href'), consoleOnScreen: c.width > 40 && c.right <= innerWidth && c.left >= 0, heights: [c.height, mb.height], brandClear: b.right <= c.left + 1, brandText: document.getElementById('brand').scrollWidth <= document.getElementById('brand').clientWidth + 1, getAccessHidden: getComputedStyle(document.querySelector('.getaccess')).display === 'none' }; });
  must(nv.href === '/app' && nv.consoleOnScreen && nv.brandClear, 'phone header: ' + JSON.stringify(nv)); must(nv.brandText, 'brand name is cut off on a phone');
  must(nv.heights.every(h => h >= 43.5), 'header tap targets under 44px: ' + nv.heights.join(','));
  await m.screenshot({ path: '/tmp/shots/13_landing_mobile.png', fullPage: true });
  await m.click('#menubtn'); await m.waitForSelector('#menu a[href="#pricing"]', { visible: true });
  must(await m.$eval('#menubtn', e => e.getAttribute('aria-expanded') === 'true'), 'menu button state');
  await m.screenshot({ path: '/tmp/shots/13b_mobile_menu.png' });
  must(await m.$eval('#themebtn2', e => e.getBoundingClientRect().height >= 43.5), 'theme row in the menu must be a 44px tap target');
  await m.click('#themebtn2'); await sleep(200); must(await m.$eval('#nav', e => e.classList.contains('open')), 'menu should stay open after changing theme');
  await m.click('#menu a[href="#pricing"]'); await sleep(900);
  must(!(await m.$eval('#nav', e => e.classList.contains('open'))), 'menu should close after choosing a link');
  await m.evaluate(() => document.getElementById('features').scrollIntoView()); await sleep(1000);
  const pl = await m.evaluate(() => { const p = document.getElementById('pill'), r = p.getBoundingClientRect(), h = [...document.body.children].find(e => e.shadowRoot), f = h && h.shadowRoot.querySelector('.fab').getBoundingClientRect();
    return { shown: !p.hidden && getComputedStyle(p).display !== 'none', overlapsBubble: f ? !(r.right < f.left || r.left > f.right || r.bottom < f.top || r.top > f.bottom) : false, h: r.height }; });
  must(pl.shown && !pl.overlapsBubble && pl.h >= 44, 'floating Get access button: ' + JSON.stringify(pl));
  await m.evaluate(() => document.getElementById('contact').scrollIntoView()); await sleep(1000);
  must(await m.$eval('#pill', e => e.hidden), 'pill should hide when the contact section is on screen');
  await m.close();
  const tiny = await open(B + '/', { width: 360, height: 740, isMobile: true, hasTouch: true }); await tiny.waitForSelector('.offer'); await sleep(300);
  must((await tiny.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1, 'sideways scroll at 360px');
  must(await tiny.evaluate(() => { const c = document.getElementById('console').getBoundingClientRect(); return c.right <= innerWidth && c.width > 40; }), 'Console button cut off at 360px');
  await tiny.close(); ok('phone: Console button visible, menu works, floating Get access avoids the chat bubble, 44px tap targets, no sideways scroll down to 360px');

  await p.goto(B + '/app#/admin/requests', { waitUntil: 'networkidle0' }); await p.waitForSelector('table');
  must((await p.$eval('table', e => e.innerText)).includes('Rina'), 'request not in the owner inbox');
  await p.screenshot({ path: '/tmp/shots/14_requests.png', fullPage: true }); ok('the request appears in Owner → Requests');

  // 10. client customises the chat look with a live preview; visitors then see the new colours; dashboard dark mode
  await p.goto(`${B}/app#/bot/${bid}/appearance`, { waitUntil: 'networkidle0' }); await p.waitForSelector('#apreview');
  await p.waitForFunction(() => document.querySelector('#apreview').firstElementChild && document.querySelector('#apreview').firstElementChild.shadowRoot, { timeout: 8000 });
  await p.click('[data-act=preset][data-name=Neon]'); await sleep(300);
  const pv = await p.evaluate(() => { const h = document.querySelector('#apreview').firstElementChild; const cs = getComputedStyle(h); return { bg: cs.getPropertyValue('--bg').trim(), c: cs.getPropertyValue('--c').trim(), panel: getComputedStyle(h.shadowRoot.querySelector('.panel')).backgroundColor, hint: document.getElementById('contrast').innerText }; });
  must(pv.bg === '#05070d' && pv.c === '#22d3a5' && pv.panel === 'rgb(5, 7, 13)', 'live preview did not follow the preset: ' + JSON.stringify(pv));
  // automatic text colour keeps a light background readable: no warning
  await p.$eval('#ap-bg_color', e => { e.value = '#ffffff'; e.dispatchEvent(new Event('input', { bubbles: true })); });
  await sleep(200); must((await p.$eval('#contrast', e => e.innerText)).includes('easy to read'), 'auto text colour should keep light backgrounds readable');
  // forcing light text onto that light background must be flagged
  await p.click('[data-auto=text_color]'); await p.$eval('#ap-text_color', e => { e.value = '#f5f5f5'; e.dispatchEvent(new Event('input', { bubbles: true })); });
  await sleep(200); must((await p.$eval('#contrast', e => e.innerText)).toLowerCase().includes('hard to read'), 'contrast warning missing for light text on a light background');
  await p.click('[data-auto=text_color]');   // back to automatic
  await p.$eval('#ap-bg_color', e => { e.value = '#05070d'; e.dispatchEvent(new Event('input', { bubbles: true })); });
  await p.screenshot({ path: '/tmp/shots/15_appearance_editor.png', fullPage: true });
  await p.$eval('#apform button:not([type=button])', e => e.click());
  await p.waitForFunction(() => document.getElementById('toast').textContent === 'Appearance saved', { timeout: 6000 }); ok('appearance editor: preset applies to the live preview, low contrast is flagged, saving works');
  const cust = await open(SITE + '/');
  await cust.evaluate(() => [...document.body.children].find(e => e.shadowRoot).shadowRoot.querySelector('.fab').click()); await sleep(400);
  const look = await cust.evaluate(() => { const r = [...document.body.children].find(e => e.shadowRoot).shadowRoot; return { panel: getComputedStyle(r.querySelector('.panel')).backgroundColor, head: getComputedStyle(r.querySelector('header')).backgroundColor }; });
  must(look.panel === 'rgb(5, 7, 13)' && look.head === 'rgb(34, 211, 165)', 'customer site did not get the new look: ' + JSON.stringify(look));
  await cust.screenshot({ path: '/tmp/shots/16_custom_widget.png' }); await cust.close(); ok('visitors on the customer site get the saved colours');
  await p.click('[data-act=settheme][data-t=dark]'); await sleep(200);
  const dd = await p.evaluate(() => ({ t: document.documentElement.dataset.theme, bg: getComputedStyle(document.body).backgroundColor }));
  must(dd.t === 'dark' && dd.bg === 'rgb(8, 13, 27)', 'dashboard dark mode: ' + JSON.stringify(dd));
  await p.screenshot({ path: '/tmp/shots/17_dashboard_dark.png', fullPage: true });
  await p.goto(`${B}/app#/bot/${bid}/install`, { waitUntil: 'networkidle0' }); await p.waitForSelector('.checks'); await sleep(300);
  await p.screenshot({ path: '/tmp/shots/18_install_dark.png', fullPage: true }); await p.close(); ok('dashboard dark mode works');
  await br.close(); srv.close(); console.log('BROWSER PASSED'); process.exit(0);
})().catch(e => { console.error('BROWSER FAILED:', e.message); process.exit(1); });
