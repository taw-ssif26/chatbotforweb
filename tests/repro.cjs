const chromium = require('@sparticuz/chromium').default || require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');
const http = require('http'), fs = require('fs');
const B = 'http://localhost:8099';
const api = async (p, o = {}, t) => { const r = await fetch(B + '/api' + p, { method: o.method || (o.json ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: o.json ? JSON.stringify(o.json) : undefined }); return r.json(); };
(async () => {
  const t = (await api('/auth/login', { json: { email: 'owner@test.dev', password: 'owner-password-123' } })).token;
  await api('/admin/platform-keys/groq', { method: 'PUT', json: { key: 'gsk_abcdefghijk' } }, t);
  const bid = (await api('/bots', { json: { name: 'Acme Bot' } }, t)).id;
  const key = (await api('/bots/' + bid, {}, t)).public_key;
  const allow = process.argv[2] ? process.argv[2].split(',') : [];
  await api('/bots/' + bid, { method: 'PATCH', json: { allowed_domains: allow } }, t);
  fs.writeFileSync('/tmp/site/page.html', fs.readFileSync('/tmp/site/index.html', 'utf8').replace('__KEY__', key));
  const srv = http.createServer((q, s) => { s.setHeader('content-type', 'text/html'); s.end(fs.readFileSync('/tmp/site/page.html')); }).listen(8100);
  const br = await puppeteer.launch({ args: [...chromium.args, '--no-sandbox'], executablePath: await chromium.executablePath(), headless: 'shell' });
  const check = async (name, url) => {
    const p = await br.newPage(); await p.setViewport({ width: 1100, height: 700 });
    const logs = []; p.on('console', m => logs.push(m.text())); p.on('requestfailed', r => logs.push('REQFAIL ' + r.url() + ' ' + (r.failure() || {}).errorText));
    p.on('response', r => { if (r.url().includes('/api/public')) logs.push(r.status() + ' ' + r.url().replace(B, '')); });
    await p.goto(url, { waitUntil: 'networkidle0' }); await new Promise(r => setTimeout(r, 800));
    const info = await p.evaluate(() => { const h = [...document.body.children].find(e => e.shadowRoot); if (!h) return null; const f = h.shadowRoot.querySelector('.fab').getBoundingClientRect(); return { x: f.x, y: f.y, w: f.width, h: f.height, vw: innerWidth, vh: innerHeight }; });
    console.log(name, '=>', info ? `VISIBLE fab ${Math.round(info.w)}x${Math.round(info.h)} at (${Math.round(info.x)},${Math.round(info.y)})` : 'NOT VISIBLE', logs.join(' | '));
    await p.screenshot({ path: `/tmp/${name}.png` }); await p.close(); return info;
  };
  await check('demo_page', `${B}/demo?bot=${key}`);
  await check('customer_site', 'http://127.0.0.1:8100/');
  await br.close(); srv.close(); process.exit(0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
