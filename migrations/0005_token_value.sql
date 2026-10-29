-- The owner can see an agent token again in the console. Lookups still use token_hash. A token made
-- before this migration has no value here, so the console asks for a new token. A revoke clears it.
ALTER TABLE tokens ADD COLUMN token_value TEXT;
