-- HivePantry schema. Add a new numbered file for each change; never edit an applied migration.
-- Nutrient columns hold amounts for one serving. Totals are servings x per-serving amounts.

CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  disabled_at TEXT
);

CREATE TABLE tokens (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  token_hash TEXT NOT NULL UNIQUE,
  scopes TEXT NOT NULL,
  label TEXT,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);
CREATE INDEX tokens_agent ON tokens (agent_id);

CREATE TABLE foods (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  brand TEXT,
  -- Lowercased, trimmed name and brand: the search and duplicate keys.
  name_key TEXT NOT NULL,
  brand_key TEXT NOT NULL DEFAULT '',
  serving_size REAL NOT NULL,
  serving_unit TEXT NOT NULL,
  serving_grams REAL,
  calories REAL NOT NULL,
  protein_g REAL NOT NULL,
  carbs_g REAL NOT NULL,
  fat_g REAL NOT NULL,
  fiber_g REAL,
  sugar_g REAL,
  sodium_mg REAL,
  barcode TEXT,
  notes TEXT,
  log_count INTEGER NOT NULL DEFAULT 0,
  last_logged_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
-- One live food per name and brand, so saving the same food twice updates it.
CREATE UNIQUE INDEX foods_name_brand ON foods (name_key, brand_key) WHERE deleted_at IS NULL;
CREATE INDEX foods_barcode ON foods (barcode) WHERE barcode IS NOT NULL;
CREATE INDEX foods_usage ON foods (log_count DESC, last_logged_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE entries (
  id TEXT PRIMARY KEY,
  -- The day the food counts toward, in PANTRY_TZ.
  local_date TEXT NOT NULL,
  consumed_at TEXT,
  meal TEXT NOT NULL CHECK (meal IN ('breakfast', 'lunch', 'dinner', 'snack', 'other')),
  food_id TEXT REFERENCES foods(id),
  name TEXT NOT NULL,
  brand TEXT,
  servings REAL NOT NULL,
  serving_size REAL,
  serving_unit TEXT,
  serving_grams REAL,
  -- A snapshot of the food's per-serving amounts when it was logged. A later food edit does not
  -- change past days.
  calories REAL NOT NULL,
  protein_g REAL NOT NULL,
  carbs_g REAL NOT NULL,
  fat_g REAL NOT NULL,
  fiber_g REAL,
  sugar_g REAL,
  sodium_mg REAL,
  note TEXT,
  agent_id TEXT NOT NULL,
  idempotency_key TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX entries_day ON entries (local_date) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX entries_idempotency ON entries (agent_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Daily targets. The row with the latest effective_from on or before a day applies to that day.
-- NULL means no target for that nutrient.
CREATE TABLE goals (
  effective_from TEXT PRIMARY KEY,
  calories REAL,
  protein_g REAL,
  carbs_g REAL,
  fat_g REAL,
  fiber_g REAL,
  sugar_g REAL,
  sodium_mg REAL,
  set_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE weights (
  id TEXT PRIMARY KEY,
  local_date TEXT NOT NULL,
  measured_at TEXT,
  weight_kg REAL NOT NULL,
  body_fat_pct REAL,
  note TEXT,
  agent_id TEXT NOT NULL,
  idempotency_key TEXT,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX weights_day ON weights (local_date) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX weights_idempotency ON weights (agent_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
