-- Apply with: npx wrangler d1 migrations apply taiwan-stock-market --remote
-- Company inventory includes suspended/no-quote stocks; missing data stays NULL, never fabricated.
CREATE TABLE IF NOT EXISTS companies (
 stock TEXT PRIMARY KEY, name TEXT NOT NULL, market TEXT NOT NULL, industry TEXT,
 close REAL, quote_date TEXT, turnover REAL, volume REAL,
 per REAL, pbr REAL, dividend_yield REAL, valuation_date TEXT,
 last_scan_at TEXT, last_attempt TEXT, last_profile_at TEXT, last_error TEXT
);
CREATE INDEX IF NOT EXISTS companies_name_idx ON companies(name);
CREATE INDEX IF NOT EXISTS companies_industry_idx ON companies(market,industry);
CREATE INDEX IF NOT EXISTS companies_queue_idx ON companies(last_profile_at,last_attempt);
CREATE TABLE IF NOT EXISTS market_profiles (
 stock TEXT PRIMARY KEY REFERENCES companies(stock),
 market_date TEXT,financial_period TEXT,technical_date TEXT,chips_date TEXT,
 score_json TEXT NOT NULL,metrics_json TEXT NOT NULL,candles_json TEXT NOT NULL,
 dataset_health_json TEXT NOT NULL,fetched_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS market_profiles_financial_idx ON market_profiles(financial_period);
CREATE TABLE IF NOT EXISTS financial_reports (
 stock TEXT NOT NULL REFERENCES companies(stock),dataset TEXT NOT NULL,
 report_period TEXT NOT NULL,rows_json TEXT NOT NULL,source TEXT NOT NULL,updated_at TEXT NOT NULL,
 PRIMARY KEY(stock,dataset,report_period)
);
CREATE TABLE IF NOT EXISTS market_bars (
 stock TEXT NOT NULL REFERENCES companies(stock),date TEXT NOT NULL,
 open REAL,high REAL,low REAL,close REAL NOT NULL,volume REAL,source TEXT NOT NULL,
 PRIMARY KEY(stock,date)
);
CREATE TABLE IF NOT EXISTS holder_weeks (
 stock TEXT NOT NULL REFERENCES companies(stock),source_date TEXT NOT NULL,
 share_pct REAL NOT NULL,updated_at TEXT NOT NULL,
 PRIMARY KEY(stock,source_date)
);
CREATE INDEX IF NOT EXISTS holder_weeks_date_idx ON holder_weeks(source_date);
CREATE TABLE IF NOT EXISTS holder_snapshots (
 stock TEXT PRIMARY KEY REFERENCES companies(stock),source_date TEXT NOT NULL,
 share_pct REAL,trend_json TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sync_state (
 key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL
);
