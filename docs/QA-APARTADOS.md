# QA de apartados y estándares de agendamiento

Fecha: 21/10/2026. Ramas: `feat/apartados-agendamiento` y `fix/apartado-transparente`. Backend: Apps Script versión 14, protocolo 3.

## Evidencia previa a publicar el frontend

- `npm test`: 49 pruebas aprobadas (proxy, Apps Script en entorno controlado, formulario con JSDOM, iCalendar y foco del modal).
- Concurrencia real contra Apps Script: dos peticiones POST simultáneas, un apartado concedido y un conflicto `hora_ocupada`.
- Repetir la solicitud devuelve el mismo apartado y vencimiento. Un token ajeno no puede liberarlo.
- Repetir una ampliación con el mismo identificador devuelve el mismo vencimiento y contador.
- Prueba real de cinco minutos: ampliar un apartado vencido devuelve `apartado_vencido`; otra sesión puede tomar la franja y liberarla.
- Flujo integrado navegador local → proxy → Apps Script → Sheets: cita `PRUEBA QA APARTADOS`, ID `C-2eaa609469c41d282f5b3842594897de`; fila 8 de Citas Yopal. Verificada y posteriormente marcada Cancelada.
- Descarga real .ics: inicio `20261022T133000Z`, duración 30 minutos, `STATUS:TENTATIVE`, sin nombre ni celular del paciente.
- Interfaz móvil observada a 393 × 873: comprobante legible, sin desbordamiento horizontal; comprobante legible. La revisión posterior retiró el contador y el botón de ampliación; la renovación pasa a ser automática.
- El controlador de viewport no aplicó otros tamaños solicitados: no se consideran verificados en esta ronda. Los tamaños revisados en el informe anterior corresponden a la versión previa.

## Casos de regresión incluidos

Disponibilidad caída, respuesta de confirmación perdida, reintento idempotente, doble envío, correo no entregado, normalización +57, fechas imposibles, anticipación y ventana máxima, límites por día/celular, fórmulas en celdas, consentimiento, cambio de sede/día, apartado vencido, sesión/token ajeno, liberación repetida, máximo diez ampliaciones, límite de anticipación al ampliar, privacidad en disponibilidad, calendario UTF-8 y navegación por teclado del selector de sede.

Los temporizadores se simulan en las pruebas unitarias y además se comprobó un vencimiento real de cinco minutos. No se modificó el reloj de producción para acelerar pruebas.

## Verificación posterior al despliegue

Comprobar protocolo 3 en `/api/agenda?accion=config`, correspondencia de recursos publicados con el código local, apartado y renovación automática sin controles de tiempo en el formulario público, cita sintética con comprobante, descarga de calendario y cancelación de la fila de QA. Después actualizar las URL anteriores del backend para que tampoco permitan registrar sin apartado. Conservar las versiones previas como reversión.

## Límites

No es una prueba física en Redmi Note 13 Pro, Safari/iOS, Mi Browser ni navegadores internos de redes sociales. No acredita carga masiva, disponibilidad sin interrupciones, entrega garantizada de correo ni cumplimiento integral WCAG o FHIR. ScriptLock no coordina ediciones manuales o aplicaciones externas que escriban directamente en Sheets. Para bots y demanda elevada se requiere protección adicional y capacidad transaccional adecuada; detalles y fuentes en [ESTANDARES-AGENDAMIENTO.md](ESTANDARES-AGENDAMIENTO.md).

## Ajuste posterior de experiencia

A solicitud del propietario: sin contador ni botón de ampliar. Pruebas adicionales cubren renovación por actividad, ausencia de renovación en segundo plano/inactividad, recuperación automática del cupo vencido al confirmar y conflicto con datos preservados si otro lo tomó. Backend versión 14 sin cambios adicionales.

Durante la propagación de la actualización de una URL histórica, una prueba sin apartado llegó a registrarse. La cita sintética `C-28170345d18dc5280ec373847770e305` (fila 9 de Citas Yopal) fue marcada Cancelada. Tras propagarse la publicación, las tres URL devolvieron `apartado_vencido` para solicitudes sin apartado y `metodo` para reservas por GET. No se considera válido probar inmediatamente después del mensaje de publicación sin verificar el comportamiento efectivo.
