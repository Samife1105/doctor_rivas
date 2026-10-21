/**
 * AGENDA DR. RIVAS — Google Apps Script (v6, apartados temporales e idempotencia)
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
    if (accion === 'reservar') return json_({ ok: false, error: 'metodo' });
    if (accion === 'horas') {
      const sede = e.parameter.sede;
      if (!cfg.sedes[sede]) return json_({ ok: false, error: 'sede' });
      return json_(ocupadas_(cfg, sede));
    }
    return json_({ ok: true, servicio: 'Agenda Dr. Rivas' });
  } catch (err) {
    return json_({ ok: false, error: 'servidor', detalle: 'No fue posible completar la operación.' });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  let salida;
  try {
    lock.waitLock(25000);
    const contents = e && e.postData && e.postData.contents;
    if (!contents || contents.length > 4096) return json_({ ok: false, error: 'invalido' });
    const datos = JSON.parse(contents);
    salida = datos && ['apartar', 'extender', 'liberar'].indexOf(datos.accion) >= 0 ? gestionarApartado_(datos) : registrar_(datos);
  } catch (err) {
    salida = { ok: false, error: 'servidor', detalle: 'No fue posible completar la operación.' };
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
    horasMin: p[1] === '' ? 2 : Number(p[1]),
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
  if (!Number.isInteger(cfg.dias) || cfg.dias < 1 || cfg.dias > 365 || !Number.isFinite(cfg.horasMin) || cfg.horasMin < 0 || !Number.isInteger(cfg.maxDia) || cfg.maxDia < 1 || !Number.isInteger(cfg.duracion) || cfg.duracion < 5 || cfg.duracion > 240) throw new Error('Configuración de agenda inválida');
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
  return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? ('0' + m[1]).slice(-2) + ':' + m[2] : '';
}

function franjas_(desde, hasta, dur) {
  const aMin = t => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const out = [];
  if (!Number.isInteger(dur) || dur < 5 || dur > 240) throw new Error('Duración inválida');
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
  return { ok: true, apiVersion: 3, apartados: { segundos: 300, ampliaciones: 10 }, ahora: Date.now(), zona: TZ, dias: cfg.dias, horasMin: cfg.horasMin, maxDia: cfg.maxDia, duracion: cfg.duracion, sedes: sedes };
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
      correo: textoOriginal_(r[C.MAIL - 1]).trim(),
      nombre: textoOriginal_(r[C.NOMBRE - 1]),
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
  apartadosActivos_().filter(a => a.sede === sede).forEach(a => {
    ocupadas.push(a.fecha + '|' + a.hora);
    porDia[a.fecha] = (porDia[a.fecha] || 0) + 1;
  });
  const llenos = Object.keys(porDia).filter(f => porDia[f] >= cfg.maxDia);
  return { ok: true, ocupadas: ocupadas, llenos: llenos };
}

/* Apartados durables, sin datos del paciente. Toda mutación pasa por ScriptLock.
 * No usar CacheService para exclusión: Google puede desalojar su contenido antes del TTL.
 * Secretos aleatorios de 32 caracteres hexadecimales; nunca se publican ni viajan en URL.
 */
