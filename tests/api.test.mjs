import { test } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/agenda.mjs';
const payload = { sede: 'yopal', nombre: 'Paciente QA', celular: '3000000000', correo: '', tipo: 'Valoración inicial', fecha: '20261022', hora: '08:00', hp: '', operacion: 'a'.repeat(32) };
async function run(req = {}, upstream = { ok: true, id: 'C-QA' }, status = 200) {
  let call; const original = global.fetch;
  global.fetch = async (url, options) => { call = { url, options }; if (upstream instanceof Error) throw upstream; return { ok: status < 400, json: async () => upstream }; };
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(s) { this.code = s; return this; }, json(v) { this.body = v; return this; } };
  try { await handler({ method: 'POST', headers: { host: 'qa.example', origin: 'https://qa.example', 'content-type': 'application/json' }, body: payload, ...req }, res); return { res, call }; } finally { global.fetch = original; }
}
test('Proxy solo reenvía datos por cuerpo POST a destino fijo', async () => { const { res, call } = await run(); assert.equal(res.body.ok, true); assert(!call.url.includes('Paciente')); assert.equal(call.options.method, 'POST'); assert.equal(JSON.parse(call.options.body).operacion, payload.operacion); assert.equal(res.headers['Cache-Control'], 'no-store'); });
test('Origen cruzado, métodos y acciones no permitidas se rechazan antes de Google', async () => { for (const req of [{ headers: { host: 'qa.example', origin: 'https://attacker.example', 'content-type': 'application/json' } }, { method: 'DELETE' }, { method: 'GET', query: { accion: 'reservar' } }]) { const { res, call } = await run(req); assert.equal(res.body.ok, false); assert.equal(call, undefined); } });
test('Validación, límite de cuerpo y honeypot no llegan al servidor', async () => { for (const body of [{ ...payload, hp: 'bot' }, { ...payload, nombre: '' }, { ...payload, celular: '123' }, { ...payload, operacion: '' }, '{bad json', { ...payload, extra: 'x'.repeat(5000) }]) { const { res, call } = await run({ body }); assert.equal(res.body.ok, false); assert.equal(call, undefined); } });
test('Upstream 500 con ok:true nunca se confirma', async () => { const { res } = await run({}, { ok: true, id: 'fake' }, 500); assert.equal(res.body.error, 'incierta'); });
test('Timeout y éxito sin ID se consideran inciertos', async () => { for (const upstream of [new Error('timeout'), { ok: true }]) { const { res } = await run({}, upstream); assert.equal(res.body.error, 'incierta'); } });
test('Conflicto explícito permanece conflicto y no expone detalle interno', async () => { const { res } = await run({}, { ok: false, error: 'hora_ocupada', detalle: 'private' }); assert.deepEqual(res.body, { ok: false, error: 'hora_ocupada' }); });
test('Configuración pública recibe reloj de servidor y disponibilidad exige esquema', async () => { const c = await run({ method: 'GET', query: { accion: 'config' } }, { ok: true, apiVersion: 2, dias: 30, horasMin: 2, sedes: {} }); assert.equal(c.res.body.zona, 'America/Bogota'); assert(Number.isFinite(c.res.body.ahora)); const h = await run({ method: 'GET', query: { accion: 'horas', sede: 'yopal' } }, { ok: true }); assert.equal(h.res.body.ok, false); });
