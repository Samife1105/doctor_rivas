import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../agenda-backend/Code.gs', import.meta.url), 'utf8');
function setup() {
  const rows = [], existing = [], cache = new Map(), props = new Map(); let mailFails = false;
  class Clock extends Date { constructor(...a) { super(...(a.length ? a : ['2026-10-20T17:00:00Z'])); } static now() { return Date.parse('2026-10-20T17:00:00Z'); } }
  const utils = { getUuid: () => '12345678-1234-4234-8234-123456789abc',
    parseDate: (value) => { const [date, hour] = value.split(' '); const [h, m] = hour.split(':').map(Number); return new Date(Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6, 8), h + 5, m)); },
    formatDate: (date, tz, format) => { const s = new Date(date.getTime() - 5 * 3600000).toISOString(); const key = s.slice(0, 10).replaceAll('-', ''); return format === 'yyyyMMdd' ? key : key + ' ' + s.slice(11, 16); }
  };
  const context = { console, Date: Clock, Utilities: utils, CacheService: { getScriptCache: () => ({ get: k => cache.get(k), put: (k, v) => cache.set(k, v) }) },
    PropertiesService: { getScriptProperties: () => ({ getProperties: () => Object.fromEntries(props), getProperty: k => props.get(k), setProperty: (k,v) => props.set(k,v), deleteProperty: k => props.delete(k) }) },
    SpreadsheetApp: { flush() {}, getActive: () => ({ getSheetByName: () => ({ getLastRow: () => 1 + rows.length, getMaxRows: () => 1000, getRange: () => ({ setNumberFormat() {}, setValues: v => rows.push(v[0]) }) }), getUrl: () => '' }) },
    MailApp: { sendEmail() { if (mailFails) throw new Error('quota'); } }, readAppointments: s => existing.filter(c => c.sede === s) };
  vm.createContext(context); vm.runInContext(source, context);
  vm.runInContext(`leerConfig_=()=>({dias:30,horasMin:2,maxDia:20,sedes:{yopal:{nombre:'Yopal',correos:[],horarios:Object.fromEntries(Array.from({length:7},(_,i)=>[i,['08:00','08:30','09:00']]))}}}); citasDe_=readAppointments;`, context);
  const p = { sede: 'yopal', nombre: 'Paciente QA', celular: '3000000000', correo: '', tipo: 'Valoración inicial', fecha: '20261022', hora: '08:00', hp: '', sesion: 'b'.repeat(32), token: 'c'.repeat(32), operacion: 'a'.repeat(32) };
  props.set('apartado_v1_' + p.sesion, JSON.stringify({ ...p, vence: Clock.now() + 300000, ampliaciones: 0 }));
  const record = (overrides = {}) => ({ id: 'C-' + p.operacion, sede: p.sede, nombre: p.nombre, celular: p.celular, correo: p.correo, tipo: p.tipo, fecha: p.fecha, hora: p.hora, estado: 'Pendiente', ...overrides });
  return { c: context, rows, existing, cache, props, p, record, failMail: () => { mailFails = true; } };
}
test('Nueva reserva: una fila e ID durable de operación', () => { const f = setup(); const r = f.c.registrar_(f.p); assert.equal(r.ok, true); assert.equal(r.id, f.record().id); assert.equal(f.rows.length, 1); });
test('Respuesta perdida: misma operación devuelve ID sin escribir ni reenviar', () => { const f = setup(); f.existing.push(f.record()); const r = f.c.registrar_(f.p); assert.equal(r.ok, true); assert.equal(r.recuperada, true); assert.equal(f.rows.length, 0); });
test('Operación ajena/cancelada no produce éxito', () => { for (const change of [{ celular: '3111111111' }, { estado: 'Cancelada' }, { nombre: 'Otra persona' }]) { const f = setup(); f.existing.push(f.record(change)); assert.equal(f.c.registrar_(f.p).error, 'operacion_conflicto'); } });
test('Hora ocupada por otra operación permanece conflicto', () => { const f = setup(); f.existing.push(f.record({ id: 'legacy' })); assert.equal(f.c.registrar_(f.p).error, 'hora_ocupada'); });
test('Cancelación libera hora para una operación nueva', () => { const f = setup(); f.existing.push(f.record({ id: 'legacy', estado: 'Cancelada' })); assert.equal(f.c.registrar_(f.p).ok, true); });
test('Fecha imposible y hora fuera de rango son rechazadas', () => { const f = setup(); for (const change of [{ fecha: '20261131' }, { hora: '25:00' }]) assert.equal(f.c.registrar_({ ...f.p, ...change }).error, 'fecha'); assert.equal(f.rows.length, 0); });
test('Ventana inclusiva hoy+30 coincide con calendario', () => { const f = setup(); f.props.set('apartado_v1_' + f.p.sesion, JSON.stringify({ ...f.p, fecha: '20261119', vence: Date.parse('2026-10-20T17:05:00Z') })); assert.equal(f.c.registrar_({ ...f.p, fecha: '20261119' }).ok, true); assert.equal(f.c.registrar_({ ...f.p, fecha: '20261120' }).error, 'fuera_de_rango'); });
test('Límites por día y celular continúan vigentes', () => { const f = setup(); f.existing.push(...Array.from({ length: 20 }, (_, i) => f.record({ id: 'legacy' + i, hora: '10:' + i }))); assert.equal(f.c.registrar_(f.p).error, 'dia_lleno'); const g = setup(); g.existing.push(...Array.from({ length: 3 }, (_, i) => g.record({ id: 'legacy' + i, fecha: '20261023' }))); assert.equal(g.c.registrar_(g.p).error, 'demasiadas_citas'); });
test('Se limita frecuencia pero la recuperación idempotente no se bloquea', () => { const f = setup(); f.cache.set('intentos_' + f.p.celular, '6'); assert.equal(f.c.registrar_(f.p).error, 'limite'); f.existing.push(f.record()); assert.equal(f.c.registrar_(f.p).recuperada, true); });
test('Nombre tipo fórmula se guarda como texto y recupera sin diferencias', () => { const f = setup(); const p = { ...f.p, nombre: '=1+1' }; assert.equal(f.c.registrar_(p).ok, true); assert.equal(f.rows[0][6], "'=1+1"); f.existing.push(f.record({ nombre: "'=1+1" })); assert.equal(f.c.registrar_(p).recuperada, true); });
test('Fallo de correo informa estado sin invalidar cita registrada', () => { const f = setup(); f.failMail(); const r = f.c.registrar_({ ...f.p, correo: 'qa@example.com' }); assert.equal(r.ok, true); assert.equal(r.correo, 'fallido'); });
test('Validaciones de entrada, honeypot, operación y duración', () => { const f = setup(); for (const [changes, error] of [[{ nombre: 'a'.repeat(81) }, 'nombre'], [{ celular: '123' }, 'celular'], [{ correo: 'a..b@example.com' }, 'correo'], [{ hp: 'bot' }, 'invalido'], [{ operacion: '' }, 'operacion']]) assert.equal(f.c.registrar_({ ...f.p, ...changes }).error, error); assert.throws(() => f.c.franjas_('08:00', '18:00', -1)); assert.equal(f.c.hhmm_('29:70'), ''); });

