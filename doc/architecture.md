# 專案架構

這份文件用圖說明系統由哪些服務組成、程式模組怎麼分工、兩條主要流程（每日報告、Telegram 指令）怎麼跑，以及有哪些安全性防禦。
圖用 Mermaid 繪製，在 GitHub 上會直接顯示成圖。

## 系統架構

```mermaid
flowchart LR
  user["使用者<br/>Telegram App"]
  tg["Telegram Bot API"]
  gh["GitHub Actions<br/>push master 時部署"]
  fm["FinMind API<br/>TaiwanStockPrice / TaiwanStockInfo"]

  subgraph cf["Cloudflare"]
    cron["Cron Triggers<br/>週一至週五 台北 15:00、16:00"]
    subgraph worker["Worker：tw-stock-monitor"]
      fetchH["fetch()<br/>POST /telegram/webhook<br/>GET /health"]
      schedH["scheduled()"]
    end
    d1[("D1：stock-tw-monitor<br/>watchlist / settings<br/>daily_prices / job_runs")]
  end

  user <--> tg
  tg -- "webhook（附 secret token）" --> fetchH
  cron --> schedH
  fetchH --> d1
  schedH --> d1
  fetchH -- "查股票名稱、回補日K" --> fm
  schedH -- "增量抓日K" --> fm
  fetchH -- "sendMessage" --> tg
  schedH -- "sendMessage" --> tg
  gh -- "D1 migrations + wrangler deploy" --> worker
```

| 元件 | 角色 |
|---|---|
| Telegram Bot API | 收使用者指令（webhook 推給 Worker），送出回覆和報告 |
| Cron Triggers | 每個交易日 UTC 07:00、08:00（台北 15:00、16:00）觸發 `scheduled()` |
| Worker | 唯一的執行環境。`fetch()` 處理 webhook，`scheduled()` 產生每日報告 |
| D1 | 存監測清單、設定、日 K 快取和每日執行紀錄 |
| FinMind | 台股日 K 和股票基本資料的來源 |
| GitHub Actions | push 到 `master` 時跑型別檢查、測試、D1 migration，再部署 Worker |

## 程式模組

```mermaid
flowchart TD
  subgraph entry["進入點"]
    index["index.ts<br/>路由 fetch / scheduled"]
  end

  subgraph flow["流程"]
    bot["bot.ts<br/>解析與執行指令"]
    job["job.ts<br/>同步日K、產生報告"]
  end

  subgraph domain["純邏輯（不碰 I/O）"]
    analysis["analysis.ts<br/>趨勢、均線、位階計算"]
    report["report.ts<br/>報告文字格式"]
    config["config.ts<br/>參數預設、驗證、合併"]
    explain["explain.ts<br/>/explain 說明文字"]
  end

  subgraph io["外部服務"]
    db["db.ts<br/>D1 存取"]
    finmind["finmind.ts<br/>FinMind API"]
    telegram["telegram.ts<br/>sendMessage"]
  end

  index --> bot
  index --> job
  bot --> job
  bot --> config
  bot --> explain
  bot --> db
  bot --> finmind
  bot --> telegram
  job --> analysis
  job --> report
  job --> config
  job --> db
  job --> finmind
  job --> telegram
  report --> analysis
  db --> config
```

模組分成四層，箭頭只往下指：

- **進入點** `index.ts`：Worker 的 `fetch` 和 `scheduled` handler。webhook 會先驗證 `X-Telegram-Bot-Api-Secret-Token`，再交給 `bot.ts` 處理。
- **流程** `bot.ts`、`job.ts`：串接下面兩層。`/report` 和 `/add` 會重用 `job.ts` 的 `runReport`、`syncStock`。
- **純邏輯** `analysis.ts`、`report.ts`、`config.ts`、`explain.ts`：輸入資料、回傳結果，不呼叫任何外部服務，所以單元測試（`test/`）都集中在這一層。
- **外部服務** `db.ts`、`finmind.ts`、`telegram.ts`：各包一個外部服務，其他模組不直接下 SQL 或呼叫 HTTP API。

