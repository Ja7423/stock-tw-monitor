-- 監測清單：覆寫欄位為 NULL 時使用 settings 的全域預設
CREATE TABLE watchlist (
  stock_id        TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  market          TEXT,
  range_days      INTEGER,
  ma_periods      TEXT,
  percentile_days INTEGER,
  added_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO settings (key, value) VALUES
  ('range_days', '10'),
  ('ma_periods', '[5,10,20,60,120,240]'),
  ('percentile_days', '120');

-- 日K快取
CREATE TABLE daily_prices (
  stock_id TEXT NOT NULL,
  date     TEXT NOT NULL,
  open     REAL NOT NULL,
  high     REAL NOT NULL,
  low      REAL NOT NULL,
  close    REAL NOT NULL,
  volume   INTEGER NOT NULL,
  PRIMARY KEY (stock_id, date)
);

-- 每日排程執行紀錄（防止重複推播）
CREATE TABLE job_runs (
  run_date    TEXT PRIMARY KEY,
  status      TEXT NOT NULL,
  detail      TEXT,
  finished_at TEXT NOT NULL DEFAULT (datetime('now'))
);
