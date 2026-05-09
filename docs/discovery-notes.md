# Discovery Notes

Fecha de exploracion: 2026-05-09.

## Chrome

El plugin de Chrome finalmente funciono en este proyecto. Se verifico abriendo `https://www.marca.com/` y despues `https://marangatu.set.gov.py/eset/login`.

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

Esto permite detectar si el F120 del periodo ya aparece en "Ultimas Declaraciones".

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
DV 3
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

La opcion aparece visualmente en el menu lateral, pero durante esta exploracion no expuso un `href` directo ni disparo navegacion detectable con clicks automatizados. Para la siguiente sesion, el camino mas rapido es:

1. Abrir Chrome con sesion iniciada.
2. Ir al home.
3. Abrir segunda entrada `Declaraciones Informativas`.
4. Hacer click manual en `Gestion De Comprobantes Informativos`.
5. Capturar URL final, HTML y/o request de red.
6. Codificar esa ruta en `openInformativeReceipts`.

Hasta que ese paso este validado, el script debe fallar si `F241` se ejecuta con `--submit`.
