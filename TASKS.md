# Tasks

Pending work that cannot be completed yet. Remove each item once it is done.

## 2026-11-01: review the first unattended filing (period 2026-10)

The first fully unattended submission runs on day 1 at 12:00 Madrid. Two fixes can only be validated during a real submission:

- `F120-resultado` must show the submission result without the "Formulario presentado / ACEPTAR" modal on top.
- Form 241 verification must reopen the talon after closing the previous window and finish without an `error` state.

Check:

- [ ] Telegram summary reports both forms as filed or with no pending slips.
- [ ] `presentaciones/2026-10/` contains `F120-resultado`, `F120-declaracion`, `F241-resultado`, `F241-talon` (PNG, HTML, PDF) and the run log.
- [ ] `.state/forms.json` has no `error` for `2026-10`.
- [ ] `journalctl --user -u marangatu-monthly` shows a successful run.

## Decide how WSL starts on Windows boot

The systemd timer only fires while WSL is running. No Windows task or startup item starts WSL today, and `.wslconfig` sets `vmIdleTimeout=60000`. `Persistent=true` catches up on a missed run, but only once WSL starts again. This affects every systemd timer on the machine, not only this project.

- [ ] Choose an option, for example a Windows logon task that runs `wsl.exe -d Ubuntu --exec /bin/true`, and confirm after a reboot that the distribution and its timers stay up.
