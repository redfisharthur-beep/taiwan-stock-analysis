-- Cloudflare D1: safe to execute repeatedly; never drop an existing table.
CREATE TABLE IF NOT EXISTS stock_snapshots (
 stock TEXT PRIMARY KEY,
 market_date TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_snapshots_market_date ON stock_snapshots (market_date DESC);
