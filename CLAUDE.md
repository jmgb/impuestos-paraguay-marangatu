# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Qué es este proyecto

Automatización Playwright (Node.js, ESM) que prepara las declaraciones mensuales de un contribuyente paraguayo en el portal Marangatu de la SET (`https://marangatu.set.gov.py/eset/`). Se ejecuta desde Windows con Chrome **visible** (no headless por defecto) y deja capturas + HTML de cada paso en `artifacts/` para depurar selectores sin volver a explorar el portal a mano.

## Obligación mensual

**Cada mes, antes del día 13**, hay que presentar **dos formularios** por el período del **mes anterior** al de ejecución. La automatización cubre ambos; el orden y los pasos exactos del portal son:

**Regla de período por defecto** (sin `--year/--month`): año = año actual, mes = mes actual − 1. Excepción: si el mes actual es **enero**, el período es **diciembre del año anterior**. Ejemplo: ejecutado en mayo 2026 → presenta abril 2026; ejecutado en enero 2026 → presenta diciembre 2025. La función `previousMonthPeriod` usa **hora local** (la máquina Windows corre en TZ Madrid) para evitar que una ejecución de madrugada el día 1 caiga al mes equivocado por desfase UTC.

**Ventana de ejecución programada**: la tarea de Windows debe lanzar la automatización a las **12:00 hora de Madrid** del **día 1 de cada mes**. La tarea registrada por `scripts/register-task.ps1` se dispara cada 30 minutos como mecanismo de reintento (por si la máquina está apagada/dormida a las 12:00 exactas), y `scripts/run-monthly-check.ps1` filtra: sólo lanza Node cuando en TZ Madrid (`Romance Standard Time`) es **día 1 a las 12:xx** y `.state/last-run.txt` no contiene aún el `yyyy-MM` actual. Resultado: una sola ejecución por mes, lo más cerca posible del 1 a las 12:00 Madrid. Esto deja margen suficiente antes del **día 13**, fecha límite legal de presentación.

### Formulario 120 — IVA General Mensual

1. Menú **Declaraciones Juradas y Pagos**
2. **Presentar Declaración**
3. Obligación **`211 - IVA General - MENSUAL`**
4. Seleccionar **Año** y **Mes**
5. **Abrir Declaración**
6. **Presentar Declaración** (botón final, sólo con `--submit`)

### Formulario 241 — Comprobantes Informativos

1. Menú **Declaraciones Informativas**
2. **Gestión de Comprobantes Informativos**
3. Seleccionar **Año** y **Mes**
4. **Confirmar Presentación** (botón final, sólo con `--submit`)

Estado del flujo automatizado: F120 llega hasta `Abrir Declaración` en `dry-run` y, con `--submit`, intenta el botón final + confirmación. F241 abre `gestionComprobantesVirtuales.do?_cyp=...`, entra a la tarjeta `Confirmar Presentación`, selecciona `select[name="anho"]` y `select[name="mes"]`, espera a que aparezca `button[data-ng-click^="vm.procesar"]` (texto `Presentar declaración`) y, sólo con `--submit`, lo pulsa y acepta el pop-up final (`button.btn-primary[type="button"]` con texto `Aceptar`). En `dry-run` se detiene en el checkpoint `09-f241-submit-ready` sin pulsar nada.

## Comandos

```powershell
npm.cmd install
npx.cmd playwright install chromium     # solo si falta el navegador

npm.cmd run dry-run                     # corrida visible sin presentar
npm.cmd test                            # tests de periodo + estado local
npm.cmd run clean:artifacts             # borra capturas/HTML locales sensibles
node src/marangatu.js --year 2026 --month 5 --dry-run --skip-f241   # solo F120
node src/marangatu.js --year 2026 --month 5 --dry-run --skip-f120   # solo F241
node src/marangatu.js --year 2026 --month 5 --submit --skip-f241    # presentación real F120
node src/marangatu.js --year 2026 --month 5 --submit --force        # bypassa estado local (presentado/error previo)
npm.cmd run register-task               # registra la tarea programada de Windows
```

Sin `--year/--month` el script usa el **mes anterior** (`previousMonthPeriod`).

Hay una prueba ligera de cálculo de período en `scripts/test-period.mjs`. La validación funcional sigue siendo ejecutar el dry-run y revisar los PNG/HTML en `artifacts/`.

## Arquitectura clave

**Punto de entrada único**: `src/marangatu.js` (ESM, Playwright + dotenv). Todo el flujo vive en ese archivo: parseo de args, login, F120, F241, checkpoints. No hay capa de abstracción de páginas — los selectores están inline.

**Doble seguro contra presentación accidental**: el envío real sólo ocurre si `--submit` o `MARANGATU_SUBMIT=true` Y `--dry-run` está ausente (ver `main()`). Es deliberado: `MARANGATU_SUBMIT=false` en `.env` es la postura por defecto. **No quitar estos guardarraíles al refactorizar.**

