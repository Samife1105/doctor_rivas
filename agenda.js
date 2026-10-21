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

  /* ===== Conexión con el servidor de citas (Google Sheets) =====
     La dirección se pone en config.js. Si está vacía, el agendador funciona solo en este
     dispositivo (modo demostración) y la cita se confirma únicamente por WhatsApp. */
  const BACKEND = ((window.RIVAS_CONFIG || {}).backendUrl || '').trim();
  const API = ((window.RIVAS_CONFIG || {}).apiUrl || '/api/agenda').trim();
  const remote = { cfg: null, taken: {}, full: {}, ready: {}, loading: {}, clock: null, configAt: 0 };
  let enviando = false, pendiente = null;
  const clinicNow = () => {
    const epoch = remote.clock ? remote.clock.epoch + performance.now() - remote.clock.tick : Date.now();
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(epoch));
    const get = k => Number(parts.find(p => p.type === k).value);
    return new Date(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  };
  async function pedir(url, opts = {}, ms = 12000) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
    try {
      const r = await fetch(url, { ...opts, signal: ctl.signal, cache: 'no-store' });
      const body = await r.json();
      if (!body || typeof body.ok !== 'boolean') throw new Error('respuesta');
      if (!r.ok && (r.status < 400 || r.status >= 500 || body.ok)) throw new Error('http_' + r.status);
      return body;
    } finally { clearTimeout(t); }
  }
  function availabilityStatus(message, retry = false) {
    $('#availabilityText').textContent = message;
    $('#availabilityRetry').hidden = !retry;
  }
  let configPromise = null;
  async function refrescarRemoto() {
    if (!BACKEND) { availabilityStatus('Solicitud por WhatsApp: la sede debe confirmar la disponibilidad.'); return true; }
    const sede = st.sede;
    if (remote.loading[sede]) return remote.loading[sede];
    const task = (async () => {
      availabilityStatus('Consultando horarios disponibles…');
      $('#slotsBox').setAttribute('aria-busy', 'true');
      remote.ready[sede] = false;
      try {
        if (!remote.cfg || performance.now() - remote.configAt > 300000) {
          if (!configPromise) configPromise = pedir(`${API}?accion=config`).finally(() => { configPromise = null; });
          const c = await configPromise;
          if (!c.ok || c.apiVersion !== 3 || !c.apartados || !c.sedes || !c.sedes[sede] || !Number.isInteger(c.dias) || c.dias < 1 || !Number.isFinite(c.horasMin)) throw new Error('config');
          remote.cfg = c; remote.configAt = performance.now();
          if (Number.isFinite(c.ahora)) remote.clock = { epoch: c.ahora, tick: performance.now() };
          DIAS_ADELANTE = c.dias; HORAS_ANTICIPACION = c.horasMin;
          refreshWindow();
          if (st.month < new Date(today.getFullYear(), today.getMonth(), 1) || st.month > last) st.month = new Date(today.getFullYear(), today.getMonth(), 1);
        }
        const h = await pedir(`${API}?accion=horas&sede=${encodeURIComponent(sede)}`);
        if (!h.ok || !Array.isArray(h.ocupadas) || !Array.isArray(h.llenos)) throw new Error('horas');
        remote.taken[sede] = new Set(h.ocupadas); remote.full[sede] = new Set(h.llenos);
        remote.ready[sede] = true;
        if (sede === st.sede) availabilityStatus('Horarios actualizados. Hora de Colombia.');
        return true;
      } catch {
        if (sede === st.sede) availabilityStatus('No pudimos consultar los horarios. Revisa tu conexión y vuelve a intentar.', true);
        return false;
      } finally {
        if (sede === st.sede) {
          $('#slotsBox').removeAttribute('aria-busy');
          if (!enviando && !pendiente?.incierta && st.date && (!dayOk(st.date) || (st.time && estaOcupada(st.date, st.time)))) { st.time = null; ticket(); }
          if (!enviando) { renderCal(); renderSlots(); }
        }
      }
    })();
    remote.loading[sede] = task;
    try { return await task; } finally { delete remote.loading[sede]; }
  }
  async function enviarReserva(p) {
    if (!BACKEND) { guardarCita(`${p.sede}|${p.fecha}|${p.hora}`); return { ok: true, local: true }; }
    // Una sola petición: una respuesta perdida nunca se convierte en confirmación.
    try {
      return await pedir(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) }, 55000);
    } catch { return { ok: false, error: 'incierta' }; }
  }
  const MENSAJES = {
    hora_ocupada: 'Esa hora acaba de ser tomada por otra persona. Elige otra, por favor.',
    apartado_vencido: 'El apartado venció. Tus datos se conservan: vuelve a elegir una hora para continuar.',
    ampliaciones: 'Alcanzaste las diez ampliaciones. Tus datos se conservan; puedes volver a elegir una hora.',
    dia_lleno: 'Ese día ya no tiene horas disponibles. Elige otro día.',
    demasiadas_citas: 'Ya tienes varias citas pendientes con este celular. Escríbenos por WhatsApp para ayudarte.',
    fuera_de_rango: 'Esa hora ya no está disponible. Elige otra.',
    horario: 'Esa hora no está dentro del horario de la sede. Elige otra.',
    celular: 'Revisa tu celular: 10 números, empezando por 3.',
    nombre: 'Revisa tu nombre completo.',
    correo: 'Revisa tu correo: no parece válido.',
    invalido: 'No pudimos validar el formulario. Pulsa Limpiar y escribe tus datos de nuevo, o contáctanos por WhatsApp.',
    operacion: 'No pudimos validar este intento. Recarga la página para continuar.',
    operacion_conflicto: 'Este intento ya corresponde a otros datos. Recarga la página o contáctanos por WhatsApp.',
    limite: 'Has realizado varios intentos. Espera unos minutos o contáctanos por WhatsApp.',
    incierta: 'No recibimos la confirmación. Tu cita podría haberse guardado. Reintenta con los mismos datos para comprobarla o contáctanos por WhatsApp antes de elegir otra hora.',
    servidor: 'El servicio de citas no está disponible ahora. Inténtalo más tarde o contáctanos por WhatsApp.',
    red: 'No pudimos conectar con el servicio de citas. Revisa tu conexión.',
    sede: 'Selecciona una sede válida.', tipo: 'Selecciona un tipo de cita válido.', fecha: 'Selecciona un día y una hora válidos.'
  };

  const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const sameDay = (a, b) => a && b && ymd(a) === ymd(b);
  const hhmm12 = t => { const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${pad(m)} ${h < 12 ? 'a. m.' : 'p. m.'}`; };

  let today, last;
  const refreshWindow = () => {
    today = clinicNow(); today.setHours(0, 0, 0, 0);
    last = new Date(today); last.setDate(last.getDate() + DIAS_ADELANTE);
  };
  refreshWindow();
  const st = { tipo: 'Valoración inicial', sede: R.current(), date: null, time: null, month: new Date(today.getFullYear(), today.getMonth(), 1) };

  const horariosDe = sede => {
    const h = remote.cfg && remote.cfg.sedes && remote.cfg.sedes[sede] && remote.cfg.sedes[sede].horarios;
    return h || HORARIOS;
  };
  const estaOcupada = (d, t) => {
    if (apartado && apartado.vence > serverEpoch() && apartado.sede === st.sede && apartado.fecha === ymd(d) && apartado.hora === t) return false;
    if (BACKEND) { const s = remote.taken[st.sede]; return !!(s && s.has(`${ymd(d)}|${t}`)); }
    return tomadas().includes(`${st.sede}|${ymd(d)}|${t}`);
  };
  /* Todas las franjas del día (las de hoy que ya pasaron no se muestran) */
  const slotsAll = d => {
    const base = horariosDe(st.sede)[d.getDay()] || [];
    if (!sameDay(d, clinicNow())) return base;
    const limit = new Date(clinicNow().getTime() + HORAS_ANTICIPACION * 36e5);
    return base.filter(t => { const [h, m] = t.split(':').map(Number); const x = new Date(d); x.setHours(h, m, 0, 0); return x > limit; });
  };
  const slotsFor = d => slotsAll(d).filter(t => !estaOcupada(d, t));
  const diaLleno = d => { if (apartado && apartado.vence > serverEpoch() && apartado.sede === st.sede && apartado.fecha === ymd(d)) return false; const f = remote.full[st.sede]; return !!(BACKEND && f && f.has(ymd(d))) || (slotsAll(d).length > 0 && slotsFor(d).length === 0); };
  const dayOk = d => (!BACKEND || remote.ready[st.sede]) && d >= today && d <= last && slotsFor(d).length > 0 && !diaLleno(d);

  /* ---- Tipo y sede ---- */
  function bindChips(id, key, after) {
    const box = $(id);
    box.addEventListener('click', e => {
      const b = e.target.closest('.chip'); if (!b || enviando) return;
      st[key] = b.dataset.v; paintChips(); after && after();
    });
    box.addEventListener('keydown', e => {
      if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key) || enviando) return;
      const chips = [...box.querySelectorAll('.chip')], index = chips.indexOf(e.target);
      if (index < 0) return;
      e.preventDefault();
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? chips.length - 1 : (index + (['ArrowRight', 'ArrowDown'].includes(e.key) ? 1 : -1) + chips.length) % chips.length;
      chips[next].click(); chips[next].focus();
    });
  }
  function paintChips() {
    document.querySelectorAll('#bTipo .chip').forEach(b => { const on = b.dataset.v === st.tipo; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); b.tabIndex = on ? 0 : -1; });
    document.querySelectorAll('#bSede .chip').forEach(b => { const on = b.dataset.v === st.sede; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); b.tabIndex = on ? 0 : -1; });
  }
  bindChips('#bTipo', 'tipo', ticket);
  bindChips('#bSede', 'sede', () => { soltarApartado(); R.setSede && R.setSede(st.sede); st.time = null; ticket(); renderCal(); renderSlots(); refrescarRemoto(); });
  document.addEventListener('sedechange', e => { if (enviando || e.detail === st.sede) return; soltarApartado(); st.sede = e.detail; st.time = null; paintChips(); ticket(); renderCal(); renderSlots(); refrescarRemoto(); });

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
      b.setAttribute('aria-pressed', String(sameDay(d, st.date) || false));
      if (sameDay(d, st.date)) b.classList.add('on');
      b.setAttribute('aria-label', `${DIAS[d.getDay()]} ${n} de ${MESES[m]}${ok ? '' : lleno ? ', sin horas disponibles' : ', no disponible'}`);
      b.addEventListener('click', () => { if (enviando) return; soltarApartado(); st.date = d; st.time = null; renderCal(); renderSlots(); ticket(); });
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
        b.textContent = hhmm12(t); b.setAttribute('aria-pressed', String(st.time === t));
        if (ocupada) {
          hayOcupadas = true;
          b.disabled = true;
          b.title = 'Hora ocupada';
          b.setAttribute('aria-label', `${hhmm12(t)}, hora ocupada`);
          b.insertAdjacentHTML('beforeend', '<svg class="lock" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>');
        } else {
          b.addEventListener('click', () => { if (enviando) return; elegirHora(t); });
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

  /* Un solo normalizador para escritura, pegado y autocompletado. */
  const normalizePhone = value => String(value).replace(/\D/g, '').replace(/^57(?=3\d{9}$)/, '');
  const telEl = $('#bTel');
  telEl.addEventListener('blur', () => { telEl.value = normalizePhone(telEl.value); });
  const TYPOS = { 'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gamil.com': 'gmail.com', 'gmail.co': 'gmail.com', 'gmail.con': 'gmail.com', 'hotmial.com': 'hotmail.com', 'hotmail.con': 'hotmail.com', 'outlok.com': 'outlook.com', 'yahoo.con': 'yahoo.com', 'yaho.com': 'yahoo.com' };
  async function mailCheck(mail) {
    if (mail.length > 254 || !/^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(mail) || /\.\./.test(mail)) return { ok: false, msg: 'Escribe un correo válido, por ejemplo nombre@gmail.com.' };
    const dom = mail.split('@')[1];
    if (TYPOS[dom]) return { ok: false, msg: `¿Quisiste escribir ${mail.split('@')[0]}@${TYPOS[dom]}?` };
    return { ok: true };
  }
  const mailEl = $('#bMail'), mailHint = $('#bMailHint');
  mailEl.addEventListener('blur', async () => {
    const v = mailEl.value.trim().toLowerCase();
    mailEl.removeAttribute('aria-invalid'); mailHint.textContent = ''; mailHint.className = 'fhint full';
    if (!v) return;
    const r = await mailCheck(v);
    if (mailEl.value.trim().toLowerCase() !== v) return;
    if (r.ok) { mailHint.textContent = 'Formato de correo válido ✓'; mailHint.classList.add('ok'); }
    else { mailEl.setAttribute('aria-invalid', 'true'); mailHint.textContent = r.msg; mailHint.classList.add('bad'); }
  });
  mailEl.addEventListener('input', () => { mailEl.removeAttribute('aria-invalid'); mailHint.textContent = ''; });

  /* ---- Confirmar ---- */
  const err = msg => { const e = $('#bErr'); e.textContent = msg || ''; e.hidden = !msg; if (msg) e.scrollIntoView({ behavior: 'smooth', block: 'center' }); };
  let lastCard = null;
  const formEl = $('#bookForm');
  function setSending(on) {
    enviando = on;
    formEl.setAttribute('aria-busy', String(on));
    document.querySelectorAll('#bookForm input, #bookForm button, #sedeChip, .tabs button, #formSede, .city').forEach(el => {
      if (on) { el.dataset.bookingDisabled = String(el.disabled); el.disabled = true; }
      else if (el.dataset.bookingDisabled !== undefined) { el.disabled = el.dataset.bookingDisabled === 'true'; delete el.dataset.bookingDisabled; }
    });
    $('#bGo').textContent = on ? 'Confirmando…' : 'Confirmar cita';
  }
  const operationId = () => {
    const bytes = new Uint8Array(16); crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  };
  const serverEpoch = () => remote.clock ? remote.clock.epoch + performance.now() - remote.clock.tick : Date.now();
  let sesion;
  try { sesion = sessionStorage.getItem('rivas.apartado.sesion'); } catch {}
  if (!/^[a-f0-9]{32}$/.test(sesion || '')) {
    sesion = operationId();
    try { sessionStorage.setItem('rivas.apartado.sesion', sesion); } catch {}
  }
  let apartado = null, avisoTiempo = false, extensionPendiente = null;
  function soltarApartado() {
    const anterior = apartado; apartado = null; avisoTiempo = false; extensionPendiente = null;
    $('#holdBox').hidden = true;
    if (!anterior) return;
    // Si cerrar la pestaña impide esta petición, el servidor libera por vencimiento.
    enviarReserva({ accion: 'liberar', sesion, token: anterior.token });
    remote.taken[anterior.sede]?.delete(`${anterior.fecha}|${anterior.hora}`);
  }
  function pintarApartado() {
    if (!apartado || enviando) return;
    const segundos = Math.max(0, Math.ceil((apartado.vence - serverEpoch()) / 1000));
    $('#holdClock').textContent = `Tiempo de apartado: ${pad(Math.floor(segundos / 60))}:${pad(segundos % 60)}. Hora de Colombia.`;
    if (!segundos) {
      apartado = null; if (!pendiente?.incierta) st.time = null; ticket(); renderSlots();
      $('#holdClock').textContent = '';
      $('#holdMessage').textContent = pendiente?.incierta ? 'Tu apartado venció y la confirmación anterior es incierta. Reintenta con los mismos datos para comprobarla antes de elegir otra hora.' : 'Tu apartado venció. Tus datos se conservan. Elige una hora para continuar.';
      $('#holdExtend').hidden = true;
      refrescarRemoto();
    } else if (segundos <= 60 && !avisoTiempo) {
      avisoTiempo = true;
      $('#holdMessage').textContent = apartado.puedeAmpliar ? 'Queda un minuto o menos. Puedes ampliar el tiempo con el botón «Necesito más tiempo».' : 'Queda un minuto o menos. Confirma tu cita o elige otra franja; tus datos se conservarán.';
    }
  }
  async function elegirHora(hora) {
    if (!BACKEND) { st.time = hora; renderSlots(); ticket(); return; }
    const seleccion = { sede: st.sede, fecha: ymd(st.date), hora };
    setSending(true); $('#bGo').textContent = 'Apartando horario…'; err('');
    try {
      const r = await enviarReserva({ accion: 'apartar', sesion, ...seleccion });
      if (!r.ok || !/^[a-f0-9]{32}$/.test(r.token || '') || !Number.isFinite(r.vence)) {
        err(r.error === 'incierta' ? 'No recibimos el apartado. Vuelve a seleccionar la hora para comprobarlo; en este paso todavía no se registra una cita.' : MENSAJES[r.error] || 'No pudimos apartar esa hora. Vuelve a seleccionarla.'); return;
      }
      apartado = { ...seleccion, token: r.token, vence: r.vence, ampliaciones: r.ampliaciones, puedeAmpliar: r.puedeAmpliar !== false };
      extensionPendiente = null;
      if (Number.isFinite(r.ahora)) remote.clock = { epoch: r.ahora, tick: performance.now() };
      avisoTiempo = false; st.time = hora;
      $('#holdBox').hidden = false; $('#holdExtend').hidden = r.puedeAmpliar === false;
      $('#holdMessage').textContent = r.puedeAmpliar === false ? 'Horario apartado hasta el tiempo indicado. Esta franja está cerca del cierre de reservas por anticipación mínima y no admite más tiempo. Tus datos se conservarán si necesitas elegir otra hora.' : 'Horario apartado para ti durante cinco minutos. Revisa día, hora y sede antes de confirmar. Puedes ampliar el tiempo hasta diez veces, sin superar el cierre de reservas de esta franja.';
    } finally { setSending(false); renderSlots(); ticket(); pintarApartado(); }
  }
  $('#holdExtend').addEventListener('click', async () => {
    if (!apartado || enviando) return;
    setSending(true);
    $('#bGo').textContent = 'Ampliando apartado…';
    try {
      extensionPendiente ||= operationId();
      const r = await enviarReserva({ accion: 'extender', sesion, token: apartado.token, operacion: extensionPendiente });
      if (!r.ok) { err(r.error === 'incierta' ? 'No recibimos la ampliación. Vuelve a pulsar «Necesito más tiempo» para comprobarla.' : MENSAJES[r.error] || MENSAJES.red); return; }
      apartado.vence = r.vence; apartado.ampliaciones = r.ampliaciones;
      apartado.puedeAmpliar = r.ampliaciones < 10 && r.puedeAmpliar !== false;
      extensionPendiente = null;
      if (Number.isFinite(r.ahora)) remote.clock = { epoch: r.ahora, tick: performance.now() };
      avisoTiempo = false;
      $('#holdMessage').textContent = `Tiempo actualizado. Ampliaciones usadas: ${r.ampliaciones} de 10.${r.puedeAmpliar === false ? ' No hay más ampliaciones para esta franja. Tus datos se conservarán si necesitas elegir otra hora.' : ''}`;
      $('#holdExtend').hidden = r.ampliaciones >= 10 || r.puedeAmpliar === false;
    } finally { setSending(false); pintarApartado(); }
  });
  setInterval(pintarApartado, 1000);
  formEl.addEventListener('submit', e => {
    e.preventDefault();
    confirmar().catch(() => { setSending(false); err(MENSAJES.incierta); });
  });
  async function confirmar() {
    if (enviando) return;
    const nombre = $('#bNombre').value.trim(), tel = normalizePhone($('#bTel').value), mail = $('#bMail').value.trim().toLowerCase();
    $('#bTel').value = tel;
    if (!st.date || !st.time) return err('Elige el día y la hora de tu cita.');
    if (BACKEND && !remote.ready[st.sede]) return err('Actualiza los horarios antes de confirmar tu cita.');
    if (nombre.length < 3 || nombre.length > 80) { $('#bNombre').focus(); return err('Escribe tu nombre completo, entre 3 y 80 caracteres.'); }
    if (!/^3\d{9}$/.test(tel)) { $('#bTel').focus(); return err('Escribe tu celular con 10 números, empezando por 3 (ej. 3001234567).'); }
    if (!$('#bOk').checked) return err('Debes aceptar el uso de tus datos para continuar.');
    // Capturar TODO antes del primer await; el comprobante siempre usa estos datos.
    const selection = { sede: st.sede, date: new Date(st.date), time: st.time, tipo: st.tipo };
    const s = R.SEDES[selection.sede], d = selection.date;
    const payload = { sede: selection.sede, nombre, celular: tel, correo: mail, tipo: selection.tipo, fecha: ymd(d), hora: selection.time, hp: $('#bHp').value };
    const signature = JSON.stringify(payload);
    if (BACKEND && (!apartado || apartado.vence <= serverEpoch()) && !(pendiente && pendiente.signature === signature && pendiente.incierta)) return err(MENSAJES.apartado_vencido);
    if (!pendiente || pendiente.signature !== signature) pendiente = { signature, operacion: operationId() };
    payload.operacion = pendiente.operacion;
    payload.sesion = sesion; payload.token = apartado ? apartado.token : pendiente.token;
    pendiente.token = payload.token;
    setSending(true); err('');
    let res;
    try {
      const check = mail ? await mailCheck(mail) : { ok: true };
      if (!check.ok) { err(check.msg); return; }
      res = await enviarReserva(payload);
      if (!res || !res.ok) {
        const code = res && res.error;
        pendiente.incierta = code === 'incierta';
        if (['hora_ocupada', 'dia_lleno', 'fuera_de_rango', 'horario', 'apartado_vencido'].includes(code)) { soltarApartado(); st.time = null; ticket(); refrescarRemoto(); }
        err(MENSAJES[code] || MENSAJES.servidor);
        return;
      }
      if (!res.local && (typeof res.id !== 'string' || !res.id)) { err(MENSAJES.incierta); return; }
      apartado = null; $('#holdBox').hidden = true;
      if (BACKEND) (remote.taken[selection.sede] = remote.taken[selection.sede] || new Set()).add(`${payload.fecha}|${selection.time}`);
      const fecha = `${DIAS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()].toLowerCase()} de ${d.getFullYear()}`;
      const hora = hhmm12(selection.time);
      $('#doneTxt').textContent = `${nombre}, te esperamos el ${fecha} a las ${hora} en la sede ${s.name} (${s.addr}). Tipo de cita: ${selection.tipo}.`;
      $('#doneRef').textContent = res.id ? `Referencia: ${res.id}` : 'Confirma la cita por WhatsApp.';
      $('#doneNotice').textContent = res.local ? 'Confirma tu solicitud por WhatsApp para que la sede la registre.' : 'Estado: pendiente de confirmación por la sede. ' + (res.correo === 'fallido' ? 'Tu cita quedó guardada, pero no pudimos enviar el correo. Conserva la referencia o contáctanos por WhatsApp.' : 'Guarda tu tarjeta como comprobante. Si indicaste correo, revisa también spam. Para cambiar o cancelar, contacta a la sede por WhatsApp.');
      const msg = `Hola, quiero confirmar mi cita.\nNombre: ${nombre}\nTipo: ${selection.tipo}\nSede: ${s.name}\nFecha: ${fecha}\nHora: ${hora}\nReferencia: ${res.id || 'Solicitud por WhatsApp'}`;
      lastCard = { nombre, tipo: selection.tipo, sede: s.name, addr: s.addr, dia: d.getDate(), mes: `${MESES[d.getMonth()]} ${d.getFullYear()}`, sem: DIAS[d.getDay()], hora, id: res.id || '', fecha: payload.fecha, hora24: selection.time, duracion: remote.cfg?.duracion || 30 };
      $('#doneCalendar').hidden = !!res.local;
      $('#doneWa').href = R.waUrl(selection.sede, msg);
      clearForm(); pendiente = null;
      $('#bookForm').hidden = true; $('#bDone').hidden = false;
      document.querySelector('.ticket').classList.add('full', 'booked');
      $('#bDone').focus();
      $('#book').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } finally {
      setSending(false);
      if (!res || !res.ok) { renderCal(); renderSlots(); }
    }
  }
  // Mantener el botón estable al cerrar el teclado sin enviar desde pointerup.
  $('#bGo').addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch' && !enviando) e.preventDefault();
  });
  $('#availabilityRetry').addEventListener('click', () => { if (!enviando) refrescarRemoto(); });

  /* Tarjeta de la cita como imagen : se guarda o se comparte por WhatsApp */
  function dibujarTarjeta(d) {
    const W = 1080, H = 1350, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d'), SERIF = '"Instrument Serif", Georgia, serif', SANS = 'Inter, Arial, sans-serif';
    const rr = (x, y, w, h, r) => {
      g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
    };
    g.fillStyle = '#e1e5e2'; g.fillRect(0, 0, W, H);
    rr(60, 60, W - 120, H - 120, 48); g.fillStyle = '#f8f9f7'; g.fill();
    g.save(); rr(60, 60, W - 120, H - 120, 48); g.clip();
    g.fillStyle = '#0b0c0c'; g.fillRect(60, 60, W - 120, 190);
    g.fillStyle = '#f4f6f4'; g.font = `64px ${SERIF}`; g.fillText('Dr. Rivas', 110, 150);
    g.fillStyle = '#aeb6b2'; g.font = `600 20px ${SANS}`; g.fillText('ODONTOLOGÍA & ESTÉTICA', 112, 196);
    g.restore();
    g.fillStyle = '#2f6b63'; g.font = `600 26px ${SANS}`; g.fillText(('HOLA ' + d.nombre.split(' ')[0]).toUpperCase(), 110, 340);
    g.fillStyle = '#0b0c0c'; g.font = `84px ${SERIF}`; g.fillText('Tu cita quedó guardada', 110, 440);
    g.font = `190px ${SERIF}`; g.fillText(String(d.dia).padStart(2, '0'), 110, 650);
    g.font = `700 40px ${SANS}`; g.fillText(d.mes, 340, 585);
    g.fillStyle = '#5c6763'; g.font = `32px ${SANS}`; g.fillText(d.sem.charAt(0).toUpperCase() + d.sem.slice(1), 340, 635);
    rr(700, 560, 270, 96, 28); g.fillStyle = '#0b0c0c'; g.fill();
    g.fillStyle = '#f4f6f4'; g.font = `700 40px ${SANS}`; g.textAlign = 'center'; g.fillText(d.hora, 835, 622); g.textAlign = 'left';
    const filas = [['SEDE', d.sede], ['DIRECCIÓN', d.addr], ['TIPO DE CITA', d.tipo], ['PACIENTE', d.nombre]];
    let y = 740;
    filas.forEach(([k, v]) => {
      g.strokeStyle = '#dde2df'; g.lineWidth = 2; g.beginPath(); g.moveTo(110, y + 50); g.lineTo(W - 110, y + 50); g.stroke();
      g.fillStyle = '#5c6763'; g.font = `600 24px ${SANS}`; g.fillText(k, 110, y + 20);
      g.fillStyle = '#0b0c0c'; g.font = `600 32px ${SANS}`;
      let px = 32; while (g.measureText(v).width > 550 && px > 22) { px -= 2; g.font = `600 ${px}px ${SANS}`; }
      let text = String(v);
      while (text.length > 1 && g.measureText(text + '…').width > 550) text = text.slice(0, -1);
      g.fillText(text === String(v) ? text : text + '…', 420, y + 20);
      y += 92;
    });
    g.fillStyle = '#5c6763'; g.font = `400 28px ${SANS}`;
    g.fillText('Confirma tu asistencia por WhatsApp. ¡Te esperamos!', 110, 1180);
    if (d.id) { g.font = `400 19px ${SANS}`; g.fillText('Referencia: ' + d.id, 110, 1230); }
    return cv;
  }
  $('#doneCard').addEventListener('click', async () => {
    if (!lastCard) return;
    const button = $('#doneCard'), status = $('#doneCardStatus');
    button.disabled = true; status.textContent = '';
    try {
      try { await document.fonts.ready; } catch { /* usar fuentes de respaldo */ }
      const cv = dibujarTarjeta(lastCard);
      const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
      if (!blob) throw new Error('imagen');
      const file = new File([blob], 'mi-cita-dr-rivas.png', { type: 'image/png' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    } catch { status.textContent = 'No pudimos generar la imagen. Conserva la referencia de tu cita o toma una captura.'; }
    finally { button.disabled = false; }
  });
  $('#doneCalendar').addEventListener('click', () => {
    if (!lastCard) return;
    try {
      const content = window.RIVAS_ICS({ id: lastCard.id, fecha: lastCard.fecha, hora: lastCard.hora24, duracion: lastCard.duracion, sede: lastCard.sede, direccion: lastCard.addr });
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([content], { type: 'text/calendar;charset=utf-8' }));
      a.download = 'cita-dr-rivas.ics'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    } catch { $('#doneCardStatus').textContent = 'No pudimos generar el calendario. Conserva la referencia y la tarjeta de tu cita.'; }
  });

  function clearForm() {
    $('#bookForm').reset();
    mailEl.removeAttribute('aria-invalid'); mailHint.textContent = ''; mailHint.className = 'fhint full';
    err('');
  }
  clearForm();
  addEventListener('pageshow', e => { if (e.persisted) { pintarApartado(); refrescarRemoto(); } });

  /* Limpiar: deja el agendador como nuevo (tipo, día, hora y datos); la sede elegida se conserva */
  function resetBooking() {
    if (enviando) return;
    soltarApartado();
    pendiente = null;
    st.date = null; st.time = null; st.tipo = 'Valoración inicial';
    st.month = new Date(today.getFullYear(), today.getMonth(), 1);
    clearForm(); $('#doneCardStatus').textContent = '';
    document.querySelector('.ticket').classList.remove('full', 'booked');
    paintChips(); renderCal(); renderSlots(); ticket();
  }
  $('#bClear').addEventListener('click', resetBooking);
  $('#doneAgain').addEventListener('click', () => {
    resetBooking(); $('#bookForm').hidden = false; $('#bDone').hidden = true;
  });

  // Si la página queda abierta de un día para otro, la ventana de 30 días se actualiza sola
  const dayKey = () => ymd(clinicNow());
  let seen = dayKey();
  const checkDay = () => {
    if (enviando || pendiente?.incierta || dayKey() === seen) return;
    seen = dayKey(); refreshWindow();
    if (st.date && !dayOk(st.date)) { st.date = null; st.time = null; }
    st.month = new Date(today.getFullYear(), today.getMonth(), 1);
    renderCal(); renderSlots(); ticket();
  };
  document.addEventListener('visibilitychange', checkDay);
  addEventListener('focus', checkDay);
  setInterval(checkDay, 60000);

  document.addEventListener('visibilitychange', () => { if (!document.hidden && !enviando) refrescarRemoto(); });
  setInterval(() => { if (!document.hidden && !enviando) refrescarRemoto(); }, 120000);

  paintChips(); renderCal(); renderSlots(); ticket();
  refrescarRemoto();
})();
