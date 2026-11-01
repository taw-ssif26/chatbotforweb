// Drives the real dashboard + widget JavaScript in jsdom against tests/serve_fake.py.
// Run: NODE_PATH=/path/to/node_modules node tests/ui_test.cjs   (npm i jsdom first)
const { JSDOM, VirtualConsole } = require('jsdom');
const BASE = 'http://localhost:8099';
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, what, ms = 8000) {
  const t = Date.now();
  for (;;) { try { const v = fn(); if (v) return v; } catch (e) {} if (Date.now() - t > ms) throw new Error('TIMEOUT waiting for: ' + what); await sleep(40); }
}
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push(e.message)); vc.on('error', e => errors.push(String(e)));
function setup(origin) {
  return win => {
    win.fetch = (u, o = {}) => { const h = Object.assign({}, o.headers || {}); if (origin) h.Origin = origin; return fetch(new URL(u, win.location.href), { ...o, headers: h }); };
    win.TextDecoder = TextDecoder;
    if (!win.crypto) win.crypto = require('crypto').webcrypto;
    win.confirm = () => true;
    win.HTMLElement.prototype.scrollIntoView = () => {};
    win.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    win.HTMLDialogElement.prototype.close = function () { this.open = false; };
    Object.defineProperty(win.navigator, 'clipboard', { value: { writeText: async () => {} } });
  };
}
const fill = (f, name, v) => { f.elements[name].value = v; };
const submit = (win, f) => f.dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
const text = d => d.body.textContent;
let n = 0; const ok = m => console.log('  ok ' + (++n) + ' ' + m);

