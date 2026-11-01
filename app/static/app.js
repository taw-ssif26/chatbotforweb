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
async function run(fn, el) { try { await fn(el); } catch (err) { toast(err.message, true); } }
const fd = f => Object.fromEntries(new FormData(f));

/* ---------- shell + routing ---------- */
window.addEventListener('hashchange', route);
async function route() {
  if (!TOKEN) { app.innerHTML = loginView(); return; }
  try { ME = await api('/me'); } catch (e) { return; }
  const [a = 'bots', b, c] = location.hash.replace(/^#\/?/, '').split('/');
  let body;
  try {
    if (a === 'bot') body = await botView(b, c || 'knowledge');
    else if (a === 'keys') body = await keysView();
    else if (a === 'account') body = accountView();
    else if (a === 'admin' && ME.role === 'admin') body = await adminView(b || 'clients');
    else body = await botsView();
  } catch (e) { body = `<p class="err">${E(e.message)}</p>`; }
  app.innerHTML = shell(a, b, body);
}
function shell(a, b, body) {
  const nav = (h, l, on) => `<a href="${h}" class="${on ? 'on' : ''}">${l}</a>`;
  const admin = ME.role === 'admin', ad = a === 'admin' ? (b || 'clients') : '';
  return `<div class="layout"><aside><div class="brand">Chatbot Console</div><nav>
    ${nav('#/bots', 'Chatbots', a === 'bots' || a === 'bot')}${nav('#/keys', 'API keys', a === 'keys')}${nav('#/account', 'Account', a === 'account')}
    ${admin ? `<div class="sep">Owner</div>${nav('#/admin/clients', 'Clients', ad === 'clients')}${nav('#/admin/models', 'Models', ad === 'models')}${nav('#/admin/settings', 'Settings', ad === 'settings')}${nav('#/admin/status', 'Status', ad === 'status')}` : ''}
    </nav><div class="who"><span>${E(ME.email)}</span><button class="link" data-act="logout">Sign out</button></div></aside>
    <main>${ME.live ? '' : '<div class="banner">Your subscription is not active, so your chatbots are paused. Contact your provider to renew.</div>'}${body}</main></div>`;
}
actions.logout = () => logout();

/* ---------- login ---------- */
function loginView() {
  return `<div class="login"><h1>Chatbot Console</h1><p class="sub">Sign in to manage your chatbots.</p>
  <form class="card" data-form="login" data-busy="Signing in…">
    <label for="em">Email</label><input id="em" name="email" type="email" autocomplete="username" required>
    <label for="pw">Password</label><input id="pw" name="password" type="password" autocomplete="current-password" required>
    <div class="row"><button class="btn">Sign in</button></div></form></div>`;
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
  const tabs = [['knowledge', 'Knowledge'], ['settings', 'Settings'], ['chats', 'Conversations'], ['install', 'Install']];
  let inner = '';
  if (tab === 'knowledge') inner = await knowledgeTab(bot);
  else if (tab === 'settings') inner = await settingsTab(bot);
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
    <div class="row"><div><label for="c">Colour</label><input id="c" name="color" type="color" value="${E(bot.color)}"></div>
    <div><label for="p">Position</label><select id="p" name="position"><option value="right" ${bot.position === 'right' ? 'selected' : ''}>Bottom right</option><option value="left" ${bot.position === 'left' ? 'selected' : ''}>Bottom left</option></select></div></div>
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
    name: v.name, welcome: v.welcome, system_prompt: v.system_prompt, color: v.color, position: v.position,
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
actions.copy = async () => { await navigator.clipboard.writeText(document.getElementById('snip').textContent); toast('Copied'); };

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
  <form class="card" data-form="pw" data-busy="Saving…"><h2>Change password</h2><div class="row">
    <div><label for="o">Current password</label><input id="o" name="old" type="password" autocomplete="current-password" required></div>
    <div><label for="nw">New password (8+ characters)</label><input id="nw" name="new" type="password" autocomplete="new-password" minlength="8" required></div><button class="btn">Update</button></div></form>`;
}
forms.pw = async f => {
  const r = await api('/me/password', { json: fd(f) });
  TOKEN = r.token; localStorage.setItem('tok', TOKEN); f.reset(); toast('Password updated. Other devices were signed out.');
};

/* ---------- admin ---------- */
async function adminView(tab) {
  const tabs = { clients: adminClients, models: adminModels, settings: adminSettings, status: adminStatus };
  return await (tabs[tab] || adminClients)();
}
async function adminClients() {
  const [st, list] = await Promise.all([api('/admin/stats'), api('/admin/clients')]);
  CLIENTS = Object.fromEntries(list.map(c => [c.id, c]));
  const status = c => !c.active ? tag('Disabled', 'bad') : (c.expires_at && new Date(c.expires_at) > new Date() ? tag('Live', 'ok') : tag('Expired', 'warn'));
  return `<h1>Clients</h1><div class="grid">
    <div class="stat"><b>${st.live}</b><span>Live of ${st.clients} clients</span></div><div class="stat"><b>${st.expiring_7d}</b><span>Expiring within 7 days</span></div>
    <div class="stat"><b>${st.bots}</b><span>Bots</span></div><div class="stat"><b>${num(st.messages_month)}</b><span>Visitor messages this month</span></div></div>
  <form class="card" data-form="newclient" data-busy="Creating…"><h2>Add a client</h2><div class="row">
    <div><label for="ce">Email</label><input id="ce" name="email" type="email" required></div><div><label for="cn">Name</label><input id="cn" name="name"></div>
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
  <div class="card">${checkList(r.checks)}</div>
  <h2>Recent server errors</h2>${r.errors.length ? `<div class="wrap"><table><tr><th>Ref</th><th>When</th><th>Request</th><th>Error</th></tr>${r.errors.map(e =>
    `<tr><td><code>${E(e.ref)}</code></td><td>${E(e.at)}</td><td>${E(e.request)}</td><td>${E(e.error)}</td></tr>`).join('')}</table></div>` : '<p class="empty">None since the last restart.</p>'}`;
}
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

route();
