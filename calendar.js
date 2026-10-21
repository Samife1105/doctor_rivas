/* RFC 5545. Evento privado y tentativo: no incluye nombre, celular ni tratamiento. */
(() => {
  const escape = value => String(value).replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
  const stamp = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const fold = line => {
    const encoder = new TextEncoder(); let out = '', current = '';
    for (const char of line) {
      if (encoder.encode(current + char).length > 75) { out += current + '\r\n'; current = ' '; }
      current += char;
    }
    return out + current;
  };
  window.RIVAS_ICS = ({ id, fecha, hora, duracion, sede, direccion }, now = new Date()) => {
    if (!/^C-[a-f0-9]{32}$/.test(id) || !/^\d{8}$/.test(fecha) || !/^\d{2}:\d{2}$/.test(hora) || !Number.isInteger(duracion) || duracion < 5 || duracion > 240) throw new Error('Evento inválido');
    // Colombia usa UTC−05:00. El API entrega exclusivamente horarios de America/Bogota.
    const start = new Date(`${fecha.slice(0, 4)}-${fecha.slice(4, 6)}-${fecha.slice(6, 8)}T${hora}:00-05:00`);
    const end = new Date(start.getTime() + duracion * 60000);
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Dr Rivas//Agenda//ES', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT', `UID:${id}@doctorrivas.vercel.app`, `DTSTAMP:${stamp(now)}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`, 'SUMMARY:Cita en Clínica Dr. Rivas', `LOCATION:${escape(sede + ' - ' + direccion)}`, 'DESCRIPTION:Pendiente de confirmación por la sede. Para cambiar o cancelar contacta a la clínica.', 'STATUS:TENTATIVE', 'CLASS:PRIVATE', 'TRANSP:OPAQUE', 'END:VEVENT', 'END:VCALENDAR'].map(fold).join('\r\n') + '\r\n';
  };
})();
