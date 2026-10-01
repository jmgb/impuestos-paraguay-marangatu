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

## Confirm WSL keepalive after the next Windows restart

The Windows task `WSL Ubuntu keepalive` (at logon) runs `conhost.exe --headless wsl.exe -d Ubuntu --exec /bin/sleep infinity`, so WSL starts with Windows and stays up. With `Linger=yes` and `Persistent=true`, a run missed while the PC was off starts as soon as WSL is up. Catch-up was tested with a temporary timer; the logon trigger itself still needs a real restart.

- [ ] After the next restart and logon, `pgrep -a -f "sleep infinity"` shows the keepalive and `systemctl --user list-timers marangatu-monthly.timer` lists the next run.

## Move the monthly run to the VPS (alfredo)

Goal: run the monthly filing on `alfredo` (always on) instead of depending on this PC and WSL. Use the existing `ubuntu` user. Only one machine may run the timer at a time, because `.state/forms.json` prevents duplicates only locally.

1. [ ] Clone the repo on alfredo at `~/ai_projects/codex_projects/impuestos-paraguay` (the path the systemd units expect), then `npm ci` and `npx playwright install chromium` (add `npx playwright install-deps chromium` if libraries are missing).
2. [ ] Copy `.env` (`chmod 600`) and `.state/` from localhost. Keep `presentaciones/` on localhost as the archive.
3. [ ] Run `npm test` and `scripts/run-monthly.sh --dry-run` on alfredo. Its IP is a French datacenter: if Marangatu blocks it or asks for CAPTCHA/extra verification, stop and keep localhost (never bypass portal controls).
4. [ ] If the dry-run passes, on alfredo: link `systemd/marangatu-monthly{,-failure}.service` and `marangatu-monthly.timer` into `~/.config/systemd/user/`, `daemon-reload`, `enable --now marangatu-monthly.timer`, and confirm `loginctl show-user ubuntu -p Linger` is `yes`.
5. [ ] On localhost, the same day: `systemctl --user disable --now marangatu-monthly.timer`, so only alfredo files.
6. [ ] Copy the filed documents back to this PC after each run, for example a localhost systemd timer on day 1 and day 2 running `rsync -a alfredo:~/ai_projects/codex_projects/impuestos-paraguay/presentaciones/ presentaciones/`.
7. [ ] Update README, CLAUDE.md, and the WSL items above to say that alfredo runs the schedule. The WSL keepalive can stay for the other timers.
