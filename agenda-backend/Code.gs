/**
 * AGENDA DR. RIVAS — Google Apps Script (v4, sin calendario)
 * Se pega en la hoja de cálculo (Extensiones > Apps Script) y se publica como aplicación web.
 *
 * Qué hace:
 *   1. Entrega al sitio la configuración (horarios por sede) y las horas ya ocupadas.
 *   2. Guarda cada cita nueva en la pestaña de SU sede: "Citas Yopal", "Citas Aguazul" o "Citas Bogotá".
 *   3. Le manda al paciente un correo corto: "tu cita quedó guardada" (si dejó su correo).
 *   4. Avisa por correo a la sede (si hay un correo configurado).
 *   5. Un día antes recuerda la cita al paciente por correo.
 * Si la recepción marca "Cancelada", la hora queda libre de inmediato.
 *
 * Permisos que necesita: la hoja de cálculo, enviar correos y el recordatorio diario. Nada más.
 */

const TZ = 'America/Bogota';
const HOJAS = { yopal: 'Citas Yopal', aguazul: 'Citas Aguazul', bogota: 'Citas Bogotá' };
const HOJA_CONFIG = 'Configuración';
const TIPOS = ['Valoración inicial', 'Diseño de sonrisa', 'Implantes dentales', 'Ortodoncia invisible'];
const ESTADOS = ['Pendiente', 'Confirmada', 'Atendida', 'No asistió', 'Cancelada'];
const MAX_ACTIVAS_POR_CELULAR = 3;
const ENCABEZADOS = ['ID', 'Registrada', 'Sede', 'Fecha de la cita', 'Hora', 'Tipo de cita', 'Nombre', 'Celular', 'Correo', 'Estado', 'Notas (uso interno)'];

// Columnas de cada pestaña de citas (base 1)
const C = { ID: 1, REG: 2, SEDE: 3, FECHA: 4, HORA: 5, TIPO: 6, NOMBRE: 7, CEL: 8, MAIL: 9, ESTADO: 10, NOTAS: 11 };

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
    salida = registrar_(JSON.parse(e.postData.contents));
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
  const p = sh.getRange('B4:B9').getDisplayValues().map(r => r[0]);
  const cfg = {
    dias: Number(p[0]) || 30,
    horasMin: Number(p[1]) || 2,
    maxDia: Number(p[2]) || 20,
    duracion: Number(p[3]) || 30,
    remitente: p[4] || 'Clínica Dr. Rivas',
    copia: (p[5] || '').trim(),
    sedes: {}
  };
  sh.getRange('A13:E15').getDisplayValues().forEach(r => {
    if (!r[0]) return;
    cfg.sedes[r[0]] = { clave: r[0], nombre: r[1], correos: correos_(r[2]), whatsapp: r[3], direccion: r[4], horarios: {} };
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

function correoValido_(c) { return /^[^@\s\[]+@[^@\s]+\.[^@\s]+$/.test(String(c || '')); }
function esc_(s) { return String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])); }

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

/** Citas de UNA sede (lee solo su pestaña). */
function citasDe_(sedeClave) {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(HOJAS[sedeClave]);
  if (!sh) return [];
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  const tz = ss.getSpreadsheetTimeZone();
  const rango = sh.getRange(2, 1, n, 11);
  const vals = rango.getValues();
  const disp = rango.getDisplayValues();
  const out = [];
  vals.forEach((r, i) => {
    if (!(r[C.FECHA - 1] instanceof Date)) return;
    out.push({
      fila: i + 2,
      sede: sedeClave,
      id: String(r[C.ID - 1] || ''),
      fecha: fechaTxt_(r[C.FECHA - 1], tz),
      hora: hhmm_(disp[i][C.HORA - 1]),
      estado: r[C.ESTADO - 1] || 'Pendiente',
      celular: disp[i][C.CEL - 1],
      correo: String(r[C.MAIL - 1] || '').trim(),
      nombre: r[C.NOMBRE - 1],
      tipo: r[C.TIPO - 1]
    });
  });
  return out;
}

