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

curl -sS "${API}/setMyCommands" -H "Content-Type: application/json" -d '{
  "commands": [
    {"command": "add", "description": "新增監測 /add 2330 2317"},
    {"command": "del", "description": "刪除監測 /del 2330"},
    {"command": "list", "description": "列出監測清單"},
    {"command": "report", "description": "立即產生報告"},
    {"command": "explain", "description": "報告欄位說明"},
    {"command": "settings", "description": "查看全域設定"},
    {"command": "set", "description": "全域設定 /set range 20"},
    {"command": "override", "description": "個股設定 /override 2330 range=20"},
    {"command": "reset", "description": "清除個股設定 /reset 2330"},
    {"command": "help", "description": "指令說明"}
  ]
}'
echo
curl -sS "${API}/getWebhookInfo"
echo
