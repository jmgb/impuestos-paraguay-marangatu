# Tasks

Pending work that cannot be completed yet. Remove each item once it is done.

## 2026-11-01: review the first unattended filing (period 2026-10)

The first fully unattended submission runs on alfredo on day 1 at 12:00 Madrid. Run every check below on alfredo (`ssh alfredo`, checkout `~/ai_projects/codex_projects/impuestos-paraguay`). Two fixes can only be validated during a real submission:

- `F120-resultado` must show the submission result without the "Formulario presentado / ACEPTAR" modal on top.
- Form 241 verification must reopen the talon after closing the previous window and finish without an `error` state.

Check:

- [ ] Telegram summary reports both forms as filed or with no pending slips.
- [ ] `presentaciones/2026-10/` contains `F120-resultado`, `F120-declaracion`, `F241-resultado`, `F241-talon` (PNG, HTML, PDF) and the run log.
- [ ] `.state/forms.json` has no `error` for `2026-10`.
- [ ] `journalctl --user -u marangatu-monthly` shows a successful run.

## Copy filed documents back from alfredo

The monthly run moved to alfredo on 2026-10-04 (timer enabled there, disabled on the WSL PC; tests, dry-run, Telegram and Gmail verified from the VPS). Filing evidence now lands in alfredo's `presentaciones/`; this PC keeps the archive up to 2026-09.

- [ ] Add a way to copy it back after each run, for example a localhost systemd timer on day 1 and day 2 running `rsync -a alfredo:~/ai_projects/codex_projects/impuestos-paraguay/presentaciones/ presentaciones/`.
