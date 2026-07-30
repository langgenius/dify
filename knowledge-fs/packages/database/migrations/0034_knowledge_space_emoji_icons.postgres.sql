-- Knowledge Platform schema migration
-- Migration id: 0034_knowledge_space_emoji_icons
-- Dialect: postgres
-- Dify persists bounded Emoji Mart identities while retaining the legacy builtin-prefixed form.

ALTER TABLE "knowledge_spaces"
  DROP CONSTRAINT IF EXISTS "knowledge_spaces_icon_ref_ck";

ALTER TABLE "knowledge_spaces"
  ADD CONSTRAINT "knowledge_spaces_icon_ref_ck"
  CHECK (
    "icon_ref" IS NULL
    OR "icon_ref" ~ '^(builtin:)?[+a-z0-9_-]{1,64}$'
  );
