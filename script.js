(() => {
  const SEDES = {
    yopal: {
      name: 'Yopal',
      addr: 'Carrera 24 con Calle 12, esquina diagonal al Edificio Luma',
      q: '5.3474497,-72.3952236',
      phone: '+57 313 469 3232', tel: '+573134693232', wa: '573134693232',
      // Ficha real de la clínica en Google Maps (el enlace corto del sitio anterior apuntaba al Edificio Luma)
      maps: 'https://www.google.com/maps/search/?api=1&query=Dr.+Rivas+Yopal&query_place_id=ChIJ7V3T5KkNa44Rzv3TT0uSfzk'
    },
    aguazul: {
      name: 'Aguazul',
      addr: 'Carrera 18A #10-24',
      q: 'Carrera 18A #10-24, Aguazul, Casanare, Colombia',
      phone: '+57 320 745 1448', tel: '+573207451448', wa: '573207451448',
      maps: 'https://maps.app.goo.gl/cgvktmZMxvS944AD7'
    },
    bogota: {
      name: 'Bogotá',
      addr: 'Autopista Norte con Calle 106',
      q: 'Autopista Norte con Calle 106, Bogotá, Colombia',
      phone: '+57 320 767 1072', tel: '+573207671072', wa: '573207671072',
      maps: 'https://maps.app.goo.gl/JvP7ubNrzSDsHJns9'
    }
  };
  window.RIVAS = { SEDES, setSede: id => { chosen = true; setSede(id); }, waUrl: (id, msg) => `https://wa.me/${SEDES[id].wa}?text=${encodeURIComponent(msg)}`, current: () => current };
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  let current = 'yopal';
  const waUrl = (id, msg) => `https://wa.me/${SEDES[id].wa}?text=${encodeURIComponent(msg || 'Hola, quiero más información')}`;

  function setSede(id) {
    if (!SEDES[id]) return;
    current = id;
    const s = SEDES[id];
    $('#sedeChipName').textContent = s.name;
    $$('[data-wa]').forEach(a => { a.href = waUrl(id, a.dataset.msg); });
    $$('.tabs button').forEach(b => {
      const on = b.dataset.sede === id;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', on);
    });
    $('#sName').textContent = s.name;
    $('#sAddr').textContent = s.addr;
    $('#sPhone').href = 'tel:' + s.tel;
    $('#sPhoneTxt').textContent = s.phone;
    $('#sWa').href = waUrl(id);
    $('#sWaTxt').textContent = s.phone;
    $('#sMap').href = s.maps;
    $('#moreReviews').href = s.maps;
    $$('[data-reviews]').forEach(a => { a.href = s.maps; });
    $('#mapFrame').src = `https://www.google.com/maps?q=${encodeURIComponent(s.q)}&z=16&hl=es&output=embed`;
    $('#formSede').value = id;
    document.dispatchEvent(new CustomEvent('sedechange', { detail: id }));
  }

  // Gate
  const gate = $('#gate');
  const background = [...document.body.children].filter(el => el !== gate && !['SCRIPT', 'STYLE'].includes(el.tagName));
  const previousAria = new Map(background.map(el => [el, el.getAttribute('aria-hidden')]));
  let gateReturn = null;
  const openGate = () => {
    gateReturn = document.activeElement;
    gate.inert = false; gate.removeAttribute('aria-hidden'); gate.classList.remove('off'); document.body.classList.add('lock');
    background.forEach(el => { el.inert = true; el.setAttribute('aria-hidden', 'true'); });
    $('.city', gate).focus({ preventScroll: true });
  };
  const closeGate = () => {
    background.forEach(el => { el.inert = false; const value = previousAria.get(el); if (value === null) el.removeAttribute('aria-hidden'); else el.setAttribute('aria-hidden', value); });
    (gateReturn && gateReturn !== document.body && !gate.contains(gateReturn) ? gateReturn : $('#sedeChip')).focus({ preventScroll: true });
    gate.inert = true; gate.setAttribute('aria-hidden', 'true'); gate.classList.add('off'); document.body.classList.remove('lock');
  };
  gate.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    const buttons = $$('.city', gate), first = buttons[0], last = buttons[buttons.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  // La transición nace en el botón que se pulsó (efecto "iris")
  const origin = el => {
    const r = el.getBoundingClientRect();
    gate.style.setProperty('--cx', Math.round(r.left + r.width / 2) + 'px');
    gate.style.setProperty('--cy', Math.round(r.top + r.height / 2) + 'px');
  };
  $$('.city').forEach(b => b.addEventListener('click', () => {
    origin(b); chosen = true; setSede(b.dataset.sede); closeGate();
  }));
  $('#sedeChip').addEventListener('click', e => { origin(e.currentTarget); openGate(); });
  $$('.tabs button').forEach(b => b.addEventListener('click', () => { chosen = true; setSede(b.dataset.sede); }));

  // Cada vez que entra, el visitante debe elegir su sede (no se recuerda la anterior).
  let chosen = false;
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && chosen) closeGate(); });
  setSede('yopal');
  openGate();
  // Al volver con el botón "atrás" (caché del navegador) también se vuelve a pedir la sede.
  addEventListener('pageshow', e => { if (e.persisted) { chosen = false; openGate(); } });

  // Tema claro / oscuro (se recuerda en este dispositivo)
  const themeBtn = $('#themeBtn');
  const applyTheme = dark => {
    document.documentElement.toggleAttribute('data-theme', dark);
    if (dark) document.documentElement.setAttribute('data-theme', 'dark');
    themeBtn.setAttribute('aria-pressed', dark);
    themeBtn.setAttribute('aria-label', dark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro');
    try { localStorage.setItem('rivas.theme', dark ? 'dark' : 'light'); } catch {}
  };
  applyTheme(document.documentElement.getAttribute('data-theme') === 'dark');
  themeBtn.addEventListener('click', () => {
    const dark = document.documentElement.getAttribute('data-theme') !== 'dark';
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!document.startViewTransition || reduce) { applyTheme(dark); return; }
    // La nueva paleta se expande en círculo desde el botón
    const r = themeBtn.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const end = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    document.startViewTransition(() => applyTheme(dark)).ready.then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${end}px at ${x}px ${y}px)`] },
        { duration: 650, easing: 'cubic-bezier(0.23, 1, 0.32, 1)', pseudoElement: '::view-transition-new(root)' }
      );
    }).catch(() => {});
  });

  // Menú móvil
  const burger = $('#burger'), menu = $('#menu');
  burger.addEventListener('click', () => {
    const o = menu.classList.toggle('open');
    burger.setAttribute('aria-expanded', o);
  });
  $$('#menu a').forEach(a => a.addEventListener('click', () => { menu.classList.remove('open'); burger.setAttribute('aria-expanded', false); }));

  // Nav al hacer scroll
  const nav = $('#nav');
  const onScroll = () => nav.classList.toggle('scrolled', scrollY > 10);
  addEventListener('scroll', onScroll, { passive: true }); onScroll();

  // Reveal + contadores
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const count = el => {
    const fmt = n => n.toLocaleString('es-CO');
    const t = +el.dataset.count; if (reduce) { el.textContent = fmt(t); return; }
    const t0 = performance.now();
    const f = now => { const p = Math.min((now - t0) / 1200, 1); el.textContent = fmt(Math.round(t * (1 - Math.pow(1 - p, 3)))); if (p < 1) requestAnimationFrame(f); };
    requestAnimationFrame(f);
  };
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(es => es.forEach(e => {
      if (!e.isIntersecting) return;
      e.target.classList.add('in');
      $$('[data-count]', e.target).forEach(count);
      io.unobserve(e.target);
    }), { threshold: .12 });
    $$('.reveal').forEach(el => io.observe(el));
  } else {
    $$('.reveal').forEach(el => el.classList.add('in'));
    $$('[data-count]').forEach(count);
  }

  // Formulario -> WhatsApp
  $('#form').addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target, nombre = f.nombre.value.trim();
    $('#formErr').hidden = !!nombre;
    if (!nombre) { f.nombre.focus(); return; }
    const msg = `Hola, soy ${nombre}. Quiero información sobre: ${f.trat.value}.` + (f.msg.value.trim() ? ` ${f.msg.value.trim()}` : '');
    window.open(waUrl(f.sede.value, msg), '_blank', 'noopener');
    const sede = f.sede.value; f.reset(); f.sede.value = sede; $('#formErr').hidden = true; // formulario limpio tras enviar
  });
})();
