import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
test('Selector de sede conserva foco dentro del modal y restaura acceso al agendador', t => {
  const dom = new JSDOM(fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8'), { url: 'https://qa.example/', runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => dom.window.close()); const w = dom.window, d = w.document;
  w.matchMedia = () => ({ matches: true }); w.eval(fs.readFileSync(new URL('../script.js', import.meta.url), 'utf8'));
  const cities = [...d.querySelectorAll('.city')], gate = d.querySelector('#gate');
  assert.equal(d.activeElement, gate); assert.equal(d.querySelector('main').inert, true);
  cities[0].focus(); cities[0].dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })); assert.equal(d.activeElement, cities.at(-1));
  cities.at(-1).dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })); assert.equal(d.activeElement, cities[0]);
  cities[0].click(); assert.equal(gate.inert, true); assert.equal(gate.getAttribute('aria-hidden'), 'true'); assert.equal(d.querySelector('main').inert, false); assert.equal(d.activeElement, d.querySelector('#sedeChip'));
  d.querySelector('#sedeChip').click(); assert.equal(d.activeElement, gate); assert.equal(d.querySelector('main').inert, true);
});
