-- Settings that the console stores, so that the deploy form asks only for ADMIN_TOKEN.
--   time_zone: the IANA zone for days and daily totals. The console sends the browser's zone at the
--   first sign-in. PANTRY_TZ, when set on the worker, wins over it.
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
