# Impuestos Paraguay Marangatu

Automatizacion visible con Playwright para preparar formularios mensuales en Marangatu.

Estado actual:

- Login validado en Chrome visible.
- F120 validado hasta `211 - IVA General - MENSUAL`, seleccion de ano/mes y `Abrir Declaracion`.
- F241 localizado en menu, pero la accion interna aun no quedo estable; el script se detiene ahi en `dry-run`.

## Configuracion

Instalar dependencias:

```powershell
npm.cmd install
```

Si Playwright no tiene navegador instalado:

```powershell
npx.cmd playwright install chromium
```

Crear `.env` desde `.env.example`:

```env
MARANGATU_USER=tu_usuario
MARANGATU_PASSWORD=tu_password
MARANGATU_HEADLESS=false
MARANGATU_SUBMIT=false
MARANGATU_ARTIFACTS_DIR=artifacts
MARANGATU_SLOWMO_MS=120
MARANGATU_EXPECTED_NAME=
MARANGATU_F241_GESTION_URL=
```

`MARANGATU_SUBMIT=false` es deliberado: prepara el flujo, toma capturas y evita pulsar botones finales de presentacion. F241 selecciona ano/mes, pero si encuentra talones pendientes el boton final sigue bloqueado hasta validar ese selector.

## Ejecucion Rapida

Prueba visible sin presentar:

```powershell
npm.cmd run dry-run
```

Tests de calculo de periodo:

```powershell
npm.cmd test
```

Limpiar capturas/HTML sensibles guardados en `artifacts/`:

```powershell
npm.cmd run clean:artifacts
```

Probar solo F120 para un periodo concreto:

```powershell
node src/marangatu.js --year 2026 --month 5 --dry-run --skip-f241
```

Probar solo el menu F241:

```powershell
node src/marangatu.js --year 2026 --month 5 --dry-run --skip-f120
```

Ejecucion real de F120 cuando el flujo este validado:

```powershell
node src/marangatu.js --year 2026 --month 5 --submit --skip-f241
```

## Programacion Mensual

Registrar tarea de Windows:

```powershell
npm.cmd run register-task
```

La tarea revisa cada 30 minutos, pero solo ejecuta cuando en Madrid son las `12:00` del dia `1`. Guarda `.state/last-run.txt` para no repetir el mismo mes.

Importante: la tarea no pasa `--submit`; solo presentara si la maquina de ejecucion tiene `MARANGATU_SUBMIT=true`. No actives esa variable hasta que F241 este validado o uses `--skip-f241` en una ejecucion manual de F120.

## Flujo Validado

Login:

- URL: `https://marangatu.set.gov.py/eset/login`
- Campo usuario: `input[placeholder="Usuario"]`
- Campo password: `input[type="password"]`
- Boton: `Acceder`

F120:

- Entrar al home `https://marangatu.set.gov.py/eset/`
- Abrir enlace comun `Presentar Declaracion`
- El `href` real cambia por sesion y debe leerse del DOM
- Seleccionar obligacion `211 - IVA General - MENSUAL`
- Seleccionar `Ano`
- Seleccionar `Mes`
- Pulsar `Abrir Declaracion`
- El boton final `Presentar Declaracion` queda protegido por `--submit`

F241:

- Entrar al home
- Abrir `gestionComprobantesVirtuales.do?_cyp=...`
- Click/doble click en la tarjeta `Confirmar Presentación`
- Se abre `gdi/presentacionTalonResumen.do?_cyp=...`
- Seleccionar `select[name="anho"]`
- Seleccionar `select[name="mes"]`
- Si aparece `No existen talones pendientes de presentación`, no hay nada que confirmar
- Si hay talones pendientes, el codigo falla antes del boton final hasta validar ese selector

## Capturas y Evidencia

Cada ejecucion deja evidencia en `artifacts/`:

- PNG de cada paso relevante
- HTML de cada checkpoint

Usa esas capturas para ajustar selectores sin volver a explorar desde cero.

Cuando ya no las necesites, limpia `artifacts/` con `npm.cmd run clean:artifacts`; pueden contener datos fiscales visibles del portal.
