/* Medios (fotos y videos) + motion de secciones.
   Para poner una foto real: guarda el archivo con el nombre indicado en data-img / data-video
   (carpetas assets/resultados, assets/trabajo, assets/videos) y se muestra solo, sin tocar código.
   Videos de YouTube: en el elemento, cambia data-video por data-yt="ID_DEL_VIDEO". */
(() => {
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const ICON_IMG = '<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="6" y="11" width="36" height="26" rx="5"/><circle cx="24" cy="24" r="6.5"/><path d="M16 11l2.5-4h11L32 11"/></svg>';
  const ICON_PLAY = '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="19"/><path d="M20 16.5l12 7.5-12 7.5z"/></svg>';

  /* ---------- Espacios para imagen / video ---------- */
  function placeholder(el, isVideo) {
    const ph = document.createElement('div');
    ph.className = 'ph' + (isVideo ? ' ph--video' : '');
    ph.innerHTML = `${isVideo ? ICON_PLAY : ICON_IMG}<b></b><small></small>`;
    ph.querySelector('b').textContent = el.dataset.label || (isVideo ? 'Video' : 'Foto');
    ph.querySelector('small').textContent = el.dataset.hint || '';
    el.querySelectorAll('.ph').forEach(n => n.remove());
    el.prepend(ph);
  }

  function mountImage(el, src) {
    const im = new Image();
    im.alt = (el.dataset.label || '').replace(/^(Foto|Video):\s*/i, '');
    im.decoding = 'async'; im.loading = 'lazy';
    im.onload = () => { el.querySelectorAll('.ph').forEach(n => n.remove()); el.prepend(im); el.classList.add('has-media'); };
    im.src = src;
  }

  function mountVideo(el) {
    const yt = el.dataset.yt, file = el.dataset.video;
    const play = (node) => { el.replaceChildren(node); el.classList.add('has-media', 'is-playing'); };
    const btn = (poster) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'vplay'; b.setAttribute('aria-label', 'Reproducir ' + (el.dataset.label || 'video'));
      b.innerHTML = ICON_PLAY;
      if (poster) b.style.backgroundImage = `url(${poster})`;
      return b;
    };
    if (yt) {
      const b = btn(`https://i.ytimg.com/vi/${yt}/hqdefault.jpg`);
      b.addEventListener('click', () => {
        const f = document.createElement('iframe');
        f.src = `https://www.youtube-nocookie.com/embed/${yt}?autoplay=1&rel=0`;
        f.allow = 'autoplay; encrypted-media; picture-in-picture'; f.allowFullscreen = true; f.title = el.dataset.label || 'Video';
        play(f);
      });
      el.replaceChildren(b); el.classList.add('has-media');
      return;
    }
    if (!file) return;
    fetch(file, { method: 'HEAD' }).then(r => {
      if (!r.ok) return;
      const b = btn();
      b.classList.add('vplay--file');
      b.addEventListener('click', () => {
        const v = document.createElement('video');
        v.src = file; v.controls = true; v.playsInline = true; v.autoplay = true; v.preload = 'metadata';
        play(v);
      });
      el.replaceChildren(b); el.classList.add('has-media');
    }).catch(() => {});
  }

  $$('.media').forEach(el => {
    const isVideo = !!(el.dataset.video || el.dataset.yt);
    placeholder(el, isVideo);
    if (isVideo) mountVideo(el);
    else if (el.dataset.img) mountImage(el, el.dataset.img);
  });

  /* ---------- Comparador antes / después ---------- */
  $$('.ba').forEach(ba => {
    const range = ba.querySelector('.ba__range');
    const set = v => ba.style.setProperty('--pos', v + '%');
    range.addEventListener('input', () => { ba.classList.add('touched'); set(range.value); });
    // Pista inicial: una pasada suave la primera vez que entra a pantalla
    if (!reduce && 'IntersectionObserver' in window) {
      const io = new IntersectionObserver(([e]) => {
        if (!e.isIntersecting) return;
        io.disconnect();
        const t0 = performance.now();
        const step = now => {
          if (ba.classList.contains('touched')) return;
          const p = Math.min((now - t0) / 1600, 1);
          const v = 50 + Math.sin(p * Math.PI * 2) * 22 * (1 - p * 0.35);
          range.value = v; set(v);
          if (p < 1) requestAnimationFrame(step); else { range.value = 50; set(50); }
        };
        setTimeout(() => requestAnimationFrame(step), 500);
      }, { threshold: .6 });
      io.observe(ba);
    }
  });

  /* ---------- Títulos: entran palabra por palabra ---------- */
  function splitWords(h) {
    if (h.dataset.split) return;
    h.dataset.split = '1';
    h.setAttribute('aria-label', h.textContent.replace(/\s+/g, ' ').trim());
    let i = 0;
    const walk = node => {
      [...node.childNodes].forEach(n => {
        if (n.nodeType === 3) {
          const frag = document.createDocumentFragment();
          n.textContent.split(/(\s+)/).forEach(part => {
            if (!part) return;
            if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(' ')); return; }
            const w = document.createElement('span'); w.className = 'w'; w.setAttribute('aria-hidden', 'true');
            const inner = document.createElement('span'); inner.textContent = part; inner.style.setProperty('--i', i++);
            w.appendChild(inner); frag.appendChild(w);
          });
          n.replaceWith(frag);
        } else if (n.nodeType === 1) walk(n);
      });
    };
    walk(h);
    h.classList.add('wsplit');
  }
  $$('.sec__head h2').forEach(splitWords);
})();
