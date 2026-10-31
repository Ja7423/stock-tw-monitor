import { STOCK_ID_RE, describeConfig, parseConfigPatch } from "./config";
import {
  addStock,
  getGlobalConfig,
  hasStock,
  listWatchlist,
  removeStock,
  resetOverride,
  setGlobalConfig,
  setOverride,
} from "./db";
import { EXPLAIN } from "./explain";
import { fetchStockInfo } from "./finmind";
import { runReport, syncStock, taipeiDate } from "./job";
import { sendMessage, type TelegramUpdate } from "./telegram";
import type { Env } from "./types";

// 每檔新增約需 2 個對外請求，免費方案單次執行上限約 50 個
const MAX_ADD_PER_COMMAND = 10;

const HELP = `📈 台股K棒監測 指令
/add 2330 2317 — 新增監測（一次最多 ${MAX_ADD_PER_COMMAND} 檔）
/del 2330 — 刪除監測
/list — 列出清單與個股設定
/report — 立即產生報告
/explain — 報告欄位說明
/settings — 查看全域設定

全域設定：
/set range 20 — 觀察區間（日）
/set ma 5,20,60,240 — 均線週期
/set pct 240 — 位階百分位區間（日）

個股覆寫：
/override 2330 range=20 ma=5,10,20 pct=60
/reset 2330 — 清除個股覆寫`;

function parseStockIds(args: string[]): string[] {
  const ids = [...new Set(args.map((a) => a.toUpperCase()))];
  const invalid = ids.filter((id) => !STOCK_ID_RE.test(id));
  if (invalid.length > 0) throw new Error(`股票代號格式錯誤：${invalid.join(", ")}`);
  if (ids.length === 0) throw new Error("請提供股票代號，例如 /add 2330");
  return ids;
}

async function handleAdd(env: Env, args: string[]): Promise<string> {
  const ids = parseStockIds(args);
  if (ids.length > MAX_ADD_PER_COMMAND) throw new Error(`一次最多新增 ${MAX_ADD_PER_COMMAND} 檔`);
  const today = taipeiDate(new Date());
  const lines: string[] = [];
  for (const id of ids) {
    try {
      if (await hasStock(env.DB, id)) {
        lines.push(`➖ ${id} 已在清單中`);
        continue;
      }
      const info = await fetchStockInfo(env, id);
      if (!info) {
        lines.push(`❌ ${id} 查無此股票`);
        continue;
      }
      await addStock(env.DB, id, info.name, info.market);
      await syncStock(env, id, today);
      lines.push(`✅ ${id} ${info.name} 已新增`);
    } catch (err) {
      lines.push(`❌ ${id} 失敗：${(err as Error).message}`);
    }
  }
  return lines.join("\n");
}

async function handleDel(env: Env, args: string[]): Promise<string> {
  const lines: string[] = [];
  for (const id of parseStockIds(args)) {
    lines.push((await removeStock(env.DB, id)) ? `🗑 ${id} 已刪除` : `➖ ${id} 不在清單中`);
  }
  return lines.join("\n");
}

async function handleList(env: Env): Promise<string> {
  const items = await listWatchlist(env.DB);
  if (items.length === 0) return "監測清單是空的，用 /add 2330 新增股票。";
  const lines = items.map((item) => {
    const override = describeConfig({
      rangeDays: item.rangeDays ?? undefined,
      maPeriods: item.maPeriods ?? undefined,
      percentileDays: item.percentileDays ?? undefined,
    });
    return `• ${item.stockId} ${item.name}${override ? `  [${override}]` : ""}`;
  });
  return `📋 監測清單（${items.length} 檔）\n${lines.join("\n")}`;
}

async function handleSettings(env: Env): Promise<string> {
  return `⚙️ 全域設定\n${describeConfig(await getGlobalConfig(env.DB))}\n排程：週一至週五 15:00（16:00 補跑）`;
}

async function handleSet(env: Env, args: string[]): Promise<string> {
  const [key, value] = args;
  if (!key || !value) throw new Error("用法：/set range 20、/set ma 5,20,60、/set pct 120");
  const patch = parseConfigPatch([`${key}=${value}`]);
  await setGlobalConfig(env.DB, patch);
  return `✅ 全域設定已更新：${describeConfig(patch)}`;
}

async function handleOverride(env: Env, args: string[]): Promise<string> {
  const [rawId, ...rest] = args;
  const [id] = parseStockIds(rawId ? [rawId] : []);
  const patch = parseConfigPatch(rest);
  if (!(await setOverride(env.DB, id, patch))) return `➖ ${id} 不在清單中`;
  return `✅ ${id} 個股設定：${describeConfig(patch)}`;
}

async function handleReset(env: Env, args: string[]): Promise<string> {
  const [id] = parseStockIds(args.slice(0, 1));
  return (await resetOverride(env.DB, id)) ? `✅ ${id} 已改回全域設定` : `➖ ${id} 不在清單中`;
}

export async function handleUpdate(env: Env, update: TelegramUpdate): Promise<void> {
  const message = update.message;
  if (!message?.text) return;
  const chatId = message.chat.id;
  if (String(chatId) !== env.ALLOWED_CHAT_ID) return; // 只回應白名單

  const [rawCmd, ...args] = message.text.trim().split(/\s+/);
  const cmd = rawCmd.split("@")[0].toLowerCase();

  try {
    let reply: string | null;
    switch (cmd) {
      case "/start":
      case "/help":
        reply = HELP;
        break;
      case "/add":
        reply = await handleAdd(env, args);
        break;
      case "/del":
        reply = await handleDel(env, args);
        break;
      case "/list":
        reply = await handleList(env);
        break;
      case "/settings":
        reply = await handleSettings(env);
        break;
      case "/set":
        reply = await handleSet(env, args);
        break;
      case "/override":
        reply = await handleOverride(env, args);
        break;
      case "/reset":
        reply = await handleReset(env, args);
        break;
      case "/explain":
        reply = EXPLAIN;
        break;
      case "/report":
        await sendMessage(env, chatId, "⏳ 產生報告中…");
        await runReport(env, new Date(), { force: true, chatId });
        reply = null;
        break;
      default:
        reply = `看不懂的指令：${rawCmd}\n輸入 /help 查看用法`;
    }
    if (reply) await sendMessage(env, chatId, reply);
  } catch (err) {
    await sendMessage(env, chatId, `❌ ${(err as Error).message}`);
  }
}