**Estado local por (período, formulario)**: en modo `submit` cada formulario se envuelve con `runFormWithStateTracking`, que persiste en `.state/forms.json` el estado `iniciado` → `presentado` (o `error` con mensaje). Antes de correr, lee el estado previo:
- `presentado` → salta el formulario (use `--force` para reintentar deliberadamente).
- `error` → **lanza excepción** (hay que revisar `artifacts/` y reintentar con `--force`).
- En `dry-run` el estado **no se lee ni se escribe**, para no contaminarlo durante pruebas.

Esto complementa `maybeAlreadyPresented` (que consulta el portal) con un guardarraíl local independiente, especialmente útil cuando un envío queda a medias por error de red o crash.

**Selectores frágiles y sesión-dependientes**:
- El `href` real de `Presentar Declaracion` cambia por sesión (`recibirDDJJContribuyente.do?_cyp=...`). Hay que leerlo del DOM cada vez (`findCommonOptionHref`).
- Los textos del portal usan acentos inconsistentes; el código a veces usa regex `Declaraci.n` para tolerar `ó` / `o`. Mantener ese patrón al añadir selectores.
- Los `<select>` se localizan por **una opción visible conocida** (`selectByVisibleOption`), no por id/name, porque el portal no expone IDs estables.
- Antes de preparar F120 se chequea si `MM/YYYY` ya aparece en "Últimas Declaraciones" del home (`maybeAlreadyPresented`) para evitar duplicados.

**Checkpoints**: cada paso relevante llama `checkpoint(page, "NN-nombre")`, que guarda PNG full-page + HTML en `artifacts/`. Mantener la numeración secuencial al añadir pasos — los archivos quedan ordenados alfabéticamente y eso es la herramienta principal de debug.

**Artifacts sensibles**: `artifacts/` esta gitignored, pero puede contener datos fiscales. Usar `npm.cmd run clean:artifacts` cuando las capturas/HTML ya no sean necesarios.

**Justificantes de presentación**: cuando una corrida con `--submit` completa F120 o F241 con éxito, `saveJustificante` guarda la captura final como `presentaciones/YYYY-MM/F120.png` (o `F241.png`). El subdirectorio del período se crea sólo cuando se presenta — es la prueba legal de que la declaración salió. El path se incluye en el mensaje Telegram. La carpeta `presentaciones/` está trackeada (vía `.gitkeep`), pero su contenido está gitignored. Configurable con `MARANGATU_PRESENTACIONES_DIR`. **Distinta semántica que `artifacts/`**: `artifacts/` es debug volátil que se borra; `presentaciones/` es archivo legal que se conserva.

**Programación mensual (Windows)**: `scripts/register-task.ps1` registra una tarea que ejecuta `run-monthly-check.ps1` cada 30 minutos. El script PowerShell sólo lanza Node si en **zona horaria Madrid** (`Romance Standard Time`) son las 12:00 del día 1, y guarda `.state/last-run.txt` con clave `yyyy-MM` para no repetir el mismo mes. Node calcula el período con `Europe/Madrid`, no con la zona local implícita. Si se cambia la ventana o la TZ, hay que actualizar esa lógica, no la tarea programada.

## Convenciones

- Si se añaden nuevos formularios, replicar la estructura `prepareFormularioXXX(page, period, submit)` y respetar el patrón "abrir home → leer href dinámico → seleccionar período → checkpoint → click protegido por `submit`".
- `safeClick` valida que el botón no esté `disabled` antes de cliquear; usarla siempre en lugar de `locator.click()` directo.
- Variables de entorno se leen vía `env(name, fallback)` / `boolEnv(name, fallback)`. `env` lanza si falta y no hay fallback.
- Las credenciales viven en `.env` (gitignored). `.env.example` documenta las variables esperadas.

## Notificaciones Telegram

Al final de `main()` se envía **un solo mensaje** a Telegram con el resumen por formulario (período, estado `presentado`/`error`/`ya presentado`, modo `submit`/`dry-run`). Se dispara cuando:
- el modo es `submit` (notificación normal de presentación), **o**
- ocurrió cualquier error durante la corrida (visibilidad de fallos en ejecuciones automáticas).

Dry-runs sin errores **no notifican**, para evitar ruido durante pruebas.

Configuración (en `.env`):
- `MARANGATU_TELEGRAM_TOKEN` — token del bot.
- `MARANGATU_TELEGRAM_CHAT_ID` — chat o canal destinatario.

Si falta cualquiera de las dos variables, el envío se salta silenciosamente con un log claro. La implementación (`sendTelegramMessage`) usa `fetch` nativo, parse mode `HTML`, escape conservador (`&` `<` `>`) y reintento básico ante 429/red. Inspirada en `presupuestor/backend/app/services/telegram_service.py` pero simplificada: un único mensaje por corrida, sin chunking ni `ThreadPoolExecutor` (no aplica en un script de un solo paso).
