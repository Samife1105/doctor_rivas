/**
 * AGENDA DR. RIVAS — Google Apps Script
 * Se pega en la hoja de cálculo (Extensiones > Apps Script) y se publica como aplicación web.
 * Hace cinco cosas:
 *   1. Entrega al sitio la configuración (horarios por sede) y las horas ya ocupadas.
 *   2. Guarda cada cita nueva en la hoja "Citas" (una fila por cita).
 *   3. Crea el evento en Google Calendar de la sede e invita al paciente si dejó correo.
 *   4. Avisa por correo a la sede.
 *   5. Un día antes, recuerda la cita al paciente por correo. Si la recepción marca "Cancelada", libera la hora.
 */

const TZ = 'America/Bogota';
const HOJA_CITAS = 'Citas';
const HOJA_CONFIG = 'Configuración';
const TIPOS = ['Valoración inicial', 'Diseño de sonrisa', 'Implantes dentales', 'Ortodoncia invisible'];
const MAX_ACTIVAS_POR_CELULAR = 3;

// Columnas de "Citas" (base 1)
const C = { ID: 1, REG: 2, SEDE: 3, FECHA: 4, HORA: 5, TIPO: 6, NOMBRE: 7, CEL: 8, MAIL: 9, ESTADO: 10, NOTAS: 11, EVENTO: 12, RECORD: 13 };

/* ============================== Entrada web ============================== */

