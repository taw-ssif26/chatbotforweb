/* Dashboard SPA. No framework, no build step. All dynamic text goes through E() before touching innerHTML. */
const E = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = document.getElementById('app');
const PROVIDERS = ['anthropic', 'openai', 'groq', 'xai', 'openrouter'];
const PNAME = { anthropic: 'Anthropic (Claude)', openai: 'OpenAI (GPT)', groq: 'Groq (Llama, fast)', xai: 'xAI (Grok)', openrouter: 'OpenRouter (many models)' };
let TOKEN = localStorage.getItem('tok'), ME = null, CLIENTS = {};

const fmt = d => d ? new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
const tag = (t, c = '') => `<span class="tag ${c}">${E(t)}</span>`;
const num = n => Number(n).toLocaleString();

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function api(path, o = {}) {
  const method = o.method || (o.json !== undefined || o.form ? 'POST' : 'GET');
  for (let attempt = 1; ; attempt++) {
    const init = { method, headers: {} };
    if (TOKEN) init.headers.Authorization = 'Bearer ' + TOKEN;
    if (o.json !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(o.json); }
    if (o.form) init.body = o.form;
    let r;
    try { r = await fetch('/api' + path, init); }
    catch (e) {
      if (method === 'GET' && attempt < 4) { toast('Waking up the server…'); await sleep(2500 * attempt); continue; }
      throw new Error('Cannot reach the server. Check your internet connection and try again.');
    }
    // A sleeping free-tier server answers 502/503/504 until it is awake: retry reads automatically.
    if ([502, 503, 504].includes(r.status) && method === 'GET' && attempt < 4) { toast('Waking up the server…'); await sleep(2500 * attempt); continue; }
    if (r.status === 401 && path !== '/auth/login') { logout(); throw new Error('Please sign in again'); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(typeof j.detail === 'string' ? j.detail : `Request failed (HTTP ${r.status}). If this keeps happening, the owner can check Owner → Status.`);
    return j;
  }
}
let toastTimer;
function toast(msg, bad) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'show' + (bad ? ' bad' : '');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.className = '', 3500);
}
function logout() { TOKEN = null; ME = null; localStorage.removeItem('tok'); route(); }

/* ---------- event delegation (no inline handlers: strict CSP) ---------- */
const actions = {}, forms = {};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  e.preventDefault();
  run(actions[el.dataset.act], el);
});
document.addEventListener('submit', e => {
  const f = e.target.closest('[data-form]');
  if (!f) return;
  e.preventDefault();
  const btn = f.querySelector('button:not([type=button])');
  const label = btn && btn.textContent;
  if (btn) { btn.disabled = true; if (f.dataset.busy) btn.textContent = f.dataset.busy; }
  run(forms[f.dataset.form], f).finally(() => { if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = label; } });
});
document.addEventListener('change', e => { const el = e.target.closest('[data-change]'); if (el) run(actions[el.dataset.change], el); });
async function run(fn, el) { try { await fn(el); } catch (err) { toast(err.message, true); } }
const fd = f => Object.fromEntries(new FormData(f));

