# Agenda Dr. Rivas · puesta en marcha (≈ 15 minutos)

Cada cita que se agenda en el sitio queda como **una fila en la pestaña de su sede**
(`Citas Yopal`, `Citas Aguazul` o `Citas Bogotá`). El paciente recibe un **correo de "tu cita quedó guardada"**
y, un día antes, un **recordatorio**. Las horas tomadas aparecen con candado en el sitio para todos.
**No usa Google Calendar** (eso queda como servicio adicional futuro).

> Hazlo con la cuenta de Google **de la clínica** (será la dueña de la hoja y desde donde salen los correos).

## 1. La hoja
1. En Google Drive: **Nuevo → Subir archivo** → `Agenda_Dr_Rivas_PLANTILLA.xlsx`.
2. Ábrelo y elige **Archivo → Guardar como hoja de cálculo de Google**.
3. **Archivo → Configuración**: zona horaria **(GMT-05:00) Bogotá** → *Guardar y volver a cargar*.
4. Pestaña **Configuración**: horarios reales de cada sede y, si quieren aviso por correo de cada cita, el correo de la sede (opcional; varios separados por coma).

## 2. El script
1. **Extensiones → Apps Script**. Borra lo que haya y pega todo `Code.gs`.
2. Guarda. Elige la función **`instalar`** y pulsa **Ejecutar**; acepta los permisos
   (hoja de cálculo, enviar correos, tarea diaria). Crea las pestañas por sede y activa el recordatorio de las 8 a. m.

## 3. Publicar
1. **Implementar → Nueva implementación → Aplicación web**. *Ejecutar como*: **Yo**. *Acceso*: **Cualquier usuario**.
2. Copia la dirección que termina en **`/exec`** y pégala en `config.js` (`backendUrl`).

## Uso diario
- Cada sede mira **su pestaña** y cambia **Estado**: Pendiente (amarillo) → Confirmada (azul) / Atendida (verde) / No asistió (gris) / Cancelada (rojo). La fila completa cambia de color.
- **Cancelada** libera la hora en el sitio.
- Horarios, máximo de citas por día y correos se cambian en **Configuración**, sin tocar el sitio.
- La pestaña **Resumen** cuenta las citas por sede y estado.

## Columnas de cada pestaña
ID · Registrada (cuándo se agendó) · Sede · Fecha de la cita · Hora · Tipo de cita · Nombre · Celular · Correo del paciente · Estado · Notas (uso interno).

## Qué correo es cuál
| Correo | Dónde | Para qué |
|---|---|---|
| **Del paciente** | Formulario del sitio (opcional) | Recibe "tu cita quedó guardada" y el recordatorio de un día antes. |
| **De la sede** | Hoja *Configuración* (opcional, uno o varios) | Recibe el aviso de cada cita nueva. Vacío = no se avisa por correo; la sede solo mira su pestaña. |
| **Cuenta de Google que publica el script** | La que instala | Es la **remitente**: de ahí salen todos los correos. Debe ser la de la clínica. |

## Límites
- Sin recordatorios por **WhatsApp** (requiere WhatsApp Business API, servicio aparte).
- Cuentas gratuitas de Google: ~100 correos al día (1.500 con Workspace).
- La dirección pública acepta citas de cualquiera, pero el script valida todo, evita horas repetidas y limita a 3 citas pendientes por celular.