`types.ts` 放共用型別（`Env`、`Bar`、`StockConfig`、`WatchItem`），幾乎每個模組都會引用，圖中省略。

## 每日報告流程

```mermaid
sequenceDiagram
  autonumber
  participant Cron as Cron Trigger
  participant Job as job.ts runReport
  participant DB as D1
  participant FM as FinMind
  participant TG as Telegram

  Cron->>Job: scheduled() 台北 15:00 或 16:00
  Job->>DB: job_runs 今天是否已 sent
  alt 今天已推播
    Job-->>Cron: 結束
  end
  Job->>DB: 讀 watchlist
  loop 每檔股票
    Job->>DB: daily_prices 最新日期
    opt 還沒有今天的K棒
      Job->>FM: 抓最新日期之後的日K
      FM-->>Job: 日K
      Job->>DB: upsert daily_prices
    end
  end
  Job->>DB: 讀 settings 與每檔最近 300 根K棒
  Job->>Job: analyze() 與 formatReport()
  alt 沒有任何一檔有今天的K棒
    Job->>DB: job_runs 記為 no_data，等 16:00 補跑
  else 有資料
    Job->>TG: sendMessage，超過長度會拆成多則
    Job->>DB: job_runs 記為 sent
    Job->>DB: 刪除 600 天前的日K
  end
```

- 單一股票抓資料失敗不會中斷報告，會列在報告最後的「⚠️ 更新失敗」，該股票用資料庫裡既有的 K 棒分析。
- 手動 `/report` 走同一個 `runReport`，但略過「今天已推播」和「沒有當天資料」兩個檢查，也不寫 `job_runs`。

## Telegram 指令流程

以 `/add 2330` 為例：

```mermaid
sequenceDiagram
  autonumber
  participant U as 使用者
  participant TG as Telegram
  participant W as index.ts fetch
  participant Bot as bot.ts
  participant FM as FinMind
  participant DB as D1

  U->>TG: /add 2330
  TG->>W: POST /telegram/webhook
  alt secret token 不符
    W-->>TG: 403
  end
  W-->>TG: 200 ok，先回應避免 Telegram 重送
  W->>Bot: waitUntil(handleUpdate)
  Bot->>Bot: chat id 不在白名單就直接忽略
  Bot->>DB: 是否已在清單
  Bot->>FM: TaiwanStockInfo 查名稱
  Bot->>DB: 寫入 watchlist
  Bot->>FM: 回補約 420 天日K
  Bot->>DB: upsert daily_prices
  Bot->>TG: 2330 台積電 已新增
  TG->>U: 回覆
```

`/report` 走上面的每日報告流程。其他指令（`/list`、`/del`、`/set`、`/override` 等）只讀寫 D1，不會呼叫 FinMind。`/explain`、`/help` 直接回傳固定文字。

## 安全性設計

這個 bot 只給一個人（或一個 chat）使用，主要要防的是：陌生人冒充 Telegram 呼叫 webhook、其他 Telegram 使用者對 bot 下指令、密鑰外洩，以及惡意或錯誤的輸入。

### 請求防禦層

每個打到 Worker 的 HTTP 請求都要依序通過下面幾關，任何一關沒過就停止處理：

