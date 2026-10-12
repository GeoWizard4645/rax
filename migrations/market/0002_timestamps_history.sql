-- Keep-everything + timestamp-everything (see docs/COMMUNITY-MARKET.md): every report records WHEN it was received, and every
-- contribution is logged in a ledger. Nothing in sales / auctions / stats is ever pruned any more.
ALTER TABLE sale_reports    ADD COLUMN reported_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE auction_reports ADD COLUMN reported_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stat_reports    ADD COLUMN reported_at INTEGER NOT NULL DEFAULT 0;

-- One row per accepted contribution: server receipt time, the capture's own export time, and what it contained / added.
CREATE TABLE contributions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  received_at      INTEGER NOT NULL,   -- server clock, epoch ms
  captured_at      INTEGER,            -- the capture's own `at` (exporter's clock), epoch ms, NULL if absent/invalid
  contributor_hash TEXT NOT NULL,
  auctions         INTEGER NOT NULL,   -- accepted rows
  sales            INTEGER NOT NULL,
  stats            INTEGER NOT NULL,
  new_rows         INTEGER NOT NULL    -- rows nobody had reported before
);
CREATE INDEX idx_contributions_received ON contributions (received_at);
