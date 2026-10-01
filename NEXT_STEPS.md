# Maintenance checklist

The automation covers Forms 120 and 241, safe dry-runs, supervised real submission, post-submit verification, local state, and optional notifications.

## Monthly operation

1. On day 1, `marangatu-monthly.timer` submits the previous month unattended (Linux/WSL).
2. Check the Telegram summary and the documents in `presentaciones/YYYY-MM/`.
3. If a form ends in `error`, review `artifacts/` and `logs/`, then authorize `--retry-error` manually.
4. Confirm Form 120 in `Consultar Declaraciones` and Form 241 with no pending slips.
5. Retain filing evidence and remove debug artifacts when they are no longer needed.

## Technical maintenance

- Upgrade Playwright in a dedicated change and repeat the tests plus one visible dry-run.
- Review selectors after any Marangatu interface change.
- Keep new variables synchronized across `.env.example`, README, and tests.
- Never add screenshots, HTML, filing evidence, credentials, or session URLs to Git.
- Keep `scripts/run-monthly.sh` as the only scheduled submit path, and never retry `error` states automatically.

## Commands

```bash
npm test
npm run dry-run
scripts/run-monthly.sh --dry-run
npm run submit -- --confirm-period YYYY-MM --check
npm run submit -- --confirm-period YYYY-MM
```
