import { HELP, MAX_ADD_PER_COMMAND } from "./commands";
import { STOCK_ID_RE, describeConfig, parseConfigPatch } from "./config";
import {
  addStock,
  getFeeConfig,
  getGlobalConfig,
  getJobRun,
  hasStock,
  listWatchlist,
  removeStock,
  resetOverride,
  setFeeConfig,
  setGlobalConfig,
  setOverride,
} from "./db";
import { EXPLAIN } from "./explain";
import { describeFeeConfig, parseFeePatch } from "./fees";
import { fetchQuota, fetchStockInfo } from "./finmind";
import { taipeiDate } from "./date";
import { ensureHistory, getSyncLoad, runReport, watchBackfillFrom } from "./job";
import { handleBuy, handleDiv, handleHoldings, handlePos, handleSell, handleTradeDel, handleTrend } from "./portfolioBot";
import { formatStatus, syncLoadWarning } from "./status";
import { sendMessage, type TelegramUpdate } from "./telegram";
import type { Env } from "./types";

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
      try {
        // 已有持股的股票可能只存了交易日之後的日K，要補到夠算長天期均線
        await ensureHistory(env, id, watchBackfillFrom(today), today);
        lines.push(`✅ ${id} ${info.name} 已新增`);
      } catch (err) {
        // 已在清單中，下次產生報告時 syncAll 會補抓
        lines.push(`⚠️ ${id} ${info.name} 已新增，歷史資料稍後補抓（${(err as Error).message}）`);
      }
    } catch (err) {
      lines.push(`❌ ${id} 失敗：${(err as Error).message}`);
    }
  }
  const warning = syncLoadWarning(await getSyncLoad(env.DB, today));
  if (warning) lines.push(warning);
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
  const [config, fee] = await Promise.all([getGlobalConfig(env.DB), getFeeConfig(env.DB)]);
  return `⚙️ 全域設定\n${describeConfig(config)}\n${describeFeeConfig(fee)}\n排程：週一至週五 15:00（16:00 補跑）`;
}

async function handleSet(env: Env, args: string[]): Promise<string> {
  const [key, value] = args;
  if (!key || !value) throw new Error("用法：/set range 20、/set ma 5,20,60、/set pct 120、/set fee 0.28");
  const feePatch = parseFeePatch(key, value);
  if (feePatch) {
    await setFeeConfig(env.DB, feePatch);
    return `✅ 手續費設定已更新：${describeFeeConfig(feePatch)}`;
  }
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

async function handleStatus(env: Env): Promise<string> {
  const today = taipeiDate(new Date());
  const [run, quota, load] = await Promise.all([
    getJobRun(env.DB, today),
    fetchQuota(env).catch((err: Error) => err),
    getSyncLoad(env.DB, today),
  ]);
  return formatStatus(today, run, quota, load);
}

async function handleReport(env: Env, chatId: number): Promise<null> {
  await sendMessage(env, chatId, "⏳ 產生報告中…");
  await runReport(env, new Date(), { force: true, chatId });
  return null;
}

/** 多則訊息用陣列；null 表示 handler 自己送過了 */
type Reply = string | string[] | null;
type CommandHandler = (env: Env, args: string[], chatId: number) => Promise<Reply>;

const HANDLERS: Record<string, CommandHandler> = {
  "/start": async () => HELP,
  "/help": async () => HELP,
  "/add": handleAdd,
  "/del": handleDel,
  "/list": handleList,
  "/settings": handleSettings,
  "/set": handleSet,
  "/override": handleOverride,
  "/reset": handleReset,
  "/status": handleStatus,
  "/explain": async () => EXPLAIN,
  "/report": (env, _args, chatId) => handleReport(env, chatId),
  "/buy": handleBuy,
  "/sell": handleSell,
  "/div": handleDiv,
  "/tradedel": handleTradeDel,
  "/holdings": handleHoldings,
  "/pos": handlePos,
  "/trend": handleTrend,
};

function toMessages(reply: Reply): string[] {
  if (reply === null) return [];
  return Array.isArray(reply) ? reply : [reply];
}

export async function handleUpdate(env: Env, update: TelegramUpdate): Promise<void> {
  const message = update.message;
  if (!message?.text) return;
  const chatId = message.chat.id;
  if (String(chatId) !== env.ALLOWED_CHAT_ID) return; // 只回應白名單

  const [rawCmd, ...args] = message.text.trim().split(/\s+/);
  const cmd = rawCmd.split("@")[0].toLowerCase();

  try {
    const handler = HANDLERS[cmd];
    const reply = handler ? await handler(env, args, chatId) : `看不懂的指令：${rawCmd}\n輸入 /help 查看用法`;
    for (const text of toMessages(reply)) await sendMessage(env, chatId, text);
  } catch (err) {
    await sendMessage(env, chatId, `❌ ${(err as Error).message}`);
  }
}