/* ---------- shell + routing ---------- */
window.addEventListener('hashchange', route);
let routeSeq = 0, AFTER = null, PREFILL = {};
async function route() {
  const seq = ++routeSeq;  // a slower, older navigation must never overwrite a newer page
  if (!TOKEN) { app.innerHTML = loginView(); loadLoginContacts(); return; }
  try { ME = await api('/me'); } catch (e) { return; }
  if (seq !== routeSeq) return;
  const [a = 'bots', b, c] = location.hash.replace(/^#\/?/, '').split('/');
  let body;
  try {
    if (a === 'bot') body = await botView(b, c || 'knowledge');
    else if (a === 'keys') body = await keysView();
    else if (a === 'account') body = accountView();
    else if (a === 'admin' && ME.role === 'admin') body = await adminView(b || 'clients');
    else body = await botsView();
  } catch (e) { body = `<p class="err">${E(e.message)}</p>`; }
  if (seq !== routeSeq) return;
  app.innerHTML = shell(a, b, body);
  if (AFTER) { const run = AFTER; AFTER = null; run(); }
}
const ICO = {
  bots: 'M21 12a8 8 0 01-11.6 7.1L3 20l1-4.6A8 8 0 1121 12z', keys: 'M15 7a4 4 0 11-3.9 4.9L4 19v-3H1V13l6.1-6.1A4 4 0 0115 7z',
  account: 'M20 21a8 8 0 10-16 0M12 11a4 4 0 100-8 4 4 0 000 8z',
  clients: 'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.9M16 3.1a4 4 0 010 7.8',
  models: 'M12 2l2.4 5 5.6.8-4 4 1 5.6-5-2.7-5 2.7 1-5.6-4-4 5.6-.8L12 2z', settings: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  status: 'M22 12h-4l-3 9L9 3l-3 9H2', landing: 'M3 3h18v18H3zM3 9h18M9 21V9', requests: 'M22 12h-6l-2 3h-4l-2-3H2M5.5 5h13L22 12v6a2 2 0 01-2 2H4a2 2 0 01-2-2v-6l3.5-7z',
  view: 'M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3', auto: 'M3 5h18v12H3zM8 21h8M12 17v4',
  light: 'M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6L4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4M12 7a5 5 0 100 10 5 5 0 000-10z',
  dark: 'M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z',
};
const ico = n => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICO[n]}"/></svg>`;
function themeSwitch() {
  const t = window.getTheme();
  return `<div class="themes" role="group" aria-label="Colour theme">${['auto', 'light', 'dark'].map(k =>
    `<button type="button" data-act="settheme" data-t="${k}" aria-pressed="${t === k}" title="${k[0].toUpperCase() + k.slice(1)} theme">${ico(k)}${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}</div>`;
}
actions.settheme = el => {
  window.setTheme(el.dataset.t);
  document.querySelectorAll('.themes button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.t === el.dataset.t)));
};
function shell(a, b, body) {
  const nav = (h, l, on, i) => `<a href="${h}" class="${on ? 'on' : ''}"${on ? ' aria-current="page"' : ''}>${ico(i)}${l}</a>`;
  const admin = ME.role === 'admin', ad = a === 'admin' ? (b || 'clients') : '';
  return `<div class="layout"><aside><div class="brand"><i>✦</i>Chatbot Console</div><nav aria-label="Main">
    ${nav('#/bots', 'Chatbots', a === 'bots' || a === 'bot', 'bots')}${nav('#/keys', 'API keys', a === 'keys', 'keys')}${nav('#/account', 'Account', a === 'account', 'account')}
    ${admin ? `<div class="sep">Owner</div>${nav('#/admin/clients', 'Clients', ad === 'clients', 'clients')}${nav('#/admin/requests', 'Requests', ad === 'requests', 'requests')}${nav('#/admin/landing', 'Landing page', ad === 'landing', 'landing')}${nav('#/admin/models', 'Models', ad === 'models', 'models')}${nav('#/admin/settings', 'Settings', ad === 'settings', 'settings')}${nav('#/admin/status', 'Status', ad === 'status', 'status')}
    <a href="/" target="_blank" rel="noopener">${ico('view')}View landing page</a>` : ''}
    </nav><div class="who"><span>${E(ME.email)}</span>${themeSwitch()}<button class="link" data-act="logout">Sign out</button></div></aside>
    <main>${ME.live ? '' : '<div class="banner">Your subscription is not active, so your chatbots are paused. Contact your provider to renew.</div>'}${body}</main></div>`;
}
actions.logout = () => logout();

/* ---------- login ---------- */
function loginView() {
  return `<div class="login"><div class="brand"><i>✦</i>Chatbot Console</div><h1>Welcome back</h1><p class="sub">Sign in to manage your chatbots.</p>
  <form class="card" data-form="login" data-busy="Signing in…">
    <label for="em">Email</label><input id="em" name="email" type="email" autocomplete="username" required>
    <label for="pw">Password</label><input id="pw" name="password" type="password" autocomplete="current-password" required>
    <div class="row"><button class="btn">Sign in</button></div></form>
  <div class="card"><h3>No account yet?</h3>
    <p class="sub">Registration is off on purpose: to keep your API keys and data safe, accounts are created personally by the owner. Get in touch and your profile will be set up for you.</p>
    <div class="contactrow" id="logincontacts"></div><p class="hint"><a href="/">See what the service does →</a></p></div></div>`;
}
async function loadLoginContacts() {
  try {
    const d = await (await fetch('/api/public/site')).json(), box = document.getElementById('logincontacts');
    if (box) box.innerHTML = (d.contacts || []).map(c => `<a class="btn ghost sm" href="${E(c.url)}" target="_blank" rel="noopener">${E(c.label)}</a>`).join('') || '<span class="hint">Use the form on the website.</span>';
  } catch (e) { /* the sign-in form works without it */ }
}
forms.login = async f => {
  const r = await api('/auth/login', { json: fd(f) });
  TOKEN = r.token; localStorage.setItem('tok', TOKEN);
  location.hash = '#/bots'; route();
};

/* ---------- bots ---------- */
async function botsView() {
  const bots = await api('/bots');
  return `<h1>Chatbots</h1><p class="sub">${ME.usage.bots} of ${ME.limits.bots} bots used on the ${E(ME.limits.label)} plan.</p>
  <form class="row" data-form="newbot"><div><label for="nb">New bot name</label><input id="nb" name="name" maxlength="80" placeholder="Acme Support" required></div><button class="btn">Create bot</button></form>
  ${bots.length ? `<div class="wrap"><table><tr><th>Name</th><th>Model</th><th>Knowledge</th><th>Status</th><th></th></tr>${bots.map(b =>
    `<tr><td><b>${E(b.name)}</b></td><td>${E(b.model_label || 'Default')}</td><td>${b.source_count} sources</td><td>${b.active ? tag('Active', 'ok') : tag('Paused', 'warn')}</td><td><a href="#/bot/${b.id}/knowledge">Manage</a></td></tr>`).join('')}</table></div>`
    : '<p class="empty">No bots yet. Create one, add your knowledge, then paste one line into your website.</p>'}`;
}
forms.newbot = async f => { const r = await api('/bots', { json: fd(f) }); location.hash = `#/bot/${r.id}/knowledge`; };

async function botView(id, tab) {
  const bot = await api('/bots/' + id);
  const tabs = [['knowledge', 'Knowledge'], ['settings', 'Settings'], ['appearance', 'Appearance'], ['chats', 'Conversations'], ['install', 'Install']];
  let inner = '';
  if (tab === 'knowledge') inner = await knowledgeTab(bot);
  else if (tab === 'settings') inner = await settingsTab(bot);
  else if (tab === 'appearance') inner = appearanceTab(bot);
  else if (tab === 'chats') inner = await chatsTab(bot);
  else inner = await installTab(bot);
  return `<p><a href="#/bots">← All bots</a></p><h1>${E(bot.name)}</h1>
  <div class="tabs">${tabs.map(([k, l]) => `<a href="#/bot/${bot.id}/${k}" class="${tab === k ? 'on' : ''}">${l}</a>`).join('')}</div>${inner}`;
}

async function knowledgeTab(bot) {
  const src = await api(`/bots/${bot.id}/sources`);
  const u = ME.usage, l = ME.limits;
  return `<p class="sub">Your bot answers from this material. ${u.sources} of ${l.sources} sources and ${num(u.chars)} of ${num(l.max_chars)} characters used across all your bots.</p>
  <div class="card"><h2>Paste text</h2><form data-form="addtext" data-busy="Indexing…" data-bot="${bot.id}">
    <label for="tt">Title</label><input id="tt" name="title" maxlength="200" placeholder="Pricing and plans" required>
    <label for="tc">Content</label><textarea id="tc" name="content" required placeholder="Paste FAQs, product details, policies, opening hours…"></textarea>
    <div class="row"><button class="btn">Add to knowledge</button></div></form></div>
  <div class="card"><h2>Import a web page</h2><form data-form="addurl" data-busy="Importing…" data-bot="${bot.id}"><div class="row"><div><label for="ur">Page address</label><input id="ur" name="url" type="url" placeholder="https://example.com/faq" required></div><button class="btn">Import page</button></div>
    <p class="hint">Reads one page. Pages that build their content with JavaScript can't be read; paste their text instead.</p></form></div>
  <div class="card"><h2>Upload a file</h2><form data-form="addfile" data-busy="Indexing…" data-bot="${bot.id}"><div class="row"><div><label for="fl">PDF, TXT, MD, CSV, JSON or HTML (10 MB max)</label><input id="fl" name="file" type="file" accept=".pdf,.txt,.md,.csv,.json,.html,.htm" required></div><button class="btn">Upload</button></div></form></div>
  <h2>Sources</h2>${src.length ? `<div class="wrap"><table><tr><th>Title</th><th>Type</th><th>Size</th><th>Added</th><th></th></tr>${src.map(s =>
    `<tr><td>${E(s.title)}</td><td>${tag(s.kind)}</td><td>${num(s.chars)} chars</td><td>${fmt(s.created_at)}</td><td><button class="btn danger sm" data-act="delsrc" data-id="${s.id}">Delete</button></td></tr>`).join('')}</table></div>`
    : '<p class="empty">No sources yet. Without knowledge the bot only answers from its instructions (and the web, on Premium).</p>'}`;
}
forms.addtext = async f => { await api(`/bots/${f.dataset.bot}/sources/text`, { json: fd(f) }); toast('Added'); route(); };
forms.addurl = async f => { await api(`/bots/${f.dataset.bot}/sources/url`, { json: fd(f) }); toast('Page imported'); route(); };
forms.addfile = async f => { await api(`/bots/${f.dataset.bot}/sources/file`, { method: 'POST', form: new FormData(f) }); toast('File indexed'); route(); };
actions.delsrc = async el => { if (!confirm('Delete this source?')) return; await api('/sources/' + el.dataset.id, { method: 'DELETE' }); route(); };

async function settingsTab(bot) {
  const [models, keys] = await Promise.all([api('/models'), api('/keys')]);
  const L = ME.limits;
  const modelOpts = models.map(m => `<option value="${m.id}" ${m.id === bot.model_id ? 'selected' : ''} ${m.locked ? 'disabled' : ''}>${E(m.label)}${m.locked ? ' (Premium)' : ''}${m.included ? '' : ' — needs your own key'}</option>`).join('');
  const keyOpts = `<option value="">Use the included platform key</option>` + keys.map(k => `<option value="${k.id}" ${k.id === bot.api_key_id ? 'selected' : ''}>${E(k.label)} · ${E(k.provider)} ${E(k.hint)}</option>`).join('');
  return `<form class="card" data-form="savebot" data-busy="Saving…" data-bot="${bot.id}">
    <label for="n">Bot name (shown in the chat header)</label><input id="n" name="name" value="${E(bot.name)}" maxlength="80" required>
    <label for="w">Welcome message</label><input id="w" name="welcome" value="${E(bot.welcome)}" maxlength="300">
    <label for="sp">Instructions</label><textarea id="sp" name="system_prompt" maxlength="4000">${E(bot.system_prompt)}</textarea>
    <p class="hint">Tell the bot who it is, what it covers, and how to sound. Knowledge you add is supplied automatically.</p>
    <div class="row"><div><label for="m">Model</label><select id="m" name="model_id">${modelOpts}</select></div>
    <div><label for="k">API key</label><select id="k" name="api_key_id">${keyOpts}</select></div></div>
    <label for="cm">Use any model from your own key (optional)</label>
    <div class="row"><div><input id="cm" name="custom_model" list="mlist" value="${E(bot.custom_model || '')}" placeholder="Click “Load my models”, then pick or type a model ID" autocomplete="off"><datalist id="mlist"></datalist></div><button type="button" class="btn ghost" data-act="loadmodels">Load my models</button></div>
    <p class="hint">Needs an API key selected above. When filled in, it replaces the Model choice, so you can use any model your provider offers. Leave empty to use the Model list.</p>
    <p class="hint">Using your own key means unlimited messages billed by your AI provider. The included key counts against ${num(L.platform_msgs)} messages a month. <a href="#/keys">Manage keys</a></p>
    <label for="d">Allowed websites (one per line)</label><textarea id="d" name="allowed_domains" placeholder="example.com">${E((bot.allowed_domains || []).join('\n'))}</textarea>
    <p class="hint">${bot.allowed_domains.length ? 'The bot only loads on these sites and their subdomains.' : '<b>Empty means any website can use this bot.</b> Add your domain so nobody can copy your snippet and use up your messages.'}</p>
    <label class="inline"><input type="checkbox" name="web_search" ${bot.web_search ? 'checked' : ''} ${L.web_search ? '' : 'disabled'}> Search the web when your knowledge has no good answer ${L.web_search ? '' : tag('Premium', 'pro')}</label>
    <label class="inline"><input type="checkbox" name="agency_promo" ${bot.agency_promo ? 'checked' : ''} ${L.remove_branding ? '' : 'disabled'}> Mention the bot's builder when visitors ask who made it ${L.remove_branding ? '' : tag('Premium to turn off', 'pro')}</label>
    <label class="inline"><input type="checkbox" name="active" ${bot.active ? 'checked' : ''}> Bot is active</label>
    <div class="row"><button class="btn">Save settings</button><button type="button" class="btn danger" data-act="delbot" data-id="${bot.id}">Delete bot</button></div></form>`;
}
forms.savebot = async f => {
  const v = fd(f), cb = n => f.elements[n].checked;
  await api('/bots/' + f.dataset.bot, { method: 'PATCH', json: {
    name: v.name, welcome: v.welcome, system_prompt: v.system_prompt,
    model_id: v.model_id ? Number(v.model_id) : null, api_key_id: v.api_key_id ? Number(v.api_key_id) : null, custom_model: v.custom_model.trim() || null,
    allowed_domains: v.allowed_domains.split('\n'), active: cb('active'),
    ...(f.elements.web_search.disabled ? {} : { web_search: cb('web_search') }),
    ...(f.elements.agency_promo.disabled ? {} : { agency_promo: cb('agency_promo') }),
  } });
  toast('Saved'); route();
};
actions.loadmodels = async () => {
  const kid = document.getElementById('k').value;
  if (!kid) throw new Error('Select one of your API keys first (the API key box above), then try again.');
  const r = await api(`/keys/${kid}/models`);
  document.getElementById('mlist').innerHTML = r.models.map(m => `<option value="${E(m)}"></option>`).join('');
  toast(`${r.models.length} models loaded. Click the box and pick one.`);
};
actions.delbot = async el => {
  if (!confirm('Delete this bot, its knowledge and all its conversations? This cannot be undone.')) return;
  await api('/bots/' + el.dataset.id, { method: 'DELETE' }); location.hash = '#/bots';
};

async function chatsTab(bot) {
  const rows = await api(`/bots/${bot.id}/conversations`);
  if (!rows.length) return '<p class="empty">No conversations yet. Visitors\' chats will appear here.</p>';
  return `<div class="wrap"><table><tr><th>First question</th><th>Messages</th><th>Last active</th><th></th></tr>${rows.map(r =>
    `<tr><td>${E((r.first || '').slice(0, 90))}</td><td>${r.n}</td><td>${fmt(r.last_at)}</td><td><div class="actions"><button class="btn ghost sm" data-act="openconv" data-bot="${bot.id}" data-id="${r.id}">View</button><button class="btn danger sm" data-act="delconv" data-bot="${bot.id}" data-id="${r.id}">Delete</button></div></td></tr>`).join('')}</table></div><div id="conv"></div>`;
}
actions.delconv = async el => {
  if (!confirm('Delete this conversation permanently?')) return;
  await api(`/bots/${el.dataset.bot}/conversations/${el.dataset.id}`, { method: 'DELETE' }); route();
};
actions.openconv = async el => {
  const msgs = await api(`/bots/${el.dataset.bot}/conversations/${el.dataset.id}`);
  const box = document.getElementById('conv');
  box.innerHTML = `<h2>Conversation</h2>` + msgs.map(m => `<div class="msg ${E(m.role)}">${E(m.content)}</div>`).join('');
  box.scrollIntoView({ behavior: 'smooth' });
};

const checkList = list => `<ul class="checks">${list.map(c => `<li class="chk ${E(c.status)}"><b>${c.status === 'ok' ? '✓' : c.status === 'warn' ? '!' : '✕'}</b><div>${E(c.label)}${c.fix ? `<div class="hint">${E(c.fix)}</div>` : ''}</div></li>`).join('')}</ul>`;
async function installTab(bot) {
  const health = await api(`/bots/${bot.id}/health`);
  const snip = `<script src="${location.origin}/widget.js" data-bot="${bot.public_key}" async></script>`;
  return `<div class="card"><h2>Is everything ready?</h2>${checkList(health)}
    <div class="row"><button class="btn ghost" data-act="testmodel" data-bot="${bot.id}">Test the AI model</button></div><div id="modelresult"></div></div>
  <div class="card"><h2>Add the chatbot to your website</h2>
    <p>Paste this line just before the closing <code>&lt;/body&gt;</code> tag on every page where the chat should appear. It works on WordPress, Shopify, Wix, Webflow, plain HTML and any other site that lets you add a script.</p>
    <code class="code" id="snip">${E(snip)}</code>
    <div class="row"><button class="btn" data-act="copy">Copy snippet</button><a class="btn ghost" href="/demo?bot=${encodeURIComponent(bot.public_key)}" target="_blank" rel="noopener">Open test page</a></div>
    <p class="hint">Changes to name, colour, instructions and knowledge apply immediately. You never need to re-paste the snippet. The widget links to a privacy notice; add a line to your own privacy policy that chats are processed by AI providers.</p></div>
  <form class="card" data-form="checksite" data-busy="Checking…" data-bot="${bot.id}"><h2>Can't see the chat bubble on your site?</h2>
    <p class="sub">Enter your page address and we'll check the snippet and the website permission.</p>
    <div class="row"><div><label for="cs">Page address</label><input id="cs" name="url" placeholder="https://yourwebsite.com" required></div><button class="btn">Check my website</button></div>
    <div id="siteresult"></div></form>`;
}
actions.testmodel = async el => {
  const box = document.getElementById('modelresult'); box.innerHTML = '<p class="hint">Asking the model…</p>';
  const r = await api(`/bots/${el.dataset.bot}/test-model`, { method: 'POST' });
  box.innerHTML = checkList([r.ok
    ? { status: 'ok', label: `${r.model} answered through ${r.key}: “${r.reply}”` }
    : { status: 'fail', label: `${r.model ? r.model + ' failed' : 'The AI model cannot answer'}`, fix: r.error }]);
};
forms.checksite = async f => {
  const r = await api(`/bots/${f.dataset.bot}/check-site`, { json: fd(f) });
  document.getElementById('siteresult').innerHTML = checkList(r);
};
actions.copy = async () => {
  const el = document.getElementById('snip');
  try { await navigator.clipboard.writeText(el.textContent); toast('Copied'); }
  catch (e) {  // clipboard blocked (permissions / non-https): select the text so Ctrl+C works
    const r = document.createRange(); r.selectNodeContents(el); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
    toast('Press Ctrl+C (or Cmd+C) to copy the selected text');
  }
};

/* ---------- API keys ---------- */
async function keysView() {
  const keys = await api('/keys');
  return `<h1>API keys</h1><p class="sub">Bring your own key from Anthropic, OpenAI, Groq or OpenRouter to run your bots on your own account with no message cap. Keys are encrypted and never shown again.</p>
  <form class="card" data-form="addkey" data-busy="Saving…"><div class="row">
    <div><label for="kp">Provider</label><select id="kp" name="provider">${PROVIDERS.map(p => `<option value="${p}">${PNAME[p]}</option>`).join('')}</select></div>
    <div><label for="kl">Label</label><input id="kl" name="label" maxlength="60" placeholder="Company key" required></div>
    <div><label for="kk">Key</label><input id="kk" name="key" type="password" autocomplete="off" required></div><button class="btn">Add key</button></div></form>
  ${keys.length ? `<div class="wrap"><table><tr><th>Label</th><th>Provider</th><th>Key</th><th>Added</th><th></th></tr>${keys.map(k =>
    `<tr><td>${E(k.label)}</td><td>${tag(k.provider)}</td><td><code>${E(k.hint)}</code></td><td>${fmt(k.created_at)}</td><td><button class="btn danger sm" data-act="delkey" data-id="${k.id}">Remove</button></td></tr>`).join('')}</table></div>` : '<p class="empty">No keys yet.</p>'}`;
}
forms.addkey = async f => { await api('/keys', { json: fd(f) }); toast('Key saved'); route(); };
actions.delkey = async el => { if (!confirm('Remove this key? Bots using it fall back to the platform key.')) return; await api('/keys/' + el.dataset.id, { method: 'DELETE' }); route(); };

/* ---------- account ---------- */
function accountView() {
  const L = ME.limits, u = ME.usage, yes = b => b ? tag('Included', 'ok') : tag('Not included', 'warn');
  return `<h1>Account</h1><p class="sub">${E(ME.name || ME.email)}</p>
  <div class="grid"><div class="stat"><b>${E(L.label)}</b><span>Plan</span></div>
    <div class="stat"><b>${ME.role === 'admin' ? 'No expiry' : fmt(ME.expires_at)}</b><span>${ME.live ? 'Renews / expires' : 'Expired or inactive'}</span></div>
    <div class="stat"><b>${num(u.total_msgs)} / ${num(L.total_msgs)}</b><span>Visitor messages this month</span></div>
    <div class="stat"><b>${num(u.platform_msgs)} / ${num(L.platform_msgs)}</b><span>Of those, on the included key</span></div></div>
  <div class="card"><h2>Your plan</h2><table>
    <tr><td>Chatbots</td><td>${u.bots} of ${L.bots}</td></tr><tr><td>Knowledge sources</td><td>${u.sources} of ${L.sources}</td></tr>
    <tr><td>Web search</td><td>${L.web_search ? `${u.web_searches} of ${L.web_searches} searches this month` : yes(false)}</td></tr><tr><td>Premium models</td><td>${yes(L.premium_models)}</td></tr>
    <tr><td>Remove "Powered by" and builder mention</td><td>${yes(L.remove_branding)}</td></tr></table></div>
  <div class="card" id="pwcard">${pwStageOne()}</div>`;
}
let PWPENDING = null;
function pwStageOne() {
  const code = ME.needs_email_code;
  return `<form data-form="${code ? 'pwcode' : 'pw'}" data-busy="${code ? 'Sending…' : 'Saving…'}"><h2>Change password</h2>
    ${code ? '<p class="hint">For your security, we email a 6-digit code to the address on your account to confirm the change.</p>' : ''}
    <div class="row"><div><label for="o">Current password</label><input id="o" name="old" type="password" autocomplete="current-password" required></div>
    <div><label for="nw">New password (8+ characters)</label><input id="nw" name="new" type="password" autocomplete="new-password" minlength="8" required></div>
    <button class="btn">${code ? 'Email me a code' : 'Update'}</button></div></form>`;
}
function pwStageTwo(sentTo, mins) {
  return `<form data-form="pwconfirm" data-busy="Checking…"><h2>Enter the code</h2>
    <p class="sub">We sent a 6-digit code to <b>${E(sentTo)}</b>. It expires in ${E(mins)} minutes.</p>
    <div class="row"><div><label for="pc">Verification code</label><input id="pc" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required></div>
    <button class="btn">Change password</button><button type="button" class="btn ghost" data-act="pwresend">Send a new code</button><button type="button" class="btn ghost" data-act="pwcancel">Cancel</button></div></form>`;
}
forms.pwcode = async f => {
  const v = fd(f), r = await api('/me/password/code', { json: v });
  PWPENDING = v; document.getElementById('pwcard').innerHTML = pwStageTwo(r.sent_to, r.expires_minutes);
  document.getElementById('pc').focus();
};
forms.pwconfirm = async f => {
  const r = await api('/me/password', { json: { ...PWPENDING, code: fd(f).code.trim() } });
  PWPENDING = null; TOKEN = r.token; localStorage.setItem('tok', TOKEN);
  toast('Password changed. Other devices were signed out.'); route();
};
forms.pw = async f => {   // only used when email confirmation isn't required (owner before email is set up)
  const r = await api('/me/password', { json: fd(f) });
  TOKEN = r.token; localStorage.setItem('tok', TOKEN); f.reset(); toast('Password updated. Other devices were signed out.');
};
actions.pwresend = async () => { await api('/me/password/code', { json: PWPENDING }); toast('A new code is on its way'); };
actions.pwcancel = () => { PWPENDING = null; route(); };

/* ---------- admin ---------- */
async function adminView(tab) {
  const tabs = { clients: adminClients, requests: adminRequests, landing: adminLanding, models: adminModels, settings: adminSettings, status: adminStatus };
  return await (tabs[tab] || adminClients)();
}
async function adminClients() {
  const [st, list] = await Promise.all([api('/admin/stats'), api('/admin/clients')]);
  CLIENTS = Object.fromEntries(list.map(c => [c.id, c]));
  const prefill = PREFILL; PREFILL = {};
  const status = c => !c.active ? tag('Disabled', 'bad') : (c.expires_at && new Date(c.expires_at) > new Date() ? tag('Live', 'ok') : tag('Expired', 'warn'));
  return `<h1>Clients</h1><div class="grid">
    <div class="stat"><b>${st.live}</b><span>Live of ${st.clients} clients</span></div><div class="stat"><b>${st.expiring_7d}</b><span>Expiring within 7 days</span></div>
    <div class="stat"><b>${st.bots}</b><span>Bots</span></div><div class="stat"><b>${num(st.messages_month)}</b><span>Visitor messages this month</span></div></div>
  <form class="card" data-form="newclient" data-busy="Creating…"><h2>Add a client</h2><div class="row">
    <div><label for="ce">Email</label><input id="ce" name="email" type="email" value="${E(prefill.email || '')}" required></div><div><label for="cn">Name</label><input id="cn" name="name" value="${E(prefill.name || '')}"></div>
    <div><label for="cp">Temporary password</label><input id="cp" name="password" minlength="8" required></div>
    <div><label for="cl">Plan</label><select id="cl" name="plan"><option value="starter">Starter</option><option value="premium">Premium</option></select></div>
    <div><label for="cd">Access days</label><input id="cd" name="days" type="number" min="0" value="30"></div><button class="btn">Create</button></div></form>
  ${list.length ? `<div class="wrap"><table><tr><th>Client</th><th>Plan</th><th>Status</th><th>Expires</th><th>Bots</th><th>Msgs</th><th></th></tr>${list.map(c =>
    `<tr><td><b>${E(c.name || c.email)}</b><br><span class="hint">${E(c.email)}</span></td><td>${tag(c.plan, c.plan === 'premium' ? 'pro' : '')}</td><td>${status(c)}</td><td>${fmt(c.expires_at)}</td><td>${c.bots}</td><td>${num(c.msgs)}</td>
    <td><div class="actions"><button class="btn sm" data-act="extend" data-id="${c.id}">Paid +30 days</button><button class="btn ghost sm" data-act="toggleclient" data-id="${c.id}">${c.active ? 'Disable' : 'Enable'}</button><button class="btn ghost sm" data-act="editclient" data-id="${c.id}">Edit</button></div></td></tr>`).join('')}</table></div>`
    : '<p class="empty">No clients yet. Add one above after you receive their first payment.</p>'}`;
}
forms.newclient = async f => { const v = fd(f); v.days = Number(v.days); await api('/admin/clients', { json: v }); toast('Client created'); route(); };
actions.extend = async el => { await api('/admin/clients/' + el.dataset.id, { method: 'PATCH', json: { extend_days: 30 } }); toast('Extended by 30 days'); route(); };
actions.toggleclient = async el => { const c = CLIENTS[el.dataset.id]; await api('/admin/clients/' + c.id, { method: 'PATCH', json: { active: !c.active } }); route(); };
actions.editclient = el => {
  const c = CLIENTS[el.dataset.id];
  document.getElementById('dlg')?.remove();
  const d = document.createElement('dialog'); d.id = 'dlg';
  d.innerHTML = `<form data-form="editclient" data-busy="Saving…" data-id="${c.id}"><h2>${E(c.email)}</h2>
    <label for="en">Name</label><input id="en" name="name" value="${E(c.name)}">
    <label for="ep">Plan</label><select id="ep" name="plan"><option value="starter" ${c.plan === 'starter' ? 'selected' : ''}>Starter</option><option value="premium" ${c.plan === 'premium' ? 'selected' : ''}>Premium</option></select>
    <label for="ex">Expires on (leave blank to keep ${E(fmt(c.expires_at))})</label><input id="ex" name="expires" type="date">
    <label for="eo">Notes (private)</label><textarea id="eo" name="notes">${E(c.notes)}</textarea>
    <label for="ew">Reset password (optional)</label><input id="ew" name="password" minlength="8" autocomplete="off">
    <div class="row"><button class="btn">Save</button><button type="button" class="btn ghost" data-act="closedlg">Cancel</button><button type="button" class="btn danger" data-act="delclient" data-id="${c.id}">Delete</button></div></form>`;
  document.body.appendChild(d); d.showModal();
};
actions.closedlg = () => document.getElementById('dlg')?.close();
forms.editclient = async f => {
  const v = fd(f), body = { name: v.name, plan: v.plan, notes: v.notes };
  if (v.password) body.password = v.password;
  if (v.expires) body.expires_at = v.expires + 'T23:59:59Z';
  await api('/admin/clients/' + f.dataset.id, { method: 'PATCH', json: body });
  document.getElementById('dlg')?.close(); toast('Saved'); route();
};
actions.delclient = async el => {
  if (!confirm('Delete this client with all their bots, knowledge and chats? This cannot be undone.')) return;
  await api('/admin/clients/' + el.dataset.id, { method: 'DELETE' }); document.getElementById('dlg')?.close(); route();
};

async function adminModels() {
  const ms = await api('/admin/models');
  return `<h1>Models</h1><p class="sub">Disabled models disappear from client dashboards, and bots using them fall back to another enabled model.</p>
  <form class="card" data-form="addmodel" data-busy="Adding…"><h2>Add a model</h2><div class="row">
    <div><label for="ml">Label</label><input id="ml" name="label" placeholder="Claude Sonnet" required></div>
    <div><label for="mp">Provider</label><select id="mp" name="provider">${PROVIDERS.map(p => `<option value="${p}">${PNAME[p]}</option>`).join('')}</select></div>
    <div><label for="mi">Model ID</label><input id="mi" name="model_id" placeholder="exact id from the provider docs" required></div>
    <div><label for="mr">Tier</label><select id="mr" name="premium_only"><option value="false">All plans</option><option value="true">Premium only</option></select></div><button class="btn">Add</button></div></form>
  <div class="wrap"><table><tr><th>Model</th><th>Provider</th><th>ID</th><th>Tier</th><th>Status</th><th></th></tr>${ms.map(m =>
    `<tr><td><b>${E(m.label)}</b></td><td>${tag(m.provider)}</td><td><code>${E(m.model_id)}</code></td>
    <td><button class="btn ghost sm" data-act="mtoggle" data-id="${m.id}" data-field="premium_only" data-val="${!m.premium_only}">${m.premium_only ? 'Premium only' : 'All plans'}</button></td>
    <td><button class="btn ${m.enabled ? '' : 'ghost'} sm" data-act="mtoggle" data-id="${m.id}" data-field="enabled" data-val="${!m.enabled}">${m.enabled ? 'Enabled' : 'Disabled'}</button></td>
    <td><button class="btn danger sm" data-act="mdel" data-id="${m.id}">Delete</button></td></tr>`).join('')}</table></div>`;
}
forms.addmodel = async f => { const v = fd(f); v.premium_only = v.premium_only === 'true'; await api('/admin/models', { json: v }); toast('Model added'); route(); };
actions.mtoggle = async el => { await api('/admin/models/' + el.dataset.id, { method: 'PATCH', json: { [el.dataset.field]: el.dataset.val === 'true' } }); route(); };
actions.mdel = async el => { if (!confirm('Delete this model?')) return; await api('/admin/models/' + el.dataset.id, { method: 'DELETE' }); route(); };

async function adminStatus() {
  const r = await api('/admin/status');
  return `<h1>Status</h1><p class="sub">What the server can see right now, and the recent errors it recorded.</p>
  <div class="card">${checkList(r.checks)}<div class="row"><button class="btn ghost" data-act="testemail">Send test email to me</button></div><div id="emailresult"></div></div>
  <h2>Recent server errors</h2>${r.errors.length ? `<div class="wrap"><table><tr><th>Ref</th><th>When</th><th>Request</th><th>Error</th></tr>${r.errors.map(e =>
    `<tr><td><code>${E(e.ref)}</code></td><td>${E(e.at)}</td><td>${E(e.request)}</td><td>${E(e.error)}</td></tr>`).join('')}</table></div>` : '<p class="empty">None since the last restart.</p>'}`;
}
actions.testemail = async () => {
  const box = document.getElementById('emailresult'); box.innerHTML = '<p class="hint">Sending…</p>';
  try { const r = await api('/admin/test-email', { method: 'POST' }); box.innerHTML = checkList([{ status: 'ok', label: `Test email sent to ${r.sent_to}. Check your inbox (and spam).` }]); }
  catch (e) { box.innerHTML = checkList([{ status: 'fail', label: 'The test email failed', fix: e.message }]); }
};
async function adminSettings() {
  const s = await api('/admin/settings'), a = s.agency;
  return `<h1>Settings</h1>
  <form class="card" data-form="agency" data-busy="Saving…"><h2>Your marketing profile</h2>
    <p class="sub">Every bot knows this and mentions it only when a visitor asks who built the bot or wants a chatbot, automation or a website of their own. Premium clients can switch it off per bot.</p>
    <label for="am">How the bot promotes you</label><select id="am" name="agency_mode"><option value="active" ${a.agency_mode !== 'ask' ? 'selected' : ''}>Active: one short mention per chat, only after the visitor's question is answered (and always when asked)</option><option value="ask" ${a.agency_mode === 'ask' ? 'selected' : ''}>Only when a visitor asks who built it or wants a chatbot, automation or website</option></select>
    <label for="an">Your name or brand</label><input id="an" name="agency_name" value="${E(a.agency_name)}" maxlength="100">
    <label for="as">Portfolio website</label><input id="as" name="agency_site" value="${E(a.agency_site)}" placeholder="https://" maxlength="300">
    <label for="ab">About you</label><textarea id="ab" name="agency_bio" maxlength="1500">${E(a.agency_bio)}</textarea>
    <label for="aw">Work you've done (one per line: name, what it does, link)</label><textarea id="aw" name="agency_works" maxlength="3000">${E(a.agency_works)}</textarea>
    <div class="row"><button class="btn">Save profile</button></div></form>
  <div class="card"><h2>Platform API keys</h2><p class="sub">Used for clients who don't bring their own key (counted against their monthly message limit). Stored encrypted. These override keys set in the server environment.</p>
  ${PROVIDERS.map(p => `<form data-form="pkey" data-busy="Saving…" data-p="${p}"><div class="row"><div><label for="pk-${p}">${p} ${s.providers[p] ? tag('Configured', 'ok') : tag('Not set', 'warn')}</label><input id="pk-${p}" name="key" type="password" autocomplete="off" placeholder="Paste a new key to replace it; leave empty and save to remove"></div><button class="btn ghost">Save</button></div></form>`).join('')}</div>`;
}
forms.agency = async f => { await api('/admin/settings', { method: 'PUT', json: fd(f) }); toast('Profile saved'); };
forms.pkey = async f => { await api('/admin/platform-keys/' + f.dataset.p, { method: 'PUT', json: { key: fd(f).key } }); toast('Saved'); route(); };


/* ---------- appearance: colours, shape, live preview ---------- */
const PRESETS = {
  Ocean: { color: '#2f5bff', theme: 'light', a: {} },
  Midnight: { color: '#7389ff', theme: 'dark', a: {} },
  Forest: { color: '#157a43', theme: 'light', a: { bg_color: '#f0f7f2' } },
  Sunset: { color: '#e8590c', theme: 'light', a: { bg_color: '#fff6ee', surface_color: '#fffaf5', radius: 'round' } },
  Rose: { color: '#d6336c', theme: 'light', a: { bg_color: '#fff4f7', radius: 'round' } },
  Mono: { color: '#111827', theme: 'light', a: { bg_color: '#f3f4f6', radius: 'sharp', font: 'mono' } },
  Neon: { color: '#22d3a5', theme: 'dark', a: { bg_color: '#05070d', surface_color: '#0b0f1a', bot_bubble_color: '#121826', header_text_color: '#05070d', user_text_color: '#05070d' } },
};
const COLOR_FIELDS = [
  ['bg_color', '--bg', 'Chat background', 'Behind the messages'], ['surface_color', '--surface', 'Input bar background', 'Where visitors type'],
  ['text_color', '--fg', 'Text colour', 'Main text in the window'], ['bot_bubble_color', '--bot', 'Assistant bubble', "Background of the assistant's messages"],
  ['bot_text_color', '--bot-fg', 'Assistant text', "Text inside the assistant's bubbles"], ['user_text_color', '--user-fg', 'Visitor bubble text', 'Text on your main colour'],
  ['header_text_color', '--hdr', 'Header text', 'Title and icons on your main colour'],
];
let APBOT = null, APKIT = null;
function appearanceTab(bot) {
  APBOT = bot; const a = bot.appearance || {};
  AFTER = initAppearance;
  const sw = p => `<svg width="30" height="16" aria-hidden="true"><rect width="15" height="16" fill="${p.color}"/><rect x="15" width="15" height="16" fill="${(p.a.bg_color) || (p.theme === 'dark' ? '#0d1322' : '#f5f7fb')}"/></svg>`;
  return `<div class="split"><form class="card" id="apform" data-form="saveappearance" data-busy="Saving…" data-bot="${bot.id}">
    <h2>Quick styles</h2><div class="presets">${Object.entries(PRESETS).map(([n, p]) => `<button type="button" class="preset" data-act="preset" data-name="${n}"><i>${sw(p)}</i>${n}</button>`).join('')}</div>
    <h2>Main look</h2>
    <div class="row"><div><label for="ap-theme">Theme</label><select id="ap-theme" name="theme"><option value="light" ${bot.theme === 'light' ? 'selected' : ''}>Light</option><option value="dark" ${bot.theme === 'dark' ? 'selected' : ''}>Dark</option><option value="auto" ${bot.theme === 'auto' ? 'selected' : ''}>Match the visitor's device</option></select></div>
    <div><label for="ap-color">Main colour</label><input id="ap-color" name="color" type="color" value="${E(bot.color)}"></div>
    <div><label for="ap-position">Position</label><select id="ap-position" name="position"><option value="right" ${bot.position === 'right' ? 'selected' : ''}>Bottom right</option><option value="left" ${bot.position === 'left' ? 'selected' : ''}>Bottom left</option></select></div></div>
    <p class="hint">The main colour is used for the chat button, the header and the visitor's messages.</p>
    <h2>Colours</h2><p class="hint">Switch a colour on to override the theme. Switched off colours follow the theme and adapt automatically.</p>
    ${COLOR_FIELDS.map(([k, , label, hint]) => `<div class="crow"><label for="ap-${k}">${label}<small>${hint}</small></label>
      <label class="auto"><input type="checkbox" data-auto="${k}" ${a[k] ? 'checked' : ''}> Custom</label><input type="color" id="ap-${k}" data-key="${k}" value="${E(a[k] || '#888888')}"></div>`).join('')}
    <h2>Shape and text</h2>
    <div class="row"><div><label for="ap-radius">Corners</label><select id="ap-radius" name="radius"><option value="">Default (soft)</option>${[['sharp', 'Sharp'], ['soft', 'Soft'], ['round', 'Very round']].map(([v, l]) => `<option value="${v}" ${a.radius === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <div><label for="ap-font">Font</label><select id="ap-font" name="font"><option value="">Default (clean sans-serif)</option>${[['system', 'Clean sans-serif'], ['serif', 'Classic serif'], ['mono', 'Monospace']].map(([v, l]) => `<option value="${v}" ${a.font === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
    <div id="contrast"></div>
    <div class="row"><button class="btn">Save appearance</button><button type="button" class="btn ghost" data-act="resetappearance">Reset to defaults</button></div></form>
    <div class="sticky"><div class="preview" id="apreview" aria-label="Live preview of your chat window"></div><p class="hint">Live preview: this is exactly how visitors will see your chat. Changes go live for visitors within about 30 seconds of saving.</p></div></div>`;
}
function apCollect() {
  const f = document.getElementById('apform'), v = fd(f), a = {};
  COLOR_FIELDS.forEach(([k]) => { if (f.querySelector(`[data-auto="${k}"]`).checked) a[k] = f.querySelector(`#ap-${k}`).value; });
  if (v.radius) a.radius = v.radius;
  if (v.font) a.font = v.font;
  return { color: v.color, theme: v.theme, position: v.position, appearance: a };
}
function apRefresh() {
  if (!APKIT) return;
  const f = document.getElementById('apform'); if (!f) return;
  const c = apCollect(), cfg = { name: APBOT.name, welcome: APBOT.welcome, ...c, brand: ME.limits.remove_branding ? null : { name: 'Your provider', url: '' } };
  const vars = window.AIChatKit.resolve(cfg);
  COLOR_FIELDS.forEach(([k, cssVar]) => { const on = f.querySelector(`[data-auto="${k}"]`).checked, inp = f.querySelector(`#ap-${k}`); inp.disabled = !on; if (!on) inp.value = vars[cssVar]; });
  APKIT.update(cfg);
  const lum = h => { const n = parseInt(h.slice(1), 16), ch = [n >> 16, n >> 8 & 255, n & 255].map(x => { x /= 255; return x <= .03928 ? x / 12.92 : Math.pow((x + .055) / 1.055, 2.4); }); return .2126 * ch[0] + .7152 * ch[1] + .0722 * ch[2]; };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + .05) / (Math.min(l1, l2) + .05); };
  const pairs = [['Text on the chat background', '--fg', '--bg'], ["Assistant text on its bubble", '--bot-fg', '--bot'], ['Visitor text on your main colour', '--user-fg', '--c'], ['Header text on your main colour', '--hdr', '--c'], ['Text in the input bar', '--surface-fg', '--surface']];
  const bad = pairs.filter(([, x, y]) => ratio(vars[x], vars[y]) < 4.5).map(([l, x, y]) => `${l} (contrast ${ratio(vars[x], vars[y]).toFixed(1)}:1)`);
  document.getElementById('contrast').innerHTML = bad.length ? `<p class="warnline">⚠ Hard to read: ${E(bad.join('; '))}. Pick colours that differ more.</p>` : '<p class="hint">✓ All text is easy to read.</p>';
}
async function initAppearance() {
  if (!window.AIChatKit) await new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = '/widget.js'; sc.dataset.mode = 'lib'; sc.onload = res; sc.onerror = () => rej(new Error('Could not load the preview')); document.head.appendChild(sc); });
  const box = document.getElementById('apreview'); if (!box) return;
  const c = apCollect();
  APKIT = window.AIChatKit.mount(box, { name: APBOT.name, welcome: APBOT.welcome, ...c, brand: ME.limits.remove_branding ? null : { name: 'Your provider', url: '' } });
  apRefresh();
}
document.addEventListener('input', e => { if (e.target.closest('#apform')) apRefresh(); });
document.addEventListener('change', e => { if (e.target.closest('#apform')) apRefresh(); });
actions.preset = el => {
  const p = PRESETS[el.dataset.name], f = document.getElementById('apform');
  f.elements.theme.value = p.theme; f.elements.color.value = p.color; f.elements.radius.value = p.a.radius || ''; f.elements.font.value = p.a.font || '';
  COLOR_FIELDS.forEach(([k]) => { const cb = f.querySelector(`[data-auto="${k}"]`); cb.checked = !!p.a[k]; if (p.a[k]) f.querySelector(`#ap-${k}`).value = p.a[k]; });
  apRefresh();
};
actions.resetappearance = () => {
  const f = document.getElementById('apform'); f.elements.theme.value = 'light'; f.elements.color.value = '#2f5bff'; f.elements.radius.value = ''; f.elements.font.value = '';
  COLOR_FIELDS.forEach(([k]) => { f.querySelector(`[data-auto="${k}"]`).checked = false; }); apRefresh();
};
forms.saveappearance = async f => { await api('/bots/' + f.dataset.bot, { method: 'PATCH', json: apCollect() }); toast('Appearance saved'); };

