-- Knowledge Platform schema migration
-- Migration id: 0045_quality_replay_match_policy
-- Dialect: postgres
-- Freezes each golden question's evidence match policy into durable quality replay items.

ALTER TABLE "quality_replay_items"
  ADD COLUMN IF NOT EXISTS "match_policy" VARCHAR(8);

UPDATE "quality_replay_items"
SET "match_policy" = 'all'
WHERE "match_policy" IS NULL;

ALTER TABLE "quality_replay_items"
  ALTER COLUMN "match_policy" SET NOT NULL;

ALTER TABLE "quality_replay_items"
  DROP CONSTRAINT IF EXISTS "quality_replay_items_match_policy_ck";

ALTER TABLE "quality_replay_items"
  ADD CONSTRAINT "quality_replay_items_match_policy_ck"
  CHECK ("match_policy" IN ('all', 'any'));