const APARTADO_PREFIJO = 'apartado_v1_';
function apartadosActivos_() {
  const props = PropertiesService.getScriptProperties().getProperties();
  return Object.keys(props).filter(k => k.indexOf(APARTADO_PREFIJO) === 0).map(k => {
    try { return JSON.parse(props[k]); } catch (_) { return null; }
  }).filter(a => a && a.vence > Date.now());
}
function validarFranja_(cfg, d) {
  if (!cfg.sedes[d.sede] || !HOJAS[d.sede]) return 'sede';
  if (typeof d.fecha !== 'string' || typeof d.hora !== 'string' || !/^\d{8}$/.test(d.fecha) || !/^\d{2}:\d{2}$/.test(d.hora)) return 'fecha';
  let inicio;
  try { inicio = Utilities.parseDate(d.fecha + ' ' + d.hora, TZ, 'yyyyMMdd HH:mm'); } catch (_) { return 'fecha'; }
  if (Utilities.formatDate(inicio, TZ, 'yyyyMMdd HH:mm') !== d.fecha + ' ' + d.hora) return 'fecha';
  const ultimo = Utilities.parseDate(fechaTxt_(new Date(), TZ) + ' 12:00', TZ, 'yyyyMMdd HH:mm');
  ultimo.setUTCDate(ultimo.getUTCDate() + cfg.dias);
  if (d.fecha > fechaTxt_(ultimo, TZ) || inicio.getTime() <= Date.now() + cfg.horasMin * 3600000) return 'fuera_de_rango';
  const dia = new Date(Date.UTC(+d.fecha.slice(0, 4), +d.fecha.slice(4, 6) - 1, +d.fecha.slice(6, 8))).getUTCDay();
  return (cfg.sedes[d.sede].horarios[dia] || []).indexOf(d.hora) < 0 ? 'horario' : '';
}
function gestionarApartado_(d) {
  if (typeof d.sesion !== 'string' || !/^[a-f0-9]{32}$/.test(d.sesion) || d.hp) return { ok: false, error: 'invalido' };
  const props = PropertiesService.getScriptProperties(), clave = APARTADO_PREFIJO + d.sesion;
  const todos = props.getProperties();
  // Limpieza acotada a metadatos técnicos vencidos; nunca toca citas ni pacientes.
  Object.keys(todos).filter(k => k.indexOf(APARTADO_PREFIJO) === 0).forEach(k => {
    try { if (JSON.parse(todos[k]).vence <= Date.now()) props.deleteProperty(k); } catch (_) { props.deleteProperty(k); }
  });
  const anterior = props.getProperty(clave), propio = anterior ? JSON.parse(anterior) : null;
  const salida = a => ({ ok: true, token: a.token, vence: a.vence, ampliaciones: a.ampliaciones, puedeAmpliar: a.ampliaciones < 10 && a.vence < (a.limite || Infinity), ahora: Date.now() });
  if (d.accion !== 'apartar') {
    if (d.accion === 'liberar' && !propio) return { ok: true, liberado: true };
    if (!propio || propio.token !== d.token) return { ok: false, error: 'apartado_vencido' };
    if (d.accion === 'liberar') { props.deleteProperty(clave); return { ok: true, liberado: true }; }
    if (!/^[a-f0-9]{32}$/.test(d.operacion || '')) return { ok: false, error: 'operacion' };
    if (propio.ultimaAmpliacion === d.operacion) return salida(propio);
    if (propio.ampliaciones >= 10) return { ok: false, error: 'ampliaciones' };
    const nuevoVencimiento = Math.min(propio.vence + 300000, propio.limite || Infinity);
    if (nuevoVencimiento <= propio.vence) return { ok: false, error: 'fuera_de_rango' };
    propio.vence = nuevoVencimiento; propio.ampliaciones++;
    propio.ultimaAmpliacion = d.operacion;
    props.setProperty(clave, JSON.stringify(propio)); return salida(propio);
  }
  const cfg = leerConfig_(), error = validarFranja_(cfg, d);
  if (error) return { ok: false, error: error };
  if (propio && propio.sede === d.sede && propio.fecha === d.fecha && propio.hora === d.hora) return salida(propio);
  const otros = apartadosActivos_().filter(a => a.sesion !== d.sesion);
  const citas = citasDe_(d.sede).filter(c => c.estado !== 'Cancelada' && c.fecha === d.fecha);
  if (citas.some(c => c.hora === d.hora) || otros.some(a => a.sede === d.sede && a.fecha === d.fecha && a.hora === d.hora)) return { ok: false, error: 'hora_ocupada' };
  if (citas.length + otros.filter(a => a.sede === d.sede && a.fecha === d.fecha).length >= cfg.maxDia) return { ok: false, error: 'dia_lleno' };
  if (otros.length >= 150) return { ok: false, error: 'limite' };
  const cache = CacheService.getScriptCache(), rateKey = 'apartados_' + d.sesion;
  const intentos = Number(cache.get(rateKey) || 0);
  if (intentos >= 30) return { ok: false, error: 'limite' };
  cache.put(rateKey, String(intentos + 1), 600);
  const limite = Utilities.parseDate(d.fecha + ' ' + d.hora, TZ, 'yyyyMMdd HH:mm').getTime() - cfg.horasMin * 3600000;
  // No prometer un apartado que sobrepase el cierre de reservas de esa franja.
  if (limite - Date.now() < 60000) return { ok: false, error: 'fuera_de_rango' };
  const nuevo = { sesion: d.sesion, token: Utilities.getUuid().replace(/-/g, ''), sede: d.sede, fecha: d.fecha, hora: d.hora, vence: Math.min(Date.now() + 300000, limite), limite: limite, ampliaciones: 0 };
  props.setProperty(clave, JSON.stringify(nuevo)); return salida(nuevo);
}

