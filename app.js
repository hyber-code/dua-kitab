/* Dua Kitab reader. Plain JavaScript, no libraries. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var KEY = 'duakitab.v1';
  var D = null;            // book data (data.json)
  var S = null;            // saved reader state
  var reader = $('reader');
  var pages = [];          // .pg elements, index 0 = page 1
  var cur = 1;
  var backTo = null, backTimer = null;
  var deferredInstall = null;
  var openPanel = null;

  /* ---------- saved state ---------- */
  function loadState() {
    var s = null;
    try { s = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
    if (!s || typeof s !== 'object') s = {};
    return {
      edition: s.edition || D.edition,
      last: s.last || D.contentsPage,
      mode: s.mode === 'paged' ? 'paged' : 'scroll',
      theme: s.theme || 'auto',
      marks: Array.isArray(s.marks) ? s.marks : [],
      hl: s.hl && typeof s.hl === 'object' ? s.hl : {},
      hintAt: s.hintAt || 0
    };
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }

  /* Move bookmarks and highlights when a revised edition changes page numbers. */
  function migrate() {
    if (S.edition === D.edition) return;
    var m = (D.migrations || {})[String(S.edition)];
    if (m) {
      var map = function (p) { return (m.map && m.map[String(p)]) || +p; };
      var changed = m.changed || [], dropped = [], nh = {}, seen = {};
      S.marks = S.marks.map(map).filter(function (p) { if (seen[p]) return false; seen[p] = 1; return true; });
      Object.keys(S.hl).forEach(function (p) {
        var np = map(p);
        if (changed.indexOf(np) >= 0) dropped.push(np); else nh[np] = S.hl[p];
      });
      S.hl = nh; S.last = map(S.last);
      if (dropped.length) setTimeout(function () {
        toast('New edition. Highlights were cleared on changed pages: ' + dropped.sort(function (a, b) { return a - b; }).join(', '), null, null, 9000);
      }, 1200);
    }
    S.edition = D.edition;
    S.last = Math.min(Math.max(1, S.last), D.pages);
    S.marks = S.marks.filter(function (p) { return p >= 1 && p <= D.pages; });
    save();
  }

  /* ---------- helpers ---------- */
  function pad3(n) { return ('00' + n).slice(-3); }
  function pageSrc(p) { return 'pages/e' + D.edition + '/' + pad3(p) + '.webp'; }
  function sectionOf(p) {
    var name = p < D.contentsPage ? 'Introduction' : 'Contents';
    for (var i = 0; i < D.sections.length; i++) if (D.sections[i].page <= p) name = D.sections[i].en;
    return name;
  }
  var toastTimer = null;
  function toast(msg, actionLabel, action, ms) {
    var t = $('toast'); t.textContent = '';
    var sp = document.createElement('span'); sp.textContent = msg; t.appendChild(sp);
    if (actionLabel) {
      var b = document.createElement('button'); b.textContent = actionLabel;
      b.onclick = function () { t.hidden = true; action(); }; t.appendChild(b);
    }
    t.hidden = false; clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, ms || 3500);
  }

  /* ---------- build pages ---------- */
  function buildPages() {
    var frag = document.createDocumentFragment();
    for (var p = 1; p <= D.pages; p++) {
      var pg = document.createElement('div'); pg.className = 'pg'; pg.dataset.p = p;
      var sh = document.createElement('div'); sh.className = 'sheet';
      var img = document.createElement('img');
      img.alt = 'Page ' + p; img.width = D.pageW; img.height = D.pageH; img.decoding = 'async';
      img.dataset.src = pageSrc(p);
      sh.appendChild(img);
      var zs = D.zones[String(p)];
      if (zs) zs.forEach(function (z) {
        var a = document.createElement('a'); a.className = 'zone'; a.href = '#';
        a.style.top = (z.y * 100) + '%'; a.style.height = (z.h * 100) + '%';
        a.dataset.to = z.to; a.setAttribute('aria-label', 'Go to page ' + z.to);
        sh.appendChild(a);
      });
      var hl = document.createElement('div'); hl.className = 'hl'; sh.appendChild(hl);
      var fl = document.createElement('div'); fl.className = 'mark-flag'; sh.appendChild(fl);
      pg.appendChild(sh); frag.appendChild(pg); pages.push(pg);
    }
    reader.appendChild(frag);
    var io = new IntersectionObserver(function (ents) {
      ents.forEach(function (e) {
        if (!e.isIntersecting) return;
        var im = e.target.querySelector('img');
        if (im.dataset.src) { im.src = im.dataset.src; delete im.dataset.src; }
        io.unobserve(e.target);
      });
    }, { root: reader, rootMargin: '200% 150%' });
    pages.forEach(function (pg) { io.observe(pg); });
    pages.forEach(function (pg) { drawBands(+pg.dataset.p); });
    S.marks.forEach(function (p) { if (pages[p - 1]) pages[p - 1].classList.add('marked'); });
  }

  /* ---------- position ---------- */
  function computeCur() {
    var i;
    if (S.mode === 'paged') {
      i = Math.round(Math.abs(reader.scrollLeft) / reader.clientWidth);
    } else {
      var first = pages[0].offsetTop;
      var step = pages.length > 1 ? pages[1].offsetTop - first : 1;
      i = Math.floor((reader.scrollTop + reader.clientHeight * 0.4) / step);
    }
    return Math.min(D.pages, Math.max(1, i + 1));
  }
  function goTo(p, remember) {
    p = Math.min(D.pages, Math.max(1, Math.round(p)));
    if (remember && p !== cur) { backTo = cur; showBack(); }
    var el = pages[p - 1];
    if (S.mode === 'paged') el.scrollIntoView({ block: 'nearest', inline: 'center' });
    else reader.scrollTop = el.offsetTop - pages[0].offsetTop;
    setCur(p);
  }
  function setCur(p) {
    cur = p;
    $('cur').textContent = p;
    $('prev').disabled = p <= 1; $('next').disabled = p >= D.pages;
    var on = S.marks.indexOf(p) >= 0;
    $('bSave').classList.toggle('on', on);
    $('saveLbl').textContent = on ? 'Saved' : 'Save page';
    if (S.last !== p) { S.last = p; save(); }
  }
  var ticking = false, quiet = 0;
  reader.addEventListener('scroll', function () {
    if (ticking || !D) return; ticking = true;
    requestAnimationFrame(function () {
      ticking = false;
      if (Date.now() < quiet) return;
      var p = computeCur(); if (p !== cur) setCur(p);
    });
  }, { passive: true });
  function showBack() {
    var b = $('backChip');
    if (backTo == null) { b.hidden = true; return; }
    b.textContent = '↩ Back to ' + (D.zones[String(backTo)] ? 'Contents' : 'page ' + backTo);
    b.hidden = false;
    clearTimeout(backTimer);
    backTimer = setTimeout(function () { backTo = null; b.hidden = true; }, 20000);
  }
  $('backChip').onclick = function () { var p = backTo; backTo = null; showBack(); goTo(p); };

  function setMode(mode) {
    var p = cur;
    S.mode = mode; save();
    quiet = Date.now() + 400;
    reader.classList.toggle('paged', mode === 'paged');
    Array.prototype.forEach.call($('modeSeg').children, function (b) { b.classList.toggle('on', b.dataset.mode === mode); });
    requestAnimationFrame(function () { goTo(p); });
  }
  window.addEventListener('resize', function () {
    if (!D) return;
    var p = cur; quiet = Date.now() + 400;
    requestAnimationFrame(function () { goTo(p); });
  });

  /* ---------- theme ---------- */
  var mq = window.matchMedia('(prefers-color-scheme: dark)');
  function isDark() { return S.theme === 'dark' || (S.theme === 'auto' && mq.matches); }
  function applyTheme() {
    document.documentElement.classList.toggle('dark', isDark());
    var meta = document.querySelector('meta[name=theme-color]');
    if (meta) meta.content = '#14532d';
    Array.prototype.forEach.call($('themeSeg').children, function (b) { b.classList.toggle('on', b.dataset.theme === S.theme); });
  }
  if (mq.addEventListener) mq.addEventListener('change', function () { if (S) applyTheme(); });
  $('themeBtn').onclick = function () { S.theme = isDark() ? 'light' : 'dark'; save(); applyTheme(); };
  $('themeSeg').onclick = function (e) { var t = e.target.dataset.theme; if (t) { S.theme = t; save(); applyTheme(); } };
  $('modeSeg').onclick = function (e) { var m = e.target.dataset.mode; if (m) setMode(m); };

  /* ---------- bookmarks ---------- */
  function toggleMark(p) {
    var i = S.marks.indexOf(p);
    if (i >= 0) S.marks.splice(i, 1); else S.marks.push(p);
    S.marks.sort(function (a, b) { return a - b; });
    pages[p - 1].classList.toggle('marked', i < 0);
    save(); setCur(cur);
    return i < 0;
  }
  $('bSave').onclick = function () {
    toast(toggleMark(cur) ? 'Page ' + cur + ' bookmarked' : 'Bookmark removed');
  };
  function li(num, en, ur, onGo, onDel, isCur) {
    var l = document.createElement('li'); if (isCur) l.className = 'cur';
    var b = document.createElement('button'); b.className = 'go';
    var n = document.createElement('span'); n.className = 'num'; n.textContent = num;
    var t = document.createElement('span'); t.className = 'ttl';
    var e = document.createElement('span'); e.className = 'en'; e.textContent = en; t.appendChild(e);
    if (ur) { var u = document.createElement('span'); u.className = 'ur'; u.lang = 'ur'; u.textContent = ur; t.appendChild(u); }
    b.appendChild(n); b.appendChild(t); b.onclick = onGo; l.appendChild(b);
    if (onDel) { var d = document.createElement('button'); d.className = 'del'; d.textContent = 'Remove'; d.onclick = onDel; l.appendChild(d); }
    return l;
  }
  function emptyLi(text) { var l = document.createElement('li'); var s = document.createElement('span'); s.className = 'empty'; s.textContent = text; l.appendChild(s); return l; }
  function renderMarks() {
    var ul = $('marksList'); ul.textContent = '';
    if (!S.marks.length) ul.appendChild(emptyLi('No bookmarks yet. Tap "Save page" on any page.'));
    S.marks.forEach(function (p) {
      ul.appendChild(li(p, sectionOf(p), '', function () { closePanel(); goTo(p, true); },
        function () { toggleMark(p); renderMarks(); }));
    });
    var hu = $('hlList'); hu.textContent = '';
    var hp = Object.keys(S.hl).map(Number).filter(function (p) { return S.hl[p] && S.hl[p].length; }).sort(function (a, b) { return a - b; });
    if (!hp.length) hu.appendChild(emptyLi('No highlights yet. Tap "Highlight", then drag across a dua.'));
    hp.forEach(function (p) {
      var c = S.hl[p].length;
      hu.appendChild(li(p, sectionOf(p) + ' (' + c + (c === 1 ? ' highlight)' : ' highlights)'), '', function () { closePanel(); goTo(p, true); }));
    });
  }

  /* ---------- index ---------- */
  function renderIndex() {
    var q = $('indexSearch').value.trim().toLowerCase();
    var ul = $('indexList'); ul.textContent = '';
    var curSec = null;
    D.sections.forEach(function (s) { if (s.page <= cur) curSec = s; });
    var n = 0;
    D.sections.forEach(function (s) {
      if (q && s.en.toLowerCase().indexOf(q) < 0 && s.ur.indexOf(q) < 0 && String(s.page).indexOf(q) !== 0) return;
      n++;
      ul.appendChild(li(s.page, s.en, s.ur, function () { closePanel(); goTo(s.page, true); }, null, s === curSec));
    });
    if (!n) ul.appendChild(emptyLi('No section matches.'));
  }
  $('indexSearch').oninput = renderIndex;

  /* ---------- highlights ---------- */
  function drawBands(p) {
    var layer = pages[p - 1].querySelector('.hl');
    layer.textContent = '';
    (S.hl[p] || []).forEach(function (r, i) {
      var b = document.createElement('div'); b.className = 'band'; b.dataset.i = i;
      b.style.left = r[0] * 100 + '%'; b.style.top = r[1] * 100 + '%';
      b.style.width = r[2] * 100 + '%'; b.style.height = r[3] * 100 + '%';
      layer.appendChild(b);
    });
  }
  function setHl(on) {
    document.body.classList.toggle('hl-on', on);
    $('bHl').classList.toggle('on', on);
    $('hlBanner').hidden = !on;
    if (on) document.body.classList.remove('bars-off');
  }
  $('bHl').onclick = function () { setHl(!document.body.classList.contains('hl-on')); };
  $('hlDone').onclick = function () { setHl(false); };
  var drag = null;
  function frac(layer, e) {
    var r = layer.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
  }
  function rectOf(a, b) {
    var x = Math.min(a[0], b[0]), y = Math.min(a[1], b[1]), w = Math.abs(a[0] - b[0]), h = Math.abs(a[1] - b[1]);
    if (h < 0.04) { y = Math.max(0, (a[1] + b[1]) / 2 - 0.03); h = 0.06; }   // a sideways drag makes a line-high band
    return [x, y, w, h].map(function (v) { return Math.round(v * 10000) / 10000; });
  }
  reader.addEventListener('pointerdown', function (e) {
    if (!document.body.classList.contains('hl-on')) return;
    var band = e.target.closest('.band'), layer = e.target.closest('.hl');
    if (!layer) return;
    var p = +layer.closest('.pg').dataset.p;
    if (band && !band.classList.contains('temp')) {
      var i = +band.dataset.i, removed = S.hl[p].splice(i, 1)[0];
      if (!S.hl[p].length) delete S.hl[p];
      save(); drawBands(p);
      toast('Highlight removed', 'Undo', function () { (S.hl[p] = S.hl[p] || []).push(removed); save(); drawBands(p); });
      e.preventDefault(); return;
    }
    var t = document.createElement('div'); t.className = 'band temp'; layer.appendChild(t);
    drag = { layer: layer, p: p, a: frac(layer, e), el: t, id: e.pointerId };
    try { layer.setPointerCapture(e.pointerId); } catch (x) {}
    e.preventDefault();
  });
  reader.addEventListener('pointermove', function (e) {
    if (!drag || e.pointerId !== drag.id) return;
    var r = rectOf(drag.a, frac(drag.layer, e));
    drag.el.style.left = r[0] * 100 + '%'; drag.el.style.top = r[1] * 100 + '%';
    drag.el.style.width = r[2] * 100 + '%'; drag.el.style.height = r[3] * 100 + '%';
  });
  function endDrag(e, cancel) {
    if (!drag || e.pointerId !== drag.id) return;
    var d = drag; drag = null;
    var b = frac(d.layer, e), r = rectOf(d.a, b);
    d.el.remove();
    if (cancel || r[2] < 0.03) return;                 // a tap, not a drag
    (S.hl[d.p] = S.hl[d.p] || []).push(r); save(); drawBands(d.p);
  }
  reader.addEventListener('pointerup', function (e) { endDrag(e, false); });
  reader.addEventListener('pointercancel', function (e) { endDrag(e, true); });

  /* ---------- taps on the page ---------- */
  reader.addEventListener('click', function (e) {
    var z = e.target.closest('.zone');
    if (z) { e.preventDefault(); goTo(+z.dataset.to, true); return; }
    if (document.body.classList.contains('hl-on')) return;
    document.body.classList.toggle('bars-off');
  });
  $('prev').onclick = function () { goTo(cur - 1); };
  $('next').onclick = function () { goTo(cur + 1); };
  document.addEventListener('keydown', function (e) {
    if (openPanel || e.target.tagName === 'INPUT') return;
    if (e.key === 'ArrowLeft' || e.key === 'PageDown') { goTo(cur + 1); e.preventDefault(); }
    if (e.key === 'ArrowRight' || e.key === 'PageUp') { goTo(cur - 1); e.preventDefault(); }
  });

  /* ---------- panels ---------- */
  function showPanel(id) {
    if (openPanel) hidePanel();
    openPanel = id; $(id).hidden = false; $('scrim').hidden = false;
    try { history.pushState({ panel: id }, ''); } catch (e) {}
  }
  function hidePanel() { if (!openPanel) return; $(openPanel).hidden = true; $('scrim').hidden = true; openPanel = null; }
  function closePanel() {
    if (!openPanel) return;
    hidePanel();
    try { if (history.state && history.state.panel) history.back(); } catch (e) {}
  }
  window.addEventListener('popstate', hidePanel);
  $('scrim').onclick = closePanel;
  document.addEventListener('click', function (e) { if (e.target.closest('[data-close]')) closePanel(); });

  $('bHome').onclick = function () {
    $('hContinue').textContent = 'Continue reading (page ' + cur + ')';
    showPanel('home');
  };
  $('bIndex').onclick = function () { $('indexSearch').value = ''; renderIndex(); showPanel('index'); };
  $('bMarks').onclick = function () { renderMarks(); showPanel('marks'); };
  $('pageBtn').onclick = function () {
    $('gotoInput').value = ''; showPanel('goto');
    setTimeout(function () { $('gotoInput').focus(); }, 50);
  };
  $('gotoForm').onsubmit = function (e) {
    e.preventDefault();
    var v = parseInt($('gotoInput').value, 10);
    if (!v || v < 1 || v > D.pages) { toast('Enter a page from 1 to ' + D.pages); return; }
    closePanel(); goTo(v, true);
  };
  $('hContinue').onclick = closePanel;
  $('hContents').onclick = function () { closePanel(); goTo(D.contentsPage, true); };
  $('hCover').onclick = function () { closePanel(); goTo(1, true); };
  $('hShare').onclick = function () {
    var url = location.origin + location.pathname;
    if (navigator.share) navigator.share({ title: D.title, text: 'Dua Kitab: the Complete Dua Book, free to read offline.', url: url }).catch(function () {});
    else if (navigator.clipboard) navigator.clipboard.writeText(url).then(function () { toast('Link copied'); });
    else toast(url, null, null, 8000);
  };

  /* ---------- install ---------- */
  var standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  var isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferredInstall = e; $('installNow').hidden = false; });
  window.addEventListener('appinstalled', function () { deferredInstall = null; $('hint').hidden = true; });
  function showInstall() {
    $('installIos').hidden = !isIos && /android/i.test(navigator.userAgent);
    $('installAndroid').hidden = isIos;
    showPanel('install');
  }
  $('hInstall').onclick = showInstall;
  $('hintHow').onclick = function () { $('hint').hidden = true; showInstall(); };
  $('hintX').onclick = function () { $('hint').hidden = true; S.hintAt = Date.now(); save(); };
  $('installNow').onclick = function () {
    if (!deferredInstall) return;
    deferredInstall.prompt(); deferredInstall = null; $('installNow').hidden = true; closePanel();
  };
  function maybeHint() {
    if (standalone) { $('hInstall').hidden = true; return; }
    if (Date.now() - S.hintAt < 7 * 864e5) return;
    setTimeout(function () { if (!openPanel) $('hint').hidden = false; }, 2500);
  }

  /* ---------- offline copy ---------- */
  function offlineText(done) {
    $('offlineInfo').textContent = done >= D.pages ? 'Saved for offline reading: all ' + D.pages + ' pages.'
      : 'Saving for offline reading: ' + done + ' of ' + D.pages + ' pages.';
  }
  function saveOffline() {
    if (!('caches' in window) || !('serviceWorker' in navigator)) { $('offlineInfo').textContent = 'Offline reading is not supported in this browser.'; return; }
    var name = 'pages-e' + D.edition, done = 0, next = 1;
    caches.open(name).then(function (cache) {
      function one() {
        if (next > D.pages) return Promise.resolve();
        var p = next++, url = pageSrc(p);
        return cache.match(url).then(function (hit) {
          if (hit) return;
          return fetch(url).then(function (r) { if (r.ok) return cache.put(url, r); throw new Error('http ' + r.status); });
        }).then(function () { done++; if (done % 5 === 0 || done === D.pages) offlineText(done); }, function () {}).then(one);
      }
      offlineText(0);
      return Promise.all([one(), one(), one(), one()]).then(function () {
        offlineText(done);
        if (done >= D.pages) return caches.keys().then(function (keys) {
          keys.forEach(function (k) { if (k.indexOf('pages-e') === 0 && k !== name) caches.delete(k); });
        });
      });
    }).catch(function () {});
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
  }

  /* ---------- start ---------- */
  function start(data) {
    D = data;
    S = loadState(); migrate();
    if (/[?&]zones=1/.test(location.search)) document.body.classList.add('zones-debug');
    $('tot').textContent = D.pages; $('gotoMax').textContent = D.pages; $('gotoInput').max = D.pages;
    $('coverImg').src = pageSrc(1);
    $('editionInfo').textContent = 'Edition ' + D.edition + ', ' + D.editionDate + '.';
    applyTheme();
    buildPages();
    reader.classList.toggle('paged', S.mode === 'paged');
    Array.prototype.forEach.call($('modeSeg').children, function (b) { b.classList.toggle('on', b.dataset.mode === S.mode); });
    var m = /[?&#]p(?:age)?=(\d+)/.exec(location.href);
    quiet = Date.now() + 500;
    requestAnimationFrame(function () { goTo(m ? +m[1] : S.last); });
    maybeHint();
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').then(function () { return navigator.serviceWorker.ready; }).then(saveOffline).catch(function () {});
    }
  }
  fetch('data.json').then(function (r) { return r.json(); }).then(start).catch(function () {
    document.body.insertAdjacentHTML('beforeend', '<p style="position:fixed;top:40%;left:0;right:0;text-align:center;padding:20px">Could not load the book. Check your internet connection and open again.</p>');
  });
})();
