/* Embeddable chat widget. Usage: <script src="https://YOUR-HOST/widget.js" data-bot="BOT_KEY" async></script>
   Renders inside a Shadow DOM so host-site CSS can't break it (and it can't break the host).
   Styles are applied with constructable stylesheets / CSSOM, so a customer's strict Content-Security-Policy does not block them.
   data-mode="lib" exposes window.AIChatKit.mount() for the dashboard's live appearance preview (no network, no storage). */
(() => {
  const s = document.currentScript || document.querySelector('script[data-bot][src*="widget.js"]');
  if (!s) return;
  const LIB = s.dataset.mode === 'lib';
  if (!LIB && (!s.dataset.bot || window.__aichat_loaded)) return;
  const BASE = new URL(s.src, location.href).origin, BOT = s.dataset.bot;

  /* ---------- helpers ---------- */
  const esc = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const md = t => esc(t)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/(^|\n)[-*] /g, '$1• ').replace(/\n/g, '<br>');
  const rgb = h => { const n = parseInt(h.slice(1), 16); return [n >> 16, n >> 8 & 255, n & 255]; };
  const hex = a => '#' + a.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
  const ink = h => { const [r, g, b] = rgb(h); return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#111111' : '#ffffff'; };
  const mix = (fg, bg, t) => { const f = rgb(fg), b = rgb(bg); return hex(f.map((v, i) => b[i] + (v - b[i]) * t)); };
  const isHex = v => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);

  const THEMES = {
    light: { bg: '#f5f7fb', surface: '#ffffff', text: '#16202e', bot: '#ffffff' },
    dark: { bg: '#0d1322', surface: '#141b2d', text: '#e8edf8', bot: '#1c2640' },
  };
  const FONTS = {
    system: 'system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif',
    serif: 'Georgia,"Times New Roman",Times,serif',
    mono: 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
  };
  const RADII = { sharp: [4, 6, 6], soft: [16, 14, 10], round: [26, 20, 22] }; // panel, bubble, input/button

  /* Resolve the final colours: chosen theme as the base, then the client's own overrides, with readable-text fallbacks. */
  function resolve(cfg) {
    const a = cfg.appearance || {}, pick = k => (isHex(a[k]) ? a[k] : null);
    const dark = cfg.theme === 'dark' || (cfg.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    const base = THEMES[dark ? 'dark' : 'light'], primary = isHex(cfg.color) ? cfg.color : '#2f5bff';
    const bg = pick('bg_color') || base.bg, surface = pick('surface_color') || base.surface, bot = pick('bot_bubble_color') || base.bot;
    const text = pick('text_color') || (pick('bg_color') ? ink(bg) : base.text);
    const surfaceText = pick('text_color') || (pick('surface_color') ? ink(surface) : base.text);
    const botText = pick('bot_text_color') || (pick('bot_bubble_color') ? ink(bot) : text);
    const [r, br, ir] = RADII[a.radius] || RADII.soft;
    return {
      '--c': primary, '--hdr': pick('header_text_color') || ink(primary), '--user-fg': pick('user_text_color') || ink(primary),
      '--bg': bg, '--fg': text, '--surface': surface, '--surface-fg': surfaceText, '--bot': bot, '--bot-fg': botText,
      '--line': mix(text, bg, 0.16), '--muted': mix(surfaceText, surface, 0.62),
      '--r': r + 'px', '--br': br + 'px', '--ir': ir + 'px', '--font': FONTS[a.font] || FONTS.system,
    };
  }

  const CSS = `
    :host{font-size:15px;line-height:1.45}
    *{box-sizing:border-box;font-family:var(--font)}
    .fab{position:fixed;bottom:20px;width:58px;height:58px;border:0;border-radius:50%;background:var(--c);color:var(--hdr);cursor:pointer;box-shadow:0 6px 24px rgba(0,0,0,.28);display:grid;place-items:center}
    :host([data-side=right]) .fab,:host([data-side=right]) .panel{right:20px}
    :host([data-side=left]) .fab,:host([data-side=left]) .panel{left:20px}
    .fab:focus-visible,button:focus-visible,textarea:focus-visible{outline:3px solid #8aa4ff;outline-offset:2px}
    .panel{position:fixed;bottom:90px;width:380px;height:min(600px,calc(100vh - 120px));background:var(--bg);color:var(--fg);border-radius:var(--r);box-shadow:0 12px 48px rgba(0,0,0,.32);display:flex;flex-direction:column;overflow:hidden;font-size:15px;line-height:1.45}
    .panel[hidden]{display:none}
    header{background:var(--c);color:var(--hdr);padding:14px 16px;display:flex;justify-content:space-between;align-items:center;font-weight:600}
    header button{background:none;border:0;color:inherit;font-size:24px;line-height:1;cursor:pointer;padding:0 4px}
    .log{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;background:var(--bg)}
    .m{max-width:86%;padding:9px 12px;border-radius:var(--br);word-wrap:break-word;overflow-wrap:anywhere}
    .m.bot{background:var(--bot);color:var(--bot-fg);border:1px solid var(--line);align-self:flex-start;border-bottom-left-radius:4px}
    .m.user{background:var(--c);color:var(--user-fg);align-self:flex-end;border-bottom-right-radius:4px}
    .m.err{background:rgba(220,38,38,.14);border-color:rgba(220,38,38,.45);color:var(--bot-fg)}
    .m a{color:inherit;text-decoration:underline}.m code{background:rgba(127,127,127,.2);padding:1px 4px;border-radius:4px}
    .typing::after{content:"";display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--muted);animation:b 1s infinite}
    @keyframes b{0%,100%{opacity:.25}50%{opacity:1}}
    form{display:flex;gap:8px;padding:10px;border-top:1px solid var(--line);background:var(--surface)}
    textarea{flex:1;resize:none;border:1px solid var(--line);border-radius:var(--ir);padding:9px 11px;font:inherit;max-height:110px;color:var(--fg);background:var(--bg)}
    textarea::placeholder{color:var(--muted)}
    form button{border:0;border-radius:var(--ir);background:var(--c);color:var(--hdr);width:44px;cursor:pointer;display:grid;place-items:center}
    form button:disabled{opacity:.5;cursor:default}
    footer{font-size:12px;text-align:center;padding:0 0 8px;color:var(--muted);background:var(--surface)}footer a{color:inherit}
    :host([data-preview]){display:block}
    :host([data-preview]) .panel{position:relative;bottom:auto;left:auto;right:auto;width:100%;max-width:380px;height:440px;margin:0 auto}
    :host([data-preview]) .fab{position:relative;bottom:auto;left:auto;right:auto;margin:14px 0 0}
    :host([data-preview][data-side=right]) .fab{margin-left:auto;margin-right:calc((100% - min(100%,380px)) / 2)}
    :host([data-preview][data-side=left]) .fab{margin-right:auto;margin-left:calc((100% - min(100%,380px)) / 2)}
    @media (max-width:480px){:host(:not([data-preview])) .panel{inset:0;width:100%;height:100%;border-radius:0}:host(:not([data-preview])) .fab{bottom:16px}:host([data-side=right]:not([data-preview])) .fab{right:16px}:host([data-side=left]:not([data-preview])) .fab{left:16px}}
    @media (prefers-reduced-motion:reduce){.typing::after{animation:none}}`;

  const ICON_CHAT = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L3 20l1-4.6A8 8 0 1 1 21 12z"/></svg>';
  const ICON_SEND = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>';

  /* ---------- the widget ---------- */
  function build(cfg, opts) {
    const preview = !!opts.preview, side = cfg.position === 'left' ? 'left' : 'right';
    const host = document.createElement('div');
    host.style.cssText = preview ? 'display:block' : 'all:initial;position:fixed;z-index:2147483000;bottom:0;' + side + ':0';
    host.dataset.side = side;
    if (preview) host.dataset.preview = '';
    const root = host.attachShadow({ mode: 'open' });
    if ('adoptedStyleSheets' in root && typeof CSSStyleSheet === 'function') {
      try { const sh = new CSSStyleSheet(); sh.replaceSync(CSS); root.adoptedStyleSheets = [sh]; } catch (e) { root.innerHTML = '<style>' + CSS + '</style>'; }
    } else root.innerHTML = '<style>' + CSS + '</style>';
    const brand = cfg.brand && cfg.brand.name ? `Powered by ${cfg.brand.url && /^https?:\/\//.test(cfg.brand.url) ? `<a href="${esc(cfg.brand.url)}" target="_blank" rel="noopener">${esc(cfg.brand.name)}</a>` : esc(cfg.brand.name)} · ` : '';
    const wrap = document.createElement('div');
    wrap.innerHTML = `<button class="fab" aria-label="Open chat" aria-expanded="false">${ICON_CHAT}</button>
      <section class="panel" role="dialog" aria-label="${esc(cfg.name)} chat" ${preview ? '' : 'hidden'}>
        <header><span class="title">${esc(cfg.name)}</span><button type="button" class="x" aria-label="Close chat">&times;</button></header>
        <div class="log" aria-live="polite"></div>
        <form><textarea rows="1" maxlength="1000" placeholder="Type your message…" aria-label="Message"></textarea>
          <button type="submit" aria-label="Send">${ICON_SEND}</button></form>
        <footer>${brand}AI assistant · <a href="${BASE}/privacy" target="_blank" rel="noopener">Privacy</a></footer>
      </section>`;
    root.append(...wrap.childNodes);
    const $ = q => root.querySelector(q);
    const fab = $('.fab'), panel = $('.panel'), log = $('.log'), ta = $('textarea'), form = $('form'), sendBtn = form.querySelector('button');

    const apply = () => {
      for (const [k, v] of Object.entries(resolve(cfg))) host.style.setProperty(k, v);
      host.dataset.side = cfg.position === 'left' ? 'left' : 'right';
      $('.title').textContent = cfg.name;
    };
    apply();
    let mq = null;
    if (cfg.theme === 'auto' && window.matchMedia) { mq = matchMedia('(prefers-color-scheme: dark)'); mq.addEventListener('change', apply); }
    const add = (cls, html) => { const d = document.createElement('div'); d.className = 'm ' + cls; d.innerHTML = html; log.appendChild(d); log.scrollTop = log.scrollHeight; return d; };

    if (preview) {   // static sample conversation, no network, no storage
      add('bot', md(cfg.welcome)); add('user', esc('What are your opening hours?')); add('bot', md('We are open **9am to 5pm**, Monday to Friday. Anything else I can help with?'));
      form.onsubmit = e => e.preventDefault();
      return { host, update(next) { cfg = next; apply(); log.firstChild.innerHTML = md(cfg.welcome); } };
    }

    const KEY = 'aichat_' + BOT;
    const ls = {
      get(k) { try { return JSON.parse(localStorage.getItem(KEY + k)); } catch (e) { return null; } },
      set(k, v) { try { localStorage.setItem(KEY + k, JSON.stringify(v)); } catch (e) {} },
    };
    const sid = ls.get('sid') || (() => {
      const v = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
      ls.set('sid', v); return v;
    })();
    let history = ls.get('h') || [], busy = false, started = false;
    const toggle = open => {
      panel.hidden = !open; fab.setAttribute('aria-expanded', open);
      if (open) {
        if (!started) { started = true; add('bot', md(cfg.welcome)); history.forEach(m => add(m.r === 'u' ? 'user' : 'bot', m.r === 'u' ? esc(m.t) : md(m.t))); }
        ta.focus();
      }
    };
    fab.onclick = () => toggle(panel.hidden);
    $('.x').onclick = () => { toggle(false); fab.focus(); };
    root.addEventListener('keydown', e => { if (e.key === 'Escape') toggle(false); });
    ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; });
    ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });

    form.onsubmit = async e => {
      e.preventDefault();
      const text = ta.value.trim();
      if (!text || busy) return;
      ta.value = ''; ta.style.height = 'auto'; busy = true; sendBtn.disabled = true;
      add('user', esc(text));
      const el = add('bot typing', '');
      let out = '';
      try {
        const r = await fetch(BASE + '/api/public/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bot: BOT, session: sid, message: text }) });
        if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(typeof j.detail === 'string' ? j.detail : 'Something went wrong. Please try again.'); }
        const rd = r.body.getReader(), dec = new TextDecoder(); let buf = '';
        for (;;) {
          const { done, value } = await rd.read(); if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const line = buf.slice(0, i).trim(); buf = buf.slice(i + 2);
            if (!line.startsWith('data:')) continue;
            const ev = JSON.parse(line.slice(5));
            if (ev.error) throw new Error(ev.error);
            if (ev.t) { out += ev.t; el.classList.remove('typing'); el.innerHTML = md(out); log.scrollTop = log.scrollHeight; }
          }
        }
        history.push({ r: 'u', t: text }, { r: 'b', t: out }); history = history.slice(-30); ls.set('h', history);
      } catch (err) {
        el.classList.remove('typing'); el.classList.add('err'); el.textContent = err.message || 'Something went wrong.';
      }
      busy = false; sendBtn.disabled = false; ta.focus();
    };
    (document.body || document.documentElement).appendChild(host);
    window.AIChat = { open: () => toggle(true), close: () => toggle(false) };
    return { host, update() {} };
  }

  /* ---------- entry points ---------- */
  if (LIB) {
    window.AIChatKit = { resolve, mount(container, cfg) { const w = build(cfg, { preview: true }); container.replaceChildren(w.host); return w; } };
    return;
  }
  window.__aichat_loaded = true;
  const warn = m => { try { console.warn('[AIChat] ' + m); } catch (e) {} };
  // A sleeping free-tier server answers 502/503 or times out on the first hit: retry a few times before giving up.
  (function load(n) {
    const retry = () => { if (n < 5) setTimeout(() => load(n + 1), 3000 * n); };
    fetch(BASE + '/api/public/config/' + encodeURIComponent(BOT))
      .then(async r => {
        if (r.ok) return build(await r.json(), { preview: false });
        const j = await r.json().catch(() => ({}));
        warn('Chat bubble not shown (' + r.status + '): ' + (typeof j.detail === 'string' ? j.detail : 'server error'));
        if (r.status >= 500) retry();
      })
      .catch(e => {
        warn('Could not reach ' + BASE + ' (' + (e && e.message) + ')' + (location.protocol === 'https:' && BASE.startsWith('http:') ? ': this page is https but the chatbot server is http, so the browser blocks it. Use an https address.' : ''));
        retry();
      });
  })(1);
})();
