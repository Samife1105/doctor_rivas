"""Genera la plantilla de Excel (v4: una pestaña de citas por sede, sin calendario)."""
import os
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.formatting.rule import FormulaRule

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'Agenda_Dr_Rivas_PLANTILLA.xlsx')
head_fill = PatternFill('solid', fgColor='0A0A0A')
head_font = Font(bold=True, color='FFFFFF')
soft = PatternFill('solid', fgColor='EFECE5')
thin = Side(style='thin', color='DDDDDD')
ESTADOS = ('Pendiente', 'Confirmada', 'Atendida', 'No asistió', 'Cancelada')
COLORES = (('Pendiente', 'FFF4CC', '5B4B00'), ('Confirmada', 'DCEBFF', '12365F'), ('Atendida', 'D3EFD8', '14532D'),
           ('No asistió', 'E6E6E6', '6B6B6B'), ('Cancelada', 'F8D7D3', '8A2F27'))
SEDES = (('yopal', 'Yopal', 'Citas Yopal', '573134693232', 'Carrera 24 con Calle 12, esquina diagonal al Edificio Luma'),
         ('aguazul', 'Aguazul', 'Citas Aguazul', '573207451448', 'Carrera 18A #10-24'),
         ('bogota', 'Bogotá', 'Citas Bogotá', '573207671072', 'Autopista Norte con Calle 106'))
COLS = [('ID', 16), ('Registrada', 19), ('Sede', 11), ('Fecha de la cita', 16), ('Hora', 9), ('Tipo de cita', 22),
        ('Nombre', 28), ('Celular', 14), ('Correo', 30), ('Estado', 14), ('Notas (uso interno)', 30)]

wb = Workbook()

# ---------------------------------------------------------------- Instrucciones
ins = wb.active
ins.title = 'Instrucciones'
ins.column_dimensions['A'].width = 115
lines = [
    ('AGENDA DR. RIVAS · PLANTILLA', True), ('', False),
    ('1. Sube este archivo a Google Drive y ábrelo con Hojas de cálculo de Google (Archivo > Guardar como hoja de cálculo de Google).', False),
    ('2. En Archivo > Configuración pon la zona horaria en (GMT-05:00) Bogotá.', False),
    ('3. Completa la hoja "Configuración": horarios reales y, si quieres, un correo por sede para recibir el aviso de cada cita.', False),
    ('4. Sigue la guía LEEME.md para pegar el script y publicarlo. Al final te da una dirección web que se conecta al sitio.', False),
    ('5. Cada cita que se agende queda como una fila nueva en la pestaña de SU sede: "Citas Yopal", "Citas Aguazul" o "Citas Bogotá".', False),
    ('', False),
    ('QUÉ HACE LA RECEPCIÓN', True),
    ('• Cambia la columna "Estado": Pendiente (amarillo) → Confirmada (azul) / Atendida (verde) / No asistió (gris) / Cancelada (rojo). La fila completa cambia de color.', False),
    ('• Si pones "Cancelada", la hora vuelve a quedar libre en el sitio.', False),
    ('• Puedes escribir en "Notas (uso interno)". No cambies las demás columnas.', False),
    ('', False),
    ('QUÉ HACE SOLO EL SISTEMA', True),
    ('• Guarda cada cita en la pestaña de su sede, evita horas repetidas y respeta el máximo de citas por día.', False),
    ('• Le manda al paciente un correo: "tu cita quedó guardada" (si dejó su correo).', False),
    ('• Avisa a la sede por correo (si pusiste un correo en Configuración).', False),
    ('• Un día antes, le recuerda la cita al paciente por correo.', False),
]
for i, (t, b) in enumerate(lines, start=1):
    c = ins.cell(row=i, column=1, value=t)
    c.alignment = Alignment(wrap_text=True, vertical='top')
    if b:
        c.font = Font(bold=True, size=13 if i == 1 else 11)

# ---------------------------------------------------------------- Citas por sede
for key, nombre, hoja, wa, dire in SEDES:
    ws = wb.create_sheet(hoja)
    for i, (name, w) in enumerate(COLS, start=1):
        c = ws.cell(row=1, column=i, value=name)
        c.fill, c.font = head_fill, head_font
        c.alignment = Alignment(vertical='center', wrap_text=True)
        ws.column_dimensions[chr(64 + i)].width = w
    ws.row_dimensions[1].height = 32
    ws.freeze_panes = 'A2'
    dv = DataValidation(type='list', formula1='"%s"' % ','.join(ESTADOS), allow_blank=True)
    ws.add_data_validation(dv)
    dv.add('J2:J1000')
    for estado, bg, fg in COLORES:
        ws.conditional_formatting.add('A2:K1000', FormulaRule(formula=['$J2="%s"' % estado], fill=PatternFill('solid', bgColor=bg, fgColor=bg), font=Font(color=fg)))