function doGet(e) {
  try {
    const accion = (e && e.parameter && e.parameter.accion) || '';
    const cfg = leerConfig_();
    if (accion === 'config') return json_(configPublica_(cfg));
    if (accion === 'horas') {
      const sede = e.parameter.sede;
      if (!cfg.sedes[sede]) return json_({ ok: false, error: 'sede' });
      return json_(ocupadas_(cfg, sede));
    }
    return json_({ ok: true, servicio: 'Agenda Dr. Rivas' });
  } catch (err) {
    return json_({ ok: false, error: 'servidor', detalle: String(err) });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  let salida;
  try {
    lock.waitLock(25000);
    const datos = JSON.parse(e.postData.contents);
    salida = registrar_(datos);
  } catch (err) {
    salida = { ok: false, error: 'servidor', detalle: String(err) };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
  return json_(salida);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ============================== Configuración ============================== */

function leerConfig_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(HOJA_CONFIG);
  const p = sh.getRange('B4:B10').getDisplayValues().map(r => r[0]);
  const cfg = {
    dias: Number(p[0]) || 30,
    horasMin: Number(p[1]) || 2,
    maxDia: Number(p[2]) || 20,
    duracion: Number(p[3]) || 30,
    remitente: p[4] || 'Clínica Dr. Rivas',
    copia: (p[5] || '').trim(),
    invitarPersonal: !/^\s*no/i.test(p[6] || ''),   // por defecto SI
    sedes: {}
  };
  sh.getRange('A13:F15').getDisplayValues().forEach(r => {
    if (!r[0]) return;
    cfg.sedes[r[0]] = { clave: r[0], nombre: r[1], correos: correos_(r[2]), whatsapp: r[3], calId: (r[4] || '').trim(), direccion: r[5], horarios: {} };
  });
  const dia = { 'Lunes': 1, 'Martes': 2, 'Miércoles': 3, 'Jueves': 4, 'Viernes': 5, 'Sábado': 6, 'Domingo': 0 };
  sh.getRange('A20:D40').getDisplayValues().forEach(r => {
    const s = cfg.sedes[r[0]];
    if (!s || dia[r[1]] === undefined) return;
    const desde = hhmm_(r[2]), hasta = hhmm_(r[3]);
    s.horarios[dia[r[1]]] = desde && hasta ? franjas_(desde, hasta, cfg.duracion) : [];
  });
  return cfg;
}

/** Acepta varios correos separados por coma, punto y coma o espacio. */
function correos_(txt) {
  return String(txt || '').split(/[,;\s]+/).map(s => s.trim().toLowerCase()).filter(s => correoValido_(s));
}

function hhmm_(txt) {
  const m = String(txt || '').trim().match(/^(\d{1,2}):(\d{2})/);
  return m ? ('0' + m[1]).slice(-2) + ':' + m[2] : '';
}

function franjas_(desde, hasta, dur) {
  const aMin = t => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const out = [];
  for (let m = aMin(desde); m + dur <= aMin(hasta); m += dur) {
    out.push(('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + (m % 60)).slice(-2));
  }
  return out;
}

function configPublica_(cfg) {
  const sedes = {};
  Object.keys(cfg.sedes).forEach(k => {
    const s = cfg.sedes[k];
    sedes[k] = { nombre: s.nombre, direccion: s.direccion, whatsapp: s.whatsapp, horarios: s.horarios };
  });
  return { ok: true, dias: cfg.dias, horasMin: cfg.horasMin, maxDia: cfg.maxDia, duracion: cfg.duracion, sedes: sedes };
}

/* ============================== Lectura de citas ============================== */

function fechaTxt_(d, tz) { return Utilities.formatDate(d, tz, 'yyyyMMdd'); }

function citas_() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(HOJA_CITAS);
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  const tz = ss.getSpreadsheetTimeZone();
  const vals = sh.getRange(2, 1, n, 13).getValues();
  const disp = sh.getRange(2, 1, n, 13).getDisplayValues();
  const out = [];
  vals.forEach((r, i) => {
    if (!(r[C.FECHA - 1] instanceof Date)) return;
    out.push({
      fila: i + 2,
      sedeNombre: r[C.SEDE - 1],
      fecha: fechaTxt_(r[C.FECHA - 1], tz),
      hora: hhmm_(disp[i][C.HORA - 1]),
      estado: r[C.ESTADO - 1] || 'Pendiente',
      celular: disp[i][C.CEL - 1],
      correo: String(r[C.MAIL - 1] || '').trim(),
      nombre: r[C.NOMBRE - 1],
      tipo: r[C.TIPO - 1],
      evento: r[C.EVENTO - 1],
      recordatorio: r[C.RECORD - 1]
    });
  });
  return out;
}

function claveDeNombre_(cfg, nombre) {
  const k = Object.keys(cfg.sedes).filter(x => cfg.sedes[x].nombre === nombre)[0];
  return k || '';
}

function ocupadas_(cfg, sede) {
  const hoy = fechaTxt_(new Date(), TZ);
  const ocupadas = [];
  const porDia = {};
  citas_().forEach(c => {
    if (c.estado === 'Cancelada' || claveDeNombre_(cfg, c.sedeNombre) !== sede || c.fecha < hoy) return;
    ocupadas.push(c.fecha + '|' + c.hora);
    porDia[c.fecha] = (porDia[c.fecha] || 0) + 1;
  });
  const llenos = Object.keys(porDia).filter(f => porDia[f] >= cfg.maxDia);
  return { ok: true, ocupadas: ocupadas, llenos: llenos };
}

/* ============================== Registrar una cita ============================== */

function registrar_(d) {
  if (d.hp) return { ok: false, error: 'invalido' };           // campo trampa anti-spam
  const cfg = leerConfig_();
  const sede = cfg.sedes[d.sede];
  const nombre = String(d.nombre || '').trim();
  const celular = String(d.celular || '').replace(/\D/g, '');
  const correo = String(d.correo || '').trim().toLowerCase();
  const tipo = String(d.tipo || '');
  const fecha = String(d.fecha || '');
  const hora = String(d.hora || '');

  if (!sede) return { ok: false, error: 'sede' };
  if (nombre.length < 3 || nombre.length > 80) return { ok: false, error: 'nombre' };
  if (!/^3\d{9}$/.test(celular)) return { ok: false, error: 'celular' };
  if (correo && !/^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(correo)) return { ok: false, error: 'correo' };
  if (TIPOS.indexOf(tipo) < 0) return { ok: false, error: 'tipo' };
  if (!/^\d{8}$/.test(fecha) || !/^\d{2}:\d{2}$/.test(hora)) return { ok: false, error: 'fecha' };

  const y = Number(fecha.slice(0, 4)), m = Number(fecha.slice(4, 6)), dd = Number(fecha.slice(6, 8));
  const inicio = new Date(y, m - 1, dd, Number(hora.slice(0, 2)), Number(hora.slice(3, 5)));
  const ahora = new Date();
  const limite = new Date(ahora.getTime() + cfg.dias * 86400000 + 86400000);
  if (isNaN(inicio.getTime()) || inicio.getTime() < ahora.getTime() + cfg.horasMin * 3600000 || inicio > limite) return { ok: false, error: 'fuera_de_rango' };

  const franjasDia = sede.horarios[inicio.getDay()] || [];
  if (franjasDia.indexOf(hora) < 0) return { ok: false, error: 'horario' };

  const hoy = fechaTxt_(ahora, TZ);
  const existentes = citas_().filter(c => c.estado !== 'Cancelada');
  if (existentes.some(c => claveDeNombre_(cfg, c.sedeNombre) === d.sede && c.fecha === fecha && c.hora === hora)) return { ok: false, error: 'hora_ocupada' };
  if (existentes.filter(c => claveDeNombre_(cfg, c.sedeNombre) === d.sede && c.fecha === fecha).length >= cfg.maxDia) return { ok: false, error: 'dia_lleno' };
  if (existentes.filter(c => c.celular === celular && c.fecha >= hoy).length >= MAX_ACTIVAS_POR_CELULAR) return { ok: false, error: 'demasiadas_citas' };

  // --- Evento en el calendario de la sede (invita al paciente si hay correo)
  const cal = (sede.calId && CalendarApp.getCalendarById(sede.calId)) || CalendarApp.getDefaultCalendar();
  const fin = new Date(inicio.getTime() + cfg.duracion * 60000);
  const opciones = {
    location: sede.nombre + ' · ' + sede.direccion,
    description: 'Paciente: ' + nombre + '\nCelular: ' + celular + '\nTipo de cita: ' + tipo + '\nAgendada desde el sitio web.\nPara cambiar o cancelar escribe por WhatsApp a la sede.'
  };
  const dueno = (Session.getEffectiveUser().getEmail() || '').toLowerCase();
  const invitados = [];
  if (correo && correo !== dueno) invitados.push(correo);
  if (cfg.invitarPersonal) sede.correos.forEach(c => { if (c !== dueno && invitados.indexOf(c) < 0) invitados.push(c); });
  if (invitados.length) { opciones.guests = invitados.join(','); opciones.sendInvites = true; }
  let evento = null;
  try {
    evento = cal.createEvent('Dr. Rivas · ' + nombre + ' · ' + tipo + ' (' + sede.nombre + ')', inicio, fin, opciones);
    evento.removeAllReminders();
    evento.addPopupReminder(60);
  } catch (err) {
    evento = null; // si el calendario falla, la cita igual queda guardada
  }

  // --- Fila en la hoja
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(HOJA_CITAS);
  const fila = sh.getLastRow() + 1;
  const id = 'C' + Utilities.formatDate(ahora, TZ, 'yyMMddHHmm') + Math.floor(100 + Math.random() * 900);
  sh.getRange(fila, C.HORA).setNumberFormat('@');
  sh.getRange(fila, C.CEL).setNumberFormat('@');
  sh.getRange(fila, 1, 1, 13).setValues([[id, ahora, sede.nombre, new Date(y, m - 1, dd), hora, tipo, nombre, celular, correo, 'Pendiente', '', evento ? evento.getId() : '', '']]);

  // --- Aviso por correo a la sede
  const destino = sede.correos.join(',');
  if (destino) {
    const cuando = Utilities.formatDate(inicio, TZ, "EEEE d 'de' MMMM yyyy, h:mm a");
    MailApp.sendEmail({
      to: destino,
      cc: correoValido_(cfg.copia) ? cfg.copia : '',
      name: cfg.remitente,
      subject: 'Nueva cita · ' + sede.nombre + ' · ' + Utilities.formatDate(inicio, TZ, 'd/MM h:mm a') + ' · ' + nombre,
      htmlBody:
        '<p><b>Nueva cita agendada desde el sitio web</b></p>' +
        '<p>Sede: ' + sede.nombre + '<br>Fecha y hora: ' + cuando + '<br>Tipo: ' + tipo + '<br>Paciente: ' + esc_(nombre) + '<br>Celular: ' + celular + '<br>Correo: ' + (correo || '—') + '</p>' +
        '<p>Estado: Pendiente. Confírmala por WhatsApp y cámbiala a “Confirmada” en la hoja.</p>' +
        '<p><a href="' + ss.getUrl() + '">Abrir la hoja de citas</a></p>'
    });
  }
  return { ok: true, id: id };
}

function correoValido_(c) { return /^[^@\s\[]+@[^@\s]+\.[^@\s]+$/.test(String(c || '')); }
function esc_(s) { return String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])); }

/* ============================== Recordatorios y cancelaciones ============================== */

/** Se ejecuta todos los días (8 a. m.): recuerda por correo las citas de mañana. */
function enviarRecordatorios() {
  const cfg = leerConfig_();
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(HOJA_CITAS);
  const manana = new Date(Date.now() + 86400000);
  const clave = fechaTxt_(manana, TZ);
  citas_().forEach(c => {
    if (c.fecha !== clave || c.recordatorio || !correoValido_(c.correo)) return;
    if (c.estado !== 'Pendiente' && c.estado !== 'Confirmada') return;
    const k = claveDeNombre_(cfg, c.sedeNombre);
    const sede = cfg.sedes[k];
    if (!sede) return;
    const wa = 'https://wa.me/' + sede.whatsapp;
    MailApp.sendEmail({
      to: c.correo,
      name: cfg.remitente,
      subject: 'Recordatorio: tu cita mañana a las ' + c.hora + ' en ' + sede.nombre,
      htmlBody:
        '<p>Hola ' + esc_(String(c.nombre).split(' ')[0]) + ',</p>' +
        '<p>Te recordamos tu cita de <b>' + c.tipo + '</b> <b>mañana a las ' + c.hora + '</b> en la sede <b>' + sede.nombre + '</b> (' + esc_(sede.direccion) + ').</p>' +
        '<p>Si no puedes asistir o quieres cambiar la hora, escríbenos por <a href="' + wa + '">WhatsApp</a>.</p>' +
        '<p>¡Te esperamos!<br>' + esc_(cfg.remitente) + '</p>'
    });
    sh.getRange(c.fila, C.RECORD).setValue(new Date());
  });
}

/** Trigger instalable: si la recepción marca "Cancelada", se borra el evento y la hora queda libre. */
function alEditar_(e) {
  try {
    if (!e || !e.range) return;
    const sh = e.range.getSheet();
    if (sh.getName() !== HOJA_CITAS || e.range.getRow() < 2 || e.range.getColumn() !== C.ESTADO) return;
    if (String(e.value) !== 'Cancelada') return;
    const cfg = leerConfig_();
    const fila = e.range.getRow();
    const idEvento = sh.getRange(fila, C.EVENTO).getValue();
    if (!idEvento) return;
    const k = claveDeNombre_(cfg, sh.getRange(fila, C.SEDE).getValue());
    const calId = k && cfg.sedes[k].calId;
    const cal = (calId && CalendarApp.getCalendarById(calId)) || CalendarApp.getDefaultCalendar();
    const ev = cal.getEventById(idEvento);
    if (ev) ev.deleteEvent();
    sh.getRange(fila, C.EVENTO).setValue('');
  } catch (err) {
    console.error(err);
  }
}

/* ============================== Instalación (se ejecuta una sola vez) ============================== */

/** Ejecuta esta función una vez: pide permisos y crea el recordatorio diario y el control de cancelaciones. */
function instalar() {
  CalendarApp.getDefaultCalendar();                 // fuerza el permiso de Calendar
  MailApp.getRemainingDailyQuota();                 // fuerza el permiso de correo
  ScriptApp.getProjectTriggers().forEach(t => {
    const f = t.getHandlerFunction();
    if (f === 'enviarRecordatorios' || f === 'alEditar_') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('enviarRecordatorios').timeBased().atHour(8).everyDays(1).inTimezone(TZ).create();
  ScriptApp.newTrigger('alEditar_').forSpreadsheet(SpreadsheetApp.getActive()).onEdit().create();
  formatoCitas();
  console.log('Listo: formato por estado, recordatorios diarios (8 a. m.) y control de cancelaciones instalados.');
}


/* ============================== Formato de la hoja ============================== */

/**
 * Colorea la fila completa según el estado y deja la lista desplegable de estados.
 * Se ejecuta sola dentro de instalar(); también se puede ejecutar a mano.
 */
function formatoCitas() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(HOJA_CITAS);
  const rango = sh.getRange('A2:M1000');
  const colores = [
    ['Pendiente',  '#FFF4CC', '#5B4B00'],   // amarillo suave
    ['Confirmada', '#DCEBFF', '#12365F'],   // azul suave
    ['Atendida',   '#D3EFD8', '#14532D'],   // verde
    ['No asistió', '#E6E6E6', '#6B6B6B'],   // gris
    ['Cancelada',  '#F8D7D3', '#8A2F27']    // rojo suave
  ];
  const reglas = colores.map(c => SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$J2="' + c[0] + '"')
    .setBackground(c[1]).setFontColor(c[2]).setRanges([rango]).build());
  sh.setConditionalFormatRules(reglas);

  const lista = SpreadsheetApp.newDataValidation()
    .requireValueInList(colores.map(c => c[0]), true).setAllowInvalid(false).build();
  sh.getRange('J2:J1000').setDataValidation(lista);
  sh.getRange('D2:D1000').setNumberFormat('dd/mm/yyyy');
  sh.getRange('B2:B1000').setNumberFormat('dd/mm/yyyy hh:mm');
  sh.getRange('E2:E1000').setNumberFormat('@');
  sh.getRange('H2:H1000').setNumberFormat('@');

  // Parámetro nuevo en Configuración (si falta)
  const cf = ss.getSheetByName(HOJA_CONFIG);
  if (!cf.getRange('A10').getValue()) {
    cf.getRange('A10').setValue('Invitar a los correos de la sede al evento de calendario (SI/NO)');
    cf.getRange('B10').setValue('SI').setBackground('#EFECE5');
  }
  cf.getRange('C12').setValue('Correo(s) de la sede: reciben el aviso de cada cita y la invitación de calendario (separa varios con coma)');
}
