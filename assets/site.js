(function () {
  'use strict';

  var VIDEO_URL = 'assets/hero-scrub.mp4?v=2';
  var VIDEO_BYTES = 6796414;
  var POSTER_URL = 'assets/hero-poster.jpg?v=2';
  /* temps (s) où le drone passe sur chaque balise, relevés image par image
     dans la vidéo : départ, étapes 01 à 04, puis le col (fin de la vidéo) */
  var STOPS = [0, 2.0, 7.0, 9.6, 11.9, 15.0];

  var flight = document.getElementById('flight');
  var video = document.getElementById('video');
  var poster = document.getElementById('poster');
  var ring = document.getElementById('ring');
  var cue = document.getElementById('cue');
  var chip = document.getElementById('chip');
  var chipN = document.getElementById('chip-n');
  var chipName = document.getElementById('chip-name');
  var nav = document.getElementById('nav');
  var route = document.getElementById('route');
  var routeBase = document.getElementById('route-base');
  var routeFill = document.getElementById('route-fill');
  var routeLis = [].slice.call(document.querySelectorAll('#route-stops li'));
  var bandEls = [].slice.call(document.querySelectorAll('.band'));
  var legEls = [].slice.call(document.querySelectorAll('[data-leg]'));
  var stopEls = [].slice.call(document.querySelectorAll('.stop'));

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
    words.forEach(function (word, wi) {
      var w = document.createElement('span');
      w.className = 'w';
      w.textContent = word;
      vis.appendChild(w);
      /* une vraie espace de texte : elle se supprime en fin de ligne */
      if (wi < words.length - 1) vis.appendChild(document.createTextNode(' '));
    });
    el.appendChild(vis);

    var units = [].slice.call(vis.querySelectorAll('.w'));
    var n = units.length || 1;
    var sp = spread || 0.5;
    units.forEach(function (u, i) {
      u.style.setProperty('--th', ((i / n) * sp + r() * 0.05).toFixed(3));
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
    band._ramp = ramp || Math.min(0.06, (band._b - band._a) * 0.35);
    band._op = -1;
    band._k = -1;
  });

  [].slice.call(document.querySelectorAll('.reveal[data-split], .big[data-split], .mid[data-split]'))
    .forEach(function (el) { split(el, el.getAttribute('data-split'), 'rise', 0.5); });

  /* ------------------------------------------------------------------ */
  /* géométrie des tronçons, recalculée au redimensionnement             */
  /* ------------------------------------------------------------------ */

  /* hauteur d'écran (depuis le haut) où se trouve le haut de l'étape quand le drone se pose */
  var ARRIVE = 0.62;
  var legs = [];
  function measure() {
    var vh = window.innerHeight;
    legs = legEls.map(function (el, i) {
      var top = el.getBoundingClientRect().top + window.scrollY;
      var h = el.offsetHeight;
      /* le tronçon avance quand il traverse le milieu de l'écran : le drone se
         pose sur la balise au moment où l'étape suivante entre par le milieu */
      return {
        el: el, i: i,
        start: Math.max(0, top - vh * ARRIVE),
        end: Math.max(1, top + h - vh * ARRIVE),
        t0: STOPS[i], t1: STOPS[i + 1],
        n: el.getAttribute('data-n'), name: el.getAttribute('data-name')
      };
    });
    layoutRoute();
  }

  /* position sur le parcours : 0 au départ, k au moment où l'étape k est atteinte */
  function routePos(y) {
    var pos = 0;
    for (var i = 0; i < legs.length; i++) {
      var L = legs[i];
      if (y < L.start) return { pos: pos, leg: -1, q: 0 };
      if (y <= L.end) {
        var q = (y - L.start) / (L.end - L.start);
        return { pos: i + q, leg: i, q: q };
      }
      pos = i + 1;
    }
    return { pos: pos, leg: -1, q: 0 };
  }

  /* temps vidéo pour une position : un léger freinage à l'approche de chaque balise */
  function timeAt(pos) {
    var i = Math.min(Math.floor(pos), STOPS.length - 2);
    var q = clamp(pos - i, 0, 1);
    var e = 0.45 * q + 0.55 * (q * q * (3 - 2 * q));
    var t1 = i === STOPS.length - 2 && video.duration ? video.duration - 0.04 : STOPS[i + 1];
    return STOPS[i] + (t1 - STOPS[i]) * e;
  }

  /* ------------------------------------------------------------------ */
  /* le tracé : rail de route                                            */
  /* ------------------------------------------------------------------ */

  var routeLen = 0;
  function layoutRoute() {
    if (!route || !routeBase || !route.offsetHeight) return;
    var w = route.offsetWidth, h = route.offsetHeight;
    routeLen = routeBase.getTotalLength();
    var n = routeLis.length;
    routeLis.forEach(function (li, k) {
      var pt = routeBase.getPointAtLength(routeLen * (k + 1) / n);
      li.style.setProperty('--x', (pt.x * w / 40).toFixed(1) + 'px');
      li.style.setProperty('--y', (pt.y * h / 400).toFixed(1) + 'px');
    });
  }

  var lastFill = -1, lastOn = -1, lastHere = -2;
  function updateRoute(pos) {
    var n = routeLis.length;
    var frac = clamp(pos / n, 0, 1);
    if (Math.abs(frac - lastFill) > 0.002) {
      lastFill = frac;
      routeFill.style.strokeDashoffset = (1 - frac).toFixed(4);
    }
    var on = Math.floor(pos + 0.02);
    var here = Math.abs(pos - Math.round(pos)) < 0.02 && Math.round(pos) >= 1 ? Math.round(pos) : -1;
    if (on !== lastOn || here !== lastHere) {
      lastOn = on; lastHere = here;
      routeLis.forEach(function (li, k) {
        li.classList.toggle('on', k + 1 <= on);
        li.classList.toggle('here', k + 1 === here);
      });
    }
  }

  /* ------------------------------------------------------------------ */
  /* chargement de la vidéo en flux, derrière l'anneau                   */
  /* ------------------------------------------------------------------ */

  var started = false;
  var heroInit = false;

  function failVideo() {
    if (ring) ring.style.opacity = '0';
    flight.classList.add('video-failed');
  }

  function loadHeroBlob() {
    var ctrl = new AbortController();
    var watchdog = setTimeout(function () { ctrl.abort(); }, 20000);

    return fetch(VIDEO_URL, { signal: ctrl.signal, priority: 'low' }).then(function (res) {
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
          requestSeek(timeAt(routePos(shownY).pos));
          flight.classList.add('video-ready');
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
  var lastSeek = -1;

  function requestSeek(t) {
    if (!video.duration || !isFinite(video.duration)) return;
    if (Math.abs(t - lastSeek) < 0.004) return;
    if (seekBusy) { pendingTime = t; return; }
    seekBusy = true;
    lastSeek = t;
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

  var targetY = 0, shownY = 0, rafId = null, lastTick = 0;
  var loadK = 0, loadStart = 0;

  function tick(now) {
    var dt = Math.min(100, now - (lastTick || now));
    lastTick = now;
    var k = 0.14;
    shownY += (targetY - shownY) * (1 - Math.pow(1 - k, dt / 16.667));

    if (loadK < 1) {
      if (!loadStart) loadStart = now;
      loadK = clamp((now - loadStart) / 1200, 0, 1);
    }

    var converged = Math.abs(targetY - shownY) < 0.5 && loadK >= 1;
    if (converged) { shownY = targetY; rafId = null; lastTick = 0; }
    else { rafId = requestAnimationFrame(tick); }

    render(shownY);
  }

  function kick() {
    if (rafId === null && scrubOn) {
      lastTick = 0;
      rafId = requestAnimationFrame(tick);
    }
  }

  function onScroll() {
    targetY = window.scrollY;
    kick();
  }

  /* ------------------------------------------------------------------ */
  /* rendu : vidéo, bandes d'ouverture, puce de tronçon, tracé           */
  /* ------------------------------------------------------------------ */

  var lastCueGone = null, lastCo = -1, chipLeg = -1;

  function render(y) {
    var rp = routePos(y);
    if (video.duration) requestSeek(timeAt(rp.pos));

    /* bandes du tronçon d'ouverture */
    var p0 = legs.length ? clamp((y - legs[0].start) / (legs[0].end - legs[0].start), 0, 1) : 0;
    bandEls.forEach(function (band, i) {
      var a = band._a, b = band._b;
      var f = Math.min(0.05, (b - a) / 3);
      var easeIn = i === 0 ? 1 : smoothstep(p0, a, a + f);
      var easeOut = 1 - smoothstep(p0, b - f, b);
      var op = easeIn * easeOut;
      var k = clamp((p0 - a) / band._ramp, 0, 1);
      if (i === 0) k = Math.max(k, loadK);

      if (Math.abs(op - band._op) > 0.004) {
        band._op = op;
        band.style.opacity = op.toFixed(3);
        band.style.visibility = op < 0.004 ? 'hidden' : '';
      }
      if (Math.abs(k - band._k) > 0.008) {
        band._k = k;
        band.style.setProperty('--k', k.toFixed(3));
        band.style.setProperty('--ks', clamp((k - 0.5) * 2.6, 0, 1).toFixed(3));
        band.style.setProperty('--kb', clamp((k - 0.68) * 3.2, 0, 1).toFixed(3));
      }
    });

    /* puce « vers l'étape » pendant les tronçons 1 à 4 */
    var co = 0;
    if (rp.leg >= 1) {
      co = smoothstep(rp.q, 0.04, 0.16) * (1 - smoothstep(rp.q, 0.8, 0.93));
      if (rp.leg !== chipLeg) {
        chipLeg = rp.leg;
        var L = legs[rp.leg];
        chipN.textContent = "Vers l'étape " + L.n;
        chipName.textContent = L.name;
      }
    }
    if (Math.abs(co - lastCo) > 0.01) {
      lastCo = co;
      chip.style.setProperty('--co', co.toFixed(3));
    }

    updateRoute(rp.pos);

    var gone = y > 40;
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
    document.body.classList.add('scrub');
    initHeroOnce();
    addEventListener('scroll', onScroll, { passive: true });
    bandEls.forEach(function (b) { b._op = -1; b._k = -1; });
    lastCueGone = null; lastCo = -1; lastFill = -1; lastOn = -1; lastHere = -2; chipLeg = -1;
    unpinFinalStates();
    measure();
    targetY = shownY = window.scrollY;
    render(shownY);
    kick();
    updateNav();
  }

  function disableScrub() {
    if (!scrubOn) return;
    scrubOn = false;
    document.body.classList.remove('scrub');
    removeEventListener('scroll', onScroll);
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    updateNav();
  }

  function applyHeroMode() {
    if (MQLS.some(function (m) { return m.matches; })) disableScrub();
    else enableScrub();
  }
  MQLS.forEach(function (m) { m.addEventListener('change', applyHeroMode); });

  var resizeT = null;
  addEventListener('resize', function () {
    clearTimeout(resizeT);
    resizeT = setTimeout(function () { if (scrubOn) { measure(); onScroll(); } }, 120);
  });
  /* les images de la galerie changent la hauteur des étapes en se chargeant */
  addEventListener('load', function () { if (scrubOn) { measure(); onScroll(); } });
  if (window.ResizeObserver) {
    new ResizeObserver(function () { if (scrubOn) { measure(); onScroll(); } }).observe(document.getElementById('main'));
  }

  /* ------------------------------------------------------------------ */
  /* barre de navigation                                                 */
  /* ------------------------------------------------------------------ */

  /* la barre devient pleine sur les étapes, et reste transparente pendant
     les tronçons pour ne jamais couper le ciel du vol */
  var lastSolid = null;
  function updateNav() {
    var y = scrollY, solid = y > 48;
    if (scrubOn) {
      solid = false;
      for (var i = 0; i < stopEls.length; i++) {
        var r = stopEls[i].getBoundingClientRect();
        if (r.top + innerHeight * 0.2 <= 0 && r.bottom > 70) { solid = true; break; }
      }
    }
    if (solid !== lastSolid) { lastSolid = solid; nav.classList.toggle('solid', solid); }
  }
  addEventListener('scroll', updateNav, { passive: true });
  updateNav();

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
  }

  function unpinFinalStates() {
    if (hold) { hold.style.removeProperty('--h'); hold.classList.remove('done'); }
    if (steps) steps.classList.remove('lit', 'settled');
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
