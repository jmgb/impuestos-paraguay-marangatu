# Impuestos Paraguay Marangatu

Automatización visible con Playwright para preparar y verificar los formularios mensuales F120 y F241 en el portal Marangatu de Paraguay.

> [!WARNING]
> Este proyecto está adaptado a un flujo fiscal concreto. No calcula impuestos, no valida importes y no sustituye el asesoramiento de un profesional tributario. El modo real puede presentar declaraciones con efectos legales: revisa siempre el período, las obligaciones y el contenido mostrado por Marangatu antes de utilizarlo.

## Alcance

El período predeterminado es siempre el mes natural anterior calculado en `Europe/Madrid`. El flujo:

- inicia sesión en Marangatu;
- prepara F120 para la obligación `211 - IVA General - MENSUAL`;
- prepara F241 desde `Gestión de Comprobantes Informativos`;
- en dry-run llega hasta las acciones finales sin pulsarlas;
- en modo real exige una confirmación explícita del período;
- verifica F120 en `Consultar Declaraciones` y F241 mediante la ausencia de talones pendientes;
- guarda checkpoints locales y puede notificar el resultado por Telegram y Gmail.

La automatización no rellena ni corrige datos fiscales. Presenta el contenido que el portal haya generado para la obligación y el período seleccionados.

## Guardarraíles

El comportamiento predeterminado es `dry-run`. Una presentación real exige simultáneamente:

1. ejecutar el comando `submit`;
2. confirmar el período exacto con `--confirm-period YYYY-MM`;
3. activar `MARANGATU_SUBMIT=true`, algo que hace el launcher únicamente para el proceso supervisado.

`--dry-run` y `--submit` son excluyentes. La tarea mensual nunca activa el modo real y `--force` no está permitido en el launcher de presentación.

La automatización no intenta superar CAPTCHA, MFA ni otros controles del portal. Si aparecen, detén el flujo y complétalos manualmente solo si estás autorizado.

## Requisitos

- Node.js 20 o posterior.
- npm.
- Chromium instalado mediante Playwright.
- Una cuenta propia y autorizada de Marangatu.
- Windows para registrar la tarea mensual incluida. El flujo manual funciona también en WSL, Linux y macOS.

La versión validada localmente usa Node.js 22.

## Instalación

```bash
git clone https://github.com/jmgb/impuestos-paraguay-marangatu.git
cd impuestos-paraguay-marangatu
npm ci
npx playwright install chromium
cp .env.example .env
```

En PowerShell, sustituye la última línea por:

```powershell
Copy-Item .env.example .env
```

Completa como mínimo estas variables en el `.env` privado:

```env
MARANGATU_USER=
MARANGATU_PASSWORD=
MARANGATU_HEADLESS=false
MARANGATU_SUBMIT=false
```

No copies credenciales ni tokens dentro del código. `.env` está ignorado por Git.

## Configuración

El archivo [.env.example](.env.example) contiene todas las opciones disponibles.

| Variable | Uso | Predeterminado |
| --- | --- | --- |
| `MARANGATU_USER` | Usuario de Marangatu | Obligatoria |
| `MARANGATU_PASSWORD` | Contraseña de Marangatu | Obligatoria |
| `MARANGATU_HEADLESS` | Ejecutar Chromium sin interfaz | `false` |
| `MARANGATU_SUBMIT` | Segundo interlock del modo real | `false` |
| `MARANGATU_SLOWMO_MS` | Pausa visual entre acciones | `120` |
| `MARANGATU_EXPECTED_NAME` | Texto opcional para validar la cuenta | Vacío |
| `MARANGATU_ARTIFACTS_DIR` | Checkpoints de depuración | `artifacts` |
| `MARANGATU_PRESENTACIONES_DIR` | Justificantes locales | `presentaciones` |
| `MARANGATU_F241_GESTION_URL` | Fallback opcional si cambia el menú | Vacío |
| `MARANGATU_TELEGRAM_ENABLED` | Interruptor maestro de Telegram | `false` |
| `MARANGATU_EMAIL_ENABLED` | Interruptor maestro de Gmail | `false` |

`MARANGATU_F241_GESTION_URL` no debe contener una URL de sesión persistida. El script intenta descubrir siempre la ruta dinámica desde el portal.

