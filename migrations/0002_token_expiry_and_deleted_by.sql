-- Optional token expiry, and which agent deleted a row.
ALTER TABLE tokens ADD COLUMN expires_at TEXT;
ALTER TABLE foods ADD COLUMN deleted_by TEXT;
ALTER TABLE entries ADD COLUMN deleted_by TEXT;
ALTER TABLE weights ADD COLUMN deleted_by TEXT;
