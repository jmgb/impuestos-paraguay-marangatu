# Maintenance checklist

The automation covers Forms 120 and 241, safe dry-runs, supervised real submission, post-submit verification, local state, and optional notifications.

## Monthly operation

1. Every day at 12:00 Madrid, `marangatu-monthly.timer` on alfredo retries unfinished forms for the previous month; a completed period exits without opening Marangatu or sending notifications.
2. Check the Telegram summary and the documents in `presentaciones/YYYY-MM/`, which `marangatu-sync.timer` copies to the WSL PC daily at 13:00.
3. If a form ends in `error`, the authorized daily schedule retries it the next day. Review `artifacts/` and `logs/` for persistent failures; a manual retry still requires `--retry-error`.
4. Confirm Form 120 in `Consultar Declaraciones` and Form 241 with no pending slips.
5. Retain filing evidence and remove debug artifacts when they are no longer needed.

## Technical maintenance

- Upgrade Playwright in a dedicated change and repeat the tests plus one visible dry-run.
- Review selectors after any Marangatu interface change.
- Keep new variables synchronized across `.env.example`, README, and tests.
- Never add screenshots, HTML, filing evidence, credentials, or session URLs to Git.
- Keep `scripts/run-monthly.sh` as the only scheduled submit path; its authorized `--retry-pending` mode must always skip terminal forms and retain portal checks.

## Commands

```bash
npm test
npm run notify:test
npm run dry-run
scripts/run-monthly.sh --dry-run
npm run submit -- --confirm-period YYYY-MM --check
npm run submit -- --confirm-period YYYY-MM
```
