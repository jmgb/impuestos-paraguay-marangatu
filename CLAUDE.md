# CLAUDE.md

This file provides contributor guidance for AI coding agents working in this repository.

## Project purpose

This is a Node.js ESM and Playwright automation for Paraguayan tax residents who must file monthly zero-activity returns through Marangatu. It prepares Forms 120 and 241, runs with visible Chromium by default, and saves screenshots plus HTML checkpoints in `artifacts/`.

The project does not determine tax residency, eligibility for zero-activity filing, filing obligations, or deadlines. Do not turn user-specific assumptions into general tax guidance.

## Filing period and schedule

Without `--year` and `--month`, `previousMonthPeriod` selects the previous calendar month in `Europe/Madrid`. January correctly rolls back to December of the previous year.

The Windows task wakes at 12:00 and 12:30. `scripts/run-monthly-check.ps1` runs Node only between 12:00 and 12:59 Madrid time on day 1 and uses `.state/last-run.txt` to prevent a second run in the same month. Scheduled runs are always dry-runs.

### Form 120 — monthly VAT

1. Open `Declaraciones Juradas y Pagos`.
2. Open `Presentar Declaración`.
3. Select obligation `211 - IVA General - MENSUAL`.
4. Select year and month.
5. Open the declaration.
6. Stop before `Presentar Declaración` in dry-run, or confirm it only in authorized submit mode.
7. Verify the active terminal row in `Consultar Declaraciones`.

### Form 241 — informative receipts

1. Open `Declaraciones Informativas`.
2. Open `Gestión de Comprobantes Informativos`.
3. Open `Confirmar Presentación`.
4. Select year and month.
5. Stop before the final action in dry-run, or confirm it only in authorized submit mode.
6. Reopen the period and require `No existen talones pendientes de presentación`.

## Commands

```bash
npm ci
npx playwright install chromium
npm run dry-run
npm test
node src/marangatu.js --year 2026 --month 5 --dry-run --skip-f241
node src/marangatu.js --year 2026 --month 5 --dry-run --skip-f120
npm run submit -- --confirm-period YYYY-MM --check
npm run submit -- --confirm-period YYYY-MM
```

On Windows, `npm.cmd run register-task` registers the monthly dry-run task and `npm.cmd run clean:artifacts` removes volatile debug evidence.

## Architecture and safety invariants

`src/marangatu.js` is the browser entry point. Selectors and navigation helpers are intentionally kept close to the workflow because Marangatu exposes session-dependent URLs and inconsistent labels.

Real submission has three independent interlocks:

1. the CLI must include `--submit`;
2. `MARANGATU_SUBMIT=true` must exist in the child environment;
3. `--confirm-period YYYY-MM` must exactly match the previous month in Madrid.

`scripts/run-supervised-submit.mjs` is the cross-platform launcher that enables the environment interlock only for the supervised child process. `scripts/run-supervised-submit.sh` remains as a compatibility wrapper. Never remove or weaken these controls. Never schedule submit mode.

### Local form state

In submit mode, `runFormWithStateTracking` writes `.state/forms.json`:

- `iniciado` becomes `presentado`, `sin-pendientes`, or `error`;
- terminal `presentado` and `sin-pendientes` states are skipped without a submit bypass;
- an `error` state requires artifact review, fresh user authorization, and `--retry-error F120|F241`;
- dry-runs neither read nor write submit state.

The supervised launcher rejects `--force`. In dry-run only, `--force` may be used for an explicit UI inspection of a Form 120 period that is already filed.

### Portal navigation

- Session URLs containing `_cyp` must be discovered at runtime and never logged or persisted in documentation.
- `findCommonOptionHref` reads the current Form 120 link from the DOM.
- Form 241 attempts the dynamic HTML URL, the Angular menu model, and finally the visible card.
- Portal accents are inconsistent; regex patterns such as `Declaraci.n` deliberately tolerate accented and unaccented labels.
- `safeClick` checks that a control is visible and enabled before clicking.

### Verification gates

Form 120 is successful only when `Consultar Declaraciones` returns the expected form and period with active flag `S` and an accepted terminal state. The check runs after submission and once more before notifications.

Form 241 is successful only when reopening the same period shows no pending slips. A click or confirmation dialog alone is never evidence of a completed filing.

### Evidence

`checkpoint(page, name)` writes a full-page PNG and HTML snapshot to `artifacts/`. Keep checkpoint names ordered and do not commit their contents.

Real filing evidence is stored in `presentaciones/YYYY-MM/`. Debug artifacts are volatile; filing evidence must be retained locally. Both may contain protected tax data and are ignored by Git.

## Notification policy

`MARANGATU_TELEGRAM_ENABLED` and `MARANGATU_EMAIL_ENABLED` are independent master switches and default to `false` in `.env.example`.

Telegram may report submit runs, failures, and—when `MARANGATU_TELEGRAM_NOTIFY_DRY_RUN=true`—successful dry-runs. It requires a bot token and chat ID. Keep message content free of credentials, tax identifiers, and session URLs.

Gmail is eligible only after an error-free real run with at least one newly filed and verified form. Dry-runs and fully skipped periods never send email. `.state/email-notifications.json` provides period-level idempotency. OAuth credentials may be set directly or read from a separate private environment file.

## Change rules

- Default to dry-run for debugging and selector changes.
- Never bypass CAPTCHA, MFA, account controls, or portal warnings.
- Stop on unexpected amounts, periods, account identity, or interface changes.
- Add deterministic tests for pure logic and mocked notification behavior.
- CI must never receive Marangatu, Telegram, or Gmail secrets and must never access the live portal.
- Keep `.env.example`, README, tests, and implementation synchronized when adding configuration.
