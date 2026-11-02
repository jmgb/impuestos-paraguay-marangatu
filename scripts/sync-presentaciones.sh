#!/usr/bin/env bash
# Copia a este PC los documentos presentados por el timer de alfredo.
# Sin borrados: el archivo local (incluidos periodos que solo existen aquí)
# nunca se borra. Idempotente; marangatu-sync.timer lo lanza a diario.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
# Canal SSH restringido `marangatu-sync` (alias de ~/.ssh/config): el SSH de ubuntu
# está retirado desde el 1 nov 2026. El VPS devuelve un tar con los ficheros y
# directorios regulares de presentaciones/ (sin enlaces); se extrae sin borrar nada.
host="${MARANGATU_SYNC_HOST:-marangatu-alfredo}"

mkdir -p "$root/presentaciones"
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
ssh -o ConnectTimeout=30 "$host" presentaciones > "$tmp"
tar -xf "$tmp" -C "$root/presentaciones" --no-same-owner --no-same-permissions \
  --no-overwrite-dir --verbose
echo "Sincronizado desde $host: $(TZ=Europe/Madrid date -Is)"
