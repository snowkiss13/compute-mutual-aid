#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

COMPUTE_POOL_URL="${COMPUTE_POOL_URL:-https://vercel-nine-sigma-62.vercel.app/api}"
COMPUTE_POOL_PROVIDER_ACCOUNT="${COMPUTE_POOL_PROVIDER_ACCOUNT:-snowkiss13-seed}"
COMPUTE_POOL_MODEL="${COMPUTE_POOL_MODEL:-qwen3-coder:30b}"
KEY_DIR="${HOME}/.compute-mutual-aid"
KEY_FILE="${KEY_DIR}/provider.key"

log() {
  printf '[seed-provider] %s\n' "$*" >&2
}

register_key() {
  mkdir -p "$KEY_DIR"
  chmod 700 "$KEY_DIR"

  local response key
  response="$(curl -fsS "${COMPUTE_POOL_URL%/}/register" \
    -H "Content-Type: application/json" \
    -d "{\"account\":\"${COMPUTE_POOL_PROVIDER_ACCOUNT}\"}")"
  key="$(printf '%s' "$response" | python3 -c 'import json,sys; print(json.load(sys.stdin)["api_key"])')"

  umask 077
  printf '%s\n' "$key" > "$KEY_FILE"
  chmod 600 "$KEY_FILE"
  log "registered ${COMPUTE_POOL_PROVIDER_ACCOUNT}; API key saved to ${KEY_FILE}"
  log "key is plaintext on disk; keep ${KEY_FILE} private and out of git"
}

if [ ! -s "$KEY_FILE" ]; then
  log "no provider key found at ${KEY_FILE}; registering ${COMPUTE_POOL_PROVIDER_ACCOUNT}"
  register_key
fi

API_KEY="$(tr -d '\r\n' < "$KEY_FILE")"
if [ -z "$API_KEY" ]; then
  log "provider key is empty: ${KEY_FILE}"
  exit 1
fi

if ! command -v ollama >/dev/null 2>&1; then
  log "ollama not found in PATH"
  exit 1
fi

if ! ollama list >/dev/null 2>&1; then
  log "ollama is not responding; starting 'ollama serve' in the background"
  nohup ollama serve >> "${HOME}/Library/Logs/compute-mutual-aid-ollama.log" 2>&1 &
  sleep 3
  if ! ollama list >/dev/null 2>&1; then
    log "ollama still not responding after starting serve"
    exit 1
  fi
fi

if ! ollama list | awk 'NR > 1 {print $1}' | grep -Fxq "$COMPUTE_POOL_MODEL"; then
  log "model ${COMPUTE_POOL_MODEL} is not installed; run: ollama pull ${COMPUTE_POOL_MODEL}"
  exit 1
fi

log "starting provider account=${COMPUTE_POOL_PROVIDER_ACCOUNT} model=${COMPUTE_POOL_MODEL} url=${COMPUTE_POOL_URL}"
exec python3 "$ROOT/provider.py" \
  --coordinator "$COMPUTE_POOL_URL" \
  --api-key "$API_KEY" \
  --account "$COMPUTE_POOL_PROVIDER_ACCOUNT" \
  --backend ollama \
  --model "$COMPUTE_POOL_MODEL" \
  --poll 2