```mermaid
flowchart TD
  req["HTTPS 請求<br/>workers.dev 只接受 TLS"] --> route{"路徑與方法<br/>POST /telegram/webhook ?"}
  route -- "GET /health" --> health["回 ok<br/>不含任何資訊"]
  route -- "其他" --> nf["404"]
  route -- "是" --> secret{"X-Telegram-Bot-Api-Secret-Token<br/>等於 TELEGRAM_WEBHOOK_SECRET ?"}
  secret -- "否" --> forbidden["403<br/>不解析 body"]
  secret -- "是" --> ack["先回 200<br/>背景執行 handleUpdate"]
  ack --> chat{"chat id<br/>等於 ALLOWED_CHAT_ID ?"}
  chat -- "否" --> ignore["靜默忽略<br/>不回任何訊息"]
  chat -- "是" --> validate{"指令與參數驗證<br/>代號格式、數值範圍、數量上限"}
  validate -- "不合法" --> err["回覆錯誤說明"]
  validate -- "合法" --> exec["執行指令<br/>D1 參數化查詢 / FinMind / Telegram"]

  cron["Cron Trigger"] -. "不經過 HTTP，外部無法觸發" .-> sched["scheduled()"]
```

| 威脅 | 防禦方式 | 位置 |
|---|---|---|
| 有人知道 Worker 網址，偽造 Telegram 的 webhook 請求 | 比對 Telegram 帶來的 `X-Telegram-Bot-Api-Secret-Token`，不符就回 403，連 body 都不解析 | `src/index.ts` |
| 其他 Telegram 使用者找到這個 bot 並下指令 | 只處理 `ALLOWED_CHAT_ID` 的訊息，其他 chat 一律不回應，不洩漏 bot 的存在與用途 | `src/bot.ts` `handleUpdate` |
| 外部觸發每日報告、洗版推播 | 報告只由 Cron Trigger 呼叫 `scheduled()`，沒有對外的 HTTP 入口；`job_runs` 確保一天只自動推播一次 | `src/index.ts`、`src/job.ts` |
| SQL injection | 所有 SQL 都用 `prepare().bind()` 參數化，使用者輸入不會拼進 SQL 字串 | `src/db.ts` |
| 惡意或錯誤的參數 | 股票代號必須符合 `^\d{4,6}[A-Z]?$`；`range`、`ma`、`pct` 有上下限；均線最多 8 條 | `src/config.ts` |
| 一次塞大量股票，耗盡對外請求額度 | `/add` 一次最多 10 檔 | `src/bot.ts` `MAX_ADD_PER_COMMAND` |
| Telegram 等太久而重送同一則訊息，造成指令重複執行 | 先回 200，再用 `waitUntil` 在背景處理 | `src/index.ts` |
| 錯誤訊息帶出大量外部回應內容 | FinMind、Telegram 的錯誤回應只保留前 200 字 | `src/finmind.ts`、`src/telegram.ts` |
| 回覆內容被當成格式語法解析 | `sendMessage` 不設 `parse_mode`，以純文字送出 | `src/telegram.ts` |
| bot 收到不需要的更新類型 | 設定 webhook 時 `allowed_updates` 只開 `message` | `scripts/set-webhook.sh` |

### 密鑰管理

```mermaid
flowchart LR
  subgraph local["本機"]
    devvars[".dev.vars<br/>已列入 .gitignore"]
  end
  subgraph ghs["GitHub Secrets"]
    cfToken["CLOUDFLARE_API_TOKEN<br/>CLOUDFLARE_ACCOUNT_ID"]
  end
  subgraph cfs["Cloudflare Worker Secrets"]
    wsec["TELEGRAM_BOT_TOKEN<br/>TELEGRAM_WEBHOOK_SECRET<br/>ALLOWED_CHAT_ID<br/>FINMIND_TOKEN"]
  end

  devvars -- "wrangler dev" --> localWorker["本機 Worker"]
  cfToken -- "只用於部署" --> actions["GitHub Actions"]
  actions -- "wrangler deploy" --> worker["Worker"]
  wsec -- "執行時注入 env" --> worker
  worker -- "Authorization: Bearer" --> fm["FinMind"]
  worker -- "bot token 放在 API 網址路徑" --> tg["Telegram"]
```

