import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const script = fs.readFileSync(new URL('../agenda.js', import.meta.url), 'utf8');
const horarios = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [i, i === 0 ? [] : ['08:00', '08:30', '09:00']]));
const cfg = { ok: true, apiVersion: 3, apartados: { segundos: 300 }, dias: 30, horasMin: 2, ahora: Date.parse('2026-10-20T17:00:00Z'), sedes: Object.fromEntries(['yopal', 'aguazul', 'bogota'].map(s => [s, { horarios }])) };
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r)); };
async function setup(reserve = async () => ({ ok: true, id: 'C-QA' }), failHours = false, holdResponse = null) {
  const dom = new JSDOM(html, { url: 'https://qa.example/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window, calls = [], holdCalls = [], d = w.document; let tick = 0, holdTick; w.performance.now = () => tick; const interval = w.setInterval.bind(w); w.setInterval = (fn, ms) => { if (ms === 15000) holdTick = fn; return interval(fn, ms); };
  w.matchMedia = () => ({ matches: true });
  w.HTMLElement.prototype.scrollIntoView = () => {};
  w.RIVAS_CONFIG = { backendUrl: 'configured' };
  w.RIVAS = { current: () => 'yopal', SEDES: Object.fromEntries(['yopal', 'aguazul', 'bogota'].map(s => [s, { name: s, addr: 'Dirección QA' }])), waUrl: () => 'https://wa.me/0' };
  w.fetch = async (url, options = {}) => {
    if (options.method === 'POST') { const p = JSON.parse(options.body); if (p.accion && p.accion !== 'reservar') { holdCalls.push(p); if (holdResponse) return { ok: true, status: 200, json: async () => holdResponse(p) }; return { ok: true, status: 200, json: async () => ({ ok: true, token: 'c'.repeat(32), vence: cfg.ahora + tick + 300000, ahora: cfg.ahora + tick, puedeAmpliar: true, ampliaciones: p.accion === 'extender' ? 1 : 0, liberado: true }) }; } }
    calls.push({ url, options });
    if (options.method === 'POST') return { ok: true, status: 200, json: async () => reserve(JSON.parse(options.body)) };
    if (url.includes('accion=config')) return { ok: true, json: async () => cfg };
    if (failHours) throw new TypeError('offline');
    return { ok: true, json: async () => ({ ok: true, ocupadas: [], llenos: [] }) };
  };
  w.eval(script); await settle();
  const choose = () => { [...d.querySelectorAll('#calGrid button')].find(b => !b.disabled).click(); [...d.querySelectorAll('.slot')].find(b => !b.disabled).click(); };
  const fill = () => { d.querySelector('#bNombre').value = 'Paciente QA'; d.querySelector('#bTel').value = '+57 300 000 0000'; d.querySelector('#bMail').value = 'paciente@example.com'; d.querySelector('#bOk').checked = true; };
  const submit = () => d.querySelector('#bookForm').dispatchEvent(new w.Event('submit', { cancelable: true }));
  return { dom, d, w, calls, holdCalls, choose, fill, submit, advance: ms => { tick += ms; holdTick(); } };
}
test('Autocompletado +57: una reserva POST, sin datos en URL, con ID y comprobante', async t => {
  const f = await setup(); t.after(() => f.dom.window.close()); f.choose(); await settle(); f.fill(); f.submit(); await settle();
  const posts = f.calls.filter(c => c.options.method === 'POST'); assert.equal(posts.length, 1); assert.equal(posts[0].url, '/api/agenda');
  const p = JSON.parse(posts[0].options.body); assert.equal(p.celular, '3000000000'); assert.match(p.operacion, /^[a-f0-9]{32}$/); assert.equal(p.hp, '');
  assert.equal(f.d.querySelector('#bHp').type, 'hidden'); assert.equal(f.d.querySelector('#bDone').hidden, false); assert.match(f.d.querySelector('#doneRef').textContent, /C-QA/);
});
test('Envío lento: bloquear limpiar, sede y hora; doble submit no duplica; comprobante inmutable', async t => {
  let resolve; const f = await setup(() => new Promise(r => { resolve = r; })); t.after(() => f.dom.window.close()); f.choose(); await settle(); f.fill(); f.submit(); await settle();
  assert.equal(f.d.querySelector('#bClear').disabled, true); assert.equal(f.d.querySelector('#sedeChip').disabled, true); assert.equal(f.d.querySelector('.slot').disabled, true);
  f.d.querySelector('#bClear').click(); f.submit(); assert.equal(f.calls.filter(c => c.options.method === 'POST').length, 1);
  resolve({ ok: true, id: 'C-slow' }); await settle(); assert.equal(f.d.querySelector('#bDone').hidden, false); assert.match(f.d.querySelector('#doneTxt').textContent, /8:00/);
  assert.equal(f.d.querySelector('#bClear').disabled, false);
});
test('Conflicto nunca se convierte en éxito; formulario vuelve a habilitarse', async t => {
  const f = await setup(async () => ({ ok: false, error: 'hora_ocupada' })); t.after(() => f.dom.window.close()); f.choose(); await settle(); f.fill(); f.submit(); await settle();
  assert.equal(f.d.querySelector('#bDone').hidden, true); assert.match(f.d.querySelector('#bErr').textContent, /otra persona/); assert.equal(f.d.querySelector('#bGo').disabled, false);
});
test('Respuesta perdida: reintentar conserva operación y no confirma prematuramente', async t => {
  let n = 0; const f = await setup(async () => { if (!n++) throw new TypeError('lost'); return { ok: true, id: 'C-retry', recuperada: true }; }); t.after(() => f.dom.window.close()); f.choose(); await settle(); f.fill(); f.submit(); await settle();
  assert.equal(f.d.querySelector('#bDone').hidden, true); assert.match(f.d.querySelector('#bErr').textContent, /podría haberse guardado/); f.submit(); await settle();
  const posts = f.calls.filter(c => c.options.method === 'POST').map(c => JSON.parse(c.options.body)); assert.equal(posts.length, 2); assert.equal(posts[0].operacion, posts[1].operacion); assert.equal(f.d.querySelector('#bDone').hidden, false);
});
test('Fallo de disponibilidad: días deshabilitados, estado y reintento visibles', async t => {
  const f = await setup(undefined, true); t.after(() => f.dom.window.close()); assert([...f.d.querySelectorAll('#calGrid button')].every(b => b.disabled)); assert.equal(f.d.querySelector('#availabilityRetry').hidden, false); assert.match(f.d.querySelector('#availabilityText').textContent, /conexión/);
});
test('Correo sintáctico no depende de DNS; correo fallido no se anuncia enviado', async t => {
  const f = await setup(async () => ({ ok: true, id: 'C-mail', correo: 'fallido' })); t.after(() => f.dom.window.close()); f.choose(); await settle(); f.fill(); f.d.querySelector('#bMail').value = 'qa@example.com'; f.submit(); await settle();
  assert(f.calls.every(c => c.url.startsWith('/api/agenda'))); assert.match(f.d.querySelector('#doneNotice').textContent, /no pudimos enviar/);
});
test('Hora seleccionada y radiogrupos anuncian estado y admiten flechas', async t => {
  const f = await setup(); t.after(() => f.dom.window.close()); f.choose(); await settle(); assert.equal(f.d.querySelector('.slot.on').getAttribute('aria-pressed'), 'true');
  const first = f.d.querySelector('#bTipo .chip'); first.dispatchEvent(new f.w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); assert.equal(f.d.querySelectorAll('#bTipo .chip')[1].getAttribute('aria-checked'), 'true');
});
test('Nombre >80 y teléfono largo no provocan envío', async t => {
  const f = await setup(); t.after(() => f.dom.window.close()); f.choose(); await settle(); f.fill(); f.d.querySelector('#bNombre').value = 'a'.repeat(81); f.submit(); await settle(); assert.equal(f.calls.filter(c => c.options.method === 'POST').length, 0);
});

test('Seleccionar horario obtiene apartado antes de permitir el envío', async t => {
  let resolve; const f = await setup(undefined, false, () => new Promise(r => { resolve = r; })); t.after(() => f.dom.window.close());
  f.choose(); f.fill(); f.submit(); await settle();
  assert.equal(f.d.querySelector('#bGo').disabled, true); assert.equal(f.calls.filter(c => c.options.method === 'POST').length, 0);
  resolve({ ok: true, token: 'c'.repeat(32), vence: cfg.ahora + 300000, ahora: cfg.ahora, ampliaciones: 0 }); await settle();
  assert(f.d.querySelector('.slot.on')); assert.equal(f.d.querySelector('#holdBox'), null); assert.equal(f.d.querySelector('#holdExtend'), null);
});

test('Conflicto al apartar conserva datos y no marca la hora seleccionada', async t => {
  const f = await setup(undefined, false, () => ({ ok: false, error: 'hora_ocupada' })); t.after(() => f.dom.window.close());
  f.fill(); f.choose(); await settle();
  assert.match(f.d.querySelector('#bErr').textContent, /tomada/); assert.equal(f.d.querySelector('.slot.on'), null);
  assert.equal(f.d.querySelector('#bNombre').value, 'Paciente QA');
});

test('Vencimiento en segundo plano conserva datos y recupera el cupo al confirmar', async t => {
  const f = await setup(); t.after(() => f.dom.window.close()); f.choose(); await settle(); f.fill();
  Object.defineProperty(f.d, 'hidden', { value: true, configurable: true });
  f.advance(301000); await settle();
  assert.equal(f.d.querySelector('#bNombre').value, 'Paciente QA'); assert.equal(f.d.querySelector('#bOk').checked, true);
  assert(f.d.querySelector('.slot.on')); assert.equal(f.d.querySelector('#bErr').hidden, true);
  f.submit(); await settle(); assert.equal(f.holdCalls.filter(c => c.accion === 'apartar').length, 2);
  assert.equal(f.calls.filter(c => c.options.method === 'POST').length, 1); assert.equal(f.d.querySelector('#bDone').hidden, false);
});

test('Renovación automática durante actividad; cambiar día libera sin borrar datos', async t => {
  const f = await setup(); t.after(() => f.dom.window.close()); f.choose(); await settle(); f.fill();
  f.advance(150000); f.d.querySelector('#bNombre').dispatchEvent(new f.w.Event('input', { bubbles: true }));
  f.advance(91000); await settle();
  const extension = f.holdCalls.find(c => c.accion === 'extender'); assert.match(extension.sesion, /^[a-f0-9]{32}$/); assert.match(extension.operacion, /^[a-f0-9]{32}$/);
  assert.equal(f.d.querySelector('#bGo').disabled, false); assert.equal(f.d.querySelector('#holdExtend'), null);
  [...f.d.querySelectorAll('#calGrid button')].find(b => !b.disabled && b.getAttribute('aria-pressed') !== 'true').click(); await settle();
  assert(f.holdCalls.some(c => c.accion === 'liberar')); assert.equal(f.d.querySelector('#bNombre').value, 'Paciente QA');
});

test('Sin actividad no se renueva ni se borra el formulario', async t => {
  const f = await setup(); t.after(() => f.dom.window.close()); f.choose(); await settle(); f.fill();
  f.advance(241000); await settle(); assert.equal(f.holdCalls.filter(c => c.accion === 'extender').length, 0);
  assert.equal(f.d.querySelector('#bNombre').value, 'Paciente QA'); assert(f.d.querySelector('.slot.on'));
});

test('Si otro tomó el cupo tras vencer, informar conflicto conservando los datos', async t => {
  let apartados = 0;
  const f = await setup(undefined, false, p => p.accion === 'apartar' && ++apartados > 1 ? { ok: false, error: 'hora_ocupada' } : { ok: true, token: 'c'.repeat(32), vence: cfg.ahora + 300000, ahora: cfg.ahora, ampliaciones: 0, puedeAmpliar: true });
  t.after(() => f.dom.window.close()); f.choose(); await settle(); f.fill(); f.advance(301000); await settle(); f.submit(); await settle();
  assert.equal(f.d.querySelector('#bDone').hidden, true); assert.equal(f.d.querySelector('#bNombre').value, 'Paciente QA');
  assert.match(f.d.querySelector('#bErr').textContent, /tomada/); assert.equal(f.calls.filter(c => c.options.method === 'POST').length, 0);
});

test('Renovación perdida se reintenta con la misma operación, sin avisos ni bloqueos', async t => {
  let renovaciones = 0;
  const f = await setup(undefined, false, p => {
    if (p.accion === 'extender' && ++renovaciones === 1) throw new TypeError('offline');
    return { ok: true, token: 'c'.repeat(32), vence: cfg.ahora + (p.accion === 'extender' ? 600000 : 300000), ahora: cfg.ahora, ampliaciones: p.accion === 'extender' ? 1 : 0, puedeAmpliar: true };
  });
  t.after(() => f.dom.window.close()); f.choose(); await settle(); f.fill();
  f.advance(150000); f.d.querySelector('#bNombre').dispatchEvent(new f.w.Event('input', { bubbles: true })); f.advance(91000); await settle();
  assert.equal(f.d.querySelector('#bGo').disabled, false); assert.equal(f.d.querySelector('#bErr').hidden, true);
  f.advance(15000); await settle(); const attempts = f.holdCalls.filter(c => c.accion === 'extender');
  assert.equal(attempts.length, 2); assert.equal(attempts[0].operacion, attempts[1].operacion);
});

test('Confirmación espera la renovación en curso sin duplicar registro', async t => {
  let resolve;
  const f = await setup(undefined, false, p => p.accion === 'extender' ? new Promise(r => { resolve = r; }) : { ok: true, token: 'c'.repeat(32), vence: cfg.ahora + 300000, ahora: cfg.ahora, ampliaciones: 0, puedeAmpliar: true });
  t.after(() => f.dom.window.close()); f.choose(); await settle(); f.fill(); f.advance(150000); f.d.querySelector('#bNombre').dispatchEvent(new f.w.Event('input', { bubbles: true })); f.advance(91000); await settle();
  f.submit(); await settle(); assert.equal(f.calls.filter(c => c.options.method === 'POST').length, 0);
  resolve({ ok: true, token: 'c'.repeat(32), vence: cfg.ahora + 600000, ahora: cfg.ahora + 241000, ampliaciones: 1, puedeAmpliar: true }); await settle();
  assert.equal(f.calls.filter(c => c.options.method === 'POST').length, 1); assert.equal(f.d.querySelector('#bDone').hidden, false);
});