test('Dos sesiones compiten: solo una obtiene el mismo horario', () => {
  const f = setup(), d = { ...f.p, accion: 'apartar' }; f.props.clear();
  const primero = f.c.gestionarApartado_(d); assert.equal(primero.ok, true);
  assert.equal(f.c.gestionarApartado_({ ...d, sesion: 'd'.repeat(32) }).error, 'hora_ocupada');
  assert.equal(f.rows.length, 0);
  assert.equal(f.c.gestionarApartado_(d).token, primero.token);
  assert.equal(f.c.gestionarApartado_(d).vence, primero.vence);
});

test('Una sesión solo mantiene un apartado y cambiar libera el anterior', () => {
  const f = setup(); assert.equal(f.c.gestionarApartado_({ ...f.p, accion: 'apartar', hora: '08:30' }).ok, true);
  assert.equal(f.c.apartadosActivos_().length, 1);
  assert.equal(f.c.gestionarApartado_({ ...f.p, accion: 'apartar', sesion: 'd'.repeat(32) }).ok, true);
});

test('Apartado vencido libera sin tarea programada y rechaza confirmación', () => {
  const f = setup(); const key = 'apartado_v1_' + f.p.sesion;
  f.props.set(key, JSON.stringify({ ...f.p, vence: 1 }));
  assert.equal(f.c.registrar_(f.p).error, 'apartado_vencido');
  assert.equal(f.c.apartadosActivos_().length, 0);
  assert.equal(f.c.gestionarApartado_({ ...f.p, accion: 'apartar', sesion: 'd'.repeat(32) }).ok, true);
  assert.equal(f.props.has(key), false);
});

