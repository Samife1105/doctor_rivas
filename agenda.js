(() => {
  const R = window.RIVAS;
  if (!R) return;
  const $ = s => document.querySelector(s);

  /* ===== Configuración editable =====
     Lunes a viernes 8:00-18:00 y sábados 8:00-12:00, citas cada 30 min:
     20 citas por día entre semana (8 los sábados). Pendiente confirmar horarios reales por sede. */
  const gen = (from, to, step = 30) => {
    const out = [];
    for (let m = from * 60; m < to * 60; m += step) out.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
    return out;
  };
  const HORARIOS = { 0: [], 1: gen(8, 18), 2: gen(8, 18), 3: gen(8, 18), 4: gen(8, 18), 5: gen(8, 18), 6: gen(8, 12) };
  let DIAS_ADELANTE = 30;     // máximo un mes de anticipación (el servidor puede cambiarlo)
  let HORAS_ANTICIPACION = 2; // mínimo de horas antes de la cita
  const CITAS_KEY = 'rivas.citas'; // citas ya tomadas (local, hasta conectar el backend)
  const tomadas = () => { try { return JSON.parse(localStorage.getItem(CITAS_KEY)) || []; } catch { return []; } };
  const guardarCita = k => { try { localStorage.setItem(CITAS_KEY, JSON.stringify([...tomadas(), k])); } catch {} };

  /* ===== Conexión con el servidor de citas (Google Sheets + Calendar) =====
     La dirección se pone en config.js. Si está vacía, el agendador funciona solo en este
     dispositivo (modo demostración) y la cita se confirma únicamente por WhatsApp. */
  const BACKEND = ((window.RIVAS_CONFIG || {}).backendUrl || '').trim();
  const remote = { cfg: null, taken: {}, full: {}, ok: false };

  async function pedir(url, opts) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 9000);
    try { const r = await fetch(url, { ...opts, signal: ctl.signal }); return await r.json(); }
    finally { clearTimeout(t); }
  }

  /* Trae horarios por sede y horas ocupadas, y vuelve a dibujar el calendario */
  let cargando = null;
  async function refrescarRemoto() {
    if (!BACKEND) return;
    const sede = st.sede;
    const box = $('#slotsBox'); if (box) box.setAttribute('aria-busy', 'true');
    try {
      if (!remote.cfg) {
        const c = await pedir(`${BACKEND}?accion=config`);
        if (c && c.ok) {
          remote.cfg = c;
          if (c.dias) DIAS_ADELANTE = c.dias;
          if (c.horasMin !== undefined) HORAS_ANTICIPACION = c.horasMin;
          refreshWindow();
        }
      }
      const h = await pedir(`${BACKEND}?accion=horas&sede=${encodeURIComponent(sede)}`);
      if (h && h.ok) {
        remote.taken[sede] = new Set(h.ocupadas || []);
        remote.full[sede] = new Set(h.llenos || []);
        remote.ok = true;
      }
    } catch { /* sin conexión: se usan los horarios por defecto */ }
    if (box) box.removeAttribute('aria-busy');
    if (st.time && st.date && estaOcupada(st.date, st.time)) { st.time = null; ticket(); }
    renderCal(); renderSlots();
  }

  async function enviarReserva(p) {
    if (!BACKEND) { guardarCita(`${p.sede}|${p.fecha}|${p.hora}`); return { ok: true, local: true }; }
    return pedir(BACKEND, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(p) });
  }
  const MENSAJES = {
    hora_ocupada: 'Esa hora acaba de ser tomada por otra persona. Elige otra, por favor.',
    dia_lleno: 'Ese día ya no tiene horas disponibles. Elige otro día.',
    demasiadas_citas: 'Ya tienes varias citas pendientes con este celular. Escríbenos por WhatsApp para ayudarte.',
    fuera_de_rango: 'Esa hora ya no está disponible. Elige otra.',
    horario: 'Esa hora no está dentro del horario de la sede. Elige otra.'
  };

  const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const sameDay = (a, b) => a && b && ymd(a) === ymd(b);
  const hhmm12 = t => { const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${pad(m)} ${h < 12 ? 'a. m.' : 'p. m.'}`; };

  let today, last;
  const refreshWindow = () => {
    today = new Date(); today.setHours(0, 0, 0, 0);
    last = new Date(today); last.setDate(last.getDate() + DIAS_ADELANTE);
  };
  refreshWindow();
  const st = { tipo: 'Valoración inicial', sede: R.current(), date: null, time: null, month: new Date(today.getFullYear(), today.getMonth(), 1) };

  const horariosDe = sede => {
    const h = remote.cfg && remote.cfg.sedes && remote.cfg.sedes[sede] && remote.cfg.sedes[sede].horarios;
    return h || HORARIOS;
  };
  const estaOcupada = (d, t) => {
    if (BACKEND) { const s = remote.taken[st.sede]; return !!(s && s.has(`${ymd(d)}|${t}`)); }
    return tomadas().includes(`${st.sede}|${ymd(d)}|${t}`);
  };
  /* Todas las franjas del día (las de hoy que ya pasaron no se muestran) */
  const slotsAll = d => {
    const base = horariosDe(st.sede)[d.getDay()] || [];
    if (!sameDay(d, new Date())) return base;
    const limit = new Date(Date.now() + HORAS_ANTICIPACION * 36e5);
    return base.filter(t => { const [h, m] = t.split(':').map(Number); const x = new Date(d); x.setHours(h, m, 0, 0); return x > limit; });
  };
  const slotsFor = d => slotsAll(d).filter(t => !estaOcupada(d, t));
  const diaLleno = d => { const f = remote.full[st.sede]; return !!(BACKEND && f && f.has(ymd(d))) || (slotsAll(d).length > 0 && slotsFor(d).length === 0); };
  const dayOk = d => d >= today && d <= last && slotsFor(d).length > 0 && !diaLleno(d);

  /* ---- Tipo y sede ---- */
  function bindChips(id, key, after) {
    const box = $(id);
    box.addEventListener('click', e => {
      const b = e.target.closest('.chip'); if (!b) return;
      st[key] = b.dataset.v; paintChips(); after && after();
    });
  }
  function paintChips() {
    document.querySelectorAll('#bTipo .chip').forEach(b => { const on = b.dataset.v === st.tipo; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
    document.querySelectorAll('#bSede .chip').forEach(b => { const on = b.dataset.v === st.sede; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
  }
  bindChips('#bTipo', 'tipo', ticket);
  bindChips('#bSede', 'sede', () => { R.setSede && R.setSede(st.sede); st.time = null; ticket(); renderCal(); renderSlots(); refrescarRemoto(); });
  document.addEventListener('sedechange', e => { if (e.detail === st.sede) return; st.sede = e.detail; st.time = null; paintChips(); ticket(); renderCal(); renderSlots(); refrescarRemoto(); });

  /* ---- Calendario ---- */
  function renderCal() {
    const y = st.month.getFullYear(), m = st.month.getMonth();
    $('#calTitle').textContent = `${MESES[m]} ${y}`;
    const first = new Date(y, m, 1);
    const lead = (first.getDay() + 6) % 7; // semana inicia el lunes
    const days = new Date(y, m + 1, 0).getDate();
    const grid = $('#calGrid'); grid.textContent = '';
    for (let i = 0; i < lead; i++) grid.appendChild(document.createElement('span'));
    for (let n = 1; n <= days; n++) {
      const d = new Date(y, m, n);
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'day'; b.textContent = n;
      const ok = dayOk(d);
      b.disabled = !ok;
      const lleno = d >= today && d <= last && diaLleno(d);
      if (lleno) b.classList.add('lleno');
      if (sameDay(d, today)) b.classList.add('today');
      if (sameDay(d, st.date)) { b.classList.add('on'); b.setAttribute('aria-pressed', 'true'); }
      b.setAttribute('aria-label', `${DIAS[d.getDay()]} ${n} de ${MESES[m]}${ok ? '' : lleno ? ', sin horas disponibles' : ', no disponible'}`);
      b.addEventListener('click', () => { st.date = d; st.time = null; renderCal(); renderSlots(); ticket(); });
      grid.appendChild(b);
    }
    const prevEnd = new Date(y, m, 0);
    $('#calPrev').disabled = prevEnd < today;
    $('#calNext').disabled = new Date(y, m + 1, 1) > last;
  }
  $('#calPrev').addEventListener('click', () => { st.month = new Date(st.month.getFullYear(), st.month.getMonth() - 1, 1); renderCal(); });
  $('#calNext').addEventListener('click', () => { st.month = new Date(st.month.getFullYear(), st.month.getMonth() + 1, 1); renderCal(); });

  /* ---- Horarios ---- */
  function renderSlots() {
    const box = $('#slotsBox'); box.textContent = '';
    if (!st.date) { $('#slotsTitle').textContent = 'Elige un día para ver los horarios'; return; }
    const d = st.date;
    $('#slotsTitle').textContent = `${DIAS[d.getDay()][0].toUpperCase() + DIAS[d.getDay()].slice(1)} ${d.getDate()} de ${MESES[d.getMonth()].toLowerCase()}`;
    const list = slotsAll(d);
    const groups = [['Mañana', list.filter(t => +t.slice(0, 2) < 12)], ['Tarde', list.filter(t => +t.slice(0, 2) >= 12)]];
    let hayOcupadas = false;
    groups.forEach(([name, items]) => {
      if (!items.length) return;
      const h = document.createElement('p'); h.className = 'slots__g'; h.textContent = name; box.appendChild(h);
      const row = document.createElement('div'); row.className = 'slots__row';
      items.forEach(t => {
        const b = document.createElement('button'); b.type = 'button';
        const ocupada = estaOcupada(d, t);
        b.className = 'slot' + (st.time === t ? ' on' : '') + (ocupada ? ' taken' : '');
        b.textContent = hhmm12(t);
        if (ocupada) {
          hayOcupadas = true;
          b.disabled = true;
          b.title = 'Hora ocupada';
          b.setAttribute('aria-label', `${hhmm12(t)}, hora ocupada`);
          b.insertAdjacentHTML('beforeend', '<svg class="lock" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>');
        } else {
          b.addEventListener('click', () => { st.time = t; renderSlots(); ticket(); });
        }
        row.appendChild(b);
      });
      box.appendChild(row);
    });
    if (hayOcupadas) {
      const lg = document.createElement('p'); lg.className = 'slots__legend';
      lg.innerHTML = '<svg class="lock" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg> Hora ocupada';
      box.appendChild(lg);
    }
  }

  /* ---- Ticket en vivo ---- */
  function ticket() {
    const s = R.SEDES[st.sede];
    $('#tkKind').textContent = st.tipo;
    $('#tkSede').textContent = s.name;
    $('#tkAddr').textContent = s.addr;
    const d = st.date;
    $('#tkDay').textContent = d ? pad(d.getDate()) : '--';
    $('#tkMonth').textContent = d ? MESES[d.getMonth()] : 'Elige un día';
    $('#tkWeek').innerHTML = d ? DIAS[d.getDay()][0].toUpperCase() + DIAS[d.getDay()].slice(1) : '&nbsp;';
    $('#tkTime').textContent = st.time ? hhmm12(st.time) : '— : —';
    document.querySelector('.ticket').classList.toggle('full', !!(d && st.time));
  }

  /* Inclinación 3D del diente con el puntero */
  const tk = document.querySelector('.ticket');
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    tk.addEventListener('pointermove', e => {
      const r = tk.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      tk.style.setProperty('--ry', (x * 22).toFixed(1) + 'deg');
      tk.style.setProperty('--rx', (-y * 18).toFixed(1) + 'deg');
    });
    tk.addEventListener('pointerleave', () => { tk.style.setProperty('--ry', '0deg'); tk.style.setProperty('--rx', '0deg'); });
  }

  /* ---- Campo de celular: solo números ---- */
  const telEl = $('#bTel');
  telEl.addEventListener('beforeinput', e => { if (e.data && /\D/.test(e.data)) e.preventDefault(); });
  telEl.addEventListener('input', () => { telEl.value = telEl.value.replace(/\D/g, '').slice(0, 10); });
  telEl.addEventListener('paste', e => {
    e.preventDefault();
    const t = (e.clipboardData.getData('text') || '').replace(/\D/g, '').replace(/^57(?=3\d{9}$)/, '');
    telEl.value = t.slice(0, 10);
  });

  /* ---- Correo: formato + dominio real (consulta DNS) ---- */
  const TYPOS = { 'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gamil.com': 'gmail.com', 'gmail.co': 'gmail.com', 'gmail.con': 'gmail.com', 'hotmial.com': 'hotmail.com', 'hotmail.con': 'hotmail.com', 'outlok.com': 'outlook.com', 'yahoo.con': 'yahoo.com', 'yaho.com': 'yahoo.com' };
  const dns = async (name, type) => {
    const r = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`, { headers: { accept: 'application/dns-json' } });
    return r.json();
  };
  const cache = {};
  async function mailCheck(mail) {
    if (!/^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(mail) || /\.\./.test(mail)) return { ok: false, msg: 'Escribe un correo válido, por ejemplo nombre@gmail.com.' };
    const dom = mail.split('@')[1];
    if (TYPOS[dom]) return { ok: false, msg: `¿Quisiste escribir ${mail.split('@')[0]}@${TYPOS[dom]}?` };
    if (cache[dom] !== undefined) return cache[dom];
    try {
      let j = await dns(dom, 'MX');
      let ok = j.Status === 0 && Array.isArray(j.Answer) && j.Answer.some(a => a.type === 15);
      if (!ok && j.Status === 0) { j = await dns(dom, 'A'); ok = j.Status === 0 && Array.isArray(j.Answer) && j.Answer.length > 0; }
      return (cache[dom] = ok ? { ok: true } : { ok: false, msg: `El dominio "${dom}" no existe o no recibe correos. Revisa tu correo.` });
    } catch { return { ok: true }; } // sin conexión al verificador: no bloquear
  }
  const mailEl = $('#bMail'), mailHint = $('#bMailHint');
  mailEl.addEventListener('blur', async () => {
    const v = mailEl.value.trim().toLowerCase();
    mailEl.removeAttribute('aria-invalid'); mailHint.textContent = ''; mailHint.className = 'fhint full';
    if (!v) return;
    const r = await mailCheck(v);
    if (r.ok) { mailHint.textContent = 'Correo verificado ✓'; mailHint.classList.add('ok'); }
    else { mailEl.setAttribute('aria-invalid', 'true'); mailHint.textContent = r.msg; mailHint.classList.add('bad'); }
  });
  mailEl.addEventListener('input', () => { mailEl.removeAttribute('aria-invalid'); mailHint.textContent = ''; });

  /* ---- Confirmar ---- */
  const err = msg => { const e = $('#bErr'); e.textContent = msg || ''; e.hidden = !msg; };
  $('#bookForm').addEventListener('submit', async e => {
    e.preventDefault();
    if ($('#bHp').value) return; // anti-spam
    const nombre = $('#bNombre').value.trim(), tel = $('#bTel').value, mail = $('#bMail').value.trim().toLowerCase();
    if (!st.date || !st.time) return err('Elige el día y la hora de tu cita.');
    if (nombre.length < 3) { $('#bNombre').focus(); return err('Escribe tu nombre completo.'); }
    if (!/^3\d{9}$/.test(tel)) { $('#bTel').focus(); return err('Escribe tu celular con 10 números, empezando por 3 (ej. 3001234567).'); }
    if (mail) { const r = await mailCheck(mail); if (!r.ok) { $('#bMail').focus(); return err(r.msg); } }
    if (!$('#bOk').checked) return err('Debes aceptar el uso de tus datos para continuar.');
    err('');
    const s = R.SEDES[st.sede];
    const fecha = `${DIAS[st.date.getDay()]} ${st.date.getDate()} de ${MESES[st.date.getMonth()].toLowerCase()} de ${st.date.getFullYear()}`;
    const reserva = { nombre, telefono: tel, correo: mail, tipo: st.tipo, sede: s.name, fecha: ymd(st.date), hora: st.time };
    const payload = { sede: st.sede, nombre, celular: tel, correo: mail, tipo: st.tipo, fecha: ymd(st.date), hora: st.time, hp: '' };
    const btn = $('#bGo'); btn.disabled = true; btn.textContent = 'Confirmando…';
    let res;
    try { res = await enviarReserva(payload); } catch { res = { ok: false, error: 'red' }; }
    btn.disabled = false; btn.textContent = 'Confirmar cita';
    if (!res || !res.ok) {
      const code = res && res.error;
      if (code === 'hora_ocupada' || code === 'dia_lleno' || code === 'fuera_de_rango' || code === 'horario') { st.time = null; ticket(); refrescarRemoto(); }
      return err(MENSAJES[code] || 'No pudimos registrar tu cita. Inténtalo de nuevo o escríbenos por WhatsApp.');
    }
    if (BACKEND) { (remote.taken[st.sede] = remote.taken[st.sede] || new Set()).add(`${ymd(st.date)}|${st.time}`); }

    $('#doneTxt').textContent = `${nombre}, te esperamos el ${fecha} a las ${hhmm12(st.time)} en la sede ${s.name} (${s.addr}). Tipo de cita: ${st.tipo}.`;
    const msg = `Hola, quiero confirmar mi cita.\nNombre: ${nombre}\nTipo: ${st.tipo}\nSede: ${s.name}\nFecha: ${fecha}\nHora: ${hhmm12(st.time)}`;
    $('#doneWa').href = R.waUrl(st.sede, msg);
    clearForm(); // formulario limpio apenas se confirma
    $('#bookForm').hidden = true; $('#bDone').hidden = false;
    document.querySelector('.ticket').classList.add('full', 'booked');
    $('#book').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('#doneIcs').onclick = () => ics(reserva, s);
  });

  function ics(r, s) {
    const [h, m] = r.hora.split(':').map(Number);
    const em = h * 60 + m + 30;
    const end = `${pad(Math.floor(em / 60))}${pad(em % 60)}00`;
    const body = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Dr. Rivas//Citas//ES', 'BEGIN:VEVENT',
      `UID:${r.fecha}${r.hora.replace(':', '')}@drrivas`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
      `DTSTART;TZID=America/Bogota:${r.fecha}T${pad(h)}${pad(m)}00`, `DTEND;TZID=America/Bogota:${r.fecha}T${end}`,
      `SUMMARY:Cita Dr. Rivas · ${r.tipo}`, `LOCATION:${s.addr}, ${s.name}`, `DESCRIPTION:Teléfono sede: ${s.phone}`,
      'BEGIN:VALARM', 'TRIGGER:-PT2H', 'ACTION:DISPLAY', 'DESCRIPTION:Tu cita en Dr. Rivas', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([body], { type: 'text/calendar;charset=utf-8' }));
    a.download = 'cita-dr-rivas.ics'; document.body.appendChild(a); a.click(); a.remove();
  }

  function clearForm() {
    $('#bookForm').reset();
    mailEl.removeAttribute('aria-invalid'); mailHint.textContent = ''; mailHint.className = 'fhint full';
    err('');
  }
  clearForm();
  addEventListener('pageshow', e => { if (e.persisted) clearForm(); });

  /* Limpiar: deja el agendador como nuevo (tipo, día, hora y datos); la sede elegida se conserva */
  function resetBooking() {
    st.date = null; st.time = null; st.tipo = 'Valoración inicial';
    st.month = new Date(today.getFullYear(), today.getMonth(), 1);
    clearForm();
    document.querySelector('.ticket').classList.remove('full', 'booked');
    paintChips(); renderCal(); renderSlots(); ticket();
  }
  $('#bClear').addEventListener('click', resetBooking);
  $('#doneAgain').addEventListener('click', () => {
    resetBooking(); $('#bookForm').hidden = false; $('#bDone').hidden = true;
  });

  // Si la página queda abierta de un día para otro, la ventana de 30 días se actualiza sola
  const dayKey = () => ymd(new Date());
  let seen = dayKey();
  const checkDay = () => {
    if (dayKey() === seen) return;
    seen = dayKey(); refreshWindow();
    if (st.date && !dayOk(st.date)) { st.date = null; st.time = null; }
    st.month = new Date(today.getFullYear(), today.getMonth(), 1);
    renderCal(); renderSlots(); ticket();
  };
  document.addEventListener('visibilitychange', checkDay);
  addEventListener('focus', checkDay);
  setInterval(checkDay, 60000);

  document.addEventListener('visibilitychange', () => { if (!document.hidden) refrescarRemoto(); });
  setInterval(() => { if (!document.hidden) refrescarRemoto(); }, 120000);

  paintChips(); renderCal(); renderSlots(); ticket();
  refrescarRemoto();
})();
