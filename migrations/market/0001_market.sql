-- Community market database (opt-in captures shared anonymously between RAX users) — see docs/COMMUNITY-MARKET.md.
-- Everything is WITHOUT ROWID: the text primary key IS the table, so a row costs one write instead of two (D1 bills row writes
-- including index maintenance, and the free tier is 100k/day). Every index below is there for a query in functions/api/market/community.ts
-- or for pruning; none is spare. NOTHING here can identify a person: contributor_hash is SHA-256(pepper + random client id),
-- net is 20 bits of a salted IP hash (shared by ~4,000 addresses), and no IP, username or Real account is ever stored.

-- One row per distinct sale. sale_key = normalised player|serial|minute|price|rating|rarity, so honest copies of the same sale
-- collapse into one row and a forged variant becomes its own, separate, never-corroborated row.
CREATE TABLE sales (
  sale_key    TEXT PRIMARY KEY,
  sport       TEXT,             -- only when the same capture's auctions identify the card unambiguously; usually NULL (sales carry no sport)
  type        TEXT,
  player      TEXT NOT NULL,
  serial      TEXT NOT NULL,
  rating      REAL NOT NULL,
  rarity      TEXT NOT NULL,    -- COMMON … ICONIC, upper case
  price       REAL NOT NULL,
  per_rating  REAL,
  at          INTEGER NOT NULL, -- sale time, epoch ms, floored to the minute
  outcome     TEXT,             -- Sold | Accepted | Open | No Sale | NULL (filter unread)
  first_seen  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL,
  reports     INTEGER NOT NULL DEFAULT 1  -- distinct contributors (on distinct networks) who reported it
) WITHOUT ROWID;
CREATE INDEX idx_sales_at ON sales (at);
-- Verified reads (reports >= 2) scan only verified rows. Queries must spell `reports >= 2` for SQLite to use it.
CREATE INDEX idx_sales_verified ON sales (at) WHERE reports >= 2;

-- Who reported what: the PK makes "one contributor, one vote" a database fact. `net` stops one network from voting twice.
CREATE TABLE sale_reports (
  sale_key         TEXT NOT NULL,
  contributor_hash TEXT NOT NULL,
  net              TEXT NOT NULL,
  PRIMARY KEY (sale_key, contributor_hash)
) WITHOUT ROWID;

-- Latest state of a live auction, plus how many distinct contributors have seen it.
CREATE TABLE auctions (
  auction_key   TEXT PRIMARY KEY,   -- SPORT|serial|player|TYPE|rating (same as the client's auctionKey)
  sport         TEXT NOT NULL,
  season        TEXT,
  rarity        TEXT NOT NULL,
  type          TEXT NOT NULL,
  rating        REAL NOT NULL,
  play          TEXT,
  player        TEXT NOT NULL,
  team          TEXT,
  serial        TEXT NOT NULL,
  bid           REAL NOT NULL,
  bids          INTEGER NOT NULL,
  watchers      INTEGER NOT NULL,
  time_left_sec INTEGER,
  end_at        INTEGER,            -- last sighting + timer shown then, epoch ms (approximate: the timer is rounded)
  first_seen    INTEGER NOT NULL,
  last_seen     INTEGER NOT NULL,
  npts          INTEGER NOT NULL DEFAULT 1,
  reports       INTEGER NOT NULL DEFAULT 1
) WITHOUT ROWID;
CREATE INDEX idx_auctions_seen ON auctions (last_seen);

-- Bid history: one point each time the bid changed (capped per auction by auctions.npts).
CREATE TABLE auction_points (
  auction_key TEXT NOT NULL,
  seen_at     INTEGER NOT NULL,
  bid         REAL NOT NULL,
  bids        INTEGER NOT NULL,
  PRIMARY KEY (auction_key, seen_at)
) WITHOUT ROWID;

CREATE TABLE auction_reports (
  auction_key      TEXT NOT NULL,
  contributor_hash TEXT NOT NULL,
  net              TEXT NOT NULL,
  PRIMARY KEY (auction_key, contributor_hash)
) WITHOUT ROWID;

-- Real's own "Market data" numbers for a card. stat_key includes median and totalSales, so a forged value is a separate row
-- that nobody corroborates, and a stat that really changed during the day becomes a newer row.
CREATE TABLE stats (
  stat_key          TEXT PRIMARY KEY,   -- name|serial|scope|window|day|median|totalSales
  name              TEXT NOT NULL,
  rating            REAL NOT NULL,
  rarity            TEXT NOT NULL,
  serial            TEXT NOT NULL,
  scope             TEXT,
  win               TEXT,
  median            REAL,
  median_per_rating REAL,
  total_sales       INTEGER,
  premium           REAL,
  min               REAL,
  max               REAL,
  q1                REAL,
  q3                REAL,
  seen_at           INTEGER NOT NULL,
  first_seen        INTEGER NOT NULL,
  last_seen         INTEGER NOT NULL,
  reports           INTEGER NOT NULL DEFAULT 1
) WITHOUT ROWID;
CREATE INDEX idx_stats_seen ON stats (seen_at);

CREATE TABLE stat_reports (
  stat_key         TEXT NOT NULL,
  contributor_hash TEXT NOT NULL,
  net              TEXT NOT NULL,
  PRIMARY KEY (stat_key, contributor_hash)
) WITHOUT ROWID;

-- Pseudonymous contributors (a salted hash of a random id kept in the contributor's own browser). Only used to count them.
CREATE TABLE contributors (
  contributor_hash TEXT PRIMARY KEY,
  first_seen       INTEGER NOT NULL,
  last_seen        INTEGER NOT NULL,
  contributions    INTEGER NOT NULL DEFAULT 1
) WITHOUT ROWID;

-- Hourly counters (contributor and network buckets). Rows expire after two hours and are pruned.
CREATE TABLE rate_limits (
  bucket  TEXT PRIMARY KEY,
  n       INTEGER NOT NULL,
  expires INTEGER NOT NULL
) WITHOUT ROWID;

-- Small key/value state: row-count estimates, today's estimated row writes, last prune, last contribution, coverage.
CREATE TABLE meta (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
) WITHOUT ROWID;
INSERT INTO meta (k, v) VALUES ('last_prune', '0'), ('last_recount', '0'), ('n_sales', '0'), ('n_auctions', '0'), ('n_stats', '0'), ('last_contribution', '0');
