import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../agenda-backend/Code.gs', import.meta.url), 'utf8');
function setup() {
  const rows = [], existing = [], cache = new Map(); let mailFails = false;
  class Clock extends Date { constructor(...a) { super(...(a.length ? a : ['2026-10-20T17:00:00Z'])); } static now() { return Date.parse('2026-10-20T17:00:00Z'); } }
  const utils = {
    parseDate: (value) => { const [date, hour] = value.split(' '); const [h, m] = hour.split(':').map(Number); return new Date(Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6, 8), h + 5, m)); },
    formatDate: (date, tz, format) => { const s = new Date(date.getTime() - 5 * 3600000).toISOString(); const key = s.slice(0, 10).replaceAll('-', ''); return format === 'yyyyMMdd' ? key : key + ' ' + s.slice(11, 16); }
  };
  const context = { console, Date: Clock, Utilities: utils, CacheService: { getScriptCache: () => ({ get: k => cache.get(k), put: (k, v) => cache.set(k, v) }) },
    SpreadsheetApp: { getActive: () => ({ getSheetByName: () => ({ getLastRow: () => 1 + rows.length, getMaxRows: () => 1000, getRange: () => ({ setNumberFormat() {}, setValues: v => rows.push(v[0]) }) }), getUrl: () => '' }) },
    MailApp: { sendEmail() { if (mailFails) throw new Error('quota'); } }, readAppointments: s => existing.filter(c => c.sede === s) };
  vm.createContext(context); vm.runInContext(source, context);
  vm.runInContext(`leerConfig_=()=>({dias:30,horasMin:2,maxDia:20,sedes:{yopal:{nombre:'Yopal',correos:[],horarios:Object.fromEntries(Array.from({length:7},(_,i)=>[i,['08:00','08:30','09:00']]))}}}); citasDe_=readAppointments;`, context);
  const p = { sede: 'yopal', nombre: 'Paciente QA', celular: '3000000000', correo: '', tipo: 'Valoración inicial', fecha: '20261022', hora: '08:00', hp: '', operacion: 'a'.repeat(32) };
  const record = (overrides = {}) => ({ id: 'C-' + p.operacion, sede: p.sede, nombre: p.nombre, celular: p.celular, correo: p.correo, tipo: p.tipo, fecha: p.fecha, hora: p.hora, estado: 'Pendiente', ...overrides });
  return { c: context, rows, existing, cache, p, record, failMail: () => { mailFails = true; } };
}
test('Nueva reserva: una fila e ID durable de operación', () => { const f = setup(); const r = f.c.registrar_(f.p); assert.equal(r.ok, true); assert.equal(r.id, f.record().id); assert.equal(f.rows.length, 1); });
test('Respuesta perdida: misma operación devuelve ID sin escribir ni reenviar', () => { const f = setup(); f.existing.push(f.record()); const r = f.c.registrar_(f.p); assert.equal(r.ok, true); assert.equal(r.recuperada, true); assert.equal(f.rows.length, 0); });
test('Operación ajena/cancelada no produce éxito', () => { for (const change of [{ celular: '3111111111' }, { estado: 'Cancelada' }, { nombre: 'Otra persona' }]) { const f = setup(); f.existing.push(f.record(change)); assert.equal(f.c.registrar_(f.p).error, 'operacion_conflicto'); } });
test('Hora ocupada por otra operación permanece conflicto', () => { const f = setup(); f.existing.push(f.record({ id: 'legacy' })); assert.equal(f.c.registrar_(f.p).error, 'hora_ocupada'); });
test('Cancelación libera hora para una operación nueva', () => { const f = setup(); f.existing.push(f.record({ id: 'legacy', estado: 'Cancelada' })); assert.equal(f.c.registrar_(f.p).ok, true); });
test('Fecha imposible y hora fuera de rango son rechazadas', () => { const f = setup(); for (const change of [{ fecha: '20261131' }, { hora: '25:00' }]) assert.equal(f.c.registrar_({ ...f.p, ...change }).error, 'fecha'); assert.equal(f.rows.length, 0); });
test('Ventana inclusiva hoy+30 coincide con calendario', () => { const f = setup(); assert.equal(f.c.registrar_({ ...f.p, fecha: '20261119' }).ok, true); assert.equal(f.c.registrar_({ ...f.p, fecha: '20261120' }).error, 'fuera_de_rango'); });
test('Límites por día y celular continúan vigentes', () => { const f = setup(); f.existing.push(...Array.from({ length: 20 }, (_, i) => f.record({ id: 'legacy' + i, hora: '10:' + i }))); assert.equal(f.c.registrar_(f.p).error, 'dia_lleno'); const g = setup(); g.existing.push(...Array.from({ length: 3 }, (_, i) => g.record({ id: 'legacy' + i, fecha: '20261023' }))); assert.equal(g.c.registrar_(g.p).error, 'demasiadas_citas'); });
test('Se limita frecuencia pero la recuperación idempotente no se bloquea', () => { const f = setup(); f.cache.set('intentos_' + f.p.celular, '6'); assert.equal(f.c.registrar_(f.p).error, 'limite'); f.existing.push(f.record()); assert.equal(f.c.registrar_(f.p).recuperada, true); });
test('Nombre tipo fórmula se guarda como texto y recupera sin diferencias', () => { const f = setup(); const p = { ...f.p, nombre: '=1+1' }; assert.equal(f.c.registrar_(p).ok, true); assert.equal(f.rows[0][6], "'=1+1"); f.existing.push(f.record({ nombre: "'=1+1" })); assert.equal(f.c.registrar_(p).recuperada, true); });
test('Fallo de correo informa estado sin invalidar cita registrada', () => { const f = setup(); f.failMail(); const r = f.c.registrar_({ ...f.p, correo: 'qa@example.com' }); assert.equal(r.ok, true); assert.equal(r.correo, 'fallido'); });
test('Validaciones de entrada, honeypot, operación y duración', () => { const f = setup(); for (const [changes, error] of [[{ nombre: 'a'.repeat(81) }, 'nombre'], [{ celular: '123' }, 'celular'], [{ correo: 'a..b@example.com' }, 'correo'], [{ hp: 'bot' }, 'invalido'], [{ operacion: '' }, 'operacion']]) assert.equal(f.c.registrar_({ ...f.p, ...changes }).error, error); assert.throws(() => f.c.franjas_('08:00', '18:00', -1)); assert.equal(f.c.hhmm_('29:70'), ''); });
