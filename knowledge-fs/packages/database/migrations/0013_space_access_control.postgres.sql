-- Knowledge Platform schema migration
-- Migration id: 0013_space_access_control
-- Dialect: postgres

CREATE TABLE IF NOT EXISTS "knowledge_space_members" (
  "id" UUID PRIMARY KEY NOT NULL,
  "tenant_id" VARCHAR(255) NOT NULL,
  "knowledge_space_id" UUID NOT NULL,
  "subject_id" VARCHAR(255) NOT NULL,
  "role" VARCHAR(16) NOT NULL,
  "revision" INTEGER NOT NULL,
  "created_by_subject_id" VARCHAR(255) NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "knowledge_space_members_role_ck"
    CHECK ("role" IN ('owner', 'editor', 'viewer')),
  CONSTRAINT "knowledge_space_members_revision_ck" CHECK ("revision" >= 1),
  CONSTRAINT "knowledge_space_members_space_fk" FOREIGN KEY ("tenant_id", "knowledge_space_id")
    REFERENCES "knowledge_spaces" ("tenant_id", "id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_space_members_scope_subject_uq"
  ON "knowledge_space_members" ("tenant_id", "knowledge_space_id", "subject_id");
CREATE INDEX IF NOT EXISTS "knowledge_space_members_scope_role_idx"
  ON "knowledge_space_members" (
    "tenant_id", "knowledge_space_id", "role", "subject_id", "id"
  );

CREATE TABLE IF NOT EXISTS "knowledge_space_access_policies" (
  "id" UUID PRIMARY KEY NOT NULL,
  "tenant_id" VARCHAR(255) NOT NULL,
  "knowledge_space_id" UUID NOT NULL,
  "visibility" VARCHAR(24) NOT NULL,
  "owner_subject_id" VARCHAR(255) NOT NULL,
  "revision" INTEGER NOT NULL,
  "updated_by_subject_id" VARCHAR(255) NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "knowledge_space_access_policies_visibility_ck"
    CHECK ("visibility" IN ('only_me', 'all_members', 'partial_members')),
  CONSTRAINT "knowledge_space_access_policies_revision_ck" CHECK ("revision" >= 1),
  CONSTRAINT "knowledge_space_access_policies_space_fk" FOREIGN KEY ("tenant_id", "knowledge_space_id")
    REFERENCES "knowledge_spaces" ("tenant_id", "id") ON DELETE CASCADE,
  CONSTRAINT "knowledge_space_access_policies_owner_fk" FOREIGN KEY ("tenant_id", "knowledge_space_id", "owner_subject_id")
    REFERENCES "knowledge_space_members" ("tenant_id", "knowledge_space_id", "subject_id")
    ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_space_access_policies_scope_uq"
  ON "knowledge_space_access_policies" ("tenant_id", "knowledge_space_id");
CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_space_access_policies_scope_id_uq"
  ON "knowledge_space_access_policies" ("tenant_id", "knowledge_space_id", "id");

CREATE TABLE IF NOT EXISTS "knowledge_space_access_policy_members" (
  "id" UUID PRIMARY KEY NOT NULL,
  "tenant_id" VARCHAR(255) NOT NULL,
  "knowledge_space_id" UUID NOT NULL,
  "access_policy_id" UUID NOT NULL,
  "subject_id" VARCHAR(255) NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "knowledge_space_access_policy_members_policy_fk" FOREIGN KEY ("tenant_id", "knowledge_space_id", "access_policy_id")
    REFERENCES "knowledge_space_access_policies" ("tenant_id", "knowledge_space_id", "id")
    ON DELETE CASCADE,
  CONSTRAINT "knowledge_space_access_policy_members_member_fk" FOREIGN KEY ("tenant_id", "knowledge_space_id", "subject_id")
    REFERENCES "knowledge_space_members" ("tenant_id", "knowledge_space_id", "subject_id")
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_space_access_policy_members_policy_subject_uq"
  ON "knowledge_space_access_policy_members" ("access_policy_id", "subject_id");
CREATE INDEX IF NOT EXISTS "knowledge_space_access_policy_members_scope_subject_idx"
  ON "knowledge_space_access_policy_members" (
    "tenant_id", "knowledge_space_id", "subject_id", "access_policy_id"
  );

CREATE TABLE IF NOT EXISTS "knowledge_space_api_access" (
  "id" UUID PRIMARY KEY NOT NULL,
  "tenant_id" VARCHAR(255) NOT NULL,
  "knowledge_space_id" UUID NOT NULL,
  "enabled" BOOLEAN NOT NULL,
  "disabled_at" TIMESTAMPTZ,
  "revision" INTEGER NOT NULL,
  "updated_by_subject_id" VARCHAR(255) NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "knowledge_space_api_access_revision_ck" CHECK ("revision" >= 1),
  CONSTRAINT "knowledge_space_api_access_disabled_ck" CHECK (
    ("enabled" AND "disabled_at" IS NULL)
    OR (NOT "enabled" AND "disabled_at" IS NOT NULL)
  ),
  CONSTRAINT "knowledge_space_api_access_space_fk" FOREIGN KEY ("tenant_id", "knowledge_space_id")
    REFERENCES "knowledge_spaces" ("tenant_id", "id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_space_api_access_scope_uq"
  ON "knowledge_space_api_access" ("tenant_id", "knowledge_space_id");

CREATE TABLE IF NOT EXISTS "knowledge_space_api_keys" (
  "id" UUID PRIMARY KEY NOT NULL,
  "tenant_id" VARCHAR(255) NOT NULL,
  "knowledge_space_id" UUID NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "key_prefix" VARCHAR(24) NOT NULL,
  "key_hash" VARCHAR(64) NOT NULL,
  "principal_subject_id" VARCHAR(255) NOT NULL,
  "status" VARCHAR(16) NOT NULL,
  "revision" INTEGER NOT NULL,
  "created_by_subject_id" VARCHAR(255) NOT NULL,
  "last_used_at" TIMESTAMPTZ,
  "expires_at" TIMESTAMPTZ,
  "revoked_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "knowledge_space_api_keys_status_ck"
    CHECK ("status" IN ('active', 'revoked')),
  CONSTRAINT "knowledge_space_api_keys_revision_ck" CHECK ("revision" >= 1),
  CONSTRAINT "knowledge_space_api_keys_revocation_ck" CHECK (
    ("status" = 'active' AND "revoked_at" IS NULL)
    OR ("status" = 'revoked' AND "revoked_at" IS NOT NULL)
  ),
  CONSTRAINT "knowledge_space_api_keys_space_fk" FOREIGN KEY ("tenant_id", "knowledge_space_id")
    REFERENCES "knowledge_spaces" ("tenant_id", "id") ON DELETE CASCADE,
  CONSTRAINT "knowledge_space_api_keys_principal_fk" FOREIGN KEY ("tenant_id", "knowledge_space_id", "principal_subject_id")
    REFERENCES "knowledge_space_members" ("tenant_id", "knowledge_space_id", "subject_id")
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_space_api_keys_hash_uq"
  ON "knowledge_space_api_keys" ("key_hash");
CREATE INDEX IF NOT EXISTS "knowledge_space_api_keys_scope_status_idx"
  ON "knowledge_space_api_keys" (
    "tenant_id", "knowledge_space_id", "status", "created_at", "id"
  );
CREATE INDEX IF NOT EXISTS "knowledge_space_api_keys_scope_created_idx"
  ON "knowledge_space_api_keys" (
    "tenant_id", "knowledge_space_id", "created_at", "id"
  );

CREATE TABLE IF NOT EXISTS "knowledge_space_permission_snapshots" (
  "id" UUID PRIMARY KEY NOT NULL,
  "tenant_id" VARCHAR(255) NOT NULL,
  "knowledge_space_id" UUID NOT NULL,
  "subject_id" VARCHAR(255) NOT NULL,
  "role" VARCHAR(16) NOT NULL,
  "visibility" VARCHAR(24) NOT NULL,
  "access_channel" VARCHAR(16) NOT NULL,
  "member_revision" INTEGER NOT NULL,
  "access_policy_revision" INTEGER NOT NULL,
  "api_access_revision" INTEGER NOT NULL,
  "permission_scopes" JSONB NOT NULL,
  "status" VARCHAR(16) NOT NULL,
  "revision" INTEGER NOT NULL,
  "expires_at" TIMESTAMPTZ NOT NULL,
  "revoked_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "knowledge_space_permission_snapshots_role_ck"
    CHECK ("role" IN ('owner', 'editor', 'viewer')),
  CONSTRAINT "knowledge_space_permission_snapshots_visibility_ck"
    CHECK ("visibility" IN ('only_me', 'all_members', 'partial_members')),
  CONSTRAINT "knowledge_space_permission_snapshots_channel_ck"
    CHECK ("access_channel" IN ('interactive', 'service_api', 'mcp', 'agent')),
  CONSTRAINT "knowledge_space_permission_snapshots_status_ck"
    CHECK ("status" IN ('active', 'revoked', 'expired')),
  CONSTRAINT "knowledge_space_permission_snapshots_revisions_ck" CHECK (
    "revision" >= 1
    AND "member_revision" >= 1
    AND "access_policy_revision" >= 1
    AND "api_access_revision" >= 1
  ),
  CONSTRAINT "knowledge_space_permission_snapshots_revocation_ck" CHECK (
    ("status" = 'revoked' AND "revoked_at" IS NOT NULL)
    OR ("status" <> 'revoked' AND "revoked_at" IS NULL)
  ),
  CONSTRAINT "knowledge_space_permission_snapshots_space_fk" FOREIGN KEY ("tenant_id", "knowledge_space_id")
    REFERENCES "knowledge_spaces" ("tenant_id", "id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "knowledge_space_permission_snapshots_scope_subject_idx"
  ON "knowledge_space_permission_snapshots" (
    "tenant_id", "knowledge_space_id", "subject_id", "status", "expires_at", "id"
  );
CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_space_permission_snapshots_scope_id_uq"
  ON "knowledge_space_permission_snapshots" ("tenant_id", "knowledge_space_id", "id");
