(() => {
  const SEDES = {
    yopal: {
      name: 'Yopal',
      addr: 'Carrera 24 con Calle 12, esquina diagonal al Edificio Luma',
      q: 'Carrera 24 con Calle 12, Yopal, Casanare, Colombia',
      phone: '+57 313 469 3232', tel: '+573134693232', wa: '573134693232',
      maps: 'https://maps.app.goo.gl/unhVyQFb4ZGxKXGC7'
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
    $('#mapFrame').src = `https://www.google.com/maps?q=${encodeURIComponent(s.q)}&z=16&hl=es&output=embed`;
    $('#formSede').value = id;
    document.dispatchEvent(new CustomEvent('sedechange', { detail: id }));
  }

  // Gate
  const gate = $('#gate');
  const openGate = () => { gate.classList.remove('off'); document.body.classList.add('lock'); };
  const closeGate = () => { gate.classList.add('off'); document.body.classList.remove('lock'); };
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
    const t = +el.dataset.count; if (reduce) { el.textContent = t; return; }
    const t0 = performance.now();
    const f = now => { const p = Math.min((now - t0) / 1200, 1); el.textContent = Math.round(t * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(f); };
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