/* ---------- owner: access requests ---------- */
async function adminRequests() {
  const leads = await api('/admin/leads');
  const link = c => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c) ? `<a href="mailto:${E(c)}">${E(c)}</a>` : /^[+\d][\d\s()-]{6,}$/.test(c) ? `<a href="https://wa.me/${E(c.replace(/\D/g, ''))}" target="_blank" rel="noopener">${E(c)}</a>` : E(c);
  const stat = { new: 'warn', contacted: 'pro', done: 'ok', spam: 'bad' };
  return `<h1>Access requests</h1><p class="sub">People who asked for access on your landing page. Registration is off, so you create their profile: press “Create account”, then message them their login.</p>
  ${leads.length ? `<div class="wrap"><table><tr><th>Who</th><th>Message</th><th>When</th><th>Status</th><th></th></tr>${leads.map(l =>
    `<tr><td><b>${E(l.name)}</b><br>${link(l.contact)}</td><td>${E(l.message) || '<span class="hint">—</span>'}</td><td>${fmt(l.created_at)}</td>
    <td><select data-change="leadstatus" data-id="${l.id}" aria-label="Status">${['new', 'contacted', 'done', 'spam'].map(x => `<option value="${x}" ${l.status === x ? 'selected' : ''}>${x[0].toUpperCase() + x.slice(1)}</option>`).join('')}</select></td>
    <td><div class="actions"><button class="btn sm" data-act="leadclient" data-name="${E(l.name)}" data-contact="${E(l.contact)}">Create account</button><button class="btn danger sm" data-act="leaddel" data-id="${l.id}">Delete</button></div></td></tr>`).join('')}</table></div>`
    : '<p class="empty">No requests yet. When someone fills in the form on your landing page, it appears here (and in your inbox if email is set up).</p>'}`;
}
actions.leadstatus = async el => { await api('/admin/leads/' + el.dataset.id, { method: 'PATCH', json: { status: el.value } }); toast('Updated'); };
actions.leaddel = async el => { if (!confirm('Delete this request?')) return; await api('/admin/leads/' + el.dataset.id, { method: 'DELETE' }); route(); };
actions.leadclient = el => { PREFILL = { name: el.dataset.name, email: /@/.test(el.dataset.contact) ? el.dataset.contact : '' }; location.hash = '#/admin/clients'; };

