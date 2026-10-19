(() => {
  const R = window.RIVAS;
  if (!R) return;
  const $ = s => document.querySelector(s);

  /* ===== Configuración editable =====
     Horarios por día de la semana (0 = domingo). Horas de INICIO de cada cita (cada 1 h).
     Pendiente confirmar los horarios reales de cada sede con el cliente. */
  const HORARIOS = {
    1: ['08:00', '09:00', '10:00', '11:00', '14:00', '15:00', '16:00', '17:00'],
    2: ['08:00', '09:00', '10:00', '11:00', '14:00', '15:00', '16:00', '17:00'],
    3: ['08:00', '09:00', '10:00', '11:00', '14:00', '15:00', '16:00', '17:00'],
    4: ['08:00', '09:00', '10:00', '11:00', '14:00', '15:00', '16:00', '17:00'],
    5: ['08:00', '09:00', '10:00', '11:00', '14:00', '15:00', '16:00', '17:00'],
    6: ['08:00', '09:00', '10:00', '11:00'],
    0: []
  };
  const DIAS_ADELANTE = 90;     // hasta cuántos días en el futuro se puede agendar
  const HORAS_ANTICIPACION = 2; // mínimo de horas antes de la cita

  /* Aquí se conectará el correo / backend más adelante. Debe devolver una promesa. */
  async function enviarReserva(reserva) {
    // TODO: fetch('/api/citas', { method: 'POST', body: JSON.stringify(reserva) })
    console.info('[agenda] reserva', reserva);
  }

  const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const sameDay = (a, b) => a && b && ymd(a) === ymd(b);
  const hhmm12 = t => { const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${pad(m)} ${h < 12 ? 'a. m.' : 'p. m.'}`; };

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const last = new Date(today); last.setDate(last.getDate() + DIAS_ADELANTE);
  const st = { tipo: 'Valoración inicial', sede: R.current(), date: null, time: null, month: new Date(today.getFullYear(), today.getMonth(), 1) };

  const slotsFor = d => {
    const base = HORARIOS[d.getDay()] || [];
    if (!sameDay(d, new Date())) return base;
    const limit = new Date(Date.now() + HORAS_ANTICIPACION * 36e5);
    return base.filter(t => { const [h, m] = t.split(':').map(Number); const x = new Date(d); x.setHours(h, m, 0, 0); return x > limit; });
  };
  const dayOk = d => d >= today && d <= last && slotsFor(d).length > 0;

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
  bindChips('#bSede', 'sede', () => { R.setSede && R.setSede(st.sede); ticket(); });
  document.addEventListener('sedechange', e => { st.sede = e.detail; paintChips(); ticket(); });

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
      if (sameDay(d, today)) b.classList.add('today');
      if (sameDay(d, st.date)) { b.classList.add('on'); b.setAttribute('aria-pressed', 'true'); }
      b.setAttribute('aria-label', `${DIAS[d.getDay()]} ${n} de ${MESES[m]}${ok ? '' : ', no disponible'}`);
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
    const list = slotsFor(d);
    const groups = [['Mañana', list.filter(t => +t.slice(0, 2) < 12)], ['Tarde', list.filter(t => +t.slice(0, 2) >= 12)]];
    groups.forEach(([name, items]) => {
      if (!items.length) return;
      const h = document.createElement('p'); h.className = 'slots__g'; h.textContent = name; box.appendChild(h);
      const row = document.createElement('div'); row.className = 'slots__row';
      items.forEach(t => {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'slot' + (st.time === t ? ' on' : ''); b.textContent = hhmm12(t);
        b.addEventListener('click', () => { st.time = t; renderSlots(); ticket(); });
        row.appendChild(b);
      });
      box.appendChild(row);
    });
  }

  /* ---- Ticket en vivo ---- */
  function ticket() {
    const s = R.SEDES[st.sede];
    $('#tkKind').textContent = st.tipo;
    $('#tkSede').textContent = s.name;
    $('#tkAddr').textContent = s.addr;
    const d = st.date;
    $('#tkDay').textContent = d ? pad(d.getDate()) : '--';
    $('#tkMonth').textContent = d ? `${MESES[d.getMonth()]} ${d.getFullYear()}` : 'Elige un día';
    $('#tkWeek').innerHTML = d ? DIAS[d.getDay()][0].toUpperCase() + DIAS[d.getDay()].slice(1) : '&nbsp;';
    $('#tkTime').textContent = st.time ? hhmm12(st.time) : '— : —';
    document.querySelector('.ticket').classList.toggle('full', !!(d && st.time));
    alignCut();
  }
  function alignCut() {
    const t = document.querySelector('.ticket'), c = t.querySelector('.ticket__cut');
    t.style.setProperty('--cut', (c.offsetTop + 1) + 'px');
  }
  addEventListener('resize', alignCut);

  /* ---- Confirmar ---- */
  const err = msg => { const e = $('#bErr'); e.textContent = msg || ''; e.hidden = !msg; };
  $('#bookForm').addEventListener('submit', async e => {
    e.preventDefault();
    if ($('#bHp').value) return; // anti-spam
    const nombre = $('#bNombre').value.trim(), tel = $('#bTel').value.replace(/\D/g, ''), mail = $('#bMail').value.trim();
    if (!st.date || !st.time) return err('Elige el día y la hora de tu cita.');
    if (nombre.length < 3) { $('#bNombre').focus(); return err('Escribe tu nombre completo.'); }
    if (tel.length < 7) { $('#bTel').focus(); return err('Escribe un teléfono o WhatsApp válido.'); }
    if (mail && !/^\S+@\S+\.\S+$/.test(mail)) { $('#bMail').focus(); return err('Revisa tu correo electrónico.'); }
    if (!$('#bOk').checked) return err('Debes aceptar el uso de tus datos para continuar.');
    err('');
    const s = R.SEDES[st.sede];
    const fecha = `${DIAS[st.date.getDay()]} ${st.date.getDate()} de ${MESES[st.date.getMonth()].toLowerCase()} de ${st.date.getFullYear()}`;
    const reserva = { nombre, telefono: tel, correo: mail, tipo: st.tipo, sede: s.name, fecha: ymd(st.date), hora: st.time };
    const btn = $('#bGo'); btn.disabled = true; btn.textContent = 'Confirmando…';
    try { await enviarReserva(reserva); } catch { btn.disabled = false; btn.textContent = 'Confirmar cita'; return err('No pudimos registrar tu cita. Inténtalo de nuevo o escríbenos por WhatsApp.'); }
    btn.disabled = false; btn.textContent = 'Confirmar cita';

    $('#doneTxt').textContent = `${nombre}, te esperamos el ${fecha} a las ${hhmm12(st.time)} en la sede ${s.name} (${s.addr}). Tipo de cita: ${st.tipo}.`;
    const msg = `Hola, quiero confirmar mi cita.\nNombre: ${nombre}\nTipo: ${st.tipo}\nSede: ${s.name}\nFecha: ${fecha}\nHora: ${hhmm12(st.time)}`;
    $('#doneWa').href = R.waUrl(st.sede, msg);
    $('#bookForm').hidden = true; $('#bDone').hidden = false;
    document.querySelector('.ticket').classList.add('full', 'booked');
    $('#book').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('#doneIcs').onclick = () => ics(reserva, s);
  });

  function ics(r, s) {
    const [h, m] = r.hora.split(':').map(Number);
    const end = `${pad(h + 1)}${pad(m)}00`;
    const body = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Dr. Rivas//Citas//ES', 'BEGIN:VEVENT',
      `UID:${r.fecha}${r.hora.replace(':', '')}@drrivas`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
      `DTSTART;TZID=America/Bogota:${r.fecha}T${pad(h)}${pad(m)}00`, `DTEND;TZID=America/Bogota:${r.fecha}T${end}`,
      `SUMMARY:Cita Dr. Rivas · ${r.tipo}`, `LOCATION:${s.addr}, ${s.name}`, `DESCRIPTION:Teléfono sede: ${s.phone}`,
      'BEGIN:VALARM', 'TRIGGER:-PT2H', 'ACTION:DISPLAY', 'DESCRIPTION:Tu cita en Dr. Rivas', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([body], { type: 'text/calendar;charset=utf-8' }));
    a.download = 'cita-dr-rivas.ics'; document.body.appendChild(a); a.click(); a.remove();
  }

  $('#doneAgain').addEventListener('click', () => {
    st.date = null; st.time = null; st.tipo = 'Valoración inicial';
    $('#bookForm').reset(); $('#bookForm').hidden = false; $('#bDone').hidden = true;
    document.querySelector('.ticket').classList.remove('full', 'booked');
    paintChips(); renderCal(); renderSlots(); ticket();
  });

  paintChips(); renderCal(); renderSlots(); ticket();
})();