function ocupadas_(cfg, sede) {
  const hoy = fechaTxt_(new Date(), TZ);
  const ocupadas = [];
  const porDia = {};
  citasDe_(sede).forEach(c => {
    if (c.estado === 'Cancelada' || c.fecha < hoy) return;
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

  if (!sede || !HOJAS[d.sede]) return { ok: false, error: 'sede' };
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
  const deLaSede = citasDe_(d.sede).filter(c => c.estado !== 'Cancelada');
  if (deLaSede.some(c => c.fecha === fecha && c.hora === hora)) return { ok: false, error: 'hora_ocupada' };
  if (deLaSede.filter(c => c.fecha === fecha).length >= cfg.maxDia) return { ok: false, error: 'dia_lleno' };
  let activas = 0;
  Object.keys(HOJAS).forEach(k => { activas += citasDe_(k).filter(c => c.estado !== 'Cancelada' && c.celular === celular && c.fecha >= hoy).length; });
  if (activas >= MAX_ACTIVAS_POR_CELULAR) return { ok: false, error: 'demasiadas_citas' };

  // --- Fila en la pestaña de la sede
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(HOJAS[d.sede]);
  if (!sh) return { ok: false, error: 'sede' };
  const fila = sh.getLastRow() + 1;
  const id = 'C' + Utilities.formatDate(ahora, TZ, 'yyMMddHHmm') + Math.floor(100 + Math.random() * 900);
  sh.getRange(fila, C.HORA).setNumberFormat('@');
  sh.getRange(fila, C.CEL).setNumberFormat('@');
  // La fecha se guarda a mediodía para que el día no cambie aunque la hoja use otra zona horaria
  sh.getRange(fila, 1, 1, 10).setValues([[id, ahora, sede.nombre, new Date(y, m - 1, dd, 12, 0), hora, tipo, nombre, celular, correo, 'Pendiente']]);

  const cuando = Utilities.formatDate(inicio, TZ, "EEEE d 'de' MMMM 'de' yyyy") + ' a las ' + Utilities.formatDate(inicio, TZ, 'h:mm a');

  // --- Correo corto al paciente: "tu cita quedó guardada"
  if (correo) {
    try {
      MailApp.sendEmail({
        to: correo,
        name: cfg.remitente,
        subject: 'Tu cita quedó guardada · ' + sede.nombre,
        htmlBody:
          '<p>Hola ' + esc_(nombre.split(' ')[0]) + ',</p>' +
          '<p>Tu cita quedó <b>guardada</b>:</p>' +
          '<p><b>' + esc_(cuando) + '</b><br>Sede ' + esc_(sede.nombre) + ' · ' + esc_(sede.direccion) + '<br>Tipo de cita: ' + esc_(tipo) + '</p>' +
          '<p>Si necesitas cambiarla, escríbenos por <a href="https://wa.me/' + sede.whatsapp + '">WhatsApp</a>.</p>' +
          '<p>' + esc_(cfg.remitente) + '</p>'
      });
    } catch (err) { /* si el correo falla, la cita igual queda guardada */ }
  }

  // --- Aviso a la sede (opcional: solo si hay correo configurado)
  if (sede.correos.length) {
    try {
      MailApp.sendEmail({
        to: sede.correos.join(','),
        cc: correoValido_(cfg.copia) ? cfg.copia : '',
        name: cfg.remitente,
        subject: 'Nueva cita · ' + sede.nombre + ' · ' + Utilities.formatDate(inicio, TZ, 'd/MM h:mm a') + ' · ' + nombre,
        htmlBody:
          '<p><b>Nueva cita agendada desde el sitio web</b></p>' +
          '<p>Sede: ' + esc_(sede.nombre) + '<br>Fecha y hora: ' + esc_(cuando) + '<br>Tipo: ' + esc_(tipo) + '<br>Paciente: ' + esc_(nombre) + '<br>Celular: ' + celular + '<br>Correo: ' + esc_(correo || '—') + '</p>' +
          '<p>Estado: Pendiente. Está en la pestaña “' + esc_(HOJAS[d.sede]) + '”.</p>' +
          '<p><a href="' + ss.getUrl() + '">Abrir la hoja de citas</a></p>'
      });
    } catch (err) { /* ignorar */ }
  }
  return { ok: true, id: id };
}

/* ============================== Recordatorio diario ============================== */

/** Se ejecuta todos los días (8 a. m.): recuerda por correo las citas de mañana. */
function enviarRecordatorios() {
  const cfg = leerConfig_();
  const props = PropertiesService.getScriptProperties();
  const clave = fechaTxt_(new Date(Date.now() + 86400000), TZ);
  Object.keys(HOJAS).forEach(k => {
    const sede = cfg.sedes[k];
    if (!sede) return;
    citasDe_(k).forEach(c => {
      if (c.fecha !== clave || !c.id || !correoValido_(c.correo)) return;
      if (c.estado !== 'Pendiente' && c.estado !== 'Confirmada') return;
      if (props.getProperty('rec_' + c.id)) return;
      try {
        MailApp.sendEmail({
          to: c.correo,
          name: cfg.remitente,
          subject: 'Recordatorio: tu cita mañana a las ' + c.hora + ' en ' + sede.nombre,
          htmlBody:
            '<p>Hola ' + esc_(String(c.nombre).split(' ')[0]) + ',</p>' +
            '<p>Te recordamos tu cita de <b>' + esc_(c.tipo) + '</b> <b>mañana a las ' + c.hora + '</b> en la sede <b>' + esc_(sede.nombre) + '</b> (' + esc_(sede.direccion) + ').</p>' +
            '<p>Si no puedes asistir o quieres cambiar la hora, escríbenos por <a href="https://wa.me/' + sede.whatsapp + '">WhatsApp</a>.</p>' +
            '<p>¡Te esperamos!<br>' + esc_(cfg.remitente) + '</p>'
        });
        props.setProperty('rec_' + c.id, '1');
      } catch (err) { /* ignorar */ }
    });
  });
}

/* ============================== Preparar la hoja ============================== */

function armarHojaCitas_(sh) {
  const n = ENCABEZADOS.length;
  if (sh.getMaxColumns() > 12) sh.deleteColumns(13, sh.getMaxColumns() - 12);
  sh.getRange(1, 1, 1, n).setValues([ENCABEZADOS]).setBackground('#0A0A0A').setFontColor('#FFFFFF').setFontWeight('bold').setVerticalAlignment('middle').setWrap(true);
  sh.setRowHeight(1, 32);
  sh.setFrozenRows(1);
  [90, 130, 90, 110, 70, 170, 200, 110, 220, 100, 220].forEach((w, i) => sh.setColumnWidth(i + 1, w));
  sh.getRange('B2:B1000').setNumberFormat('dd/mm/yyyy hh:mm');
  sh.getRange('D2:D1000').setNumberFormat('dd/mm/yyyy');
  sh.getRange('E2:E1000').setNumberFormat('@');
  sh.getRange('H2:H1000').setNumberFormat('@');
  sh.getRange('J2:J1000').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(ESTADOS, true).setAllowInvalid(false).build());
  const colores = [
    ['Pendiente', '#FFF4CC', '#5B4B00'], ['Confirmada', '#DCEBFF', '#12365F'], ['Atendida', '#D3EFD8', '#14532D'],
    ['No asistió', '#E6E6E6', '#6B6B6B'], ['Cancelada', '#F8D7D3', '#8A2F27']
  ];
  const rango = sh.getRange('A2:K1000');
  sh.setConditionalFormatRules(colores.map(c => SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$J2="' + c[0] + '"').setBackground(c[1]).setFontColor(c[2]).setRanges([rango]).build()));
}

/**
 * Crea (si faltan) las pestañas "Citas Yopal", "Citas Aguazul" y "Citas Bogotá" con su formato,
 * y deja la hoja Configuración en su versión sin calendario. Se puede ejecutar varias veces.
 */
function prepararHoja() {
  const ss = SpreadsheetApp.getActive();
  Object.keys(HOJAS).forEach((k, i) => {
    let sh = ss.getSheetByName(HOJAS[k]);
    if (!sh) sh = ss.insertSheet(HOJAS[k], i + 1);
    armarHojaCitas_(sh);
  });

  // Hoja "Citas" antigua (una sola para todas las sedes): se elimina si quedó de la versión anterior
  const vieja = ss.getSheetByName('Citas');
  if (vieja) ss.deleteSheet(vieja);

  // Configuración sin calendario: se quita el parámetro de invitaciones y la columna del calendario
  const cf = ss.getSheetByName(HOJA_CONFIG);
  if (cf) {
    if (/Invitar/i.test(String(cf.getRange('A10').getValue()))) cf.getRange('A10:B10').clearContent().setBackground(null);
    if (/calendario/i.test(String(cf.getRange('E12').getValue()))) cf.deleteColumn(5);   // la dirección pasa a la columna E
    cf.getRange('C12').setValue('Correo(s) de la sede para el aviso de cada cita (opcional; separa varios con coma)');
  }

  // Resumen por sede
  const rs = ss.getSheetByName('Resumen');
  if (rs) {
    Object.keys(HOJAS).forEach((k, i) => {
      ESTADOS.forEach((e, j) => rs.getRange(4 + i, 2 + j).setFormula("=COUNTIF('" + HOJAS[k] + "'!$J$2:$J$1000," + rs.getRange(3, 2 + j).getA1Notation() + ")"));
    });
    const hoy = Object.keys(HOJAS).map(k => "COUNTIFS('" + HOJAS[k] + "'!$D$2:$D$1000,TODAY(),'" + HOJAS[k] + "'!$J$2:$J$1000,\"<>Cancelada\")").join('+');
    const man = Object.keys(HOJAS).map(k => "COUNTIFS('" + HOJAS[k] + "'!$D$2:$D$1000,TODAY()+1,'" + HOJAS[k] + "'!$J$2:$J$1000,\"<>Cancelada\")").join('+');
    rs.getRange('B8').setFormula('=' + hoy);
    rs.getRange('B9').setFormula('=' + man);
  }
}

/* ============================== Instalación (se ejecuta una sola vez) ============================== */

/** Ejecuta esta función una vez: prepara la hoja y activa el recordatorio diario. */
function instalar() {
  MailApp.getRemainingDailyQuota();                 // fuerza el permiso de correo
  ScriptApp.getProjectTriggers().forEach(t => {
    const f = t.getHandlerFunction();
    if (f === 'enviarRecordatorios' || f === 'alEditar_') ScriptApp.deleteTrigger(t);   // limpia lo de versiones anteriores
  });
  ScriptApp.newTrigger('enviarRecordatorios').timeBased().atHour(8).everyDays(1).inTimezone(TZ).create();
  prepararHoja();
  console.log('Listo: pestañas por sede preparadas y recordatorio diario (8 a. m.) activo.');
}
