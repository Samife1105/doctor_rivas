# Agenda Dr. Rivas · puesta en marcha (≈ 15 minutos)

Lo que se arma aquí: cada cita que se agenda en el sitio queda como **una fila en una hoja de Google**,
se crea un **evento en Google Calendar** de la sede (e invita al paciente si dejó su correo),
la sede recibe un **correo de aviso** y el paciente un **recordatorio un día antes**.
Las horas ya tomadas aparecen con candado en el sitio para todos los pacientes.

> Hazlo con la cuenta de Google **de la clínica** (la que será dueña de la hoja, el calendario y los correos).

## 1. La hoja
1. Entra a Google Drive → **Nuevo → Subir archivo** y sube `Agenda_Dr_Rivas_PLANTILLA.xlsx`.
2. Ábrelo y elige **Abrir con → Hojas de cálculo de Google**. Luego **Archivo → Guardar como hoja de cálculo de Google**.
3. **Archivo → Configuración**: zona horaria **(GMT-05:00) Bogotá**.
4. En la pestaña **Configuración** completa (celdas grises):
   - el correo de cada sede (reemplaza los `[correo-...]`),
   - los horarios reales de cada sede,
   - opcional: el ID de un calendario por sede (si lo dejas vacío usa el calendario principal).

## 2. El script
1. En la hoja: **Extensiones → Apps Script**.
2. Borra lo que haya y pega todo el contenido de `Code.gs`.
3. (Opcional) **Configuración del proyecto → Mostrar `appsscript.json`** y pega el contenido de `appsscript.json`.
4. Guarda. Elige la función **`instalar`** y pulsa **Ejecutar**. Google pedirá permisos
   (Calendar, correo, hojas): acéptalos. Esto crea el recordatorio diario (8 a. m.) y el control de cancelaciones.

## 3. Publicar
1. **Implementar → Nueva implementación → Aplicación web**.
2. *Ejecutar como*: **Yo**. *Quién tiene acceso*: **Cualquier persona**.
3. **Implementar** y copia la dirección que termina en **`/exec`**.
4. Pásame esa dirección: se pega en `config.js` (`backendUrl`) y el sitio queda conectado.

## Cómo se usa el día a día
- La recepción mira la hoja **Citas** y cambia **Estado**: Pendiente → Confirmada / Atendida / No asistió / Cancelada.
- Al poner **Cancelada** el evento se borra del calendario y la hora vuelve a quedar libre en el sitio.
- Los horarios, el máximo de citas por día y los correos se cambian en la pestaña **Configuración**, sin tocar el sitio.
- La pestaña **Resumen** cuenta las citas por sede y estado.

## Qué incluye y qué no
- Incluye: hoja de citas, evento en calendario con invitación, correo a la sede, recordatorio por correo, horas ocupadas en el sitio, máximo por día.
- No incluye: recordatorios por **WhatsApp** (requiere WhatsApp Business API, es un servicio de pago aparte) ni mensajes de SMS.
- Límites gratuitos de Google: unos 100 correos al día con una cuenta gratuita (1.500 con Google Workspace). Alcanza para el volumen normal de una clínica.
- Cualquier persona puede enviar citas a la dirección pública; el script valida todo, evita horas repetidas, limita a 3 citas pendientes por celular y respeta los topes.
