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
```

`MARANGATU_SUBMIT=false` es deliberado: prepara el flujo, toma capturas y evita pulsar botones finales de presentacion. Para presentar realmente, usa `--submit` o `MARANGATU_SUBMIT=true`.

## Ejecucion Rapida

Prueba visible sin presentar:

```powershell
npm.cmd run dry-run
```

Probar solo F120 para un periodo concreto:

```powershell
node src/marangatu.js --year 2026 --month 5 --dry-run --skip-f241
```

Probar solo el menu F241:

```powershell
node src/marangatu.js --year 2026 --month 5 --dry-run --skip-f120
```

Ejecucion real cuando el flujo este validado:

```powershell
node src/marangatu.js --year 2026 --month 5 --submit
```

## Programacion Mensual

Registrar tarea de Windows:

```powershell
npm.cmd run register-task
```

La tarea revisa cada 30 minutos, pero solo ejecuta cuando en Madrid son las `12:00` del dia `1`. Guarda `.state/last-run.txt` para no repetir el mismo mes.

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
- Abrir la segunda entrada de menu `Declaraciones Informativas`
- Opcion visible: `Gestion De Comprobantes Informativos`
- Durante la exploracion, el DOM no expuso `href` estable para esa opcion y el click no cambio de pantalla
- Siguiente mejora: capturar evento JavaScript o request de red al hacer click manualmente en Chrome

## Capturas y Evidencia

Cada ejecucion deja evidencia en `artifacts/`:

- PNG de cada paso relevante
- HTML de cada checkpoint

Usa esas capturas para ajustar selectores sin volver a explorar desde cero.
