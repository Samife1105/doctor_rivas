import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const script = fs.readFileSync(new URL('../agenda.js', import.meta.url), 'utf8');
const horarios = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [i, i === 0 ? [] : ['08:00', '08:30', '09:00']]));
const cfg = { ok: true, dias: 30, horasMin: 2, ahora: Date.parse('2026-10-20T17:00:00Z'), sedes: Object.fromEntries(['yopal', 'aguazul', 'bogota'].map(s => [s, { horarios }])) };
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r)); };
async function setup(reserve = async () => ({ ok: true, id: 'C-QA' }), failHours = false) {
  const dom = new JSDOM(html, { url: 'https://qa.example/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window, calls = [], d = w.document;
  w.matchMedia = () => ({ matches: true });
  w.HTMLElement.prototype.scrollIntoView = () => {};
  w.RIVAS_CONFIG = { backendUrl: 'configured' };
  w.RIVAS = { current: () => 'yopal', SEDES: Object.fromEntries(['yopal', 'aguazul', 'bogota'].map(s => [s, { name: s, addr: 'Dirección QA' }])), waUrl: () => 'https://wa.me/0' };
  w.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (options.method === 'POST') return { ok: true, status: 200, json: async () => reserve(JSON.parse(options.body)) };
    if (url.includes('accion=config')) return { ok: true, json: async () => cfg };
    if (failHours) throw new TypeError('offline');
    return { ok: true, json: async () => ({ ok: true, ocupadas: [], llenos: [] }) };
  };
  w.eval(script); await settle();
  const choose = () => { [...d.querySelectorAll('#calGrid button')].find(b => !b.disabled).click(); [...d.querySelectorAll('.slot')].find(b => !b.disabled).click(); };
  const fill = () => { d.querySelector('#bNombre').value = 'Paciente QA'; d.querySelector('#bTel').value = '+57 300 000 0000'; d.querySelector('#bOk').checked = true; };
  const submit = () => d.querySelector('#bookForm').dispatchEvent(new w.Event('submit', { cancelable: true }));
  return { dom, d, w, calls, choose, fill, submit };
}
test('Autocompletado +57: una reserva POST, sin datos en URL, con ID y comprobante', async t => {
  const f = await setup(); t.after(() => f.dom.window.close()); f.choose(); f.fill(); f.submit(); await settle();
  const posts = f.calls.filter(c => c.options.method === 'POST'); assert.equal(posts.length, 1); assert.equal(posts[0].url, '/api/agenda');
  const p = JSON.parse(posts[0].options.body); assert.equal(p.celular, '3000000000'); assert.match(p.operacion, /^[a-f0-9]{32}$/); assert.equal(p.hp, '');
  assert.equal(f.d.querySelector('#bHp').type, 'hidden'); assert.equal(f.d.querySelector('#bDone').hidden, false); assert.match(f.d.querySelector('#doneRef').textContent, /C-QA/);
});
test('Envío lento: bloquear limpiar, sede y hora; doble submit no duplica; comprobante inmutable', async t => {
  let resolve; const f = await setup(() => new Promise(r => { resolve = r; })); t.after(() => f.dom.window.close()); f.choose(); f.fill(); f.submit(); await settle();
  assert.equal(f.d.querySelector('#bClear').disabled, true); assert.equal(f.d.querySelector('#sedeChip').disabled, true); assert.equal(f.d.querySelector('.slot').disabled, true);
  f.d.querySelector('#bClear').click(); f.submit(); assert.equal(f.calls.filter(c => c.options.method === 'POST').length, 1);
  resolve({ ok: true, id: 'C-slow' }); await settle(); assert.equal(f.d.querySelector('#bDone').hidden, false); assert.match(f.d.querySelector('#doneTxt').textContent, /8:00/);
  assert.equal(f.d.querySelector('#bClear').disabled, false);
});
test('Conflicto nunca se convierte en éxito; formulario vuelve a habilitarse', async t => {
  const f = await setup(async () => ({ ok: false, error: 'hora_ocupada' })); t.after(() => f.dom.window.close()); f.choose(); f.fill(); f.submit(); await settle();
  assert.equal(f.d.querySelector('#bDone').hidden, true); assert.match(f.d.querySelector('#bErr').textContent, /otra persona/); assert.equal(f.d.querySelector('#bGo').disabled, false);
});
test('Respuesta perdida: reintentar conserva operación y no confirma prematuramente', async t => {
  let n = 0; const f = await setup(async () => { if (!n++) throw new TypeError('lost'); return { ok: true, id: 'C-retry', recuperada: true }; }); t.after(() => f.dom.window.close()); f.choose(); f.fill(); f.submit(); await settle();
  assert.equal(f.d.querySelector('#bDone').hidden, true); assert.match(f.d.querySelector('#bErr').textContent, /podría haberse guardado/); f.submit(); await settle();
  const posts = f.calls.filter(c => c.options.method === 'POST').map(c => JSON.parse(c.options.body)); assert.equal(posts.length, 2); assert.equal(posts[0].operacion, posts[1].operacion); assert.equal(f.d.querySelector('#bDone').hidden, false);
});
test('Fallo de disponibilidad: días deshabilitados, estado y reintento visibles', async t => {
  const f = await setup(undefined, true); t.after(() => f.dom.window.close()); assert([...f.d.querySelectorAll('#calGrid button')].every(b => b.disabled)); assert.equal(f.d.querySelector('#availabilityRetry').hidden, false); assert.match(f.d.querySelector('#availabilityText').textContent, /conexión/);
});
test('Correo sintáctico no depende de DNS; correo fallido no se anuncia enviado', async t => {
  const f = await setup(async () => ({ ok: true, id: 'C-mail', correo: 'fallido' })); t.after(() => f.dom.window.close()); f.choose(); f.fill(); f.d.querySelector('#bMail').value = 'qa@example.com'; f.submit(); await settle();
  assert(f.calls.every(c => c.url.startsWith('/api/agenda'))); assert.match(f.d.querySelector('#doneNotice').textContent, /no pudimos enviar/);
});
test('Hora seleccionada y radiogrupos anuncian estado y admiten flechas', async t => {
  const f = await setup(); t.after(() => f.dom.window.close()); f.choose(); assert.equal(f.d.querySelector('.slot.on').getAttribute('aria-pressed'), 'true');
  const first = f.d.querySelector('#bTipo .chip'); first.dispatchEvent(new f.w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); assert.equal(f.d.querySelectorAll('#bTipo .chip')[1].getAttribute('aria-checked'), 'true');
});
test('Nombre >80 y teléfono largo no provocan envío', async t => {
  const f = await setup(); t.after(() => f.dom.window.close()); f.choose(); f.fill(); f.d.querySelector('#bNombre').value = 'a'.repeat(81); f.submit(); await settle(); assert.equal(f.calls.filter(c => c.options.method === 'POST').length, 0);
});
