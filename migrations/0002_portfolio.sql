-- 持股交易紀錄：持股、均價、已實現損益都從這張表依 (trade_date, id) 順序重新計算，不另外存狀態
CREATE TABLE trades (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  stock_id   TEXT NOT NULL,
  type       TEXT NOT NULL CHECK (type IN ('buy', 'sell', 'cash_dividend', 'stock_dividend')),
  trade_date TEXT NOT NULL,
  shares     INTEGER NOT NULL DEFAULT 0, -- 買賣與股票股利的股數；現金股利為 0
  price      REAL,                       -- 買賣成交價；股利為 NULL
  amount     INTEGER NOT NULL DEFAULT 0, -- 現金股利入帳金額
  fee        INTEGER NOT NULL DEFAULT 0, -- 記錄當下算好的手續費，之後改費率不影響
  tax        INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX trades_stock_date ON trades (stock_id, trade_date, id);

-- 有交易紀錄的股票名稱；持股不一定在 watchlist 裡
CREATE TABLE stock_info (
  stock_id TEXT PRIMARY KEY,
  name     TEXT NOT NULL,
  market   TEXT
);

-- 手續費預設值：國泰證券電子下單 2.8 折、最低 1 元
INSERT INTO settings (key, value) VALUES
  ('fee_discount', '0.28'),
  ('fee_min', '1'),
  ('fee_min_odd', '1');
