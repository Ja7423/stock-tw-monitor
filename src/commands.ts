// 指令清單的唯一來源：/help 文字和 Telegram 選單都從這裡產生。
// scripts/set-commands.mjs 會直接用 Node 載入這個檔案，所以不能 import 其他模組，
// 也只能用 Node 可以直接去掉的 TypeScript 語法（不要用 enum、namespace）。

// 每檔新增約需 2 個對外請求，免費方案單次執行上限約 50 個
export const MAX_ADD_PER_COMMAND = 10;

export interface CommandSpec {
  /** 指令名稱，不含斜線 */
  name: string;
  /** Telegram 選單上的說明 */
  menu: string;
  /** /help 顯示的用法，每個元素一行；空陣列表示不列在 /help */
  usage: string[];
}

export interface CommandGroup {
  title?: string;
  commands: CommandSpec[];
}

export const COMMAND_GROUPS: CommandGroup[] = [
  {
    commands: [
      {
        name: "add",
        menu: "新增監測 /add 2330 2317",
        usage: [`/add 2330 2317 — 新增監測（一次最多 ${MAX_ADD_PER_COMMAND} 檔）`],
      },
      { name: "del", menu: "刪除監測 /del 2330", usage: ["/del 2330 — 刪除監測"] },
      { name: "list", menu: "列出監測清單", usage: ["/list — 列出清單與個股設定"] },
      { name: "report", menu: "立即產生報告", usage: ["/report — 立即產生報告"] },
      { name: "status", menu: "今日排程與 FinMind 額度", usage: ["/status — 今日排程狀態與 FinMind 額度"] },
      { name: "explain", menu: "報告欄位說明", usage: ["/explain — 報告欄位說明"] },
      { name: "settings", menu: "查看全域設定", usage: ["/settings — 查看全域設定"] },
    ],
  },
  {
    title: "持股",
    commands: [
      {
        name: "buy",
        menu: "記錄買進 /buy 2330 1000 580",
        usage: ["/buy 2330 1000 580.5 [10/15] [fee=82] — 記錄買進（股數、價格、日期）"],
      },
      {
        name: "sell",
        menu: "記錄賣出 /sell 2330 500 610",
        usage: ["/sell 2330 500 610 [10/20] [fee=43 tax=915] — 記錄賣出"],
      },
      {
        name: "div",
        menu: "記錄股利 /div 2330 cash 4500",
        usage: ["/div 2330 cash 4500 [日期] — 現金股利（入帳金額）", "/div 2330 stock 50 [日期] — 股票股利（股數）"],
      },
      { name: "tradedel", menu: "刪除交易 /tradedel 12", usage: ["/tradedel 12 — 刪除一筆交易（編號見 /pos）"] },
      { name: "holdings", menu: "持股清單與淨值", usage: ["/holdings — 持股清單與淨值加總"] },
      { name: "pos", menu: "個股明細 /pos 2330", usage: ["/pos 2330 — 個股成本、報酬與交易紀錄"] },
      { name: "trend", menu: "持股趨勢 /trend 2330 60", usage: ["/trend [2330] [60] — 未實現報酬率趨勢（預設 60 交易日）"] },
    ],
  },
  {
    title: "全域設定",
    commands: [
      {
        name: "set",
        menu: "全域設定 /set range 20",
        usage: [
          "/set range 20 — 觀察區間（日）",
          "/set ma 5,20,60,240 — 均線週期",
          "/set pct 240 — 位階百分位區間（日）",
          "/set fee 0.28 — 手續費折扣（0.28 = 2.8 折）",
          "/set feemin 20 — 整股最低手續費",
          "/set feeminodd 1 — 零股最低手續費",
        ],
      },
    ],
  },
  {
    title: "個股覆寫",
    commands: [
      {
        name: "override",
        menu: "個股設定 /override 2330 range=20",
        usage: ["/override 2330 range=20 ma=5,10,20 pct=60"],
      },
      { name: "reset", menu: "清除個股設定 /reset 2330", usage: ["/reset 2330 — 清除個股覆寫"] },
    ],
  },
  {
    commands: [{ name: "help", menu: "指令說明", usage: [] }],
  },
];

export const COMMANDS: CommandSpec[] = COMMAND_GROUPS.flatMap((g) => g.commands);

/** setMyCommands 的 commands 參數 */
export const MENU_COMMANDS = COMMANDS.map((c) => ({ command: c.name, description: c.menu }));

function formatGroup(group: CommandGroup): string[] {
  const lines = group.commands.flatMap((c) => c.usage);
  if (lines.length === 0) return [];
  return [[...(group.title ? [`${group.title}：`] : []), ...lines].join("\n")];
}

export const HELP = `📈 台股K棒監測 指令\n${COMMAND_GROUPS.flatMap(formatGroup).join("\n\n")}`;
