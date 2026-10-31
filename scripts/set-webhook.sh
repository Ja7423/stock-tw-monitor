#!/usr/bin/env bash
# 設定 Telegram webhook 與指令選單
# 用法：TELEGRAM_BOT_TOKEN=xxx TELEGRAM_WEBHOOK_SECRET=yyy ./scripts/set-webhook.sh https://tw-stock-monitor.<subdomain>.workers.dev
set -euo pipefail

WORKER_URL="${1:?請提供 Worker 網址}"
: "${TELEGRAM_BOT_TOKEN:?請設定 TELEGRAM_BOT_TOKEN}"
: "${TELEGRAM_WEBHOOK_SECRET:?請設定 TELEGRAM_WEBHOOK_SECRET}"
API="https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}"

curl -sS "${API}/setWebhook" \
  -d "url=${WORKER_URL%/}/telegram/webhook" \
  -d "secret_token=${TELEGRAM_WEBHOOK_SECRET}" \
  -d 'allowed_updates=["message"]' \
  -d "drop_pending_updates=true"
echo

# 指令選單的清單在 src/commands.ts
node "$(dirname "$0")/set-commands.mjs"
curl -sS "${API}/getWebhookInfo"
echo
