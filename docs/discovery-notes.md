# Discovery Notes

Exploración inicial: 2026-05-09. Última actualización funcional: 2026-09-01.

## Login Marangatu

DOM observado:

```text
textbox "Usuario"
textbox "Contraseña"
button "Acceder"
```

Despues del login, el home mostro:

```text
NOMBRE DEL CONTRIBUYENTE
RUC_DEL_CONTRIBUYENTE
Formulario 120
04/2026
03/2026
02/2026
01/2026
```

Los nombres, identificadores y valores fiscales se sustituyen aquí por marcadores. Los checkpoints reales no deben publicarse.

## F120

El enlace `Presentar Declaracion` aparece en `Opciones mas comunes`, con `href` interno parecido a:

```text
recibirDDJJContribuyente.do?_cyp=...
```

Ese token cambia por sesion, asi que el script debe leer el `href` del DOM y abrirlo.

Pantalla observada:

```text
heading "Presentar Declaración"
RUC prellenado
DV prellenado
Obligación
option "211 - IVA General - MENSUAL"
Periodo MENSUAL
Año 2026, 2025, ...
Mes Enero, Febrero, Marzo, Abril, ...
button "Abrir Declaración"
```

## F241

La ruta de menu observada fue:

```text
Declaraciones Informativas
Gestion De Comprobantes Informativos
```

La opción puede no exponer un `href` estable. El script intenta obtener la ruta dinámica del HTML o del modelo Angular y, como último recurso, pulsa la tarjeta visible.

La URL correcta de gestion capturada fue:

```text
gestionComprobantesVirtuales.do?_cyp=...
```

La tarjeta `Confirmar Presentación` abre una nueva pestana:

```text
gdi/presentacionTalonResumen.do?_cyp=...
```

La pantalla de talon contiene:

```html
<select name="anho">...</select>
<select name="mes">...</select>
```

Para el periodo probado, tras elegir ano/mes la pantalla mostro:

```text
No existen talones pendientes de presentación
```

Si aparecen talones pendientes, el dry-run verifica la presencia del botón final sin pulsarlo. El modo real pulsa `Presentar declaración`, acepta el diálogo y vuelve a consultar el mismo período. Solo se considera correcto cuando el portal muestra que ya no existen talones pendientes.

## Verificación final

F120 solo se considera presentado si `Consultar Declaraciones` devuelve una fila del período y formulario esperados, activa y en un estado terminal aceptado. F241 usa la comprobación independiente de talones pendientes. Estas verificaciones ocurren antes de las notificaciones de éxito.
