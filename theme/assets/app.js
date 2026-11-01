/* core.js: the shared front-end engine (window.UI). Same in every app made from APP_MAKER/template;
   app-specific things live in web/app.js (brand, nav, footer) and web/pages/*.html (the pages).

   Pages:   UI.page(name, {title, nav, icon, auth, order, chrome}, mount)
              auth: null (anyone) | 'guest' (signed-out only) | 'user' | 'admin'
              nav: label for the header / phone tab bar (omit to keep it out of the menus)
              mount(view, ctx) draws into `view`; ctx = {args, me, go, api}. Return a Promise (the page
              is "ready" when it resolves) or {ready, destroy}. URLs are #name/arg1/arg2.
   Server:  UI.api(fn, ...args) -> Promise of the server function's return value. A reply of
              {ok: false, error} rejects with that message (shown as a toast unless you .catch it).
            UI.apiQuiet(fn, ...args) is the same without Anvil's loading spinner.
   Auth:    UI.auth('login'|'signup'|'reset'|'logout', {...}) -> Promise of {ok, me, message}
   Helpers: UI.esc, UI.icon, UI.toast, UI.modal, UI.confirm, UI.busy, UI.formData, UI.fmtDate, UI.ago,
            UI.store, UI.setTheme, UI.feedback, UI.go, UI.refresh
   Tests:   window.UI_READY is true when the current page has finished loading. */
(function () {
  'use strict';
  if (window.UI && window.UI.__v) return;
  var UI = window.UI = { __v: 1, pages: {}, me: null, config: { name: 'App', key: 'app', home: 'home', landing: 'landing' } };
  window.UI_READY = false;

  UI.configure = function (cfg) { Object.keys(cfg).forEach(function (k) { UI.config[k] = cfg[k]; }); };

  /* ------------------------------------------------------------------ small helpers */
  UI.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  UI.plural = function (n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); };
  UI.initials = function (name) {
    var p = String(name || '?').trim().split(/\s+/);
    return ((p[0] || '?')[0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
  };
  UI.fmtDate = function (iso, opts) {
    if (!iso) return '';
    var d = iso.length <= 10 ? new Date(iso + 'T12:00:00') : new Date(iso);
    return d.toLocaleDateString(undefined, opts || { day: 'numeric', month: 'short', year: 'numeric' });
  };
  UI.fmtDateTime = function (iso) {
    return iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  };
  UI.ago = function (iso) {
    if (!iso) return '';
    var s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 60) return 'just now';
    var steps = [[60, 'minute'], [24, 'hour'], [7, 'day'], [4.35, 'week'], [12, 'month'], [Infinity, 'year']], n = s / 60;
    for (var i = 0; i < steps.length; i++) {
      if (n < steps[i][0]) { n = Math.floor(n); return UI.plural(n, steps[i][1]) + ' ago'; }
      n = n / steps[i][0];
    }
    return '';
  };
  UI.store = {
    get: function (k, dflt) { try { var v = localStorage.getItem(UI.config.key + '.' + k); return v == null ? dflt : JSON.parse(v); } catch (e) { return dflt; } },
    set: function (k, v) { try { localStorage.setItem(UI.config.key + '.' + k, JSON.stringify(v)); } catch (e) {} }
  };
  UI.formData = function (form) {
    var out = {};
    Array.prototype.forEach.call(form.elements, function (el) {
      if (!el.name || el.disabled) return;
      if (el.type === 'checkbox') out[el.name] = el.checked;
      else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; }
      else out[el.name] = el.value;
    });
    return out;
  };
  /* Disable a button while a Promise runs; returns the Promise. */
  UI.busy = function (btn, promise) {
    if (!btn) return promise;
    btn.disabled = true; btn.classList.add('is-busy');
    var done = function () { btn.disabled = false; btn.classList.remove('is-busy'); };
    promise.then(done, done);
    return promise;
  };

  var ICONS = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.5 3-5.5 6.5-5.5s6.5 2 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M18 14.7c2.2.6 3.5 2.4 3.5 5.3"/>',
    sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
    shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12z"/>',
    bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    back: '<path d="M19 12H5M11 18l-6-6 6-6"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    bug: '<rect x="7" y="8" width="10" height="12" rx="5"/><path d="M12 8V5M9 5.5 7.5 4M15 5.5 16.5 4M7 13H3M21 13h-4M7.5 18l-3 2M16.5 18l3 2M7.5 9.5l-3-2M16.5 9.5l3-2"/>',
    bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
    star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
    heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    inbox: '<path d="M3 13h5l1.5 3h5L16 13h5"/><path d="M5 5h14l2 8v6H3v-6z"/>',
    grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
    sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
    database: '<ellipse cx="12" cy="5.5" rx="7.5" ry="2.5"/><path d="M4.5 5.5v13c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5v-13"/><path d="M4.5 12c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 20v-4h-4"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
    pin: '<path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>',
    camera: '<path d="M4 8h3l2-3h6l2 3h3v12H4z"/><circle cx="12" cy="13.5" r="3.5"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
    filter: '<path d="M4 5h16l-6 7.5V19l-4 1.5v-8z"/>',
    more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>'
  };
  UI.ICONS = ICONS;
  UI.icon = function (name, cls) {
    return '<svg class="ui-ic ' + (cls || '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || ICONS.sparkle) + '</svg>';
  };

  /* ------------------------------------------------------------------ toasts, modals */
  UI.toast = function (msg, kind) {
    var box = document.querySelector('.ui-toasts');
    if (!box) { box = document.createElement('div'); box.className = 'ui ui-toasts'; box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
    var t = document.createElement('div');
    t.className = 'ui-toast' + (kind ? ' ' + kind : '');
    t.innerHTML = (kind === 'error' ? UI.icon('info') : kind === 'ok' ? UI.icon('check') : '') + '<span>' + UI.esc(msg) + '</span>';
    box.appendChild(t);
    setTimeout(function () { t.classList.add('out'); setTimeout(function () { t.remove(); }, 300); }, kind === 'error' ? 6500 : 3200);
  };
  UI.modal = function (html, opts) {
    opts = opts || {};
    var prev = document.activeElement;
    var wrap = document.createElement('div');
    wrap.className = 'ui ui-modal-wrap';
    wrap.innerHTML = '<div class="ui-modal' + (opts.wide ? ' wide' : '') + '" role="dialog" aria-modal="true">' +
      '<button class="ui-btn ghost icon ui-modal-x" data-close aria-label="Close">' + UI.icon('x') + '</button>' + html + '</div>';
    document.body.appendChild(wrap);
    document.documentElement.classList.add('ui-modal-open');
    function key(e) { if (e.key === 'Escape') close(); }
    function close() {
      if (!wrap.parentNode) return;
      wrap.remove(); document.removeEventListener('keydown', key);
      if (!document.querySelector('.ui-modal-wrap')) document.documentElement.classList.remove('ui-modal-open');
      if (opts.onclose) opts.onclose();
      if (prev && prev.focus) prev.focus();
    }
    document.addEventListener('keydown', key);
    wrap.addEventListener('mousedown', function (e) { if (e.target === wrap) close(); });
    wrap.addEventListener('click', function (e) { if (e.target.closest('[data-close]')) close(); });
    var first = wrap.querySelector('input, textarea, select');
    setTimeout(function () { (first || wrap.querySelector('.ui-modal')).focus && (first || wrap.querySelector('.ui-modal')).focus(); }, 30);
    return { el: wrap.querySelector('.ui-modal'), close: close };
  };
  UI.confirm = function (o) {
    o = typeof o === 'string' ? { title: o } : (o || {});
    return new Promise(function (resolve) {
      var answered = false;
      var m = UI.modal('<h2>' + UI.esc(o.title || 'Are you sure?') + '</h2>' + (o.text ? '<p class="muted">' + UI.esc(o.text) + '</p>' : '') +
        '<div class="ui-row end" style="margin-top:20px"><button class="ui-btn ghost" data-close>' + UI.esc(o.cancel || 'Cancel') + '</button>' +
        '<button class="ui-btn ' + (o.danger ? 'danger solid' : 'primary') + '" data-ok>' + UI.esc(o.ok || 'OK') + '</button></div>',
      { onclose: function () { if (!answered) resolve(false); } });
      m.el.querySelector('[data-ok]').onclick = function () { answered = true; m.close(); resolve(true); };
    });
  };

  /* ------------------------------------------------------------------ theme */
  UI.theme = function () { return UI.store.get('theme', 'auto'); };
  UI.applyTheme = function (t) {
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
    var dark = t === 'dark' || (t !== 'light' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('ui-dark', !!dark);
  };
  UI.setTheme = function (t) { UI.store.set('theme', t); UI.applyTheme(t); };
  UI.applyTheme(UI.theme());
  if (window.matchMedia) {
    try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { UI.applyTheme(UI.theme()); }); } catch (e) {}
  }

  /* ------------------------------------------------------------------ server bridge */
  var bridge = null;
  function send(kind, payload) {
    if (!bridge) return Promise.reject(new Error('The app is still starting.'));
    var out;
    try { out = bridge(kind, JSON.stringify(payload || {})); } catch (e) { return Promise.reject(e); }
    return Promise.resolve(out).then(function (r) {
      r = typeof r === 'string' ? JSON.parse(r) : (r || {});
      if (r.error) {
        var err = new Error(r.error); err.uiApi = true; err.denied = !!r.denied;
        if (r.detail) console.error(kind, payload && payload.fn, r.detail);
        if (r.reload) setTimeout(function () { location.reload(); }, 2500);
        throw err;
      }
      return r.result;
    });
  }
  function apiCall(quiet, fn, args) {
    return send('call', { fn: fn, args: args, quiet: quiet }).then(function (res) {
      if (res && typeof res === 'object' && res.ok === false) {
        var err = new Error(res.error || 'That didn\'t work.'); err.uiApi = true; err.expected = true; err.result = res;
        throw err;
      }
      return res;
    });
  }
  UI.api = function (fn) { return apiCall(false, fn, Array.prototype.slice.call(arguments, 1)); };
  UI.apiQuiet = function (fn) { return apiCall(true, fn, Array.prototype.slice.call(arguments, 1)); };
  /* Errors nobody caught become a toast, so a failed action is never silent. */
  window.addEventListener('unhandledrejection', function (e) {
    if (e.reason && e.reason.uiApi) { e.preventDefault(); UI.toast(e.reason.message, 'error'); }
  });

  /* Sign in / up / out. On success it navigates: to where the visitor was heading (UI.after) or home
     after signing in, to the landing page after signing out. */
  UI.auth = function (kind, payload) {
    return send(kind, payload || {}).then(function (r) {
      if (r && r.ok === false) { var err = new Error(r.error); err.uiApi = true; err.expected = true; throw err; }
      if (r && 'me' in r && (r.me || kind === 'logout')) {
        UI.me = r.me || null;
        var target = r.me ? (UI.after || '#' + UI.config.home) : '#' + UI.config.landing;
        UI.after = null;
        if (location.hash === target) route(); else location.hash = target;
      }
      return r;
    });
  };
  /* Update the signed-in user's details (e.g. a new name) and redraw the header, without reloading the page. */
  UI.setMe = function (me) {
    UI.me = me || null;
    if (shellRoot) renderChrome(current.name);
  };

  /* ------------------------------------------------------------------ pages and routing */
  UI.page = function (name, opts, mount) {
    if (typeof opts === 'function') { mount = opts; opts = {}; }
    opts.name = name; opts.mount = mount;
    UI.pages[name] = opts;
  };
  UI.allowed = function (p) {
    if (!p) return false;
    if (p.auth === 'user') return !!UI.me;
    if (p.auth === 'admin') return !!(UI.me && UI.me.is_admin);
    if (p.auth === 'guest') return !UI.me;
    return true;
  };
  UI.navPages = function () {
    return Object.keys(UI.pages).map(function (k) { return UI.pages[k]; })
      .filter(function (p) { return p.nav && UI.allowed(p) && (!p.when || p.when()); })
      .sort(function (a, b) { return (a.order || 50) - (b.order || 50); });
  };
  UI.parseHash = function () {
    var h = (location.hash || '').replace(/^#!?\/?/, '');
    var parts = h.split('?')[0].split('/').filter(function (x) { return x !== ''; }).map(decodeURIComponent);
    return { name: parts[0] || '', args: parts.slice(1) };
  };
  UI.hashFor = function (name) {
    var args = Array.prototype.slice.call(arguments, 1).filter(function (a) { return a != null && a !== ''; });
    return '#' + [name].concat(args.map(encodeURIComponent)).join('/');
  };
  UI.go = function (name) {
    var h = UI.hashFor.apply(null, arguments);
    if (location.hash === h) route(); else location.hash = h;
  };
  UI.refresh = function () { route(); };
  UI.after = null;  // where to go after signing in

  var shellRoot = null, view = null, current = { name: null, destroy: null }, routeSeq = 0;

  function defaultPage() { return UI.me ? UI.config.home : UI.config.landing; }

  function route() {
    var r = UI.parseHash(), name = r.name || defaultPage(), p = UI.pages[name];
    if (!p) { name = defaultPage(); p = UI.pages[name]; r.args = []; }
    if (p.auth === 'guest' && UI.me) { p = UI.pages[UI.config.home]; name = UI.config.home; r.args = []; }
    if ((p.auth === 'user' || p.auth === 'admin') && !UI.me) {
      UI.after = location.hash && location.hash !== '#' ? location.hash : null;
      p = UI.pages.auth; name = 'auth'; r.args = [];
    }
    if (p.auth === 'admin' && !(UI.me && UI.me.is_admin)) {
      UI.toast('That page is for admins only.', 'error');
      p = UI.pages[UI.config.home]; name = UI.config.home; r.args = [];
    }
    var seq = ++routeSeq;
    window.UI_READY = false;
    if (current.destroy) { try { current.destroy(); } catch (e) { console.error(e); } }
    current = { name: name, args: r.args, destroy: null };
    if (shellRoot) {
      shellRoot.className = 'ui ui-shell page-' + name + (UI.me ? ' signed-in' : ' signed-out') + (p.chrome === false ? ' no-chrome' : '');
      renderChrome(name);
    }
    // A fresh element for every page, so listeners a page adds to `view` never pile up.
    var fresh = view.cloneNode(false);
    view.parentNode.replaceChild(fresh, view);
    view = fresh;
    window.scrollTo(0, 0);
    document.title = (p.title ? (typeof p.title === 'function' ? p.title(r.args) : p.title) + ' · ' : '') + UI.config.name;
    var ctx = { name: name, args: r.args, me: UI.me, go: UI.go, api: UI.api, page: p };
    var out;
    try { out = p.mount(view, ctx); } catch (e) { console.error(e); out = Promise.reject(e); }
    var ready = out && typeof out.then === 'function' ? out : (out && out.ready) || Promise.resolve();
    if (out && out.destroy) current.destroy = out.destroy;
    Promise.resolve(ready).then(function () { if (seq === routeSeq) window.UI_READY = true; },
      function (e) {
        if (seq !== routeSeq) return;
        console.error(e);
        if (!view.innerHTML) view.innerHTML = '<div class="ui-wrap"><div class="ui-empty">' + UI.icon('info') +
          '<h3>This page didn\'t load</h3><p class="muted">' + UI.esc(e && e.message || 'Something went wrong.') + '</p>' +
          '<button class="ui-btn" onclick="UI.refresh()">Try again</button></div></div>';
        window.UI_READY = true;
      });
  }
  UI.current = function () { return current; };

  /* The shell's parts come from web/app.js: UI.shell = {header(me, active), footer(me), tabbar(me, active)} */
  function renderChrome(active) {
    var S = UI.shell || {};
    var hd = shellRoot.querySelector('[data-ui-header]'), ft = shellRoot.querySelector('[data-ui-footer]'), tb = shellRoot.querySelector('[data-ui-tabbar]');
    if (hd) hd.innerHTML = S.header ? S.header(UI.me, active) : '';
    if (ft) ft.innerHTML = S.footer ? S.footer(UI.me, active) : '';
    if (tb) tb.innerHTML = S.tabbar ? S.tabbar(UI.me, active) : '';
  }
  UI.renderChrome = function () { if (shellRoot) renderChrome(current.name); };

  /* Called by client_code/Main.py (and by the local harness) once the page is up. */
  UI.start = function (node, bridgeFn, bootJson) {
    bridge = bridgeFn;
    var boot = typeof bootJson === 'string' ? JSON.parse(bootJson || '{}') : (bootJson || {});
    UI.me = boot.me || null;
    var host = node && node.matches && node.matches('[data-ui-app]') ? node : (node && node.querySelector('[data-ui-app]')) || node || document.body;
    host.innerHTML = '<div class="ui ui-shell">' +
      '<header class="ui-header" data-ui-header></header>' +
      '<main class="ui-main" data-ui-view></main>' +
      '<footer class="ui-footer" data-ui-footer></footer>' +
      '<nav class="ui-tabbar" data-ui-tabbar aria-label="Main"></nav></div>';
    shellRoot = host.firstChild;
    view = host.querySelector('[data-ui-view]');
    if (UI.shell && UI.shell.wire) UI.shell.wire(shellRoot);
    window.addEventListener('hashchange', route);
    route();
  };

  /* ------------------------------------------------------------------ feedback (footer + menu)
     All feedback goes to Prepsto. The widget tag in head.html (data-prepsto="CODE") slides its panel in;
     any [data-feedback] or [data-prepsto-open] element opens it. If the widget hasn't loaded, the panel opens in a new tab.
     There is no in-app feedback form any more: Admin -> Feedback only lists older messages (and app requests). */
  UI.feedback = function () {
    if (window.Prepsto && window.Prepsto.open) { window.Prepsto.open(); return; }
    var tag = document.querySelector('script[data-prepsto]');
    var code = tag && tag.getAttribute('data-prepsto');
    if (code && code.indexOf('__') !== 0) window.open('https://prepsto.com/#f/' + encodeURIComponent(code), '_blank', 'noopener');
    else UI.toast('Feedback is not set up yet.', 'error');
  };

  /* Shared clicks: [data-go="page/arg"], [data-feedback], [data-theme-set] anywhere in the app. */
  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('[data-go],[data-feedback],[data-theme-set]');
    if (!el) return;
    if (el.hasAttribute('data-go')) { e.preventDefault(); UI.go.apply(null, el.getAttribute('data-go').split('/')); }
    else if (el.hasAttribute('data-feedback')) { e.preventDefault(); UI.feedback(el.getAttribute('data-feedback') || null); }
    else if (el.hasAttribute('data-theme-set')) { e.preventDefault(); UI.setTheme(el.getAttribute('data-theme-set')); if (UI.shell && UI.shell.onTheme) UI.shell.onTheme(); }
  });
})();


/* app.js: this app's identity and frame: name, header, footer, phone tab bar.
   Pages live in web/pages/*.html. The engine (window.UI) is web/core.js. */
(function () {
  'use strict';
  UI.configure({
    name: 'Battle Tracker',
    key: 'battletracker',          // prefix for this app's browser storage
    tagline: 'Every feed, one picture. For unclassified exercise and training data.',   // footer line
    home: 'map',                 // first page after signing in
    landing: 'landing'           // first page for visitors who aren't signed in
  });

  var esc = UI.esc;

  function brand() {
    return '<a class="ui-brand" href="#" data-go="' + (UI.me ? UI.config.home : UI.config.landing) + '" aria-label="' + esc(UI.config.name) + ' home">' +
      '<img src="_/theme/icon.svg" alt="" width="32" height="32"><span>' + esc(UI.config.name) + '</span></a>';
  }

  function themeSwitch() {
    var t = UI.theme();
    return '<div class="ui-seg" role="group" aria-label="Appearance">' + [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']].map(function (o) {
      return '<button type="button" data-theme-set="' + o[0] + '" class="' + (t === o[0] ? 'on' : '') + '">' + o[1] + '</button>';
    }).join('') + '</div>';
  }

  function userMenu(me) {
    return '<div class="ui-menu" data-menu hidden>' +
      '<div class="ui-menu-head"><strong>' + esc(me.name) + '</strong><span class="muted small">' + esc(me.email) + '</span></div>' +
      '<a href="#profile" data-go="profile">' + UI.icon('user') + 'Your profile</a>' +
      (me.is_admin ? '<a href="#admin" data-go="admin">' + UI.icon('shield') + 'Admin</a>' : '') +
      '<div class="ui-menu-block"><span class="small muted">Appearance</span>' + themeSwitch() + '</div>' +
      '<button type="button" data-feedback>' + UI.icon('chat') + 'Submit feedback</button>' +
      '<button type="button" data-lk-open="overview">' + UI.icon('lock') + 'Privacy &amp; Terms</button>' +
      '<button type="button" data-signout>' + UI.icon('logout') + 'Sign out</button></div>';
  }

  UI.shell = {
    header: function (me, active) {
      var nav = UI.navPages();
      return '<div class="ui-header-in">' + brand() +
        (me ? '<nav class="ui-nav" aria-label="Main">' + nav.map(function (p) {
          return '<a href="#' + p.name + '" class="' + (p.name === active ? 'on' : '') + '">' + UI.icon(p.icon) + '<span>' + esc(p.nav) + '</span></a>';
        }).join('') + '</nav>' : '') +
        '<div class="ui-header-right">' +
        (me ? '<button type="button" class="ui-avatar-btn" data-menu-toggle aria-label="Your account" aria-haspopup="true">' + esc(UI.initials(me.name)) + '</button>' + userMenu(me)
          : (active === 'auth' ? '' : '<a class="ui-btn ghost" href="#auth" data-go="auth">Sign in</a><a class="ui-btn primary" href="#auth/signup" data-go="auth/signup">Get started</a>')) +
        '</div></div>';
    },
    footer: function (me) {
      return '<div class="ui-footer-in"><div class="ui-footer-brand">' + brand() + '<p class="muted small">' + esc(UI.config.tagline) + '</p></div>' +
        '<div class="ui-footer-links">' +
        '<a href="#landing" data-go="landing">About</a>' +
        '<a href="https://prepsto.com/#f/7wy9y95" target="_blank" rel="noopener" data-prepsto-open>Submit feedback</a>' +
        '<button type="button" data-lk-open="overview">Privacy &amp; Terms</button>' +
        '</div><p class="ui-footer-legal small muted">© ' + new Date().getFullYear() + ' ' + esc(UI.config.name) + '</p></div>';
    },
    tabbar: function (me, active) {
      var nav = UI.navPages();
      if (!me || nav.length < 2) return '';
      return nav.slice(0, 4).map(function (p) {
        return '<a href="#' + p.name + '" class="' + (p.name === active ? 'on' : '') + '">' + UI.icon(p.icon) + '<span>' + esc(p.nav) + '</span></a>';
      }).join('') + '<a href="#profile" class="' + (active === 'profile' ? 'on' : '') + '">' + UI.icon('user') + '<span>You</span></a>';
    },
    wire: function (root) {
      root.addEventListener('click', function (e) {
        var t = e.target.closest('[data-menu-toggle]');
        var menu = root.querySelector('[data-menu]');
        if (t && menu) { menu.hidden = !menu.hidden; t.setAttribute('aria-expanded', String(!menu.hidden)); return; }
        if (e.target.closest('[data-signout]')) { UI.auth('logout').then(function () { UI.toast('Signed out. See you soon!'); }); }
        if (menu && !menu.hidden && !e.target.closest('[data-menu] .ui-seg')) menu.hidden = true;
      });
      document.addEventListener('keydown', function (e) {
        var menu = root.querySelector('[data-menu]');
        if (e.key === 'Escape' && menu) menu.hidden = true;
      });
    },
    onTheme: function () {  // redraw the menu's Auto/Light/Dark buttons and keep the menu open
      var menu = document.querySelector('[data-menu]'), open = menu && !menu.hidden;
      UI.renderChrome();
      if (open) document.querySelector('[data-menu]').hidden = false;
    }
  };
})();


