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
    title: "全域設定",
    commands: [
      {
        name: "set",
        menu: "全域設定 /set range 20",
        usage: [
          "/set range 20 — 觀察區間（日）",
          "/set ma 5,20,60,240 — 均線週期",
          "/set pct 240 — 位階百分位區間（日）",
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