(async () => {
  const dash = await JSDOM.fromURL(BASE + '/', { runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc, beforeParse: setup() });
  const w = dash.window, d = w.document;
  const go = async (hash, probe, what) => { w.location.hash = hash; await waitFor(probe, what); };

  // --- login
  await waitFor(() => d.querySelector('form[data-form=login]'), 'login form');
  let f = d.querySelector('form[data-form=login]');
  fill(f, 'email', 'owner@test.dev'); fill(f, 'password', 'wrong-password-x'); submit(w, f);
  await waitFor(() => d.getElementById('toast').className.includes('bad'), 'bad login toast'); ok('wrong password shows an error');
  fill(f, 'password', 'owner-password-123'); submit(w, f);
  await waitFor(() => d.querySelector('.layout') && text(d).includes('No bots yet'), 'dashboard after login'); ok('login works, empty state shown');
  if (!text(d).includes('Clients')) throw new Error('owner nav missing');

  // --- owner adds a platform key first (bots without any usable key correctly refuse to answer)
  await go('#/admin/settings', () => d.querySelector('form[data-form=pkey]'), 'settings page');
  f = d.querySelector('form[data-form=pkey][data-p=groq]'); fill(f, 'key', 'gsk_abcdefghijklmnop'); submit(w, f);
  await waitFor(() => text(d).includes('Configured'), 'platform key configured'); ok('platform key stored');
  await go('#/bots', () => d.querySelector('form[data-form=newbot]'), 'bots page');

  // --- create bot, knowledge (also checks XSS escaping)
  f = d.querySelector('form[data-form=newbot]'); fill(f, 'name', 'UI Bot'); submit(w, f);
  await waitFor(() => w.location.hash.startsWith('#/bot/') && d.querySelector('form[data-form=addtext]'), 'knowledge tab'); ok('bot created, knowledge tab renders');
  f = d.querySelector('form[data-form=addtext]');
  fill(f, 'title', 'Opening <b>Hours</b>'); fill(f, 'content', 'We open at nine am and close at five pm on every weekday. Refunds take seven days.'); submit(w, f);
  await waitFor(() => d.querySelector('table') && text(d).includes('Opening'), 'source row');
  if (d.querySelector('table b')) throw new Error('XSS: title rendered as HTML');
  ok('text source indexed; HTML in titles is escaped');

  // --- settings
  const base = w.location.hash.split('/').slice(0, 3).join('/');
  await go(base + '/settings', () => d.querySelector('form[data-form=savebot]'), 'settings form');
  f = d.querySelector('form[data-form=savebot]'); fill(f, 'name', 'UI Bot Renamed'); fill(f, 'allowed_domains', 'https://www.acme.test/page'); submit(w, f);
  await waitFor(() => d.getElementById('toast').textContent === 'Saved', 'saved toast'); ok('settings saved');

  // --- install snippet
  await go(base + '/install', () => d.getElementById('snip'), 'install tab');
  const snip = d.getElementById('snip').textContent;
  const key = (snip.match(/data-bot="([^"]+)"/) || [])[1];
  if (!key || !snip.includes('/widget.js') || !snip.includes('async')) throw new Error('bad snippet: ' + snip);
  ok('one-line snippet: ' + snip);

  d.querySelector('[data-act=testmodel]').click();
  await waitFor(() => text(d).includes('answered through'), 'model test result'); ok('"Test the AI model" reports the model answered');

  // --- widget on a third-party origin
  const site = await JSDOM.fromURL('about:blank').catch(() => null);
  const page = new JSDOM(`<!doctype html><body><h1>Customer site</h1><script src="${BASE}/widget.js" data-bot="${key}" async></script></body>`,
    { url: 'https://www.acme.test/', runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc, beforeParse: setup('https://www.acme.test') });
  const pd = page.window.document;
  const host = await waitFor(() => [...pd.body.children].find(e => e.shadowRoot), 'widget mounted'); ok('widget mounted from one script tag, inside a shadow root');
  const sr = host.shadowRoot;
  sr.querySelector('.fab').click();
  await waitFor(() => !sr.querySelector('.panel').hidden, 'panel open');
  if (!sr.querySelector('.m.bot').textContent.includes('How can I help')) throw new Error('welcome missing');
  if (!sr.querySelector('footer').textContent.includes('Privacy') || sr.querySelector('footer').textContent.includes('Powered by')) throw new Error('footer: ' + sr.querySelector('footer').textContent);
  ok('opens, shows welcome + privacy link (owner bots carry no "Powered by")');
  sr.querySelector('textarea').value = 'When do you open?'; submit(page.window, sr.querySelector('form'));
  await waitFor(() => { const m = sr.querySelectorAll('.m.bot'); return m[m.length - 1].textContent.includes('Hello from the bot.'); }, 'streamed answer');
  ok('streamed answer rendered in the widget');
  await waitFor(() => page.window.localStorage.getItem('aichat_' + key + 'h'), 'history saved after the stream ends'); ok('conversation persisted for page reloads');

  // --- widget on a forbidden origin must not mount
  const evil = new JSDOM(`<!doctype html><body><script src="${BASE}/widget.js" data-bot="${key}" async></script></body>`,
    { url: 'https://evil.test/', runScripts: 'dangerously', resources: 'usable', virtualConsole: vc, beforeParse: setup('https://evil.test') });
  await sleep(1200);
  if ([...evil.window.document.body.children].some(e => e.shadowRoot)) throw new Error('widget mounted on a disallowed site');
  ok('widget does not load on a site outside the allowlist');

  // --- conversations tab shows the chat
  await go(base + '/chats', () => text(d).includes('When do you open?'), 'conversation row');
  d.querySelector('[data-act=openconv]').click();
  await waitFor(() => d.getElementById('conv') && d.getElementById('conv').textContent.includes('Hello from the bot.'), 'conversation view'); ok('visitor chat visible in dashboard');

  // --- admin: clients, models, settings, keys, account
  await go('#/admin/clients', () => d.querySelector('form[data-form=newclient]'), 'clients page');
  f = d.querySelector('form[data-form=newclient]'); fill(f, 'email', 'ui-client@x.com'); fill(f, 'name', 'UI Client'); fill(f, 'password', 'client-pass-1'); fill(f, 'plan', 'premium'); fill(f, 'days', '30'); submit(w, f);
  await waitFor(() => text(d).includes('ui-client@x.com'), 'new client row'); ok('client created from the owner dashboard');
  d.querySelector('[data-act=extend]').click(); await waitFor(() => d.getElementById('toast').textContent.includes('Extended'), 'extend');
  d.querySelector('[data-act=toggleclient]').click(); await waitFor(() => text(d).includes('Disabled'), 'disable client'); ok('Paid +30 days and Disable work');
  d.querySelector('[data-act=editclient]').click(); await waitFor(() => d.querySelector('dialog form[data-form=editclient]'), 'edit dialog'); ok('edit dialog opens');
  await go('#/admin/models', () => d.querySelector('[data-act=mtoggle]'), 'models page');
  d.querySelector('[data-field=enabled]').click(); await waitFor(() => text(d).includes('Disabled'), 'model disabled'); ok('model enable/disable toggle works');
  await go('#/admin/settings', () => d.querySelector('form[data-form=agency]'), 'settings page');
  f = d.querySelector('form[data-form=agency]'); fill(f, 'agency_site', 'https://tawsif.example'); fill(f, 'agency_mode', 'ask'); submit(w, f);
  await waitFor(() => d.getElementById('toast').textContent === 'Profile saved', 'profile saved'); ok('marketing profile + promotion style saved');
  await go('#/keys', () => d.querySelector('form[data-form=addkey]'), 'keys page');
  f = d.querySelector('form[data-form=addkey]'); fill(f, 'provider', 'openai'); fill(f, 'label', 'Mine'); fill(f, 'key', 'sk-test-1234567890'); submit(w, f);
  await waitFor(() => text(d).includes('sk-t…7890'), 'key row'); ok('client API key stored (only the hint is shown)');
  await go(base + '/settings', () => d.querySelector('form[data-form=savebot]'), 'settings again');
  f = d.querySelector('form[data-form=savebot]');
  const opt = [...f.elements.api_key_id.options].find(o => o.textContent.includes('Mine')); if (!opt) throw new Error('saved key missing from the key dropdown');
  f.elements.api_key_id.value = opt.value;
  d.querySelector('[data-act=loadmodels]').click();
  await waitFor(() => d.querySelectorAll('#mlist option').length >= 2, 'models loaded from the key'); ok('"Load my models" lists the models the key can use');
  fill(f, 'custom_model', 'my-custom-model'); submit(w, f);
  await waitFor(() => d.getElementById('toast').textContent === 'Saved', 'saved with custom model');
  await waitFor(() => { const i = d.querySelector('#cm'); return i && i.value === 'my-custom-model'; }, 'custom model persisted'); ok('any model ID from your own key can be saved and is remembered');
  await go('#/account', () => text(d).includes('Visitor messages this month'), 'account'); ok('account page renders usage');

  if (errors.length) throw new Error('JS errors:\n' + errors.join('\n'));
  console.log('UI PASSED'); process.exit(0);
})().catch(e => { console.error('UI FAILED:', e.message); if (errors.length) console.error(errors.join('\n')); process.exit(1); });