Como opción avanzada, `MARANGATU_PROJECT_ROOT` puede definirse en el entorno del proceso para que el launcher use otro checkout. No se lee desde `.env`, ya que se utiliza precisamente para localizar el proyecto.

## Uso

Dry-run visible del mes anterior:

```bash
npm run dry-run
```

Dry-run de un único formulario y período explícito:

```bash
node src/marangatu.js --year 2026 --month 5 --dry-run --skip-f241
node src/marangatu.js --year 2026 --month 5 --dry-run --skip-f120
```

Validar los interlocks del modo real sin abrir Marangatu:

```bash
npm run submit -- --confirm-period 2026-08 --check
```

Presentación real supervisada:

```bash
npm run submit -- --confirm-period 2026-08
```

Sustituye `2026-08` por el mes natural anterior vigente en Madrid. El launcher rechaza períodos distintos.

Ejecutar los tests locales:

```bash
npm test
```

## Notificaciones

Las notificaciones se controlan por separado y están desactivadas por defecto.

### Telegram

```env
MARANGATU_TELEGRAM_ENABLED=true
MARANGATU_TELEGRAM_TOKEN=
MARANGATU_TELEGRAM_CHAT_ID=
MARANGATU_TELEGRAM_NOTIFY_DRY_RUN=false
```

Con el interruptor maestro activo, Telegram avisa en presentaciones reales y ejecuciones con error. `MARANGATU_TELEGRAM_NOTIFY_DRY_RUN=true` añade los dry-runs correctos.

### Gmail

```env
MARANGATU_EMAIL_ENABLED=true
MARANGATU_GMAIL_FROM=
MARANGATU_GMAIL_TO=
```

El correo solo se envía después de una presentación real sin errores, con al menos un formulario nuevo presentado y verificado. Nunca se envía en dry-run. `.state/email-notifications.json` evita duplicados por período.

Las credenciales OAuth pueden configurarse directamente:

```env
MARANGATU_GMAIL_CLIENT_ID=
MARANGATU_GMAIL_CLIENT_SECRET=
MARANGATU_GMAIL_REFRESH_TOKEN=
```

O leerse desde otro archivo `.env` privado:

```env
MARANGATU_GMAIL_CREDENTIALS_ENV=/ruta/absoluta/al/archivo/.env
MARANGATU_GMAIL_REFRESH_TOKEN_ENV=GOOGLE_REFRESH_TOKEN
```

El archivo externo debe contener `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` y la variable de refresh token indicada.

## Programación mensual

La programación incluida es para Windows Task Scheduler:

```powershell
npm.cmd run register-task
```

La tarea se activa a las 12:00 y 12:30, pero `scripts/run-monthly-check.ps1` solo ejecuta Node cuando en Madrid es el día 1 entre las 12:00 y las 12:59. `.state/last-run.txt` evita repetir el mismo mes.

La ejecución programada usa siempre `--dry-run`. La presentación real no se programa ni se reintenta automáticamente.

## Evidencia y privacidad

- `artifacts/` contiene capturas y HTML de depuración potencialmente sensibles.
- `presentaciones/YYYY-MM/` contiene justificantes de una presentación real.
- `.state/forms.json` conserva el estado local para evitar duplicados.
- `.env`, `.state/`, `artifacts/` y los justificantes están ignorados por Git.

En Windows puedes limpiar los checkpoints de depuración con:

```powershell
npm.cmd run clean:artifacts
```

No publiques capturas, HTML, justificantes, RUC, DV, credenciales ni URLs de sesión. Consulta [SECURITY.md](SECURITY.md) para informar de una exposición de datos.

## Mantenimiento

Marangatu puede cambiar selectores, textos y ventanas de confirmación sin aviso. Ante un cambio:

1. ejecuta únicamente un dry-run;
2. revisa el último checkpoint;
3. corrige el selector de forma acotada;
4. ejecuta `npm test`;
5. repite un solo dry-run supervisado.

Los tests y el escaneo de secretos se ejecutan también en GitHub Actions. No se accede a Marangatu desde CI.

## Licencia

El código se publica para consulta, pero no se concede una licencia de reutilización. Consulta [LICENSE](LICENSE). Si el proyecto se abre a contribuciones o reutilización, deberá adoptarse explícitamente una licencia de software libre.