/* ===== _bt.html ===== */
(function () {
  'use strict';
  var BT = window.BT = {};
  /* extra line icons for UI.icon() */
  Object.assign(UI.ICONS, {
    ruler: '<path d="M3 17 17 3l4 4L7 21z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v4h16v-4"/>',
    download: '<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 20h16"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
    radar: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="M12 12 19 5"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
    feed: '<circle cx="5.5" cy="18.5" r="1.5"/><path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/>',
    symbol: '<rect x="3" y="6" width="18" height="12" rx="1"/><path d="M3 6l18 12M21 6 3 18"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M14 9l2 2"/>'
  });

  /* ------------------------------------------------------------------ SIDC (MIL-STD-2525C letter codes, 15 chars) */
  BT.AFFIL = { F: ['Friend', 'friend'], A: ['Assumed friend', 'friend'], D: ['Exercise friend', 'friend'], M: ['Exercise assumed friend', 'friend'],
    H: ['Hostile', 'hostile'], S: ['Suspect', 'hostile'], J: ['Joker', 'hostile'], K: ['Faker', 'hostile'],
    N: ['Neutral', 'neutral'], L: ['Exercise neutral', 'neutral'], U: ['Unknown', 'unknown'], P: ['Pending', 'unknown'],
    W: ['Exercise unknown', 'unknown'], G: ['Exercise pending', 'unknown'], O: ['None', 'unknown'] };
  BT.DIM = { G: 'Ground', A: 'Air', S: 'Sea surface', U: 'Subsurface', P: 'Space', F: 'Special operations' };
  BT.STATUS = { P: 'Present', A: 'Anticipated / planned', C: 'Present, fully capable', D: 'Present, damaged', X: 'Present, destroyed', F: 'Present, full to capacity' };
  BT.ECHELON = { A: 'Team / crew', B: 'Squad', C: 'Section', D: 'Platoon / detachment', E: 'Company / battery / troop', F: 'Battalion / squadron',
    G: 'Regiment / group', H: 'Brigade', I: 'Division', J: 'Corps / MEF', K: 'Army', L: 'Army group / front', M: 'Region / theatre', N: 'Command' };
  BT.MODIFIER = { A: 'Headquarters', B: 'Task force HQ', C: 'Feint / dummy HQ', D: 'Feint / dummy task force HQ', E: 'Task force',
    F: 'Feint / dummy', G: 'Feint / dummy task force', H: 'Installation', M: 'Mobility', N: 'Towed array' };
  // Function IDs per dimension: [code (up to 6), name, group]. Used by the symbol builder and to name decoded symbols.
  BT.FUNCS = {
    G: [['UCI', 'Infantry', 'Combat'], ['UCIZ', 'Infantry, mechanized', 'Combat'], ['UCIM', 'Infantry, motorized', 'Combat'], ['UCIL', 'Infantry, light', 'Combat'],
      ['UCIA', 'Infantry, airborne', 'Combat'], ['UCIS', 'Infantry, air assault', 'Combat'], ['UCIO', 'Infantry, mountain', 'Combat'], ['UCIN', 'Infantry, naval (marine)', 'Combat'],
      ['UCA', 'Armour', 'Combat'], ['UCAT', 'Armour, tracked', 'Combat'], ['UCAW', 'Armour, wheeled', 'Combat'], ['UCR', 'Reconnaissance / cavalry', 'Combat'],
      ['UCRV', 'Reconnaissance, armoured', 'Combat'], ['UCV', 'Aviation', 'Combat'], ['UCVR', 'Aviation, rotary wing', 'Combat'], ['UCE', 'Engineer', 'Combat'],
      ['UCEC', 'Engineer, combat', 'Combat'], ['UCF', 'Field artillery', 'Fires'], ['UCFH', 'Field artillery, howitzer', 'Fires'], ['UCFR', 'Field artillery, rocket', 'Fires'],
      ['UCFM', 'Field artillery, target acquisition', 'Fires'], ['UCM', 'Mortar', 'Fires'], ['UCD', 'Air defence', 'Fires'], ['UCDM', 'Air defence, missile', 'Fires'],
      ['UUA', 'CBRN defence', 'Support'], ['UUM', 'Military intelligence', 'Support'], ['UUS', 'Signal', 'Support'], ['UUL', 'Military police', 'Support'],
      ['UUP', 'Psychological operations', 'Support'], ['USA', 'Administrative / personnel', 'Sustainment'], ['USM', 'Medical', 'Sustainment'],
      ['USS', 'Supply', 'Sustainment'], ['UST', 'Transportation', 'Sustainment'], ['USX', 'Maintenance', 'Sustainment'],
      ['EVAT', 'Tank', 'Equipment'], ['EVAA', 'Armoured personnel carrier', 'Equipment'], ['EVAI', 'Infantry fighting vehicle', 'Equipment'],
      ['EVU', 'Utility vehicle', 'Equipment'], ['EV', 'Ground vehicle', 'Equipment'], ['EWH', 'Howitzer', 'Equipment'], ['EWM', 'Missile launcher', 'Equipment'],
      ['ESR', 'Radar', 'Equipment'], ['IB', 'Base / installation', 'Installation']],
    A: [['MF', 'Fixed wing, military', 'Air'], ['MFF', 'Fighter', 'Air'], ['MFA', 'Attack / strike', 'Air'], ['MFB', 'Bomber', 'Air'], ['MFC', 'Cargo / airlift', 'Air'],
      ['MFK', 'Tanker', 'Air'], ['MFR', 'Reconnaissance', 'Air'], ['MFRW', 'Airborne early warning', 'Air'], ['MFRZ', 'Electronic support (ESM)', 'Air'],
      ['MFP', 'Patrol', 'Air'], ['MFJ', 'Jammer / ECM', 'Air'], ['MFQ', 'Drone (UAV)', 'Air'], ['MFD', 'Airborne command post', 'Air'], ['MFO', 'Medevac', 'Air'],
      ['MH', 'Rotary wing, military', 'Air'], ['MHA', 'Attack helicopter', 'Air'], ['MHU', 'Utility helicopter', 'Air'], ['MHC', 'Cargo helicopter', 'Air'],
      ['CF', 'Civilian fixed wing', 'Civil'], ['CH', 'Civilian rotary wing', 'Civil']],
    S: [['CL', 'Combatant, line', 'Combatant'], ['CLCV', 'Carrier', 'Combatant'], ['CLCC', 'Cruiser', 'Combatant'], ['CLDD', 'Destroyer', 'Combatant'],
      ['CLFF', 'Frigate / corvette', 'Combatant'], ['CA', 'Amphibious warfare ship', 'Combatant'], ['CM', 'Mine warfare vessel', 'Combatant'],
      ['CP', 'Patrol', 'Combatant'], ['N', 'Navy group', 'Combatant'], ['XM', 'Merchant ship', 'Non-combatant'], ['XMC', 'Cargo', 'Non-combatant'],
      ['XMO', 'Oiler / tanker', 'Non-combatant'], ['XMP', 'Passenger', 'Non-combatant'], ['XMTU', 'Tug', 'Non-combatant'], ['XMR', 'Roll-on / roll-off', 'Non-combatant'],
      ['XF', 'Fishing vessel', 'Non-combatant'], ['XR', 'Leisure craft', 'Non-combatant'], ['XL', 'Law enforcement vessel', 'Non-combatant']],
    U: [['S', 'Submarine', 'Subsurface'], ['SN', 'Submarine, nuclear', 'Subsurface'], ['SC', 'Submarine, conventional', 'Subsurface'],
      ['W', 'Underwater weapon', 'Subsurface'], ['WM', 'Sea mine', 'Subsurface']],
    P: [['S', 'Satellite', 'Space'], ['V', 'Crewed space vehicle', 'Space']],
    F: [['A', 'SOF aviation', 'SOF'], ['N', 'SOF naval', 'SOF'], ['G', 'SOF ground', 'SOF'], ['GS', 'Special forces', 'SOF'], ['GR', 'Ranger', 'SOF']]
  };
  BT.sidc = function (aff, dim, func, mod, ech, status) {
    return ('S' + (aff || 'U') + (dim || 'G') + (status || 'P') + ((func || '') + '------').slice(0, 6) + (mod || '-') + (ech || '-') + '---').slice(0, 15);
  };
  BT.isLetterSidc = function (s) { return /^[SGWIOE][A-Z\-]{3}/.test(s || '') && !/^\d+$/.test(s); };
  /* Affiliation class of any SIDC: friend | hostile | neutral | unknown. Number SIDCs (2525D/E, APP-6 D/E): identity is digit 4. */
  BT.affClass = function (s) {
    s = String(s || '').toUpperCase();
    if (/^\d{20,30}$/.test(s)) return ({ '0': 'unknown', '1': 'unknown', '2': 'friend', '3': 'friend', '4': 'neutral', '5': 'hostile', '6': 'hostile' })[s[3]] || 'unknown';
    return (BT.AFFIL[s[1]] || BT.AFFIL.U)[1];
  };
  BT.describe = function (s) {
    s = String(s || '').toUpperCase();
    if (/^\d{20,30}$/.test(s)) {
      return { code: s, scheme: 'MIL-STD-2525D/E / APP-6D (number)', affiliation: ['Pending', 'Unknown', 'Assumed friend', 'Friend', 'Neutral', 'Suspect', 'Hostile'][+s[3]] || 'Unknown',
        dimension: ({ '01': 'Air', '05': 'Space', '10': 'Land unit', '11': 'Land civilian', '15': 'Land equipment', '20': 'Land installation', '30': 'Sea surface', '35': 'Subsurface', '40': 'Activity' })[s.substr(4, 2)] || 'Symbol set ' + s.substr(4, 2) };
    }
    var dim = s[2], fn = s.substr(4, 6).replace(/-+$/, ''), list = BT.FUNCS[dim] || [], name = null, best = -1;
    list.forEach(function (f) { if (fn.indexOf(f[0]) === 0 && f[0].length > best) { best = f[0].length; name = f[1]; } });
    return { code: s, scheme: 'MIL-STD-2525C / APP-6B (letter)', affiliation: (BT.AFFIL[s[1]] || ['Unknown'])[0], dimension: BT.DIM[dim] || 'Other',
      status: BT.STATUS[s[3]] || null, func: name || (fn ? 'Function ' + fn : 'No function'), exact: best === fn.length || !fn,
      modifier: BT.MODIFIER[s[10]] || null, echelon: BT.ECHELON[s[11]] || null, country: /^[A-Z]{2}$/.test(s.substr(12, 2)) ? s.substr(12, 2) : null };
  };

  /* ------------------------------------------------------------------ symbols (milsymbol) */
  var cache = {};
  BT.symbolOk = function () { return !!(window.ms && window.ms.Symbol); };
  BT.symbol = function (sidc, o) {
    o = o || {};
    var key = [sidc, o.size || 28, o.label || '', o.dark ? 1 : 0, o.extra || ''].join('|');
    if (cache[key]) return cache[key];
    var out;
    if (BT.symbolOk()) {
      var opts = { size: o.size || 28, colorMode: o.colorMode || 'Light', outlineWidth: o.outline == null ? 2 : o.outline,
        outlineColor: o.dark ? 'rgba(10,12,14,.85)' : 'rgba(255,255,255,.9)', infoColor: o.dark ? '#ece8e1' : '#13161a', infoSize: 42 };
      if (o.label) opts.uniqueDesignation = String(o.label).slice(0, 24);
      if (o.higher) opts.higherFormation = String(o.higher).slice(0, 24);
      if (o.speed) opts.speed = o.speed;
      if (o.direction != null) opts.direction = o.direction;
      try {
        var y = new window.ms.Symbol(sidc, opts);
        var a = y.getAnchor(), z = y.getSize();
        out = { svg: y.asSVG(), w: Math.ceil(z.width), h: Math.ceil(z.height), ax: a.x, ay: a.y, valid: y.isValid ? y.isValid() : true };
      } catch (e) { out = null; }
    }
    if (!out) {  // library missing: a plain frame in the affiliation colour
      var c = { friend: '#80e0ff', hostile: '#ff8080', neutral: '#aaffaa', unknown: '#ffff80' }[BT.affClass(sidc)];
      var s = o.size || 28;
      out = { svg: '<svg xmlns="http://www.w3.org/2000/svg" width="' + s + '" height="' + s + '"><rect x="3" y="6" width="' + (s - 6) + '" height="' + (s - 12) +
        '" fill="' + c + '" stroke="#000" stroke-width="2"/></svg>', w: s, h: s, ax: s / 2, ay: s / 2, valid: false };
    }
    cache[key] = out;
    return out;
  };
  BT.symbolImg = function (sidc, o) {
    var y = BT.symbol(sidc, o);
    return '<span class="bt-symimg" style="display:inline-block;width:' + y.w + 'px;height:' + y.h + 'px">' + y.svg + '</span>';
  };
  BT.icon = function (sidc, o) {
    var y = BT.symbol(sidc, o);
    return L.divIcon({ className: 'bt-sym' + (o && o.sel ? ' sel' : ''), html: y.svg, iconSize: [y.w, y.h], iconAnchor: [y.ax, y.ay] });
  };

  /* ------------------------------------------------------------------ coordinates */
  var BANDS = 'CDEFGHJKLMNPQRSTUVWXX';
  BT.utm = function (lat, lon) {
    var a = 6378137, f = 1 / 298.257223563, k0 = 0.9996, e2 = f * (2 - f), ep2 = e2 / (1 - e2);
    var zone = Math.floor((lon + 180) / 6) + 1;
    if (lon >= 180) zone = 60;
    if (lat >= 56 && lat < 64 && lon >= 3 && lon < 12) zone = 32;
    if (lat >= 72 && lat < 84) { if (lon >= 0 && lon < 9) zone = 31; else if (lon >= 9 && lon < 21) zone = 33; else if (lon >= 21 && lon < 33) zone = 35; else if (lon >= 33 && lon < 42) zone = 37; }
    var lon0 = (zone - 1) * 6 - 180 + 3, phi = lat * Math.PI / 180, lam = (lon - lon0) * Math.PI / 180;
    var sin = Math.sin(phi), cos = Math.cos(phi), tan = Math.tan(phi);
    var N = a / Math.sqrt(1 - e2 * sin * sin), T = tan * tan, Cc = ep2 * cos * cos, A = cos * lam;
    var M = a * ((1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256) * phi - (3 * e2 / 8 + 3 * e2 * e2 / 32 + 45 * e2 * e2 * e2 / 1024) * Math.sin(2 * phi) +
      (15 * e2 * e2 / 256 + 45 * e2 * e2 * e2 / 1024) * Math.sin(4 * phi) - (35 * e2 * e2 * e2 / 3072) * Math.sin(6 * phi));
    var x = k0 * N * (A + (1 - T + Cc) * Math.pow(A, 3) / 6 + (5 - 18 * T + T * T + 72 * Cc - 58 * ep2) * Math.pow(A, 5) / 120) + 500000;
    var y = k0 * (M + N * tan * (A * A / 2 + (5 - T + 9 * Cc + 4 * Cc * Cc) * Math.pow(A, 4) / 24 + (61 - 58 * T + T * T + 600 * Cc - 330 * ep2) * Math.pow(A, 6) / 720));
    if (lat < 0) y += 10000000;
    return { zone: zone, e: x, n: y };
  };
  /* Military Grid Reference System, e.g. "11S MT 23841 96012". Polar areas (UPS) are not covered. */
  BT.mgrs = function (lat, lon, digits) {
    if (lat == null || lon == null || lat < -80 || lat > 84) return '';
    digits = digits == null ? 5 : digits;
    var u = BT.utm(lat, lon), band = BANDS[Math.floor((lat + 80) / 8)];
    var col = ['ABCDEFGH', 'JKLMNPQR', 'STUVWXYZ'][(u.zone - 1) % 3][Math.floor(u.e / 100000) - 1];
    var row = 'ABCDEFGHJKLMNPQRSTUV'[(Math.floor(u.n / 100000) + (u.zone % 2 === 0 ? 5 : 0)) % 20];
    var pad = function (v) { return ('00000' + Math.floor(v % 100000)).slice(-5).slice(0, digits); };
    return u.zone + band + ' ' + col + row + (digits ? ' ' + pad(u.e) + ' ' + pad(u.n) : '');
  };
  BT.fmtLL = function (lat, lon) {
    return Math.abs(lat).toFixed(5) + '° ' + (lat >= 0 ? 'N' : 'S') + ', ' + Math.abs(lon).toFixed(5) + '° ' + (lon >= 0 ? 'E' : 'W');
  };
  BT.distance = function (a, b) {  // metres, haversine
    var R = 6371008.8, r = Math.PI / 180, dLat = (b[0] - a[0]) * r, dLon = (b[1] - a[1]) * r;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  };
  BT.bearing = function (a, b) {
    var r = Math.PI / 180, y = Math.sin((b[1] - a[1]) * r) * Math.cos(b[0] * r);
    var x = Math.cos(a[0] * r) * Math.sin(b[0] * r) - Math.sin(a[0] * r) * Math.cos(b[0] * r) * Math.cos((b[1] - a[1]) * r);
    return (Math.atan2(y, x) / r + 360) % 360;
  };
  BT.dest = function (p, dist, brg) {
    var R = 6371008.8, r = Math.PI / 180, d = dist / R, t = brg * r, la = p[0] * r, lo = p[1] * r;
    var la2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(t));
    var lo2 = lo + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(la2));
    return [la2 / r, ((lo2 / r + 540) % 360) - 180];
  };
  BT.fmtDist = function (m) { return m >= 10000 ? (m / 1000).toFixed(1) + ' km' : m >= 1000 ? (m / 1000).toFixed(2) + ' km' : Math.round(m) + ' m'; };

  /* ------------------------------------------------------------------ time */
  var MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  /* Date-time group in Zulu: 291432Z OCT 26 */
  BT.dtg = function (iso) {
    if (!iso) return '';
    var d = new Date(iso), p = function (n) { return ('0' + n).slice(-2); };
    if (isNaN(d)) return '';
    return p(d.getUTCDate()) + p(d.getUTCHours()) + p(d.getUTCMinutes()) + 'Z ' + MON[d.getUTCMonth()] + ' ' + String(d.getUTCFullYear()).slice(2);
  };
  BT.zulu = function (ms) { var d = new Date(ms), p = function (n) { return ('0' + n).slice(-2); }; return p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds()) + 'Z'; };

  /* ------------------------------------------------------------------ formats + basemaps */
  BT.FORMATS = { '4607': 'STANAG 4607 GMTI', '4609': 'STANAG 4609 FMV', '4545': 'STANAG 4545 NSIF', '4676': 'STANAG 4676 tracks', nffi: 'STANAG 5527 NFFI',
    cot: 'Cursor on Target', nvg: 'NATO Vector Graphics', kml: 'KML / KMZ', geojson: 'GeoJSON', csv: 'CSV', ais: 'AIS NMEA', manual: 'Manual plot', other: 'Other' };
  BT.fmtShort = function (f) { return ({ '4607': '4607', '4609': '4609', '4545': '4545', '4676': '4676', nffi: 'NFFI', cot: 'CoT', nvg: 'NVG', kml: 'KML', geojson: 'GeoJSON', csv: 'CSV', ais: 'AIS', manual: 'PLOT' })[f] || 'DATA'; };
  /* Base maps: Esri tiles (no key needed; attribution required). CARTO's free tiles started asking for an
     API key in 2026 ("API KEY REQUIRED" watermark), so they aren't used. Gray canvases get a labels layer on top. */
  var ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/';
  var ESRI_ATTR = 'Tiles &copy; <a href="https://www.esri.com">Esri</a>, HERE, Garmin, &copy; OpenStreetMap contributors, and the GIS user community';
  BT.BASEMAPS = {
    forge: { name: 'Forge (dark)', url: ESRI + 'Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', labels: ESRI + 'Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}', native: 16, dark: true, attr: ESRI_ATTR },
    steel: { name: 'Steel (light)', url: ESRI + 'Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', labels: ESRI + 'Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}', native: 16, dark: false, attr: ESRI_ATTR },
    terrain: { name: 'Terrain', url: ESRI + 'World_Topo_Map/MapServer/tile/{z}/{y}/{x}', native: 19, dark: false, attr: ESRI_ATTR },
    imagery: { name: 'Imagery', url: ESRI + 'World_Imagery/MapServer/tile/{z}/{y}/{x}', labels: ESRI + 'Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', native: 19, dark: true,
      attr: 'Imagery &copy; Esri, Maxar, Earthstar Geographics, and the GIS user community' }
  };
  BT.isDark = function () { return document.documentElement.classList.contains('ui-dark'); };
  BT.tiles = function (key) {
    var b = BT.BASEMAPS[key] || BT.BASEMAPS.forge, o = { maxZoom: 19, maxNativeZoom: b.native || 19, crossOrigin: true };
    var g = L.layerGroup([L.tileLayer(b.url, Object.assign({ attribution: b.attr, zIndex: 1 }, o))]);
    if (b.labels) g.addLayer(L.tileLayer(b.labels, Object.assign({ zIndex: 2 }, o)));
    return g;
  };
  BT.defaultBase = function () { return BT.isDark() ? 'forge' : 'steel'; };

  /* ------------------------------------------------------------------ drawing one feature */
  BT.AFF_COLOR = { friend: '#4fb3ff', hostile: '#ff5a4e', neutral: '#5fd17a', unknown: '#f2d64b' };
  /* o: {color (feed colour), dark, labels, size, age (0 new .. 1 old, for MTI dots), renderer (canvas), sel} */
  BT.layerFor = function (f, o) {
    o = o || {};
    var col = f.col || o.color || '#ff7a2f', c = f.c, lyr;
    if (f.g === 'pt') {
      if (f.m) {
        var age = o.age == null ? 0 : o.age;
        lyr = L.circleMarker(c, { radius: 3.4, weight: 1, color: age < .34 ? '#fff3d6' : 'rgba(0,0,0,.5)', fillColor: age < .34 ? '#ff9a3c' : age < .67 ? '#e2470f' : '#7a2a10',
          fillOpacity: 1 - age * .55, renderer: o.renderer });
      } else if (f.s) {
        var p = f.p || {};
        lyr = L.marker(c, { icon: BT.icon(f.s, { size: o.size || 28, label: o.labels ? f.n : '', dark: o.dark, sel: o.sel,
          direction: typeof p.course === 'number' && o.labels ? p.course : null }), keyboard: false, riseOnHover: true });
      } else {
        lyr = L.circleMarker(c, { radius: 5, weight: 2, color: '#0c0e10', fillColor: col, fillOpacity: .95, renderer: o.renderer });
      }
    } else if (f.g === 'ln') {
      var g = ((f.p || {}).graphic || '').toLowerCase();
      lyr = L.polyline(c, { color: col, weight: g.indexOf('boundary') >= 0 ? 2 : 2.6, dashArray: g.indexOf('boundary') >= 0 ? '10 6 2 6' : g.indexOf('estimated') >= 0 || f.e ? '6 6' : null,
        opacity: .95, renderer: o.renderer });
    } else if (f.g === 'pg') {
      lyr = L.polygon(c, { color: col, weight: f.e ? 1.4 : 2, fillColor: col, fillOpacity: f.e ? .16 : .07, dashArray: f.e ? '4 4' : null, renderer: o.renderer });
    } else if (f.g === 'ci') {
      lyr = L.circle(c, { radius: f.r, color: col, weight: 1.8, fillColor: col, fillOpacity: .05, dashArray: '8 6', renderer: o.renderer });
    }
    if (lyr && o.labels && f.n && f.g !== 'pt') lyr.bindTooltip(UI.esc(f.n), { permanent: true, direction: 'center', className: 'bt-lbl', opacity: .95 });
    return lyr;
  };
  /* A small map showing a list of features (upload preview, feed page). Returns {map, fit()}. */
  BT.preview = function (el, features, o) {
    o = o || {};
    var map = L.map(el, { zoomControl: true, attributionControl: true, preferCanvas: true, scrollWheelZoom: false, zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false });
    var gone = false, remove = map.remove.bind(map);
    map.remove = function () { if (gone) return map; gone = true; try { remove(); } catch (e) {} return map; };
    map.setView([33.35, -117.4], 9, { animate: false });  // a view first: layers only join a map that has one
    BT.tiles(BT.defaultBase()).addTo(map);
    var grp = L.featureGroup().addTo(map), dark = BT.isDark(), ren = L.canvas({ padding: .3 });
    var times = features.map(function (f) { return f.t ? Date.parse(f.t) : null; }).filter(function (x) { return x; });
    var t0 = Math.min.apply(null, times.concat([Infinity])), t1 = Math.max.apply(null, times.concat([-Infinity]));
    var tracks = {}, rest = [];  // tracks: a trail + one symbol at the newest report; shapes with an id: the newest only
    features.slice(0, 6000).forEach(function (f) {
      if (f.id && !f.m) (tracks[f.g + '|' + f.id] = tracks[f.g + '|' + f.id] || []).push(f); else rest.push(f);
    });
    Object.keys(tracks).forEach(function (k) {
      var list = tracks[k].slice().sort(function (a, b) { return (a.t || '') < (b.t || '') ? -1 : 1; });
      if (list[0].g === 'pt' && list.length > 1) grp.addLayer(L.polyline(list.map(function (f) { return f.c; }), { color: o.color || '#ff7a2f', weight: 2, dashArray: '2 5', renderer: ren }));
      rest.push(list[list.length - 1]);
    });
    rest.forEach(function (f) {
      var age = f.m && f.t && t1 > t0 ? 1 - (Date.parse(f.t) - t0) / (t1 - t0) : 0;
      var l = BT.layerFor(f, { color: o.color, dark: dark, labels: false, size: 22, age: age, renderer: ren });
      if (l) grp.addLayer(l);
    });
    function fit() { if (gone) return; map.invalidateSize(); var b = grp.getBounds(); if (b.isValid()) map.fitBounds(b.pad(.15), { maxZoom: 13, animate: false }); else map.setView([33.35, -117.4], 9, { animate: false }); }
    setTimeout(fit, 30);
    return { map: map, fit: fit };
  };
})();