/* ============================== Correos en formato tarjeta ============================== */

const MESES_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS_ES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

function hora12_(hhmm) {
  const h = Number(hhmm.slice(0, 2)), m = hhmm.slice(3, 5);
  return (((h + 11) % 12) + 1) + ':' + m + ' ' + (h < 12 ? 'a. m.' : 'p. m.');
}
function fechaLarga_(y, m, d) {
  return DIAS_ES[new Date(y, m - 1, d, 12).getDay()] + ' ' + d + ' de ' + MESES_ES[m - 1] + ' de ' + y;
}
function mapsUrl_(sede) {
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent('Dr. Rivas ' + sede.nombre + ' ' + sede.direccion);
}

/**
 * Tarjeta de correo (HTML con tablas y estilos en línea, compatible con Gmail, Outlook y celulares).
 * o = { kicker, saludo, titulo, y, m, d, hora, filas:[[etiqueta, valorHTML]], botones:[{txt,url,oscuro}], pie, id }
 */
function tarjeta_(o) {
  const INK = '#0b0c0c', PAPER = '#e1e5e2', CARD = '#f8f9f7', LINE = '#d2d8d4', MUTE = '#5c6763', ACC = '#2f6b63', ON = '#f4f6f4';
  const SANS = "Arial,Helvetica,sans-serif", SERIF = "Georgia,'Times New Roman',serif";
  const filas = (o.filas || []).map(f =>
    '<tr><td style="padding:10px 0;border-bottom:1px solid #dde2df;font:600 11px ' + SANS + ';letter-spacing:1.4px;text-transform:uppercase;color:' + MUTE + ';width:34%;vertical-align:top">' + esc_(f[0]) + '</td>' +
    '<td style="padding:10px 0 10px 12px;border-bottom:1px solid #dde2df;font:600 15px/1.4 ' + SANS + ';color:' + INK + '">' + f[1] + '</td></tr>').join('');
  const botones = (o.botones || []).map(b =>
    '<a href="' + b.url + '" style="display:inline-block;margin:0 8px 10px 0;padding:13px 24px;border-radius:999px;font:700 14px ' + SANS + ';text-decoration:none;' +
    (b.oscuro ? 'background:' + INK + ';color:' + ON + ';border:2px solid ' + INK : 'background:transparent;color:' + INK + ';border:2px solid ' + INK) + '">' + esc_(b.txt) + '</a>').join('');
  const fechaBloque =
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:6px 0 20px"><tr>' +
    '<td style="font:400 74px/1 ' + SERIF + ';color:' + INK + ';padding:0 16px 0 0;white-space:nowrap">' + (o.d < 10 ? '0' + o.d : o.d) + '</td>' +
    '<td style="padding:0 18px 0 0;vertical-align:middle"><div style="font:700 17px ' + SANS + ';color:' + INK + ';text-transform:capitalize">' + MESES_ES[o.m - 1] + ' ' + o.y + '</div>' +
    '<div style="font:400 14px ' + SANS + ';color:' + MUTE + ';text-transform:capitalize;margin-top:3px">' + DIAS_ES[new Date(o.y, o.m - 1, o.d, 12).getDay()] + '</div></td>' +
    '<td align="right" style="vertical-align:middle"><span style="display:inline-block;background:' + INK + ';color:' + ON + ';font:700 18px ' + SANS + ';padding:12px 18px;border-radius:14px;white-space:nowrap">' + esc_(hora12_(o.hora)) + '</span></td>' +
    '</tr></table>';
  return '' +
    '<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">' + esc_(o.titulo) + ' · ' + esc_(fechaLarga_(o.y, o.m, o.d)) + ' · ' + esc_(hora12_(o.hora)) + '</div>' +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="' + PAPER + '" style="background:' + PAPER + '"><tr><td align="center" style="padding:28px 12px">' +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="width:100%;max-width:560px;background:' + CARD + ';border:1px solid ' + LINE + ';border-radius:22px;overflow:hidden">' +
    // encabezado
    '<tr><td bgcolor="' + INK + '" style="background:' + INK + ';padding:22px 28px">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
    '<td style="font:400 28px ' + SERIF + ';color:' + ON + '">Dr. Rivas<div style="font:600 10px ' + SANS + ';letter-spacing:3px;color:#aeb6b2;margin-top:4px;text-transform:uppercase">Odontología &amp; Estética</div></td>' +
    '<td align="right" style="vertical-align:middle"><span style="display:inline-block;border:1px solid #4d5553;color:' + ON + ';font:700 10px ' + SANS + ';letter-spacing:2px;text-transform:uppercase;padding:7px 14px;border-radius:999px">' + esc_(o.kicker) + '</span></td>' +
    '</tr></table></td></tr>' +
    // cuerpo
    '<tr><td style="padding:30px 28px 8px">' +
    (o.saludo ? '<div style="font:600 12px ' + SANS + ';letter-spacing:2px;text-transform:uppercase;color:' + ACC + ';margin-bottom:8px">' + esc_(o.saludo) + '</div>' : '') +
    '<div style="font:400 32px/1.15 ' + SERIF + ';color:' + INK + ';margin-bottom:22px">' + esc_(o.titulo) + '</div>' +
    fechaBloque +
    '</td></tr>' +
    // perforación tipo ticket
    '<tr><td style="padding:0 28px"><div style="border-top:2px dashed #cfc8b9;height:0;line-height:0;font-size:0">&nbsp;</div></td></tr>' +
    '<tr><td style="padding:10px 28px 6px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' + filas + '</table></td></tr>' +
    '<tr><td style="padding:22px 28px 6px">' + botones + '</td></tr>' +
    '<tr><td style="padding:10px 28px 26px;font:400 13px/1.55 ' + SANS + ';color:' + MUTE + '">' + (o.pie || '') + (o.id ? '<div style="margin-top:10px;font-size:11px;letter-spacing:1.2px;color:#818a86">CITA ' + esc_(o.id) + '</div>' : '') + '</td></tr>' +
    '</table></td></tr></table>';
}

