#!/usr/bin/env bash
# Copia a este PC los documentos presentados por el timer de alfredo.
# Sin --delete: el archivo local (incluidos periodos que solo existen aquí)
# nunca se borra. Idempotente; marangatu-sync.timer lo lanza a diario.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
host="${MARANGATU_SYNC_HOST:-alfredo}"
remote="ai_projects/codex_projects/impuestos-paraguay/presentaciones/"

mkdir -p "$root/presentaciones"
rsync -a --itemize-changes -e "ssh -o BatchMode=yes -o ConnectTimeout=30" \
  "$host:$remote" "$root/presentaciones/"
echo "Sincronizado desde $host: $(TZ=Europe/Madrid date -Is)"
