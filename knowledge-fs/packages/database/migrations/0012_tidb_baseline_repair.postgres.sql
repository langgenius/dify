-- Knowledge Platform schema migration
-- Migration id: 0012_tidb_baseline_repair
-- Dialect: postgres

-- This forward repair exists because the pre-release TiDB baseline migrations were corrected in
-- place before their first supported production release. PostgreSQL never emitted the TiDB-only
-- TEXT-key, expression-index, FULLTEXT, or CHECK/foreign-key combinations being repaired. Keep a
-- paired, immutable artifact so both dialects advance through the same migration id.
SELECT 1 WHERE FALSE;
