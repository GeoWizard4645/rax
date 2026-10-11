-- Latest Kalshi snapshot per sport, pushed by the odds-snapshot GitHub Actions loop (POST /api/odds/kalshi-push)
-- and read by GET /api/odds/events when Kalshi's API blocks the edge. One row per sport, overwritten each push.
CREATE TABLE IF NOT EXISTS kalshi_snapshot (
  sport        TEXT PRIMARY KEY,
  generated_at TEXT NOT NULL,  -- ISO time the runner fetched Kalshi
  body         TEXT NOT NULL   -- the snapshot JSON ({generatedAt, sport, payloads[]})
);