| 密鑰 | 存放位置 | 用途 |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Worker Secret | 呼叫 Telegram Bot API |
| `TELEGRAM_WEBHOOK_SECRET` | Worker Secret | 驗證 webhook 請求確實來自 Telegram，建議用 `openssl rand -hex 32` 產生 |
| `ALLOWED_CHAT_ID` | Worker Secret | 白名單 chat |
| `FINMIND_TOKEN` | Worker Secret | 以 `Authorization` header 送出，不放在網址裡，避免出現在記錄中 |
| `CLOUDFLARE_API_TOKEN` | GitHub Secret | CI 部署用，權限只開 Workers Scripts:Edit 和 D1:Edit |

- 密鑰都不進版控：本機用 `.dev.vars`（已在 `.gitignore`），線上用 `wrangler secret put`，`.dev.vars.example` 只放假值。
- `wrangler.toml` 裡的 `database_id` 不是密鑰，沒有 Cloudflare 帳號權限無法存取資料庫。

### 已知限制

以下是目前沒有防禦、但以個人使用的情境風險較低的地方。要加強時可以從這裡著手：

| 項目 | 說明 | 可行的加強方式 |
|---|---|---|
| secret token 用一般字串比對 | `!==` 比對在理論上有時序攻擊的可能，但網路延遲的雜訊遠大於比對時間差，實務上很難利用 | 改用 Workers 提供的 `crypto.subtle.timingSafeEqual` |
| webhook 沒有流量限制 | 帶錯誤 token 的請求會被 403 擋下，但每次仍算一次 Worker 呼叫，大量請求會消耗免費額度 | 在 Cloudflare 設定 WAF Rate Limiting 規則，或只允許 Telegram 的 IP 範圍 |
| 沒有用 `update_id` 去重 | 先回 200 已大幅降低重送機率，但 Worker 若在回應前失敗，Telegram 重送時指令會再執行一次。目前的指令大多可以重複執行（例如 `/add` 會先檢查是否已在清單） | 在 D1 記錄處理過的 `update_id` |
| 白名單是 chat 而不是使用者 | 如果 `ALLOWED_CHAT_ID` 設成群組，群組裡每個人都能操作 bot | 改成檢查 `message.from.id` |
| 錯誤訊息直接回給使用者 | 例外訊息（含外部服務回應的前 200 字）會送到 Telegram。只有白名單 chat 看得到，風險有限 | 回覆通用錯誤訊息，細節只寫入 Worker 記錄 |
| GitHub Actions 使用版本標籤 | `actions/checkout@v4` 這類標籤可以被上游改指向別的 commit | 改用完整 commit SHA 固定版本 |

## 資料表

```mermaid
erDiagram
  watchlist ||--o{ daily_prices : "stock_id"
  watchlist {
    TEXT stock_id PK
    TEXT name
    TEXT market "twse / tpex / emerging"
    INTEGER range_days "NULL 表示用全域設定"
    TEXT ma_periods "JSON 陣列，NULL 表示用全域設定"
    INTEGER percentile_days "NULL 表示用全域設定"
    TEXT added_at
  }
  daily_prices {
    TEXT stock_id PK
    TEXT date PK
    REAL open
    REAL high
    REAL low
    REAL close
    INTEGER volume
  }
  settings {
    TEXT key PK "range_days / ma_periods / percentile_days"
    TEXT value
  }
  job_runs {
    TEXT run_date PK
    TEXT status "sent / no_data / error"
    TEXT detail
    TEXT finished_at
  }
```

- `settings` 存全域參數，`watchlist` 的三個覆寫欄位不是 NULL 時優先使用（`config.ts` 的 `resolveConfig`）。
- `daily_prices` 是 FinMind 日 K 的快取，讓每天只需要抓新增的資料。資料表之間沒有宣告外鍵，`/del` 時由程式一併刪除該股票的日 K。
- `job_runs` 一天一筆，用來避免同一天重複推播。

Schema 定義在 `migrations/`，部署時由 GitHub Actions 自動套用。
