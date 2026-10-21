# Agendamiento: estándares y decisiones aplicadas

Investigación y revisión: 21 de octubre de 2026. No existe un estándar mundial único que obligue a usar apartados de cinco minutos. Se distinguen estándares de interoperabilidad, criterios de accesibilidad, recomendaciones de seguridad y prácticas de proveedores.

| Fuente primaria | Criterio | Aplicación en este proyecto |
| --- | --- | --- |
| [HL7 FHIR R5 Slot](https://hl7.org/fhir/R5/slot.html) | Separar disponibilidad y citas; un cupo puede estar ocupado provisionalmente. La capacidad depende del servicio. | Apartado temporal separado de la fila clínica. Se conserva la capacidad actual: una cita por horario y sede. No se presenta como una implementación certificada de FHIR. |
| [Cal.com: reservar un slot](https://cal.com/docs/api-reference/v2/slots/reserve-a-slot) | Ejemplo de práctica de mercado: reservas temporales con identificador y vencimiento; cinco minutos predeterminados. | Cinco minutos iniciales; identificador aleatorio privado, renovación automática durante actividad y recuperación al confirmar. Es una decisión de producto, no una obligación normativa. |
| [WCAG 2.2.1: tiempo ajustable](https://www.w3.org/WAI/WCAG22/Understanding/timing-adjustable.html) | Advertir antes de vencer y permitir ampliación sencilla, al menos diez veces, con al menos veinte segundos para actuar. | El formulario no impone un plazo de finalización ni borra datos por vencimiento. Sin contador ni botón de ampliar: el cupo técnico se renueva durante actividad; al confirmar se recupera si sigue disponible. Un conflicto conserva datos y permite elegir otra hora. No se afirma conformidad integral WCAG. |
| [WCAG 3.3.7: entrada redundante](https://www.w3.org/WAI/WCAG22/Understanding/redundant-entry.html) | Evitar pedir otra vez información del mismo proceso. | Se conservan nombre, celular, correo y consentimiento tras conflicto o vencimiento; volver desde la caché del navegador no borra el formulario. No se persisten datos personales en sessionStorage. |
| [OWASP REST Security](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html) | HTTPS, validación de entrada, métodos permitidos y datos sensibles fuera de las URL. | POST por proxy del mismo origen; listas de campos y acciones; tamaño limitado; tokens y datos solo en cuerpo; no-store; disponibilidad sin nombres ni secretos. |
| [RFC 5545 iCalendar](https://www.rfc-editor.org/rfc/rfc5545.html) | UID, fechas UTC, duración, estados y formato interoperable. | Archivo .ics privado, estado TENTATIVE, duración configurada, escape de texto y plegado por bytes UTF-8. No incluye nombre, teléfono ni tratamiento. |

## Funcionamiento

1. Elegir una hora solicita un apartado atómico bajo ScriptLock. Solo después del éxito se muestra seleccionada.
2. Otro visitante recibe conflicto al solicitar ese mismo cupo. La disponibilidad lo muestra ocupado en la siguiente consulta; no se promete actualización instantánea en otras pantallas.
3. Un secreto de sesión permite mantener como máximo un apartado activo. Cambiar de horario sustituye el anterior; cambiar día/sede o limpiar solicita liberación. Si la red falla o se cierra la pestaña, vence automáticamente.
4. Los apartados se guardan en ScriptProperties, no en caché susceptible de desalojos. Solo contienen sede, fecha, hora, secretos y metadatos técnicos. Los vencidos dejan de bloquear aunque todavía no se hayan borrado; la siguiente mutación limpia únicamente esas propiedades técnicas.
5. Confirmar requiere el apartado vigente y coincidente. La cita se escribe y se fuerza flush antes de liberar el apartado. Su ID idempotente permite recuperar una respuesta perdida, incluso si el apartado ya fue consumido.
6. La renovación automática también es idempotente: repetir la misma operación no consume dos renovaciones. Máximo total: 55 minutos desde el apartado inicial, sin sobrepasar el cierre por anticipación mínima de la franja. Cerca de ese cierre no se renueva; al confirmar se comprueba la disponibilidad y se conserva el formulario si hace falta otra hora. No se ofrece un apartado nuevo si resta menos de un minuto para el cierre.
7. La cita se registra como Pendiente y el comprobante lo comunica. Cambios y cancelación se gestionan mediante el WhatsApp de la sede.

## Experiencia elegida para la clínica

Por preferencia del propietario se retiraron el contador y el botón de ampliación. El paciente solo elige horario y completa sus datos. El navegador solicita una renovación silenciosa cuando el apartado se acerca a vencer, la página está visible y hubo interacción reciente (tres minutos). La página en segundo plano o inactiva no retiene cupos indefinidamente. Al confirmar, un apartado vencido se solicita de nuevo si la hora sigue libre; si otro la tomó se informa el conflicto conservando el formulario. Una respuesta incierta de registro se recupera por la misma operación antes de intentar otra reserva.

[Ticketmaster documenta un contador visible y liberación al vencer](https://help.ticketmaster.com/hc/en-us/articles/9642204793617-Why-is-there-a-time-limit-for-checking-out). Es un ejemplo de control de demanda, no una obligación para una clínica ni una prueba de que todas las tiqueteras funcionen igual.

## Límites y decisiones clínicas pendientes

- Esto no acredita cumplimiento integral WCAG, FHIR, HIPAA ni de una ley de protección de datos. Implementar criterios técnicos concretos no equivale a certificación.
- La agenda conserva los horarios, duración y capacidad configurados en la hoja. No se inventan disponibilidad de odontólogos, sillones, festivos, intervalos entre tratamientos ni prioridades clínicas. Un modelo por profesional/recurso necesita esos datos antes de activarlo.
- ScriptLock coordina las escrituras de esta aplicación, no las ediciones manuales simultáneas en Sheets ni aplicaciones externas que no usen el mismo bloqueo. La recepción debe respetar los cupos y comprobar antes de modificar manualmente.
- Apps Script y Sheets tienen cuotas y latencia. Se limita a 150 apartados activos globales, 30 cambios de apartado por sesión en diez minutos y los límites de citas existentes. El límite por sesión usa CacheService y es orientativo, no una defensa completa contra bots. Un atacante puede crear sesiones nuevas: para demanda alta hacen falta WAF/CAPTCHA con validación en servidor o una base transaccional y una cola.
- No se añaden pagos, multas, sobreventa, lista de espera, cancelación pública por ID ni confirmación clínica automática sin una política concreta. Un ID de comprobante no es una credencial para consultar datos ni cancelar citas.
- Cerrar y reabrir una sesión no restaura datos personales. No hay garantía de entrega de correo; los fallos no deshacen una cita guardada.
- Las pruebas responsivas no sustituyen pruebas físicas en Redmi/Mi Browser/WebView ni una prueba de carga exhaustiva.

## Reversión

Respaldo completo local anterior: `respaldos/2026-10-21-apps-script-antes-de-apartados.md`. Conservar versiones e implementaciones anteriores. La versión del frontend, proxy y backend debe cambiar de forma coordinada: protocolo 3 exige apartados; protocolo 2 no los comprende.
