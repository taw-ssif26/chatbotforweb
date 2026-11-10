/* Landing page: everything dynamic comes from GET /api/public/site. DOM is built with textContent, never innerHTML with feed data. */
(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };
  var NS = 'http://www.w3.org/2000/svg';
  var SAFE = /^(https:\/\/|mailto:|tel:|#)/;
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { if (k === 'text') n.textContent = attrs[k]; else if (k === 'href' || k === 'src') { if (SAFE.test(attrs[k])) n.setAttribute(k, attrs[k]); } else n.setAttribute(k, attrs[k]); });
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }
  var ICONS = {
    code: 'M8 8l-4 4 4 4M16 8l4 4-4 4M14 5l-4 14', book: 'M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2V5zM4 19a2 2 0 012-2h13', globe: 'M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
    key: 'M15 7a4 4 0 11-3.9 4.9L4 19v-3H1V13l6.1-6.1A4 4 0 0115 7zM16 8h.01', chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2', shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3zM9 12l2 2 4-4',
    email: 'M3 6h18v12H3zM3 7l9 7 9-7', whatsapp: 'M3 21l1.6-4.6A8.5 8.5 0 1112 20.5a8.4 8.4 0 01-4-1L3 21zM9 8c0 4 3 7 7 7l1.5-1.5-2-1-1 .8c-1-.4-2-1.4-2.4-2.4l.8-1-1-2L9 8z',
    telegram: 'M21 4L3 11l6 2 2 6 3-4 5 4 2-15zM9 13l8-6', messenger: 'M4 20l1.3-4A8 8 0 1112 20a8 8 0 01-3-.6L4 20zM8 13l3-3 2 2 3-3',
    phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z', link: 'M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1',
    console: 'M4 17l6-6-6-6M12 19h8', menu: 'M4 7h16M4 12h16M4 17h16', close: 'M6 6l12 12M18 6L6 18', sun: 'M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6L4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4M12 7a5 5 0 100 10 5 5 0 000-10z', moon: 'M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z', auto: 'M3 5h18v12H3zM8 21h8M12 17v4'
  };
  function icon(name) { var s = document.createElementNS(NS, 'svg'); s.setAttribute('viewBox', '0 0 24 24'); var p = document.createElementNS(NS, 'path'); p.setAttribute('d', ICONS[name] || ICONS.link); s.appendChild(p); return s; }
  var ICON_FOR = { email: 'email', whatsapp: 'whatsapp', telegram: 'telegram', messenger: 'messenger', phone: 'phone' };

  /* theme toggle: auto -> light -> dark */
  var themeBtns = [$('#themebtn'), $('#themebtn2')];
  function paintTheme() {
    var t = window.getTheme();
    themeBtns.forEach(function (b, i) {
      var sv = icon(t === 'dark' ? 'moon' : t === 'light' ? 'sun' : 'auto');
      sv.setAttribute('width', 20); sv.setAttribute('height', 20); sv.setAttribute('fill', 'none'); sv.setAttribute('stroke', 'currentColor'); sv.setAttribute('stroke-width', 1.8);
      b.replaceChildren(sv);
      if (i === 1) b.appendChild(document.createTextNode('Theme: ' + t.charAt(0).toUpperCase() + t.slice(1)));
      b.title = 'Theme: ' + t; b.setAttribute('aria-label', 'Theme: ' + t + '. Click to change.');
    });
  }
  themeBtns.forEach(function (b) { b.addEventListener('click', function () { var o = { auto: 'light', light: 'dark', dark: 'auto' }; window.setTheme(o[window.getTheme()]); paintTheme(); }); });
  paintTheme();

  /* "Console" button: icon + a tiny enhancement; the link itself works without JS */
  var cons = $('#console'); cons.insertBefore(icon('console'), cons.firstChild);

  /* mobile menu */
  var nav = $('#nav'), menuBtn = $('#menubtn');
  function paintMenu(open) { menuBtn.replaceChildren(icon(open ? 'close' : 'menu')); var sv = menuBtn.firstChild; sv.setAttribute('width', 22); sv.setAttribute('height', 22); sv.setAttribute('fill', 'none'); sv.setAttribute('stroke', 'currentColor'); sv.setAttribute('stroke-width', 2); sv.setAttribute('stroke-linecap', 'round'); menuBtn.setAttribute('aria-expanded', String(open)); menuBtn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu'); }
  function setMenu(open) { nav.classList.toggle('open', open); paintMenu(open); }
  paintMenu(false);
  menuBtn.addEventListener('click', function () { setMenu(!nav.classList.contains('open')); });
  document.querySelectorAll('#menu a').forEach(function (a) { a.addEventListener('click', function () { setMenu(false); }); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setMenu(false); });
  document.addEventListener('click', function (e) { if (e.composedPath().indexOf(nav) < 0) setMenu(false); });  // composedPath: the tapped icon is replaced during the click, so e.target is already detached
  window.addEventListener('scroll', function () { nav.classList.toggle('scrolled', window.scrollY > 8); }, { passive: true });

  /* floating "Get access" pill on phones: hidden while the hero buttons or the contact section are on screen */
  var pill = $('#pill'), seen = {};
  function paintPill() { pill.hidden = seen.hero || seen.contact; }
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (es) { es.forEach(function (e) { seen[e.target.dataset.watch] = e.isIntersecting; }); paintPill(); }, { threshold: 0.15 });
    [['.hero .cta', 'hero'], ['#contact', 'contact']].forEach(function (x) { var n = $(x[0]); if (n) { n.dataset.watch = x[1]; io.observe(n); } });
  }
  pill.hidden = false;
  /* keep the pill away from the chat bubble if the demo bot sits bottom-left */
  var tries = 0, t = setInterval(function () { var h = [].find.call(document.body.children, function (n) { return n.shadowRoot; }); if (h) { pill.classList.toggle('right', h.dataset.side === 'left'); clearInterval(t); } else if (++tries > 20) clearInterval(t); }, 500);

  $('#snippet').textContent = '<script src="' + location.origin + '/widget.js"\n  data-bot="YOUR_BOT_KEY" async></script>';
  $('#copy').textContent = '© ' + new Date().getFullYear() + ' ' + document.title.split(':')[0];

  var FEATURES = [
    ['code', 'One line to install', 'Paste a single line into your site. The chat bubble appears, and visitors never leave your page.'],
    ['book', 'Answers from your content', 'Add text, web pages and files. It answers from what you gave it and says so when it does not know.'],
    ['globe', 'Searches the web too', 'On Premium it looks things up online when your own content has no answer.'],
    ['key', 'Bring your own AI model', 'Use Claude, GPT, Llama, Grok or OpenRouter with your own key, or the included ones.'],
    ['chart', 'A dashboard you control', 'Manage bots, knowledge and conversations, and style the chat to match your brand, light or dark.'],
    ['shield', 'Secure by design', 'Encrypted keys, rules against leaking instructions or documents, and domain limits.']
  ];
  var fl = $('#featurelist');
  FEATURES.forEach(function (f) { fl.appendChild(el('div', { 'class': 'feat' }, [el('div', { 'class': 'ic' }, [icon(f[0])]), el('h3', { text: f[1] }), el('p', { text: f[2] })])); });

  function fmtLeft(ms) { var s = Math.max(0, Math.floor(ms / 1000)), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return (d ? d + 'd ' : '') + (d || h ? String(h).padStart(2, '0') + 'h ' : '') + String(m).padStart(2, '0') + 'm'; }
  function cta(p, cls) { return el('a', { 'class': 'btn ' + cls, href: p.link_url || '#contact', text: p.cta_label || 'Get this offer', rel: 'noopener' }); }

  function render(d) {
    var name = (d.brand && d.brand.name) || 'Me';
    $('#brand').textContent = name;
    if (d.headline) $('#headline').textContent = d.headline;
    if (d.subheadline) $('#subheadline').textContent = d.subheadline;
    $('#copy').textContent = '© ' + new Date().getFullYear() + ' ' + name;

    /* announcement bar */
    var bar = $('#bar');
    if (d.bar && !sessionStorageGet('bar' + d.bar.id)) {
      var kids = [document.createTextNode(d.bar.title + ' ')];
      if (d.bar.link_url) kids.push(el('a', { href: d.bar.link_url, text: d.bar.cta_label || 'Learn more' }));
      var close = el('button', { type: 'button', 'aria-label': 'Dismiss', text: '×' });
      close.addEventListener('click', function () { bar.hidden = true; sessionStorageSet('bar' + d.bar.id, '1'); });
      kids.push(close);
      bar.replaceChildren.apply(bar, kids);
      bar.hidden = false;
    }

    /* offers with countdowns */
    var offers = d.offers || [], list = $('#offerlist'), timers = [];
    list.replaceChildren();
    offers.forEach(function (o) {
      var card = el('div', { 'class': 'offer' }), count = null;
      if (o.badge) card.appendChild(el('span', { 'class': 'badge', text: o.badge }));
      card.appendChild(el('h3', { text: o.title }));
      if (o.text) card.appendChild(el('p', { text: o.text }));
      if (o.price) { var pr = el('div', { 'class': 'price', text: o.price }); if (o.old_price) pr.appendChild(el('s', { text: o.old_price })); card.appendChild(pr); }
      if (o.ends_at) { count = el('div', { 'class': 'count' }); card.appendChild(count); timers.push({ o: o, count: count, card: card }); }
      card.appendChild(cta(o, 'hot'));
      list.appendChild(card);
    });
    function tick() {
      var live = 0;
      timers.forEach(function (t) { var left = new Date(t.o.ends_at) - Date.now(); if (left <= 0) { t.card.hidden = true; } else { live++; t.count.textContent = 'Ends in ' + fmtLeft(left); } });
      if (timers.length && !live && offers.length === timers.length) $('#offers').hidden = true;
    }
    tick(); if (timers.length) setInterval(tick, 30000);
    $('#offers').hidden = !offers.length;

    /* ad banners */
    var ads = $('#ads'); ads.replaceChildren();
    (d.ads || []).forEach(function (a) {
      var box = el('div', { 'class': 'ad' });
      if (a.image_url) box.appendChild(el('img', { src: a.image_url, alt: '', loading: 'lazy', width: 130, height: 90 }));
      box.appendChild(el('div', {}, [el('small', { text: a.badge || 'Sponsored' }), el('h3', { text: a.title }), a.text ? el('p', { text: a.text }) : null]));
      box.appendChild(cta(a, 'primary'));
      ads.appendChild(box);
    });
    ads.hidden = !(d.ads || []).length;

    /* pricing */
    var pl = $('#planlist'); pl.replaceChildren();
    (d.plans || []).forEach(function (p) {
      var card = el('div', { 'class': 'plan' + (p.id === 'premium' ? ' pop' : '') });
      card.appendChild(el('h3', { text: p.label }));
      var price = p.price ? el('div', { 'class': 'pp', text: p.price }) : el('div', { 'class': 'pp' }, [el('small', { text: 'Message me for pricing' })]);
      card.appendChild(price);
      var ul = el('ul'); p.features.forEach(function (f) { ul.appendChild(el('li', { text: f })); }); card.appendChild(ul);
      card.appendChild(el('a', { 'class': 'btn ' + (p.id === 'premium' ? 'primary' : 'ghost'), href: '#contact', text: 'Get access' }));
      pl.appendChild(card);
    });

    /* about */
    $('#aboutname').textContent = 'About ' + name;
    $('#aboutbio').textContent = (d.brand && d.brand.bio) || '';
    var wk = $('#works'); wk.replaceChildren();
    ((d.brand && d.brand.works) || []).forEach(function (w) {
      var m = w.match(/https:\/\/\S+/), box = el('div', { 'class': 'work' });
      if (m) { var label = w.replace(m[0], '').replace(/[—\-:|]\s*$/, '').trim() || m[0]; box.appendChild(el('a', { href: m[0], text: label, rel: 'noopener' })); var rest = w.replace(label, '').replace(m[0], '').replace(/^[\s—\-:|]+/, ''); if (rest) box.appendChild(el('div', { 'class': 'muted', text: rest })); } else box.textContent = w;
      wk.appendChild(box);
    });
    if (d.brand && d.brand.site) wk.appendChild(el('div', { 'class': 'work' }, [el('a', { href: d.brand.site, text: 'Visit my portfolio →', rel: 'noopener' })]));
    $('#about').hidden = !((d.brand && d.brand.bio) || wk.children.length);

    /* contact channels */
    var ch = $('#channels'); ch.replaceChildren();
    (d.contacts || []).forEach(function (c) {
      ch.appendChild(el('a', { 'class': 'channel', href: c.url, target: c.url.indexOf('https') === 0 ? '_blank' : '_self', rel: 'noopener noreferrer' }, [icon(ICON_FOR[c.type] || 'link'), el('span', {}, [document.createTextNode(c.label), el('small', { text: c.type === 'whatsapp' ? 'Chat with me now' : c.type === 'email' ? 'Write to me' : 'Open' })])]));
    });
    if (!(d.contacts || []).length) ch.appendChild(el('div', { 'class': 'empty-note', text: 'Use the form to send me a request, and I will reply.' }));

    /* live demo */
    if (d.demo_bot) {
      var s = document.createElement('script'); s.src = '/widget.js'; s.async = true; s.dataset.bot = d.demo_bot; document.body.appendChild(s);
      var db = $('#demobtn'); db.hidden = false;
      db.addEventListener('click', function () { if (window.AIChat) window.AIChat.open(); });
    }
  }
  function sessionStorageGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function sessionStorageSet(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} }

  fetch('/api/public/site').then(function (r) { return r.ok ? r.json() : Promise.reject(); }).then(render).catch(function () {
    $('#channels').replaceChildren(el('div', { 'class': 'empty-note', text: 'Use the form to send me a request, and I will reply.' }));
  });

  /* request form */
  var form = $('#leadform'), msg = $('#formmsg');
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var fd = new FormData(form), body = { name: fd.get('name').trim(), contact: fd.get('contact').trim(), message: (fd.get('message') || '').trim(), website: fd.get('website') || '' };
    if (!body.name || body.contact.length < 3) { msg.className = 'form-msg bad'; msg.textContent = 'Please add your name and an email or WhatsApp number.'; return; }
    var b = form.querySelector('button'); b.disabled = true; msg.className = 'form-msg'; msg.textContent = 'Sending…';
    fetch('/api/public/leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { return [r.ok, j, r.status]; }); })
      .then(function (x) {
        if (x[0]) { msg.className = 'form-msg ok'; msg.textContent = 'Thanks! I will reply soon.'; form.reset(); }
        else { msg.className = 'form-msg bad'; msg.textContent = x[2] === 429 ? 'Too many attempts. Please message me directly using a button on the left.' : (typeof x[1].detail === 'string' ? x[1].detail : 'Please check your details and try again.'); }
      }).catch(function () { msg.className = 'form-msg bad'; msg.textContent = 'Could not send. Please use one of the contact buttons instead.'; })
      .then(function () { b.disabled = false; });
  });
})();
