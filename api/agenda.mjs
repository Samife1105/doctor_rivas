// El navegador nunca envía datos del paciente en una URL ni contacta Google directamente.
const DEFAULT_BACKEND = 'https://script.google.com/macros/s/AKfycbyb4EgKIxr644LxdZJDIW5sYFsZB5SFewk2pqD_xnojBo_ZjoPlQqDV5QVvljXYeLp3/exec';
const SEDES = new Set(['yopal', 'aguazul', 'bogota']);
const TIPOS = new Set(['Valoración inicial', 'Diseño de sonrisa', 'Implantes dentales', 'Ortodoncia invisible']);
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const answer = (status, body) => res.status(status).json(body);
  const backend = process.env.AGENDA_BACKEND_URL || DEFAULT_BACKEND;
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(backend)) return answer(503, { ok: false, error: 'servidor' });
  let url = backend, options = { redirect: 'follow', signal: AbortSignal.timeout(48000) };
  if (req.method === 'GET') {
    const accion = req.query?.accion;
    if (accion !== 'config' && accion !== 'horas') return answer(400, { ok: false, error: 'accion' });
    const query = new URLSearchParams({ accion });
    if (accion === 'horas') {
      if (!SEDES.has(req.query?.sede)) return answer(400, { ok: false, error: 'sede' });
      query.set('sede', req.query.sede);
    }
    url += '?' + query;
  } else if (req.method === 'POST') {
    if (req.headers['sec-fetch-site'] === 'cross-site') return answer(403, { ok: false, error: 'invalido' });
    if (req.headers.origin) {
      try { if (new URL(req.headers.origin).host !== req.headers.host) return answer(403, { ok: false, error: 'invalido' }); }
      catch { return answer(403, { ok: false, error: 'invalido' }); }
    }
    if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) return answer(415, { ok: false, error: 'invalido' });
    let d;
    try {
      const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      if (!raw || Buffer.byteLength(raw) > 4096) return answer(413, { ok: false, error: 'invalido' });
      d = JSON.parse(raw);
    } catch { return answer(400, { ok: false, error: 'invalido' }); }
    if (!d || typeof d !== 'object' || Array.isArray(d) || d.hp) return answer(400, { ok: false, error: 'invalido' });
    const action = d.accion || 'reservar';
    if (!['reservar', 'apartar', 'extender', 'liberar'].includes(action)) return answer(400, { ok: false, error: 'accion' });
    if (typeof d.sesion !== 'string' || !/^[a-f0-9]{32}$/.test(d.sesion) || (action !== 'apartar' && (typeof d.token !== 'string' || !/^[a-f0-9]{32}$/.test(d.token)))) return answer(400, { ok: false, error: 'apartado_vencido' });
    if (['apartar', 'reservar'].includes(action) && (!SEDES.has(d.sede) || typeof d.fecha !== 'string' || typeof d.hora !== 'string' || !/^\d{8}$/.test(d.fecha) || !/^\d{2}:\d{2}$/.test(d.hora))) return answer(400, { ok: false, error: 'fecha' });
    let clean = { accion: action, sesion: d.sesion, token: d.token };
    if (action === 'extender') {
      if (!/^[a-f0-9]{32}$/.test(d.operacion || '')) return answer(400, { ok: false, error: 'operacion' });
      clean.operacion = d.operacion;
    }
    if (action === 'apartar') Object.assign(clean, { sede: d.sede, fecha: d.fecha, hora: d.hora });
    if (action === 'reservar') {
    if (!SEDES.has(d.sede)) return answer(400, { ok: false, error: 'sede' });
    if (!TIPOS.has(d.tipo)) return answer(400, { ok: false, error: 'tipo' });
    if (typeof d.nombre !== 'string' || d.nombre.trim().length < 3 || d.nombre.trim().length > 80) return answer(400, { ok: false, error: 'nombre' });
    if (!/^3\d{9}$/.test(d.celular)) return answer(400, { ok: false, error: 'celular' });
    if (typeof d.correo !== 'string' || d.correo.length > 254 || (d.correo && (!/^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(d.correo) || /\.\./.test(d.correo)))) return answer(400, { ok: false, error: 'correo' });
    if (!/^\d{8}$/.test(d.fecha) || !/^\d{2}:\d{2}$/.test(d.hora)) return answer(400, { ok: false, error: 'fecha' });
    if (!/^[a-f0-9]{32}$/.test(d.operacion)) return answer(400, { ok: false, error: 'operacion' });
    // Lista explícita: no reenviar claves arbitrarias ni aceptar un destino del cliente.
    clean = { ...clean, sede: d.sede, nombre: d.nombre.trim(), celular: d.celular, correo: d.correo, tipo: d.tipo, fecha: d.fecha, hora: d.hora, hp: '', operacion: d.operacion };
    }
    options = { ...options, method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(clean) };
  } else {
    res.setHeader('Allow', 'GET, POST');
    return answer(405, { ok: false, error: 'metodo' });
  }
  try {
    const upstream = await fetch(url, options);
    if (!upstream.ok) throw new Error('upstream');
    const body = await upstream.json();
    if (!body || typeof body.ok !== 'boolean') throw new Error('schema');
    if (!body.ok) return answer(200, { ok: false, error: typeof body.error === 'string' ? body.error : 'servidor' });
    if (req.method === 'POST') {
      const action = JSON.parse(options.body).accion;
      if (action === 'liberar') return answer(200, { ok: true, liberado: body.liberado === true });
      if (action === 'apartar' || action === 'extender') {
        if (!/^[a-f0-9]{32}$/.test(body.token) || !Number.isFinite(body.vence) || !Number.isInteger(body.ampliaciones)) throw new Error('apartado');
        return answer(200, { ok: true, token: body.token, vence: body.vence, ampliaciones: body.ampliaciones, puedeAmpliar: body.puedeAmpliar === true, ahora: Date.now() });
      }
      if (typeof body.id !== 'string' || !body.id) throw new Error('id');
      return answer(200, { ok: true, id: body.id, recuperada: body.recuperada === true, correo: ['enviado', 'fallido', 'no_solicitado'].includes(body.correo) ? body.correo : 'no_comprobado' });
    }
    if (req.query.accion === 'config') {
      if (body.apiVersion !== 3 || !body.apartados || !body.sedes || !Number.isInteger(body.dias) || !Number.isFinite(body.horasMin)) throw new Error('config');
      // Reloj del servidor: no depende del reloj/zona configurados en el teléfono.
      return answer(200, { ...body, ahora: Date.now(), zona: 'America/Bogota' });
    }
    if (!Array.isArray(body.ocupadas) || !Array.isArray(body.llenos)) throw new Error('horas');
    return answer(200, { ok: true, ocupadas: body.ocupadas, llenos: body.llenos });
  } catch {
    // Una respuesta perdida no implica que la escritura falló. Conservar operación al reintentar.
    return answer(200, { ok: false, error: req.method === 'POST' ? 'incierta' : 'servidor' });
  }
}
