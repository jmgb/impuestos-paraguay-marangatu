# Maintenance checklist

The automation covers Forms 120 and 241, safe dry-runs, supervised real submission, post-submit verification, local state, and optional notifications.

## Monthly operation

1. Run the scheduled dry-run for the previous month.
2. Review checkpoints and any visual portal changes.
3. Authorize a real submission separately, when applicable.
4. Confirm Form 120 in `Consultar Declaraciones` and Form 241 with no pending slips.
5. Retain filing evidence and remove debug artifacts when they are no longer needed.

## Technical maintenance

- Upgrade Playwright in a dedicated change and repeat the tests plus one visible dry-run.
- Review selectors after any Marangatu interface change.
- Keep new variables synchronized across `.env.example`, README, and tests.
- Never add screenshots, HTML, filing evidence, credentials, or session URLs to Git.
- Keep recurring automation exclusively in dry-run mode.

## Commands

```bash
npm test
npm run dry-run
npm run submit -- --confirm-period YYYY-MM --check
npm run submit -- --confirm-period YYYY-MM
```