/* ===== _formats.html ===== */
(function () {
  'use strict';
  var F = BT.formats = {};
  var MAX_MTI = 6000;
  F.LIST = [
    { id: '4607', name: 'STANAG 4607', what: 'GMTI radar: dwells, moving-target reports, platform', ext: '.4607 .gmti .bin' },
    { id: '4609', name: 'STANAG 4609', what: 'Motion imagery: MPEG-TS with MISB 0601 KLV, or raw .klv', ext: '.ts .mpg .m2ts .klv' },
    { id: '4545', name: 'STANAG 4545', what: 'NSIF / NITF 2.1 imagery: image footprints', ext: '.ntf .nsf .nitf' },
    { id: '4676', name: 'STANAG 4676', what: 'ISR tracking standard (XML tracks and track points)', ext: '.xml' },
    { id: 'nffi', name: 'STANAG 5527', what: 'NFFI friendly force tracks (XML)', ext: '.xml' },
    { id: 'cot', name: 'Cursor on Target', what: 'CoT events from TAK and C2 systems', ext: '.cot .xml' },
    { id: 'nvg', name: 'NVG', what: 'NATO Vector Graphics overlays (APP-6 / 2525)', ext: '.nvg .xml' },
    { id: 'kml', name: 'KML / KMZ', what: 'Placemarks, lines, polygons, gx:Track', ext: '.kml .kmz' },
    { id: 'geojson', name: 'GeoJSON', what: 'Features with a sidc property', ext: '.geojson .json' },
    { id: 'csv', name: 'CSV', what: 'lat, lon, sidc, name, time columns', ext: '.csv .tsv .txt' },
    { id: 'ais', name: 'AIS NMEA', what: '!AIVDM position and static reports', ext: '.nmea .ais .txt' }
  ];

  /* ------------------------------------------------------------------ small helpers */
  function ascii(u8, a, n) {
    var s = '';
    for (var i = a; i < a + n && i < u8.length; i++) s += String.fromCharCode(u8[i]);
    return s.replace(/\0/g, '').trim();
  }
  function sa32(v) { return v * 90 / 2147483648; }
  function ba32(v) { var d = v * 360 / 4294967296; return d > 180 ? d - 360 : d; }
  function ba16(v) { return v * 360 / 65536; }
  function iso(ms) { return new Date(ms).toISOString(); }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : null; }
  function okLL(lat, lon) { return lat != null && lon != null && isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0); }
  function r6(v) { return Math.round(v * 1e6) / 1e6; }
  function pick(list, n) {  // n evenly spaced items, always keeping the last
    if (list.length <= n) return list.slice();
    var out = [], step = (list.length - 1) / (n - 1);
    for (var i = 0; i < n; i++) out.push(list[Math.round(i * step)]);
    return out;
  }
  function sector(sensor, center, halfRange, halfAngle) {
    var d = BT.distance(sensor, center), b = BT.bearing(sensor, center), near = Math.max(500, d - halfRange), far = d + halfRange, pts = [], i;
    for (i = 0; i <= 10; i++) pts.push(BT.dest(sensor, far, b - halfAngle + 2 * halfAngle * i / 10));
    for (i = 0; i <= 10; i++) pts.push(BT.dest(sensor, near, b + halfAngle - 2 * halfAngle * i / 10));
    return pts.map(function (p) { return [r6(p[0]), r6(p[1])]; });
  }
  F.textOf = function (u8) {
    if (u8[0] === 0xEF && u8[1] === 0xBB && u8[2] === 0xBF) u8 = u8.subarray(3);
    if (u8[0] === 0xFF && u8[1] === 0xFE) return new TextDecoder('utf-16le').decode(u8.subarray(2));
    return new TextDecoder('utf-8').decode(u8);
  };

  /* ------------------------------------------------------------------ detection */
  var KLV_KEY = [0x06, 0x0E, 0x2B, 0x34, 0x02, 0x0B, 0x01, 0x01, 0x0E, 0x01, 0x03, 0x01, 0x01, 0x00, 0x00, 0x00];
  function isKey(u8, i) { for (var k = 0; k < 16; k++) if (u8[i + k] !== KLV_KEY[k]) return false; return true; }
  function tsLayout(u8) {
    for (var i = 0; i < Math.min(u8.length, 2000); i++) {
      if (u8[i] === 0x47 && u8[i + 188] === 0x47 && (u8.length < i + 377 || u8[i + 376] === 0x47)) return { start: i, stride: 188, prefix: 0 };
      if (u8[i + 4] === 0x47 && u8[i + 196] === 0x47 && (u8.length < i + 389 || u8[i + 388] === 0x47)) return { start: i, stride: 192, prefix: 4 };
    }
    return null;
  }
  F.detect = function (name, u8) {
    name = (name || '').toLowerCase();
    if (u8.length >= 37 && /^\d\d$/.test(ascii(u8, 0, 2))) {
      var size = (u8[2] << 24 | u8[3] << 16 | u8[4] << 8 | u8[5]) >>> 0;
      if (size >= 37 && size <= u8.length && [1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13, 101, 102].indexOf(u8[32]) >= 0) return '4607';
    }
    if (u8.length >= 376 && tsLayout(u8)) return '4609';
    if (u8.length >= 18 && isKey(u8, 0)) return '4609';
    var head = ascii(u8, 0, 4);
    if (head === 'NITF' || head === 'NSIF') return '4545';
    if (u8[0] === 0x50 && u8[1] === 0x4B && u8[2] === 3 && u8[3] === 4) return 'kmz';
    var t = F.textOf(u8.subarray(0, 8192)), s = t.replace(/^\s+/, '');
    if (/^[\[{]/.test(s)) return 'geojson';
    if (/<nvg[\s>]/i.test(t)) return 'nvg';
    if (/<kml[\s>]/i.test(t)) return 'kml';
    if (/<event[\s>]/.test(t) && /<point[\s/>]/.test(t)) return 'cot';
    if (/NFFI|trackSource|positionalData/i.test(t)) return 'nffi';
    if (/TrackMessage|STANAG.?4676|<([\w]+:)?Track[\s>]|TrackPoint/.test(t)) return '4676';
    if (/!(AI|AB|BS)VD[MO],/.test(t)) return 'ais';
    var first = s.split(/\r?\n/)[0] || '';
    if (/(^|[,;\t"])\s*(lat|latitude|y)\s*["]?\s*([,;\t]|$)/i.test(first)) return 'csv';
    if (/\.(csv|tsv)$/.test(name)) return 'csv';
    return null;
  };

  /* ================================================================== STANAG 4607 */
  var CLS = { 1: 'TOP SECRET', 2: 'SECRET', 3: 'CONFIDENTIAL', 4: 'RESTRICTED', 5: 'UNCLASSIFIED' };
  var EXI = { 0: 'Operation, real', 1: 'Operation, simulated', 2: 'Operation, synthesized', 128: 'Exercise, real', 129: 'Exercise, simulated', 130: 'Exercise, synthesized' };
  var TGT = ['No information', 'Tracked vehicle', 'Wheeled vehicle', 'Rotary wing aircraft', 'Fixed wing aircraft', 'Stationary rotator', 'Maritime',
    'Beacon', 'Amphibious', 'Person', 'Vehicle', 'Animal', 'Large multiple-return, land', 'Large multiple-return, maritime'];
  function tgtClass(v) {
    if (v == null) return null;
    var sim = v >= 128, b = v & 127;
    return (b === 126 ? 'Other' : b === 127 ? 'Unknown' : TGT[b] || 'Class ' + b) + (sim ? ', simulated' : ', live');
  }
  var PLATFORM_TYPES = { 0: 'Unidentified', 1: 'ACS', 2: 'ARL-M', 3: 'Sentinel (ASTOR)', 4: 'Global Hawk-Sensor', 5: 'Global Hawk-Ground', 6: 'Joint STARS', 7: 'LSRS',
    8: 'Predator', 9: 'Radarsat2', 10: 'TUAV', 11: 'Hunter', 12: 'P-3C', 13: 'Shadow', 14: 'Fire Scout', 15: 'Global Hawk-NATO', 255: 'Other' };

  function p4607(u8) {
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), off = 0, feats = [], warn = [], mti = [];
    var S = { packets: 0, dwells: 0, targets: 0, platforms: [], segments: {} }, worst = 9, refDate = null, noDate = false, lastPlat = null;
    while (off + 32 <= u8.length) {
      var ver = ascii(u8, off, 2), psize = dv.getUint32(off + 2);
      if (!/^\d\d$/.test(ver) || psize < 32 || off + psize > u8.length) { warn.push('Stopped at byte ' + off + ': no valid packet header there.'); break; }
      var cls = u8[off + 8], exi = u8[off + 13], pid = ascii(u8, off + 14, 10) || 'PLATFORM';
      S.packets++;
      if (S.packets === 1) { S.version = ver[0] + '.' + ver[1]; S.nationality = ascii(u8, off + 6, 2); S.mission = dv.getUint32(off + 24); S.job = dv.getUint32(off + 28); S.exercise = EXI[exi] || 'Indicator ' + exi; }
      if (cls >= 1 && cls < worst) worst = cls;
      if (S.platforms.indexOf(pid) < 0) S.platforms.push(pid);
      var so = off + 32, end = off + psize;
      while (so + 5 <= end) {
        var st = u8[so], ss = dv.getUint32(so + 1);
        if (ss < 5 || so + ss > end) { warn.push('Bad segment size at byte ' + so + '.'); break; }
        S.segments[st] = (S.segments[st] || 0) + 1;
        var b = so + 5;
        try {
          if (st === 1 && ss >= 44) {
            S.mission_plan = ascii(u8, b, 12); S.flight_plan = ascii(u8, b + 12, 12);
            S.platform_type = PLATFORM_TYPES[u8[b + 24]] || 'Type ' + u8[b + 24]; S.platform_config = ascii(u8, b + 25, 10);
            refDate = Date.UTC(dv.getUint16(b + 35), u8[b + 37] - 1, u8[b + 38]);
            S.reference_date = new Date(refDate).toISOString().slice(0, 10);
          } else if (st === 2) {
            dwell(b, pid);
          } else if (st === 13 && ss >= 28) {
            var t = dv.getUint32(b), lat = sa32(dv.getInt32(b + 4)), lon = ba32(dv.getUint32(b + 8));
            if (okLL(lat, lon)) feats.push(platPt(pid, lat, lon, dateOf(t), dv.getInt32(b + 12) / 100, ba16(dv.getUint16(b + 16)), dv.getUint32(b + 18) / 1000));
          } else if (st === 6 && ss > 25) {
            S.free_text = ascii(u8, b + 20, Math.min(ss - 25, 280));
          }
        } catch (e) { warn.push('Segment type ' + st + ' at byte ' + so + ' is cut short.'); }
        so += ss;
      }
      off += psize;
    }
    function dateOf(ms) {
      if (refDate == null) { noDate = true; var d = new Date(); refDate = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); }
      return iso(refDate + ms);
    }
    function platPt(pid, lat, lon, t, alt, track, speed) {
      var p = { alt_m: Math.round(alt) };
      if (track != null) p.course = Math.round(track);
      if (speed != null) p.speed_ms = Math.round(speed * 10) / 10;
      lastPlat = [lat, lon];
      return { g: 'pt', c: [r6(lat), r6(lon)], s: 'SFAPMFR--------', n: pid, id: pid, t: t, p: p };
    }
    function dwell(b, pid) {
      var hi = dv.getUint32(b), lo = dv.getUint32(b + 4);
      var has = function (bit) { return bit >= 32 ? (hi >>> (bit - 32)) & 1 : (lo >>> bit) & 1; };
      var p = b + 8;
      var rev = dv.getUint16(p); p += 2;
      var di = dv.getUint16(p); p += 2;
      p += 1;                                   // D4 last dwell of revisit
      var n = dv.getUint16(p); p += 2;
      var tms = dv.getUint32(p); p += 4;
      var slat = sa32(dv.getInt32(p)); p += 4;
      var slon = ba32(dv.getUint32(p)); p += 4;
      var salt = dv.getInt32(p) / 100; p += 4;
      var latScale = null, lonScale = null, strack = null, sspeed = null, mdv = null;
      if (has(55)) { latScale = sa32(dv.getInt32(p)); p += 4; }
      if (has(54)) { lonScale = ba32(dv.getUint32(p)); if (lonScale < 0) lonScale += 360; p += 4; }
      if (has(53)) p += 4; if (has(52)) p += 4; if (has(51)) p += 2;
      if (has(50)) { strack = ba16(dv.getUint16(p)); p += 2; }
      if (has(49)) { sspeed = dv.getUint32(p) / 1000; p += 4; }
      if (has(48)) p += 1; if (has(47)) p += 1; if (has(46)) p += 2; if (has(45)) p += 2;
      if (has(44)) p += 2; if (has(43)) p += 2; if (has(42)) p += 2;
      var clat = sa32(dv.getInt32(p)); p += 4;
      var clon = ba32(dv.getUint32(p)); p += 4;
      var rhe = dv.getUint16(p) / 128; p += 2;   // B16 km
      var ahe = ba16(dv.getUint16(p)); p += 2;
      if (has(37)) p += 2; if (has(36)) p += 2; if (has(35)) p += 2;
      if (has(34)) { mdv = u8[p] / 10; p += 1; }
      var t = dateOf(tms);
      S.dwells++;
      if (okLL(slat, slon)) feats.push(platPt(pid, slat, slon, t, salt, strack, sspeed));
      if (okLL(clat, clon) && okLL(slat, slon) && rhe > 0) {
        feats.push({ g: 'pg', c: sector([slat, slon], [clat, clon], rhe * 1000, Math.max(.2, ahe)), n: 'Dwell ' + di + ' (revisit ' + rev + ')', id: pid + '/dwell',
          t: t, e: 1, col: '#ff7a2f', p: { revisit: rev, dwell: di, targets: n, range_half_km: Math.round(rhe * 10) / 10, angle_half_deg: Math.round(ahe * 100) / 100, mdv_ms: mdv } });
      }
      var tb = function (i) { return has(34 - i); };
      for (var k = 0; k < n; k++) {
        if (p > u8.length) throw new Error('short');
        var lat = null, lon = null, dlat = null, dlon = null, h = null, vlos = null, snr = null, cl = null, prob = null, rcs = null;
        if (tb(1)) p += 2;
        if (tb(2)) { lat = sa32(dv.getInt32(p)); p += 4; }
        if (tb(3)) { lon = ba32(dv.getUint32(p)); p += 4; }
        if (tb(4)) { dlat = dv.getInt16(p); p += 2; }
        if (tb(5)) { dlon = dv.getInt16(p); p += 2; }
        if (tb(6)) { h = dv.getInt16(p); p += 2; }
        if (tb(7)) { vlos = dv.getInt16(p) / 100; p += 2; }
        if (tb(8)) p += 2;
        if (tb(9)) { snr = dv.getInt8(p); p += 1; }
        if (tb(10)) { cl = u8[p]; p += 1; }
        if (tb(11)) { prob = u8[p]; p += 1; }
        if (tb(12)) p += 2; if (tb(13)) p += 2; if (tb(14)) p += 1; if (tb(15)) p += 2; if (tb(16)) p += 1; if (tb(17)) p += 4;
        if (tb(18)) { rcs = dv.getInt8(p) / 4; p += 1; }
        if (lat == null && dlat != null && latScale != null) lat = clat + dlat * latScale;
        if (lon == null && dlon != null && lonScale != null) { lon = clon + dlon * lonScale; if (lon > 180) lon -= 360; }
        if (!okLL(lat, lon)) continue;
        var pr = {};
        if (vlos != null) pr.los_ms = vlos;
        if (snr != null) pr.snr_db = snr;
        if (cl != null) pr['class'] = tgtClass(cl);
        if (prob != null) pr.class_prob = prob + '%';
        if (h != null) pr.height_m = h;
        if (rcs != null) pr.rcs_dbsm = rcs;
        mti.push({ g: 'pt', c: [r6(lat), r6(lon)], m: 1, e: 1, t: t, p: pr });
        S.targets++;
      }
    }
    if (mti.length > MAX_MTI) {
      mti.sort(function (a, b) { return a.t < b.t ? -1 : 1; });
      warn.push(mti.length + ' moving-target reports: kept the newest ' + MAX_MTI + '.');
      mti = mti.slice(-MAX_MTI);
    }
    if (noDate) warn.push('No mission segment, so dwell times are counted from today (UTC).');
    if (!S.packets) throw new Error('This isn\'t a STANAG 4607 file (no packet header).');
    S.classification = CLS[worst] || 'UNCLASSIFIED';
    S.platform = S.platforms.join(', ');
    delete S.platforms;
    var segs = S.segments, names = { 1: 'mission', 2: 'dwell', 3: 'HRR', 5: 'job definition', 6: 'free text', 13: 'platform location', 10: 'test & status' };
    S.segments = Object.keys(segs).map(function (k) { return segs[k] + ' ' + (names[k] || 'type ' + k); }).join(', ');
    return { features: feats.concat(mti), summary: S, warnings: warn,
      blocked: worst < 5 ? 'This file is marked ' + CLS[worst] + '. Battle Tracker only accepts unclassified data.' : null };
  }

  /* ================================================================== STANAG 4609: MPEG-TS + KLV (MISB ST 0601) */
  function berLen(u8, i) {
    var b = u8[i];
    if (b < 0x80) return [b, 1];
    var n = b & 0x7f, v = 0;
    if (n > 4) return [-1, 1];
    for (var k = 1; k <= n; k++) v = v * 256 + u8[i + k];
    return [v, n + 1];
  }
  function uint(u8, i, n) { var v = 0; for (var k = 0; k < n; k++) v = v * 256 + u8[i + k]; return v; }
  function sint(u8, i, n) { var v = uint(u8, i, n), m = Math.pow(2, 8 * n); return v >= m / 2 ? v - m : v; }
  function str(u8, i, n) { return new TextDecoder('utf-8').decode(u8.subarray(i, i + n)).replace(/\0/g, '').trim(); }
  // MISB ST 0601 mappings (integer -> value). Error indicators (most negative int) -> null.
  function mapInt(u8, i, n, range) { var v = sint(u8, i, n); if (v === -Math.pow(2, 8 * n - 1)) return null; return v * range / (Math.pow(2, 8 * n - 1) - 1); }
  function mapU(u8, i, n, lo, hi) { return lo + uint(u8, i, n) * (hi - lo) / (Math.pow(2, 8 * n) - 1); }
  function readLS(u8, start, len) {
    var o = {}, i = start, end = start + len;
    while (i < end) {
      var tag = 0, b;
      do { b = u8[i++]; tag = tag * 128 + (b & 0x7f); } while (b & 0x80 && i < end);
      var L = berLen(u8, i); i += L[1];
      if (L[0] < 0 || i + L[0] > end) break;
      var v = i, n = L[0];
      switch (tag) {
        case 1: o.checksum = uint(u8, v, 2); o.checksumAt = v; break;
        case 2: o.time = uint(u8, v, n) / 1000; break;  // microseconds -> ms
        case 3: o.mission = str(u8, v, n); break;
        case 4: o.tail = str(u8, v, n); break;
        case 5: o.heading = mapU(u8, v, 2, 0, 360); break;
        case 6: o.pitch = mapInt(u8, v, 2, 20); break;
        case 7: o.roll = mapInt(u8, v, 2, 50); break;
        case 10: o.designation = str(u8, v, n); break;
        case 11: o.sensor = str(u8, v, n); break;
        case 13: o.lat = mapInt(u8, v, 4, 90); break;
        case 14: o.lon = mapInt(u8, v, 4, 180); break;
        case 15: o.alt = mapU(u8, v, 2, -900, 19000); break;
        case 16: o.hfov = mapU(u8, v, 2, 0, 180); break;
        case 17: o.vfov = mapU(u8, v, 2, 0, 180); break;
        case 18: o.az = mapU(u8, v, 4, 0, 360); break;
        case 21: o.slant = mapU(u8, v, 4, 0, 5000000); break;
        case 23: o.fcLat = mapInt(u8, v, 4, 90); break;
        case 24: o.fcLon = mapInt(u8, v, 4, 180); break;
        case 25: o.fcAlt = mapU(u8, v, 2, -900, 19000); break;
        case 26: case 27: case 28: case 29: case 30: case 31: case 32: case 33:
          (o.offs = o.offs || {})[tag] = mapInt(u8, v, 2, 0.075); break;
        case 56: o.speed = uint(u8, v, 1); break;
        case 59: o.callsign = str(u8, v, n); break;
        case 65: o.version = uint(u8, v, n); break;
        case 82: case 83: case 84: case 85: case 86: case 87: case 88: case 89:
          (o.corners = o.corners || {})[tag] = mapInt(u8, v, 4, tag % 2 === 0 ? 90 : 180); break;
      }
      i = v + n;
    }
    return o;
  }
  function checksum(u8, from, to) {
    var s = 0;
    for (var i = from; i < to; i++) s = (s + (u8[i] << (8 * ((i - from + 1) % 2)))) & 0xffff;
    return s;
  }
  function scanKLV(u8, out, pts) {
    for (var i = 0; i + 17 < u8.length; i++) {
      if (u8[i] !== 0x06 || !isKey(u8, i)) continue;
      var L = berLen(u8, i + 16), start = i + 16 + L[1];
      if (L[0] <= 0 || start + L[0] > u8.length) continue;
      var rec = readLS(u8, start, L[0]);
      if (rec.checksumAt != null) rec.bad = checksum(u8, i, rec.checksumAt) !== rec.checksum;
      if (rec.time == null && pts != null) rec.pts = pts;
      out.push(rec);
      i = start + L[0] - 1;
    }
  }
  /* Streaming demuxer: push() chunks, then finish(). Collects KLV records from metadata streams. */
  function TS() { this.carry = null; this.lay = null; this.pmt = {}; this.streams = {}; this.pes = {}; this.records = []; this.packets = 0; this.resyncs = 0; }
  TS.prototype.push = function (chunk) {
    var u8 = chunk;
    if (this.carry && this.carry.length) { u8 = new Uint8Array(this.carry.length + chunk.length); u8.set(this.carry); u8.set(chunk, this.carry.length); }
    if (!this.lay) { this.lay = tsLayout(u8); if (!this.lay) { this.carry = u8.length < 4096 ? u8 : null; return; } u8 = u8.subarray(this.lay.start); }
    var st = this.lay.stride, pre = this.lay.prefix, pos = 0;
    while (pos + st <= u8.length) {
      if (u8[pos + pre] !== 0x47) { this.resyncs++; pos++; continue; }
      this.packet(u8.subarray(pos + pre, pos + pre + 188));
      pos += st;
    }
    this.carry = u8.slice(pos);
  };
  TS.prototype.packet = function (p) {
    this.packets++;
    var pusi = p[1] & 0x40, pid = ((p[1] & 0x1f) << 8) | p[2], afc = (p[3] >> 4) & 3, i = 4;
    if (afc & 2) i += 1 + p[4];
    if (!(afc & 1) || i >= 188) return;
    var pay = p.subarray(i);
    if (pid === 0 && pusi) {
      var sec = pay.subarray(1 + pay[0]), sl = ((sec[1] & 0x0f) << 8) | sec[2];
      for (var j = 8; j + 4 <= 3 + sl - 4; j += 4) { var prog = (sec[j] << 8) | sec[j + 1]; if (prog) this.pmt[((sec[j + 2] & 0x1f) << 8) | sec[j + 3]] = 1; }
      return;
    }
    if (this.pmt[pid]) {
      if (!pusi) return;
      var s = pay.subarray(1 + pay[0]);
      if (s[0] !== 2) return;
      var len = ((s[1] & 0x0f) << 8) | s[2], pil = ((s[10] & 0x0f) << 8) | s[11], k = 12 + pil;
      while (k + 5 <= 3 + len - 4) {
        var type = s[k], epid = ((s[k + 1] & 0x1f) << 8) | s[k + 2], eil = ((s[k + 3] & 0x0f) << 8) | s[k + 4];
        var desc = ascii(s, k + 5, eil);
        this.streams[epid] = { type: type, klv: type === 0x15 || (type === 0x06 && desc.indexOf('KLVA') >= 0) || desc.indexOf('KLVA') >= 0,
          video: [0x01, 0x02, 0x10, 0x1B, 0x24].indexOf(type) >= 0 };
        k += 5 + eil;
      }
      return;
    }
    var info = this.streams[pid];
    if (info && info.video) return;
    var buf = this.pes[pid];
    if (pusi) { if (buf) this.flush(pid); buf = this.pes[pid] = []; buf.size = 0; }
    if (!buf || buf.size > 2097152) return;
    buf.push(pay.slice()); buf.size += pay.length;
  };
  TS.prototype.flush = function (pid) {
    var parts = this.pes[pid];
    delete this.pes[pid];
    if (!parts || !parts.size) return;
    var u8 = new Uint8Array(parts.size), o = 0;
    parts.forEach(function (p) { u8.set(p, o); o += p.length; });
    var pts = null, body = u8;
    if (u8[0] === 0 && u8[1] === 0 && u8[2] === 1) {
      var sid = u8[3];
      if ([0xBC, 0xBE, 0xBF, 0xF0, 0xF1, 0xFF, 0xF2, 0xF8].indexOf(sid) >= 0) body = u8.subarray(6);
      else {
        if (u8[7] & 0x80) pts = ((u8[9] & 0x0e) * 536870912) + (u8[10] << 22 | (u8[11] & 0xfe) << 14 | u8[12] << 7 | u8[13] >> 1);
        body = u8.subarray(9 + u8[8]);
      }
    }
    scanKLV(body, this.records, pts);
  };
  TS.prototype.finish = function () { var self = this; Object.keys(this.pes).forEach(function (pid) { self.flush(+pid); }); };

  function klvResult(recs, extra) {
    var warn = [], feats = [], S = extra || {};
    recs = recs.filter(function (r) { return okLL(r.lat, r.lon) || okLL(r.fcLat, r.fcLon); });
    if (!recs.length) throw new Error('No MISB ST 0601 KLV metadata with positions was found in this file.');
    var bad = recs.filter(function (r) { return r.bad; }).length;
    var withPts = recs.filter(function (r) { return r.time == null; });
    if (withPts.length) {
      var p0 = withPts[0].pts, now = Date.now();
      var span = withPts.length > 1 && withPts[withPts.length - 1].pts != null && p0 != null ? (withPts[withPts.length - 1].pts - p0) / 90 : 0;
      withPts.forEach(function (r, i) { r.time = r.pts != null && p0 != null ? now - span + (r.pts - p0) / 90 : now - (withPts.length - i) * 1000; });
      warn.push('Some KLV packets have no Precision Time Stamp (tag 2): their times come from the video clock, counted back from now.');
    }
    recs.sort(function (a, b) { return a.time - b.time; });
    var r0 = recs[0], rl = recs[recs.length - 1];
    var id = rl.callsign || rl.tail || rl.designation || r0.mission || 'UAS';
    var plat = recs.filter(function (r) { return okLL(r.lat, r.lon); });
    pick(plat, 300).forEach(function (r) {
      var p = {};
      if (r.alt != null) p.alt_m = Math.round(r.alt);
      if (r.heading != null) p.heading = Math.round(r.heading);
      if (r.az != null) p.sensor_az = Math.round(((r.az + (r.heading || 0)) % 360));
      if (r.hfov != null) p.hfov = Math.round(r.hfov * 100) / 100;
      if (r.slant != null) p.slant_m = Math.round(r.slant);
      if (r.speed != null) p.ground_speed_ms = r.speed;
      if (r.sensor) p.sensor = r.sensor;
      feats.push({ g: 'pt', c: [r6(r.lat), r6(r.lon)], s: 'SFAPMFQ--------', n: id, id: id, t: iso(r.time), p: p });
    });
    var fps = recs.map(function (r) {
      var c = null;
      if (r.corners && [82, 83, 84, 85, 86, 87, 88, 89].every(function (k) { return r.corners[k] != null; })) {
        c = [[r.corners[82], r.corners[83]], [r.corners[84], r.corners[85]], [r.corners[86], r.corners[87]], [r.corners[88], r.corners[89]]];
      } else if (r.offs && okLL(r.fcLat, r.fcLon) && [26, 27, 28, 29, 30, 31, 32, 33].every(function (k) { return r.offs[k] != null; })) {
        c = [[r.fcLat + r.offs[26], r.fcLon + r.offs[27]], [r.fcLat + r.offs[28], r.fcLon + r.offs[29]], [r.fcLat + r.offs[30], r.fcLon + r.offs[31]], [r.fcLat + r.offs[32], r.fcLon + r.offs[33]]];
      }
      return c && c.every(function (q) { return okLL(q[0], q[1]); }) ? { r: r, c: c } : null;
    }).filter(Boolean);
    pick(fps, 80).forEach(function (x) {
      var p = {};
      if (okLL(x.r.fcLat, x.r.fcLon)) p.frame_centre = BT.mgrs(x.r.fcLat, x.r.fcLon);
      if (x.r.hfov != null) p.hfov = Math.round(x.r.hfov * 100) / 100;
      if (x.r.vfov != null) p.vfov = Math.round(x.r.vfov * 100) / 100;
      feats.push({ g: 'pg', c: x.c.map(function (q) { return [r6(q[0]), r6(q[1])]; }), n: id + ' footprint', id: id + '/fp', t: iso(x.r.time), e: 1, col: '#f2b646', p: p });
    });
    var centre = pick(recs.filter(function (r) { return okLL(r.fcLat, r.fcLon); }), 400).map(function (r) { return [r6(r.fcLat), r6(r.fcLon)]; });
    if (centre.length >= 2) feats.push({ g: 'ln', c: centre, n: id + ' frame centre', t: iso(rl.time), e: 1, col: '#f2b646', p: { graphic: 'Sensor frame-centre track' } });
    if (!fps.length) warn.push('No sensor corner points (tags 26-33 or 82-89), so no footprints.');
    if (bad) warn.push(bad + ' of ' + recs.length + ' KLV packets failed their checksum (kept anyway).');
    S.klv_packets = recs.length;
    S.duration_s = Math.round((rl.time - r0.time) / 1000);
    S.platform = rl.designation || r0.designation || '';
    S.callsign = rl.callsign || rl.tail || '';
    S.mission = r0.mission || '';
    S.sensor = rl.sensor || r0.sensor || '';
    S.uas_ls_version = rl.version != null ? rl.version : '';
    S.checksum_errors = bad;
    S.start = iso(r0.time); S.end = iso(rl.time);
    return { features: feats, summary: S, warnings: warn };
  }
  var STREAM_NAMES = { 0x01: 'MPEG-1', 0x02: 'MPEG-2', 0x10: 'MPEG-4 Part 2', 0x1B: 'H.264', 0x24: 'H.265 / HEVC', 0x15: 'KLV (synchronous)', 0x06: 'private data' };
  async function p4609(u8, file) {
    var lay = tsLayout(u8);
    if (!lay) {  // a raw KLV stream
      var recs = []; scanKLV(u8, recs, null);
      return klvResult(recs, { container: 'Raw KLV' });
    }
    var ts = new TS();
    if (file && file.size > u8.length) {  // large file: stream it in 8 MB slices
      for (var o = 0; o < file.size; o += 8388608) ts.push(new Uint8Array(await file.slice(o, o + 8388608).arrayBuffer()));
    } else ts.push(u8);
    ts.finish();
    var vids = Object.keys(ts.streams).filter(function (k) { return ts.streams[k].video; }).map(function (k) { return STREAM_NAMES[ts.streams[k].type]; });
    var klvPids = Object.keys(ts.streams).filter(function (k) { return ts.streams[k].klv; });
    var res = klvResult(ts.records, { container: 'MPEG-2 TS (' + lay.stride + '-byte packets)', ts_packets: ts.packets, video: vids.join(', ') || 'none in this file',
      klv_pid: klvPids.map(function (p) { return '0x' + (+p).toString(16); }).join(', ') || 'found by scanning' });
    if (ts.resyncs) res.warnings.push('Lost TS sync ' + ts.resyncs + ' times (damaged packets were skipped).');
    return res;
  }

  /* ================================================================== STANAG 4545 (NSIF / NITF 2.1) */
  function p4545(u8) {
    var at = function (a, n) { return ascii(u8, a, n); };
    var fhdr = at(0, 4), fver = at(4, 5), warn = [], feats = [];
    if (fver !== '02.10' && fver !== '01.01' && fver !== '02.00') warn.push('Version ' + fver + ': read as NITF 2.1 / NSIF 1.0.');
    var fsclas = at(119, 1), hl = parseInt(at(354, 6), 10), numi = parseInt(at(360, 3), 10) || 0;
    var S = { version: fhdr + fver, title: at(39, 80), originator: at(15, 10), date: at(25, 14), classification: { U: 'UNCLASSIFIED', R: 'RESTRICTED', C: 'CONFIDENTIAL', S: 'SECRET', T: 'TOP SECRET' }[fsclas] || fsclas, images: numi };
    var off = hl, dt = function (s) { var m = /^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)$/.exec(s); return m ? m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':' + m[6] + 'Z' : null; };
    for (var i = 0; i < numi; i++) {
      var lish = parseInt(at(363 + i * 16, 6), 10), li = parseInt(at(369 + i * 16, 10), 10);
      if (!(lish > 0) || off + 372 > u8.length) { warn.push('Image ' + (i + 1) + ' subheader is missing.'); break; }
      var b = off;
      if (at(b, 2) !== 'IM') { warn.push('Image ' + (i + 1) + ' subheader doesn\'t start with IM.'); break; }
      var iid1 = at(b + 2, 10), idatim = at(b + 12, 14), tgtid = at(b + 26, 17), iid2 = at(b + 43, 80), isclas = at(b + 123, 1);
      var isorce = at(b + 291, 42), nrows = parseInt(at(b + 333, 8), 10), ncols = parseInt(at(b + 341, 8), 10), icat = at(b + 360, 8), icords = at(b + 371, 1);
      if (isclas && isclas !== 'U') S.classification = 'CLASSIFIED (' + isclas + ')';
      var corners = null;
      if (icords && icords !== ' ' && (icords === 'G' || icords === 'D')) {
        var g = at(b + 372, 60);
        corners = [0, 1, 2, 3].map(function (k) {
          var s = g.substr(k * 15, 15);
          if (icords === 'D') return [num(s.substr(0, 7)), num(s.substr(7, 8))];
          var lat = (+s.substr(0, 2) + s.substr(2, 2) / 60 + s.substr(4, 2) / 3600) * (s[6] === 'S' ? -1 : 1);
          var lon = (+s.substr(7, 3) + s.substr(10, 2) / 60 + s.substr(12, 2) / 3600) * (s[14] === 'W' ? -1 : 1);
          return [lat, lon];
        });
        if (!corners.every(function (c) { return okLL(c[0], c[1]); })) corners = null;
      } else if (icords === 'U' || icords === 'N' || icords === 'S') warn.push('Image ' + (i + 1) + ' uses ' + (icords === 'U' ? 'MGRS' : 'UTM') + ' corners, which this first version doesn\'t read yet.');
      if (corners) feats.push({ g: 'pg', c: corners.map(function (c) { return [r6(c[0]), r6(c[1])]; }), n: (iid2 || iid1 || 'Image ' + (i + 1)).slice(0, 80), t: dt(idatim) || dt(S.date),
        col: '#b38cff', p: { iid1: iid1, icat: icat, nrows: nrows, ncols: ncols, isorce: isorce, tgtid: tgtid, icords: icords } });
      off += lish + li;
    }
    if (!feats.length) warn.push('No image had geographic corner coordinates (ICORDS G or D).');
    var bl = S.classification !== 'UNCLASSIFIED' ? 'This file is marked ' + S.classification + '. Battle Tracker only accepts unclassified data.' : null;
    S.date = dt(S.date) || S.date;
    return { features: feats, summary: S, warnings: warn, blocked: bl };
  }

  /* ================================================================== XML formats */
  function xml(text) {
    var doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) {
      // TAK exports are often several <event> roots in one file: wrap them.
      var wrapped = new DOMParser().parseFromString('<root>' + text.replace(/<\?xml[^>]*\?>/g, '') + '</root>', 'application/xml');
      if (wrapped.getElementsByTagName('parsererror').length) throw new Error('This XML doesn\'t parse: ' + (doc.getElementsByTagName('parsererror')[0].textContent || '').slice(0, 160));
      return wrapped;
    }
    return doc;
  }
  function els(node, name) { return Array.prototype.slice.call(node.getElementsByTagNameNS('*', name)); }
  function kids(node, name) { return Array.prototype.filter.call(node.children || [], function (c) { return !name || c.localName === name; }); }
  function firstText(node, names) {
    var lower = names.map(function (n) { return n.toLowerCase(); });
    var all = node.getElementsByTagName('*');
    for (var i = 0; i < all.length; i++) if (lower.indexOf(all[i].localName.toLowerCase()) >= 0) { var t = (all[i].textContent || '').trim(); if (t) return t; }
    return null;
  }
  var AFF_FROM_COT = { f: 'F', h: 'H', n: 'N', u: 'U', p: 'P', a: 'A', s: 'S', j: 'J', k: 'K', o: 'U', x: 'U' };
  F.cotToSidc = function (type) {
    var p = String(type || '').split('-');
    if (p.length < 3 || p[0] !== 'a') return null;
    var dim = /^[PAGSUF]$/.test(p[2].toUpperCase()) ? p[2].toUpperCase() : 'G';
    var func = p.slice(3).join('').toUpperCase().slice(0, 6);
    if (!/^[A-Z0-9]*$/.test(func)) func = '';
    return BT.sidc(AFF_FROM_COT[p[1].toLowerCase()] || 'U', dim, func);
  };
  function pCoT(text) {
    var doc = xml(text), feats = [], warn = [], types = {};
    els(doc, 'event').forEach(function (ev) {
      var pt = kids(ev, 'point')[0];
      if (!pt) return;
      var lat = num(pt.getAttribute('lat')), lon = num(pt.getAttribute('lon'));
      if (!okLL(lat, lon)) return;
      var type = ev.getAttribute('type') || '', d = kids(ev, 'detail')[0], name = null, p = { cot: type, how: ev.getAttribute('how') || '' };
      var hae = num(pt.getAttribute('hae')); if (hae != null && Math.abs(hae) < 9e6) p.hae_m = hae;
      var ce = num(pt.getAttribute('ce')); if (ce != null && ce < 9e6) p.ce_m = ce;
      if (ev.getAttribute('stale')) p.stale = ev.getAttribute('stale');
      if (d) {
        var c = els(d, 'contact')[0]; if (c && c.getAttribute('callsign')) name = c.getAttribute('callsign');
        var tr = els(d, 'track')[0]; if (tr) { if (num(tr.getAttribute('course')) != null) p.course = num(tr.getAttribute('course')); if (num(tr.getAttribute('speed')) != null) p.speed_ms = num(tr.getAttribute('speed')); }
        var rm = els(d, 'remarks')[0]; if (rm && rm.textContent.trim()) p.remarks = rm.textContent.trim().slice(0, 280);
        var gr = els(d, '__group')[0]; if (gr && gr.getAttribute('name')) p.team = gr.getAttribute('name');
      }
      types[type.split('-').slice(0, 3).join('-')] = 1;
      var uid = ev.getAttribute('uid') || '';
      var sidc = F.cotToSidc(type);
      if (!sidc) { warn.push('Event ' + (uid || type) + ' is type ' + type + ' (not a unit): shown as an unknown point.'); }
      feats.push({ g: 'pt', c: [r6(lat), r6(lon)], s: sidc || 'SUGP-----------', n: name || uid, id: uid || undefined, t: ev.getAttribute('time') || ev.getAttribute('start'), p: p });
    });
    if (!feats.length) throw new Error('No CoT <event> with a <point> was found.');
    return { features: feats, summary: { events: feats.length, kinds: Object.keys(types).slice(0, 12).join(', ') }, warnings: warn.slice(0, 5) };
  }
  var IDENT = { FRIEND: 'F', FRIENDLY: 'F', ASSUMED_FRIEND: 'A', ASSUMEDFRIEND: 'A', HOSTILE: 'H', ENEMY: 'H', SUSPECT: 'S', NEUTRAL: 'N', UNKNOWN: 'U', PENDING: 'P', JOKER: 'J', FAKER: 'K' };
  var ENV = { LAND: 'G', GROUND: 'G', AIR: 'A', SEA: 'S', SURFACE: 'S', SEA_SURFACE: 'S', SUBSURFACE: 'U', SUB_SURFACE: 'U', SPACE: 'P' };
  /* NFFI (STANAG 5527) and STANAG 4676: a tolerant reader that finds track elements and their positions by name. */
  function pTracks(text, fmt) {
    var doc = xml(text), feats = [], warn = [];
    var tracks = Array.prototype.filter.call(doc.getElementsByTagName('*'), function (e) {
      var n = e.localName.toLowerCase();
      return (n === 'track' || n === 'nffi_track' || n === 'friendlytrack' || n === 'trackinformation') && firstText(e, ['latitude', 'lat']) != null;
    });
    tracks = tracks.filter(function (t) { return !tracks.some(function (o) { return o !== t && o.contains(t); }); });  // outermost only
    tracks.forEach(function (tr, i) {
      var id = firstText(tr, ['trackID', 'trackId', 'trackNumber', 'trackIdentifier', 'trackUUID', 'uniqueID', 'UID']) || (fmt + '-' + (i + 1));
      var name = firstText(tr, ['unitName', 'unitDesignation', 'callSign', 'callsign', 'name', 'trackName', 'designation']) || id;
      var sidc = firstText(tr, ['symbolCode', 'sidc', 'symbolIdentificationCode', 'milStd2525', 'app6', 'symbol', 'SIC']);
      if (sidc) sidc = sidc.replace(/^(2525[a-e]?|app6[a-d]?):/i, '').toUpperCase();
      if (!sidc || !/^[A-Z0-9\-*]{10,30}$/.test(sidc)) {
        var ident = (firstText(tr, ['identity', 'standardIdentity', 'affiliation', 'trackIdentity']) || '').toUpperCase().replace(/\s+/g, '_');
        var env = (firstText(tr, ['environment', 'dimension', 'battleDimension']) || '').toUpperCase().replace(/\s+/g, '_');
        sidc = BT.sidc(IDENT[ident] || (fmt === 'nffi' ? 'F' : 'U'), ENV[env] || 'G', '');
      }
      var pts = Array.prototype.filter.call(tr.getElementsByTagName('*'), function (e) { return /^(trackpoint|point|positionreport)$/i.test(e.localName) && firstText(e, ['latitude', 'lat']) != null; });
      if (!pts.length) pts = [tr];
      pts.forEach(function (pt) {
        var lat = num(firstText(pt, ['latitude', 'lat'])), lon = num(firstText(pt, ['longitude', 'lon', 'long']));
        if (!okLL(lat, lon)) return;
        var p = {}, sp = num(firstText(pt, ['speed', 'speedOverGround'])), hd = num(firstText(pt, ['heading', 'course', 'direction'])), alt = num(firstText(pt, ['altitude', 'height', 'elevation']));
        if (sp != null) p.speed = sp; if (hd != null) p.course = hd; if (alt != null) p.alt_m = alt;
        var st = firstText(tr, ['operationalStatus', 'status']); if (st) p.status = st.slice(0, 60);
        feats.push({ g: 'pt', c: [r6(lat), r6(lon)], s: sidc, n: name, id: id, p: p,
          t: firstText(pt, ['dateTimeOfInformation', 'time', 'dateTime', 'timestamp', 'timeOfObservation', 'pointTime', 'dtg']) || undefined });
      });
    });
    if (!feats.length) throw new Error('No tracks with latitude and longitude were found.');
    var ids = {}; feats.forEach(function (f) { ids[f.id] = 1; });
    return { features: feats, summary: { tracks: Object.keys(ids).length, points: feats.length, root: doc.documentElement.localName }, warnings: warn };
  }
  var GRAPHIC_COL = { F: '#4fb3ff', A: '#4fb3ff', H: '#ff5a4e', S: '#ff5a4e', J: '#ff5a4e', K: '#ff5a4e', N: '#5fd17a', U: '#f2d64b', P: '#f2d64b' };
  function pNVG(text) {
    var doc = xml(text), feats = [], counts = {};
    var pts = function (s) { return String(s || '').trim().split(/\s+/).map(function (pair) { var xy = pair.split(','); return [num(xy[1]), num(xy[0])]; }).filter(function (c) { return okLL(c[0], c[1]); }); };
    Array.prototype.forEach.call(doc.getElementsByTagName('*'), function (e) {
      var tag = e.localName, sym = (e.getAttribute('symbol') || '').replace(/^[a-z0-9]+:/i, '').toUpperCase(), label = e.getAttribute('label') || e.getAttribute('name') || '';
      var colour = /stroke:\s*(#[0-9a-f]{6})/i.exec(e.getAttribute('style') || '');
      var col = colour ? colour[1] : (sym && sym[0] === 'G' ? GRAPHIC_COL[sym[1]] : null) || '#d9d4c7';
      var p = sym ? { symbol: sym } : {};
      var f = null;
      if (tag === 'point' || tag === 'text') {
        var lat = num(e.getAttribute('y')), lon = num(e.getAttribute('x'));
        if (!okLL(lat, lon)) return;
        f = { g: 'pt', c: [r6(lat), r6(lon)], n: label || (tag === 'text' ? e.textContent.trim() : ''), p: p };
        if (sym && /^[SIOE]/.test(sym) || /^\d{20,30}$/.test(sym)) f.s = sym; else f.col = col;
      } else if (tag === 'multipoint') {
        pts(e.getAttribute('points')).forEach(function (c) { feats.push({ g: 'pt', c: c, s: sym && /^[SIOE]/.test(sym) ? sym : undefined, n: label, col: col, p: p }); });
        counts.multipoint = (counts.multipoint || 0) + 1; return;
      } else if (tag === 'polyline' || tag === 'arrow' || tag === 'corridor') {
        var c = pts(e.getAttribute('points')); if (c.length < 2) return;
        f = { g: 'ln', c: c, n: label, col: col, p: p };
      } else if (tag === 'polygon') {
        var g = pts(e.getAttribute('points')); if (g.length < 3) return;
        f = { g: 'pg', c: g, n: label, col: col, p: p };
      } else if (tag === 'circle') {
        var cy = num(e.getAttribute('cy')), cx = num(e.getAttribute('cx')), r = num(e.getAttribute('r'));
        if (!okLL(cy, cx) || !(r > 0)) return;
        f = { g: 'ci', c: [r6(cy), r6(cx)], r: r, n: label, col: col, p: p };
      } else if (tag === 'ellipse' || tag === 'arc') {
        var ey = num(e.getAttribute('cy')), ex = num(e.getAttribute('cx')), rx = num(e.getAttribute('rx')), ry = num(e.getAttribute('ry')) || rx, rot = num(e.getAttribute('rotation')) || 0;
        if (!okLL(ey, ex) || !(rx > 0)) return;
        var a0 = tag === 'arc' ? num(e.getAttribute('startangle')) || 0 : 0, a1 = tag === 'arc' ? num(e.getAttribute('endangle')) || 360 : 360, ring = [];
        for (var a = a0; a <= a1; a += 10) {
          var t = a * Math.PI / 180, dx = rx * Math.sin(t), dy = ry * Math.cos(t), rr = rot * Math.PI / 180;
          var q = BT.dest([ey, ex], Math.hypot(dx, dy), (Math.atan2(dx * Math.cos(rr) - dy * Math.sin(rr), dy * Math.cos(rr) + dx * Math.sin(rr)) * 180 / Math.PI + 360) % 360);
          ring.push([r6(q[0]), r6(q[1])]);
        }
        f = { g: tag === 'arc' ? 'ln' : 'pg', c: ring, n: label, col: col, p: p };
      } else return;
      counts[tag] = (counts[tag] || 0) + 1;
      feats.push(f);
    });
    if (!feats.length) throw new Error('This NVG file has no elements with coordinates.');
    var root = doc.getElementsByTagNameNS('*', 'nvg')[0];
    return { features: feats, summary: { elements: feats.length, nvg_version: root ? root.getAttribute('version') || '' : '', kinds: Object.keys(counts).map(function (k) { return counts[k] + ' ' + k; }).join(', ') }, warnings: [] };
  }
  function kmlColor(s) { s = String(s || '').trim(); return /^[0-9a-f]{8}$/i.test(s) ? '#' + s.substr(6, 2) + s.substr(4, 2) + s.substr(2, 2) : null; }
  function pKML(text) {
    var doc = xml(text), feats = [], warn = [], styles = {};
    els(doc, 'Style').forEach(function (st) {
      var c = st.getElementsByTagNameNS('*', 'color'), col = null;
      for (var i = 0; i < c.length && !col; i++) col = kmlColor(c[i].textContent);
      if (st.getAttribute('id') && col) styles['#' + st.getAttribute('id')] = col;
    });
    els(doc, 'StyleMap').forEach(function (sm) {
      els(sm, 'Pair').forEach(function (pr) { if (firstText(pr, ['key']) === 'normal' && styles[firstText(pr, ['styleUrl'])]) styles['#' + sm.getAttribute('id')] = styles[firstText(pr, ['styleUrl'])]; });
    });
    var coords = function (s) { return String(s || '').trim().split(/\s+/).map(function (t) { var a = t.split(','); return [num(a[1]), num(a[0])]; }).filter(function (c) { return okLL(c[0], c[1]); }).map(function (c) { return [r6(c[0]), r6(c[1])]; }); };
    els(doc, 'Placemark').forEach(function (pm, idx) {
      var name = (kids(pm, 'name')[0] || {}).textContent || '';
      var when = firstText(pm, ['when', 'begin']) || undefined;
      var p = {}, sidc = null;
      els(pm, 'Data').forEach(function (d) { var k = d.getAttribute('name'), v = firstText(d, ['value']); if (k && v != null) { if (/^(sidc|symbol|symbolcode|sic)$/i.test(k)) sidc = v.toUpperCase(); else p[k] = v; } });
      els(pm, 'SimpleData').forEach(function (d) { var k = d.getAttribute('name'), v = (d.textContent || '').trim(); if (k) { if (/^(sidc|symbol|symbolcode|sic)$/i.test(k)) sidc = v.toUpperCase(); else p[k] = v; } });
      var desc = (kids(pm, 'description')[0] || {}).textContent; if (desc && desc.trim()) p.description = desc.replace(/<[^>]+>/g, ' ').trim().slice(0, 280);
      var col = styles[firstText(pm, ['styleUrl'])] || (function () { var c = pm.getElementsByTagNameNS('*', 'color')[0]; return c ? kmlColor(c.textContent) : null; })() || undefined;
      if (sidc && !/^[A-Z0-9\-*]{10,30}$/.test(sidc)) sidc = null;
      var base = { n: name.trim(), t: when, p: p, col: col };
      els(pm, 'Point').forEach(function (pt) { var c = coords(firstText(pt, ['coordinates'])); if (c[0]) feats.push(Object.assign({ g: 'pt', c: c[0], s: sidc || undefined }, base)); });
      els(pm, 'LineString').forEach(function (l) { var c = coords(firstText(l, ['coordinates'])); if (c.length >= 2) feats.push(Object.assign({ g: 'ln', c: c }, base)); });
      els(pm, 'Polygon').forEach(function (pg) { var ob = els(pg, 'outerBoundaryIs')[0] || pg; var c = coords(firstText(ob, ['coordinates'])); if (c.length >= 3) feats.push(Object.assign({ g: 'pg', c: c }, base)); });
      els(pm, 'Track').forEach(function (tr) {  // gx:Track: <when> + <gx:coord>
        var whens = els(tr, 'when').map(function (w) { return w.textContent.trim(); }), cs = els(tr, 'coord').map(function (c) { var a = c.textContent.trim().split(/\s+/); return [num(a[1]), num(a[0])]; });
        cs.forEach(function (c, i) { if (okLL(c[0], c[1])) feats.push(Object.assign({}, base, { g: 'pt', c: [r6(c[0]), r6(c[1])], s: sidc || undefined, id: 'kml-' + (name || idx), t: whens[i] })); });
      });
    });
    if (!feats.length) throw new Error('No placemarks with coordinates were found.');
    var docName = firstText(doc, ['name']);
    return { features: feats, summary: { placemarks: els(doc, 'Placemark').length, features: feats.length, document: docName || '' }, warnings: warn };
  }

  /* ================================================================== zip (KMZ) */
  async function unzip(u8, want) {
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), e = -1;
    for (var i = u8.length - 22; i >= Math.max(0, u8.length - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error('This zip file is damaged (no directory).');
    var n = dv.getUint16(e + 10, true), cd = dv.getUint32(e + 16, true), files = [];
    for (var k = 0; k < n; k++) {
      if (dv.getUint32(cd, true) !== 0x02014b50) break;
      var method = dv.getUint16(cd + 10, true), csize = dv.getUint32(cd + 20, true), nl = dv.getUint16(cd + 28, true), xl = dv.getUint16(cd + 30, true), cl = dv.getUint16(cd + 32, true), lo = dv.getUint32(cd + 42, true);
      files.push({ name: new TextDecoder().decode(u8.subarray(cd + 46, cd + 46 + nl)), method: method, csize: csize, lo: lo });
      cd += 46 + nl + xl + cl;
    }
    var f = files.filter(function (x) { return want.test(x.name); }).sort(function (a, b) { return (/doc\.kml$/i.test(b.name) ? 1 : 0) - (/doc\.kml$/i.test(a.name) ? 1 : 0); })[0];
    if (!f) throw new Error('No .kml file inside this KMZ.');
    var start = f.lo + 30 + dv.getUint16(f.lo + 26, true) + dv.getUint16(f.lo + 28, true), data = u8.subarray(start, start + f.csize);
    if (f.method === 0) return data;
    if (f.method !== 8 || typeof DecompressionStream === 'undefined') throw new Error('This KMZ is compressed in a way this browser can\'t open.');
    var out = await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer();
    return new Uint8Array(out);
  }

  /* ================================================================== JSON, CSV, AIS */
  function pGeoJSON(text) {
    var obj;
    try { obj = JSON.parse(text); } catch (e) { throw new Error('This JSON doesn\'t parse: ' + e.message); }
    if (Array.isArray(obj)) obj = { type: 'FeatureCollection', features: obj };
    var list = obj.type === 'FeatureCollection' ? obj.features || [] : obj.type === 'Feature' ? [obj] : obj.type ? [{ type: 'Feature', geometry: obj, properties: {} }] : [];
    var feats = [];
    var flip = function (c) { return c && okLL(c[1], c[0]) ? [r6(c[1]), r6(c[0])] : null; };
    list.forEach(function (f) {
      if (!f || !f.geometry) return;
      var pr = f.properties || {}, g = f.geometry, pk = function () { for (var i = 0; i < arguments.length; i++) if (pr[arguments[i]] != null && pr[arguments[i]] !== '') return pr[arguments[i]]; return null; };
      var sidc = pk('sidc', 'SIDC', 'symbol', 'symbolCode', 'sic'), extra = {};
      Object.keys(pr).forEach(function (k) { if (/^(sidc|symbol|symbolcode|sic|name|title|label|callsign)$/i.test(k)) return; var v = pr[k]; if (v == null || typeof v !== 'object') extra[k] = v; });
      var base = { s: sidc ? String(sidc).toUpperCase() : undefined, n: pk('name', 'title', 'label', 'callsign', 'designation') || undefined,
        t: pk('time', 'timestamp', 'datetime', 'dtg', 'when') || undefined, id: pk('trackId', 'uid', 'track') || (f.id != null ? String(f.id) : undefined),
        col: /^#[0-9a-f]{6}$/i.test(pr.stroke || pr.color || '') ? (pr.stroke || pr.color) : undefined, p: extra };
      var add = function (gg, c) { if (c) feats.push(Object.assign({ g: gg, c: c }, base)); };
      var ring = function (r) { var c = (r || []).map(flip).filter(Boolean); return c; };
      var geoms = g.type === 'GeometryCollection' ? g.geometries || [] : [g];
      geoms.forEach(function (gm) {
        var c = gm.coordinates;
        if (gm.type === 'Point') add('pt', flip(c));
        else if (gm.type === 'MultiPoint') (c || []).forEach(function (q) { add('pt', flip(q)); });
        else if (gm.type === 'LineString') { var l = ring(c); if (l.length > 1) add('ln', l); }
        else if (gm.type === 'MultiLineString') (c || []).forEach(function (q) { var l = ring(q); if (l.length > 1) add('ln', l); });
        else if (gm.type === 'Polygon') { var p = ring((c || [])[0]); if (p.length > 2) add('pg', p); }
        else if (gm.type === 'MultiPolygon') (c || []).forEach(function (q) { var p = ring((q || [])[0]); if (p.length > 2) add('pg', p); });
      });
    });
    if (!feats.length) throw new Error('No GeoJSON features with coordinates were found.');
    return { features: feats, summary: { features: feats.length, with_symbols: feats.filter(function (f) { return f.s; }).length }, warnings: [] };
  }
  function pCSV(text) {
    var lines = text.split(/\r?\n/).filter(function (l) { return l.trim(); });
    if (lines.length < 2) throw new Error('The CSV needs a header row and at least one data row.');
    var d = [',', ';', '\t'].sort(function (a, b) { return lines[0].split(b).length - lines[0].split(a).length; })[0];
    var split = function (l) {
      var out = [], cur = '', q = false;
      for (var i = 0; i < l.length; i++) { var ch = l[i]; if (ch === '"') { if (q && l[i + 1] === '"') { cur += '"'; i++; } else q = !q; } else if (ch === d && !q) { out.push(cur); cur = ''; } else cur += ch; }
      out.push(cur); return out.map(function (s) { return s.trim(); });
    };
    var head = split(lines[0]).map(function (h) { return h.toLowerCase(); });
    var col = function (names) { for (var i = 0; i < head.length; i++) if (names.indexOf(head[i]) >= 0) return i; return -1; };
    var la = col(['lat', 'latitude', 'y']), lo = col(['lon', 'lng', 'long', 'longitude', 'x']);
    if (la < 0 || lo < 0) throw new Error('The CSV needs lat and lon columns (or latitude / longitude).');
    var sc = col(['sidc', 'symbol', 'symbolcode', 'sic']), nc = col(['name', 'label', 'callsign', 'title', 'designation']), tc = col(['time', 'timestamp', 'datetime', 'dtg', 'date']), ic = col(['id', 'uid', 'track', 'trackid']);
    var feats = [], skipped = 0;
    lines.slice(1).forEach(function (l) {
      var c = split(l), lat = num(c[la]), lon = num(c[lo]);
      if (!okLL(lat, lon)) { skipped++; return; }
      var p = {};
      head.forEach(function (h, i) { if ([la, lo, sc, nc, tc, ic].indexOf(i) < 0 && c[i]) p[h] = num(c[i]) != null && /^-?[\d.]+$/.test(c[i]) ? num(c[i]) : c[i]; });
      feats.push({ g: 'pt', c: [r6(lat), r6(lon)], s: sc >= 0 && c[sc] ? c[sc].toUpperCase() : undefined, n: nc >= 0 ? c[nc] : undefined, t: tc >= 0 ? c[tc] || undefined : undefined, id: ic >= 0 ? c[ic] || undefined : undefined, p: p });
    });
    if (!feats.length) throw new Error('No CSV rows had valid coordinates.');
    return { features: feats, summary: { rows: lines.length - 1, placed: feats.length, columns: head.join(', ') }, warnings: skipped ? [skipped + ' rows had no valid coordinates and were skipped.'] : [] };
  }
  function aisBits(payload) {
    var bits = [];
    for (var i = 0; i < payload.length; i++) { var v = payload.charCodeAt(i) - 48; if (v > 40) v -= 8; for (var b = 5; b >= 0; b--) bits.push((v >> b) & 1); }
    return bits;
  }
  function bu(bits, a, n) { var v = 0; for (var i = a; i < a + n; i++) v = v * 2 + (bits[i] || 0); return v; }
  function bs(bits, a, n) { var v = bu(bits, a, n); return bits[a] ? v - Math.pow(2, n) : v; }
  function btxt(bits, a, n) { var s = ''; for (var i = 0; i < n; i++) { var c = bu(bits, a + 6 * i, 6); s += String.fromCharCode(c < 32 ? c + 64 : c); } return s.replace(/@+.*$/, '').trim(); }
  function shipFunc(t) {
    if (t === 30) return 'XF'; if (t === 31 || t === 32) return 'XMTO'; if (t === 36 || t === 37) return 'XR'; if (t === 52) return 'XMTU'; if (t === 55) return 'XL';
    if (t >= 60 && t <= 69) return 'XMP'; if (t >= 70 && t <= 79) return 'XMC'; if (t >= 80 && t <= 89) return 'XMO'; if (t === 35) return ''; return 'XM';
  }
  var NAV = ['Under way using engine', 'At anchor', 'Not under command', 'Restricted manoeuvrability', 'Constrained by draught', 'Moored', 'Aground', 'Engaged in fishing', 'Under way sailing'];
  function pAIS(text) {
    var frags = {}, reports = [], statics = {}, sentences = 0, bad = 0, now = Date.now(), types = {};
    text.split(/\r?\n/).forEach(function (line) {
      var t = null, m = /\\([^\\]*)\\/.exec(line);
      if (m) { var c = /(?:^|,)c:(\d+)/.exec(m[1]); if (c) t = (+c[1] > 1e11 ? +c[1] : +c[1] * 1000); }
      var iso0 = /(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z?)/.exec(line); if (!t && iso0) t = Date.parse(iso0[1]);
      var s = /!(?:AI|AB|BS)VD[MO],(\d),(\d),(\d*),([AB12]?),([^,]*),(\d)\*([0-9A-F]{2})/i.exec(line);
      if (!s) return;
      sentences++;
      var body = line.slice(line.indexOf('!') + 1, line.lastIndexOf('*')), cs = 0;
      for (var i = 0; i < body.length; i++) cs ^= body.charCodeAt(i);
      if (cs !== parseInt(s[7], 16)) { bad++; return; }
      var payload = s[5];
      if (+s[1] > 1) { var key = s[3] + s[4]; frags[key] = (frags[key] || []); frags[key][+s[2] - 1] = payload; if (frags[key].filter(Boolean).length < +s[1]) return; payload = frags[key].join(''); delete frags[key]; }
      var b = aisBits(payload), type = bu(b, 0, 6), mmsi = bu(b, 8, 30);
      types[type] = 1;
      if (type >= 1 && type <= 3 || type === 18 || type === 19) {
        var cl = type === 18 || type === 19, lon = bs(b, cl ? 57 : 61, 28) / 600000, lat = bs(b, cl ? 85 : 89, 27) / 600000;
        var sog = bu(b, cl ? 46 : 50, 10) / 10, cog = bu(b, cl ? 112 : 116, 12) / 10, hdg = bu(b, cl ? 124 : 128, 9);
        if (!okLL(lat, lon) || Math.abs(lon) > 180 || Math.abs(lat) > 90) return;
        reports.push({ mmsi: mmsi, lat: lat, lon: lon, sog: sog < 102.3 ? sog : null, cog: cog < 360 ? cog : null, hdg: hdg < 360 ? hdg : null, nav: cl ? null : NAV[bu(b, 38, 4)] || null, t: t || now, cls: cl ? 'B' : 'A' });
      } else if (type === 5) {
        statics[mmsi] = { name: btxt(b, 112, 20), callsign: btxt(b, 70, 7), shiptype: bu(b, 232, 8), imo: bu(b, 40, 30) };
      } else if (type === 24 && bu(b, 38, 2) === 0) {
        (statics[mmsi] = statics[mmsi] || {}).name = btxt(b, 40, 20);
      } else if (type === 24) {
        (statics[mmsi] = statics[mmsi] || {}).shiptype = bu(b, 40, 8);
      }
    });
    if (!reports.length) throw new Error('No AIS position reports (types 1, 2, 3, 18, 19) with valid positions were found.');
    var feats = reports.map(function (r) {
      var st = statics[r.mmsi] || {}, p = { mmsi: r.mmsi, class: r.cls };
      if (r.sog != null) p.sog_kts = r.sog; if (r.cog != null) p.cog = r.cog; if (r.hdg != null) p.heading = r.hdg; if (r.nav) p.nav_status = r.nav;
      if (st.callsign) p.callsign = st.callsign; if (st.imo) p.imo = st.imo; if (st.shiptype != null) p.ship_type = st.shiptype;
      return { g: 'pt', c: [r6(r.lat), r6(r.lon)], s: BT.sidc('N', 'S', st.shiptype != null ? shipFunc(st.shiptype) : 'XM'), n: st.name || 'MMSI ' + r.mmsi, id: 'AIS-' + r.mmsi, t: iso(r.t), p: p };
    });
    var warn = []; if (bad) warn.push(bad + ' sentences failed their checksum and were skipped.');
    if (!/c:\d|\d{4}-\d\d-\d\dT/.test(text)) warn.push('No timestamps in the file: the reports are timed as "now".');
    var v = {}; feats.forEach(function (f) { v[f.id] = 1; });
    return { features: feats, summary: { sentences: sentences, reports: reports.length, vessels: Object.keys(v).length, types: Object.keys(types).join(', ') }, warnings: warn };
  }

  /* ================================================================== entry points */
  var STANDARD = { '4607': 'STANAG 4607 (GMTI)', '4609': 'STANAG 4609 (motion imagery KLV)', '4545': 'STANAG 4545 (NSIF)', '4676': 'STANAG 4676 (ISR tracking)',
    nffi: 'STANAG 5527 (NFFI)', cot: 'Cursor on Target', nvg: 'NATO Vector Graphics', kml: 'OGC KML', kmz: 'OGC KML (zipped)', geojson: 'GeoJSON (RFC 7946)', csv: 'CSV', ais: 'AIS (ITU-R M.1371, NMEA 0183)' };
  F.parseBytes = async function (name, u8, file) {
    var kind = F.detect(name, u8);
    if (!kind) throw new Error('Battle Tracker doesn\'t recognise this file. Supported: ' + F.LIST.map(function (f) { return f.name; }).join(', ') + '.');
    var r, fmt = kind === 'kmz' ? 'kml' : kind;
    if (kind === '4607') r = p4607(u8);
    else if (kind === '4609') r = await p4609(u8, file);
    else if (kind === '4545') r = p4545(u8);
    else if (kind === 'kmz') r = pKML(F.textOf(await unzip(u8, /\.kml$/i)));
    else {
      var text = F.textOf(u8);
      r = kind === 'cot' ? pCoT(text) : kind === 'nvg' ? pNVG(text) : kind === 'kml' ? pKML(text) : kind === 'geojson' ? pGeoJSON(text) :
        kind === 'csv' ? pCSV(text) : kind === 'ais' ? pAIS(text) : pTracks(text, kind);
    }
    var counts = { pt: 0, ln: 0, pg: 0, ci: 0, mti: 0 }, times = [];
    r.features.forEach(function (f) { if (f.m) counts.mti++; else counts[f.g]++; if (f.t) { var t = Date.parse(f.t); if (!isNaN(t)) times.push(t); } });
    times.sort(function (a, b) { return a - b; });
    return { fmt: fmt, kind: kind, standard: STANDARD[kind], name: name, size: u8.length, features: r.features, summary: r.summary || {}, warnings: r.warnings || [],
      blocked: r.blocked || null, counts: counts, start: times.length ? iso(times[0]) : null, end: times.length ? iso(times[times.length - 1]) : null };
  };
  F.parseFile = async function (file) {
    var big = file.size > 64 * 1048576;
    var u8 = new Uint8Array(await (big ? file.slice(0, 4 * 1048576) : file).arrayBuffer());
    if (big && F.detect(file.name, u8) !== '4609') {
      if (file.size > 256 * 1048576) throw new Error('That file is over 256 MB. Only STANAG 4609 video files can be that big.');
      u8 = new Uint8Array(await file.arrayBuffer());
    }
    return F.parseBytes(file.name, u8, big ? file : null);
  };
})();

/* ===== _samples.html ===== */
(function () {
  'use strict';
  var S = BT.samples = {};
  var OBJ = [33.395, -117.335];

  /* ------------------------------------------------------------------ byte writer */
  function W() { this.b = []; }
  W.prototype.u8 = function (v) { this.b.push(v & 255); return this; };
  W.prototype.u16 = function (v) { return this.u8(v >> 8).u8(v); };
  W.prototype.u32 = function (v) { v = v >>> 0; return this.u8(v >>> 24).u8(v >>> 16).u8(v >>> 8).u8(v); };
  W.prototype.i16 = function (v) { return this.u16(v < 0 ? v + 65536 : v); };
  W.prototype.i32 = function (v) { return this.u32(v < 0 ? v + 4294967296 : v); };
  W.prototype.str = function (s, n) { s = String(s); for (var i = 0; i < n; i++) this.u8(i < s.length ? s.charCodeAt(i) : n === undefined ? 0 : 32); return this; };
  W.prototype.raw = function (arr) { for (var i = 0; i < arr.length; i++) this.b.push(arr[i] & 255); return this; };
  W.prototype.bytes = function () { return new Uint8Array(this.b); };
  function enc(s) { return new TextEncoder().encode(s); }
  function pad(s, n, ch) { s = String(s); while (s.length < n) s = (ch || ' ') + s; return s.slice(-n); }
  function rpad(s, n) { s = String(s); while (s.length < n) s += ' '; return s.slice(0, n); }
  function rnd(seed) { return function () { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }
  function off(p, n, e) { return [p[0] + n / 111320, p[1] + e / (111320 * Math.cos(p[0] * Math.PI / 180))]; }

  /* ------------------------------------------------------------------ STANAG 4607 */
  var sa32 = function (d) { return Math.round(d * 2147483648 / 90); };
  var ba32 = function (d) { return Math.round(((d % 360) + 360) % 360 * 4294967296 / 360) >>> 0; };
  var ba16 = function (d) { return Math.round(((d % 360) + 360) % 360 * 65536 / 360) & 0xffff; };
  S.s4607 = function () {
    var now = Date.now(), r = rnd(4607), d0 = new Date(now - 30 * 60000), ref = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), d0.getUTCDate());
    var road = [[33.470, -117.262], [33.452, -117.282], [33.433, -117.300], [33.418, -117.318]], packets = [];
    function header(w, size) {
      w.str('31', 2).u32(size).str('XX', 2).u8(5).str('  ', 2).u16(0).u8(130).str('FORGE22', 10).u32(2612).u32(9);
    }
    for (var k = 0; k < 8; k++) {
      var t = now - (7 - k) * 4 * 60000, ms = t - ref, ang = k * 24;
      var plat = BT.dest([33.20, -117.80], 14000, ang), segs = new W();
      if (k === 0) {  // mission segment (44 bytes)
        segs.u8(1).u32(44).str('IRONANVIL26', 12).str('ORBIT-K', 12).u8(6).str('SIM-RADAR', 10).u16(d0.getUTCFullYear()).u8(d0.getUTCMonth() + 1).u8(d0.getUTCDate());
      }
      // dwell: D2-D9, D15, D16, D24-D27, targets D32.1/.2/.3/.6/.7/.9/.10
      var targets = [], convoy = 10;
      for (var i = 0; i < convoy; i++) {
        var f = Math.min(.98, .1 + k * .1 + i * .012), seg = Math.min(road.length - 2, Math.floor(f * (road.length - 1))), lf = f * (road.length - 1) - seg;
        var a = road[seg], b = road[seg + 1];
        targets.push({ lat: a[0] + (b[0] - a[0]) * lf + (r() - .5) * 3e-4, lon: a[1] + (b[1] - a[1]) * lf + (r() - .5) * 3e-4, v: -(700 + r() * 500), snr: 12 + Math.round(r() * 14), cls: 1 });
      }
      for (var j = 0; j < 6; j++) targets.push({ lat: 33.40 + (r() - .5) * .14, lon: -117.36 + (r() - .5) * .16, v: Math.round((r() - .5) * 300), snr: 7 + Math.round(r() * 5), cls: 127 });
      var dw = new W();
      dw.raw([0xFF, 0x06, 0x03, 0xC3, 0x9B, 0x00, 0x00, 0x00]).u16(k).u16(k).u8(1).u16(targets.length).u32(ms)
        .i32(sa32(plat[0])).u32(ba32(plat[1])).i32(914400).u16(ba16((ang + 90) % 360)).u32(211000)
        .i32(sa32(33.40)).u32(ba32(-117.36)).u16(Math.round(13 * 128)).u16(ba16(14));
      targets.forEach(function (tg, n) { dw.u16(n).i32(sa32(tg.lat)).u32(ba32(tg.lon)).i16(60).i16(Math.round(tg.v)).u8(tg.snr).u8(tg.cls); });
      var body = dw.bytes();
      segs.u8(2).u32(5 + body.length).raw(body);
      // platform location segment (28 bytes)
      segs.u8(13).u32(28).u32(ms + 500).i32(sa32(plat[0])).u32(ba32(plat[1])).i32(914400).u16(ba16((ang + 90) % 360)).u32(211000).u8(0);
      var sb = segs.bytes(), pk = new W();
      header(pk, 32 + sb.length); pk.raw(sb);
      packets.push(pk.bytes());
    }
    var total = packets.reduce(function (n, p) { return n + p.length; }, 0), out = new Uint8Array(total), o = 0;
    packets.forEach(function (p) { out.set(p, o); o += p.length; });
    return out;
  };

  /* ------------------------------------------------------------------ STANAG 4609: MPEG-TS with MISB 0601 KLV */
  var CRC_TABLE = (function () { var t = []; for (var i = 0; i < 256; i++) { var c = i << 24; for (var k = 0; k < 8; k++) c = c & 0x80000000 ? (c << 1) ^ 0x04C11DB7 : c << 1; t.push(c >>> 0); } return t; })();
  function crc32mpeg(arr) { var c = 0xFFFFFFFF; for (var i = 0; i < arr.length; i++) c = ((c << 8) ^ CRC_TABLE[((c >>> 24) ^ arr[i]) & 255]) >>> 0; return c; }
  function ber(n) { if (n < 128) return [n]; if (n < 256) return [0x81, n]; return [0x82, n >> 8, n & 255]; }
  function tag(t, bytes) { return [t].concat(ber(bytes.length), bytes); }
  function u(v, n) { var a = []; for (var i = n - 1; i >= 0; i--) a.push(Math.floor(v / Math.pow(2, 8 * i)) & 255); return a; }
  function s(v, n) { return u(v < 0 ? v + Math.pow(2, 8 * n) : v, n); }
  function txt(t) { return Array.prototype.slice.call(enc(t)); }
  function mi(v, range, n) { return s(Math.round(v / range * (Math.pow(2, 8 * n - 1) - 1)), n); }
  function mu(v, lo, hi, n) { return u(Math.round((v - lo) / (hi - lo) * (Math.pow(2, 8 * n) - 1)), n); }
  function uasLS(rec) {
    var key = [0x06, 0x0E, 0x2B, 0x34, 0x02, 0x0B, 0x01, 0x01, 0x0E, 0x01, 0x03, 0x01, 0x01, 0x00, 0x00, 0x00];
    var us = rec.t * 1000, body = [];
    body = body.concat(tag(2, u(us, 8)), tag(3, txt('IRONANVIL26')), tag(4, txt('EMBER08')), tag(5, mu(rec.heading, 0, 360, 2)),
      tag(6, mi(1.5, 20, 2)), tag(7, mi(-12, 50, 2)), tag(10, txt('SKYFORGE')), tag(11, txt('EO/IR')),
      tag(13, mi(rec.lat, 90, 4)), tag(14, mi(rec.lon, 180, 4)), tag(15, mu(2440, -900, 19000, 2)),
      tag(16, mu(4.6, 0, 180, 2)), tag(17, mu(3.4, 0, 180, 2)), tag(18, mu(rec.az, 0, 360, 4)), tag(21, mu(4500, 0, 5000000, 4)),
      tag(23, mi(rec.fc[0], 90, 4)), tag(24, mi(rec.fc[1], 180, 4)), tag(25, mu(60, -900, 19000, 2)), tag(56, [38]), tag(59, txt('EMBER 08')), tag(65, [18]));
    rec.corners.forEach(function (c, i) { body = body.concat(tag(82 + 2 * i, mi(c[0], 90, 4)), tag(83 + 2 * i, mi(c[1], 180, 4))); });
    var len = body.length + 4, pkt = key.concat(ber(len), body, [1, 2]);
    var sum = 0; for (var i = 0; i < pkt.length; i++) sum = (sum + (pkt[i] << (8 * ((i + 1) % 2)))) & 0xffff;
    return pkt.concat([sum >> 8, sum & 255]);
  }
  function tsPackets(pid, payload, pusi, cc) {
    var out = [], pos = 0, first = true;
    while (pos < payload.length) {
      var room = 184, n = Math.min(room, payload.length - pos), pkt = [0x47, (first && pusi ? 0x40 : 0) | (pid >> 8), pid & 255];
      if (n < room) {  // adaptation field stuffing
        var af = room - n - 1;
        pkt.push(0x30 | (cc.v++ & 15)); pkt.push(af);
        if (af > 0) { pkt.push(0x00); for (var k = 1; k < af; k++) pkt.push(0xFF); }
      } else pkt.push(0x10 | (cc.v++ & 15));
      out.push(pkt.concat(payload.slice(pos, pos + n)));
      pos += n; first = false;
    }
    return out;
  }
  function section(tableId, idExt, bodyBytes) {
    var len = 5 + bodyBytes.length + 4, sec = [tableId, 0xB0 | (len >> 8), len & 255, idExt >> 8, idExt & 255, 0xC1, 0, 0].concat(bodyBytes);
    var c = crc32mpeg(sec); return [0].concat(sec, [c >>> 24, (c >>> 16) & 255, (c >>> 8) & 255, c & 255]);
  }
  S.s4609 = function () {
    var now = Date.now(), cc = { pat: { v: 0 }, pmt: { v: 0 }, klv: { v: 0 } }, pkts = [];
    var pat = section(0, 1, [0, 1, 0xE0 | 0x10, 0x00]);
    var desc = [0x05, 4, 0x4B, 0x4C, 0x56, 0x41];  // registration descriptor "KLVA"
    var pmt = section(2, 1, [0xE1, 0x01, 0xF0, 0].concat([0x06, 0xE1, 0x01, 0xF0, desc.length], desc));
    var centre = off(OBJ, -900, 1500);
    for (var i = 0; i < 120; i++) {
      if (i % 30 === 0) { pkts = pkts.concat(tsPackets(0, pat, true, cc.pat), tsPackets(0x1000, pmt, true, cc.pmt)); }
      var t = now - (119 - i) * 5000, ang = i * 3;
      var plat = BT.dest(centre, 3600, ang), fc = BT.dest(centre, 400 * Math.sin(ang * Math.PI / 90), ang * 2);
      var brg = BT.bearing(plat, fc), corners = [-38, 38, 142, 218].map(function (a) { return BT.dest(fc, 330, brg + a); });
      var klv = uasLS({ t: t, lat: plat[0], lon: plat[1], heading: (ang + 90) % 360, az: (brg - (ang + 90) + 720) % 360, fc: fc, corners: corners });
      var pts = Math.round(i * 5 * 90000) + 900000, hdrLen = 5;
      var pes = [0, 0, 1, 0xBD].concat(u(klv.length + 3 + hdrLen, 2), [0x80, 0x80, hdrLen,
        0x21 | ((pts / 536870912) & 0x0e), (pts >> 22) & 255, ((pts >> 14) & 0xfe) | 1, (pts >> 7) & 255, ((pts << 1) & 0xfe) | 1], klv);
      pkts = pkts.concat(tsPackets(0x101, pes, true, cc.klv));
    }
    var out = new Uint8Array(pkts.length * 188);
    pkts.forEach(function (p, i) { out.set(p, i * 188); });
    return out;
  };

  /* ------------------------------------------------------------------ STANAG 4545 (NSIF 1.0 header + one small image) */
  S.s4545 = function () {
    var now = new Date(), p2 = function (n) { return pad(n, 2, '0'); };
    var fdt = now.getUTCFullYear() + p2(now.getUTCMonth() + 1) + p2(now.getUTCDate()) + p2(now.getUTCHours()) + p2(now.getUTCMinutes()) + p2(now.getUTCSeconds());
    var sec = 'U' + rpad('', 166), c = off(OBJ, 2200, -2600);
    var corners = [0, 90, 180, 270].map(function (a) { return BT.dest(c, 1500, a + 45 + 10); });
    var dms = function (v, deg) {
      var h = v < 0 ? (deg === 2 ? 'S' : 'W') : (deg === 2 ? 'N' : 'E'), a = Math.abs(v), d = Math.floor(a), m = Math.floor((a - d) * 60), s2 = Math.round(((a - d) * 60 - m) * 60);
      if (s2 === 60) { s2 = 0; m++; } if (m === 60) { m = 0; d++; }
      return pad(d, deg, '0') + p2(m) + p2(s2) + h;
    };
    var igeolo = corners.map(function (q) { return dms(q[0], 2) + dms(q[1], 3); }).join('');
    var sub = 'IM' + rpad('EO0001', 10) + fdt + rpad('', 17) + rpad('IRON ANVIL 26 EO frame, OBJ FORGE west (sample)', 80) + sec + '0' + rpad('SIMULATED EO SENSOR', 42) +
      pad(64, 8, '0') + pad(64, 8, '0') + 'INT' + rpad('MONO', 8) + rpad('VIS', 8) + '08' + 'R' + 'G' + igeolo +
      '0' + 'NC' + '1' + 'M ' + rpad('', 6) + 'N' + '   ' + '0' + '0' + 'B' + '0001' + '0001' + '0064' + '0064' + '08' + '001' + '000' + '0000000000' + '1.0 ' + '00000' + '00000';
    var image = new Uint8Array(64 * 64);
    for (var y = 0; y < 64; y++) for (var x = 0; x < 64; x++) image[y * 64 + x] = 60 + ((x * 7 + y * 3) % 90);
    var tail = '000' + '000' + '000' + '000' + '000' + '00000' + '00000';
    var hlen = 363 + 16 + tail.length;
    var fl = hlen + sub.length + image.length;
    var head = 'NSIF' + '01.01' + '03' + 'BF01' + rpad('FORGE', 10) + fdt + rpad('IRON ANVIL 26 imagery sample', 80) + sec.slice(0, 167) + '00000' + '00000' + '0' +
      String.fromCharCode(0, 0, 0) + rpad('BATTLE TRACKER SAMPLE', 24) + rpad('', 18) + pad(fl, 12, '0') + pad(hlen, 6, '0') + '001' + pad(sub.length, 6, '0') + pad(image.length, 10, '0') + tail;
    var a = new Uint8Array(fl), o = 0;
    for (var i = 0; i < head.length; i++) a[o++] = head.charCodeAt(i);
    for (i = 0; i < sub.length; i++) a[o++] = sub.charCodeAt(i);
    a.set(image, o);
    return a;
  };

  /* ------------------------------------------------------------------ text formats */
  function z(ms) { return new Date(ms).toISOString(); }
  S.cot = function () {
    var now = Date.now(), list = [['RAVEN 1', 'a-f-G-U-C-I', [33.338, -117.402], 40], ['RAVEN 2', 'a-f-G-U-C-I', [33.344, -117.395], 45], ['WOLF 6', 'a-f-G-U-C-A', [33.330, -117.388], 50],
      ['MEDIC 3', 'a-f-G-U-S-M', [33.318, -117.430], 0], ['SPECTRE', 'a-h-G-U-C-A', [33.402, -117.343], 220], ['DRONE 9', 'a-h-A-M-F-Q', [33.415, -117.360], 200], ['TRAWLER', 'a-n-S-X-F', [33.230, -117.560], 300]];
    var x = '<?xml version="1.0" encoding="UTF-8"?>\n';
    list.forEach(function (e, i) {
      for (var k = 0; k < 3; k++) {
        var t = now - (2 - k) * 120000, p = BT.dest(e[2], k * 250, e[3]);
        x += '<event version="2.0" uid="BT-SAMPLE-' + i + '" type="' + e[1] + '" how="' + (e[1][2] === 'h' ? 'h-e' : 'm-g') + '" time="' + z(t) + '" start="' + z(t) + '" stale="' + z(t + 300000) + '">' +
          '<point lat="' + p[0].toFixed(6) + '" lon="' + p[1].toFixed(6) + '" hae="35" ce="10" le="10"/><detail><contact callsign="' + e[0] + '"/><track course="' + e[3] + '" speed="' + (k ? 2.1 : 0) + '"/>' +
          (i === 4 ? '<remarks>Observed from OP NORTH, 2 tanks</remarks>' : '') + '</detail></event>\n';
      }
    });
    return enc(x);
  };
  S.nffi = function () {
    var now = Date.now(), units = [['A/2-7 INF', 'SFGPUCI----E---', [33.326, -117.452]], ['B/2-7 INF', 'SFGPUCI----E---', [33.318, -117.440]], ['3/C/1-10 AR', 'SFGPUCA----D---', [33.332, -117.430]],
      ['2-7 INF TAC', 'SFGPUCI---AF---', [33.312, -117.458]], ['FWD SPT CO', 'SFGPUSS----E---', [33.300, -117.470]]];
    var x = '<?xml version="1.0" encoding="UTF-8"?>\n<NFFI xmlns="urn:nato:nffi:1.3">\n  <trackSource><system>TF-ANVIL-GW</system></trackSource>\n';
    units.forEach(function (u2, i) {
      for (var k = 0; k < 3; k++) {
        var p = BT.dest(u2[2], k * 420, 40 + i * 5);
        x += '  <track>\n    <positionalData>\n      <latitude>' + p[0].toFixed(6) + '</latitude><longitude>' + p[1].toFixed(6) + '</longitude><altitude>40</altitude>\n' +
          '      <dateTimeOfInformation>' + z(now - (2 - k) * 600000) + '</dateTimeOfInformation><speed>' + (k ? 3.5 : 0) + '</speed><heading>' + (40 + i * 5) + '</heading>\n    </positionalData>\n' +
          '    <identificationData>\n      <trackID>2-7-' + i + '</trackID><unitName>' + u2[0] + '</unitName><symbolCode>' + u2[1] + '</symbolCode>\n    </identificationData>\n' +
          '    <operationalStatus>FULLY CAPABLE</operationalStatus>\n  </track>\n';
      }
    });
    return enc(x + '</NFFI>\n');
  };
  S.s4676 = function () {
    var now = Date.now(), tracks = [['4101', 'HOSTILE', 'LAND', [33.452, -117.286], 210], ['4102', 'UNKNOWN', 'LAND', [33.440, -117.270], 250], ['4103', 'NEUTRAL', 'SEA', [33.180, -117.600], 320]];
    var x = '<?xml version="1.0" encoding="UTF-8"?>\n<TrackMessage xmlns="urn:int:nato:stanag4676:0.14">\n  <messageSecurity><classification>UNCLASSIFIED</classification></messageSecurity>\n  <tracks>\n';
    tracks.forEach(function (t) {
      x += '    <Track>\n      <trackNumber>' + t[0] + '</trackNumber>\n      <TrackIdentityInformation><identity>' + t[1] + '</identity><environment>' + t[2] + '</environment></TrackIdentityInformation>\n      <items>\n';
      for (var k = 0; k < 6; k++) {
        var p = BT.dest(t[3], k * 300, t[4]);
        x += '        <TrackPoint><time>' + z(now - (5 - k) * 60000) + '</time><position><GeodeticPosition><latitude>' + p[0].toFixed(6) + '</latitude><longitude>' + p[1].toFixed(6) +
          '</longitude></GeodeticPosition></position><speed>5.0</speed><course>' + t[4] + '</course></TrackPoint>\n';
      }
      x += '      </items>\n    </Track>\n';
    });
    return enc(x + '  </tracks>\n</TrackMessage>\n');
  };
  S.nvg = function () {
    var ll = function (p) { return p[1].toFixed(5) + ',' + p[0].toFixed(5); };
    var x = '<?xml version="1.0" encoding="UTF-8"?>\n<nvg xmlns="http://tide.act.nato.int/schemas/2012/10/nvg" version="1.5.0">\n' +
      '  <point x="-117.3215" y="33.4120" symbol="2525c:SHGPUCIZ---E---" label="3 MRC"/>\n' +
      '  <point x="-117.3060" y="33.4330" symbol="2525c:SHGPUCF----D---" label="MORTAR PLT"/>\n' +
      '  <point x="-117.3480" y="33.3880" symbol="2525c:SSGPUCR----B---" label="POSS OP"/>\n' +
      '  <polyline points="' + [[33.405, -117.392], [33.415, -117.352], [33.423, -117.312]].map(ll).join(' ') + '" symbol="2525c:GHGPGLB---" label="Enemy FEBA (est.)"/>\n' +
      '  <polygon points="' + [[33.420, -117.330], [33.428, -117.318], [33.420, -117.305], [33.412, -117.318]].map(ll).join(' ') + '" symbol="2525c:GFGPGAE---" label="EA HAMMER"/>\n' +
      '  <circle cx="-117.3060" cy="33.4330" r="6000" symbol="2525c:GHFPAXC---" label="Mortar range (6 km)"/>\n' +
      '  <arrow points="' + [[33.452, -117.270], [33.432, -117.300], [33.415, -117.322]].map(ll).join(' ') + '" symbol="2525c:GHGPOLAGM-" label="Counter-attack axis"/>\n</nvg>\n';
    return enc(x);
  };
  function kmlDoc() {
    var now = Date.now(), track = '';
    for (var k = 0; k < 8; k++) { var p = BT.dest([33.300, -117.470], k * 450, 35); track += '<when>' + z(now - (7 - k) * 90000) + '</when><gx:coord>' + p[1].toFixed(6) + ' ' + p[0].toFixed(6) + ' 30</gx:coord>'; }
    return '<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2"><Document><name>IRON ANVIL 26 sample overlay</name>' +
      '<Style id="pl"><LineStyle><color>ffff9a4f</color><width>3</width></LineStyle></Style><Style id="obj"><LineStyle><color>ff46b6f2</color></LineStyle></Style>' +
      '<Placemark><name>PL BRASS</name><styleUrl>#pl</styleUrl><LineString><coordinates>-117.49,33.30 -117.43,33.335 -117.37,33.35 -117.30,33.36</coordinates></LineString></Placemark>' +
      '<Placemark><name>OBJ RIVET</name><styleUrl>#obj</styleUrl><Polygon><outerBoundaryIs><LinearRing><coordinates>-117.37,33.42 -117.35,33.43 -117.33,33.42 -117.35,33.41 -117.37,33.42</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>' +
      '<Placemark><name>CP FORGE MAIN</name><ExtendedData><Data name="sidc"><value>SFGPUCI---AH---</value></Data><Data name="staff"><value>Brigade main CP</value></Data></ExtendedData><Point><coordinates>-117.478,33.288,0</coordinates></Point></Placemark>' +
      '<Placemark><name>RECON 1-1</name><ExtendedData><Data name="sidc"><value>SFGPUCR----B---</value></Data></ExtendedData><gx:Track>' + track + '</gx:Track></Placemark>' +
      '</Document></kml>\n';
  }
  S.kml = function () { return enc(kmlDoc()); };
  var CRC = (function () { var t = []; for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t.push(c >>> 0); } return t; })();
  function crc32(a) { var c = 0xFFFFFFFF; for (var i = 0; i < a.length; i++) c = CRC[(c ^ a[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  S.kmz = async function () {
    var data = enc(kmlDoc()), comp = data, method = 0;
    if (typeof CompressionStream !== 'undefined') {
      comp = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer()); method = 8;
    }
    var name = enc('doc.kml'), crc = crc32(data), le = function (w, v, n) { for (var i = 0; i < n; i++) w.push((v >>> (8 * i)) & 255); };
    var b = [];
    le(b, 0x04034b50, 4); le(b, 20, 2); le(b, 0, 2); le(b, method, 2); le(b, 0, 4); le(b, crc, 4); le(b, comp.length, 4); le(b, data.length, 4); le(b, name.length, 2); le(b, 0, 2);
    b = b.concat(Array.prototype.slice.call(name), Array.prototype.slice.call(comp));
    var cd = b.length;
    le(b, 0x02014b50, 4); le(b, 20, 2); le(b, 20, 2); le(b, 0, 2); le(b, method, 2); le(b, 0, 4); le(b, crc, 4); le(b, comp.length, 4); le(b, data.length, 4); le(b, name.length, 2);
    le(b, 0, 2); le(b, 0, 2); le(b, 0, 2); le(b, 0, 2); le(b, 0, 4); le(b, 0, 4);
    b = b.concat(Array.prototype.slice.call(name));
    var cdl = b.length - cd;
    le(b, 0x06054b50, 4); le(b, 0, 2); le(b, 0, 2); le(b, 1, 2); le(b, 1, 2); le(b, cdl, 4); le(b, cd, 4); le(b, 0, 2);
    return new Uint8Array(b);
  };
  S.geojson = function () {
    var now = Date.now();
    return enc(JSON.stringify({ type: 'FeatureCollection', features: [
      { type: 'Feature', properties: { sidc: 'SFGPUCE----D---', name: '2/A ENG', time: z(now - 300000), task: 'Breach lane 1' }, geometry: { type: 'Point', coordinates: [-117.382, 33.362] } },
      { type: 'Feature', properties: { sidc: 'SFGPUCD----C---', name: 'SHORAD 2', time: z(now - 200000) }, geometry: { type: 'Point', coordinates: [-117.410, 33.346] } },
      { type: 'Feature', properties: { name: 'Breach lane 1', stroke: '#f2b646' }, geometry: { type: 'LineString', coordinates: [[-117.385, 33.360], [-117.379, 33.366], [-117.372, 33.371]] } },
      { type: 'Feature', properties: { name: 'Minefield (reported)', stroke: '#ff5a4e' }, geometry: { type: 'Polygon', coordinates: [[[-117.378, 33.368], [-117.370, 33.372], [-117.366, 33.366], [-117.374, 33.362], [-117.378, 33.368]]] } }
    ] }, null, 1));
  };
  S.csv = function () {
    var now = Date.now(), rows = ['callsign,lat,lon,sidc,time,remarks'];
    [['OP NORTH', 33.392, -117.381, 'SFGPUCR----A---', 'Observation post'], ['OP SOUTH', 33.358, -117.402, 'SFGPUCR----A---', 'Observation post'],
     ['LZ HAWK', 33.315, -117.452, 'SFGPIB---------', 'Landing zone'], ['CCP 1', 33.322, -117.441, 'SFGPUSM----A---', 'Casualty collection point'],
     ['ARTY POS 3', 33.290, -117.462, 'SFGPUCF----E---', 'Firing position']].forEach(function (r, i) {
      rows.push([r[0], r[1], r[2], r[3], z(now - (5 - i) * 120000), '"' + r[4] + '"'].join(','));
    });
    return enc(rows.join('\n') + '\n');
  };
  function aisArmour(bits) {
    var s = '';
    for (var i = 0; i < bits.length; i += 6) { var v = 0; for (var k = 0; k < 6; k++) v = v * 2 + (bits[i + k] || 0); s += String.fromCharCode(v < 40 ? v + 48 : v + 56); }
    return { s: s, fill: (6 - bits.length % 6) % 6 };
  }
  function put(bits, v, n) { if (v < 0) v += Math.pow(2, n); for (var i = n - 1; i >= 0; i--) bits.push(Math.floor(v / Math.pow(2, i)) % 2); }
  function sixText(bits, t, n) { t = (t + '@'.repeat(n)).slice(0, n).toUpperCase(); for (var i = 0; i < n; i++) { var c = t.charCodeAt(i); put(bits, c >= 64 ? c - 64 : c, 6); } }
  function nmea(body) { var c = 0; for (var i = 0; i < body.length; i++) c ^= body.charCodeAt(i); return '!' + body + '*' + pad(c.toString(16).toUpperCase(), 2, '0'); }
  S.ais = function () {
    var now = Date.now(), lines = [], ships = [[366100201, 'MV BRASS HORIZON', 70, [33.120, -117.560], 318, 12.4], [538200302, 'MT IRON TIDE', 80, [33.300, -117.720], 140, 10.1],
      [367300403, 'FV SEA ANVIL', 30, [33.240, -117.520], 250, 3.2]], seq = 0;
    ships.forEach(function (sh) {
      var b5 = []; put(b5, 5, 6); put(b5, 0, 2); put(b5, sh[0], 30); put(b5, 0, 2); put(b5, 9100000 + sh[0] % 1000, 30); sixText(b5, 'BT' + (sh[0] % 1000), 7); sixText(b5, sh[1], 20);
      put(b5, sh[2], 8); put(b5, 0, 30); put(b5, 1, 4); put(b5, 0, 20); put(b5, 80, 8); sixText(b5, 'SAN DIEGO', 20); put(b5, 0, 2);
      var a5 = aisArmour(b5), half = Math.ceil(a5.s.length / 2), id = (seq++ % 9) + 1;
      lines.push('\\c:' + Math.floor((now - 900000) / 1000) + '*00\\' + nmea('AIVDM,2,1,' + id + ',A,' + a5.s.slice(0, half) + ',0'));
      lines.push(nmea('AIVDM,2,2,' + id + ',A,' + a5.s.slice(half) + ',' + a5.fill));
      for (var k = 0; k < 4; k++) {
        var p = BT.dest(sh[3], sh[5] * 0.5144 * 300 * k, sh[4]), b = [];
        put(b, 1, 6); put(b, 0, 2); put(b, sh[0], 30); put(b, sh[2] === 30 ? 7 : 0, 4); put(b, 0, 8); put(b, Math.round(sh[5] * 10), 10); put(b, 1, 1);
        put(b, Math.round(p[1] * 600000), 28); put(b, Math.round(p[0] * 600000), 27); put(b, sh[4] * 10, 12); put(b, sh[4], 9); put(b, 30, 6); put(b, 0, 2); put(b, 0, 3); put(b, 0, 1); put(b, 0, 19);
        var a = aisArmour(b);
        lines.push('\\c:' + Math.floor((now - (3 - k) * 300000) / 1000) + '*00\\' + nmea('AIVDM,1,1,,B,' + a.s + ',' + a.fill));
      }
    });
    return enc(lines.join('\r\n') + '\r\n');
  };

  /* ------------------------------------------------------------------ the list the upload page shows */
  S.LIST = [
    { id: '4607', file: 'FORGE22_orbitK.4607', label: 'STANAG 4607', note: '8 GMTI packets: dwells, a hostile column, platform', make: S.s4607 },
    { id: '4609', file: 'EMBER08_klv.ts', label: 'STANAG 4609', note: 'MPEG-TS with 120 MISB 0601 KLV packets', make: S.s4609 },
    { id: '4545', file: 'IMG_FORGE_W.ntf', label: 'STANAG 4545', note: 'NSIF 1.0 image with corner coordinates', make: S.s4545 },
    { id: 'cot', file: 'tak_export.cot', label: 'CoT', note: '7 callsigns, 3 updates each', make: S.cot },
    { id: 'nffi', file: 'nffi_2-7inf.xml', label: 'NFFI (5527)', note: 'Friendly force tracks', make: S.nffi },
    { id: '4676', file: 'isr_tracks.xml', label: 'STANAG 4676', note: '3 ISR tracks with track points', make: S.s4676 },
    { id: 'nvg', file: 'enemy_overlay.nvg', label: 'NVG', note: 'Symbols, FEBA, engagement area, range ring', make: S.nvg },
    { id: 'kmz', file: 'sample_overlay.kmz', label: 'KMZ', note: 'Zipped KML: lines, objective, gx:Track', make: S.kmz },
    { id: 'geojson', file: 'engineers.geojson', label: 'GeoJSON', note: 'Points with sidc, a lane, a minefield', make: S.geojson },
    { id: 'csv', file: 'control_points.csv', label: 'CSV', note: 'OPs, LZ, CCP with SIDCs', make: S.csv },
    { id: 'ais', file: 'ais_receiver.nmea', label: 'AIS', note: '3 vessels: static + position reports', make: S.ais }
  ];
  S.make = async function (id) {
    var s2 = S.LIST.filter(function (x) { return x.id === id; })[0];
    return { name: s2.file, bytes: await s2.make() };
  };
})();

/* ===== admin.html ===== */
(function () {
  var esc = UI.esc;
  var TABS = [['overview', 'Overview', 'grid'], ['feeds', 'Feeds', 'feed'], ['feedback', 'Feedback', 'inbox'], ['users', 'Users', 'users'], ['demo', 'Demo data', 'database']];

  UI.page('admin', { title: 'Admin', auth: 'admin' }, function (view, ctx) {
    var tab = TABS.some(function (t) { return t[0] === ctx.args[0]; }) ? ctx.args[0] : 'overview';
    var fbFilter = 'new';
    view.innerHTML = '<div class="ui-wrap"><div class="ui-page-head"><div><h1>Admin</h1><p class="muted">Only admins see this page.</p></div></div>' +
      '<nav class="ui-tabs">' + TABS.map(function (t) {
        return '<a href="#admin/' + t[0] + '" class="' + (t[0] === tab ? 'on' : '') + '">' + UI.icon(t[2]) + t[1] + '</a>';
      }).join('') + '</nav><div data-body><div class="ui-skel"></div></div></div>';
    var body = view.querySelector('[data-body]');

    function overview() {
      return UI.api('admin_overview').then(function (d) {
        var stat = function (n, label, go) { return '<a class="ui-card ui-stat" href="#admin/' + go + '" style="text-decoration:none;color:inherit"><b>' + n + '</b><span>' + label + '</span></a>'; };
        body.innerHTML = '<div class="ad-stats">' + stat(d.users, 'people signed up', 'users') + stat(d.admins, UI.plural(d.admins, 'admin').replace(/^\d+ /, ''), 'users') +
          stat(d.feedback_new, 'new feedback', 'feedback') + stat(d.feeds, 'feeds', 'feeds') + stat(d.drops, 'drops', 'feeds') + stat(d.subscriptions, 'subscriptions', 'feeds') + '</div>' +
          '<p class="muted small" style="margin-top:18px">Demo data is <b>' + esc(d.demo.state) + '</b> (' + d.demo.counts.users + ' demo people). Manage it in the Demo data tab.</p>';
      });
    }

    function feedback() {
      return UI.api('list_feedback', null).then(function (d) {
        var items = d.items.filter(function (i) { return fbFilter === 'all' || i.status === fbFilter; });
        body.innerHTML = '<div class="ui-row" style="margin-bottom:16px"><div class="ui-seg">' + [['new', 'New'], ['read', 'Read'], ['done', 'Done'], ['all', 'All']].map(function (f) {
          var n = f[0] === 'all' ? d.items.length : d.counts[f[0]];
          return '<button data-filter="' + f[0] + '" class="' + (fbFilter === f[0] ? 'on' : '') + '">' + f[1] + ' (' + n + ')</button>';
        }).join('') + '</div></div>' +
          (items.length ? '<div class="ad-fb">' + items.map(function (i) {
            var c = i.context || {};
            return '<div class="ui-item" data-id="' + esc(i.id) + '"><div class="meta"><span class="ui-badge ' + (i.kind === 'bug' ? 'bad' : i.kind === 'idea' ? 'brand' : '') + '">' + esc(i.kind_label) + '</span>' +
              '<b>' + esc(i.name) + '</b>' + (i.email ? '<a href="mailto:' + esc(i.email) + '">' + esc(i.email) + '</a>' : '') + '<span>' + esc(UI.fmtDateTime(i.created)) + '</span></div>' +
              '<p class="msg">' + esc(i.message) + '</p>' +
              '<div class="ctx">' + esc([c.page, c.screen, c.theme, c.browser].filter(Boolean).join(' · ')) + '</div>' +
              '<textarea data-note placeholder="Private note (only admins see it)">' + esc(i.note) + '</textarea>' +
              '<div class="ui-row" style="margin-top:10px">' + ['new', 'read', 'done'].map(function (s) {
                return '<button class="ui-btn sm' + (i.status === s ? ' primary' : '') + '" data-status="' + s + '">' + s[0].toUpperCase() + s.slice(1) + '</button>';
              }).join('') + '<span class="ui-spacer"></span><button class="ui-btn sm danger" data-del-fb>' + UI.icon('trash') + 'Delete</button></div></div>';
          }).join('') + '</div>'
            : '<div class="ui-empty">' + UI.icon('inbox') + '<h3>No ' + (fbFilter === 'all' ? '' : fbFilter + ' ') + 'messages</h3><p>New feedback goes to Prepsto (prepsto.com). Older messages and requests from the app show up here.</p></div>');
      });
    }

    function users(query) {
      return UI.api('list_users', query || null).then(function (d) {
        body.innerHTML = '<form class="ui-row" data-search style="margin-bottom:14px"><input type="search" name="q" placeholder="Search by name or email" value="' + esc(query || '') + '" style="max-width:360px">' +
          '<button class="ui-btn" type="submit">' + UI.icon('search') + 'Search</button><span class="muted small">' + UI.plural(d.total, 'person', 'people') + '</span></form>' +
          '<table class="ad-users"><thead><tr><th>Name</th><th>Email</th><th>Joined</th><th>Admin</th><th>Active</th></tr></thead><tbody>' +
          d.users.map(function (u) {
            return '<tr data-id="' + esc(u.id) + '"><td><b>' + esc(u.name) + '</b></td><td class="email">' + esc(u.email) + '</td><td class="joined muted">' + esc(UI.fmtDate(u.joined)) + '</td>' +
              '<td><label class="ui-check"><input type="checkbox" data-admin' + (u.is_admin ? ' checked' : '') + '> Admin</label></td>' +
              '<td><label class="ui-check"><input type="checkbox" data-enabled' + (u.enabled ? ' checked' : '') + '> Active</label></td></tr>';
          }).join('') + '</tbody></table>';
      });
    }

    function demo() {
      return UI.api('admin_overview').then(function (d) {
        var c = d.demo.counts;
        body.innerHTML = '<div class="ui-card ui-narrow" style="margin:0"><h3>Demo data</h3>' +
          '<p class="muted">Example people and content, so the app never looks empty for the first visitors. Demo rows are flagged, so removing them never touches real data. Once removed, it stays removed until you load it again.</p>' +
          '<p>Status: <b>' + esc(d.demo.state) + '</b> · ' + Object.keys(c).map(function (k) { return c[k] + ' ' + esc(k); }).join(', ') + '</p>' +
          '<div class="ui-row"><button class="ui-btn primary" data-demo="load">' + UI.icon('refresh') + (d.demo.state === 'loaded' ? 'Reload demo data' : 'Load demo data') + '</button>' +
          '<button class="ui-btn danger" data-demo="remove">' + UI.icon('trash') + 'Remove demo data</button></div></div>';
      });
    }

    function feeds() {
      return UI.api('admin_feeds').then(function (d) {
        body.innerHTML = '<p class="muted small">Every feed, private ones included. <b>Featured</b> public feeds are subscribed automatically for people who open the map for the first time.</p>' +
          '<table class="ad-users"><thead><tr><th>Feed</th><th>Owner</th><th>Data</th><th>Featured</th><th></th></tr></thead><tbody>' +
          d.feeds.map(function (f) {
            return '<tr data-feed="' + esc(f.id) + '"><td><b style="border-left:4px solid ' + esc(f.color) + ';padding-left:8px">' + esc(f.name) + '</b><div class="small muted">' + esc(f.visibility) + (f.kind === 'plots' ? ' · plots' : '') + (f.demo ? ' · demo' : '') + ' · ' + esc(f.classification) + '</div></td>' +
              '<td class="email">' + esc(f.owner) + '</td><td class="joined muted small mono">' + f.drops + ' drops · ' + f.features + ' feat. · ' + f.subscribers + ' subs</td>' +
              '<td><label class="ui-check"><input type="checkbox" data-featured' + (f.featured ? ' checked' : '') + (f.visibility !== 'public' ? ' disabled' : '') + '> Featured</label></td>' +
              '<td><button class="ui-btn sm danger" data-delfeed>' + UI.icon('trash') + 'Delete</button></td></tr>';
          }).join('') + '</tbody></table>' + (d.total > d.feeds.length ? '<p class="muted small">Showing ' + d.feeds.length + ' of ' + d.total + '.</p>' : '');
      });
    }

    var DRAW = { overview: overview, feeds: feeds, feedback: feedback, users: users, demo: demo };

    view.addEventListener('click', function (e) {
      var f = e.target.closest('[data-filter]');
      if (f) { fbFilter = f.getAttribute('data-filter'); feedback(); return; }
      var st = e.target.closest('[data-status]');
      if (st) {
        var card = st.closest('[data-id]');
        UI.api('set_feedback_status', card.getAttribute('data-id'), st.getAttribute('data-status'), card.querySelector('[data-note]').value).then(function () { UI.toast('Saved', 'ok'); feedback(); });
        return;
      }
      var del = e.target.closest('[data-del-fb]');
      if (del) {
        UI.confirm({ title: 'Delete this message?', ok: 'Delete', danger: true }).then(function (yes) {
          if (yes) UI.api('delete_feedback', del.closest('[data-id]').getAttribute('data-id')).then(feedback);
        });
        return;
      }
      var df = e.target.closest('[data-delfeed]');
      if (df) {
        var fr = df.closest('[data-feed]');
        UI.confirm({ title: 'Delete this feed?', text: 'All its drops are deleted and it leaves the map of every subscriber.', ok: 'Delete', danger: true }).then(function (yes) {
          if (yes) UI.api('feed_delete', fr.getAttribute('data-feed')).then(function () { UI.toast('Deleted', 'ok'); feeds(); });
        });
        return;
      }
      var dm = e.target.closest('[data-demo]');
      if (dm) {
        var load = dm.getAttribute('data-demo') === 'load';
        UI.confirm({ title: load ? 'Load the demo data?' : 'Remove the demo data?', text: load ? 'Demo people and content are added (any old demo rows are replaced).' : 'Every demo row is deleted. Real data stays.', ok: load ? 'Load' : 'Remove', danger: !load })
          .then(function (yes) { if (yes) UI.busy(dm, UI.api(load ? 'demo_load' : 'demo_remove')).then(function () { UI.toast('Done', 'ok'); demo(); }); });
      }
    });
    view.addEventListener('change', function (e) {
      var ff = e.target.closest('tr[data-feed]');
      if (ff && e.target.matches('[data-featured]')) {
        var box2 = e.target;
        UI.api('admin_feature', ff.getAttribute('data-feed'), box2.checked).then(function () { UI.toast('Saved', 'ok'); }, function (err) { box2.checked = !box2.checked; UI.toast(err.message, 'error'); });
        return;
      }
      var row = e.target.closest('tr[data-id]');
      if (!row) return;
      var id = row.getAttribute('data-id'), box = e.target;
      var fn = box.hasAttribute('data-admin') ? 'set_admin' : box.hasAttribute('data-enabled') ? 'set_enabled' : null;
      if (fn) UI.api(fn, id, box.checked).then(function () { UI.toast('Saved', 'ok'); }, function (err) { box.checked = !box.checked; UI.toast(err.message, 'error'); });
    });
    view.addEventListener('submit', function (e) {
      if (e.target.matches('[data-search]')) { e.preventDefault(); users(UI.formData(e.target).q); }
    });
    return DRAW[tab]();
  });
})();

/* ===== auth.html ===== */
(function () {
  var esc = UI.esc;
  function pw(name, auto) {
    return '<div class="au-pw"><input type="password" name="' + name + '" autocomplete="' + auto + '" required minlength="8">' +
      '<button type="button" data-show>Show</button></div>';
  }
  UI.page('auth', { title: 'Sign in', auth: 'guest' }, function (view, ctx) {
    var mode = ['signup', 'reset'].indexOf(ctx.args[0]) >= 0 ? ctx.args[0] : 'login';
    function draw(msg, isErr) {
      var heading = { login: 'Welcome back', signup: 'Create your account', reset: 'Reset your password' }[mode];
      var sub = { login: 'Sign in to continue to ' + esc(UI.config.name) + '.', signup: 'It\'s free and takes a few seconds.',
        reset: 'We\'ll email you a link to choose a new password.' }[mode];
      view.innerHTML = '<div class="au-wrap"><div class="ui-card au-card">' +
        '<h1>' + heading + '</h1><p class="muted">' + sub + '</p>' +
        (mode !== 'reset' ? '<div class="ui-seg" role="tablist"><button type="button" data-mode="login" class="' + (mode === 'login' ? 'on' : '') + '">Sign in</button>' +
          '<button type="button" data-mode="signup" class="' + (mode === 'signup' ? 'on' : '') + '">Create account</button></div>' : '<div style="height:14px"></div>') +
        '<form class="ui-stack" data-form="' + mode + '" novalidate>' +
        (mode === 'signup' ? '<label class="ui-field"><span>Your name</span><input type="text" name="name" autocomplete="name" required maxlength="60"></label>' : '') +
        '<label class="ui-field"><span>Email</span><input type="email" name="email" autocomplete="email" required></label>' +
        (mode === 'login' ? '<label class="ui-field"><span>Password</span>' + pw('password', 'current-password') + '</label>' : '') +
        (mode === 'signup' ? '<label class="ui-field"><span>Password <em>(at least 8 characters)</em></span>' + pw('password', 'new-password') + '</label>' +
          (window.LegalKit ? '<div>' + LegalKit.consentField() + '</div>' : '') : '') +
        '<div data-msg role="alert"' + (msg ? ' class="' + (isErr ? 'ui-error' : 'ui-note') + '">' + esc(msg) : ' hidden>') + '</div>' +
        '<button class="ui-btn primary block" type="submit">' + { login: 'Sign in', signup: 'Create account', reset: 'Send the link' }[mode] + '</button></form>' +
        '<div class="au-links">' + (mode === 'login' ? '<a data-mode="reset">Forgot your password?</a>' : '<a data-mode="login">' + UI.icon('back') + ' Back to sign in</a>') +
        '<a href="#landing" data-go="landing">About ' + esc(UI.config.name) + '</a></div></div></div>';
      var first = view.querySelector('input');
      if (first && !msg) first.focus();
    }
    view.addEventListener('click', function (e) {
      var m = e.target.closest('[data-mode]');
      if (m) { e.preventDefault(); mode = m.getAttribute('data-mode'); history.replaceState(null, '', '#auth' + (mode === 'login' ? '' : '/' + mode)); draw(); return; }
      var s = e.target.closest('[data-show]');
      if (s) { var i = s.parentNode.querySelector('input'); i.type = i.type === 'password' ? 'text' : 'password'; s.textContent = i.type === 'password' ? 'Show' : 'Hide'; }
    });
    view.addEventListener('submit', function (e) {
      e.preventDefault();
      var form = e.target, v = UI.formData(form);
      var problem = !/^\S+@\S+\.\S+$/.test(v.email || '') ? 'Please enter a valid email address.'
        : mode !== 'reset' && (v.password || '').length < (mode === 'signup' ? 8 : 1) ? (mode === 'signup' ? 'Please choose a password of at least 8 characters.' : 'Please enter your password.')
        : mode === 'signup' && (v.name || '').trim().length < 2 ? 'Please tell us your name.' : null;
      if (problem) { say(problem, true); return; }
      if (mode === 'signup' && window.LegalKit && !LegalKit.consentChecked(form)) return;  // the kit shows its own message
      UI.busy(form.querySelector('[type=submit]'), UI.auth(mode, v)).then(function (r) {
        if (mode === 'reset' || (r && !r.me)) { mode = 'login'; draw(r && r.message, false); restore({ email: v.email }); }
        else UI.toast(mode === 'signup' ? 'Welcome to ' + UI.config.name + '!' : 'Welcome back!', 'ok');
      }, function (err) { say(err.message, true); });
    });
    function say(msg, isErr) {
      var box = view.querySelector('[data-msg]');
      box.className = isErr ? 'ui-error' : 'ui-note'; box.textContent = msg; box.hidden = false;
    }
    function restore(v) {
      ['name', 'email'].forEach(function (k) { var i = view.querySelector('[name=' + k + ']'); if (i && v[k]) i.value = v[k]; });
    }
    draw();
  });
})();

/* ===== feeds.html ===== */
(function () {
  var esc = UI.esc;
  function chips(formats) { return formats.map(function (f) { return '<span class="bt-fmt" title="' + esc(BT.FORMATS[f] || f) + '">' + esc(BT.fmtShort(f)) + '</span>'; }).join(''); }
  function card(f) {
    return '<article class="ui-card fd-card" style="--fc:' + esc(f.color) + '" data-id="' + esc(f.id) + '">' +
      '<div class="fd-meta">' + chips(f.formats) + (f.visibility === 'private' ? '<span class="ui-badge">' + UI.icon('lock') + 'Private</span>' : '') +
      (f.featured ? '<span class="ui-badge brand">' + UI.icon('star') + 'Featured</span>' : '') + (f.mine ? '<span class="ui-badge good">Yours</span>' : '') + '</div>' +
      '<h3><a href="#feeds/' + esc(f.id) + '">' + esc(f.name) + '</a></h3>' + (f.description ? '<p>' + esc(f.description) + '</p>' : '') +
      '<div class="fd-foot"><span>' + esc(f.owner) + ' · ' + UI.plural(f.drops, 'drop') + ' · ' + esc(UI.ago(f.updated)) + '</span>' +
      (f.subscribed ? '<button class="ui-btn sm" data-unsub>' + UI.icon('check') + 'Subscribed</button>' : '<button class="ui-btn sm primary" data-sub>' + UI.icon('plus') + 'Subscribe</button>') +
      '</div></article>';
  }
  function feedForm(f, cfg) {
    f = f || { visibility: 'public', classification: 'UNCLASSIFIED', color: cfg.colors[0] };
    return '<form class="ui-stack" data-feedform>' +
      '<label class="ui-field"><span>Name</span><input type="text" name="name" required minlength="3" maxlength="80" value="' + esc(f.name || '') + '" placeholder="e.g. 2-7 INF Blue Force (CoT)"></label>' +
      '<label class="ui-field"><span>Description <em>(optional)</em></span><textarea name="description" maxlength="600" rows="3" placeholder="What is in it, where it comes from, how often it updates">' + esc(f.description || '') + '</textarea></label>' +
      (f.kind === 'plots' ? '' : '<div class="ui-field"><span>Who can see it</span><div class="ui-choices">' +
        [['public', 'Public', 'globe', 'Anyone signed in can find and subscribe'], ['private', 'Private', 'lock', 'Only people with the invite code']].map(function (o) {
          return '<label class="ui-choice"><input type="radio" name="visibility" value="' + o[0] + '"' + (f.visibility === o[0] ? ' checked' : '') + '><span>' + UI.icon(o[2]) + '<span><b>' + o[1] + '</b><br><small class="muted">' + o[3] + '</small></span></span></label>';
        }).join('') + '</div></div>') +
      '<label class="ui-field"><span>Marking</span><select name="classification">' + cfg.classifications.map(function (c) { return '<option' + (c === f.classification ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select></label>' +
      '<p class="ui-hint" style="margin-top:-6px">Battle Tracker is for unclassified data only. Never upload classified or export-controlled information.</p>' +
      '<div class="ui-field"><span>Colour on the map</span><div class="fd-colors">' + cfg.colors.map(function (c) {
        return '<label><input type="radio" name="color" value="' + c + '"' + (c === f.color ? ' checked' : '') + ' aria-label="' + c + '"><span style="background:' + c + '"></span></label>';
      }).join('') + '</div></div>' +
      '<div class="ui-row end"><button type="button" class="ui-btn ghost" data-close>Cancel</button><button class="ui-btn primary" type="submit">' + UI.icon('check') + (f.id ? 'Save' : 'Create feed') + '</button></div></form>';
  }
  function newFeed(cfg, then) {
    var m = UI.modal('<h2>New feed</h2><p class="muted">A feed is a stream of map data: upload files into it, push to it from other systems, and let people subscribe.</p>' + feedForm(null, cfg));
    m.el.querySelector('[data-feedform]').addEventListener('submit', function (e) {
      e.preventDefault();
      UI.busy(e.target.querySelector('[type=submit]'), UI.api('feed_create', UI.formData(e.target))).then(function (r) { m.close(); UI.toast('Feed created', 'ok'); then(r.feed); });
    });
  }
  BT.newFeed = newFeed;

  /* ------------------------------------------------------------ the catalogue */
  function catalogue(view, ctx) {
    var query = '';
    view.innerHTML = '<div class="ui-wrap"><div class="ui-skel" style="height:320px"></div></div>';
    function draw(d) {
      var subs = d.feeds.filter(function (f) { return f.subscribed && f.kind !== 'plots'; }), mine = d.feeds.filter(function (f) { return f.mine; });
      var other = d.feeds.filter(function (f) { return !f.subscribed && !f.mine; });
      view.innerHTML = '<div class="ui-wrap"><div class="fd-top"><div><div class="eyebrow">Subscribe · publish · share</div><h1 style="margin:0">Feeds</h1>' +
        '<p class="muted" style="margin:6px 0 0">Subscribed feeds appear on your map. Uploads and pushes into a feed reach every subscriber within 20 seconds.</p></div>' +
        '<button class="ui-btn primary" data-new>' + UI.icon('plus') + 'New feed</button></div>' +
        '<div class="fd-tools"><form data-search><input type="search" name="q" placeholder="Search feeds, or a format: 4607, CoT, NFFI…" value="' + esc(query) + '"><button class="ui-btn" type="submit">' + UI.icon('search') + '<span class="hide-xs">Search</span></button></form>' +
        '<form data-join><input type="text" name="code" placeholder="Invite code (ABCD-EFGH)" maxlength="12" style="max-width:220px" required><button class="ui-btn" type="submit">' + UI.icon('key') + 'Join</button></form></div>' +
        section('Your subscriptions', subs, 'You aren\'t subscribed to anything yet. Discover feeds below.') +
        section('Your feeds', mine, 'Create a feed to publish your own files or pushes.', true) +
        section(query ? 'Results' : 'Discover', other, query ? 'No feeds match "' + esc(query) + '".' : 'You\'re subscribed to every public feed. Nice.') + '</div>';
    }
    function section(title, list, empty, newBtn) {
      return '<div class="fd-sec"><h2>' + esc(title) + '</h2><span class="muted small mono">' + list.length + '</span></div>' +
        (list.length ? '<div class="fd-grid">' + list.map(card).join('') + '</div>' :
          '<div class="ui-empty" style="margin-bottom:26px;padding:28px 16px">' + UI.icon('feed') + '<p style="margin:0">' + empty + '</p>' + (newBtn ? '<button class="ui-btn" data-new style="margin-top:12px">' + UI.icon('plus') + 'New feed</button>' : '') + '</div>');
    }
    var cfg = null;
    function load() { return UI.api('feeds_catalog', query || null).then(function (d) { cfg = d; draw(d); }); }
    view.addEventListener('click', function (e) {
      var c = e.target.closest('[data-id]');
      if (e.target.closest('[data-new]')) { newFeed(cfg, function (f) { ctx.go('feeds', f.id); }); return; }
      if (c && e.target.closest('[data-sub]')) { UI.busy(e.target.closest('button'), UI.api('feed_subscribe', c.getAttribute('data-id'))).then(function (r) { UI.toast('Subscribed: ' + r.feed.name + '. It\'s on your map now.', 'ok'); load(); }); return; }
      if (c && e.target.closest('[data-unsub]')) {
        UI.confirm({ title: 'Unsubscribe?', text: 'The feed leaves your map. You can subscribe again any time.', ok: 'Unsubscribe' }).then(function (y) { if (y) UI.api('feed_unsubscribe', c.getAttribute('data-id')).then(load); });
      }
    });
    view.addEventListener('submit', function (e) {
      e.preventDefault();
      if (e.target.matches('[data-search]')) { query = UI.formData(e.target).q.trim(); load(); }
      if (e.target.matches('[data-join]')) {
        UI.busy(e.target.querySelector('[type=submit]'), UI.api('feed_join', UI.formData(e.target).code)).then(function (r) { UI.toast('Joined ' + r.feed.name, 'ok'); ctx.go('feeds', r.feed.id); });
      }
    });
    return load();
  }

  /* ------------------------------------------------------------ one feed */
  function detail(view, ctx, id) {
    var prev = null, sel = null, d = null;
    view.innerHTML = '<div class="ui-wrap"><div class="ui-skel" style="height:420px"></div></div>';
    function draw() {
      var f = d.feed, origin = location.origin + location.pathname.replace(/\/$/, '');
      var url = origin + '/_/api/ingest/' + (f.ingest_key || '');
      view.innerHTML = '<div class="ui-wrap"><a href="#feeds" data-go="feeds" class="small">' + UI.icon('back') + ' All feeds</a>' +
        '<div class="fd-head"><div><div class="fd-meta" style="margin-top:12px">' + chips(f.formats) + '<span class="ui-badge">' + UI.icon(f.visibility === 'private' ? 'lock' : 'globe') + (f.visibility === 'private' ? 'Private' : 'Public') + '</span>' +
        '<span class="ui-badge">' + esc(f.classification) + '</span></div><h1 style="border-left:5px solid ' + esc(f.color) + ';padding-left:12px">' + esc(f.name) + '</h1>' +
        (f.description ? '<p class="muted" style="margin:0">' + esc(f.description) + '</p>' : '') + '<p class="small faint" style="margin:6px 0 0">By ' + esc(f.owner) + ' · created ' + esc(UI.fmtDate(f.created)) + '</p></div>' +
        '<div class="ui-row">' + (f.subscribed ? '<button class="ui-btn" data-unsub>' + UI.icon('check') + 'Subscribed</button>' : '<button class="ui-btn primary" data-sub>' + UI.icon('plus') + 'Subscribe</button>') +
        (f.mine && f.kind !== 'plots' ? '<a class="ui-btn" href="#upload/' + esc(f.id) + '">' + UI.icon('upload') + 'Upload</a>' : '') + '<a class="ui-btn" href="#map" data-go="map">' + UI.icon('map') + 'Map</a></div></div>' +
        '<div class="fd-stats">' + [[f.drops, 'drops'], [f.features, 'features'], [f.subscribers, f.subscribers === 1 ? 'subscriber' : 'subscribers'], [UI.ago(f.updated) || '—', 'last update']].map(function (s) {
          return '<div class="ui-card ui-stat"><b>' + esc(s[0]) + '</b><span>' + s[1] + '</span></div>'; }).join('') + '</div>' +
        '<div class="fd-cols"><div class="ui-card" style="padding:0;overflow:hidden"><div style="padding:16px 16px 6px"><h3 style="margin:0">Drops</h3><p class="muted small" style="margin:4px 0 8px">Each file, push or plot in this feed. Click one to preview it.</p></div>' +
        (d.drops.length ? '<div>' + d.drops.map(function (r) {
          return '<div class="fd-drop' + (sel === r.id ? ' on' : '') + '" data-drop="' + esc(r.id) + '"><span class="bt-fmt">' + esc(BT.fmtShort(r.fmt)) + '</span><div><b>' + esc(r.filename) + '</b><span class="m">' +
            UI.plural(r.n, 'feature') + ' · ' + esc(r.by) + ' · ' + esc(BT.dtg(r.created)) + (r.source === 'push' ? ' · push' : '') + '</span></div>' +
            (r.can_delete ? '<button class="ui-btn ghost icon sm" data-del aria-label="Delete drop">' + UI.icon('trash') + '</button>' : '<span></span>') + '</div>';
        }).join('') + (d.total > d.drops.length ? '<p class="muted small" style="padding:12px 16px">Showing the newest ' + d.drops.length + ' of ' + d.total + '.</p>' : '') + '</div>'
          : '<div class="ui-empty" style="margin:0 16px 16px">' + UI.icon('inbox') + '<h3>No data yet</h3><p>' + (f.mine ? 'Upload a file or push to the endpoint.' : 'Nothing has been published here yet.') + '</p></div>') + '</div>' +
        '<div class="ui-stack"><div class="ui-card"><div class="fd-prev" data-prev></div><div data-previnfo class="small muted">Pick a drop to preview it here.</div></div>' +
        (f.mine ? ownerTools(f, url) : '') + '</div></div></div>';
      if (d.drops.length && !sel) showDrop(d.drops[0].id);
      else if (sel) showDrop(sel);
    }
    function ownerTools(f, url) {
      if (f.kind === 'plots') return '<div class="ui-card"><h3>My plots</h3><p class="muted small">Place symbols from the Symbols page or remove them on the map. Only you see this feed.</p></div>';
      var curl = 'curl -X POST "' + url + '?name=Patrol%20update" \\\n  -H "Content-Type: application/xml" \\\n  --data-binary @event.cot';
      var sample = '<event version="2.0" uid="TEST-1" type="a-f-G-U-C-I" how="m-g" time="' + new Date().toISOString() + '" start="' + new Date().toISOString() + '" stale="' + new Date(Date.now() + 300000).toISOString() + '">\n  <point lat="33.33" lon="-117.41" hae="40" ce="10" le="10"/>\n  <detail><contact callsign="TEST 1"/></detail>\n</event>';
      return '<div class="ui-card ui-stack"><h3 style="margin:0">' + UI.icon('feed') + ' Push endpoint</h3>' +
        '<p class="muted small" style="margin:0">Other systems (a TAK server bridge, a gateway, a script) can POST <b>CoT XML</b> or <b>GeoJSON</b> here. Keep the key secret: anyone with it can post to this feed.</p>' +
        '<div class="fd-key"><code data-url>' + esc(url) + '</code><button class="ui-btn sm" data-copy="' + esc(url) + '">' + UI.icon('copy') + 'Copy</button></div>' +
        '<div class="fd-curl">' + esc(curl) + '</div>' +
        '<details><summary class="small" style="cursor:pointer;font-weight:600">Try a push from here</summary><form data-push class="ui-stack" style="margin-top:10px"><textarea name="body" rows="7" class="mono" style="font-size:.78rem">' + esc(sample) + '</textarea>' +
        '<div class="ui-row end"><button class="ui-btn sm primary" type="submit">' + UI.icon('arrow') + 'Send push</button></div></form></details>' +
        '<div class="ui-row"><button class="ui-btn sm ghost" data-rotate="ingest">' + UI.icon('refresh') + 'New key</button></div></div>' +
        (f.visibility === 'private' ? '<div class="ui-card ui-stack"><h3 style="margin:0">' + UI.icon('key') + ' Invite code</h3><p class="muted small" style="margin:0">People enter this on the Feeds page to subscribe to this private feed.</p>' +
          '<div class="fd-key"><code style="font-size:1.1rem;letter-spacing:.12em;text-align:center">' + esc(f.invite_code) + '</code><button class="ui-btn sm" data-copy="' + esc(f.invite_code) + '">' + UI.icon('copy') + 'Copy</button></div>' +
          '<div class="ui-row"><button class="ui-btn sm ghost" data-rotate="invite">' + UI.icon('refresh') + 'New code</button></div></div>' : '') +
        '<div class="ui-card ui-row between"><div><h3 style="margin:0 0 2px">Settings</h3><span class="muted small">Name, visibility, marking, colour</span></div><div class="ui-row"><button class="ui-btn sm" data-edit>' + UI.icon('edit') + 'Edit</button>' +
        '<button class="ui-btn sm danger" data-delfeed>' + UI.icon('trash') + 'Delete</button></div></div>';
    }
    function showDrop(dropId) {
      sel = dropId;
      Array.prototype.forEach.call(view.querySelectorAll('[data-drop]'), function (el) { el.classList.toggle('on', el.getAttribute('data-drop') === dropId); });
      return UI.apiQuiet('drop_features', dropId).then(function (r) {
        var box = view.querySelector('[data-prev]');
        if (!box || sel !== dropId) return;
        if (prev) { prev.map.remove(); prev = null; }
        if (window.L) prev = BT.preview(box, r.features, { color: d.feed.color });
        var s = r.drop.summary || {};
        view.querySelector('[data-previnfo]').innerHTML = '<b>' + esc(r.drop.filename) + '</b> · ' + esc(r.drop.fmt_label) + '<dl class="bt-kv" style="margin-top:8px">' +
          Object.keys(s).slice(0, 14).map(function (k) { return '<dt>' + esc(k.replace(/_/g, ' ')) + '</dt><dd>' + esc(typeof s[k] === 'object' ? JSON.stringify(s[k]) : s[k]) + '</dd>'; }).join('') + '</dl>';
      });
    }
    function load() { return UI.api('feed_get', id).then(function (r) { d = r; draw(); }); }
    view.addEventListener('click', function (e) {
      var t = e.target;
      var cp = t.closest('[data-copy]');
      if (cp) { (navigator.clipboard ? navigator.clipboard.writeText(cp.getAttribute('data-copy')) : Promise.reject()).then(function () { UI.toast('Copied', 'ok'); }, function () { UI.toast('Select the text and copy it.'); }); return; }
      if (t.closest('[data-sub]')) { UI.api('feed_subscribe', id).then(function () { UI.toast('Subscribed. It\'s on your map now.', 'ok'); load(); }); return; }
      if (t.closest('[data-unsub]')) { UI.api('feed_unsubscribe', id).then(function () { UI.toast('Unsubscribed'); load(); }); return; }
      if (t.closest('[data-rotate]')) {
        var which = t.closest('[data-rotate]').getAttribute('data-rotate');
        UI.confirm({ title: which === 'ingest' ? 'Make a new push key?' : 'Make a new invite code?', text: 'The old one stops working right away.', ok: 'Make a new one' })
          .then(function (y) { if (y) UI.api('feed_rotate', id, which).then(function () { UI.toast('Done', 'ok'); load(); }); });
        return;
      }
      if (t.closest('[data-edit]')) {
        var m = UI.modal('<h2>Feed settings</h2>' + feedForm(d.feed, d));
        m.el.querySelector('[data-feedform]').addEventListener('submit', function (ev) {
          ev.preventDefault();
          UI.busy(ev.target.querySelector('[type=submit]'), UI.api('feed_update', id, UI.formData(ev.target))).then(function () { m.close(); UI.toast('Saved', 'ok'); load(); });
        });
        return;
      }
      if (t.closest('[data-delfeed]')) {
        UI.confirm({ title: 'Delete "' + d.feed.name + '"?', text: 'Every drop in it is deleted and it leaves every subscriber\'s map. This can\'t be undone.', ok: 'Delete feed', danger: true })
          .then(function (y) { if (y) UI.api('feed_delete', id).then(function () { UI.toast('Feed deleted'); ctx.go('feeds'); }); });
        return;
      }
      var row = t.closest('[data-drop]');
      if (row && t.closest('[data-del]')) {
        UI.confirm({ title: 'Delete this drop?', text: 'Its features leave the map for every subscriber.', ok: 'Delete', danger: true }).then(function (y) {
          if (y) UI.api('drop_delete', row.getAttribute('data-drop')).then(function () { if (sel === row.getAttribute('data-drop')) sel = null; UI.toast('Deleted'); load(); });
        });
        return;
      }
      if (row) showDrop(row.getAttribute('data-drop'));
    });
    view.addEventListener('submit', function (e) {
      if (!e.target.matches('[data-push]')) return;
      e.preventDefault();
      UI.busy(e.target.querySelector('[type=submit]'), UI.api('ingest_test', id, e.target.body.value)).then(function (r) { UI.toast('Push accepted: ' + UI.plural(r.kept, 'feature') + ' (' + r.fmt + ')', 'ok'); sel = r.drop_id; load(); });
    });
    return { ready: load(), destroy: function () { if (prev) prev.map.remove(); } };
  }

  UI.page('feeds', { title: 'Feeds', nav: 'Feeds', icon: 'feed', auth: 'user', order: 20 }, function (view, ctx) {
    return ctx.args[0] ? detail(view, ctx, ctx.args[0]) : catalogue(view, ctx);
  });
})();

/* ===== landing.html ===== */
(function () {
  var COPY = {
    eyebrow: 'Common operational picture · in your browser',
    title: 'Every feed.<br><em>One picture.</em>',
    lead: 'Battle Tracker reads STANAG 4607 radar, 4609 video metadata, 4545 imagery, CoT, NFFI, NVG, KML and more, and puts it on one live map in MIL-STD-2525 / APP-6 symbols. Subscribe to feeds, publish your own, replay the last hours.',
    cta: 'Light the forge, it\'s free',
    proof: ['11 formats, parsed on your device', 'Live feeds every 20 seconds', 'Unclassified exercise data only'],
    formats: [['4607', 'GMTI'], ['4609', 'FMV KLV'], ['4545', 'NSIF'], ['4676', 'ISR tracks'], ['5527', 'NFFI'], ['CoT', 'TAK'], ['NVG', 'overlays'], ['KML', 'KMZ'], ['GeoJSON', ''], ['CSV', ''], ['AIS', 'NMEA']],
    stepsTitle: 'How it works',
    stepsLead: 'From a folder of files to a shared picture in a minute.',
    steps: [['Subscribe', 'Pick feeds from the catalogue (blue force, OPFOR overlays, GMTI orbits, UAV footprints) or join a private one with its invite code.'],
            ['Drop your files', 'Battle Tracker detects the format, parses it in your browser and shows you what it found before anything is published.'],
            ['Read the picture', 'Replay the timeline, follow a track, measure range and bearing in MGRS, and click any symbol to decode it.']],
    featuresTitle: 'Forged for the staff tent',
    features: [['radar', 'GMTI that moves', 'STANAG 4607 dwells and moving-target reports fade with age, with the radar footprint and the platform\'s orbit.'],
               ['camera', 'FMV footprints', 'STANAG 4609 transport streams: the KLV (MISB 0601) platform track, sensor footprint and frame centre, even from multi-GB files.'],
               ['symbol', 'Real symbology', 'MIL-STD-2525C / APP-6B symbols with echelons, HQ and task-force modifiers. 2525D/E number codes render too.'],
               ['clock', 'Replay the fight', 'One timeline across every feed. Play at 60× or 1200×, follow a unit, see who moved where and when.'],
               ['feed', 'Subscribe and push', 'Public or invite-only feeds. Other systems POST CoT or GeoJSON to a feed\'s endpoint and every subscriber sees it.'],
               ['lock', 'Unclassified by design', 'Files marked above UNCLASSIFIED are refused. Built for exercises, training, wargaming and simulation.']],
    who: [['Exercise control', 'Put white cell, blue and red feeds on one screen and replay the day at the hot wash-up.'],
          ['Intelligence staff', 'Overlay the SITEMP on GMTI and FMV footprints and see where collection actually looked.'],
          ['Sim & training developers', 'Check what your simulator exports: 4607, CoT or NFFI, decoded field by field.'],
          ['Instructors & students', 'Teach symbology with a builder, a decoder and a live picture to practise on.']],
    faq: [['Which formats does it read?', 'STANAG 4607 (GMTI), STANAG 4609 (MPEG-TS or raw KLV with MISB ST 0601), STANAG 4545 / NITF 2.1 image corners, STANAG 4676 tracks, STANAG 5527 NFFI, Cursor on Target, NATO Vector Graphics, KML and KMZ, GeoJSON, CSV and AIS NMEA. Try the samples on the Upload page.'],
          ['Is my file sent anywhere?', 'Files are read in your browser. Only the map features you choose to publish (positions, symbols, labels, times) are stored, in the feed you pick. The original file never leaves your device.'],
          ['Can I use it for real operations or classified data?', 'No. Battle Tracker is not accredited for classified information and is not a targeting or command system. It refuses files marked above UNCLASSIFIED; please only use unclassified exercise, training or simulated data.'],
          ['Does it work with TAK?', 'Yes, in both directions you\'d expect from a first version: upload CoT exports, or have a bridge POST CoT events to a feed\'s push endpoint.'],
          ['Is it free?', 'Yes. Make an account, subscribe to the demo exercise, upload your own files.'],
          ['Does it work on a phone or tablet?', 'Yes. The map, the timeline and the layers fit a phone screen.']],
    bandTitle: 'The forge is hot',
    bandLead: 'The demo exercise IRON ANVIL 26 is live: GMTI, FMV, blue force, OPFOR and a maritime picture.'
  };

  /* A tactical display: dark screen (always), drawn in SVG. */
  function heroArt() {
    var fr = function (x, y, inner) { return '<g transform="translate(' + x + ' ' + y + ')"><rect x="-17" y="-11" width="34" height="22" fill="#80e0ff" stroke="#0b0d0f" stroke-width="2"/>' + inner + '</g>'; };
    var inf = '<path d="M-17 -11 17 11M17 -11 -17 11" stroke="#0b0d0f" stroke-width="2"/>';
    var arm = '<ellipse cx="0" cy="0" rx="11" ry="5.5" fill="none" stroke="#0b0d0f" stroke-width="2"/>';
    var ho = function (x, y, inner) { return '<g transform="translate(' + x + ' ' + y + ')"><path d="M0 -17 17 0 0 17 -17 0z" fill="#ff8080" stroke="#0b0d0f" stroke-width="2"/>' + inner + '</g>'; };
    var dots = '';
    for (var i = 0; i < 14; i++) dots += '<circle cx="' + (330 + i * 9 - (i % 3) * 2) + '" cy="' + (98 + i * 6.2 + (i % 2) * 3) + '" r="3.2" fill="' + (i < 5 ? '#ffb347' : i < 10 ? '#ff7a2f' : '#a8410f') + '" style="animation-delay:' + (i * .22) + 's"/>';
    for (i = 0; i < 9; i++) dots += '<circle cx="' + (92 + i * 13) + '" cy="' + (322 - i * 11) + '" r="3" fill="#ff7a2f" style="animation-delay:' + (i * .3) + 's"/>';
    return '<div class="lp-art" aria-hidden="true"><div class="lp-bezel riveted"><svg viewBox="0 0 560 420" xmlns="http://www.w3.org/2000/svg">' +
      '<defs><pattern id="lpg" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#ffffff" stroke-opacity=".05"/></pattern>' +
      '<linearGradient id="lps" x1="0" x2="1"><stop offset="0" stop-color="#0d2230"/><stop offset="1" stop-color="#0b1a24"/></linearGradient>' +
      '<radialGradient id="lpw" cx="0" cy="1" r="1"><stop offset="0" stop-color="#ff7a2f" stop-opacity=".0"/><stop offset=".6" stop-color="#ff7a2f" stop-opacity=".16"/><stop offset="1" stop-color="#ff7a2f" stop-opacity=".05"/></radialGradient></defs>' +
      '<rect width="560" height="420" fill="#14181b"/>' +
      '<path d="M0 420V250C60 262 90 300 140 318S230 352 262 420Z" fill="url(#lps)"/>' +
      '<path d="M0 250C60 262 90 300 140 318S230 352 262 420" fill="none" stroke="#3b5566" stroke-width="2"/>' +
      '<path d="M40 90C120 120 150 150 210 160S330 200 400 190 520 230 560 226M120 0C140 80 200 120 230 200S240 330 300 420" fill="none" stroke="#2a3036" stroke-width="5"/>' +
      '<path d="M40 90C120 120 150 150 210 160S330 200 400 190 520 230 560 226" fill="none" stroke="#3a4148" stroke-width="1.5"/>' +
      '<rect width="560" height="420" fill="url(#lpg)"/>' +
      '<path d="M-30 470 250 40A330 330 0 0 1 520 210Z" fill="url(#lpw)" stroke="#ff7a2f" stroke-opacity=".55" stroke-dasharray="5 5"/>' +
      '<path d="M60 236C150 200 260 214 330 168S470 120 540 132" fill="none" stroke="#4fb3ff" stroke-width="2.4" stroke-dasharray="10 7"/>' +
      '<text x="470" y="122" fill="#4fb3ff" font-family="IBM Plex Mono, monospace" font-size="12" font-weight="600">PL IRON</text>' +
      '<ellipse cx="420" cy="88" rx="70" ry="40" fill="#f2b646" fill-opacity=".08" stroke="#f2b646" stroke-width="2"/>' +
      '<text x="390" y="56" fill="#f2b646" font-family="IBM Plex Mono, monospace" font-size="12" font-weight="600">OBJ FORGE</text>' +
      '<path d="M372 68 452 64 462 112 380 116Z" fill="#f2b646" fill-opacity=".14" stroke="#f2b646" stroke-dasharray="3 3"/>' +
      '<g class="lp-mti">' + dots + '</g>' +
      fr(150, 268, inf) + fr(214, 238, inf) + fr(250, 290, arm) + fr(120, 214, inf + '<path d="M-17 -11V-30" stroke="#0b0d0f" stroke-width="2"/>') +
      '<text x="168" y="250" fill="#ece8e1" font-family="IBM Plex Mono, monospace" font-size="10">A/1-5</text>' +
      ho(408, 150, inf) + ho(470, 186, arm) + ho(440, 92, '<path d="M-6 -6 6 6M6 -6 -6 6" stroke="#0b0d0f" stroke-width="2"/>') +
      '<g transform="translate(96 380)"><rect x="-13" y="-13" width="26" height="26" fill="#aaffaa" stroke="#0b0d0f" stroke-width="2"/></g>' +
      '<g transform="translate(300 74)"><path d="M-16 6A16 16 0 0 1 16 6" fill="#80e0ff" stroke="#0b0d0f" stroke-width="2"/><path d="M-9 0 0 -5 9 0 0 3Z" fill="#0b0d0f"/></g>' +
      '<path d="M300 74 395 92" stroke="#f2b646" stroke-width="1.4" stroke-dasharray="2 4"/>' +
      '<rect x="0" y="0" width="560" height="20" fill="#1d7a3a"/><text x="280" y="14" text-anchor="middle" fill="#fff" font-family="IBM Plex Mono, monospace" font-size="10.5" font-weight="700" letter-spacing="2.5">UNCLASSIFIED // EXERCISE</text>' +
      '<rect x="0" y="384" width="560" height="36" fill="#1a1d20"/><rect x="58" y="400" width="390" height="4" rx="2" fill="#2c3136"/><rect x="58" y="400" width="330" height="4" rx="2" fill="#ff7a2f"/>' +
      '<circle cx="388" cy="402" r="7" fill="#ffb347" stroke="#1a1d20" stroke-width="2"/><path d="M22 394v16l13-8z" fill="#ece8e1"/>' +
      '<rect x="470" y="392" width="44" height="20" rx="3" fill="#c8372d"/><text x="492" y="406" text-anchor="middle" fill="#fff" font-family="IBM Plex Mono, monospace" font-size="10" font-weight="700" letter-spacing="1.5">LIVE</text>' +
      '<text x="520" y="406" fill="#a39e95" font-family="IBM Plex Mono, monospace" font-size="9"> </text>' +
      '</svg></div><div class="lp-float"><span class="dot"></span><div><b>FORGE 21 · 4607</b><span>dwell 23 · 48 movers · 11S MS 98 95</span></div></div></div>';
  }

  UI.page('landing', { title: 'Welcome' }, function (view, ctx) {
    var me = ctx.me, C = COPY, esc = UI.esc;
    var primary = me ? '<a class="ui-btn primary lg" href="#map" data-go="map">Open the map ' + UI.icon('arrow') + '</a>'
      : '<a class="ui-btn primary lg" href="#auth/signup" data-go="auth/signup">' + esc(C.cta) + ' ' + UI.icon('arrow') + '</a>' +
        '<a class="ui-btn lg" href="#auth" data-go="auth">I have an account</a>';
    view.innerHTML =
      '<section class="lp-hero"><div class="ui-wrap"><div>' +
        '<div class="eyebrow">' + esc(C.eyebrow) + '</div><h1>' + C.title + '</h1><p class="lp-lead">' + esc(C.lead) + '</p>' +
        '<div class="lp-cta">' + primary + '</div>' +
        '<div class="lp-proof">' + C.proof.map(function (p) { return '<span>' + UI.icon('check') + esc(p) + '</span>'; }).join('') + '</div>' +
      '</div>' + heroArt() + '</div></section>' +
      '<section class="lp-section" style="padding-top:28px"><div class="ui-wrap"><div class="lp-strip">' + C.formats.map(function (f) { return '<span><b>' + esc(f[0]) + '</b>' + (f[1] ? ' ' + esc(f[1]) : '') + '</span>'; }).join('') + '</div></div></section>' +
      '<section class="lp-section" id="how"><div class="ui-wrap"><div class="lp-head"><h2>' + esc(C.stepsTitle) + '</h2><p>' + esc(C.stepsLead) + '</p></div>' +
        '<div class="lp-steps">' + C.steps.map(function (s) { return '<div class="ui-card lp-step riveted"><h3>' + esc(s[0]) + '</h3><p class="muted">' + esc(s[1]) + '</p></div>'; }).join('') + '</div></div></section>' +
      '<section class="lp-section"><div class="ui-wrap"><div class="lp-head"><h2>' + esc(C.featuresTitle) + '</h2></div>' +
        '<div class="ui-grid">' + C.features.map(function (f) { return '<div class="ui-card lp-feature">' + UI.icon(f[0]) + '<h3>' + esc(f[1]) + '</h3><p>' + esc(f[2]) + '</p></div>'; }).join('') + '</div></div></section>' +
      '<section class="lp-section"><div class="ui-wrap"><div class="lp-head"><h2>Who it\'s for</h2></div><div class="lp-who">' +
        C.who.map(function (w) { return '<div class="ui-card"><h3>' + esc(w[0]) + '</h3><p>' + esc(w[1]) + '</p></div>'; }).join('') + '</div></div></section>' +
      '<section class="lp-section"><div class="ui-wrap"><div class="lp-head"><h2>Questions</h2></div><div class="lp-faq">' +
        C.faq.map(function (q) { return '<details><summary>' + esc(q[0]) + '</summary><p>' + esc(q[1]) + '</p></details>'; }).join('') + '</div></div></section>' +
      '<section class="lp-section"><div class="ui-wrap"><div class="lp-band"><div><h2>' + esc(C.bandTitle) + '</h2><p>' + esc(C.bandLead) + '</p></div>' +
        (me ? '<a class="ui-btn primary lg" href="#map" data-go="map">Open the map</a>' : '<a class="ui-btn primary lg" href="#auth/signup" data-go="auth/signup">' + esc(C.cta) + '</a>') +
      '</div><p class="lp-note">Battle Tracker is an independent training tool. It is not affiliated with or endorsed by NATO or any armed force. STANAG, MIL-STD and APP-6 are standards of their owners.</p></div></section>';
  });
})();

/* ===== map.html ===== */
(function () {
  var esc = UI.esc;
  var WINDOWS = [[5, '5 min'], [15, '15 min'], [60, '1 hour'], [180, '3 hours'], [0, 'All']];

  UI.page('map', { title: 'Map', nav: 'Map', icon: 'map', auth: 'user', order: 10 }, function (view, ctx) {
    var st = { labels: UI.store.get('labels', true), trails: UI.store.get('trails', true), size: UI.store.get('symsize', 28), win: UI.store.get('mtiwin', 15),
      base: UI.store.get('base', null) || BT.defaultBase(), tab: 'layers', live: true, cursor: null, playing: false, speed: 60, sel: null, q: '', follow: false };
    var placing = ctx.args[0] === 'place' && ctx.args[1] ? String(ctx.args[1]).toUpperCase() : null;
    var data = null, idx = null, map = null, grp = null, tiles = null, ren = null, measure = null, poll = null, raf = null, playTimer = null, dead = false, fitted = false;

    view.innerHTML = '<div class="bt-mapwrap" data-wrap><div class="bt-banner ex" data-banner>UNCLASSIFIED // EXERCISE</div><div class="bt-stage">' +
      '<aside class="bt-side" data-side aria-label="Layers and tracks"><nav class="ui-tabs" data-tabs></nav><div class="bt-side-body" data-sidebody><div class="ui-skel" style="height:300px"></div></div></aside>' +
      '<div class="bt-map" data-mapbox><div data-map></div>' +
      '<div class="bt-tools"><button class="ui-btn bt-sheet-btn" data-sheet>' + UI.icon('layers') + 'Layers</button>' +
      '<select data-base aria-label="Base map">' + Object.keys(BT.BASEMAPS).map(function (k) { return '<option value="' + k + '"' + (k === st.base ? ' selected' : '') + '>' + esc(BT.BASEMAPS[k].name) + '</option>'; }).join('') + '</select>' +
      '<button class="ui-btn" data-fit title="Zoom to everything">' + UI.icon('grid') + '<span class="hide-sm">Fit</span></button>' +
      '<button class="ui-btn" data-measure title="Measure distance and bearing">' + UI.icon('ruler') + '<span class="hide-sm">Measure</span></button></div>' +
      '<div class="bt-readout" data-readout>—</div><div data-insp></div><div data-placebar></div><div data-emptymap></div></div></div>' +
      '<div class="bt-time"><button class="ui-btn icon sm" data-play aria-label="Play">' + playIcon(false) + '</button>' +
      '<input type="range" min="0" max="1000" value="1000" data-slider aria-label="Time"><div class="lbl" data-tlabel>—</div>' +
      '<select class="speed" data-speed aria-label="Replay speed"><option value="10">10×</option><option value="60" selected>60×</option><option value="300">300×</option><option value="1200">1200×</option></select>' +
      '<button class="bt-live on" data-live title="Follow the newest data">LIVE</button></div></div>';
    var $ = function (s) { return view.querySelector(s); };
    var wrap = $('[data-wrap]'), slider = $('[data-slider]');

    function playIcon(on) { return on ? '<svg class="ui-ic" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>'
      : '<svg class="ui-ic" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>'; }

    /* ------------------------------------------------------------ the index: tracks, groups, statics */
    function buildIndex(d) {
      var feeds = {}, items = [], tracks = {}, groups = {}, tmin = Infinity, tmax = -Infinity;
      d.feeds.forEach(function (f) { feeds[f.id] = f; });
      d.drops.forEach(function (dr) {
        var feed = feeds[dr.feed];
        if (!feed) return;
        dr.features.forEach(function (f) {
          var t = f.t ? Date.parse(f.t) : null;
          if (t != null && !isNaN(t)) { if (t < tmin) tmin = t; if (t > tmax) tmax = t; } else t = null;
          var it = { f: f, feed: feed, drop: dr, t: t };
          if (f.id && !f.m) {
            var key = feed.id + '|' + f.id + '|' + f.g;
            (f.g === 'pt' ? tracks : groups)[key] = ((f.g === 'pt' ? tracks : groups)[key] || []).concat([it]);
          } else items.push(it);
        });
      });
      [tracks, groups].forEach(function (o) { Object.keys(o).forEach(function (k) { o[k].sort(function (a, b) { return (a.t || 0) - (b.t || 0); }); }); });
      if (!isFinite(tmin)) { tmin = Date.now() - 3600000; tmax = Date.now(); }
      if (tmax - tmin < 60000) tmin = tmax - 60000;
      return { feeds: feeds, items: items, tracks: tracks, groups: groups, tmin: tmin, tmax: tmax };
    }
    function latest(list, cursor) {
      var best = null;
      for (var i = 0; i < list.length; i++) { if (list[i].t == null || list[i].t <= cursor) best = i; else break; }
      return best;
    }
    function visibleFeed(feed) { return feed.shown; }

    /* ------------------------------------------------------------ drawing */
    function render() {
      raf = null;
      if (!map || !idx) return;
      grp.clearLayers();
      var cursor = st.cursor, win = st.win ? st.win * 60000 : Infinity, dark = (BT.BASEMAPS[st.base] || {}).dark;
      var pic = { friend: 0, hostile: 0, neutral: 0, unknown: 0, mti: 0 }, shownTracks = [];
      var labels = st.labels && map.getZoom() >= 12;  // labels only when zoomed in, so the picture stays readable
      var opt = function (it, extra) { return Object.assign({ color: it.feed.color, dark: dark, labels: labels, size: st.size, renderer: ren }, extra || {}); };
      var hook = function (lyr, it, track) { if (lyr) { lyr.on('click', function (e) { L.DomEvent.stopPropagation(e); select(it, track); }); grp.addLayer(lyr); } };
      idx.items.forEach(function (it) {
        if (!visibleFeed(it.feed)) return;
        if (it.t != null && it.t > cursor) return;
        if ((it.f.m || it.f.e) && it.t != null && cursor - it.t > win) return;
        var age = it.f.m && it.t != null ? Math.min(1, (cursor - it.t) / (isFinite(win) ? win : (idx.tmax - idx.tmin || 1))) : 0;
        if (it.f.m) pic.mti++;
        else if (it.f.g === 'pt' && it.f.s) pic[BT.affClass(it.f.s)]++;
        hook(BT.layerFor(it.f, opt(it, { age: age, sel: st.sel && st.sel.it === it })), it);
      });
      Object.keys(idx.groups).forEach(function (k) {
        var list = idx.groups[k], i = latest(list, cursor);
        if (i == null || !visibleFeed(list[i].feed)) return;
        var it = list[i];
        if (it.f.e && it.t != null && cursor - it.t > Math.max(win, 20 * 60000)) return;
        hook(BT.layerFor(it.f, opt(it)), it);
      });
      Object.keys(idx.tracks).forEach(function (k) {
        var list = idx.tracks[k], i = latest(list, cursor);
        if (i == null || !visibleFeed(list[i].feed)) return;
        var it = list[i];
        if (st.trails && i > 0) {
          var pts = [];
          for (var j = Math.max(0, i - 60); j <= i; j++) if (list[j].t == null || cursor - list[j].t < 6 * 3600000) pts.push(list[j].f.c);
          if (pts.length > 1) grp.addLayer(L.polyline(pts, { color: it.feed.color, weight: 2, opacity: .75, dashArray: '2 5', renderer: ren, interactive: false }));
        }
        var selected = st.sel && st.sel.key === k;
        var lyr = BT.layerFor(it.f, opt(it, { sel: selected }));
        if (lyr && lyr.setOpacity && it.t != null && cursor - it.t > 2 * 3600000) lyr.setOpacity(.5);  // stale
        hook(lyr, it, { key: k, list: list, i: i });
        if (it.f.s) pic[BT.affClass(it.f.s)]++;
        shownTracks.push({ key: k, it: it, n: list.length, i: i });
        if (selected && st.follow) map.panTo(it.f.c, { animate: false });
      });
      st.shownTracks = shownTracks;
      st.pic = pic;
      drawPic(); if (st.tab === 'tracks') drawTracks();
      drawTime();
    }
    function schedule() { if (!raf) raf = requestAnimationFrame(render); }

    /* ------------------------------------------------------------ side panel */
    function drawTabs() {
      $('[data-tabs]').innerHTML = [['layers', 'Layers', 'layers'], ['tracks', 'Tracks', 'target']].map(function (t) {
        return '<button data-tab="' + t[0] + '" class="' + (st.tab === t[0] ? 'on' : '') + '">' + UI.icon(t[2]) + t[1] + (t[0] === 'tracks' && st.shownTracks ? ' <span class="count">' + st.shownTracks.length + '</span>' : '') + '</button>';
      }).join('');
    }
    function drawPic() {
      var p = st.pic || {}, el = view.querySelector('[data-pic]');
      if (!el) return;
      el.innerHTML = [['friend', 'Friend'], ['hostile', 'Hostile'], ['neutral', 'Neutral'], ['unknown', 'Unknown'], ['mti', 'Movers']].map(function (k) {
        return '<div class="' + k[0] + '"><b>' + (p[k[0]] || 0) + '</b><span>' + k[1] + '</span></div>';
      }).join('');
    }
    function drawSide() {
      drawTabs();
      var body = $('[data-sidebody]');
      if (st.tab === 'tracks') { body.innerHTML = '<input type="search" placeholder="Find a callsign or unit" data-q value="' + esc(st.q) + '" style="margin-bottom:10px"><div data-tracklist></div>'; drawTracks(); return; }
      var feeds = data.feeds;
      body.innerHTML = '<div class="bt-pic" data-pic></div>' +
        '<div class="bt-h">Feeds <a href="#feeds" data-go="feeds">Manage</a></div>' +
        (feeds.length ? feeds.map(function (f) {
          return '<label class="bt-layer' + (f.shown ? '' : ' off') + '" data-feed="' + esc(f.id) + '"><input type="checkbox" data-show' + (f.shown ? ' checked' : '') + '>' +
            '<div><div class="nm"><i style="background:' + esc(f.color) + '"></i>' + esc(f.name) + '</div>' +
            '<div class="meta">' + f.formats.map(BT.fmtShort).join(' · ') + (f.formats.length ? ' · ' : '') + UI.plural(f.drops, 'drop') + ' · ' + esc(UI.ago(f.updated)) + '</div></div></label>';
        }).join('') : '<p class="muted small">You aren\'t subscribed to any feeds yet.</p>') +
        '<div class="bt-h">Display</div><div class="bt-opts">' +
        '<label class="bt-opt"><span>Labels <small class="faint">(zoomed in)</small></span><input type="checkbox" data-opt="labels"' + (st.labels ? ' checked' : '') + '></label>' +
        '<label class="bt-opt"><span>Track trails</span><input type="checkbox" data-opt="trails"' + (st.trails ? ' checked' : '') + '></label>' +
        '<label class="bt-opt"><span>Symbol size</span><select data-opt="size">' + [[22, 'Small'], [28, 'Medium'], [36, 'Large']].map(function (o) { return '<option value="' + o[0] + '"' + (st.size === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label>' +
        '<label class="bt-opt"><span>Movers &amp; footprints</span><select data-opt="win">' + WINDOWS.map(function (o) { return '<option value="' + o[0] + '"' + (st.win === o[0] ? ' selected' : '') + '>' + (o[0] ? 'last ' : '') + o[1] + '</option>'; }).join('') + '</select></label>' +
        '</div><p class="ui-hint" style="margin-top:14px">Tip: drag the timeline to replay. Press <b>space</b> to play, <b>Esc</b> to close.</p>';
      drawPic();
    }
    function drawTracks() {
      var el = view.querySelector('[data-tracklist]');
      if (!el) { drawTabs(); return; }
      var q = st.q.toLowerCase(), dark = BT.isDark();
      var list = (st.shownTracks || []).filter(function (t) { return !q || (t.it.f.n || '').toLowerCase().indexOf(q) >= 0 || t.it.feed.name.toLowerCase().indexOf(q) >= 0; })
        .sort(function (a, b) { return (a.it.f.n || '').localeCompare(b.it.f.n || ''); });
      el.innerHTML = list.length ? list.map(function (t) {
        var f = t.it.f;
        return '<div class="bt-trk' + (st.sel && st.sel.key === t.key ? ' on' : '') + '" data-track="' + esc(t.key) + '"><span class="sym">' + (f.s ? BT.symbol(f.s, { size: 18, dark: dark }).svg : '') + '</span>' +
          '<div class="grow"><b>' + esc(f.n || f.id) + '</b><span>' + esc(t.it.feed.name.split(' · ')[0]) + ' · ' + (t.it.t ? esc(BT.dtg(new Date(t.it.t).toISOString())) : 'no time') + ' · ' + UI.plural(t.n, 'pt') + '</span></div></div>';
      }).join('') : '<div class="ui-empty" style="padding:28px 12px">' + UI.icon('search') + '<p>No tracks ' + (q ? 'match "' + esc(st.q) + '"' : 'at this time') + '.</p></div>';
      drawTabs();
    }

    /* ------------------------------------------------------------ inspector */
    function select(it, track) {
      st.sel = it ? { it: it, key: track ? track.key : null } : null;
      st.follow = false;
      drawInspector();
      schedule();
    }
    function kv(rows) { return '<dl class="bt-kv">' + rows.filter(function (r) { return r[1] != null && r[1] !== ''; }).map(function (r) { return '<dt>' + esc(r[0]) + '</dt><dd>' + (r[2] ? r[1] : esc(r[1])) + '</dd>'; }).join('') + '</dl>'; }
    function drawInspector() {
      var box = $('[data-insp]');
      if (!st.sel) { box.innerHTML = ''; return; }
      var it = st.sel.it, f = it.f, list = st.sel.key ? idx.tracks[st.sel.key] : null, dark = BT.isDark();
      var c = f.g === 'pt' || f.g === 'ci' ? f.c : f.c[0];
      var sym = f.s ? BT.symbol(f.s, { size: 40, dark: dark, label: '' }).svg : '<span class="ui-avatar" style="background:' + esc(f.col || it.feed.color) + ';color:#111">' + esc({ ln: 'LN', pg: 'AR', ci: 'CI', pt: f.m ? 'MTI' : 'PT' }[f.g]) + '</span>';
      var html = '<div class="ui-card bt-insp riveted" role="dialog" aria-label="Details"><button class="ui-btn ghost icon x" data-close-insp aria-label="Close">' + UI.icon('x') + '</button>' +
        '<div class="hd">' + sym + '<div><h3>' + esc(f.n || (f.m ? 'Moving target' : f.id || 'Untitled')) + '</h3><span class="bt-chip"><i style="background:' + esc(it.feed.color) + '"></i>' + esc(it.feed.name) + '</span></div></div>';
      if (f.s) {
        var d = BT.describe(f.s);
        html += '<div class="sec">Symbol</div>' + kv([['SIDC', '<code>' + esc(f.s) + '</code>', true], ['Identity', d.affiliation], ['Dimension', d.dimension], ['Function', d.func], ['Echelon', d.echelon], ['Modifier', d.modifier], ['Status', d.status]]);
      }
      var rows = [];
      if (f.g === 'pt' || f.g === 'ci') { rows.push(['MGRS', BT.mgrs(c[0], c[1])], ['Lat / lon', BT.fmtLL(c[0], c[1])]); }
      if (f.g === 'ci') rows.push(['Radius', BT.fmtDist(f.r)]);
      if (f.g === 'ln' || f.g === 'pg') {
        var len = 0; for (var i = 1; i < f.c.length; i++) len += BT.distance(f.c[i - 1], f.c[i]);
        if (f.g === 'pg') len += BT.distance(f.c[f.c.length - 1], f.c[0]);
        rows.push([f.g === 'ln' ? 'Length' : 'Perimeter', BT.fmtDist(len)], ['Vertices', String(f.c.length)], ['Starts at', BT.mgrs(f.c[0][0], f.c[0][1])]);
      }
      if (it.t) rows.push(['Time', BT.dtg(new Date(it.t).toISOString()) + ' (' + UI.ago(new Date(it.t).toISOString()) + ')']);
      if (list && list.length > 1) {
        var j = st.sel ? latest(list, st.cursor) : list.length - 1, a = list[Math.max(0, (j || 0) - 1)], b = list[j || 0];
        rows.push(['Track', UI.plural(list.length, 'report') + ', since ' + BT.dtg(new Date(list[0].t).toISOString())]);
        if (a !== b && a.t && b.t && b.t > a.t) {
          var dm = BT.distance(a.f.c, b.f.c), sp = dm / ((b.t - a.t) / 1000);
          rows.push(['Moving', (sp * 3.6).toFixed(1) + ' km/h, bearing ' + Math.round(BT.bearing(a.f.c, b.f.c)) + '°']);
        }
      }
      html += '<div class="sec">Where &amp; when</div>' + kv(rows);
      var p = f.p || {};
      if (Object.keys(p).length) html += '<div class="sec">Reported</div>' + kv(Object.keys(p).map(function (k) { var v = p[k]; return [k.replace(/_/g, ' '), typeof v === 'object' ? JSON.stringify(v) : String(v)]; }));
      html += '<div class="sec">Source</div>' + kv([['Format', BT.FORMATS[it.drop.fmt] || it.drop.fmt], ['File', it.drop.filename], ['By', it.drop.by], ['Added', BT.dtg(it.drop.created)]]);
      html += '<div class="ui-row" style="margin-top:12px"><button class="ui-btn sm" data-center>' + UI.icon('pin') + 'Centre</button>' +
        (st.sel.key ? '<button class="ui-btn sm' + (st.follow ? ' primary' : '') + '" data-follow>' + UI.icon('arrow') + (st.follow ? 'Following' : 'Follow') + '</button>' : '') +
        (it.drop.fmt === 'manual' && it.drop.can_delete ? '<button class="ui-btn sm danger" data-unplot>' + UI.icon('trash') + 'Remove plot</button>' : '') +
        (f.s ? '<a class="ui-btn sm ghost" href="#symbols/' + encodeURIComponent(f.s) + '">' + UI.icon('info') + 'Symbol</a>' : '') + '</div></div>';
      box.innerHTML = html;
    }

    /* ------------------------------------------------------------ time */
    function drawTime() {
      if (!idx) return;
      var span = idx.tmax - idx.tmin;
      slider.value = Math.round((st.cursor - idx.tmin) / span * 1000);
      $('[data-tlabel]').innerHTML = esc(BT.dtg(new Date(st.cursor).toISOString())) + '<span>' + (st.live ? 'newest data ' + esc(UI.ago(new Date(idx.tmax).toISOString())) : '−' + fmtSpan(idx.tmax - st.cursor) + ' from newest') + '</span>';
      $('[data-live]').classList.toggle('on', st.live);
      $('[data-play]').innerHTML = playIcon(st.playing);
    }
    function fmtSpan(ms) { var m = Math.round(ms / 60000); return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + (m % 60) + ' min'; }
    function setCursor(t, live) {
      st.cursor = Math.max(idx.tmin, Math.min(idx.tmax, t));
      st.live = !!live || st.cursor >= idx.tmax;
      if (st.sel) drawInspector();
      schedule();
    }
    function play(on) {
      st.playing = on;
      clearInterval(playTimer);
      if (on) {
        if (st.cursor >= idx.tmax) st.cursor = idx.tmin;
        st.live = false;
        var last = Date.now();
        playTimer = setInterval(function () {
          var now = Date.now(), t = st.cursor + (now - last) * st.speed; last = now;
          if (t >= idx.tmax) { setCursor(idx.tmax, true); play(false); return; }
          setCursor(t, false);
        }, 120);
      }
      drawTime();
    }

    /* ------------------------------------------------------------ data */
    function apply(d, first) {
      data = d;
      var wasLive = st.live || st.cursor == null;
      idx = buildIndex(d);
      if (wasLive) st.cursor = idx.tmax; else st.cursor = Math.min(Math.max(st.cursor, idx.tmin), idx.tmax);
      st.live = wasLive;
      if (st.sel) st.sel = null, drawInspector();
      var shown = d.feeds.filter(function (f) { return f.shown; });
      var marks = shown.map(function (f) { return f.classification; });
      var banner = marks.length ? (marks.every(function (m) { return m === marks[0]; }) ? marks[0] : 'UNCLASSIFIED // MIXED MARKINGS') : 'UNCLASSIFIED';
      $('[data-banner]').textContent = banner;
      $('[data-banner]').className = 'bt-banner' + (/EXERCISE|TRAINING|SIMULATED/.test(banner) ? ' ex' : '');
      drawSide();
      $('[data-emptymap]').innerHTML = d.feeds.length ? '' : '<div class="bt-empty-map"><div class="ui-card riveted"><h3>Your map is empty</h3><p class="muted">Subscribe to a feed, or upload a file: STANAG 4607, 4609, CoT, KML and more.</p>' +
        '<div class="ui-row" style="justify-content:center"><a class="ui-btn primary" href="#feeds" data-go="feeds">' + UI.icon('search') + 'Find feeds</a><a class="ui-btn" href="#upload" data-go="upload">' + UI.icon('plus') + 'Upload</a></div></div></div>';
      render();
      if (first && !fitted) { map.invalidateSize(); fit(); setTimeout(function () { if (map && !dead) { map.invalidateSize(); fit(); } }, 250); }
    }
    function fit() {
      var b = L.latLngBounds([]);
      grp.eachLayer(function (l) { if (l.getLatLng && !(l instanceof L.Circle)) b.extend(l.getLatLng()); });
      if (!b.isValid()) grp.eachLayer(function (l) { if (l.getBounds) b.extend(l.getBounds()); });
      if (b.isValid()) { map.fitBounds(b.pad(.08), { maxZoom: 14, animate: false }); fitted = true; }
      else map.setView([33.33, -117.45], 10, { animate: false });
    }
    function load(quiet) {
      return (quiet ? UI.apiQuiet : UI.api)('map_get').then(function (d) { if (!dead) apply(d, !quiet); return d; });
    }
    function startPoll() {
      poll = setInterval(function () {
        if (document.hidden || dead) return;
        UI.apiQuiet('map_version').then(function (v) {
          if (data && v.version !== data.version) {
            var before = {}; data.feeds.forEach(function (f) { before[f.id] = f.updated; });
            load(true).then(function (d) {
              var changed = d.feeds.filter(function (f) { return before[f.id] && before[f.id] !== f.updated; });
              if (changed.length) UI.toast('New data: ' + changed.map(function (f) { return f.name.split(' · ')[0]; }).join(', '));
            });
          }
        }).catch(function () {});
      }, 20000);
    }

    /* ------------------------------------------------------------ placing a symbol (#map/place/SIDC) */
    function drawPlaceBar() {
      var bar = $('[data-placebar]');
      $('[data-mapbox]').classList.toggle('placing', !!placing);
      if (!placing) { bar.innerHTML = ''; return; }
      bar.innerHTML = '<div class="bt-place">' + BT.symbol(placing, { size: 26, dark: BT.isDark() }).svg + '<b>Click the map to place this symbol</b><button class="ui-btn sm ghost" data-cancel-place>Cancel</button></div>';
    }
    function place(latlng) {
      var d = BT.describe(placing);
      var m = UI.modal('<h2>Place symbol</h2><div class="ui-row" style="margin-bottom:12px">' + BT.symbol(placing, { size: 44, dark: BT.isDark() }).svg +
        '<div><b>' + esc(d.affiliation + ' · ' + d.func) + '</b><div class="muted small mono">' + esc(BT.mgrs(latlng.lat, latlng.lng)) + '</div></div></div>' +
        '<form class="ui-stack" data-plot><label class="ui-field"><span>Label <em>(unique designation)</em></span><input type="text" name="name" maxlength="40" required placeholder="e.g. 2/B RECON"></label>' +
        '<label class="ui-field"><span>Note <em>(optional)</em></span><input type="text" name="note" maxlength="200" placeholder="Seen from OP NORTH at dawn"></label>' +
        '<p class="ui-hint">Plots go into your private "My plots" feed. Only you see them.</p>' +
        '<div class="ui-row end"><button type="button" class="ui-btn ghost" data-close>Cancel</button><button class="ui-btn primary" type="submit">' + UI.icon('pin') + 'Place</button></div></form>');
      m.el.querySelector('[data-plot]').addEventListener('submit', function (e) {
        e.preventDefault();
        var v = UI.formData(e.target);
        UI.busy(e.target.querySelector('[type=submit]'), UI.api('plot_add', placing, v.name, latlng.lat, latlng.lng, v.note)).then(function () {
          m.close(); UI.toast('Placed ' + v.name, 'ok'); placing = null; history.replaceState(null, '', '#map'); drawPlaceBar(); st.live = true; return load(true);
        });
      });
    }

    /* ------------------------------------------------------------ measure */
    function toggleMeasure(on) {
      if (measure) { measure.layer.remove(); }
      measure = on ? { pts: [], layer: L.layerGroup().addTo(map) } : null;
      $('[data-measure]').classList.toggle('on', !!on);
      $('[data-mapbox]').classList.toggle('measuring', !!on);
      if (on) UI.toast('Click two points to measure distance and bearing.');
    }
    function measureClick(ll) {
      var p = [ll.lat, ll.lng];
      if (measure.pts.length >= 2) { measure.pts = []; measure.layer.clearLayers(); }
      measure.pts.push(p);
      measure.layer.addLayer(L.circleMarker(p, { radius: 5, color: '#fff', weight: 2, fillColor: '#ff7a2f', fillOpacity: 1 }));
      if (measure.pts.length === 2) {
        var a = measure.pts[0], d = BT.distance(a, p), b = BT.bearing(a, p);
        measure.layer.addLayer(L.polyline([a, p], { color: '#ff7a2f', weight: 3, dashArray: '8 6' })
          .bindTooltip(BT.fmtDist(d) + ' · ' + Math.round(b) + '° (' + Math.round(b * 17.7778) + ' mils)', { permanent: true, direction: 'center', className: 'bt-lbl' }));
      }
    }

    /* ------------------------------------------------------------ events */
    view.addEventListener('click', function (e) {
      var t = e.target;
      if (t.closest('[data-tab]')) { st.tab = t.closest('[data-tab]').getAttribute('data-tab'); drawSide(); return; }
      if (t.closest('[data-close-insp]')) { select(null); return; }
      if (t.closest('[data-center]') && st.sel) { var f = st.sel.it.f; if (f.g === 'pt' || f.g === 'ci') map.setView(f.c, Math.max(map.getZoom(), 13)); else map.fitBounds(L.latLngBounds(f.c).pad(.3)); return; }
      if (t.closest('[data-follow]')) { st.follow = !st.follow; drawInspector(); schedule(); return; }
      if (t.closest('[data-unplot]') && st.sel) {
        var dr = st.sel.it.drop;
        UI.confirm({ title: 'Remove this plot?', ok: 'Remove', danger: true }).then(function (yes) { if (yes) UI.api('drop_delete', dr.id).then(function () { select(null); UI.toast('Removed', 'ok'); return load(true); }); });
        return;
      }
      var tr = t.closest('[data-track]');
      if (tr) {
        var tk = tr.getAttribute('data-track'), list = idx.tracks[tk], i = latest(list, st.cursor);
        if (i != null) { select(list[i], { key: tk }); map.setView(list[i].f.c, Math.max(map.getZoom(), 13)); wrap.classList.remove('sheet'); }
        return;
      }
      if (t.closest('[data-fit]')) { fit(); return; }
      if (t.closest('[data-measure]')) { toggleMeasure(!measure); return; }
      if (t.closest('[data-sheet]')) { wrap.classList.toggle('sheet'); return; }
      if (t.closest('[data-play]')) { play(!st.playing); return; }
      if (t.closest('[data-live]')) { play(false); setCursor(idx.tmax, true); return; }
      if (t.closest('[data-cancel-place]')) { placing = null; history.replaceState(null, '', '#map'); drawPlaceBar(); return; }
    });
    view.addEventListener('change', function (e) {
      var t = e.target, row = t.closest('[data-feed]');
      if (row && t.matches('[data-show]')) {
        var f = idx.feeds[row.getAttribute('data-feed')];
        f.shown = t.checked; row.classList.toggle('off', !t.checked);
        UI.apiQuiet('feed_show', f.id, f.shown).then(function () { data.version = null; });
        apply(data, false);
        return;
      }
      var o = t.getAttribute('data-opt');
      if (o) {
        if (o === 'labels' || o === 'trails') st[o] = t.checked; else st[o] = +t.value;
        UI.store.set({ labels: 'labels', trails: 'trails', size: 'symsize', win: 'mtiwin' }[o], st[o]);
        schedule(); return;
      }
      if (t.matches('[data-base]')) { st.base = t.value; UI.store.set('base', st.base); tiles.remove(); tiles = BT.tiles(st.base).addTo(map); schedule(); return; }
      if (t.matches('[data-speed]')) { st.speed = +t.value; return; }
    });
    view.addEventListener('input', function (e) {
      if (e.target === slider) { var sv = +slider.value; play(false); setCursor(idx.tmin + (idx.tmax - idx.tmin) * sv / 1000, sv >= 1000); return; }
      if (e.target.matches('[data-q]')) { st.q = e.target.value; drawTracks(); }
    });
    function onKey(e) {
      if (e.target.closest && e.target.closest('input, textarea, select') || document.querySelector('.ui-modal-wrap')) return;
      if (e.key === 'Escape') { if (measure) toggleMeasure(false); else if (placing) { placing = null; drawPlaceBar(); } else select(null); }
      if (e.key === ' ' && idx) { e.preventDefault(); play(!st.playing); }
    }
    document.addEventListener('keydown', onKey);

    /* ------------------------------------------------------------ start */
    if (!window.L) { view.innerHTML = '<div class="ui-wrap"><div class="ui-empty">' + UI.icon('map') + '<h3>The map library didn\'t load</h3><p>Check your connection and reload the page.</p></div></div>'; return Promise.resolve(); }
    map = L.map($('[data-map]'), { zoomControl: true, preferCanvas: false, worldCopyJump: true });
    ren = L.canvas({ padding: .4 });
    tiles = BT.tiles(st.base).addTo(map);
    grp = L.featureGroup().addTo(map);
    map.setView([33.33, -117.45], 10);
    var lastZ = null;
    map.on('zoomend', function () { var z = map.getZoom() >= 12; if (z !== lastZ) { lastZ = z; schedule(); } });
    map.on('mousemove', function (e) { $('[data-readout]').innerHTML = esc(BT.mgrs(e.latlng.lat, e.latlng.lng)) + '<span>' + esc(BT.fmtLL(e.latlng.lat, e.latlng.lng)) + '</span>'; });
    map.on('moveend', function () { var c = map.getCenter(); if (!matchMedia('(pointer: fine)').matches) $('[data-readout]').innerHTML = esc(BT.mgrs(c.lat, c.lng)) + '<span>map centre</span>'; });
    map.on('click', function (e) {
      if (placing) { place(e.latlng); return; }
      if (measure) { measureClick(e.latlng); return; }
      if (st.sel) select(null);
    });
    drawPlaceBar();
    setTimeout(function () { map.invalidateSize(); }, 50);
    var ro = window.ResizeObserver ? new ResizeObserver(function () { map && map.invalidateSize(); }) : null;
    if (ro) ro.observe($('[data-mapbox]'));
    startPoll();
    return {
      ready: load(false).then(function () { if (placing) UI.toast('Click the map to place your symbol.'); }),
      destroy: function () { dead = true; clearInterval(poll); clearInterval(playTimer); if (raf) cancelAnimationFrame(raf); document.removeEventListener('keydown', onKey); if (ro) ro.disconnect(); if (map) { try { map.stop(); map.off(); map.remove(); } catch (e) {} } map = null; }
    };
  });
})();

/* ===== profile.html ===== */
(function () {
  var esc = UI.esc;
  UI.page('profile', { title: 'Your profile', auth: 'user' }, function (view, ctx) {
    var me = ctx.me;
    view.innerHTML = '<div class="ui-wrap ui-narrow"><div class="pf-head"><span class="ui-avatar">' + esc(UI.initials(me.name)) + '</span>' +
      '<div><h1>' + esc(me.name) + '</h1><div class="muted">' + esc(me.email) + (me.joined ? ' · member since ' + esc(UI.fmtDate(me.joined, { month: 'long', year: 'numeric' })) : '') + '</div></div></div>' +
      '<div class="pf-grid"><form class="ui-card ui-stack" data-name><h3>Your name</h3><label class="ui-field"><span>Shown to other people</span>' +
      '<input type="text" name="name" value="' + esc(me.name) + '" maxlength="60" required></label><button class="ui-btn primary" type="submit">Save</button></form>' +
      '<div class="ui-card ui-stack"><h3>Appearance</h3><p class="muted small">Follow your device, or pick one.</p><div data-theme-box></div>' +
      '<h3 style="margin-top:22px">Password</h3><p class="muted small">We\'ll email you a link to choose a new one.</p>' +
      '<button class="ui-btn" data-reset>' + UI.icon('mail') + 'Email me a reset link</button></div></div>' +
      '<div class="ui-card" style="margin-top:16px"><div class="pf-links">' +
      (me.is_admin ? '<a href="#admin" data-go="admin">' + UI.icon('shield') + 'Admin</a>' : '') +
      '<button data-feedback>' + UI.icon('chat') + 'Submit feedback</button>' +
      '<button data-lk-open="overview">' + UI.icon('lock') + 'Privacy &amp; Terms, and your data</button>' +
      '<button data-signout-here>' + UI.icon('logout') + 'Sign out</button></div></div></div>';
    function themeBox() {
      var t = UI.theme();
      view.querySelector('[data-theme-box]').innerHTML = '<div class="ui-seg">' + [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']].map(function (o) {
        return '<button type="button" data-theme-pick="' + o[0] + '" class="' + (t === o[0] ? 'on' : '') + '">' + o[1] + '</button>';
      }).join('') + '</div>';
    }
    themeBox();
    view.addEventListener('click', function (e) {
      var t = e.target.closest('[data-theme-pick]');
      if (t) { UI.setTheme(t.getAttribute('data-theme-pick')); themeBox(); UI.renderChrome(); return; }
      if (e.target.closest('[data-reset]')) {
        UI.busy(e.target.closest('[data-reset]'), UI.auth('reset', { email: me.email })).then(function (r) { UI.toast(r.message, 'ok'); });
      }
      if (e.target.closest('[data-signout-here]')) UI.auth('logout');
    });
    view.querySelector('[data-name]').addEventListener('submit', function (e) {
      e.preventDefault();
      var v = UI.formData(e.target);
      UI.busy(e.target.querySelector('[type=submit]'), UI.api('update_profile', v.name)).then(function (r) {
        UI.setMe(r.me); ctx.me = r.me; UI.toast('Saved', 'ok');
        view.querySelector('.pf-head h1').textContent = r.me.name;
      });
    });
  });
})();

/* ===== symbols.html ===== */
(function () {
  var esc = UI.esc;
  var AFFS = [['F', 'Friend'], ['H', 'Hostile'], ['N', 'Neutral'], ['U', 'Unknown'], ['A', 'Assumed friend'], ['S', 'Suspect'], ['P', 'Pending'], ['J', 'Joker']];
  var DIMS = [['G', 'Ground'], ['A', 'Air'], ['S', 'Sea surface'], ['U', 'Subsurface'], ['P', 'Space'], ['F', 'SOF']];

  UI.page('symbols', { title: 'Symbols', nav: 'Symbols', icon: 'symbol', auth: 'user', order: 40 }, function (view, ctx) {
    var s = { aff: 'F', dim: 'G', func: 'UCI', mod: '-', ech: 'E', status: 'P', label: '2/B', higher: '1-5 INF' };
    var dark = BT.isDark();
    function fromSidc(code) {
      code = String(code || '').toUpperCase();
      if (!/^S[A-Z][PAGSUF][A-Z][A-Z0-9\-]{6}/.test(code)) return false;
      s.aff = code[1]; s.dim = code[2]; s.status = code[3]; s.func = code.substr(4, 6).replace(/-+$/, ''); s.mod = code[10] || '-'; s.ech = code[11] || '-';
      return true;
    }
    if (ctx.args[0]) fromSidc(ctx.args[0]);
    function code() { return BT.sidc(s.aff, s.dim, s.func, s.mod, s.ech, s.status); }
    function sym(c, size, extra) { return BT.symbol(c, Object.assign({ size: size, dark: dark }, extra || {})).svg; }

    view.innerHTML = '<div class="ui-wrap"><div class="ui-page-head"><div><div class="eyebrow">MIL-STD-2525C · APP-6B</div><h1>Symbols</h1>' +
      '<p class="muted">Build a symbol, copy its SIDC, or place it on your map. Paste any code to decode it.</p></div></div>' +
      '<div class="sy-grid"><div class="ui-card riveted"><div class="sy-stage" data-stage></div><div class="sy-code"><code data-code></code><button class="ui-btn sm" data-copy>' + UI.icon('copy') + 'Copy</button></div>' +
      '<div class="ui-row" style="margin-bottom:16px"><button class="ui-btn primary" data-place style="flex:1">' + UI.icon('pin') + 'Place on map</button></div>' +
      '<form class="sy-form" data-form onsubmit="return false"><div class="ui-field"><span>Identity</span><div class="sy-aff" data-affs></div></div>' +
      '<div class="two"><label class="ui-field"><span>Echelon</span><select name="ech"><option value="-">None</option>' + Object.keys(BT.ECHELON).map(function (k) { return '<option value="' + k + '">' + esc(BT.ECHELON[k]) + '</option>'; }).join('') + '</select></label>' +
      '<label class="ui-field"><span>Status</span><select name="status"><option value="P">Present</option><option value="A">Planned / anticipated</option></select></label></div>' +
      '<label class="ui-field"><span>Headquarters / task force / dummy</span><select name="mod"><option value="-">None</option>' + ['A', 'E', 'B', 'F', 'C', 'G', 'D', 'H'].map(function (k) { return '<option value="' + k + '">' + esc(BT.MODIFIER[k]) + '</option>'; }).join('') + '</select></label>' +
      '<div class="two"><label class="ui-field"><span>Designation <em>(T)</em></span><input type="text" name="label" maxlength="20"></label>' +
      '<label class="ui-field"><span>Higher formation <em>(M)</em></span><input type="text" name="higher" maxlength="20"></label></div></form></div>' +
      '<div><div class="ui-card" style="margin-bottom:16px"><h3>Decode a SIDC</h3><form class="sy-dec" data-decode><input type="text" name="q" placeholder="SHGPUCA----E--- or 10031000141211000000" maxlength="30" class="mono">' +
      '<button class="ui-btn" type="submit">' + UI.icon('search') + 'Decode</button></form><div data-decoded></div></div>' +
      '<div class="ui-card"><h3>Gallery</h3><div class="ui-seg sy-dims" data-dims></div><div class="sy-gal" data-gal></div></div></div></div></div>';
    var form = view.querySelector('[data-form]');

    function drawBuilder() {
      var c = code();
      view.querySelector('[data-stage]').innerHTML = sym(c, 90, { label: s.label, higher: s.higher });
      view.querySelector('[data-code]').innerHTML = c.split('').map(function (ch, i) { return i >= 1 && i <= 11 && ch !== '-' ? '<i>' + esc(ch) + '</i>' : esc(ch); }).join('');
      view.querySelector('[data-affs]').innerHTML = AFFS.map(function (a) {
        return '<button type="button" data-aff="' + a[0] + '" class="' + (s.aff === a[0] ? 'on' : '') + '">' + sym(BT.sidc(a[0], s.dim, s.func, '-', '-', 'P'), 22) + esc(a[1]) + '</button>';
      }).join('');
      form.ech.value = s.ech; form.status.value = s.status === 'A' ? 'A' : 'P'; form.mod.value = s.mod; form.label.value = s.label; form.higher.value = s.higher;
    }
    function drawGallery() {
      view.querySelector('[data-dims]').innerHTML = DIMS.map(function (d) { return '<button type="button" data-dim="' + d[0] + '" class="' + (s.dim === d[0] ? 'on' : '') + '">' + esc(d[1]) + '</button>'; }).join('');
      var group = null, html = '';
      (BT.FUNCS[s.dim] || []).forEach(function (f) {
        if (f[2] !== group) { group = f[2]; html += '<p class="sy-group">' + esc(group) + '</p>'; }
        var c = BT.sidc(s.aff, s.dim, f[0], '-', s.dim === 'G' && f[0][0] === 'U' ? s.ech : '-', 'P');
        html += '<button class="sy-cell' + (s.func === f[0] ? ' on' : '') + '" data-func="' + f[0] + '"><span class="s">' + sym(c, 32) + '</span><b>' + esc(f[1]) + '</b><code>' + esc(f[0]) + '</code></button>';
      });
      view.querySelector('[data-gal]').innerHTML = html;
    }
    function decode(q) {
      var c = String(q || '').trim().toUpperCase().replace(/\s+/g, ''), out = view.querySelector('[data-decoded]');
      if (!c) { out.innerHTML = ''; return; }
      if (!/^[A-Z0-9\-*]{10,30}$/.test(c)) { out.innerHTML = '<div class="ui-error">That doesn\'t look like a SIDC: 15 letters (2525C) or 20 / 30 digits (2525D/E).</div>'; return; }
      var y = BT.symbol(c, { size: 60, dark: dark }), d = BT.describe(c);
      out.innerHTML = '<div class="ui-row top" style="gap:16px">' + y.svg + '<dl class="bt-kv" style="flex:1">' + [['Scheme', d.scheme], ['Identity', d.affiliation], ['Dimension', d.dimension], ['Function', d.func], ['Echelon', d.echelon],
        ['Modifier', d.modifier], ['Status', d.status], ['Country', d.country], ['Renders', y.valid ? 'Yes' : 'Partly (unknown parts are left plain)']].filter(function (r) { return r[1]; }).map(function (r) {
        return '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>'; }).join('') + '</dl></div>' +
        (BT.isLetterSidc(c) && c[0] === 'S' ? '<div class="ui-row" style="margin-top:10px"><button class="ui-btn sm" data-load="' + esc(c) + '">' + UI.icon('edit') + 'Open in the builder</button></div>' : '');
    }
    view.addEventListener('click', function (e) {
      var t = e.target;
      var a = t.closest('[data-aff]'); if (a) { s.aff = a.getAttribute('data-aff'); drawBuilder(); drawGallery(); return; }
      var d = t.closest('[data-dim]'); if (d) { s.dim = d.getAttribute('data-dim'); s.func = (BT.FUNCS[s.dim][0] || [''])[0]; if (s.dim !== 'G') s.ech = '-'; drawBuilder(); drawGallery(); return; }
      var f = t.closest('[data-func]'); if (f) { s.func = f.getAttribute('data-func'); drawBuilder(); drawGallery(); return; }
      var l = t.closest('[data-load]'); if (l) { fromSidc(l.getAttribute('data-load')); drawBuilder(); drawGallery(); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
      if (t.closest('[data-copy]')) { var c = code(); (navigator.clipboard ? navigator.clipboard.writeText(c) : Promise.reject()).then(function () { UI.toast('Copied ' + c, 'ok'); }, function () { UI.toast(c); }); return; }
      if (t.closest('[data-place]')) { ctx.go('map', 'place', code()); }
    });
    form.addEventListener('input', function () {
      s.ech = form.ech.value; s.status = form.status.value; s.mod = form.mod.value; s.label = form.label.value; s.higher = form.higher.value;
      var c = code();
      view.querySelector('[data-stage]').innerHTML = sym(c, 90, { label: s.label, higher: s.higher });
      view.querySelector('[data-code]').textContent = c;
      drawGallery();
    });
    view.addEventListener('submit', function (e) { if (e.target.matches('[data-decode]')) { e.preventDefault(); decode(e.target.q.value); } });
    drawBuilder(); drawGallery();
    if (ctx.args[0]) { view.querySelector('[data-decode]').q.value = String(ctx.args[0]).toUpperCase(); decode(ctx.args[0]); }
    return Promise.resolve();
  });
})();

/* ===== upload.html ===== */
(function () {
  var esc = UI.esc;
  UI.page('upload', { title: 'Upload', nav: 'Upload', icon: 'upload', auth: 'user', order: 30 }, function (view, ctx) {
    var feeds = [], results = [], maps = [], target = ctx.args[0] || UI.store.get('lastFeed', null), cfg = null;
    view.innerHTML = '<div class="ui-wrap"><div class="ui-page-head"><div><div class="eyebrow">Parse in your browser · publish to a feed</div><h1>Upload</h1>' +
      '<p class="muted">Drop STANAG 4607, 4609, 4545, 4676, NFFI, CoT, NVG, KML/KMZ, GeoJSON, CSV or AIS files. Nothing leaves your device until you publish.</p></div></div>' +
      '<div class="up-grid"><div><label class="up-drop" data-drop>' + UI.icon('upload') + '<h3>Drop files here</h3><p class="muted" style="margin:0">or click to choose. Several at once is fine; video files up to several GB.</p>' +
      '<input type="file" multiple data-file aria-label="Choose files"></label><div class="up-res" data-results></div></div>' +
      '<div class="ui-stack"><div class="ui-card"><h3>Try a sample</h3><p class="muted small">Real files written byte for byte in your browser (fictional exercise data, timed now). Shift-click to download one instead.</p>' +
      '<div class="up-samples">' + BT.samples.LIST.map(function (s) { return '<button class="up-sample" data-sample="' + s.id + '"><b>' + esc(s.label) + '</b><span>' + esc(s.note) + '</span></button>'; }).join('') + '</div></div>' +
      '<div class="ui-card"><h3>Formats</h3><div class="up-fmts">' + BT.formats.LIST.map(function (f) { return '<div><b>' + esc(f.name) + '</b><span>' + esc(f.what) + ' <small>' + esc(f.ext) + '</small></span></div>'; }).join('') + '</div></div></div></div></div>';
    var box = view.querySelector('[data-results]');

    function feedOptions() {
      return feeds.map(function (f) { return '<option value="' + esc(f.id) + '"' + (f.id === target ? ' selected' : '') + '>' + esc(f.name) + '</option>'; }).join('') + '<option value="__new">+ New feed…</option>';
    }
    function drawResults() {
      box.innerHTML = results.map(function (r, i) {
        if (r.error) return '<div class="ui-card"><h3>' + esc(r.name) + '</h3><div class="ui-error">' + esc(r.error) + '</div><div class="ui-row end" style="margin-top:10px"><button class="ui-btn sm ghost" data-dismiss="' + i + '">Dismiss</button></div></div>';
        if (r.parsing) return '<div class="ui-card"><h3>' + esc(r.name) + '</h3><div class="ui-skel" style="height:120px"></div><p class="muted small">Reading ' + esc(fmtSize(r.size)) + '…</p></div>';
        var c = r.counts, s = r.summary;
        var count = function (n, label) { return n ? '<span class="bt-chip">' + n + ' ' + label + '</span>' : ''; };
        return '<div class="ui-card up-card' + (r.published ? ' up-done' : '') + '" data-res="' + i + '"><div><div class="ui-row" style="gap:6px;margin-bottom:6px"><span class="bt-fmt">' + esc(BT.fmtShort(r.fmt)) + '</span><span class="muted small">' + esc(r.standard) + '</span></div>' +
          '<h3>' + esc(r.name) + '</h3><div class="muted small mono">' + esc(fmtSize(r.size)) + (r.start ? ' · ' + esc(BT.dtg(r.start)) + (r.end && r.end !== r.start ? ' → ' + esc(BT.dtg(r.end)) : '') : '') + '</div>' +
          '<div class="up-counts">' + count(c.pt, 'points') + count(c.mti, 'moving targets') + count(c.ln, 'lines') + count(c.pg, 'areas') + count(c.ci, 'circles') + '</div>' +
          '<dl class="bt-kv">' + Object.keys(s).filter(function (k) { return s[k] !== '' && s[k] != null; }).slice(0, 16).map(function (k) { return '<dt>' + esc(k.replace(/_/g, ' ')) + '</dt><dd>' + esc(s[k]) + '</dd>'; }).join('') + '</dl>' +
          r.warnings.map(function (w) { return '<p class="up-warn">' + UI.icon('info') + ' ' + esc(w) + '</p>'; }).join('') +
          (r.blocked ? '<div class="ui-error" style="margin-top:8px">' + UI.icon('lock') + ' ' + esc(r.blocked) + '</div>' : '') + '</div>' +
          '<div class="map" data-pmap="' + i + '"></div>' +
          '<div class="up-act">' + (r.published ? '<span class="ui-badge good">' + UI.icon('check') + 'Published to ' + esc(r.published) + '</span><span class="ui-spacer"></span><a class="ui-btn sm" href="#map" data-go="map">' + UI.icon('map') + 'See it on the map</a>'
            : r.blocked ? '<span class="muted small">Not published.</span><span class="ui-spacer"></span><button class="ui-btn sm ghost" data-dismiss="' + i + '">Dismiss</button>'
            : '<span class="small muted">Publish to</span><select data-target="' + i + '" aria-label="Feed">' + feedOptions() + '</select><button class="ui-btn primary" data-publish="' + i + '">' + UI.icon('upload') + 'Publish</button>' +
              '<button class="ui-btn ghost sm" data-dismiss="' + i + '">Discard</button>') + '</div></div>';
      }).join('') + (results.filter(function (r) { return r.features && !r.published && !r.blocked; }).length > 1 ? '<div class="ui-row end"><button class="ui-btn primary" data-publish-all>' + UI.icon('upload') + 'Publish all</button></div>' : '');
      results.forEach(function (r, i) {  // one preview map per file, moved into its card on every redraw
        var slot = box.querySelector('[data-pmap="' + i + '"]');
        if (!r.features || !window.L || !slot) return;
        if (!r._el) { r._el = document.createElement('div'); r._el.style.cssText = 'position:absolute;inset:0'; }
        slot.appendChild(r._el);
        if (!r._prev) { r._prev = BT.preview(r._el, r.features, {}); maps.push(r._prev); } else r._prev.map.invalidateSize();
      });
    }
    function fmtSize(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n > 1024 ? (n / 1024).toFixed(1) + ' KB' : n + ' B'; }
    function handle(name, size, job) {
      var r = { name: name, size: size, parsing: true };
      results.unshift(r); drawResults();
      return job.then(function (res) { Object.assign(r, res); r.parsing = false; drawResults(); return r; },
        function (e) { r.parsing = false; r.error = e && e.message || 'This file couldn\'t be read.'; drawResults(); return r; });
    }
    function addFiles(list) {
      Array.prototype.forEach.call(list, function (file) { handle(file.name, file.size, BT.formats.parseFile(file)); });
    }
    function chooseFeed(i) {
      var sel = box.querySelector('[data-target="' + i + '"]'), id = sel ? sel.value : target;
      if (id !== '__new') return Promise.resolve(id);
      return new Promise(function (resolve) {
        BT.newFeed(cfg, function (f) { feeds.unshift(f); target = f.id; resolve(f.id); });
      });
    }
    function publish(i, btn) {
      var r = results[i];
      return chooseFeed(i).then(function (id) {
        if (!id || id === '__new') return;
        target = id; UI.store.set('lastFeed', id);
        var feed = feeds.filter(function (f) { return f.id === id; })[0];
        return UI.busy(btn, UI.api('drop_publish', id, r.name, r.fmt, Object.assign({ standard: r.standard }, r.summary), r.features)).then(function (res) {
          r.published = feed ? feed.name : 'your feed';
          UI.toast('Published ' + UI.plural(res.kept, 'feature') + (res.rejected ? ' (' + res.rejected + ' skipped)' : ''), 'ok');
          drawResults();
        });
      });
    }
    var dz = view.querySelector('[data-drop]');
    ['dragenter', 'dragover'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('over'); }); });
    dz.addEventListener('drop', function (e) { if (e.dataTransfer && e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });
    view.addEventListener('change', function (e) {
      if (e.target.matches('[data-file]')) { addFiles(e.target.files); e.target.value = ''; }
      if (e.target.matches('[data-target]') && e.target.value !== '__new') { target = e.target.value; }
    });
    view.addEventListener('click', function (e) {
      var s = e.target.closest('[data-sample]');
      if (s) {
        var id = s.getAttribute('data-sample');
        if (e.shiftKey) {
          BT.samples.make(id).then(function (f) {
            var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([f.bytes])); a.download = f.name; document.body.appendChild(a); a.click(); a.remove();
          });
          return;
        }
        var made = BT.samples.make(id);
        handle(BT.samples.LIST.filter(function (x) { return x.id === id; })[0].file, 0, made.then(function (f) { return BT.formats.parseBytes(f.name, f.bytes); }));
        return;
      }
      var p = e.target.closest('[data-publish]');
      if (p) { publish(+p.getAttribute('data-publish'), p); return; }
      if (e.target.closest('[data-publish-all]')) {
        var btn = e.target.closest('[data-publish-all]'), chain = Promise.resolve();
        results.forEach(function (r, i) { if (r.features && !r.published && !r.blocked) chain = chain.then(function () { return publish(i, btn); }); });
        return;
      }
      var d = e.target.closest('[data-dismiss]');
      if (d) { var gone = results.splice(+d.getAttribute('data-dismiss'), 1)[0]; if (gone && gone._prev) setTimeout(function () { gone._prev.map.remove(); }, 400); drawResults(); }
    });
    return {
      ready: UI.api('my_feeds').then(function (r) {
        feeds = r.feeds; cfg = r;
        if (!feeds.some(function (f) { return f.id === target; })) target = feeds[0] ? feeds[0].id : '__new';
      }),
      destroy: function () { maps.forEach(function (m) { m.map.remove(); }); }
    };
  });
})();
