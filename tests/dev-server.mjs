import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import handler from '../api/agenda.mjs';
const root = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/i, '$1'));
const mock = process.argv.includes('--mock');
const bookings = new Map();
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg' };
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  res.setHeader('Cache-Control', 'no-store');
  if (url.pathname === '/api/agenda') {
    req.query = Object.fromEntries(url.searchParams);
    res.status = code => { res.statusCode = code; return res; };
    res.json = value => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
    let data = ''; for await (const chunk of req) { data += chunk; if (data.length > 8192) { res.status(413).json({ ok: false }); return; } }
    req.body = data;
    if (!mock) return handler(req, res);
    if (req.method === 'POST') {
      const p = JSON.parse(data); let result = bookings.get(p.operacion);
      if (!result) { result = { ok: true, id: 'C-' + p.operacion, correo: 'no_solicitado' }; bookings.set(p.operacion, result); }
      return res.status(200).json(result);
    }
    const horarios = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [i, i === 0 ? [] : ['08:00', '08:30', '09:00', '09:30', '10:00', '14:00', '14:30', '15:00']]));
    return res.status(200).json(req.query.accion === 'config' ? { ok: true, apiVersion: 2, ahora: Date.now(), dias: 30, horasMin: 2, sedes: Object.fromEntries(['yopal', 'aguazul', 'bogota'].map(s => [s, { horarios }])) } : { ok: true, ocupadas: [], llenos: [] });
  }
  try {
    const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const file = path.resolve(root, '.' + relative);
    if (!file.startsWith(root + path.sep) || /(?:^|[\\/])(?:\.git|respaldos|qa|tests|node_modules|api)(?:[\\/]|$)/.test(relative)) throw new Error('denied');
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    res.end(await fs.readFile(file));
  } catch { res.statusCode = 404; res.end('Not found'); }
}).listen(4173, '127.0.0.1', () => console.log(`QA local: http://127.0.0.1:4173 (${mock ? 'simulado, sin escrituras' : 'backend real'})`));