# ---------------------------------------------------------------- Configuración
cf = wb.create_sheet('Configuración')
cf.column_dimensions['A'].width = 52
for col, w in zip('BCDE', (22, 40, 18, 52)):
    cf.column_dimensions[col].width = w
cf['A1'] = 'CONFIGURACIÓN DE LA AGENDA  (edita solo las celdas con fondo gris)'; cf['A1'].font = Font(bold=True, size=13)
cf['A2'] = 'Los cambios se reflejan en el sitio en pocos minutos. No cambies el orden de filas ni columnas.'; cf['A2'].font = Font(italic=True, color='666666')
cf['A3'] = 'Parámetros'; cf['A3'].font = Font(bold=True, size=13)
params = [('Días de anticipación máximos para agendar', 30), ('Horas mínimas de anticipación', 2),
          ('Máximo de citas por día en cada sede', 20), ('Duración de cada cita (minutos)', 30),
          ('Nombre que ven los pacientes en los correos', 'Clínica Dr. Rivas'),
          ('Correo interno que recibe copia de todas las citas (opcional)', '')]
for i, (k, v) in enumerate(params, start=4):
    cf.cell(row=i, column=1, value=k)
    c = cf.cell(row=i, column=2, value=v); c.fill = soft; c.border = Border(bottom=thin)
cf['A11'] = 'Sedes'; cf['A11'].font = Font(bold=True, size=13)
for j, h in enumerate(['Clave (no cambiar)', 'Nombre', 'Correo(s) de la sede para el aviso de cada cita (opcional; separa varios con coma)', 'WhatsApp', 'Dirección'], start=1):
    c = cf.cell(row=12, column=j, value=h); c.fill, c.font = head_fill, head_font
    c.alignment = Alignment(wrap_text=True, vertical='center')
cf.row_dimensions[12].height = 46
for i, (key, nombre, hoja, wa, dire) in enumerate(SEDES, start=13):
    for j, v in enumerate((key, nombre, '', wa, dire), start=1):
        c = cf.cell(row=i, column=j, value=v); c.border = Border(bottom=thin)
        if j == 3:
            c.fill = soft
cf['A18'] = 'Horarios de atención por sede (formato 24 h, ej. 08:00 y 18:00; vacío = cerrado)'; cf['A18'].font = Font(bold=True, size=13)
for j, h in enumerate(['Sede (no cambiar)', 'Día (no cambiar)', 'Desde', 'Hasta'], start=1):
    c = cf.cell(row=19, column=j, value=h); c.fill, c.font = head_fill, head_font
dias = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']
r = 20
for key, *_ in SEDES:
    for d_i, d in enumerate(dias):
        cf.cell(row=r, column=1, value=key); cf.cell(row=r, column=2, value=d)
        desde, hasta = ('08:00', '18:00') if d_i <= 4 else (('08:00', '12:00') if d_i == 5 else ('', ''))
        for col, v in ((3, desde), (4, hasta)):
            c = cf.cell(row=r, column=col, value=v); c.fill = soft; c.number_format = '@'; c.alignment = Alignment(horizontal='center')
        r += 1
cf['E19'] = 'Nota: los horarios de ejemplo (L-V 8:00-18:00, sábados 8:00-12:00) son provisionales; confírmalos con cada sede.'
cf['E19'].font = Font(italic=True, color='B3261E'); cf['E19'].alignment = Alignment(wrap_text=True, vertical='top')

# ---------------------------------------------------------------- Resumen
rs = wb.create_sheet('Resumen')
rs.column_dimensions['A'].width = 26
for col in 'BCDEF':
    rs.column_dimensions[col].width = 14
rs['A1'] = 'RESUMEN DE CITAS'; rs['A1'].font = Font(bold=True, size=13)
rs['A3'] = 'Sede'
for j, e in enumerate(ESTADOS, start=2):
    rs.cell(row=3, column=j, value=e)
for c in rs[3]:
    if c.value:
        c.fill, c.font = head_fill, head_font
for i, (key, nombre, hoja, wa, dire) in enumerate(SEDES, start=4):
    rs.cell(row=i, column=1, value=nombre)
    for j, e in enumerate(ESTADOS, start=2):
        rs.cell(row=i, column=j, value="=COUNTIF('%s'!$J$2:$J$1000,%s$3)" % (hoja, chr(64 + j)))
hoy = '+'.join("COUNTIFS('%s'!$D$2:$D$1000,TODAY(),'%s'!$J$2:$J$1000,\"<>Cancelada\")" % (s[2], s[2]) for s in SEDES)
man = '+'.join("COUNTIFS('%s'!$D$2:$D$1000,TODAY()+1,'%s'!$J$2:$J$1000,\"<>Cancelada\")" % (s[2], s[2]) for s in SEDES)
rs['A8'] = 'Citas de hoy'; rs['A8'].font = Font(bold=True); rs['B8'] = '=' + hoy
rs['A9'] = 'Citas de mañana'; rs['A9'].font = Font(bold=True); rs['B9'] = '=' + man

wb.save(OUT)
print('ok', OUT)
