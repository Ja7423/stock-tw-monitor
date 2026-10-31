// 用 src/commands.ts 的清單更新 Telegram 指令選單（setMyCommands）
// 用法：npm run bot:commands
// token 優先用環境變數 TELEGRAM_BOT_TOKEN（CI 用這個），沒有的話讀專案根目錄的 .dev.vars
// 需要 Node 22.18 以上，才能直接載入 .ts 檔
import { existsSync } from "node:fs";
import { join } from "node:path";
import { MENU_COMMANDS } from "../src/commands.ts";

// loadEnvFile 不會覆蓋已經存在的環境變數
const devVars = join(import.meta.dirname, "..", ".dev.vars");
if (existsSync(devVars)) process.loadEnvFile(devVars);

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("請設定 TELEGRAM_BOT_TOKEN，或在 .dev.vars 填入");
  process.exit(1);
}

const res = await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ commands: MENU_COMMANDS }),
});
const body = await res.json().catch(() => ({}));
if (!res.ok || !body.ok) {
  // 只印 Telegram 的錯誤說明，不印網址，避免 token 出現在 CI 記錄
  console.error(`更新指令選單失敗：${res.status} ${body.description ?? ""}`.trim());
  process.exit(1);
}
console.log(`已更新 Telegram 指令選單（${MENU_COMMANDS.length} 個指令）：${MENU_COMMANDS.map((c) => c.command).join(", ")}`);
