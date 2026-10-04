#!/usr/bin/env bash
# Aviso de respaldo por Telegram para los OnFailure de systemd. Sin argumentos,
# cubre marangatu-monthly.service cuando Node no llego a avisar (nvm/node
# ausentes, timeout de systemd, etc.) y no repite si el log de esa ejecucion ya
# registra un Telegram. Con un argumento, envia ese texto (marangatu-sync).
set -uo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root" || exit 1

env_value() {
  grep -E "^$1=" .env 2>/dev/null | tail -1 | cut -d= -f2- | sed -E 's/^["'\'']|["'\'']$//g'
}

enabled="$(env_value MARANGATU_TELEGRAM_ENABLED | tr '[:upper:]' '[:lower:]')"
token="$(env_value MARANGATU_TELEGRAM_TOKEN)"
chat_id="$(env_value MARANGATU_TELEGRAM_CHAT_ID)"
if [[ ! "$enabled" =~ ^(1|true|yes|si)$ ]] || [ -z "$token" ] || [ -z "$chat_id" ]; then
  echo "Telegram desactivado o sin configurar; no se envia aviso."
  exit 0
fi

if [ $# -gt 0 ]; then
  text="$1"
else
  recent_log="$(find logs -maxdepth 1 -name '*.log' -mmin -60 2>/dev/null | sort | tail -1)"
  if [ -n "$recent_log" ] && grep -q "Telegram enviado correctamente" "$recent_log"; then
    echo "Node ya aviso por Telegram ($recent_log)."
    exit 0
  fi
  text="[PARAGUAY IMPUESTOS] La ejecucion mensual programada ha fallado sin que la automatizacion pudiera avisar. Revisa: journalctl --user -u marangatu-monthly y la carpeta logs/."
fi
curl -sS --max-time 15 -o /dev/null -w "Telegram HTTP %{http_code}\n" \
  "https://api.telegram.org/bot${token}/sendMessage" \
  --data-urlencode "chat_id=${chat_id}" \
  --data-urlencode "text=${text}"
