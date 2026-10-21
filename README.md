# Dr. Rivas · Sitio web

Rediseño del sitio de la Clínica Odontológica y Estética Dr. Rivas (Yopal, Aguazul, Bogotá).
Sitio estático (HTML/CSS/JS), sin build. Selector de sede al entrar, mapa por sede, WhatsApp por sede.

Desarrollo y pruebas (Node.js 20.19+):

```sh
npm ci
npm test
npm run dev
```

`npm run dev` sirve el sitio y `/api/agenda` en http://127.0.0.1:4173. Ese comando usa el backend real: una reserva válida escribe en la hoja. Para probar la interfaz sin escrituras: `node tests/dev-server.mjs --mock`.

El sitio sigue siendo HTML/CSS/JS sin build, pero el agendamiento requiere la función Node `api/agenda.mjs` (Vercel o el servidor de desarrollo). Un servidor exclusivamente estático no procesa reservas. Nunca reemplazar el error de API por un modo demostración automático.

Reservas: navegador → POST `/api/agenda` → POST a Apps Script. No se envían datos del paciente por query string. La función usa el destino fijo del repositorio o `AGENDA_BACKEND_URL` en Vercel; si cambias de implementación, mantenerlo coherente con `config.js`.

Antes de modificar Apps Script: guardar su código real en un archivo `.md` bajo `respaldos/`. Conservar una versión anterior desplegada. No ejecutar `instalar` ni `prepararHoja` para una actualización del código. Las citas y las once columnas existentes se conservan; la operación idempotente se almacena en la columna ID.

Un reintento con los mismos datos conserva el identificador de operación mientras la página permanece abierta. Recargar, limpiar o modificar los datos inicia otra operación. Si no se recibió respuesta, verificar con la sede antes de elegir otra hora. El backend debe ser v5 para recuperar una operación sin duplicados; no promover el frontend antes de verificar la implementación nueva.

Las pruebas de regresión cubren formulario completo en DOM, proxy HTTP y servicios de Google simulados. No sustituyen una comprobación en los Redmi físicos ni prueban la recepción real de correo. La limitación de frecuencia en Apps Script es por celular y usa caché temporal: no equivale a un sistema completo contra abuso distribuido.

Documentación de despliegue: https://vercel.com/docs/functions/runtimes/node-js y https://vercel.com/docs/functions/configuring-functions/duration.
