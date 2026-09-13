#!/usr/bin/env bash
# Проверяет ключ профиля двумя путями сразу: нашим CLI и голым curl.
#
# Зачем оба: если оба отвечают одинаково — дело в ключе или в кластере, а не в нашем коде.
# Если ответы расходятся — дело в нас, и видно, где именно.
#
#   ./scripts/check-key.sh              # профиль по умолчанию
#   ./scripts/check-key.sh staging
#
# Ключ НИКОГДА не печатается: Braze возвращает его в теле ошибки 401 (SEC-1), поэтому оба
# вывода прогоняются через вырезание.
set -euo pipefail

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
profile=${1:-}
config="${BRAZE_CONFIG_DIR:-$HOME/.config/brazecli}/config.json"

[ -f "$config" ] || { echo "нет файла конфигурации $config — сначала braze profile add" >&2; exit 1; }

if [ -z "$profile" ]; then
  profile=$(node -e 'const c=require(process.argv[1]);process.stdout.write(c.defaultProfile??"")' "$config")
fi
[ -n "$profile" ] || { echo "профиль не назван и умолчания нет" >&2; exit 1; }

endpoint=$(node -e 'const c=require(process.argv[1]);process.stdout.write(c.profiles?.[process.argv[2]]?.restEndpoint??"")' "$config" "$profile")
[ -n "$endpoint" ] || { echo "у профиля \"$profile\" нет адреса в $config" >&2; exit 1; }

key=$(cd "$root/packages/cli" && node -e '
const { Entry } = require("@napi-rs/keyring")
process.stdout.write(new Entry("brazecli", process.argv[1]).getPassword() ?? "")' "$profile")

if [ -z "$key" ]; then
  echo "в брелоке нет ключа для профиля \"$profile\"" >&2
  exit 1
fi

hide() { sed "s|$key|<ключ вырезан>|g"; }

echo "профиль: $profile"
echo "адрес:   $endpoint"
echo "ключ:    есть, ${#key} символов (значение не печатается)"
echo

echo "── через CLI ──────────────────────────────────────────────"
set +e
BRAZE_PROFILE="$profile" node "$root/packages/cli/dist/bin/braze.js" \
  api GET /campaigns/list --query page=0 --json 2>&1 | hide
cli_status=${PIPESTATUS[0]}
set -e
echo "код возврата: $cli_status"
echo

echo "── тот же запрос голым curl ───────────────────────────────"
curl -sS -w '\nHTTP %{http_code}\n' \
  -H "Authorization: Bearer $key" \
  "$endpoint/campaigns/list?page=0" | hide

echo
echo "Одинаковый ответ у обоих — дело в ключе или в кластере, не в нашем коде."