/* ---------- owner: landing page editor (content, contact channels, offers, ads) ---------- */
const PROMO_KINDS = { offer: 'Special offer', ad: 'Ad banner', bar: 'Top bar message' };
let SITE = null, PROMOS = [];
const toLocal = iso => { if (!iso) return ''; const d = new Date(iso), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const fromLocal = v => (v ? new Date(v).toISOString() : null);
const promoState = p => !p.enabled ? tag('Off') : p.starts_at && new Date(p.starts_at) > new Date() ? tag('Scheduled', 'warn') : p.ends_at && new Date(p.ends_at) < new Date() ? tag('Ended', 'bad') : tag('Live', 'ok');
const contactRow = c => `<div class="crow2" data-contact><select name="ctype" aria-label="Channel">${Object.entries(SITE.types).map(([k, l]) => `<option value="${k}" ${c.type === k ? 'selected' : ''}>${E(l)}</option>`).join('')}</select>
  <input name="cvalue" value="${E(c.value || '')}" placeholder="Number with country code, @handle, email or https link" maxlength="200" aria-label="Number, handle or link">
  <input name="clabel" value="${E(c.label || '')}" placeholder="Button text (optional)" maxlength="40" aria-label="Button text"><button type="button" class="btn danger sm" data-act="rmcontact">Remove</button></div>`;
async function adminLanding() {
  const [site, promos, pr] = await Promise.all([api('/admin/site'), api('/admin/promotions'), api('/admin/landing-prompt')]);
  SITE = site; PROMOS = promos; const st = site.settings;
  return `<h1>Landing page</h1><p class="sub">Your public page at <a href="/" target="_blank" rel="noopener">${E(location.origin)}/</a>. Everything here updates the page within about 30 seconds, no code needed.</p>
  <form class="card" data-form="sitesave" data-busy="Saving…"><h2>Page content</h2>
    <label for="sh">Headline</label><input id="sh" name="site_headline" value="${E(st.site_headline)}" maxlength="140" required>
    <label for="ss">Sub-headline</label><textarea id="ss" name="site_subheadline" maxlength="300">${E(st.site_subheadline)}</textarea>
    <div class="row"><div><label for="sp1">Starter price (shown on the page)</label><input id="sp1" name="site_price_starter" value="${E(st.site_price_starter)}" maxlength="40" placeholder="e.g. $15 / month"></div>
    <div><label for="sp2">Premium price</label><input id="sp2" name="site_price_premium" value="${E(st.site_price_premium)}" maxlength="40" placeholder="e.g. $39 / month"></div></div>
    <p class="hint">Leave a price empty to show “Message me for pricing”.</p>
    <div class="row"><div><label for="sd">Live demo chatbot</label><select id="sd" name="site_demo_bot"><option value="">None (hide the demo button)</option>${site.bots.map(b => `<option value="${E(b.public_key)}" ${st.site_demo_bot === b.public_key ? 'selected' : ''}>${E(b.name)}</option>`).join('')}</select></div></div>
    <p class="hint">Visitors can chat with this bot right on your page, so they see the product working. Create one under Chatbots with your portfolio and services as its knowledge.</p>
    <h2>How people reach you</h2><p class="hint">Registration is off, so these buttons are how people get access. Add every channel you use.</p>
    <div id="contactrows">${site.contacts.map(contactRow).join('')}</div>
    <div class="row"><button type="button" class="btn ghost sm" data-act="addcontact">+ Add a channel</button></div>
    <label for="sw">Message pre-filled in WhatsApp chats</label><input id="sw" name="site_whatsapp_text" value="${E(st.site_whatsapp_text)}" maxlength="200">
    <div class="row"><button class="btn">Save page content</button></div></form>

  <div class="card"><h2>Special offers, ads and the top bar</h2><p class="hint">Offers get highlighted cards with a live countdown. Ad banners sit between sections. The top bar is one line above the header. Set dates to schedule them, they hide themselves when they end.</p>
    <div class="actions"><button class="btn sm" data-act="newpromo" data-kind="offer">+ Special offer</button><button class="btn sm ghost" data-act="newpromo" data-kind="ad">+ Ad banner</button><button class="btn sm ghost" data-act="newpromo" data-kind="bar">+ Top bar message</button></div>
    ${promos.length ? promos.map(p => `<div class="promo"><div class="grow"><b>${E(p.title)}</b><small>${tag(PROMO_KINDS[p.kind], 'pro')} ${promoState(p)} ${p.ends_at ? 'ends ' + E(fmt(p.ends_at)) : 'no end date'}</small></div>
      <div class="actions"><button class="btn ghost sm" data-act="movepromo" data-id="${p.id}" data-dir="up" aria-label="Move up">↑</button><button class="btn ghost sm" data-act="movepromo" data-id="${p.id}" data-dir="down" aria-label="Move down">↓</button>
      <button class="btn ghost sm" data-act="promotoggle" data-id="${p.id}">${p.enabled ? 'Turn off' : 'Turn on'}</button><button class="btn ghost sm" data-act="editpromo" data-id="${p.id}">Edit</button><button class="btn danger sm" data-act="delpromo" data-id="${p.id}">Delete</button></div></div>`).join('')
      : '<p class="empty">Nothing yet. Add a special offer to put a highlighted card right under your headline.</p>'}</div>

  <div class="card"><h2>Landing page design prompt</h2><p class="hint">Want a different design? Paste this prompt into Claude, ChatGPT or any AI design tool. It already contains your live data address, your demo bot and all the rules (no sign-up button, contact buttons, offers and ads from your dashboard).</p>
    <pre class="code prompt" id="promptbox">${E(pr.prompt)}</pre><div class="row"><button class="btn" data-act="copyprompt">Copy the prompt</button><a class="btn ghost" href="/" target="_blank" rel="noopener">Open my landing page</a></div></div>`;
}
actions.addcontact = () => { document.getElementById('contactrows').insertAdjacentHTML('beforeend', contactRow({ type: 'whatsapp' })); };
actions.rmcontact = el => el.closest('[data-contact]').remove();
forms.sitesave = async f => {
  const v = fd(f), contacts = [...f.querySelectorAll('[data-contact]')].map(r => ({ type: r.querySelector('[name=ctype]').value, value: r.querySelector('[name=cvalue]').value.trim(), label: r.querySelector('[name=clabel]').value.trim() })).filter(c => c.value);
  await api('/admin/site', { method: 'PUT', json: { site_headline: v.site_headline, site_subheadline: v.site_subheadline, site_price_starter: v.site_price_starter, site_price_premium: v.site_price_premium, site_whatsapp_text: v.site_whatsapp_text, site_demo_bot: v.site_demo_bot, site_contacts: contacts } });
  toast('Landing page updated');
};
actions.copyprompt = async () => {
  const el = document.getElementById('promptbox');
  try { await navigator.clipboard.writeText(el.textContent); toast('Prompt copied'); }
  catch (e) { const r = document.createRange(); r.selectNodeContents(el); getSelection().removeAllRanges(); getSelection().addRange(r); toast('Press Ctrl+C to copy the selected prompt'); }
};
function promoDialog(p) {
  document.getElementById('dlg')?.remove();
  const k = p.kind, d = document.createElement('dialog'); d.id = 'dlg';
  const inp = (id, name, label, val, extra = '') => `<label for="${id}">${label}</label><input id="${id}" name="${name}" value="${E(val || '')}" ${extra}>`;
  d.innerHTML = `<form data-form="promosave" data-busy="Saving…" data-id="${p.id || ''}" data-kind="${k}"><h2>${p.id ? 'Edit' : 'New'} ${PROMO_KINDS[k].toLowerCase()}</h2>
    ${inp('pt', 'title', k === 'bar' ? 'Message' : 'Title', p.title, 'maxlength="120" required')}
    ${k !== 'bar' ? `<label for="px">Text</label><textarea id="px" name="text" maxlength="400">${E(p.text || '')}</textarea>${inp('pb', 'badge', k === 'ad' ? 'Small label (e.g. Sponsored)' : 'Badge (e.g. Limited time)', p.badge, 'maxlength="30"')}` : ''}
    ${k === 'offer' ? `<div class="row"><div>${inp('pp', 'price', 'Price', p.price, 'maxlength="40" placeholder="$29"')}</div><div>${inp('po', 'old_price', 'Old price (struck through)', p.old_price, 'maxlength="40" placeholder="$49"')}</div></div>` : ''}
    ${k === 'ad' ? inp('pi', 'image_url', 'Image address (https://…, optional)', p.image_url, 'maxlength="500" type="url"') : ''}
    ${inp('pl', 'link_url', 'Button link', p.link_url, 'maxlength="500" placeholder="Leave empty to scroll to the contact section"')}
    ${inp('pc', 'cta_label', 'Button text', p.cta_label, 'maxlength="40" placeholder="Get this offer"')}
    <div class="row"><div><label for="ps">Starts (optional)</label><input id="ps" name="starts_at" type="datetime-local" value="${toLocal(p.starts_at)}"></div><div><label for="pe">Ends (optional)</label><input id="pe" name="ends_at" type="datetime-local" value="${toLocal(p.ends_at)}"></div></div>
    <p class="hint">Offers show a live countdown when an end time is set, and hide themselves when it passes.</p>
    <div class="row"><button class="btn">Save</button><button type="button" class="btn ghost" data-act="closedlg">Cancel</button></div></form>`;
  document.body.appendChild(d); d.showModal();
}
actions.newpromo = el => promoDialog({ kind: el.dataset.kind, enabled: true });
actions.editpromo = el => promoDialog(PROMOS.find(p => String(p.id) === el.dataset.id));
forms.promosave = async f => {
  const v = fd(f), body = { kind: f.dataset.kind, title: v.title, text: v.text || '', badge: v.badge || '', price: v.price || '', old_price: v.old_price || '', image_url: v.image_url || '', link_url: v.link_url || '', cta_label: v.cta_label || '', starts_at: fromLocal(v.starts_at), ends_at: fromLocal(v.ends_at) };
  if (f.dataset.id) await api('/admin/promotions/' + f.dataset.id, { method: 'PATCH', json: body }); else await api('/admin/promotions', { json: body });
  document.getElementById('dlg')?.close(); toast('Saved'); route();
};
actions.promotoggle = async el => { const p = PROMOS.find(x => String(x.id) === el.dataset.id); await api('/admin/promotions/' + p.id, { method: 'PATCH', json: { enabled: !p.enabled } }); route(); };
actions.movepromo = async el => { await api(`/admin/promotions/${el.dataset.id}/move`, { json: { direction: el.dataset.dir } }); route(); };
actions.delpromo = async el => { if (!confirm('Delete this?')) return; await api('/admin/promotions/' + el.dataset.id, { method: 'DELETE' }); route(); };

route();