function datosFecha_(fecha) {   // 'yyyyMMdd' -> {y, m, d}
  return { y: Number(fecha.slice(0, 4)), m: Number(fecha.slice(4, 6)), d: Number(fecha.slice(6, 8)) };
}

/* ============================== Registrar una cita ============================== */

function textoSeguro_(valor) { return /^[=+\-@\t\r]/.test(String(valor)) ? "'" + valor : String(valor); }
function textoOriginal_(valor) { return String(valor || '').replace(/^'(?=[=+\-@\t\r])/, ''); }

function registrar_(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return { ok: false, error: 'invalido' };
  if (d.hp) return { ok: false, error: 'invalido' };           // campo trampa anti-spam
  const cfg = leerConfig_();
  const sede = cfg.sedes[d.sede];
  const nombre = String(d.nombre || '').trim();
  const celular = String(d.celular || '').replace(/\D/g, '').replace(/^57(?=3\d{9}$)/, '');
  const correo = String(d.correo || '').trim().toLowerCase();
  const tipo = String(d.tipo || '');
  const fecha = String(d.fecha || '');
  const hora = String(d.hora || '');
  const operacion = String(d.operacion || '');
  if (!/^[a-f0-9]{32}$/.test(operacion)) return { ok: false, error: 'operacion' };

  if (!sede || !HOJAS[d.sede]) return { ok: false, error: 'sede' };
  if (nombre.length < 3 || nombre.length > 80) return { ok: false, error: 'nombre' };
  if (!/^3\d{9}$/.test(celular)) return { ok: false, error: 'celular' };
  if (correo.length > 254 || /\.\./.test(correo)) return { ok: false, error: 'correo' };
  if (correo && !/^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(correo)) return { ok: false, error: 'correo' };
  if (TIPOS.indexOf(tipo) < 0) return { ok: false, error: 'tipo' };
  if (!/^\d{8}$/.test(fecha) || !/^\d{2}:\d{2}$/.test(hora)) return { ok: false, error: 'fecha' };

  // La operación identifica una fila durable. Recuperar antes de revisar vencimientos.
  const id = 'C-' + operacion;
  const todas = {};
  Object.keys(HOJAS).forEach(k => { todas[k] = citasDe_(k); });
  const previa = Object.keys(todas).flatMap(k => todas[k]).find(c => c.id === id);
  if (previa) {
    if (previa.sede !== d.sede || previa.celular !== celular || previa.fecha !== fecha || previa.hora !== hora || previa.tipo !== tipo || previa.correo !== correo || textoOriginal_(previa.nombre) !== nombre) return { ok: false, error: 'operacion_conflicto' };
    if (previa.estado === 'Cancelada') return { ok: false, error: 'operacion_conflicto' };
    return { ok: true, id: id, recuperada: true, correo: 'no_comprobado' };
  }
  const y = Number(fecha.slice(0, 4)), m = Number(fecha.slice(4, 6)), dd = Number(fecha.slice(6, 8));
  let inicio;
  try { inicio = Utilities.parseDate(fecha + ' ' + hora, TZ, 'yyyyMMdd HH:mm'); }
  catch (_) { return { ok: false, error: 'fecha' }; }
  if (Utilities.formatDate(inicio, TZ, 'yyyyMMdd HH:mm') !== fecha + ' ' + hora) return { ok: false, error: 'fecha' };
  const ahora = new Date();
  const hoy = fechaTxt_(ahora, TZ);
  // Ventana inclusiva hasta el final del día hoy + dias, igual que el calendario.
  const ultimo = Utilities.parseDate(hoy + ' 12:00', TZ, 'yyyyMMdd HH:mm');
  ultimo.setUTCDate(ultimo.getUTCDate() + cfg.dias);
  if (fecha > fechaTxt_(ultimo, TZ) || inicio.getTime() <= ahora.getTime() + cfg.horasMin * 3600000) return { ok: false, error: 'fuera_de_rango' };
  const dia = new Date(Date.UTC(y, m - 1, dd)).getUTCDay();
  const franjasDia = sede.horarios[dia] || [];
  if (franjasDia.indexOf(hora) < 0) return { ok: false, error: 'horario' };
  const propiedad = /^[a-f0-9]{32}$/.test(d.sesion || '') ? APARTADO_PREFIJO + d.sesion : '';
  const rawApartado = propiedad && PropertiesService.getScriptProperties().getProperty(propiedad);
  const apartado = rawApartado ? JSON.parse(rawApartado) : null;
  if (!apartado || apartado.vence <= Date.now() || apartado.token !== d.token || apartado.sede !== d.sede || apartado.fecha !== fecha || apartado.hora !== hora) return { ok: false, error: 'apartado_vencido' };
  // Se ejecuta bajo ScriptLock. No sustituye controles de abuso en el alojamiento.
  const cache = CacheService.getScriptCache(), rateKey = 'intentos_' + celular;
  const intentos = Number(cache.get(rateKey) || 0);
  if (intentos >= 6) return { ok: false, error: 'limite' };
  cache.put(rateKey, String(intentos + 1), 300);
  const deLaSede = todas[d.sede].filter(c => c.estado !== 'Cancelada');
  if (deLaSede.some(c => c.fecha === fecha && c.hora === hora)) return { ok: false, error: 'hora_ocupada' };
  if (deLaSede.filter(c => c.fecha === fecha).length >= cfg.maxDia) return { ok: false, error: 'dia_lleno' };
  let activas = 0;
  Object.keys(HOJAS).forEach(k => { activas += todas[k].filter(c => c.estado !== 'Cancelada' && c.celular === celular && c.fecha >= hoy).length; });
  if (activas >= MAX_ACTIVAS_POR_CELULAR) return { ok: false, error: 'demasiadas_citas' };

  // --- Fila en la pestaña de la sede
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(HOJAS[d.sede]);
  if (!sh) return { ok: false, error: 'sede' };
  const fila = sh.getLastRow() + 1;
  if (fila > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 100);
  sh.getRange(fila, C.HORA).setNumberFormat('@');
  sh.getRange(fila, C.CEL).setNumberFormat('@');
  sh.getRange(fila, C.NOMBRE).setNumberFormat('@');
  sh.getRange(fila, C.MAIL).setNumberFormat('@');
  // La fecha se guarda a mediodía para que el día no cambie aunque la hoja use otra zona horaria
  sh.getRange(fila, 1, 1, 10).setValues([[id, ahora, sede.nombre, Utilities.parseDate(fecha + ' 12:00', TZ, 'yyyyMMdd HH:mm'), hora, tipo, textoSeguro_(nombre), celular, textoSeguro_(correo), 'Pendiente']]);
  // Confirmar escritura antes de liberar. Un reintento recupera por ID, aun sin apartado.
  SpreadsheetApp.flush();
  PropertiesService.getScriptProperties().deleteProperty(propiedad);

  const f = { y: y, m: m, d: dd };
  const cuando = fechaLarga_(y, m, dd) + ' a las ' + hora12_(hora);
  const wa = 'https://wa.me/' + sede.whatsapp;

  let estadoCorreo = correo ? 'fallido' : 'no_solicitado';
  // --- Correo al paciente: tarjeta "tu cita quedó guardada"
  if (correo) {
    try {
      MailApp.sendEmail({
        to: correo,
        name: cfg.remitente,
        subject: 'Tu cita quedó guardada · ' + sede.nombre + ' · ' + dd + ' de ' + MESES_ES[m - 1],
        htmlBody: tarjeta_({
          kicker: 'Cita guardada', saludo: 'Hola ' + nombre.split(' ')[0], titulo: 'Tu cita quedó guardada',
          y: y, m: m, d: dd, hora: hora, id: id,
          filas: [['Sede', esc_(sede.nombre)], ['Dirección', esc_(sede.direccion)], ['Tipo de cita', esc_(tipo)], ['Paciente', esc_(nombre)]],
          botones: [{ txt: 'Avisar por WhatsApp', url: wa + '?text=' + encodeURIComponent('Hola, tengo una cita el ' + cuando + ' en la sede ' + sede.nombre + '.'), oscuro: true },
                    { txt: 'Cómo llegar', url: mapsUrl_(sede) }],
          pie: 'Si necesitas cambiar o cancelar tu cita, escríbenos por WhatsApp. ¡Te esperamos!'
        })
      });
      estadoCorreo = 'enviado';
    } catch (err) { console.warn('Fallo correo paciente, cita ' + id); }
  }

  // --- Aviso a la sede (opcional: solo si hay correo configurado): tarjeta "nueva cita"
  if (sede.correos.length) {
    try {
      MailApp.sendEmail({
        to: sede.correos.join(','),
        cc: correoValido_(cfg.copia) ? cfg.copia : '',
        name: cfg.remitente,
        subject: 'Nueva cita · ' + sede.nombre + ' · ' + dd + '/' + (m < 10 ? '0' + m : m) + ' ' + hora12_(hora) + ' · ' + nombre,
        htmlBody: tarjeta_({
          kicker: 'Nueva cita', saludo: sede.nombre, titulo: 'Nueva cita agendada',
          y: y, m: m, d: dd, hora: hora, id: id,
          filas: [['Paciente', esc_(nombre)], ['Celular', '<a href="https://wa.me/57' + celular + '" style="color:#0b0c0c">' + celular + '</a>'], ['Correo', esc_(correo || '—')],
                  ['Tipo de cita', esc_(tipo)], ['Estado', 'Pendiente'], ['Pestaña', esc_(HOJAS[d.sede])]],
          botones: [{ txt: 'Escribir al paciente', url: 'https://wa.me/57' + celular, oscuro: true }, { txt: 'Abrir la hoja', url: ss.getUrl() }],
          pie: 'Cuando la confirmes, cambia el estado en la hoja. Si pones “Cancelada”, la hora queda libre.'
        })
      });
    } catch (err) { console.warn('Fallo aviso sede, cita ' + id); }
  }
  return { ok: true, id: id, correo: estadoCorreo };
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
        const f = datosFecha_(c.fecha);
        MailApp.sendEmail({
          to: c.correo,
          name: cfg.remitente,
          subject: 'Recordatorio: tu cita mañana a las ' + hora12_(c.hora) + ' en ' + sede.nombre,
          htmlBody: tarjeta_({
            kicker: 'Recordatorio', saludo: 'Hola ' + String(c.nombre).split(' ')[0], titulo: 'Tu cita es mañana',
            y: f.y, m: f.m, d: f.d, hora: c.hora, id: c.id,
            filas: [['Sede', esc_(sede.nombre)], ['Dirección', esc_(sede.direccion)], ['Tipo de cita', esc_(c.tipo)]],
            botones: [{ txt: 'Cambiar por WhatsApp', url: 'https://wa.me/' + sede.whatsapp, oscuro: true }, { txt: 'Cómo llegar', url: mapsUrl_(sede) }],
            pie: 'Si no puedes asistir, avísanos por WhatsApp para liberar la hora. ¡Te esperamos!'
          })
        });
        props.setProperty('rec_' + c.id, '1');
      } catch (err) { /* ignorar */ }
    });
  });
}

