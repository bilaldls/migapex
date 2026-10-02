(function () {
  'use strict';

  var VIDEO_URL = 'assets/hero-scrub.mp4';
  var VIDEO_BYTES = 9360160;
  var POSTER_URL = 'assets/hero-poster.jpg';

  var hero = document.getElementById('hero');
  var stage = document.getElementById('stage');
  var video = document.getElementById('video');
  var poster = document.getElementById('poster');
  var ring = document.getElementById('ring');
  var cue = document.getElementById('cue');
  var nav = document.getElementById('nav');
  var bandEls = [].slice.call(document.querySelectorAll('.band'));
  var vfEls = [].slice.call(document.querySelectorAll('.vf'));

  var clamp = function (v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; };
  var smoothstep = function (p, e0, e1) {
    var t = clamp((p - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  };
  function rng(seed) {
    var s = seed >>> 0;
    return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

  /* ------------------------------------------------------------------ */
  /* découpage du texte, une seule fois au chargement                    */
  /* ------------------------------------------------------------------ */

  function split(el, mode, entrance, spread) {
    var text = el.textContent;
    var r = rng(text.length * 7919 + mode.length);
    el.textContent = '';

    var sr = document.createElement('span');
    sr.className = 'sr';
    sr.textContent = text;
    el.appendChild(sr);

    var vis = document.createElement('span');
    vis.setAttribute('aria-hidden', 'true');

    var words = text.split(' ');
    var chars = [];

    words.forEach(function (word, wi) {
      var w = document.createElement('span');
      w.className = 'w';
      if (mode === 'char') {
        for (var i = 0; i < word.length; i++) {
          var c = document.createElement('span');
          c.className = 'c';
          c.textContent = word[i];
          w.appendChild(c);
          chars.push(c);
        }
      } else {
        w.textContent = word;
      }
      vis.appendChild(w);
      /* une vraie espace de texte, pas un bloc : elle se supprime en fin de
         ligne au lieu de décaler la ligne suivante */
      if (wi < words.length - 1) vis.appendChild(document.createTextNode(' '));
    });
    el.appendChild(vis);

    var units = mode === 'char' ? chars : [].slice.call(vis.querySelectorAll('.w'));
    var n = units.length || 1;
    var sp = spread || 0.5;

    units.forEach(function (u, i) {
      var th;
      if (entrance === 'scatter') {
        th = r() * sp;
        u.style.setProperty('--jx', (r() * 64 - 32).toFixed(1) + 'px');
        u.style.setProperty('--jy', (r() * 52 - 26).toFixed(1) + 'px');
        u.style.setProperty('--jr', (r() * 26 - 13).toFixed(1) + 'deg');
      } else if (entrance === 'grid') {
        th = (i / n) * sp + r() * 0.06;
        u.style.setProperty('--jx', (-14 - r() * 22).toFixed(1) + 'px');
      } else {
        th = (i / n) * sp + r() * 0.05;
      }
      u.style.setProperty('--th', th.toFixed(3));
    });
  }

  bandEls.forEach(function (band) {
    var entrance = band.getAttribute('data-entrance') || 'rise';
    var spread = parseFloat(band.getAttribute('data-spread')) || (entrance === 'rise' ? 0.55 : 0.5);
    [].slice.call(band.querySelectorAll('[data-split]')).forEach(function (el) {
      split(el, el.getAttribute('data-split'), entrance, spread);
    });
    band._a = parseFloat(band.getAttribute('data-a'));
    band._b = parseFloat(band.getAttribute('data-b'));
    var ramp = parseFloat(band.getAttribute('data-ramp'));
    band._ramp = ramp || Math.min(0.025, (band._b - band._a) * 0.35);
    band._op = -1;
    band._k = -1;
  });

  vfEls.forEach(function (vf) {
    vf._a = parseFloat(vf.getAttribute('data-a'));
    vf._b = parseFloat(vf.getAttribute('data-b'));
    vf._op = -1;
    vf._media = vf.querySelector('.vf-media');
    vf._playing = false;
    vf._loaded = false;
  });

  [].slice.call(document.querySelectorAll('.reveal[data-split], .big[data-split], .mid[data-split]'))
    .forEach(function (el) { split(el, el.getAttribute('data-split'), 'rise', 0.5); });

  /* ------------------------------------------------------------------ */
  /* chargement de la vidéo en flux, derrière l'anneau                   */
  /* ------------------------------------------------------------------ */

  var started = false;
  var heroInit = false;

  function failVideo() {
    if (ring) ring.style.opacity = '0';
    stage.classList.add('video-failed');
  }

  function loadHeroBlob() {
    var ctrl = new AbortController();
    var watchdog = setTimeout(function () { ctrl.abort(); }, 20000);

    return fetch(VIDEO_URL, { signal: ctrl.signal }).then(function (res) {
      if (!res.ok || !res.body) throw new Error('http ' + res.status);
      var total = Number(res.headers.get('Content-Length')) || VIDEO_BYTES;
      var reader = res.body.getReader();
      var chunks = [];
      var got = 0, lastRing = 0;

      function pump() {
        return reader.read().then(function (r) {
          if (r.done) return;
          clearTimeout(watchdog);
          watchdog = setTimeout(function () { ctrl.abort(); }, 20000);
          chunks.push(r.value);
          got += r.value.length;
          var frac = Math.min(1, got / total);
          var now = performance.now();
          if (now - lastRing > 100 || frac === 1) {
            lastRing = now;
            ring.style.setProperty('--ld', Math.round(126 * (1 - frac)));
          }
          return pump();
        });
      }

      return pump().then(function () {
        clearTimeout(watchdog);
        ring.style.setProperty('--ld', 0);
        video.src = URL.createObjectURL(new Blob(chunks, { type: 'video/mp4' }));
        video.load();
        video.addEventListener('canplay', function () {
          requestSeek(heroProgress() * video.duration);
          stage.classList.add('video-ready');
        }, { once: true });
      });
    });
  }

  function startBlobFetch() {
    if (started) return;
    started = true;
    loadHeroBlob().catch(failVideo);
  }

  function initHeroOnce() {
    if (heroInit) return;
    heroInit = true;
    poster.style.backgroundImage = "url('" + POSTER_URL + "')";
    var img = new Image();
    img.onload = startBlobFetch;
    img.onerror = startBlobFetch;
    img.src = POSTER_URL;
    setTimeout(startBlobFetch, 4000);
  }

  video.addEventListener('error', function () {
    seekBusy = false;
    pendingTime = null;
    failVideo();
  });

  /* ------------------------------------------------------------------ */
  /* seeks barrés                                                        */
  /* ------------------------------------------------------------------ */

  var seekBusy = false;
  var pendingTime = null;

  function requestSeek(t) {
    if (!video.duration || !isFinite(video.duration)) return;
    if (seekBusy) { pendingTime = t; return; }
    seekBusy = true;
    try { video.currentTime = t; } catch (e) { seekBusy = false; }
  }

  video.addEventListener('seeked', function () {
    seekBusy = false;
    if (pendingTime !== null) {
      var t = pendingTime;
      pendingTime = null;
      requestSeek(t);
    }
  });

  /* ------------------------------------------------------------------ */
  /* boucle de lecture, au repos dès convergence                         */
  /* ------------------------------------------------------------------ */

  var target = 0, shown = 0, rafId = null, lastTick = 0;
  var heroOnScreen = true;
  var loadK = 0, loadStart = 0;

  function heroProgress() {
    var total = hero.offsetHeight - window.innerHeight;
    if (total <= 0) return 0;
    return clamp(-hero.getBoundingClientRect().top / total, 0, 1);
  }

  function tick(now) {
    var dt = Math.min(100, now - (lastTick || now));
    lastTick = now;
    var k = 0.16;
    shown += (target - shown) * (1 - Math.pow(1 - k, dt / 16.667));

    if (loadK < 1) {
      if (!loadStart) loadStart = now;
      loadK = clamp((now - loadStart) / 1100, 0, 1);
    }

    var converged = Math.abs(target - shown) < 0.0005 && loadK >= 1;
    if (converged) { shown = target; rafId = null; lastTick = 0; }
    else { rafId = requestAnimationFrame(tick); }

    if (video.duration) requestSeek(shown * video.duration);
    updateCaptions(shown);
  }

  function kick() {
    if (rafId === null && heroOnScreen && scrubOn) {
      lastTick = 0;
      rafId = requestAnimationFrame(tick);
    }
  }

  function onScroll() {
    target = heroProgress();
    kick();
  }

  /* ------------------------------------------------------------------ */
  /* bandes : opacité, assemblage, panneaux                              */
  /* ------------------------------------------------------------------ */

  var lastCueGone = null;

  function updateCaptions(p) {
    var last = bandEls.length - 1;

    bandEls.forEach(function (band, i) {
      var a = band._a, b = band._b;
      var f = Math.min(0.02, (b - a) / 3);
      var easeIn = i === 0 ? 1 : smoothstep(p, a, a + f);
      var easeOut = i === last ? 1 : 1 - smoothstep(p, b - f, b);
      var op = easeIn * easeOut;

      var k = clamp((p - a) / band._ramp, 0, 1);
      if (i === 0) k = Math.max(k, loadK);

      if (Math.abs(op - band._op) > 0.004) {
        band._op = op;
        band.style.opacity = op.toFixed(3);
      }
      if (Math.abs(k - band._k) > 0.008) {
        band._k = k;
        band.style.setProperty('--k', k.toFixed(3));
        if (band.classList.contains('settle')) {
          band.style.setProperty('--ks', clamp((k - 0.5) * 2.6, 0, 1).toFixed(3));
          band.style.setProperty('--kb', clamp((k - 0.68) * 3.2, 0, 1).toFixed(3));
        }
      }
    });

    vfEls.forEach(function (vf) {
      var a = vf._a, b = vf._b;
      var f = Math.min(0.03, (b - a) / 3);
      var op = smoothstep(p, a, a + f) * (1 - smoothstep(p, b - f, b));

      if (Math.abs(op - vf._op) > 0.004) {
        vf._op = op;
        vf.style.opacity = op.toFixed(3);
        vf.style.setProperty('--rk', clamp(op * 1.3, 0, 1).toFixed(3));
        var m = vf._media;
        if (m) {
          if (op > 0.02) {
            if (!vf._loaded) { vf._loaded = true; m.src = m.getAttribute('data-src'); }
            if (!vf._playing) { vf._playing = true; var q = m.play(); if (q && q.catch) q.catch(function () {}); }
          } else if (vf._playing) {
            vf._playing = false;
            m.pause();
          }
        }
      }
    });

    var gone = p > 0.03;
    if (gone !== lastCueGone) {
      lastCueGone = gone;
      cue.classList.toggle('gone', gone);
    }
  }

  /* ------------------------------------------------------------------ */
  /* les cinq portes, tenues vivantes                                    */
  /* ------------------------------------------------------------------ */

  var GATES = [
    '(max-width: 720px)',
    '(orientation: portrait) and (max-width: 1024px)',
    '(orientation: portrait) and (pointer: coarse)',
    '(orientation: landscape) and (pointer: coarse) and (max-height: 560px)',
    '(prefers-reduced-motion: reduce)'
  ];
  var MQLS = GATES.map(function (q) { return matchMedia(q); });
  var scrubOn = false;

  function enableScrub() {
    if (scrubOn) return;
    scrubOn = true;
    initHeroOnce();
    addEventListener('scroll', onScroll, { passive: true });
    bandEls.forEach(function (b) { b._op = -1; b._k = -1; });
    vfEls.forEach(function (v) { v._op = -1; });
    lastCueGone = null;
    unpinFinalStates();
    updateCaptions(heroProgress());
    onScroll();
  }

  function disableScrub() {
    if (!scrubOn) return;
    scrubOn = false;
    removeEventListener('scroll', onScroll);
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    vfEls.forEach(function (v) { if (v._playing) { v._playing = false; v._media.pause(); } });
  }

  function applyHeroMode() {
    if (MQLS.some(function (m) { return m.matches; })) disableScrub();
    else enableScrub();
  }
  MQLS.forEach(function (m) { m.addEventListener('change', applyHeroMode); });

  if (hero && stage) {
    new IntersectionObserver(function (entries) {
      heroOnScreen = entries[0].isIntersecting;
      document.body.classList.toggle('hero-off', !heroOnScreen);
      if (heroOnScreen) kick();
      else if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    }, { rootMargin: '10px' }).observe(hero);
  }

  /* ------------------------------------------------------------------ */
  /* barre de navigation                                                 */
  /* ------------------------------------------------------------------ */

  var lastSolid = null;
  addEventListener('scroll', function () {
    var solid = scrollY > 48;
    if (solid !== lastSolid) { lastSolid = solid; nav.classList.toggle('solid', solid); }
  }, { passive: true });

  /* ------------------------------------------------------------------ */
  /* entrées au défilement                                               */
  /* ------------------------------------------------------------------ */

  var revealObs = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      var el = e.target;
      el.classList.add('in');
      revealObs.unobserve(el);
      setTimeout(function () { el.classList.add('settled'); }, 1400);
    });
  }, { rootMargin: '0px 0px -12% 0px', threshold: 0.12 });
  [].slice.call(document.querySelectorAll('.reveal')).forEach(function (el) { revealObs.observe(el); });

  /* vidéos de la galerie : chargées et jouées seulement à l'écran */
  var mediaObs = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      var v = e.target;
      if (e.isIntersecting) {
        if (!v.src) v.src = v.getAttribute('data-src');
        var q = v.play(); if (q && q.catch) q.catch(function () {});
      } else if (!v.paused) v.pause();
    });
  }, { threshold: 0.25 });
  [].slice.call(document.querySelectorAll('.vf-media.lazy')).forEach(function (v) { mediaObs.observe(v); });

  /* trait de côte qui se trace */
  var coastEls = [].slice.call(document.querySelectorAll('.rule'));
  var coastCache = new WeakMap();
  function drawCoast() {
    coastEls.forEach(function (el) {
      var r = el.getBoundingClientRect();
      var d = clamp((innerHeight - r.top) / (innerHeight * 0.72), 0, 1);
      var prev = coastCache.get(el);
      if (prev === undefined || Math.abs(d - prev) > 0.01) {
        coastCache.set(el, d);
        el.style.setProperty('--draw', d.toFixed(3));
      }
    });
  }
  addEventListener('scroll', drawCoast, { passive: true });
  drawCoast();

  /* ------------------------------------------------------------------ */
  /* le moment tenu : écrire un plan                                     */
  /* ------------------------------------------------------------------ */

  var hold = document.getElementById('hold');
  var steps = document.getElementById('steps');
  var hudAlt = document.getElementById('hud-alt');
  var hudCap = document.getElementById('hud-cap');
  var hudLum = document.getElementById('hud-lum');

  if (hold && steps) {
    var h = 0, holding = false, hRaf = null, hLast = 0, hudAt = 0, completed = false;
    var hudCache = ['', '', ''];

    function writeHud(i, el, text) {
      if (hudCache[i] === text) return;
      hudCache[i] = text;
      el.textContent = text;
    }

    function hudUpdate(now) {
      if (now - hudAt < 100) return;
      hudAt = now;
      writeHud(0, hudAlt, String(Math.round(h * 118)).padStart(3, '0') + ' m');
      writeHud(1, hudCap, String(Math.round(h * 271)).padStart(3, '0') + '°');
      writeHud(2, hudLum, h > 0.72 ? 'dorée' : h > 0.3 ? 'calcul' : 'attente');
    }

    function hTick(now) {
      var dt = Math.min(100, now - (hLast || now));
      hLast = now;
      /* une fois le plan complet, il reste tracé : le visiteur l'a mérité */
      var speed = holding ? 0.00105 : (completed ? 0 : -0.0016);
      h = clamp(h + speed * dt, 0, 1);
      hold.style.setProperty('--h', h.toFixed(3));
      hudUpdate(now);

      if (h >= 1 && !completed) {
        completed = true;
        hold.classList.add('done');
        hold.setAttribute('aria-pressed', 'true');
        steps.classList.add('lit');
        setTimeout(function () { steps.classList.add('settled'); }, 1500);
      }
      if ((holding && h < 1) || (!holding && h > 0 && !completed)) hRaf = requestAnimationFrame(hTick);
      else { hRaf = null; hLast = 0; }
    }

    function hKick() { if (hRaf === null) { hLast = 0; hRaf = requestAnimationFrame(hTick); } }
    function down(e) { if (e.cancelable && e.pointerType !== 'mouse') e.preventDefault(); holding = true; hKick(); }
    function up() { holding = false; hKick(); }

    hold.addEventListener('pointerdown', down);
    hold.addEventListener('pointerup', up);
    hold.addEventListener('pointercancel', up);
    hold.addEventListener('pointerleave', up);
    hold.addEventListener('keydown', function (e) {
      if (e.key !== ' ' && e.key !== 'Enter') return;
      e.preventDefault();
      if (!holding) { holding = true; hKick(); }
    });
    hold.addEventListener('keyup', function (e) {
      if (e.key !== ' ' && e.key !== 'Enter') return;
      up();
    });
    hold.addEventListener('blur', up);
  }

  /* ------------------------------------------------------------------ */
  /* formulaire                                                          */
  /* ------------------------------------------------------------------ */

  var form = document.getElementById('form');
  if (form) {
    var errEl = document.getElementById('f-err');
    var okEl = document.getElementById('f-ok');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var contact = document.getElementById('f-contact');
      var ok = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(contact.value.trim());
      errEl.hidden = ok;
      if (!ok) { contact.focus(); return; }

      var get = function (id) { return (document.getElementById(id).value || '').trim() || 'non precise'; };
      var lines = [
        'Type de mission : ' + get('f-mission'),
        'Lieu : ' + get('f-lieu'),
        'Date : ' + get('f-date'),
        'Livrable : ' + get('f-livrable'),
        'Contact : ' + contact.value.trim()
      ].join('\n');

      /* l'état de succès s'affiche d'abord : si la messagerie du visiteur ne
         s'ouvre pas, il voit quand même son récapitulatif et ne perd rien */
      form.hidden = true;
      okEl.hidden = false;
      okEl.setAttribute('tabindex', '-1');
      okEl.focus();

      /* A COMPLETER : adresse e-mail reelle de migapex */
      var to = 'A-COMPLETER@migapex.invalid';
      try {
        location.href = 'mailto:' + to +
          '?subject=' + encodeURIComponent('Plan de vol, demande de devis') +
          '&body=' + encodeURIComponent(lines);
      } catch (err) { /* pas de client mail : l'état de succès reste affiché */ }
    });
  }

  /* ------------------------------------------------------------------ */
  /* pauses et mouvement réduit                                          */
  /* ------------------------------------------------------------------ */

  addEventListener('visibilitychange', function () {
    document.body.classList.toggle('paused', document.hidden);
  });

  function pinToFinalStates() {
    [].slice.call(document.querySelectorAll('.reveal')).forEach(function (el) {
      el.classList.add('in', 'settled');
    });
    if (steps) steps.classList.add('lit', 'settled');
    if (hold) { hold.style.setProperty('--h', '1'); hold.classList.add('done'); }
    coastEls.forEach(function (el) { el.style.setProperty('--draw', '1'); });
  }

  function unpinFinalStates() {
    if (hold) { hold.style.removeProperty('--h'); hold.classList.remove('done'); }
    if (steps) steps.classList.remove('lit', 'settled');
    coastEls.forEach(function (el) {
      el.style.removeProperty('--draw');
      coastCache.delete(el);
    });
    drawCoast();
    /* ce qui est encore sous la fenêtre redevient piloté par le défilement */
    [].slice.call(document.querySelectorAll('.reveal')).forEach(function (el) {
      if (el.getBoundingClientRect().top > innerHeight) {
        el.classList.remove('in', 'settled');
        revealObs.observe(el);
      }
    });
  }

  matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', function (e) {
    if (e.matches) pinToFinalStates();
    else applyHeroMode();
  });

  if (matchMedia('(prefers-reduced-motion: reduce)').matches) pinToFinalStates();
  applyHeroMode();
})();
