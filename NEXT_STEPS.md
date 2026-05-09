# Próximos pasos

Roadmap recomendado para llevar la automatización Marangatu de "dry-run validado" a "presentación real desatendida y monitorizada".

## Prioridad práctica

1. ~~Validar el botón final real de **F241**.~~ ✅ Hecho.
2. Programar la tarea mensual en Windows Task Scheduler (en modo seguro). **Pendiente (operativo).**
3. ~~Anti-duplicados con estado local.~~ ✅ Hecho.
4. ~~Notificaciones Telegram.~~ ✅ Hecho.
5. Limpieza automática de `artifacts/`. **Pendiente (código).** Nota: ya separamos los justificantes (carpeta `presentaciones/YYYY-MM/`), así que `artifacts/` puede limpiarse con tranquilidad sin perder evidencia legal.
6. Ejecución real supervisada para validar el pop-up de F241 en producción. **Pendiente (operativo).**

---

## 1. ~~Validar el último botón real de F241~~ ✅ Completado

Cerrado en `prepareFormulario241` (`src/marangatu.js`):
- Botón final: `button[data-ng-click^="vm.procesar"]` con texto `Presentar declaración`, espera explícita por la renderización tardía tras seleccionar año/mes.
- Pop-up de confirmación: `button.btn-primary[type="button"]` con texto exacto `Aceptar`.
- Ambos clicks viven **después** del guardarraíl `if (!submit) return`, así que en `dry-run`/`MARANGATU_SUBMIT=false` no se llegan a pulsar.
- Checkpoints añadidos: `09-f241-submit-ready`, `10-f241-submit-clicked`, `11-f241-popup-accepted`.

**Pendiente menor:** una ejecución real supervisada (paso 2) para confirmar que el pop-up no tiene variantes inesperadas.

## 2. Ejecución real controlada

Sólo después de validar el botón final, hacer una corrida real:

- `MARANGATU_SUBMIT=true` en `.env` **y** flag `--submit` en CLI (doble seguro).
- Elegir un mes donde sea inequívoco que corresponde presentar.
- Verificar manualmente en el portal el comprobante de presentación.
- Conservar los `artifacts/` de esa corrida como referencia "happy path".

## 3. Registrar la tarea mensual en Windows Task Scheduler

El repo ya tiene `scripts/register-task.ps1` y `scripts/run-monthly-check.ps1` (filtra día 1, 12:00 Madrid, una vez por mes).

**Acciones:**
- Ejecutar `npm.cmd run register-task` en la máquina Windows.
- Dejarla corriendo en **dry-run** (o con `--skip-f241` si F241 todavía no está validado) hasta tener confianza en el paso final real.
- Sólo entonces cambiar el comando registrado a `--submit`.

## 4. ~~Notificaciones de resultado~~ ✅ Completado (Telegram)

Implementado `sendTelegramMessage` + `buildResultSummary` en `src/marangatu.js`, basado en el patrón de `presupuestor/backend/app/services/telegram_service.py`:
- Un único mensaje al final de la corrida con período, estado por formulario y modo (`submit` / `dry-run`).
- Se envía cuando hay `submit` o cuando hubo error; los dry-runs limpios no notifican.
- Escape HTML conservador (`&` `<` `>`) y reintento básico ante 429/red.
- Configuración: `MARANGATU_TELEGRAM_TOKEN` y `MARANGATU_TELEGRAM_CHAT_ID` en `.env`.
- Tests en `scripts/test-telegram.mjs`.

## 5. ~~Control anti-duplicados más estricto~~ ✅ Completado

Implementado en `src/marangatu.js` con helpers `loadFormState` / `setFormStatus` / `runFormWithStateTracking`:
- Estado persistido en `.state/forms.json` por clave `YYYY-MM` y formulario (`F120` / `F241`).
- Transiciones: `iniciado` → `presentado` (éxito) o `error` (con mensaje).
- En modo `submit`, antes de correr lee el estado previo: `presentado` → salta; `error` → falla y exige intervención manual.
- Flag `--force` para bypassear el guardarraíl cuando el operador valida manualmente que conviene reintentar.
- En `dry-run` el estado **no se toca**, para no contaminarlo.
- Tests en `scripts/test-state.mjs` (incluidos en `npm test`).

## 6. Evidencias limpias

`artifacts/` puede acumular datos fiscales sensibles.

**Propuestas:**
- Conservar sólo los checkpoints finales relevantes (último por formulario + cualquiera con error).
- Política de retención: borrar automáticamente capturas con más de N días, o tras presentación exitosa confirmada.
- Reforzar `npm.cmd run clean:artifacts` para que se ejecute como hook post-run en modo `--submit` exitoso.
