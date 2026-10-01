#!/usr/bin/env bash
# Ejecucion mensual desatendida (systemd user timer en Linux/WSL).
# Por defecto PRESENTA los formularios del mes anterior en Madrid; con
# --dry-run solo prepara. src/marangatu.js mantiene sus controles: estado en
# .state/forms.json (no repite presentados, se para ante un 'error' previo)
# y verificacion en el portal antes de dar nada por presentado.
set -uo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root" || exit 1

# systemd no carga el PATH de nvm.
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  . "$HOME/.nvm/nvm.sh" >/dev/null
fi

period="$(TZ=Europe/Madrid date -d "$(TZ=Europe/Madrid date +%Y-%m-01) -1 month" +%Y-%m)"
mode="submit"
extra=()
for arg in "$@"; do
  case "$arg" in
    --dry-run) mode="dry-run" ;;
    --skip-f120|--skip-f241) extra+=("$arg") ;;
    *) echo "Argumento no permitido: $arg" >&2; exit 2 ;;
  esac
done
if [ "$mode" = "dry-run" ]; then
  cmd=(node src/marangatu.js --dry-run "${extra[@]}")
else
  cmd=(node src/marangatu.js --submit --confirm-period "$period" "${extra[@]}")
fi

mkdir -p logs
log="logs/$(TZ=Europe/Madrid date +%Y-%m-%d_%H%M%S)-$mode.log"
echo "Log: $root/$log"

(
  echo "== Inicio $(TZ=Europe/Madrid date -Is) modo=$mode periodo=$period"
  MARANGATU_SUBMIT="$([ "$mode" = submit ] && echo true || echo false)" \
    MARANGATU_HEADLESS="${MARANGATU_HEADLESS:-true}" "${cmd[@]}"
  status=$?
  echo "== Fin $(TZ=Europe/Madrid date -Is) exit=$status"
  exit "$status"
) >>"$log" 2>&1
status=$?

# Si hubo presentacion, el log acompana a los documentos del periodo.
if [ "$mode" = submit ] && [ -d "presentaciones/$period" ]; then
  cp "$log" "presentaciones/$period/"
fi

echo "Exit: $status"
exit "$status"