test('Ampliación accesible diez veces; reintento no consume otra ampliación', () => {
  const f = setup(); let r;
  for (let i = 0; i < 10; i++) {
    const d = { ...f.p, accion: 'extender', operacion: i.toString(16).padStart(32, '0') };
    r = f.c.gestionarApartado_(d); assert.equal(r.ok, true); assert.equal(r.ampliaciones, i + 1);
    assert.equal(f.c.gestionarApartado_(d).vence, r.vence);
  }
  assert.equal(r.vence, Date.parse('2026-10-20T17:55:00Z'));
  assert.equal(f.c.gestionarApartado_({ ...f.p, accion: 'extender', operacion: 'f'.repeat(32) }).error, 'ampliaciones');
});

test('Otra sesión o token no puede extender, liberar ni reservar el apartado', () => {
  const f = setup();
  for (const accion of ['extender', 'liberar']) assert.equal(f.c.gestionarApartado_({ ...f.p, accion, token: 'd'.repeat(32) }).error, 'apartado_vencido');
  assert.equal(f.c.registrar_({ ...f.p, token: 'd'.repeat(32) }).error, 'apartado_vencido');
  assert.equal(f.c.registrar_({ ...f.p, hora: '08:30' }).error, 'apartado_vencido');
  assert.equal(f.c.apartadosActivos_().length, 1);
});

test('Liberación idempotente; confirmar consume el apartado tras guardar', () => {
  const f = setup(); assert.equal(f.c.gestionarApartado_({ ...f.p, accion: 'liberar' }).ok, true);
  assert.equal(f.c.gestionarApartado_({ ...f.p, accion: 'liberar' }).ok, true);
  const g = setup(); assert.equal(g.c.registrar_(g.p).ok, true); assert.equal(g.c.apartadosActivos_().length, 0);
  g.existing.push(g.record()); assert.equal(g.c.registrar_(g.p).recuperada, true);
});

test('Disponibilidad incluye apartados sin revelar secretos ni datos personales', () => {
  const f = setup(), r = f.c.ocupadas_({ maxDia: 1 }, 'yopal');
  assert.equal(r.ocupadas[0], '20261022|08:00'); assert.equal(r.llenos[0], '20261022');
  assert(!JSON.stringify(r).includes(f.p.token)); assert(!JSON.stringify(r).includes(f.p.sesion));
});

test('El apartado no sobrepasa el cierre por anticipación mínima', () => {
  const f = setup(); f.props.clear();
  // Ahora son las 12:00 en Colombia. Una franja de las 14:02 cierra en dos minutos.
  vm.runInContext("leerConfig_=()=>({dias:30,horasMin:2,maxDia:20,sedes:{yopal:{horarios:{2:['14:02','14:00']}}}})", f.c);
  const r = f.c.gestionarApartado_({ ...f.p, accion: 'apartar', fecha: '20261020', hora: '14:02' });
  assert.equal(r.vence, Date.parse('2026-10-20T17:02:00Z')); assert.equal(r.puedeAmpliar, false);
  assert.equal(f.c.gestionarApartado_({ ...f.p, accion: 'extender', token: r.token }).error, 'fuera_de_rango');
  assert.equal(f.c.gestionarApartado_({ ...f.p, accion: 'apartar', fecha: '20261020', hora: '14:00' }).error, 'fuera_de_rango');
});
