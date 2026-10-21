import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const context = { window: {}, TextEncoder, Date }; vm.createContext(context);
vm.runInContext(fs.readFileSync(new URL('../calendar.js', import.meta.url), 'utf8'), context);
const event = { id: 'C-' + 'a'.repeat(32), fecha: '20261022', hora: '08:30', duracion: 30, sede: 'Yopal', direccion: 'Calle 1, local 2; piso 3\nEntrada principal' };
test('iCalendar UTC, duración real, estado tentativo y UID estable sin datos de paciente', () => {
  const result = context.window.RIVAS_ICS(event, new Date('2026-10-21T12:00:00Z'));
  assert.match(result, /DTSTART:20261022T133000Z\r\n/); assert.match(result, /DTEND:20261022T140000Z\r\n/);
  assert.match(result, /STATUS:TENTATIVE\r\nCLASS:PRIVATE/); assert.match(result, /DTSTAMP:20261021T120000Z/);
  assert.match(result, /Calle 1\\, local 2\\; piso 3\\nEntrada/); assert(result.endsWith('END:VCALENDAR\r\n'));
  assert(!/Paciente|300000|Implantes/.test(result));
});
test('iCalendar pliega líneas por bytes UTF-8 sin romper tildes', () => {
  const result = context.window.RIVAS_ICS({ ...event, direccion: 'á'.repeat(180) });
  assert(result.split('\r\n').every(line => Buffer.byteLength(line) <= 75));
  assert(result.replace(/\r\n /g, '').includes('á'.repeat(180)));
});
test('Datos inválidos no generan un archivo de calendario', () => {
  assert.throws(() => context.window.RIVAS_ICS({ ...event, id: 'bad\r\nURL:attacker' }));
  assert.throws(() => context.window.RIVAS_ICS({ ...event, duracion: -1 }));
});