/* ============================== Preparar la hoja ============================== */

function armarHojaCitas_(sh) {
  const n = ENCABEZADOS.length;
  // Conservar columnas adicionales que pueda usar la recepción.
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
  // Se conserva la pestaña antigua para no eliminar citas históricas.

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

/** Envía tres correos de muestra (paciente, sede y recordatorio) a la dirección "copia interna" de Configuración. */
function probarCorreos() {
  const cfg = leerConfig_();
  const destino = cfg.copia;
  if (!correoValido_(destino)) { console.log('Escribe un correo en Configuración > "Correo interno que recibe copia" y vuelve a ejecutar.'); return; }
  const sede = cfg.sedes.yopal;
  const hoy = new Date(Date.now() + 2 * 86400000);
  const base = { y: hoy.getFullYear(), m: hoy.getMonth() + 1, d: hoy.getDate(), hora: '10:30', id: 'C-EJEMPLO' };
  const filas = [['Sede', esc_(sede.nombre)], ['Dirección', esc_(sede.direccion)], ['Tipo de cita', 'Diseño de sonrisa'], ['Paciente', 'Laura Gómez']];
  const wa = 'https://wa.me/' + sede.whatsapp;
  MailApp.sendEmail({ to: destino, name: cfg.remitente, subject: '[Muestra 1/3] Tu cita quedó guardada', htmlBody: tarjeta_(Object.assign({}, base, {
    kicker: 'Cita guardada', saludo: 'Hola Laura', titulo: 'Tu cita quedó guardada', filas: filas,
    botones: [{ txt: 'Avisar por WhatsApp', url: wa, oscuro: true }, { txt: 'Cómo llegar', url: mapsUrl_(sede) }],
    pie: 'Si necesitas cambiar o cancelar tu cita, escríbenos por WhatsApp. ¡Te esperamos!' })) });
  MailApp.sendEmail({ to: destino, name: cfg.remitente, subject: '[Muestra 2/3] Nueva cita · ' + sede.nombre, htmlBody: tarjeta_(Object.assign({}, base, {
    kicker: 'Nueva cita', saludo: sede.nombre, titulo: 'Nueva cita agendada',
    filas: [['Paciente', 'Laura Gómez'], ['Celular', '3001234567'], ['Correo', 'laura@correo.com'], ['Tipo de cita', 'Diseño de sonrisa'], ['Estado', 'Pendiente'], ['Pestaña', 'Citas Yopal']],
    botones: [{ txt: 'Escribir al paciente', url: 'https://wa.me/573001234567', oscuro: true }, { txt: 'Abrir la hoja', url: SpreadsheetApp.getActive().getUrl() }],
    pie: 'Cuando la confirmes, cambia el estado en la hoja. Si pones “Cancelada”, la hora queda libre.' })) });
  MailApp.sendEmail({ to: destino, name: cfg.remitente, subject: '[Muestra 3/3] Recordatorio de tu cita', htmlBody: tarjeta_(Object.assign({}, base, {
    kicker: 'Recordatorio', saludo: 'Hola Laura', titulo: 'Tu cita es mañana', filas: filas.slice(0, 3),
    botones: [{ txt: 'Cambiar por WhatsApp', url: wa, oscuro: true }, { txt: 'Cómo llegar', url: mapsUrl_(sede) }],
    pie: 'Si no puedes asistir, avísanos por WhatsApp para liberar la hora. ¡Te esperamos!' })) });
  console.log('Enviados 3 correos de muestra a ' + destino);
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
