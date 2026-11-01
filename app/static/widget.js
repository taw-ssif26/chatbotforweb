/* Embeddable chat widget. Usage: <script src="https://YOUR-HOST/widget.js" data-bot="BOT_KEY" async></script>
   Renders inside a Shadow DOM so host-site CSS can't break it (and it can't break the host). */
(() => {
  const s = document.currentScript || document.querySelector('script[data-bot][src*="widget.js"]');
  if (!s || !s.dataset.bot || window.__aichat_loaded) return;
  window.__aichat_loaded = true;
  const BOT = s.dataset.bot, BASE = new URL(s.src, location.href).origin, KEY = 'aichat_' + BOT;
  const ls = {
    get(k) { try { return JSON.parse(localStorage.getItem(KEY + k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(KEY + k, JSON.stringify(v)); } catch (e) {} },
  };
  const sid = ls.get('sid') || (() => {
    const v = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
    ls.set('sid', v); return v;
  })();
  const esc = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const md = t => esc(t)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/(^|\n)[-*] /g, '$1• ').replace(/\n/g, '<br>');
  const ink = hex => { const n = parseInt(hex.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255)) > 150 ? '#111' : '#fff'; };

  const warn = m => { try { console.warn('[AIChat] ' + m); } catch (e) {} };
  // A sleeping free-tier server answers 502/503 or times out on the first hit: retry a few times before giving up.
  (function load(n) {
    const retry = () => { if (n < 5) setTimeout(() => load(n + 1), 3000 * n); };
    fetch(BASE + '/api/public/config/' + encodeURIComponent(BOT))
      .then(async r => {
        if (r.ok) return init(await r.json());
        const j = await r.json().catch(() => ({}));
        warn('Chat bubble not shown (' + r.status + '): ' + (typeof j.detail === 'string' ? j.detail : 'server error'));
        if (r.status >= 500) retry();
      })
      .catch(e => {
        warn('Could not reach ' + BASE + ' (' + (e && e.message) + ')' + (location.protocol === 'https:' && BASE.startsWith('http:') ? ': this page is https but the chatbot server is http, so the browser blocks it. Use an https address.' : ''));
        retry();
      });
  })(1);

  function init(cfg) {
    const host = document.createElement('div');
    host.style.cssText = 'all:initial;position:fixed;z-index:2147483000;bottom:0;' + (cfg.position === 'left' ? 'left:0' : 'right:0');
    const root = host.attachShadow({ mode: 'open' });
    const side = cfg.position === 'left' ? 'left' : 'right';
    root.innerHTML = `<style>
      :host{font-size:15px;line-height:1.45}
      .panel{font-size:15px;line-height:1.45}
      *{box-sizing:border-box;font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
      .fab{position:fixed;bottom:20px;${side}:20px;width:58px;height:58px;border:0;border-radius:50%;background:${cfg.color};color:${ink(cfg.color)};cursor:pointer;box-shadow:0 6px 24px rgba(0,0,0,.25);display:grid;place-items:center}
      .fab:focus-visible,button:focus-visible,textarea:focus-visible{outline:3px solid #8aa4ff;outline-offset:2px}
      .panel{position:fixed;bottom:90px;${side}:20px;width:380px;height:min(600px,calc(100vh - 120px));background:#fff;color:#16202e;border-radius:16px;box-shadow:0 12px 48px rgba(0,0,0,.28);display:flex;flex-direction:column;overflow:hidden}
      .panel[hidden]{display:none}
      header{background:${cfg.color};color:${ink(cfg.color)};padding:14px 16px;display:flex;justify-content:space-between;align-items:center;font-weight:600}
      header button{background:none;border:0;color:inherit;font-size:24px;line-height:1;cursor:pointer;padding:0 4px}
      .log{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;background:#f5f7fb}
      .m{max-width:86%;padding:9px 12px;border-radius:14px;word-wrap:break-word;overflow-wrap:anywhere}
      .m.bot{background:#fff;border:1px solid #e1e6ef;align-self:flex-start;border-bottom-left-radius:4px}
      .m.user{background:${cfg.color};color:${ink(cfg.color)};align-self:flex-end;border-bottom-right-radius:4px}
      .m.err{background:#fdecea;border-color:#f3b8b2;color:#8a1c12}
      .m a{color:inherit;text-decoration:underline}.m code{background:rgba(0,0,0,.08);padding:1px 4px;border-radius:4px}
      .typing::after{content:"";display:inline-block;width:6px;height:6px;border-radius:50%;background:#8a94a6;animation:b 1s infinite}
      @keyframes b{0%,100%{opacity:.25}50%{opacity:1}}
      form{display:flex;gap:8px;padding:10px;border-top:1px solid #e1e6ef;background:#fff}
      textarea{flex:1;resize:none;border:1px solid #cfd6e4;border-radius:10px;padding:9px 11px;font:inherit;max-height:110px;color:#16202e;background:#fff}
      form button{border:0;border-radius:10px;background:${cfg.color};color:${ink(cfg.color)};width:44px;cursor:pointer;display:grid;place-items:center}
      form button:disabled{opacity:.5;cursor:default}
      footer{font-size:12px;text-align:center;padding:0 0 8px;color:#6b7589;background:#fff}footer a{color:inherit}
      @media (max-width:480px){.panel{inset:0;width:100%;height:100%;border-radius:0}.fab{bottom:16px;${side}:16px}}
      @media (prefers-reduced-motion:reduce){.typing::after{animation:none}}
    </style>
    <button class="fab" aria-label="Open chat" aria-expanded="false"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L3 20l1-4.6A8 8 0 1 1 21 12z"/></svg></button>
    <section class="panel" role="dialog" aria-label="${esc(cfg.name)} chat" hidden>
      <header><span>${esc(cfg.name)}</span><button type="button" class="x" aria-label="Close chat">&times;</button></header>
      <div class="log" aria-live="polite"></div>
      <form><textarea rows="1" maxlength="1000" placeholder="Type your message…" aria-label="Message"></textarea>
        <button type="submit" aria-label="Send"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg></button></form>
      <footer>${cfg.brand && cfg.brand.name ? `Powered by ${cfg.brand.url && /^https?:\/\//.test(cfg.brand.url) ? `<a href="${esc(cfg.brand.url)}" target="_blank" rel="noopener">${esc(cfg.brand.name)}</a>` : esc(cfg.brand.name)} · ` : ''}AI assistant · <a href="${BASE}/privacy" target="_blank" rel="noopener">Privacy</a></footer>
    </section>`;
    const $ = q => root.querySelector(q);
    const fab = $('.fab'), panel = $('.panel'), log = $('.log'), ta = $('textarea'), form = $('form'), sendBtn = form.querySelector('button');
    let history = ls.get('h') || [], busy = false, started = false;

    const add = (cls, html) => { const d = document.createElement('div'); d.className = 'm ' + cls; d.innerHTML = html; log.appendChild(d); log.scrollTop = log.scrollHeight; return d; };
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
  }
})();
