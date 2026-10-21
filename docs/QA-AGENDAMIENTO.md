# Verificación de correcciones del agendamiento

## Cambios

- Campo antispam de tipo hidden para evitar el falso positivo por autocompletado.
- POST al mismo origen mediante `/api/agenda`; datos personales fuera de las URLs.
- Operación aleatoria de 128 bits, ID persistida en la hoja y recuperación idempotente bajo ScriptLock. Los conflictos nunca se interpretan como éxito.
- Estado de reserva capturado antes de operaciones asíncronas. Se bloquean los controles durante el envío y se rechazan envíos simultáneos del formulario.
- Celular nacional o +57 normalizado sin truncamiento. Límite de nombre y correo coherente entre cliente, proxy y backend.
- Hora de Colombia basada en el reloj del servidor, fechas imposibles rechazadas y ventana inclusiva de días coherente.
- Disponibilidad con estado visible de carga, error y reintento; no se habilitan días sin consultar el servidor. Configuración revalidada cada cinco minutos cuando se refrescan los horarios.
- Correo validado por formato sin depender de DNS externo. No se afirma que el buzón haya sido verificado ni que un correo fallido haya sido enviado.
- Neutralización de fórmulas en campos de usuario, validación de esquema/HTTP/origen y límite temporal por celular. Este límite no sustituye protección contra abuso distribuido.
- Se conservan pestañas antiguas y columnas adicionales. Expansión de filas si se agota la capacidad de la pestaña. No se ejecutó instalar ni prepararHoja durante esta actualización.
- Días de al menos 44 px de alto, estado accesible de selección, radiogrupos con navegación por flechas y comprobante sin desbordamiento a 320 px.
- Guardar tarjeta descarga directamente el PNG, incluye la referencia y maneja errores visibles.

## Pruebas efectuadas

`npm test`: 27 pruebas aprobadas. Cubren DOM completo del formulario con jsdom, proxy HTTP y funciones reales de Apps Script con servicios de Google simulados. Incluyen respuesta perdida, reintentos, conflictos, bloqueo de edición/doble envío, autocompletado +57, disponibilidad desconectada, correo fallido, fechas inválidas, límites de capacidad/celular, fórmulas y recuperación por ID.

Navegador real disponible: reservas simuladas completas en 320×740, 360×800, 393×873, 412×915, 844×390, 768×1024 y 1440×900. Se corrigió y volvió a verificar el desbordamiento de referencia que apareció a 320 px. Descarga PNG y contenido visual verificados. Sin errores de consola capturados en la comprobación final del navegador local.

Backend publicado: implementación nueva de Apps Script, versión 11, protocolo 2. Configuración y disponibilidad responden correctamente; las reservas por GET se rechazan. Código guardado en Google comprobado contra el repositorio. Antes del cambio se guardó un respaldo Markdown local del código completo que se copió desde el editor de Google. La implementación anterior se conservó.

Pruebas reales autorizadas en la hoja **Agenda Dr. Rivas - PRUEBA**:

1. El formulario local, con el mismo proxy y frontend del despliegue, registró PRUEBA QA en Yopal. Se comprobó ID, día/hora y una sola fila en Sheets.
2. Tres reintentos simultáneos de esa operación devolvieron su misma ID con recuperada:true. Continuó existiendo una sola fila.
3. Otra operación para la hora ocupada devolvió hora_ocupada. Fecha imposible, honeypot manipulado y origen cruzado fueron rechazados.
4. Dos operaciones nuevas y simultáneas para otra hora produjeron una sola reserva y un conflicto. Se comprobó la fila correspondiente.
5. Las dos citas QA se marcaron **Cancelada**, sin borrar filas. Se comprobó que sus horarios quedaron liberados. No se modificaron citas ajenas. No se indicó correo de paciente; los avisos configurados a la sede estaban autorizados.

## Publicación y límites

La función requiere Node en Vercel. Un alojamiento exclusivamente estático no procesa `/api/agenda`. `AGENDA_BACKEND_URL`, si se define en Vercel, debe apuntar a la implementación nueva. El proxy exige protocolo 2 para evitar usar accidentalmente un backend anterior sin idempotencia.

Los reintentos conservan operación mientras la página permanezca abierta y mantenga los mismos datos. Tras recargar, limpiar o editar, verificar con la sede una reserva cuyo resultado fuera incierto antes de escoger otra hora.

Los tamaños de viewport no certifican Android, HyperOS, Gboard, Mi Browser, Safari ni un Redmi físico. No se certificó recepción de correo en bandejas, recordatorio diario ni resistencia a carga masiva. La regresión exacta en los dos Redmi del usuario debe comprobarse con la versión publicada.

Las evidencias locales están en `qa/`, excluidas del despliegue junto con `respaldos/` y `tests/`. Los scripts de reproducción de la auditoría inicial en qa corresponden al código anterior y no son la suite vigente; utilizar npm test.
