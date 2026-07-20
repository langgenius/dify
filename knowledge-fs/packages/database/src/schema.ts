export type DatabaseDialect = "postgres" | "tidb";

// Keep synchronized with @knowledge/core's exported publication-generation sentinel. The database
// package deliberately stays dependency-free so migration tooling can run before application code.
const PUBLICATION_GENERATION_ID_SENTINEL = "00000000-0000-0000-0000-000000000000";
const TIDB_UUID_PATTERN =
  "^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$";

export interface ColumnDefinition {
  readonly dialects?: readonly DatabaseDialect[];
  readonly generatedAs?: Partial<Record<DatabaseDialect, string>>;
  readonly name: string;
  readonly nullable?: boolean;
  readonly primaryKey?: boolean;
  readonly type: Record<DatabaseDialect, string>;
}

export interface TableDefinition {
  readonly name: string;
  readonly columns: readonly ColumnDefinition[];
  readonly checkConstraints?: readonly CheckConstraintDefinition[];
  readonly foreignKeys?: readonly ForeignKeyDefinition[];
  readonly primaryKey?: readonly string[];
}

export interface CheckConstraintDefinition {
  readonly dialects?: readonly DatabaseDialect[];
  readonly expression: Record<DatabaseDialect, string>;
  readonly name: string;
}

export interface IndexDefinition {
  readonly columns: readonly string[];
  readonly columnsByDialect?: Partial<Record<DatabaseDialect, readonly string[]>>;
  readonly dialects?: readonly DatabaseDialect[];
  readonly expressions?: Partial<Record<DatabaseDialect, Readonly<Record<string, string>>>>;
  readonly name: string;
  readonly operatorClasses?: Partial<Record<DatabaseDialect, Readonly<Record<string, string>>>>;
  readonly purpose: string;
  readonly tableName: string;
  readonly unique?: boolean;
  readonly using?: Partial<Record<DatabaseDialect, string>>;
  readonly where?: Partial<Record<DatabaseDialect, string>>;
}

export interface ForeignKeyDefinition {
  readonly columns: readonly string[];
  readonly deferrability?: Partial<
    Record<
      DatabaseDialect,
      "DEFERRABLE INITIALLY DEFERRED" | "DEFERRABLE INITIALLY IMMEDIATE" | "NOT DEFERRABLE"
    >
  >;
  readonly inline?: boolean;
  readonly name?: string;
  readonly onDelete?: "CASCADE" | "SET NULL" | "RESTRICT";
  readonly onDeleteByDialect?: Partial<
    Record<DatabaseDialect, "CASCADE" | "NO ACTION" | "RESTRICT" | "SET NULL">
  >;
  readonly referencedColumns: readonly string[];
  readonly referencedTable: string;
}

export interface PerformanceIndexRequirement {
  readonly indexName: string;
  readonly purpose: string;
  readonly tableName: string;
}

export interface DatabaseSchemaCatalog {
  readonly indexes: readonly IndexDefinition[];
  readonly tables: readonly TableDefinition[];
}

const idColumn = (name = "id", nullable = false): ColumnDefinition => ({
  name,
  nullable,
  primaryKey: name === "id",
  type: {
    postgres: "UUID",
    tidb: "CHAR(36)",
  },
});

const textColumn = (name: string, nullable = false): ColumnDefinition => ({
  name,
  nullable,
  type: {
    postgres: "TEXT",
    tidb: "TEXT",
  },
});

const varcharColumn = (name: string, maxLength: number, nullable = false): ColumnDefinition => ({
  name,
  nullable,
  type: {
    postgres: `VARCHAR(${maxLength})`,
    tidb: `VARCHAR(${maxLength})`,
  },
});

const tidbGeneratedColumn = (name: string, type: string, expression: string): ColumnDefinition => ({
  dialects: ["tidb"],
  generatedAs: { tidb: expression },
  name,
  nullable: true,
  type: { postgres: type, tidb: type },
});

const integerColumn = (name: string, nullable = false): ColumnDefinition => ({
  name,
  nullable,
  type: {
    postgres: "INTEGER",
    tidb: "INT",
  },
});

const bigintColumn = (name: string, nullable = false): ColumnDefinition => ({
  name,
  nullable,
  type: {
    postgres: "BIGINT",
    tidb: "BIGINT",
  },
});

const doubleColumn = (name: string, nullable = false): ColumnDefinition => ({
  name,
  nullable,
  type: {
    postgres: "DOUBLE PRECISION",
    tidb: "DOUBLE",
  },
});

const timestampColumn = (name: string, nullable = false): ColumnDefinition => ({
  name,
  nullable,
  type: {
    postgres: "TIMESTAMPTZ",
    tidb: "DATETIME(3)",
  },
});

const jsonColumn = (name: string, nullable = false): ColumnDefinition => ({
  name,
  nullable,
  type: {
    postgres: "JSONB",
    tidb: "JSON",
  },
});

const vectorColumn = (name: string, nullable = false, dimensions?: number): ColumnDefinition => ({
  name,
  nullable,
  type: {
    postgres: dimensions ? `vector(${dimensions})` : "vector",
    tidb: dimensions ? `VECTOR(${dimensions})` : "VECTOR",
  },
});

const boolColumn = (name: string): ColumnDefinition => ({
  name,
  type: {
    postgres: "BOOLEAN",
    tidb: "BOOLEAN",
  },
});

const nonzeroUuidCheck = (
  name: string,
  columnName: string,
  nullable: boolean,
): CheckConstraintDefinition => {
  const postgresColumn = `"${columnName}"`;
  const tidbColumn = `\`${columnName}\``;

  return {
    expression: {
      postgres: `${nullable ? `${postgresColumn} IS NULL OR ` : ""}${postgresColumn} <> '${PUBLICATION_GENERATION_ID_SENTINEL}'::uuid`,
      tidb: `${nullable ? `${tidbColumn} IS NULL OR ` : ""}(${tidbColumn} REGEXP '${TIDB_UUID_PATTERN}' AND ${tidbColumn} <> '${PUBLICATION_GENERATION_ID_SENTINEL}')`,
    },
    name,
  };
};

const publicationGenerationCheck = (
  name: string,
  columnName: "generation_id" | "publication_generation_id",
  nullable: boolean,
): CheckConstraintDefinition => nonzeroUuidCheck(name, columnName, nullable);

const tables = [
  {
    name: "knowledge_spaces",
    checkConstraints: [
      {
        expression: {
          postgres: 'CHAR_LENGTH("tenant_id") <= 255',
          tidb: "CHAR_LENGTH(`tenant_id`) <= 255",
        },
        name: "knowledge_spaces_tenant_id_length_ck",
      },
      {
        expression: {
          postgres:
            '"revision" >= 1 AND (("lifecycle_state" = \'active\' AND "deletion_job_id" IS NULL AND "deleting_at" IS NULL) OR ("lifecycle_state" = \'deleting\' AND "deletion_job_id" IS NOT NULL AND "deleting_at" IS NOT NULL))',
          tidb: "`revision` >= 1 AND ((`lifecycle_state` = 'active' AND `deletion_job_id` IS NULL AND `deleting_at` IS NULL) OR (`lifecycle_state` = 'deleting' AND `deletion_job_id` IS NOT NULL AND `deleting_at` IS NOT NULL))",
        },
        name: "knowledge_spaces_deletion_lifecycle_ck",
      },
      {
        expression: {
          postgres:
            '"icon_ref" IS NULL OR "icon_ref" ~ \'^builtin:[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$\'',
          tidb: "`icon_ref` IS NULL OR `icon_ref` REGEXP '^builtin:[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$'",
        },
        name: "knowledge_spaces_icon_ref_ck",
      },
    ],
    columns: [
      idColumn(),
      varcharColumn("tenant_id", 255),
      varcharColumn("slug", 160),
      textColumn("name"),
      textColumn("description", true),
      varcharColumn("icon_ref", 72, true),
      integerColumn("revision"),
      varcharColumn("lifecycle_state", 16),
      idColumn("deletion_job_id", true),
      timestampColumn("deleting_at", true),
      timestampColumn("created_at"),
      timestampColumn("updated_at"),
    ],
  },
  {
    name: "knowledge_space_activity_events",
    foreignKeys: [
      {
        columns: ["tenant_id", "knowledge_space_id"],
        onDelete: "CASCADE",
        referencedColumns: ["tenant_id", "id"],
        referencedTable: "knowledge_spaces",
      },
    ],
    checkConstraints: [
      {
        expression: {
          postgres:
            '("actor_type" = \'member\' AND "actor_subject_id" IS NOT NULL) OR ("actor_type" = \'system\' AND "actor_subject_id" IS NULL)',
          tidb: "(`actor_type` = 'member' AND `actor_subject_id` IS NOT NULL) OR (`actor_type` = 'system' AND `actor_subject_id` IS NULL)",
        },
        name: "knowledge_space_activity_actor_ck",
      },
      {
        expression: {
          postgres:
            "\"action\" IN ('query.requested', 'query.completed', 'query.failed', 'document.published', 'document.failed', 'source.synced', 'source.failed', 'settings.updated', 'permission.updated', 'profile.published', 'worker.failed')",
          tidb: "`action` IN ('query.requested', 'query.completed', 'query.failed', 'document.published', 'document.failed', 'source.synced', 'source.failed', 'settings.updated', 'permission.updated', 'profile.published', 'worker.failed')",
        },
        name: "knowledge_space_activity_action_ck",
      },
      {
        expression: {
          postgres:
            "\"resource_type\" IN ('knowledge-space', 'query', 'document', 'source', 'permission', 'profile', 'publication', 'worker')",
          tidb: "`resource_type` IN ('knowledge-space', 'query', 'document', 'source', 'permission', 'profile', 'publication', 'worker')",
        },
        name: "knowledge_space_activity_resource_ck",
      },
      {
        expression: {
          postgres: "\"result\" IN ('pending', 'success', 'failure', 'canceled')",
          tidb: "`result` IN ('pending', 'success', 'failure', 'canceled')",
        },
        name: "knowledge_space_activity_result_ck",
      },
      {
        expression: {
          postgres: "jsonb_typeof(\"required_permission_scope\") = 'array'",
          tidb: "JSON_TYPE(`required_permission_scope`) = 'ARRAY'",
        },
        name: "knowledge_space_activity_scope_json_ck",
      },
      {
        expression: {
          postgres: "jsonb_typeof(\"details\") = 'object'",
          tidb: "JSON_TYPE(`details`) = 'OBJECT'",
        },
        name: "knowledge_space_activity_details_json_ck",
      },
    ],
    columns: [
      idColumn(),
      varcharColumn("tenant_id", 255),
      idColumn("knowledge_space_id"),
      varcharColumn("actor_type", 16),
      varcharColumn("actor_subject_id", 255, true),
      varcharColumn("action", 64),
      varcharColumn("resource_type", 32),
      varcharColumn("resource_id", 255, true),
      varcharColumn("result", 16),
      jsonColumn("required_permission_scope"),
      jsonColumn("details"),
      timestampColumn("occurred_at"),
    ],
  },
  {
    name: "knowledge_space_attention_states",
    foreignKeys: [
      {
        columns: ["tenant_id", "knowledge_space_id"],
        onDelete: "CASCADE",
        referencedColumns: ["tenant_id", "id"],
        referencedTable: "knowledge_spaces",
      },
    ],
    checkConstraints: [
      {
        expression: {
          postgres:
            "\"rule_id\" IN ('stale-source', 'failed-document', 'low-quality-query', 'permission-readiness', 'model-readiness')",
          tidb: "`rule_id` IN ('stale-source', 'failed-document', 'low-quality-query', 'permission-readiness', 'model-readiness')",
        },
        name: "knowledge_space_attention_rule_ck",
      },
      {
        expression: {
          postgres:
            "\"resource_type\" IN ('knowledge-space', 'document', 'source', 'failed-query')",
          tidb: "`resource_type` IN ('knowledge-space', 'document', 'source', 'failed-query')",
        },
        name: "knowledge_space_attention_resource_ck",
      },
      {
        expression: {
          postgres: "\"status\" IN ('active', 'dismissed', 'resolved')",
          tidb: "`status` IN ('active', 'dismissed', 'resolved')",
        },
        name: "knowledge_space_attention_status_ck",
      },
      {
        expression: {
          postgres:
            '("status" = \'dismissed\' AND "dismissed_until" IS NOT NULL) OR ("status" <> \'dismissed\' AND "dismissed_until" IS NULL)',
          tidb: "(`status` = 'dismissed' AND `dismissed_until` IS NOT NULL) OR (`status` <> 'dismissed' AND `dismissed_until` IS NULL)",
        },
        name: "knowledge_space_attention_dismiss_ck",
      },
      {
        expression: { postgres: '"revision" >= 1', tidb: "`revision` >= 1" },
        name: "knowledge_space_attention_revision_ck",
      },
    ],
    columns: [
      idColumn(),
      varcharColumn("tenant_id", 255),
      idColumn("knowledge_space_id"),
      varcharColumn("issue_key", 255),
      varcharColumn("rule_id", 64),
      varcharColumn("resource_type", 32),
      varcharColumn("resource_id", 255),
      varcharColumn("status", 16),
      timestampColumn("dismissed_until", true),
      integerColumn("revision"),
      varcharColumn("updated_by_subject_id", 255, true),
      timestampColumn("created_at"),
      timestampColumn("updated_at"),
    ],
  },
  {
    name: "knowledge_space_manifests",
    foreignKeys: [
      {
        columns: ["tenant_id", "knowledge_space_id"],
        onDelete: "CASCADE",
        referencedColumns: ["tenant_id", "id"],
        referencedTable: "knowledge_spaces",
      },
    ],
    columns: [
      idColumn(),
      varcharColumn("tenant_id", 255),
      idColumn("knowledge_space_id"),
      integerColumn("manifest_version"),
      textColumn("storage_provider"),
      textColumn("object_key_prefix"),
      textColumn("metadata_dialect"),
      textColumn("parser_policy_version"),
      integerColumn("node_schema_version"),
      textColumn("projection_set_version"),
      textColumn("min_client_version"),
      jsonColumn("retention_policy"),
      jsonColumn("quota_policy"),
      jsonColumn("consistency_policy"),
      jsonColumn("encryption_policy"),
      jsonColumn("metadata"),
      timestampColumn("created_at"),
      timestampColumn("updated_at"),
    ],
  },
  {
    name: "knowledge_space_profile_revisions",
    checkConstraints: [
      {
        expression: {
          postgres: `"kind" IN ('embedding', 'retrieval')`,
          tidb: "`kind` IN ('embedding', 'retrieval')",
        },
        name: "knowledge_space_profile_revisions_kind_ck",
      },
      {
        expression: {
          postgres: `"state" IN ('candidate', 'active', 'superseded', 'failed')`,
          tidb: "`state` IN ('candidate', 'active', 'superseded', 'failed')",
        },
        name: "knowledge_space_profile_revisions_state_ck",
      },
      {
        expression: {
          postgres: '"revision" >= 1 AND ("dimension" IS NULL OR "dimension" >= 1)',
          tidb: "`revision` >= 1 AND (`dimension` IS NULL OR `dimension` >= 1)",
        },
        name: "knowledge_space_profile_revisions_positive_ck",
      },
      {
        expression: {
          postgres:
            '(("kind" = \'embedding\' AND "vector_space_id" IS NOT NULL AND "dimension" IS NOT NULL AND "dimension" >= 1) OR ("kind" = \'retrieval\' AND "vector_space_id" IS NULL AND "dimension" IS NULL))',
          tidb: "((`kind` = 'embedding' AND `vector_space_id` IS NOT NULL AND `dimension` IS NOT NULL AND `dimension` >= 1) OR (`kind` = 'retrieval' AND `vector_space_id` IS NULL AND `dimension` IS NULL))",
        },
        name: "knowledge_space_profile_revisions_vector_shape_ck",
      },
      {
        expression: {
          postgres:
            '(("state" = \'candidate\' AND "activated_at" IS NULL AND "superseded_at" IS NULL AND "failed_at" IS NULL AND "failure_code" IS NULL AND "failure_message" IS NULL) OR ("state" = \'active\' AND "activated_at" IS NOT NULL AND "superseded_at" IS NULL AND "failed_at" IS NULL AND "failure_code" IS NULL AND "failure_message" IS NULL) OR ("state" = \'superseded\' AND "activated_at" IS NOT NULL AND "superseded_at" IS NOT NULL AND "failed_at" IS NULL AND "failure_code" IS NULL AND "failure_message" IS NULL) OR ("state" = \'failed\' AND "activated_at" IS NULL AND "superseded_at" IS NULL AND "failed_at" IS NOT NULL AND "failure_code" IS NOT NULL AND "failure_message" IS NOT NULL))',
          tidb: "((`state` = 'candidate' AND `activated_at` IS NULL AND `superseded_at` IS NULL AND `failed_at` IS NULL AND `failure_code` IS NULL AND `failure_message` IS NULL) OR (`state` = 'active' AND `activated_at` IS NOT NULL AND `superseded_at` IS NULL AND `failed_at` IS NULL AND `failure_code` IS NULL AND `failure_message` IS NULL) OR (`state` = 'superseded' AND `activated_at` IS NOT NULL AND `superseded_at` IS NOT NULL AND `failed_at` IS NULL AND `failure_code` IS NULL AND `failure_message` IS NULL) OR (`state` = 'failed' AND `activated_at` IS NULL AND `superseded_at` IS NULL AND `failed_at` IS NOT NULL AND `failure_code` IS NOT NULL AND `failure_message` IS NOT NULL))",
        },
        name: "knowledge_space_profile_revisions_lifecycle_ck",
      },
    ],
    foreignKeys: [
      {
        columns: ["tenant_id", "knowledge_space_id"],
        onDelete: "CASCADE",
        referencedColumns: ["tenant_id", "id"],
        referencedTable: "knowledge_spaces",
      },
    ],
    columns: [
      idColumn(),
      varcharColumn("tenant_id", 255),
      idColumn("knowledge_space_id"),
      varcharColumn("kind", 16),
      integerColumn("revision"),
      varcharColumn("state", 16),
      jsonColumn("snapshot"),
      { name: "snapshot_digest", type: { postgres: "CHAR(64)", tidb: "CHAR(64)" } },
      jsonColumn("capability_snapshot"),
      {
        name: "capability_snapshot_digest",
        type: { postgres: "CHAR(64)", tidb: "CHAR(64)" },
      },
      varcharColumn("plugin_id", 256),
      varcharColumn("provider", 256),
      varcharColumn("model", 256),
      varcharColumn("vector_space_id", 87, true),
      integerColumn("dimension", true),
      varcharColumn("created_by_subject_id", 255),
      varcharColumn("failure_code", 64, true),
      textColumn("failure_message", true),
      timestampColumn("created_at"),
      timestampColumn("updated_at"),
      timestampColumn("activated_at", true),
      timestampColumn("superseded_at", true),
      timestampColumn("failed_at", true),
    ],
  },
  {
    name: "knowledge_space_profile_heads",
    checkConstraints: [
      {
        expression: {
          postgres: `"kind" IN ('embedding', 'retrieval')`,
          tidb: "`kind` IN ('embedding', 'retrieval')",
        },
        name: "knowledge_space_profile_heads_kind_ck",
      },
      {
        expression: {
          postgres: '"active_revision" >= 1 AND "row_version" >= 1',
          tidb: "`active_revision` >= 1 AND `row_version` >= 1",
        },
        name: "knowledge_space_profile_heads_positive_ck",
      },
    ],
    foreignKeys: [
      {
        columns: ["tenant_id", "knowledge_space_id"],
        onDelete: "CASCADE",
        referencedColumns: ["tenant_id", "id"],
        referencedTable: "knowledge_spaces",
      },
      {
        columns: [
          "tenant_id",
          "knowledge_space_id",
          "kind",
          "profile_revision_id",
          "active_revision",
        ],
        onDelete: "RESTRICT",
        referencedColumns: ["tenant_id", "knowledge_space_id", "kind", "id", "revision"],
        referencedTable: "knowledge_space_profile_revisions",
      },
    ],
    columns: [
      idColumn(),
      varcharColumn("tenant_id", 255),
      idColumn("knowledge_space_id"),
      varcharColumn("kind", 16),
      idColumn("profile_revision_id"),
      integerColumn("active_revision"),
      integerColumn("row_version"),
      timestampColumn("created_at"),
      timestampColumn("updated_at"),
    ],
  },
  {
    name: "projection_set_publications",
    checkConstraints: [
      {
        expression: {
          postgres:
            "\"status\" IN ('candidate', 'inactive', 'published', 'superseded', 'validating')",
          tidb: "`status` IN ('candidate', 'inactive', 'published', 'superseded', 'validating')",
        },
        name: "projection_set_publications_status_ck",
      },
    ],
    foreignKeys: [
      {
        columns: ["knowledge_space_id"],
        onDelete: "CASCADE",
        referencedColumns: ["id"],
        referencedTable: "knowledge_spaces",
      },
    ],
    columns: [
      idColumn(),
      varcharColumn("tenant_id", 255),
      idColumn("knowledge_space_id"),
      varcharColumn("fingerprint", 86),
      integerColumn("projection_version"),
      varcharColumn("status", 16),
      varcharColumn("superseded_by_fingerprint", 86, true),
      jsonColumn("metadata"),
      timestampColumn("created_at"),
      timestampColumn("updated_at"),
    ],
  },
  {
    name: "knowledge_space_profile_publication_bindings",
    checkConstraints: [
      {
        expression: {
          postgres:
            "\"changed_kind\" IN ('embedding', 'retrieval', 'bootstrap', 'content') AND \"retrieval_profile_kind\" = 'retrieval' AND (\"embedding_profile_kind\" IS NULL OR \"embedding_profile_kind\" = 'embedding')",
          tidb: "`changed_kind` IN ('embedding', 'retrieval', 'bootstrap', 'content') AND `retrieval_profile_kind` = 'retrieval' AND (`embedding_profile_kind` IS NULL OR `embedding_profile_kind` = 'embedding')",
        },
        name: "knowledge_space_profile_publication_bindings_kind_ck",
      },
      {
        expression: {
          postgres:
            "((\"binding_reason\" = 'candidate-switch' AND \"changed_kind\" IN ('embedding', 'retrieval')) OR (\"binding_reason\" = 'legacy-bootstrap' AND \"changed_kind\" = 'bootstrap') OR (\"binding_reason\" = 'content-publication' AND \"changed_kind\" = 'content'))",
          tidb: "((`binding_reason` = 'candidate-switch' AND `changed_kind` IN ('embedding', 'retrieval')) OR (`binding_reason` = 'legacy-bootstrap' AND `changed_kind` = 'bootstrap') OR (`binding_reason` = 'content-publication' AND `changed_kind` = 'content'))",
        },
        name: "knowledge_space_profile_publication_bindings_reason_ck",
      },
      {
        expression: {
          postgres:
            '"retrieval_profile_revision" >= 1 AND ((("embedding_profile_kind" IS NULL AND "embedding_profile_revision_id" IS NULL AND "embedding_profile_revision" IS NULL AND "embedding_profile_snapshot_digest" IS NULL AND "vector_space_id" IS NULL AND "changed_kind" IN (\'retrieval\', \'bootstrap\', \'content\')) OR ("embedding_profile_kind" = \'embedding\' AND "embedding_profile_revision_id" IS NOT NULL AND "embedding_profile_revision" >= 1 AND "embedding_profile_snapshot_digest" IS NOT NULL AND "vector_space_id" IS NOT NULL))) AND ("binding_reason" = \'candidate-switch\' OR ("binding_reason" IN (\'legacy-bootstrap\', \'content-publication\') AND "activated_at" IS NOT NULL))',
          tidb: "`retrieval_profile_revision` >= 1 AND (((`embedding_profile_kind` IS NULL AND `embedding_profile_revision_id` IS NULL AND `embedding_profile_revision` IS NULL AND `embedding_profile_snapshot_digest` IS NULL AND `vector_space_id` IS NULL AND `changed_kind` IN ('retrieval', 'bootstrap', 'content')) OR (`embedding_profile_kind` = 'embedding' AND `embedding_profile_revision_id` IS NOT NULL AND `embedding_profile_revision` >= 1 AND `embedding_profile_snapshot_digest` IS NOT NULL AND `vector_space_id` IS NOT NULL))) AND (`binding_reason` = 'candidate-switch' OR (`binding_reason` IN ('legacy-bootstrap', 'content-publication') AND `activated_at` IS NOT NULL))",
        },
        name: "knowledge_space_profile_publication_bindings_shape_ck",
      },
    ],
    foreignKeys: [
      {
        columns: ["tenant_id", "knowledge_space_id"],
        onDelete: "CASCADE",
        referencedColumns: ["tenant_id", "id"],
        referencedTable: "knowledge_spaces",
      },
      {
        columns: [
          "tenant_id",
          "knowledge_space_id",
          "embedding_profile_kind",
          "embedding_profile_revision_id",
          "embedding_profile_revision",
          "embedding_profile_snapshot_digest",
        ],
        onDelete: "RESTRICT",
        referencedColumns: [
          "tenant_id",
          "knowledge_space_id",
          "kind",
          "id",
          "revision",
          "snapshot_digest",
        ],
        referencedTable: "knowledge_space_profile_revisions",
      },
      {
        columns: [
          "tenant_id",
          "knowledge_space_id",
          "retrieval_profile_kind",
          "retrieval_profile_revision_id",
          "retrieval_profile_revision",
          "retrieval_profile_snapshot_digest",
        ],
        onDelete: "RESTRICT",
        referencedColumns: [
          "tenant_id",
          "knowledge_space_id",
          "kind",
          "id",
          "revision",
          "snapshot_digest",
        ],
        referencedTable: "knowledge_space_profile_revisions",
      },
      {
        columns: ["tenant_id", "knowledge_space_id", "publication_id", "publication_fingerprint"],
        onDelete: "RESTRICT",
        referencedColumns: ["tenant_id", "knowledge_space_id", "id", "fingerprint"],
        referencedTable: "projection_set_publications",
      },
    ],
    columns: [
      idColumn(),
      varcharColumn("tenant_id", 255),
      idColumn("knowledge_space_id"),
      varcharColumn("changed_kind", 16),
      varcharColumn("binding_reason", 24),
      varcharColumn("embedding_profile_kind", 16, true),
      idColumn("embedding_profile_revision_id", true),
      integerColumn("embedding_profile_revision", true),
      {
        name: "embedding_profile_snapshot_digest",
        nullable: true,
        type: { postgres: "CHAR(64)", tidb: "CHAR(64)" },
      },
      varcharColumn("retrieval_profile_kind", 16),
      idColumn("retrieval_profile_revision_id"),
      integerColumn("retrieval_profile_revision"),
      {
        name: "retrieval_profile_snapshot_digest",
        type: { postgres: "CHAR(64)", tidb: "CHAR(64)" },
      },
      varcharColumn("vector_space_id", 87, true),
      idColumn("publication_id"),
      varcharColumn("publication_fingerprint", 86),
      timestampColumn("created_at"),
      timestampColumn("activated_at", true),
    ],
  },
  {
    name: "knowledge_space_profile_migration_runs",
    checkConstraints: [
      {
        expression: {
          postgres:
            '"changed_kind" IN (\'embedding\', \'retrieval\') AND "candidate_profile_kind" = "changed_kind" AND "base_retrieval_profile_kind" = \'retrieval\' AND ("base_embedding_profile_kind" IS NULL OR "base_embedding_profile_kind" = \'embedding\')',
          tidb: "`changed_kind` IN ('embedding', 'retrieval') AND `candidate_profile_kind` = `changed_kind` AND `base_retrieval_profile_kind` = 'retrieval' AND (`base_embedding_profile_kind` IS NULL OR `base_embedding_profile_kind` = 'embedding')",
        },
        name: "knowledge_space_profile_migration_runs_kind_ck",
      },
      {
        expression: {
          postgres:
            "((\"changed_kind\" = 'embedding' AND \"rebuild_scope\" = 'full-vector-space') OR (\"changed_kind\" = 'retrieval' AND \"rebuild_scope\" IN ('clone-publication', 'full-page-index-summary-outline')))",
          tidb: "((`changed_kind` = 'embedding' AND `rebuild_scope` = 'full-vector-space') OR (`changed_kind` = 'retrieval' AND `rebuild_scope` IN ('clone-publication', 'full-page-index-summary-outline')))",
        },
        name: "knowledge_space_profile_migration_runs_scope_ck",
      },
      {
        expression: {
          postgres: "\"run_state\" IN ('queued', 'running', 'succeeded', 'failed', 'canceled')",
          tidb: "`run_state` IN ('queued', 'running', 'succeeded', 'failed', 'canceled')",
        },
        name: "knowledge_space_profile_migration_runs_state_ck",
      },
      {
        expression: {
          postgres: "\"checkpoint\" IN ('queued', 'candidate-built', 'evaluated', 'activated')",
          tidb: "`checkpoint` IN ('queued', 'candidate-built', 'evaluated', 'activated')",
        },
        name: "knowledge_space_profile_migration_runs_checkpoint_ck",
      },
      {
        expression: {
          postgres:
            '"candidate_profile_revision" >= 1 AND "base_retrieval_profile_revision" >= 1 AND "base_publication_head_revision" >= 1 AND "permission_snapshot_revision" >= 1 AND "execution_attempts" >= 0 AND "max_execution_attempts" >= 1 AND "execution_attempts" <= "max_execution_attempts" AND "row_version" >= 1 AND ("active_slot" IS NULL OR "active_slot" = 1)',
          tidb: "`candidate_profile_revision` >= 1 AND `base_retrieval_profile_revision` >= 1 AND `base_publication_head_revision` >= 1 AND `permission_snapshot_revision` >= 1 AND `execution_attempts` >= 0 AND `max_execution_attempts` >= 1 AND `execution_attempts` <= `max_execution_attempts` AND `row_version` >= 1 AND (`active_slot` IS NULL OR `active_slot` = 1)",
        },
        name: "knowledge_space_profile_migration_runs_positive_ck",
      },
      {
        expression: {
          postgres:
            '(("base_embedding_profile_kind" IS NULL AND "base_embedding_profile_revision_id" IS NULL AND "base_embedding_profile_revision" IS NULL AND "base_embedding_profile_snapshot_digest" IS NULL) OR ("base_embedding_profile_kind" = \'embedding\' AND "base_embedding_profile_revision_id" IS NOT NULL AND "base_embedding_profile_revision" >= 1 AND "base_embedding_profile_snapshot_digest" IS NOT NULL))',
          tidb: "((`base_embedding_profile_kind` IS NULL AND `base_embedding_profile_revision_id` IS NULL AND `base_embedding_profile_revision` IS NULL AND `base_embedding_profile_snapshot_digest` IS NULL) OR (`base_embedding_profile_kind` = 'embedding' AND `base_embedding_profile_revision_id` IS NOT NULL AND `base_embedding_profile_revision` >= 1 AND `base_embedding_profile_snapshot_digest` IS NOT NULL))",
        },
        name: "knowledge_space_profile_migration_runs_embedding_ref_ck",
      },
      {
        expression: {
          postgres:
            '(("candidate_publication_id" IS NULL AND "candidate_publication_fingerprint" IS NULL) OR ("candidate_publication_id" IS NOT NULL AND "candidate_publication_fingerprint" IS NOT NULL))',
          tidb: "((`candidate_publication_id` IS NULL AND `candidate_publication_fingerprint` IS NULL) OR (`candidate_publication_id` IS NOT NULL AND `candidate_publication_fingerprint` IS NOT NULL))",
        },
        name: "knowledge_space_profile_migration_runs_candidate_publication_ck",
      },
      {
        expression: {
          postgres:
            '(("checkpoint" = \'queued\' AND "candidate_publication_id" IS NULL AND "candidate_publication_fingerprint" IS NULL AND "evaluation_summary" IS NULL) OR ("checkpoint" = \'candidate-built\' AND "candidate_publication_id" IS NOT NULL AND "candidate_publication_fingerprint" IS NOT NULL AND "evaluation_summary" IS NULL) OR ("checkpoint" IN (\'evaluated\', \'activated\') AND "candidate_publication_id" IS NOT NULL AND "candidate_publication_fingerprint" IS NOT NULL AND "evaluation_summary" IS NOT NULL AND jsonb_typeof("evaluation_summary") = \'object\'))',
          tidb: "((`checkpoint` = 'queued' AND `candidate_publication_id` IS NULL AND `candidate_publication_fingerprint` IS NULL AND `evaluation_summary` IS NULL) OR (`checkpoint` = 'candidate-built' AND `candidate_publication_id` IS NOT NULL AND `candidate_publication_fingerprint` IS NOT NULL AND `evaluation_summary` IS NULL) OR (`checkpoint` IN ('evaluated', 'activated') AND `candidate_publication_id` IS NOT NULL AND `candidate_publication_fingerprint` IS NOT NULL AND `evaluation_summary` IS NOT NULL AND JSON_TYPE(`evaluation_summary`) = 'OBJECT'))",
        },
        name: "knowledge_space_profile_migration_runs_checkpoint_shape_ck",
      },
      {
        expression: {
          postgres:
            '(("run_state" = \'running\' AND "worker_id" IS NOT NULL AND "lease_token" IS NOT NULL AND "lease_expires_at" IS NOT NULL AND "heartbeat_at" IS NOT NULL) OR ("run_state" <> \'running\' AND "worker_id" IS NULL AND "lease_token" IS NULL AND "lease_expires_at" IS NULL AND "heartbeat_at" IS NULL))',
          tidb: "((`run_state` = 'running' AND `worker_id` IS NOT NULL AND `lease_token` IS NOT NULL AND `lease_expires_at` IS NOT NULL AND `heartbeat_at` IS NOT NULL) OR (`run_state` <> 'running' AND `worker_id` IS NULL AND `lease_token` IS NULL AND `lease_expires_at` IS NULL AND `heartbeat_at` IS NULL))",
        },
        name: "knowledge_space_profile_migration_runs_lease_ck",
      },
      {
        expression: {
          postgres:
            '(("run_state" IN (\'queued\', \'running\') AND "active_slot" = 1 AND "completed_at" IS NULL AND "canceled_at" IS NULL) OR ("run_state" = \'succeeded\' AND "checkpoint" = \'activated\' AND "active_slot" IS NULL AND "completed_at" IS NOT NULL AND "canceled_at" IS NULL AND "last_error_code" IS NULL AND "last_error_message" IS NULL) OR ("run_state" = \'failed\' AND "completed_at" IS NOT NULL AND "active_slot" IS NULL AND "canceled_at" IS NULL AND "last_error_code" IS NOT NULL AND "last_error_message" IS NOT NULL) OR ("run_state" = \'canceled\' AND "completed_at" IS NOT NULL AND "active_slot" IS NULL AND "canceled_at" IS NOT NULL))',
          tidb: "((`run_state` IN ('queued', 'running') AND `active_slot` = 1 AND `completed_at` IS NULL AND `canceled_at` IS NULL) OR (`run_state` = 'succeeded' AND `checkpoint` = 'activated' AND `active_slot` IS NULL AND `completed_at` IS NOT NULL AND `canceled_at` IS NULL AND `last_error_code` IS NULL AND `last_error_message` IS NULL) OR (`run_state` = 'failed' AND `completed_at` IS NOT NULL AND `active_slot` IS NULL AND `canceled_at` IS NULL AND `last_error_code` IS NOT NULL AND `last_error_message` IS NOT NULL) OR (`run_state` = 'canceled' AND `completed_at` IS NOT NULL AND `active_slot` IS NULL AND `canceled_at` IS NOT NULL))",
        },
        name: "knowledge_space_profile_migration_runs_lifecycle_ck",
      },
      {
        expression: {
          postgres: "\"idempotency_digest\" ~ '^[a-f0-9]{64}$'",
          tidb: "`idempotency_digest` REGEXP '^[a-f0-9]{64}$'",
        },
        name: "knowledge_space_profile_migration_runs_idempotency_digest_ck",
      },
      nonzeroUuidCheck(
        "knowledge_space_profile_migration_runs_lease_token_ck",
        "lease_token",
        true,
      ),
    ],
    foreignKeys: [
      {
        columns: ["tenant_id", "knowledge_space_id"],
        onDelete: "CASCADE",
        referencedColumns: ["tenant_id", "id"],
        referencedTable: "knowledge_spaces",
      },
      {
        columns: [
          "tenant_id",
          "knowledge_space_id",
          "candidate_profile_kind",
          "candidate_profile_revision_id",
          "candidate_profile_revision",
          "candidate_profile_snapshot_digest",
        ],
        onDelete: "RESTRICT",
        referencedColumns: [
          "tenant_id",
          "knowledge_space_id",
          "kind",
          "id",
          "revision",
          "snapshot_digest",
        ],
        referencedTable: "knowledge_space_profile_revisions",
      },
      {
        columns: [
          "tenant_id",
          "knowledge_space_id",
          "base_embedding_profile_kind",
          "base_embedding_profile_revision_id",
          "base_embedding_profile_revision",
          "base_embedding_profile_snapshot_digest",
        ],
        onDelete: "RESTRICT",
        referencedColumns: [
          "tenant_id",
          "knowledge_space_id",
          "kind",
          "id",
          "revision",
          "snapshot_digest",
        ],
        referencedTable: "knowledge_space_profile_revisions",
      },
      {
        columns: [
          "tenant_id",
          "knowledge_space_id",
          "base_retrieval_profile_kind",
          "base_retrieval_profile_revision_id",
          "base_retrieval_profile_revision",
          "base_retrieval_profile_snapshot_digest",
        ],
        onDelete: "RESTRICT",
        referencedColumns: [
          "tenant_id",
          "knowledge_space_id",
          "kind",
          "id",
          "revision",
          "snapshot_digest",
        ],
        referencedTable: "knowledge_space_profile_revisions",
      },
      {
        columns: [
          "tenant_id",
          "knowledge_space_id",
          "base_publication_id",
          "base_publication_fingerprint",
        ],
        onDelete: "RESTRICT",
        referencedColumns: ["tenant_id", "knowledge_space_id", "id", "fingerprint"],
        referencedTable: "projection_set_publications",
      },
      {
        columns: [
          "tenant_id",
          "knowledge_space_id",
          "candidate_publication_id",
          "candidate_publication_fingerprint",
        ],
        onDelete: "RESTRICT",
        referencedColumns: ["tenant_id", "knowledge_space_id", "id", "fingerprint"],
        referencedTable: "projection_set_publications",
      },
      {
        columns: [
          "tenant_id",
          "knowledge_space_id",
          "permission_snapshot_id",
          "requested_by_subject_id",
          "access_channel",
        ],
        onDelete: "RESTRICT",
        referencedColumns: [
          "tenant_id",
          "knowledge_space_id",
          "id",
          "subject_id",
          "access_channel",
        ],
        referencedTable: "knowledge_space_permission_snapshots",
      },
    ],
    columns: [
      idColumn(),
      varcharColumn("tenant_id", 255),
      idColumn("knowledge_space_id"),
      varcharColumn("changed_kind", 16),
      varcharColumn("rebuild_scope", 48),
      varcharColumn("candidate_profile_kind", 16),
      idColumn("candidate_profile_revision_id"),
      integerColumn("candidate_profile_revision"),
      {
        name: "candidate_profile_snapshot_digest",
        type: { postgres: "CHAR(64)", tidb: "CHAR(64)" },
      },
      varcharColumn("base_embedding_profile_kind", 16, true),
      idColumn("base_embedding_profile_revision_id", true),
      integerColumn("base_embedding_profile_revision", true),
      {
        name: "base_embedding_profile_snapshot_digest",
        nullable: true,
        type: { postgres: "CHAR(64)", tidb: "CHAR(64)" },
      },
      varcharColumn("base_retrieval_profile_kind", 16),
      idColumn("base_retrieval_profile_revision_id"),
      integerColumn("base_retrieval_profile_revision"),
      {
        name: "base_retrieval_profile_snapshot_digest",
        type: { postgres: "CHAR(64)", tidb: "CHAR(64)" },
      },
      idColumn("base_publication_id"),
      varcharColumn("base_publication_fingerprint", 86),
      integerColumn("base_publication_head_revision"),
      idColumn("candidate_publication_id", true),
      varcharColumn("candidate_publication_fingerprint", 86, true),
      idColumn("permission_snapshot_id"),
      integerColumn("permission_snapshot_revision"),
      varcharColumn("requested_by_subject_id", 255),
      varcharColumn("access_channel", 16),
      varcharColumn("idempotency_key", 255),
      { name: "idempotency_digest", type: { postgres: "CHAR(64)", tidb: "CHAR(64)" } },
      varcharColumn("run_state", 16),
      integerColumn("active_slot", true),
      varcharColumn("checkpoint", 32),
      { ...jsonColumn("evaluation_summary"), nullable: true },
      integerColumn("execution_attempts"),
      integerColumn("max_execution_attempts"),
      varcharColumn("worker_id", 255, true),
      idColumn("lease_token", true),
      timestampColumn("lease_expires_at", true),
      timestampColumn("heartbeat_at", true),
      integerColumn("row_version"),
      varcharColumn("last_error_code", 64, true),
      textColumn("last_error_message", true),
      timestampColumn("created_at"),
      timestampColumn("updated_at"),
      timestampColumn("completed_at", true),
      timestampColumn("canceled_at", true),
    ],
  },
  {
    name: "knowledge_space_profile_migration_outbox",
    checkConstraints: [
      {
        expression: {
          postgres: "\"status\" IN ('pending', 'leased', 'completed', 'canceled')",
          tidb: "`status` IN ('pending', 'leased', 'completed', 'canceled')",
        },
        name: "knowledge_space_profile_migration_outbox_state_ck",
      },
      {
        expression: {
          postgres: '"delivery_revision" >= 1',
          tidb: "`delivery_revision` >= 1",
        },
        name: "knowledge_space_profile_migration_outbox_positive_ck",
      },
      {
        expression: {
          postgres:
            '(("status" = \'leased\' AND "locked_by" IS NOT NULL AND "lock_token" IS NOT NULL AND "locked_until" IS NOT NULL) OR ("status" <> \'leased\' AND "locked_by" IS NULL AND "lock_token" IS NULL AND "locked_until" IS NULL))',
          tidb: "((`status` = 'leased' AND `locked_by` IS NOT NULL AND `lock_token` IS NOT NULL AND `locked_until` IS NOT NULL) OR (`status` <> 'leased' AND `locked_by` IS NULL AND `lock_token` IS NULL AND `locked_until` IS NULL))",
        },
        name: "knowledge_space_profile_migration_outbox_lock_ck",
      },
      nonzeroUuidCheck(
        "knowledge_space_profile_migration_outbox_lock_token_ck",
        "lock_token",
        true,
      ),
    ],
    foreignKeys: [
      {
        columns: ["run_id"],
        onDelete: "CASCADE",
        referencedColumns: ["id"],
        referencedTable: "knowledge_space_profile_migration_runs",
      },
    ],
    columns: [
      idColumn(),
      idColumn("run_id"),
      integerColumn("delivery_revision"),
      varcharColumn("status", 16),
      timestampColumn("available_at"),
      varcharColumn("locked_by", 255, true),
      idColumn("lock_token", true),
      timestampColumn("locked_until", true),
      textColumn("last_error", true),
      timestampColumn("created_at"),
      timestampColumn("updated_at"),
      timestampColumn("delivered_at", true),
    ],
  },
  {
    name: "knowledge_space_profile_backfills",
    checkConstraints: [
      {
        expression: {
          postgres: `"kind" IN ('embedding', 'retrieval')`,
          tidb: "`kind` IN ('embedding', 'retrieval')",
        },
        name: "knowledge_space_profile_backfills_kind_ck",
      },
      {
        expression: {
          postgres: `"run_state" IN ('queued', 'running', 'succeeded', 'failed')`,
          tidb: "`run_state` IN ('queued', 'running', 'succeeded', 'failed')",
        },
        name: "knowledge_space_profile_backfills_state_ck",
      },
      {
        expression: {
          postgres:
            '"source_manifest_version" >= 1 AND "execution_attempts" >= 0 AND "max_execution_attempts" >= 1 AND "execution_attempts" <= "max_execution_attempts" AND "row_version" >= 1',
          tidb: "`source_manifest_version` >= 1 AND `execution_attempts` >= 0 AND `max_execution_attempts` >= 1 AND `execution_attempts` <= `max_execution_attempts` AND `row_version` >= 1",
        },
        name: "knowledge_space_profile_backfills_positive_ck",
      },
      {
        expression: {
          postgres:
            '(("run_state" = \'running\' AND "worker_id" IS NOT NULL AND "lease_token" IS NOT NULL AND "lease_expires_at" IS NOT NULL AND "heartbeat_at" IS NOT NULL) OR ("run_state" <> \'running\' AND "worker_id" IS NULL AND "lease_token" IS NULL AND "lease_expires_at" IS NULL AND "heartbeat_at" IS NULL))',
          tidb: "((`run_state` = 'running' AND `worker_id` IS NOT NULL AND `lease_token` IS NOT NULL AND `lease_expires_at` IS NOT NULL AND `heartbeat_at` IS NOT NULL) OR (`run_state` <> 'running' AND `worker_id` IS NULL AND `lease_token` IS NULL AND `lease_expires_at` IS NULL AND `heartbeat_at` IS NULL))",
        },
        name: "knowledge_space_profile_backfills_lease_ck",
      },
      {
        expression: {
          postgres:
            '(("run_state" IN (\'queued\', \'running\') AND "completed_at" IS NULL AND "last_error_code" IS NULL AND "last_error_message" IS NULL) OR ("run_state" = \'succeeded\' AND "completed_at" IS NOT NULL AND "last_error_code" IS NULL AND "last_error_message" IS NULL) OR ("run_state" = \'failed\' AND "completed_at" IS NOT NULL AND "last_error_code" IS NOT NULL AND "last_error_message" IS NOT NULL))',
          tidb: "((`run_state` IN ('queued', 'running') AND `completed_at` IS NULL AND `last_error_code` IS NULL AND `last_error_message` IS NULL) OR (`run_state` = 'succeeded' AND `completed_at` IS NOT NULL AND `last_error_code` IS NULL AND `last_error_message` IS NULL) OR (`run_state` = 'failed' AND `completed_at` IS NOT NULL AND `last_error_code` IS NOT NULL AND `last_error_message` IS NOT NULL))",
        },
        name: "knowledge_space_profile_backfills_lifecycle_ck",
      },
      nonzeroUuidCheck("knowledge_space_profile_backfills_lease_token_ck", "lease_token", true),
    ],
    foreignKeys: [
      {
        columns: ["tenant_id", "knowledge_space_id"],
        onDelete: "CASCADE",
        referencedColumns: ["tenant_id", "id"],
        referencedTable: "knowledge_spaces",
      },
    ],
    columns: [
      idColumn(),
      varcharColumn("tenant_id", 255),
      idColumn("knowledge_space_id"),
      varcharColumn("kind", 16),
      integerColumn("source_manifest_version"),
      jsonColumn("source_snapshot"),
      { name: "source_snapshot_digest", type: { postgres: "CHAR(64)", tidb: "CHAR(64)" } },
      varcharColumn("run_state", 16),
      integerColumn("execution_attempts"),
      integerColumn("max_execution_attempts"),
      varcharColumn("worker_id", 255, true),
      idColumn("lease_token", true),
      timestampColumn("lease_expires_at", true),
      timestampColumn("heartbeat_at", true),
      integerColumn("row_version"),
      varcharColumn("last_error_code", 64, true),
      textColumn("last_error_message", true),
      timestampColumn("created_at"),
      timestampColumn("updated_at"),
      timestampColumn("completed_at", true),
    ],
  },
  {
    name: "source_connections",
    checkConstraints: [
      {
        expression: {
          postgres: "\"auth_kind\" IN ('api-key', 'endpoint', 'oauth2')",
          tidb: "`auth_kind` IN ('api-key', 'endpoint', 'oauth2')",
        },
        name: "source_connections_auth_kind_ck",
      },
      {
        expression: {
          postgres: "\"status\" IN ('provisioning', 'active', 'expired', 'error', 'revoked')",
          tidb: "`status` IN ('provisioning', 'active', 'expired', 'error', 'revoked')",
        },
        name: "source_connections_status_ck",
      },
      {
        expression: { postgres: '"version" >= 1', tidb: "`version` >= 1" },
        name: "source_connections_version_ck",
      },
      {
        expression: {
          postgres:
            '("status" = \'revoked\' AND "credential_ref" IS NULL) OR "status" <> \'revoked\'',
          tidb: "(`status` = 'revoked' AND `credential_ref` IS NULL) OR `status` <> 'revoked'",
        },
        name: "source_connections_secret_ck",
      },
    ],
    foreignKeys: [
      {
        columns: ["tenant_id", "knowledge_space_id"],
        onDelete: "CASCADE",
        referencedColumns: ["tenant_id", "id"],
        referencedTable: "knowledge_spaces",
      },
    ],
    columns: [
      idColumn(),
      varcharColumn("tenant_id", 255),
      idColumn("knowledge_space_id"),
      varcharColumn("provider_id", 128),
      varcharColumn("name", 160),
      varcharColumn("auth_kind", 16),
      varcharColumn("status", 16),
      jsonColumn("configuration"),
      varcharColumn("credential_ref", 255, true),
      jsonColumn("scopes"),
      timestampColumn("expires_at", true),
      varcharColumn("last_error_code", 64, true),
      integerColumn("version"),
      timestampColumn("created_at"),
      timestampColumn("updated_at"),
    ],
  },
  {
    name: "source_oauth_transactions",
    checkConstraints: [
      {
        expression: {
          postgres: "\"state_hash\" ~ '^[a-f0-9]{64}$'",
          tidb: "`state_hash` REGEXP '^[a-f0-9]{64}$'",
        },
        name: "source_oauth_transactions_state_hash_ck",
      },
      {
        expression: {
          postgres: "\"status\" IN ('pending', 'exchanging', 'completed', 'failed')",
          tidb: "`status` IN ('pending', 'exchanging', 'completed', 'failed')",
        },
        name: "source_oauth_transactions_status_ck",
      },
      {
        expression: {
          postgres: "\"access_channel\" IN ('interactive', 'service_api', 'mcp', 'agent')",
          tidb: "`access_channel` IN ('interactive', 'service_api', 'mcp', 'agent')",
        },
        name: "source_oauth_transactions_channel_ck",
      },
      {
        expression: {
          postgres: '"permission_snapshot_revision" >= 1',
          tidb: "`permission_snapshot_revision` >= 1",
        },
        name: "source_oauth_transactions_permission_ck",
      },
      {
        expression: {
          postgres:
            '("status" = \'pending\' AND "consumed_at" IS NULL AND "completed_at" IS NULL) OR ("status" IN (\'exchanging\', \'failed\') AND "consumed_at" IS NOT NULL) OR ("status" = \'completed\' AND "consumed_at" IS NOT NULL AND "completed_at" IS NOT NULL)',
          tidb: "(`status` = 'pending' AND `consumed_at` IS NULL AND `completed_at` IS NULL) OR (`status` IN ('exchanging', 'failed') AND `consumed_at` IS NOT NULL) OR (`status` = 'completed' AND `consumed_at` IS NOT NULL AND `completed_at` IS NOT NULL)",
        },
        name: "source_oauth_transactions_lifecycle_ck",
      },
    ],
    foreignKeys: [
      {
        columns: ["tenant_id", "knowledge_space_id", "connection_id"],
        onDelete: "CASCADE",
        referencedColumns: ["tenant_id", "knowledge_space_id", "id"],
        referencedTable: "source_connections",
      },
      {
        columns: [
          "tenant_id",
          "knowledge_space_id",
          "permission_snapshot_id",
          "requested_by_subject_id",
          "access_channel",
        ],
        referencedColumns: [
          "tenant_id",
          "knowledge_space_id",
          "id",
          "subject_id",
          "access_channel",
        ],
        referencedTable: "knowledge_space_permission_snapshots",
      },
      {
        columns: ["tenant_id", "knowledge_space_id", "api_key_id"],
        referencedColumns: ["tenant_id", "knowledge_space_id", "id"],
        referencedTable: "knowledge_space_api_keys",
      },
    ],
    columns: [
      idColumn(),
      varcharColumn("tenant_id", 255),
      idColumn("knowledge_space_id"),
      idColumn("connection_id"),
      varcharColumn("requested_by_subject_id", 255),
      varcharColumn("access_channel", 16),
      idColumn("permission_snapshot_id"),
      integerColumn("permission_snapshot_revision"),
      idColumn("api_key_id", true),
      { name: "state_hash", type: { postgres: "CHAR(64)", tidb: "CHAR(64)" } },
      varcharColumn("verifier_ref", 255),
      varcharColumn("redirect_uri", 2048),
      varcharColumn("status", 16),
      timestampColumn("created_at"),
      timestampColumn("expires_at"),
      timestampColumn("consumed_at", true),
      timestampColumn("completed_at", true),
    ],
  },
  {
    name: "source_connection_secret_refs",
    checkConstraints: [
      {
        expression: {
          postgres: "\"purpose\" IN ('connection-credential', 'oauth-pkce')",
          tidb: "`purpose` IN ('connection-credential', 'oauth-pkce')",
        },
        name: "source_connection_secret_refs_purpose_ck",
      },
      {
        expression: {
          postgres: "\"state\" IN ('staged', 'active', 'retired', 'deleting', 'deleted')",
          tidb: "`state` IN ('staged', 'active', 'retired', 'deleting', 'deleted')",
        },
        name: "source_connection_secret_refs_state_ck",
      },
      {
        expression: { postgres: '"row_version" >= 1', tidb: "`row_version` >= 1" },
        name: "source_connection_secret_refs_version_ck",
      },
      {
        expression: {
          postgres:
            '("state" = \'deleting\' AND "worker_id" IS NOT NULL AND "lease_token" IS NOT NULL AND "lease_expires_at" IS NOT NULL) OR ("state" <> \'deleting\' AND "worker_id" IS NULL AND "lease_token" IS NULL AND "lease_expires_at" IS NULL)',
          tidb: "(`state` = 'deleting' AND `worker_id` IS NOT NULL AND `lease_token` IS NOT NULL AND `lease_expires_at` IS NOT NULL) OR (`state` <> 'deleting' AND `worker_id` IS NULL AND `lease_token` IS NULL AND `lease_expires_at` IS NULL)",
        },
        name: "source_connection_secret_refs_lease_ck",
      },
      {
        expression: {
          postgres:
            '("state" = \'deleted\' AND "deleted_at" IS NOT NULL) OR ("state" <> \'deleted\' AND "deleted_at" IS NULL)',
          tidb: "(`state` = 'deleted' AND `deleted_at` IS NOT NULL) OR (`state` <> 'deleted' AND `deleted_at` IS NULL)",
        },
        name: "source_connection_secret_refs_terminal_ck",
      },
    ],
    columns: [
      idColumn(),
      varcharColumn("tenant_id", 255),
      idColumn("knowledge_space_id"),
      idColumn("connection_id"),
      varcharColumn("provider_id", 128),
      varcharColumn("credential_ref", 255),
      varcharColumn("purpose", 32),
      varcharColumn("state", 16),
      boolColumn("remote_revoke_required"),
      timestampColumn("recover_after"),
      timestampColumn("next_attempt_at", true),
      varcharColumn("worker_id", 255, true),
      idColumn("lease_token", true),
      timestampColumn("lease_expires_at", true),
      integerColumn("row_version"),
      varcharColumn("last_error_code", 64, true),
      timestampColumn("created_at"),
      timestampColumn("updated_at"),
      timestampColumn("deleted_at", true),
    ],
  },
  {
    name: "sources",
    checkConstraints: [
      {
        expression: {
          postgres:
            '(("status" = \'deleting\' AND "deletion_job_id" IS NOT NULL AND "deleting_at" IS NOT NULL) OR ("status" <> \'deleting\' AND "deletion_job_id" IS NULL AND "deleting_at" IS NULL))',
          tidb: "((`status` = 'deleting' AND `deletion_job_id` IS NOT NULL AND `deleting_at` IS NOT NULL) OR (`status` <> 'deleting' AND `deletion_job_id` IS NULL AND `deleting_at` IS NULL))",
        },
        name: "sources_deletion_lifecycle_ck",
      },
    ],
    foreignKeys: [
      {
        columns: ["knowledge_space_id"],
        onDelete: "CASCADE",
        referencedColumns: ["id"],
        referencedTable: "knowledge_spaces",
      },
      {
        columns: ["knowledge_space_id", "connection_id"],
        onDelete: "RESTRICT",
        referencedColumns: ["knowledge_space_id", "id"],
        referencedTable: "source_connections",
      },
    ],
    columns: [
      idColumn(),
      idColumn("knowledge_space_id"),
      idColumn("connection_id", true),
      {
        name: "credential_ref",
        nullable: true,
        type: { postgres: "TEXT", tidb: "VARCHAR(255)" },
      },
      textColumn("type"),
      varcharColumn("status", 16),
      textColumn("name"),
      textColumn("uri"),
      jsonColumn("metadata"),
      jsonColumn("permission_scope"),
      integerColumn("version"),
      idColumn("deletion_job_id", true),
      timestampColumn("deleting_at", true),
      timestampColumn("created_at"),
      timestampColumn("updated_at"),
    ],
  },
  {
    name: "source_sync_policies",
    checkConstraints: [
      {
        expression: {
          postgres: "\"mode\" IN ('provider', 'manual', 'interval', 'custom')",
          tidb: "`mode` IN ('provider', 'manual', 'interval', 'custom')",
        },
        name: "source_sync_policies_mode_ck",
      },
      {
        expression: {
          postgres: "\"access_channel\" IN ('interactive', 'service_api', 'mcp', 'agent')",
          tidb: "`access_channel` IN ('interactive', 'service_api', 'mcp', 'agent')",
        },
        name: "source_sync_policies_channel_ck",
      },
      {
        expression: {
          postgres:
            '("mode" = \'custom\' AND "custom_interval_seconds" BETWEEN 3600 AND 2592000) OR ("mode" <> \'custom\' AND "custom_interval_seconds" IS NULL)',
          tidb: "(`mode` = 'custom' AND `custom_interval_seconds` BETWEEN 3600 AND 2592000) OR (`mode` <> 'custom' AND `custom_interval_seconds` IS NULL)",
        },
        name: "source_sync_policies_interval_ck",
      },
      {
        expression: {
          postgres:
            '"revision" >= 1 AND "expected_source_version" >= 1 AND "permission_snapshot_revision" >= 1',
          tidb: "`revision` >= 1 AND `expected_source_version` >= 1 AND `permission_snapshot_revision` >= 1",
        },
        name: "source_sync_policies_revision_ck",
      },
    ],
    foreignKeys: [
      {
        columns: ["tenant_id", "knowledge_space_id"],
        onDelete: "CASCADE",
        referencedColumns: ["tenant_id", "id"],
        referencedTable: "knowledge_spaces",
      },
      {
        columns: ["knowledge_space_id", "source_id"],
        onDelete: "CASCADE",
        referencedColumns: ["knowledge_space_id", "id"],
        referencedTable: "sources",
      },
      {
        columns: [
          "tenant_id",
          "knowledge_space_id",
          "permission_snapshot_id",
          "requested_by_subject_id",
          "access_channel",
        ],
        referencedColumns: [
          "tenant_id",
          "knowledge_space_id",
          "id",
          "subject_id",
          "access_channel",
        ],
        referencedTable: "knowledge_space_permission_snapshots",
      },
    ],
    columns: [
      idColumn(),
      varcharColumn("tenant_id", 255),
      idColumn("knowledge_space_id"),
      idColumn("source_id"),
      varcharColumn("requested_by_subject_id", 255),
      varcharColumn("access_channel", 16),
      idColumn("permission_snapshot_id"),
      integerColumn("permission_snapshot_revision"),
      jsonColumn("required_permission_scope"),
      varcharColumn("mode", 16),
      boolColumn("enabled"),
      integerColumn("custom_interval_seconds", true),
      timestampColumn("next_run_at", true),
      integerColumn("expected_source_version"),
      integerColumn("revision"),
      timestampColumn("created_at"),
      timestampColumn("updated_at"),
    ],
  },
  {
    name: "source_workflow_runs",
    checkConstraints: [
      {
        expression: {
          postgres:
            "\"kind\" IN ('crawl-preview', 'crawl-import', 'online-document-import', 'online-drive-import', 'sync', 'bulk')",
          tidb: "`kind` IN ('crawl-preview', 'crawl-import', 'online-document-import', 'online-drive-import', 'sync', 'bulk')",
        },
        name: "source_workflow_runs_kind_ck",
      },
      {
        expression: {
          postgres:
            "\"run_state\" IN ('queued', 'running', 'crawling', 'preview_ready', 'importing', 'syncing', 'completed', 'zero_results', 'failed', 'canceled')",
          tidb: "`run_state` IN ('queued', 'running', 'crawling', 'preview_ready', 'importing', 'syncing', 'completed', 'zero_results', 'failed', 'canceled')",
        },
        name: "source_workflow_runs_state_ck",
      },
      {
        expression: {
          postgres:
            "\"checkpoint\" IN ('queued', 'provider-read', 'preview-staged', 'selection-frozen', 'materialized', 'cleanup-staging', 'source-committed')",
          tidb: "`checkpoint` IN ('queued', 'provider-read', 'preview-staged', 'selection-frozen', 'materialized', 'cleanup-staging', 'source-committed')",
        },
        name: "source_workflow_runs_checkpoint_ck",
      },
      {
        expression: {
          postgres: "\"idempotency_digest\" ~ '^[a-f0-9]{64}$'",
          tidb: "`idempotency_digest` REGEXP '^[a-f0-9]{64}$'",
        },
        name: "source_workflow_runs_idempotency_digest_ck",
      },
      {
        expression: {
          postgres:
            '"progress_total" IS NULL OR ("progress_total" >= 0 AND "progress_completed" + "progress_skipped" + "progress_failed" <= "progress_total")',
          tidb: "(`progress_total` IS NULL OR `progress_total` >= 0) AND (`progress_total` IS NULL OR `progress_completed` + `progress_skipped` + `progress_failed` <= `progress_total`)",
        },
        name: "source_workflow_runs_counts_ck",
      },
      {
        expression: {
          postgres:
            '"progress_completed" >= 0 AND "progress_skipped" >= 0 AND "progress_failed" >= 0 AND "execution_attempts" >= 0 AND "max_execution_attempts" >= 1 AND "execution_attempts" <= "max_execution_attempts" AND "permission_snapshot_revision" >= 1 AND "row_version" >= 1 AND ("active_slot" IS NULL OR "active_slot" = 1)',
          tidb: "`progress_completed` >= 0 AND `progress_skipped` >= 0 AND `progress_failed` >= 0 AND `execution_attempts` >= 0 AND `max_execution_attempts` >= 1 AND `execution_attempts` <= `max_execution_attempts` AND `permission_snapshot_revision` >= 1 AND `row_version` >= 1 AND (`active_slot` IS NULL OR `active_slot` = 1)",
        },
        name: "source_workflow_runs_nonnegative_ck",
      },
      {
        expression: {
          postgres:
            "(\"run_state\" IN ('running', 'crawling', 'importing', 'syncing') AND \"worker_id\" IS NOT NULL AND \"lease_token\" IS NOT NULL AND \"lease_expires_at\" IS NOT NULL) OR (\"run_state\" NOT IN ('running', 'crawling', 'importing', 'syncing') AND \"worker_id\" IS NULL AND \"lease_token\" IS NULL AND \"lease_expires_at\" IS NULL)",
          tidb: "(`run_state` IN ('running', 'crawling', 'importing', 'syncing') AND `worker_id` IS NOT NULL AND `lease_token` IS NOT NULL AND `lease_expires_at` IS NOT NULL) OR (`run_state` NOT IN ('running', 'crawling', 'importing', 'syncing') AND `worker_id` IS NULL AND `lease_token` IS NULL AND `lease_expires_at` IS NULL)",
        },
        name: "source_workflow_runs_lease_ck",
      },
      {
        expression: {
          postgres:
            '("run_state" IN (\'queued\', \'running\', \'crawling\', \'preview_ready\', \'importing\', \'syncing\') AND "active_slot" = 1 AND "completed_at" IS NULL) OR ("run_state" IN (\'completed\', \'zero_results\', \'failed\') AND "active_slot" IS NULL AND "completed_at" IS NOT NULL AND "canceled_at" IS NULL) OR ("run_state" = \'canceled\' AND "active_slot" IS NULL AND "completed_at" IS NOT NULL AND "canceled_at" IS NOT NULL)',
          tidb: "(`run_state` IN ('queued', 'running', 'crawling', 'preview_ready', 'importing', 'syncing') AND `active_slot` = 1 AND `completed_at` IS NULL) OR (`run_state` IN ('completed', 'zero_results', 'failed') AND `active_slot` IS NULL AND `completed_at` IS NOT NULL AND `canceled_at` IS NULL) OR (`run_state` = 'canceled' AND `active_slot` IS NULL AND `completed_at` IS NOT NULL AND `canceled_at` IS NOT NULL)",
        },
        name: "source_workflow_runs_terminal_ck",
      },
    ],
    foreignKeys: [
      {
        columns: ["tenant_id", "knowledge_space_id"],
        onDelete: "CASCADE",
        referencedColumns: ["tenant_id", "id"],
        referencedTable: "knowledge_spaces",
      },
      {
        columns: ["knowledge_space_id", "source_id"],
        onDelete: "RESTRICT",
        referencedColumns: ["knowledge_space_id", "id"],
        referencedTable: "sources",
      },
      {
        columns: [
          "tenant_id",
          "knowledge_space_id",
          "permission_snapshot_id",
          "requested_by_subject_id",
          "access_channel",
        ],
        onDelete: "RESTRICT",
        referencedColumns: [
          "tenant_id",
          "knowledge_space_id",
          "id",
          "subject_id",
          "access_channel",
        ],
        referencedTable: "knowledge_space_permission_snapshots",
      },
    ],
    columns: [
      idColumn(),
      varcharColumn("tenant_id", 255),
      idColumn("knowledge_space_id"),
      idColumn("source_id", true),
      varcharColumn("source_scope", 128),
      varcharColumn("kind", 32),
      varcharColumn("run_state", 24),
      varcharColumn("checkpoint", 32),
      jsonColumn("payload"),
      varcharColumn("cursor", 4096, true),
      integerColumn("progress_total", true),
      integerColumn("progress_completed"),
      integerColumn("progress_skipped"),
      integerColumn("progress_failed"),
      idColumn("permission_snapshot_id"),
      integerColumn("permission_snapshot_revision"),
      varcharColumn("requested_by_subject_id", 255),
      jsonColumn("required_permission_scope"),
      varcharColumn("access_channel", 16),
      varcharColumn("idempotency_key", 255),
      { name: "idempotency_digest", type: { postgres: "CHAR(64)", tidb: "CHAR(64)" } },
      integerColumn("execution_attempts"),
      integerColumn("max_execution_attempts"),
      varcharColumn("worker_id", 255, true),
      idColumn("lease_token", true),
      timestampColumn("lease_expires_at", true),
      integerColumn("row_version"),
      integerColumn("active_slot", true),
      varcharColumn("last_error_code", 64, true),
      varcharColumn("last_error_message", 1000, true),
      timestampColumn("created_at"),
      timestampColumn("updated_at"),
      timestampColumn("completed_at", true),
      timestampColumn("canceled_at", true),
    ],
  },
  {
    name: "source_workflow_outbox",
    checkConstraints: [
      {
        expression: {
          postgres: "\"status\" IN ('pending', 'leased', 'completed', 'canceled')",
          tidb: "`status` IN ('pending', 'leased', 'completed', 'canceled')",
        },
        name: "source_workflow_outbox_status_ck",
      },
      {
        expression: { postgres: '"delivery_revision" >= 1', tidb: "`delivery_revision` >= 1" },
        name: "source_workflow_outbox_revision_ck",
      },
      {
        expression: {
          postgres:
            '("status" = \'leased\' AND "locked_by" IS NOT NULL AND "lock_token" IS NOT NULL AND "locked_until" IS NOT NULL) OR ("status" <> \'leased\' AND "locked_by" IS NULL AND "lock_token" IS NULL AND "locked_until" IS NULL)',
          tidb: "(`status` = 'leased' AND `locked_by` IS NOT NULL AND `lock_token` IS NOT NULL AND `locked_until` IS NOT NULL) OR (`status` <> 'leased' AND `locked_by` IS NULL AND `lock_token` IS NULL AND `locked_until` IS NULL)",
        },
        name: "source_workflow_outbox_lease_ck",
      },
    ],
    foreignKeys: [
      {
        columns: ["run_id"],
        onDelete: "CASCADE",
        referencedColumns: ["id"],
        referencedTable: "source_workflow_runs",
      },
    ],
    columns: [
      idColumn(),
      idColumn("run_id"),
      integerColumn("delivery_revision"),
      varcharColumn("status", 16),
      timestampColumn("available_at"),
      varcharColumn("locked_by", 255, true),
      idColumn("lock_token", true),
      timestampColumn("locked_until", true),
      varcharColumn("last_error", 1000, true),
      timestampColumn("created_at"),
      timestampColumn("updated_at"),
      timestampColumn("delivered_at", true),
    ],
  },
  {
    name: "source_crawl_preview_pages",
    checkConstraints: [
      {
        expression: {
          postgres:
            "\"id\" ~ '^[a-f0-9]{64}$' AND \"page_id\" ~ '^[a-f0-9]{64}$' AND \"content_hash\" ~ '^[a-f0-9]{64}$'",
          tidb: "`id` REGEXP '^[a-f0-9]{64}$' AND `page_id` REGEXP '^[a-f0-9]{64}$' AND `content_hash` REGEXP '^[a-f0-9]{64}$'",
        },
        name: "source_crawl_preview_pages_hash_ck",
      },
    ],
    foreignKeys: [
      {
        columns: ["run_id"],
        onDelete: "CASCADE",
        referencedColumns: ["id"],
        referencedTable: "source_workflow_runs",
      },
    ],
    primaryKey: ["run_id", "id"],
    columns: [
      { name: "id", type: { postgres: "CHAR(64)", tidb: "CHAR(64)" } },
      idColumn("run_id"),
      { name: "page_id", type: { postgres: "CHAR(64)", tidb: "CHAR(64)" } },
      varcharColumn("source_url", 4096),
      varcharColumn("title", 500, true),
      varcharColumn("description", 2000, true),
      varcharColumn("etag", 1024, true),
      { name: "content_hash", type: { postgres: "CHAR(64)", tidb: "CHAR(64)" } },
      varcharColumn("content_object_key", 2048),
      timestampColumn("created_at"),
    ],
  },
  {
    name: "source_bulk_workflow_items",
    checkConstraints: [
      {
        expression: {
          postgres: "\"action\" IN ('sync', 'disable', 'remove')",
          tidb: "`action` IN ('sync', 'disable', 'remove')",
        },
        name: "source_bulk_workflow_items_action_ck",
      },
      {
        expression: {
          postgres: "\"status\" IN ('eligible', 'running', 'skipped', 'failed', 'completed')",
          tidb: "`status` IN ('eligible', 'running', 'skipped', 'failed', 'completed')",
        },
        name: "source_bulk_workflow_items_status_ck",
      },
      {
        expression: {
          postgres:
            '("child_run_id" IS NULL AND "deletion_job_id" IS NULL AND "status" IN (\'eligible\', \'skipped\', \'failed\')) OR ("child_run_id" IS NULL AND "deletion_job_id" IS NULL AND "action" = \'disable\' AND "status" = \'completed\') OR ("child_run_id" IS NOT NULL AND "deletion_job_id" IS NULL AND "action" = \'sync\' AND "status" IN (\'running\', \'failed\', \'completed\')) OR ("child_run_id" IS NULL AND "deletion_job_id" IS NOT NULL AND "action" = \'remove\' AND "status" IN (\'running\', \'failed\', \'completed\'))',
          tidb: "(`child_run_id` IS NULL AND `deletion_job_id` IS NULL AND `status` IN ('eligible', 'skipped', 'failed')) OR (`child_run_id` IS NULL AND `deletion_job_id` IS NULL AND `action` = 'disable' AND `status` = 'completed') OR (`child_run_id` IS NOT NULL AND `deletion_job_id` IS NULL AND `action` = 'sync' AND `status` IN ('running', 'failed', 'completed')) OR (`child_run_id` IS NULL AND `deletion_job_id` IS NOT NULL AND `action` = 'remove' AND `status` IN ('running', 'failed', 'completed'))",
        },
        name: "source_bulk_workflow_items_child_ck",
      },
    ],
    foreignKeys: [
      {
        columns: ["tenant_id", "knowledge_space_id", "run_id"],
        onDelete: "CASCADE",
        referencedColumns: ["tenant_id", "knowledge_space_id", "id"],
        referencedTable: "source_workflow_runs",
      },
      {
        columns: ["tenant_id", "knowledge_space_id", "child_run_id"],
        onDelete: "RESTRICT",
        referencedColumns: ["tenant_id", "knowledge_space_id", "id"],
        referencedTable: "source_workflow_runs",
      },
      {
        columns: ["tenant_id", "knowledge_space_id", "deletion_job_id"],
        onDelete: "RESTRICT",
        referencedColumns: ["tenant_id", "knowledge_space_id", "id"],
        referencedTable: "deletion_jobs",
      },
    ],
    columns: [
      idColumn(),
      varcharColumn("tenant_id", 255),
      idColumn("knowledge_space_id"),
      idColumn("run_id"),
      idColumn("source_id"),
      idColumn("child_run_id", true),
      idColumn("deletion_job_id", true),
      varcharColumn("action", 16),
      varcharColumn("status", 16),
      varcharColumn("reason", 1000, true),
      varcharColumn("error_code", 64, true),
      timestampColumn("updated_at"),
    ],
  },
  {
    name: "source_credential_backfills",
    checkConstraints: [
      {
        expression: { postgres: '"source_version" >= 1', tidb: "`source_version` >= 1" },
        name: "source_credential_backfills_source_version_ck",
      },
      {
        expression: {
          postgres: '"retry_count" >= 0 AND "row_version" >= 0',
          tidb: "`retry_count` >= 0 AND `row_version` >= 0",
        },
        name: "source_credential_backfills_counts_ck",
      },
      {
        expression: {
          postgres: "\"run_state\" IN ('queued', 'running', 'succeeded', 'failed')",
          tidb: "`run_state` IN ('queued', 'running', 'succeeded', 'failed')",
        },
        name: "source_credential_backfills_state_ck",
      },
      {
        expression: {
          postgres:
            '(("run_state" = \'running\' AND "worker_id" IS NOT NULL AND "lease_token" IS NOT NULL AND "lease_expires_at" IS NOT NULL AND "heartbeat_at" IS NOT NULL AND "completed_at" IS NULL) OR ("run_state" <> \'running\' AND "worker_id" IS NULL AND "lease_token" IS NULL AND "lease_expires_at" IS NULL AND "heartbeat_at" IS NULL))',
          tidb: "((`run_state` = 'running' AND `worker_id` IS NOT NULL AND `lease_token` IS NOT NULL AND `lease_expires_at` IS NOT NULL AND `heartbeat_at` IS NOT NULL AND `completed_at` IS NULL) OR (`run_state` <> 'running' AND `worker_id` IS NULL AND `lease_token` IS NULL AND `lease_expires_at` IS NULL AND `heartbeat_at` IS NULL))",
        },
        name: "source_credential_backfills_lease_ck",
      },
      {
        expression: {
          postgres:
            "((\"run_state\" IN ('succeeded', 'failed') AND \"completed_at\" IS NOT NULL) OR (\"run_state\" IN ('queued', 'running') AND \"completed_at\" IS NULL))",
          tidb: "((`run_state` IN ('succeeded', 'failed') AND `completed_at` IS NOT NULL) OR (`run_state` IN ('queued', 'running') AND `completed_at` IS NULL))",
        },
        name: "source_credential_backfills_terminal_ck",
      },
    ],
    foreignKeys: [
      {
        columns: ["tenant_id", "knowledge_space_id"],
        onDelete: "CASCADE",
        referencedColumns: ["tenant_id", "id"],
        referencedTable: "knowledge_spaces",
      },
      {
        columns: ["knowledge_space_id", "source_id"],
        onDelete: "CASCADE",
        referencedColumns: ["knowledge_space_id", "id"],
        referencedTable: "sources",
      },
    ],
    columns: [
      idColumn(),
      varcharColumn("tenant_id", 255),
      idColumn("knowledge_space_id"),
      idColumn("source_id"),
      integerColumn("source_version"),
      {
        name: "candidate_credential_ref",
        type: { postgres: "TEXT", tidb: "VARCHAR(255)" },
      },
      { name: "secret_fingerprint", type: { postgres: "CHAR(64)", tidb: "CHAR(64)" } },
      {
        name: "run_state",
        type: { postgres: "TEXT", tidb: "VARCHAR(16)" },
      },
      {
        name: "worker_id",
        nullable: true,
        type: { postgres: "TEXT", tidb: "VARCHAR(255)" },
      },
      idColumn("lease_token", true),
      timestampColumn("lease_expires_at", true),
      timestampColumn("heartbeat_at", true),
      integerColumn("retry_count"),
      integerColumn("row_version"),
      {
        name: "last_error_code",
        nullable: true,
        type: { postgres: "TEXT", tidb: "VARCHAR(64)" },
      },
      textColumn("last_error_message", true),
      timestampColumn("created_at"),
      timestampColumn("updated_at"),
      timestampColumn("completed_at", true),
    ],
  },
  {
    name: "source_secret_lifecycle_refs",
    checkConstraints: [
      {
        expression: {
          postgres: '"source_version" IS NULL OR "source_version" >= 1',
          tidb: "`source_version` IS NULL OR `source_version` >= 1",
        },
        name: "source_secret_lifecycle_refs_source_version_ck",
      },
      {
        expression: {
          postgres: "\"purpose\" IN ('create', 'rotate', 'backfill')",
          tidb: "`purpose` IN ('create', 'rotate', 'backfill')",
        },
        name: "source_secret_lifecycle_refs_purpose_ck",
      },
      {
        expression: {
          postgres: '"delete_attempts" >= 0 AND "row_version" >= 0',
          tidb: "`delete_attempts` >= 0 AND `row_version` >= 0",
        },
        name: "source_secret_lifecycle_refs_counts_ck",
      },
      {
        expression: {
          postgres:
            "\"state\" IN ('staged', 'candidate', 'active', 'retired', 'deleting', 'deleted')",
          tidb: "`state` IN ('staged', 'candidate', 'active', 'retired', 'deleting', 'deleted')",
        },
        name: "source_secret_lifecycle_refs_state_ck",
      },
      {
        expression: {
          postgres:
            '(("state" = \'deleting\' AND "worker_id" IS NOT NULL AND "lease_token" IS NOT NULL AND "lease_expires_at" IS NOT NULL AND "heartbeat_at" IS NOT NULL AND "deleted_at" IS NULL) OR ("state" <> \'deleting\' AND "worker_id" IS NULL AND "lease_token" IS NULL AND "lease_expires_at" IS NULL AND "heartbeat_at" IS NULL))',
          tidb: "((`state` = 'deleting' AND `worker_id` IS NOT NULL AND `lease_token` IS NOT NULL AND `lease_expires_at` IS NOT NULL AND `heartbeat_at` IS NOT NULL AND `deleted_at` IS NULL) OR (`state` <> 'deleting' AND `worker_id` IS NULL AND `lease_token` IS NULL AND `lease_expires_at` IS NULL AND `heartbeat_at` IS NULL))",
        },
        name: "source_secret_lifecycle_refs_lease_ck",
      },
      {
        expression: {
          postgres:
            '(("state" = \'deleted\' AND "deleted_at" IS NOT NULL) OR ("state" <> \'deleted\' AND "deleted_at" IS NULL))',
          tidb: "((`state` = 'deleted' AND `deleted_at` IS NOT NULL) OR (`state` <> 'deleted' AND `deleted_at` IS NULL))",
        },
        name: "source_secret_lifecycle_refs_terminal_ck",
      },
    ],
    columns: [
      idColumn(),
      varcharColumn("tenant_id", 255),
      idColumn("knowledge_space_id"),
      idColumn("source_id"),
      {
        name: "credential_ref",
        type: { postgres: "TEXT", tidb: "VARCHAR(255)" },
      },
      {
        name: "operation_id",
        type: { postgres: "TEXT", tidb: "VARCHAR(255)" },
      },
      { name: "purpose", type: { postgres: "TEXT", tidb: "VARCHAR(16)" } },
      { name: "state", type: { postgres: "TEXT", tidb: "VARCHAR(16)" } },
      integerColumn("source_version", true),
      timestampColumn("recover_after"),
      timestampColumn("next_delete_at", true),
      {
        name: "worker_id",
        nullable: true,
        type: { postgres: "TEXT", tidb: "VARCHAR(255)" },
      },
      idColumn("lease_token", true),
      timestampColumn("lease_expires_at", true),
      timestampColumn("heartbeat_at", true),
      integerColumn("delete_attempts"),
      integerColumn("row_version"),
      {
        name: "last_error_code",
        nullable: true,
        type: { postgres: "TEXT", tidb: "VARCHAR(64)" },
      },
      textColumn("last_error_message", true),
      timestampColumn("created_at"),
      timestampColumn("updated_at"),
      timestampColumn("deleted_at", true),
    ],
  },
  {
    name: "resource_mounts",
    foreignKeys: [
      {
        columns: ["knowledge_space_id"],
        onDelete: "CASCADE",
        referencedColumns: ["id"],
        referencedTable: "knowledge_spaces",
      },
    ],
    columns: [
      idColumn(),
      varcharColumn("tenant_id", 255),
      idColumn("knowledge_space_id"),
      varcharColumn("mount_path", 384),
      varcharColumn("resource_type", 64),
      textColumn("provider"),
      textColumn("mode"),
      jsonColumn("capabilities"),
      textColumn("source_pointer"),
      jsonColumn("permission_scope"),
      integerColumn("permission_snapshot_version"),
      jsonColumn("freshness_policy"),
      jsonColumn("cache_policy"),
      jsonColumn("metadata"),
      timestampColumn("created_at"),
      timestampColumn("last_synced_at", true),
    ],
  },
  {
    name: "document_assets",
    checkConstraints: [
      {
        expression: {
          postgres:
            '"row_version" >= 1 AND (("lifecycle_state" = \'active\' AND "deletion_job_id" IS NULL AND "deleting_at" IS NULL) OR ("lifecycle_state" = \'deleting\' AND "deletion_job_id" IS NOT NULL AND "deleting_at" IS NOT NULL))',
          tidb: "`row_version` >= 1 AND ((`lifecycle_state` = 'active' AND `deletion_job_id` IS NULL AND `deleting_at` IS NULL) OR (`lifecycle_state` = 'deleting' AND `deletion_job_id` IS NOT NULL AND `deleting_at` IS NOT NULL))",
        },
        name: "document_assets_deletion_lifecycle_ck",
      },
    ],
    foreignKeys: [
      {
        columns: ["knowledge_space_id"],
        onDelete: "CASCADE",
        referencedColumns: ["id"],
        referencedTable: "knowledge_spaces",
      },
    ],
    columns: [
      idColumn(),
      idColumn("knowledge_space_id"),
      idColumn("source_id", true),
      textColumn("filename"),
      textColumn("mime_type"),
      textColumn("object_key"),
      textColumn("sha256"),
      integerColumn("size_bytes"),
      integerColumn("version"),
      varcharColumn("parser_status", 16),
      jsonColumn("metadata"),
      varcharColumn("lifecycle_state", 16),
      idColumn("deletion_job_id", true),
      timestampColumn("deleting_at", true),
      integerColumn("row_version"),
      timestampColumn("created_at"),
      timestampColumn("updated_at", true),
    ],
  },
  {
    name: "parse_artifacts",
    foreignKeys: [
      {
        columns: ["document_asset_id"],
        onDelete: "CASCADE",
        referencedColumns: ["id"],
        referencedTable: "document_assets",
      },
    ],
    columns: [
      idColumn(),
      idColumn("document_asset_id"),
      integerColumn("version"),
      textColumn("parser"),
      textColumn("content_type"),
      varcharColumn("artifact_hash", 64),
      jsonColumn("elements"),
      jsonColumn("metadata"),
      timestampColumn("created_at"),
      timestampColumn("updated_at", true),
    ],
  },
  {
    name: "document_multimodal_manifests",
    checkConstraints: [
      publicationGenerationCheck(
        "document_multimodal_pub_gen_nonzero_ck",
        "publication_generation_id",
        true,
      ),
    ],
    foreignKeys: [
      {
        columns: ["knowledge_space_id"],
        onDelete: "CASCADE",
        referencedColumns: ["id"],
        referencedTable: "knowledge_spaces",
      },
      {
        columns: ["document_asset_id"],
        onDelete: "CASCADE",
        referencedColumns: ["id"],
        referencedTable: "document_assets",
      },
      {
        columns: ["parse_artifact_id"],
        onDelete: "CASCADE",
        referencedColumns: ["id"],
        referencedTable: "parse_artifacts",
      },
    ],
    columns: [
      idColumn(),
      idColumn("knowledge_space_id"),
      idColumn("publication_generation_id", true),
      idColumn("document_asset_id"),
      idColumn("parse_artifact_id"),
      integerColumn("version"),
      textColumn("artifact_hash"),
      textColumn("manifest_version"),
      jsonColumn("items"),
      jsonColumn("metadata"),
      timestampColumn("created_at"),
      timestampColumn("updated_at", true),
      tidbGeneratedColumn(
        "publication_generation_key",
        "CHAR(36)",
        `COALESCE(\`publication_generation_id\`, '${PUBLICATION_GENERATION_ID_SENTINEL}')`,
      ),
    ],
  },
  {
    name: "artifact_segments",
    foreignKeys: [
      {
        columns: ["knowledge_space_id"],
        onDelete: "CASCADE",
        referencedColumns: ["id"],
        referencedTable: "knowledge_spaces",
      },
      {
        columns: ["document_asset_id"],
        onDelete: "CASCADE",
        referencedColumns: ["id"],
        referencedTable: "document_assets",
      },
      {
        columns: ["parse_artifact_id"],
        onDelete: "CASCADE",
        referencedColumns: ["id"],
        referencedTable: "parse_artifacts",
      },
    ],
    columns: [
      idColumn(),
      idColumn("knowledge_space_id"),
      idColumn("document_asset_id"),
      idColumn("parse_artifact_id"),
      integerColumn("segment_index"),
      textColumn("segment_type"),
      textColumn("artifact_hash"),
      varcharColumn("checksum", 64),
      textColumn("object_key", true),
      textColumn("inline_text", true),
      textColumn("content_encoding"),
      integerColumn("size_bytes", true),
      integerColumn("start_offset", true),
      integerColumn("end_offset", true),
      jsonColumn("source_location"),
      jsonColumn("metadata"),
      timestampColumn("created_at"),
      timestampColumn("updated_at", true),
    ],
  },
  {
    name: "knowledge_space_staged_commits",
    foreignKeys: [
      {
        columns: ["knowledge_space_id"],
        onDelete: "CASCADE",
        referencedColumns: ["id"],
        referencedTable: "knowledge_spaces",
      },
      {
        columns: ["document_asset_id"],
        onDelete: "SET NULL",
        referencedColumns: ["id"],
        referencedTable: "document_assets",
      },
      {
        columns: ["parse_artifact_id"],
        onDelete: "SET NULL",
        referencedColumns: ["id"],
        referencedTable: "parse_artifacts",
      },
    ],
    columns: [
      idColumn(),
      varcharColumn("tenant_id", 255),
      idColumn("knowledge_space_id"),
      textColumn("operation_type"),
      varcharColumn("idempotency_key", 255),
      varcharColumn("status", 32),
      textColumn("raw_object_key", true),
      textColumn("published_object_key", true),
      idColumn("document_asset_id", true),
      idColumn("parse_artifact_id", true),
      textColumn("projection_fingerprint", true),
      textColumn("checksum", true),
      integerColumn("size_bytes", true),
      textColumn("error_code", true),
      textColumn("error_message", true),
      timestampColumn("created_at"),
      timestampColumn("updated_at"),
      timestampColumn("expires_at", true),
    ],
  },
  {
    name: "knowledge_fs_sessions",
    foreignKeys: [
      {
        columns: ["knowledge_space_id"],
        onDelete: "CASCADE",
        referencedColumns: ["id"],
        referencedTable: "knowledge_spaces",
      },
    ],
    columns: [
      idColumn(),
      varcharColumn("tenant_id", 255),
      idColumn("knowledge_space_id"),
      textColumn("client_kind"),
      textColumn("client_version"),
      jsonColumn("subject"),
      jsonColumn("permission_snapshot"),
      textColumn("consistency_class"),
      timestampColumn("heartbeat_at"),
      timestampColumn("expires_at"),
      jsonColumn("metadata"),
      timestampColumn("created_at"),
      timestampColumn("updated_at"),
    ],
  },
  {
    name: "knowledge_fs_leases",
    foreignKeys: [
      {
        columns: ["knowledge_space_id"],
        onDelete: "CASCADE",
        referencedColumns: ["id"],
        referencedTable: "knowledge_spaces",
      },
      {
        columns: ["session_id"],
        onDelete: "CASCADE",
        referencedColumns: ["id"],
        referencedTable: "knowledge_fs_sessions",
      },
    ],
    columns: [
      idColumn(),
      varcharColumn("tenant_id", 255),
      idColumn("knowledge_space_id"),
      idColumn("session_id"),
      textColumn("lease_type"),
      textColumn("target_type"),
      textColumn("target_id"),
      integerColumn("target_version", true),
      varcharColumn("virtual_path", 384),
      varcharColumn("status", 16),
      timestampColumn("heartbeat_at"),
      timestampColumn("expires_at"),
      jsonColumn("metadata"),
      timestampColumn("acquired_at"),
      timestampColumn("updated_at"),
    ],
  },
  {
    name: "retrieval_execution_leases",
    foreignKeys: [
      {
        columns: ["tenant_id", "knowledge_space_id"],
        onDelete: "CASCADE",
        referencedColumns: ["tenant_id", "id"],
        referencedTable: "knowledge_spaces",
      },
    ],
    checkConstraints: [
      {
        expression: {
          postgres:
            '"status" IN (\'active\', \'released\', \'expired\') AND "row_version" >= 0 AND "heartbeat_at" >= "acquired_at" AND "expires_at" > "heartbeat_at" AND "updated_at" >= "acquired_at"',
          tidb: "`status` IN ('active', 'released', 'expired') AND `row_version` >= 0 AND `heartbeat_at` >= `acquired_at` AND `expires_at` > `heartbeat_at` AND `updated_at` >= `acquired_at`",
        },
        name: "retrieval_execution_leases_state_ck",
      },
    ],
    columns: [
      idColumn(),
      varcharColumn("tenant_id", 255),
      idColumn("knowledge_space_id"),
      textColumn("subject_id"),
      idColumn("trace_id"),
      varcharColumn("lease_token", 128),
      varcharColumn("status", 16),
      integerColumn("row_version"),
      timestampColumn("acquired_at"),
      timestampColumn("heartbeat_at"),
      timestampColumn("expires_at"),
      timestampColumn("updated_at"),
    ],
  },
  {
    name: "knowledge_nodes",
    checkConstraints: [
      publicationGenerationCheck(
        "knowledge_nodes_pub_gen_nonzero_ck",
        "publication_generation_id",
        true,
      ),
    ],
    foreignKeys: [
      {
        columns: ["knowledge_space_id"],
        onDelete: "CASCADE",
        referencedColumns: ["id"],
        referencedTable: "knowledge_spaces",
      },
      {
        columns: ["document_asset_id"],
        onDelete: "CASCADE",
        referencedColumns: ["id"],
        referencedTable: "document_assets",
      },
      {
        columns: ["parse_artifact_id"],
        onDelete: "CASCADE",
        referencedColumns: ["id"],
        referencedTable: "parse_artifacts",
      },
    ],
    columns: [
      idColumn(),
      idColumn("knowledge_space_id"),
      idColumn("publication_generation_id", true),
      idColumn("document_asset_id"),
      idColumn("parse_artifact_id"),
      varcharColumn("kind", 16),
      textColumn("text"),
      integerColumn("start_offset"),
      integerColumn("end_offset"),
      jsonColumn("source_location"),
      jsonColumn("permission_scope"),
      textColumn("artifact_hash"),
      jsonColumn("metadata"),
      timestampColumn("updated_at", true),
      tidbGeneratedColumn(
        "publication_generation_key",
        "CHAR(36)",
        `COALESCE(\`publication_generation_id\`, '${PUBLICATION_GENERATION_ID_SENTINEL}')`,
      ),
    ],
  },
  {
    name: "index_projections",
    checkConstraints: [
      publicationGenerationCheck(
        "index_projections_pub_gen_nonzero_ck",
        "publication_generation_id",
        true,
      ),
    ],
    foreignKeys: [
      {
        columns: ["knowledge_space_id"],
        onDelete: "CASCADE",
        referencedColumns: ["id"],
        referencedTable: "knowledge_spaces",
      },
      {
        columns: ["node_id"],
        onDelete: "CASCADE",
        referencedColumns: ["id"],
        referencedTable: "knowledge_nodes",
      },
    ],
    columns: [
      idColumn(),
      idColumn("knowledge_space_id"),
      idColumn("publication_generation_id", true),
      idColumn("node_id"),
      varcharColumn("type", 32),
      varcharColumn("status", 16),
      varcharColumn("model", 255, true),
      tidbGeneratedColumn("model_key", "VARCHAR(255)", "COALESCE(`model`, '')"),
      integerColumn("projection_version"),
      // Embedding models are selected by the plugin runtime and can emit different dimensions.
      // Keep both vector spaces unbounded. PostgreSQL/TiDB can calculate exact distances when the
      // query pins a compatible model, but neither database can attach one generic ANN index to a
      // mixed-dimensional column. Model-specific indexes must be provisioned with an explicit
      // dimension and matching model predicate when an installation needs ANN acceleration.
      vectorColumn("dense_vector", true),
      vectorColumn("visual_vector", true),
      {
        name: "fts_document",
        nullable: true,
        type: {
          postgres: "tsvector",
          // TiDB v8.5 has neither FULLTEXT indexes nor FTS_MATCH_WORD. Keep the normalized source
          // text for deterministic projection replay; queries use index_projection_fts_postings.
          tidb: "TEXT",
        },
      },
      jsonColumn("metadata"),
      timestampColumn("updated_at", true),
      tidbGeneratedColumn(
        "publication_generation_key",
        "CHAR(36)",
        `COALESCE(\`publication_generation_id\`, '${PUBLICATION_GENERATION_ID_SENTINEL}')`,
      ),
    ],
  },
  {
    name: "index_projection_fts_postings",
    checkConstraints: [
      {
        expression: {
          postgres: '"term_frequency" > 0 AND "document_token_count" >= "term_frequency"',
          tidb: "`term_frequency` > 0 AND `document_token_count` >= `term_frequency`",
        },
        name: "index_projection_fts_postings_frequency_ck",
      },
    ],
    foreignKeys: [
      {
        columns: ["knowledge_space_id"],
        onDelete: "CASCADE",
        referencedColumns: ["id"],
        referencedTable: "knowledge_spaces",
      },
      {
        columns: ["knowledge_space_id", "projection_id"],
        onDelete: "CASCADE",
        referencedColumns: ["knowledge_space_id", "id"],
        referencedTable: "index_projections",
      },
    ],
    columns: [
      idColumn(),
      idColumn("knowledge_space_id"),
      idColumn("projection_id"),
      varcharColumn("tokenizer_version", 64),
      {
        name: "term_hash",
        type: { postgres: "CHAR(64)", tidb: "CHAR(64)" },
      },
      varcharColumn("term", 128),
      integerColumn("term_frequency"),
      integerColumn("document_token_count"),
    ],
  },
  {
    name: "tidb_fts_posting_backfills",
    checkConstraints: [
      {
        expression: {
          postgres: "\"run_state\" IN ('queued', 'running', 'succeeded', 'failed')",
          tidb: "`run_state` IN ('queued', 'running', 'succeeded', 'failed')",
        },
        name: "tidb_fts_posting_backfills_state_ck",
      },
      {
        expression: {
          postgres:
            '"scanned_projections" >= 0 AND "written_postings" >= 0 AND "retry_count" >= 0 AND "row_version" >= 0',
          tidb: "`scanned_projections` >= 0 AND `written_postings` >= 0 AND `retry_count` >= 0 AND `row_version` >= 0",
        },
        name: "tidb_fts_posting_backfills_counts_ck",
      },
      {
        expression: {
          postgres:
            '(("run_state" = \'running\' AND "worker_id" IS NOT NULL AND "lease_token" IS NOT NULL AND "lease_expires_at" IS NOT NULL AND "heartbeat_at" IS NOT NULL AND "completed_at" IS NULL) OR ("run_state" <> \'running\' AND "worker_id" IS NULL AND "lease_token" IS NULL AND "lease_expires_at" IS NULL AND "heartbeat_at" IS NULL))',
          tidb: "((`run_state` = 'running' AND `worker_id` IS NOT NULL AND `lease_token` IS NOT NULL AND `lease_expires_at` IS NOT NULL AND `heartbeat_at` IS NOT NULL AND `completed_at` IS NULL) OR (`run_state` <> 'running' AND `worker_id` IS NULL AND `lease_token` IS NULL AND `lease_expires_at` IS NULL AND `heartbeat_at` IS NULL))",
        },
        name: "tidb_fts_posting_backfills_lease_ck",
      },
      {
        expression: {
          postgres:
            "((\"run_state\" IN ('succeeded', 'failed') AND \"completed_at\" IS NOT NULL) OR (\"run_state\" IN ('queued', 'running') AND \"completed_at\" IS NULL))",
          tidb: "((`run_state` IN ('succeeded', 'failed') AND `completed_at` IS NOT NULL) OR (`run_state` IN ('queued', 'running') AND `completed_at` IS NULL))",
        },
        name: "tidb_fts_posting_backfills_terminal_ck",
      },
      nonzeroUuidCheck("tidb_fts_posting_backfills_lease_token_ck", "lease_token", true),
    ],
    foreignKeys: [
      {
        columns: ["tenant_id", "knowledge_space_id"],
        onDelete: "CASCADE",
        referencedColumns: ["tenant_id", "id"],
        referencedTable: "knowledge_spaces",
      },
    ],
    columns: [
      idColumn(),
      varcharColumn("tenant_id", 255),
      idColumn("knowledge_space_id"),
      varcharColumn("tokenizer_version", 64),
      varcharColumn("run_state", 16),
      idColumn("cursor_projection_id", true),
      integerColumn("scanned_projections"),
      integerColumn("written_postings"),
      varcharColumn("worker_id", 255, true),
      idColumn("lease_token", true),
      timestampColumn("lease_expires_at", true),
      timestampColumn("heartbeat_at", true),
      integerColumn("retry_count"),
      integerColumn("row_version"),
      varcharColumn("last_error_code", 64, true),
      textColumn("last_error_message", true),
      timestampColumn("created_at"),
      timestampColumn("updated_at"),
      timestampColumn("completed_at", true),
    ],
  },
  {
    name: "projection_set_publication_heads",
    foreignKeys: [
      {
        columns: ["knowledge_space_id"],
        onDelete: "CASCADE",
        referencedColumns: ["id"],
        referencedTable: "knowledge_spaces",
      },
      {
        columns: ["tenant_id", "knowledge_space_id", "publication_id"],
        onDelete: "RESTRICT",
        referencedColumns: ["tenant_id", "knowledge_space_id", "id"],
        referencedTable: "projection_set_publications",
      },
    ],
    columns: [
      idColumn(),
      varcharColumn("tenant_id", 255),
      idColumn("knowledge_space_id"),
      idColumn("publication_id"),
      integerColumn("head_revision"),
      timestampColumn("created_at"),
      timestampColumn("updated_at"),
    ],
  },
  {
    name: "projection_set_publication_members",
    checkConstraints: [
      publicationGenerationCheck("publication_members_gen_nonzero_ck", "generation_id", false),
    ],
    foreignKeys: [
      {
        columns: ["tenant_id", "knowledge_space_id", "publication_id"],
        onDelete: "CASCADE",
        referencedColumns: ["tenant_id", "knowledge_space_id", "id"],
        referencedTable: "projection_set_publications",
      },
    ],
    columns: [
      varcharColumn("tenant_id", 255),
      idColumn("knowledge_space_id"),
      idColumn("publication_id"),
      varcharColumn("component_type", 64),
      // Polymorphic component references still use the derived row's UUID. Keeping this bounded
      // preserves compact, portable unique keys in TiDB instead of indexing an unconstrained TEXT.
      idColumn("component_key"),
      // One publication can reuse members from older immutable generations. generation_id records
      // the build that owns the component row; it is intentionally not a publication foreign key.
      idColumn("generation_id"),
      // Historical publication attribution intentionally has no document FK: deleting a source
      // document must not mutate or block immutable publication ledgers.
      idColumn("document_asset_id", true),
      timestampColumn("created_at"),
    ],
  },
  {
    name: "document_compilation_attempts",
    checkConstraints: [
      publicationGenerationCheck(
        "document_compilation_attempts_generation_nonzero_ck",
        "publication_generation_id",
        false,
      ),
      {
        expression: {
          postgres:
            '(("requested_by_subject_id" IS NULL AND "permission_snapshot_id" IS NULL AND "permission_snapshot_revision" IS NULL AND "access_channel" IS NULL) OR ("requested_by_subject_id" IS NOT NULL AND "permission_snapshot_id" IS NOT NULL AND "permission_snapshot_revision" >= 1 AND "access_channel" IN (\'interactive\', \'service_api\', \'mcp\', \'agent\')))',
          tidb: "((`requested_by_subject_id` IS NULL AND `permission_snapshot_id` IS NULL AND `permission_snapshot_revision` IS NULL AND `access_channel` IS NULL) OR (`requested_by_subject_id` IS NOT NULL AND `permission_snapshot_id` IS NOT NULL AND `permission_snapshot_revision` >= 1 AND `access_channel` IN ('interactive', 'service_api', 'mcp', 'agent')))",
        },
        name: "document_compilation_attempts_permission_binding_ck",
      },
      {
        expression: {
          postgres:
            '(("embedding_profile_kind" IS NULL AND "embedding_profile_revision_id" IS NULL AND "embedding_profile_revision" IS NULL AND "embedding_profile_snapshot_digest" IS NULL) OR ("embedding_profile_kind" = \'embedding\' AND "embedding_profile_revision_id" IS NOT NULL AND "embedding_profile_revision" >= 1 AND "embedding_profile_snapshot_digest" IS NOT NULL))',
          tidb: "((`embedding_profile_kind` IS NULL AND `embedding_profile_revision_id` IS NULL AND `embedding_profile_revision` IS NULL AND `embedding_profile_snapshot_digest` IS NULL) OR (`embedding_profile_kind` = 'embedding' AND `embedding_profile_revision_id` IS NOT NULL AND `embedding_profile_revision` >= 1 AND `embedding_profile_snapshot_digest` IS NOT NULL))",
        },
        name: "document_compilation_attempts_embedding_profile_ck",
      },
      {
        expression: {
          postgres:
            '(("retrieval_profile_kind" IS NULL AND "retrieval_profile_revision_id" IS NULL AND "retrieval_profile_revision" IS NULL AND "retrieval_profile_snapshot_digest" IS NULL) OR ("retrieval_profile_kind" = \'retrieval\' AND "retrieval_profile_revision_id" IS NOT NULL AND "retrieval_profile_revision" >= 1 AND "retrieval_profile_snapshot_digest" IS NOT NULL))',
          tidb: "((`retrieval_profile_kind` IS NULL AND `retrieval_profile_revision_id` IS NULL AND `retrieval_profile_revision` IS NULL AND `retrieval_profile_snapshot_digest` IS NULL) OR (`retrieval_profile_kind` = 'retrieval' AND `retrieval_profile_revision_id` IS NOT NULL AND `retrieval_profile_revision` >= 1 AND `retrieval_profile_snapshot_digest` IS NOT NULL))",
        },
        name: "document_compilation_attempts_retrieval_profile_ck",
      },
      {
        expression: {
          postgres:
            '(("embedding_profile_kind" IS NULL AND "embedding_profile_revision_id" IS NULL AND "embedding_profile_revision" IS NULL AND "embedding_profile_snapshot_digest" IS NULL AND "retrieval_profile_kind" IS NULL AND "retrieval_profile_revision_id" IS NULL AND "retrieval_profile_revision" IS NULL AND "retrieval_profile_snapshot_digest" IS NULL) OR ("retrieval_profile_kind" = \'retrieval\' AND "retrieval_profile_revision_id" IS NOT NULL AND "retrieval_profile_revision" >= 1 AND "retrieval_profile_snapshot_digest" IS NOT NULL AND (("embedding_profile_kind" IS NULL AND "embedding_profile_revision_id" IS NULL AND "embedding_profile_revision" IS NULL AND "embedding_profile_snapshot_digest" IS NULL) OR ("embedding_profile_kind" = \'embedding\' AND "embedding_profile_revision_id" IS NOT NULL AND "embedding_profile_revision" >= 1 AND "embedding_profile_snapshot_digest" IS NOT NULL))))',
          tidb: "((`embedding_profile_kind` IS NULL AND `embedding_profile_revision_id` IS NULL AND `embedding_profile_revision` IS NULL AND `embedding_profile_snapshot_digest` IS NULL AND `retrieval_profile_kind` IS NULL AND `retrieval_profile_revision_id` IS NULL AND `retrieval_profile_revision` IS NULL AND `retrieval_profile_snapshot_digest` IS NULL) OR (`retrieval_profile_kind` = 'retrieval' AND `retrieval_profile_revision_id` IS NOT NULL AND `retrieval_profile_revision` >= 1 AND `retrieval_profile_snapshot_digest` IS NOT NULL AND ((`embedding_profile_kind` IS NULL AND `embedding_profile_revision_id` IS NULL AND `embedding_profile_revision` IS NULL AND `embedding_profile_snapshot_digest` IS NULL) OR (`embedding_profile_kind` = 'embedding' AND `embedding_profile_revision_id` IS NOT NULL AND `embedding_profile_revision` >= 1 AND `embedding_profile_snapshot_digest` IS NOT NULL))))",
        },
        name: "document_compilation_attempts_profile_tuple_ck",
      },
      {
        expression: {
          postgres: '"active_slot" IS NULL OR "active_slot" = 1',
          tidb: "`active_slot` IS NULL OR `active_slot` = 1",
        },
        name: "document_compilation_attempts_active_slot_ck",
      },
      {
        dialects: ["postgres"],
        expression: {
          postgres: '"document_version" > 0',
          tidb: "`document_version` > 0",
        },
        name: "document_compilation_attempts_document_version_ck",
      },
      {
        expression: {
          postgres: '"base_head_revision" >= 0',
          tidb: "`base_head_revision` >= 0",
        },
        name: "document_compilation_attempts_base_revision_ck",
      },
      {
        expression: {
          postgres:
            '"execution_attempts" >= 0 AND "max_execution_attempts" > 0 AND "execution_attempts" <= "max_execution_attempts"',
          tidb: "`execution_attempts` >= 0 AND `max_execution_attempts` > 0 AND `execution_attempts` <= `max_execution_attempts`",
        },
        name: "document_compilation_attempts_execution_count_ck",
      },
      {
        expression: {
          postgres: '"row_version" >= 0',
          tidb: "`row_version` >= 0",
        },
        name: "document_compilation_attempts_row_version_ck",
      },
      {
        expression: {
          postgres:
            "\"checkpoint\" IN ('queued', 'parsed', 'outline_built', 'nodes_generated', 'projection_built', 'smoke_eval_passed', 'published')",
          tidb: "`checkpoint` IN ('queued', 'parsed', 'outline_built', 'nodes_generated', 'projection_built', 'smoke_eval_passed', 'published')",
        },
        name: "document_compilation_attempts_checkpoint_ck",
      },
      {
        expression: {
          postgres:
            "\"run_state\" IN ('dispatch_pending', 'queued', 'running', 'retry_wait', 'succeeded', 'failed', 'canceled', 'superseded')",
          tidb: "`run_state` IN ('dispatch_pending', 'queued', 'running', 'retry_wait', 'succeeded', 'failed', 'canceled', 'superseded')",
        },
        name: "document_compilation_attempts_run_state_ck",
      },
      {
        expression: {
          postgres:
            "((\"run_state\" IN ('succeeded', 'failed', 'canceled', 'superseded') AND \"active_slot\" IS NULL AND \"completed_at\" IS NOT NULL) OR (\"run_state\" IN ('dispatch_pending', 'queued', 'running', 'retry_wait') AND \"active_slot\" = 1 AND \"completed_at\" IS NULL))",
          tidb: "((`run_state` IN ('succeeded', 'failed', 'canceled', 'superseded') AND `active_slot` IS NULL AND `completed_at` IS NOT NULL) OR (`run_state` IN ('dispatch_pending', 'queued', 'running', 'retry_wait') AND `active_slot` = 1 AND `completed_at` IS NULL))",
        },
        name: "document_compilation_attempts_lifecycle_ck",
      },
      {
        expression: {
          postgres:
            '(("run_state" = \'retry_wait\' AND "retry_at" IS NOT NULL) OR ("run_state" <> \'retry_wait\' AND "retry_at" IS NULL))',
          tidb: "((`run_state` = 'retry_wait' AND `retry_at` IS NOT NULL) OR (`run_state` <> 'retry_wait' AND `retry_at` IS NULL))",
        },
        name: "document_compilation_attempts_retry_schedule_ck",
      },
      {
        dialects: ["postgres"],
        expression: {
          postgres:
            '(("candidate_publication_id" IS NULL AND "candidate_fingerprint" IS NULL) OR ("candidate_publication_id" IS NOT NULL AND "candidate_fingerprint" IS NOT NULL))',
          tidb: "((`candidate_publication_id` IS NULL AND `candidate_fingerprint` IS NULL) OR (`candidate_publication_id` IS NOT NULL AND `candidate_fingerprint` IS NOT NULL))",
        },
        name: "document_compilation_attempts_candidate_pair_ck",
      },
      {
        dialects: ["postgres"],
        expression: {
          postgres:
            "\"checkpoint\" NOT IN ('projection_built', 'smoke_eval_passed', 'published') OR (\"candidate_publication_id\" IS NOT NULL AND \"candidate_fingerprint\" IS NOT NULL)",
          tidb: "`checkpoint` NOT IN ('projection_built', 'smoke_eval_passed', 'published') OR (`candidate_publication_id` IS NOT NULL AND `candidate_fingerprint` IS NOT NULL)",
        },
        name: "document_compilation_attempts_candidate_checkpoint_ck",
      },
      {
        expression: {
          postgres:
            '(("run_state" = \'running\' AND "worker_id" IS NOT NULL AND "lease_token" IS NOT NULL AND "lease_expires_at" IS NOT NULL AND "heartbeat_at" IS NOT NULL) OR ("run_state" <> \'running\' AND "worker_id" IS NULL AND "lease_token" IS NULL AND "lease_expires_at" IS NULL AND "heartbeat_at" IS NULL))',
          tidb: "((`run_state` = 'running' AND `worker_id` IS NOT NULL AND `lease_token` IS NOT NULL AND `lease_expires_at` IS NOT NULL AND `heartbeat_at` IS NOT NULL) OR (`run_state` <> 'running' AND `worker_id` IS NULL AND `lease_token` IS NULL AND `lease_expires_at` IS NULL AND `heartbeat_at` IS NULL))",
        },
        name: "document_compilation_attempts_lease_state_ck",
      },
      nonzeroUuidCheck("document_compilation_attempts_lease_token_ck", "lease_token", true),
    ],
    foreignKeys: [
      {
        columns: ["tenant_id", "knowledge_space_id"],
        onDelete: "CASCADE",
        referencedColumns: ["tenant_id", "id"],
        referencedTable: "knowledge_spaces",
      },
      {
        columns: ["knowledge_space_id", "document_asset_id", "document_version"],
        onDelete: "CASCADE",
        referencedColumns: ["knowledge_space_id", "id", "version"],
        referencedTable: "document_assets",
      },
      {
        columns: [
          "tenant_id",
          "knowledge_space_id",
          "candidate_publication_id",
          "candidate_fingerprint",
        ],
        onDelete: "RESTRICT",
        referencedColumns: ["tenant_id", "knowledge_space_id", "id", "fingerprint"],
        referencedTable: "projection_set_publications",
      },
      {
        columns: [
          "tenant_id",
          "knowledge_space_id",
          "embedding_profile_kind",
          "embedding_profile_revision_id",
          "embedding_profile_revision",
          "embedding_profile_snapshot_digest",
        ],
        onDelete: "RESTRICT",
        referencedColumns: [
          "tenant_id",
          "knowledge_space_id",
          "kind",
          "id",
          "revision",
          "snapshot_digest",
        ],
        referencedTable: "knowledge_space_profile_revisions",
      },
      {
        columns: [
          "tenant_id",
          "knowledge_space_id",
          "retrieval_profile_kind",
          "retrieval_profile_revision_id",
          "retrieval_profile_revision",
          "retrieval_profile_snapshot_digest",
        ],
        onDelete: "RESTRICT",
        referencedColumns: [
          "tenant_id",
          "knowledge_space_id",
          "kind",
          "id",
          "revision",
          "snapshot_digest",
        ],
        referencedTable: "knowledge_space_profile_revisions",
      },
      {
        columns: [
          "tenant_id",
          "knowledge_space_id",
          "permission_snapshot_id",
          "requested_by_subject_id",
          "access_channel",
        ],
        onDelete: "RESTRICT",
        referencedColumns: [
          "tenant_id",
          "knowledge_space_id",
          "id",
          "subject_id",
          "access_channel",
        ],
        referencedTable: "knowledge_space_permission_snapshots",
      },
    ],
    columns: [
      idColumn(),
      varcharColumn("tenant_id", 255),
      idColumn("knowledge_space_id"),
      idColumn("document_asset_id"),
      integerColumn("document_version"),
      idColumn("publication_generation_id"),
      varcharColumn("requested_by_subject_id", 255, true),
      idColumn("permission_snapshot_id", true),
      integerColumn("permission_snapshot_revision", true),
      varcharColumn("access_channel", 16, true),
      varcharColumn("embedding_profile_kind", 16, true),
      idColumn("embedding_profile_revision_id", true),
      integerColumn("embedding_profile_revision", true),
      {
        name: "embedding_profile_snapshot_digest",
        nullable: true,
        type: { postgres: "CHAR(64)", tidb: "CHAR(64)" },
      },
      varcharColumn("retrieval_profile_kind", 16, true),
      idColumn("retrieval_profile_revision_id", true),
      integerColumn("retrieval_profile_revision", true),
      {
        name: "retrieval_profile_snapshot_digest",
        nullable: true,
        type: { postgres: "CHAR(64)", tidb: "CHAR(64)" },
      },
      integerColumn("base_head_revision"),
      idColumn("candidate_publication_id", true),
      varcharColumn("candidate_fingerprint", 86, true),
      varcharColumn("checkpoint", 32),
      varcharColumn("run_state", 16),
      integerColumn("active_slot", true),
      integerColumn("execution_attempts"),
      integerColumn("max_execution_attempts"),
      varcharColumn("queue_job_id", 255, true),
      varcharColumn("external_job_id", 255, true),
      varcharColumn("worker_id", 255, true),
      idColumn("lease_token", true),
      timestampColumn("lease_expires_at", true),
      timestampColumn("heartbeat_at", true),
      timestampColumn("retry_at", true),
      varcharColumn("last_error_code", 64, true),
      textColumn("last_error_message", true),
      integerColumn("row_version"),
      timestampColumn("created_at"),
      timestampColumn("updated_at"),
      timestampColumn("started_at", true),
      timestampColumn("completed_at", true),
    ],
  },
  {
    name: "logical_documents",
    checkConstraints: [
      {
        expression: {
          postgres: `"status" IN ('pending', 'ready', 'failed', 'deleting')`,
          tidb: "`status` IN ('pending', 'ready', 'failed', 'deleting')",
        },
        name: "logical_documents_status_ck",
      },
      {
        expression: {
          postgres:
            '(("status" = \'deleting\' AND "deletion_job_id" IS NOT NULL AND "deleting_at" IS NOT NULL) OR ("status" <> \'deleting\' AND "deletion_job_id" IS NULL AND "deleting_at" IS NULL))',
          tidb: "((`status` = 'deleting' AND `deletion_job_id` IS NOT NULL AND `deleting_at` IS NOT NULL) OR (`status` <> 'deleting' AND `deletion_job_id` IS NULL AND `deleting_at` IS NULL))",
        },
        name: "logical_documents_deletion_lifecycle_ck",
      },
      {
        expression: {
          postgres: '"active_revision" IS NULL OR "active_revision" > 0',
          tidb: "`active_revision` IS NULL OR `active_revision` > 0",
        },
        name: "logical_documents_active_revision_ck",
      },
      {
        expression: { postgres: '"row_version" >= 0', tidb: "`row_version` >= 0" },
        name: "logical_documents_row_version_ck",
      },
      {
        expression: {
          postgres:
            '(("source_id" IS NULL AND "provider_item_id" IS NULL AND "provider_item_digest" IS NULL) OR ("source_id" IS NOT NULL AND "provider_item_id" IS NOT NULL AND "provider_item_digest" ~ \'^[a-f0-9]{64}$\'))',
          tidb: "((`source_id` IS NULL AND `provider_item_id` IS NULL AND `provider_item_digest` IS NULL) OR (`source_id` IS NOT NULL AND `provider_item_id` IS NOT NULL AND `provider_item_digest` REGEXP '^[a-f0-9]{64}$'))",
        },
        name: "logical_documents_provider_identity_ck",
      },
    ],
    foreignKeys: [
      {
        columns: ["tenant_id", "knowledge_space_id"],
        onDelete: "CASCADE",
        referencedColumns: ["tenant_id", "id"],
        referencedTable: "knowledge_spaces",
      },
      {
        columns: ["tenant_id", "knowledge_space_id", "id", "active_revision"],
        deferrability: {
          postgres: "DEFERRABLE INITIALLY DEFERRED",
          tidb: "NOT DEFERRABLE",
        },
        inline: false,
        name: "logical_documents_active_revision_fk",
        onDeleteByDialect: { postgres: "NO ACTION", tidb: "RESTRICT" },
        referencedColumns: ["tenant_id", "knowledge_space_id", "document_id", "revision"],
        referencedTable: "document_revisions",
      },
      // Source deletion supports both detach-and-keep and cascade. A source FK cannot express
      // those two policies while preserving the source/provider identity pair, so the durable
      // deletion transaction validates and mutates this relationship explicitly.
    ],
    columns: [
      idColumn(),
      varcharColumn("tenant_id", 255),
      idColumn("knowledge_space_id"),
      idColumn("source_id", true),
      varcharColumn("provider_item_id", 1024, true),
      {
        name: "provider_item_digest",
        nullable: true,
        type: { postgres: "CHAR(64)", tidb: "CHAR(64)" },
      },
      textColumn("title"),
      varcharColumn("status", 16),
      idColumn("deletion_job_id", true),
      timestampColumn("deleting_at", true),
      integerColumn("active_revision", true),
      integerColumn("row_version"),
      jsonColumn("system_metadata"),
      jsonColumn("user_metadata"),
      timestampColumn("created_at"),
      timestampColumn("updated_at"),
    ],
  },
  {
    name: "document_revisions",
    checkConstraints: [
      {
        expression: { postgres: '"revision" > 0', tidb: "`revision` > 0" },
        name: "document_revisions_revision_ck",
      },
      {
        expression: {
          postgres: '"document_asset_version" > 0',
          tidb: "`document_asset_version` > 0",
        },
        name: "document_revisions_asset_version_ck",
      },
      {
        expression: {
          postgres: '"expected_active_revision" IS NULL OR "expected_active_revision" > 0',
          tidb: "`expected_active_revision` IS NULL OR `expected_active_revision` > 0",
        },
        name: "document_revisions_expected_active_ck",
      },
      {
        expression: {
          postgres: '"expected_document_row_version" >= 0',
          tidb: "`expected_document_row_version` >= 0",
        },
        name: "document_revisions_expected_row_version_ck",
      },
      {
        expression: { postgres: '"size_bytes" >= 0', tidb: "`size_bytes` >= 0" },
        name: "document_revisions_size_ck",
      },
      {
        expression: {
          postgres: "\"content_hash\" ~ '^[0-9a-f]{64}$'",
          tidb: "`content_hash` REGEXP '^[0-9a-f]{64}$'",
        },
        name: "document_revisions_hash_ck",
      },
      {
        expression: {
          postgres: `"state" IN ('candidate', 'active', 'superseded', 'failed')`,
          tidb: "`state` IN ('candidate', 'active', 'superseded', 'failed')",
        },
        name: "document_revisions_state_ck",
      },
      {
        expression: {
          postgres:
            "((\"state\" IN ('active', 'superseded') AND \"activated_at\" IS NOT NULL) OR (\"state\" IN ('candidate', 'failed') AND \"activated_at\" IS NULL))",
          tidb: "((`state` IN ('active', 'superseded') AND `activated_at` IS NOT NULL) OR (`state` IN ('candidate', 'failed') AND `activated_at` IS NULL))",
        },
        name: "document_revisions_activation_ck",
      },
    ],
    foreignKeys: [
      {
        columns: ["tenant_id", "knowledge_space_id", "document_id"],
        onDelete: "CASCADE",
        referencedColumns: ["tenant_id", "knowledge_space_id", "id"],
        referencedTable: "logical_documents",
      },
      {
        columns: ["knowledge_space_id", "document_asset_id", "document_asset_version"],
        onDelete: "RESTRICT",
        referencedColumns: ["knowledge_space_id", "id", "version"],
        referencedTable: "document_assets",
      },
      // Compilation attempts are an operational ledger with independent retention. The exact
      // attempt is validated by repository CAS; omitting a physical FK lets terminal attempt GC
      // retain immutable revision history.
    ],
    columns: [
      varcharColumn("tenant_id", 255),
      idColumn("knowledge_space_id"),
      idColumn("document_id"),
      integerColumn("revision"),
      idColumn("document_asset_id"),
      integerColumn("document_asset_version"),
      idColumn("compilation_attempt_id", true),
      integerColumn("expected_active_revision", true),
      integerColumn("expected_document_row_version"),
      { name: "content_hash", type: { postgres: "CHAR(64)", tidb: "CHAR(64)" } },
      varcharColumn("mime_type", 255),
      bigintColumn("size_bytes"),
      varcharColumn("state", 16),
      jsonColumn("system_metadata"),
      timestampColumn("created_at"),
      timestampColumn("activated_at", true),
    ],
  },
  {
    name: "document_revision_chunks",
    checkConstraints: [
      {
        expression: { postgres: '"ordinal" >= 0', tidb: "`ordinal` >= 0" },
        name: "document_revision_chunks_ordinal_ck",
      },
      {
        expression: { postgres: '"token_count" >= 0', tidb: "`token_count` >= 0" },
        name: "document_revision_chunks_tokens_ck",
      },
    ],
    foreignKeys: [
      {
        columns: ["tenant_id", "knowledge_space_id", "document_id", "document_revision"],
        onDelete: "CASCADE",
        referencedColumns: ["tenant_id", "knowledge_space_id", "document_id", "revision"],
        referencedTable: "document_revisions",
      },
      {
        columns: [
          "tenant_id",
          "knowledge_space_id",
          "document_id",
          "document_revision",
          "parent_chunk_id",
        ],
        onDelete: "CASCADE",
        referencedColumns: [
          "tenant_id",
          "knowledge_space_id",
          "document_id",
          "document_revision",
          "id",
        ],
        referencedTable: "document_revision_chunks",
      },
    ],
    columns: [
      idColumn(),
      varcharColumn("tenant_id", 255),
      idColumn("knowledge_space_id"),
      idColumn("document_id"),
      integerColumn("document_revision"),
      idColumn("parent_chunk_id", true),
      integerColumn("ordinal"),
      integerColumn("token_count"),
      textColumn("text"),
      jsonColumn("system_metadata"),
      jsonColumn("user_metadata"),
      timestampColumn("created_at"),
    ],
  },
  {
    name: "document_chunk_state_changes",
    checkConstraints: [
      {
        expression: {
          postgres: `"state" IN ('candidate', 'active', 'superseded', 'failed')`,
          tidb: "`state` IN ('candidate', 'active', 'superseded', 'failed')",
        },
        name: "document_chunk_state_changes_state_ck",
      },
      {
        expression: {
          postgres:
            "((\"state\" IN ('active', 'superseded') AND \"activated_at\" IS NOT NULL) OR (\"state\" IN ('candidate', 'failed') AND \"activated_at\" IS NULL))",
          tidb: "((`state` IN ('active', 'superseded') AND `activated_at` IS NOT NULL) OR (`state` IN ('candidate', 'failed') AND `activated_at` IS NULL))",
        },
        name: "document_chunk_state_changes_activation_ck",
      },
      {
        expression: {
          postgres:
            '(("candidate_publication_id" IS NULL AND "candidate_fingerprint" IS NULL) OR ("candidate_publication_id" IS NOT NULL AND "candidate_fingerprint" IS NOT NULL))',
          tidb: "((`candidate_publication_id` IS NULL AND `candidate_fingerprint` IS NULL) OR (`candidate_publication_id` IS NOT NULL AND `candidate_fingerprint` IS NOT NULL))",
        },
        name: "document_chunk_state_changes_candidate_pair_ck",
      },
    ],
    foreignKeys: [
      {
        columns: [
          "tenant_id",
          "knowledge_space_id",
          "document_id",
          "document_revision",
          "chunk_id",
        ],
        onDelete: "CASCADE",
        referencedColumns: [
          "tenant_id",
          "knowledge_space_id",
          "document_id",
          "document_revision",
          "id",
        ],
        referencedTable: "document_revision_chunks",
      },
    ],
    columns: [
      idColumn(),
      varcharColumn("tenant_id", 255),
      idColumn("knowledge_space_id"),
      idColumn("document_id"),
      integerColumn("document_revision"),
      idColumn("chunk_id"),
      boolColumn("enabled"),
      varcharColumn("state", 16),
      idColumn("compilation_attempt_id"),
      idColumn("candidate_publication_id", true),
      varcharColumn("candidate_fingerprint", 86, true),
      timestampColumn("created_at"),
      timestampColumn("activated_at", true),
    ],
  },
  {
    name: "document_settings_revisions",
    checkConstraints: [
      {
        expression: { postgres: '"revision" > 0', tidb: "`revision` > 0" },
        name: "document_settings_revisions_revision_ck",
      },
      {
        expression: {
          postgres: `"state" IN ('candidate', 'active', 'superseded', 'failed')`,
          tidb: "`state` IN ('candidate', 'active', 'superseded', 'failed')",
        },
        name: "document_settings_revisions_state_ck",
      },
      {
        expression: {
          postgres:
            "((\"state\" IN ('active', 'superseded') AND \"activated_at\" IS NOT NULL) OR (\"state\" IN ('candidate', 'failed') AND \"activated_at\" IS NULL))",
          tidb: "((`state` IN ('active', 'superseded') AND `activated_at` IS NOT NULL) OR (`state` IN ('candidate', 'failed') AND `activated_at` IS NULL))",
        },
        name: "document_settings_revisions_activation_ck",
      },
    ],
    foreignKeys: [
      {
        columns: ["tenant_id", "knowledge_space_id", "document_id"],
        onDelete: "CASCADE",
        referencedColumns: ["tenant_id", "knowledge_space_id", "id"],
        referencedTable: "logical_documents",
      },
    ],
    columns: [
      varcharColumn("tenant_id", 255),
      idColumn("knowledge_space_id"),
      idColumn("document_id"),
      integerColumn("revision"),
      jsonColumn("settings"),
      varcharColumn("state", 16),
      varcharColumn("created_by_subject_id", 255),
      timestampColumn("created_at"),
      timestampColumn("activated_at", true),
    ],
  },
  {
    name: "document_settings_heads",
    checkConstraints: [
      {
        expression: { postgres: '"active_revision" > 0', tidb: "`active_revision` > 0" },
        name: "document_settings_heads_revision_ck",
      },
      {
        expression: { postgres: '"row_version" >= 0', tidb: "`row_version` >= 0" },
        name: "document_settings_heads_row_version_ck",
      },
    ],
    foreignKeys: [
      {
        columns: ["tenant_id", "knowledge_space_id", "document_id", "active_revision"],
        deferrability: {
          postgres: "DEFERRABLE INITIALLY DEFERRED",
          tidb: "NOT DEFERRABLE",
        },
        onDelete: "RESTRICT",
        referencedColumns: ["tenant_id", "knowledge_space_id", "document_id", "revision"],
        referencedTable: "document_settings_revisions",
      },
    ],
    columns: [
      varcharColumn("tenant_id", 255),
      idColumn("knowledge_space_id"),
      idColumn("document_id"),
      integerColumn("active_revision"),
      integerColumn("row_version"),
      timestampColumn("updated_at"),
    ],
  },
  {
    name: "document_reindex_attempts",
    checkConstraints: [
      {
        expression: {
          postgres: `"state" IN ('queued', 'running', 'succeeded', 'failed', 'canceled')`,
          tidb: "`state` IN ('queued', 'running', 'succeeded', 'failed', 'canceled')",
        },
        name: "document_reindex_attempts_state_ck",
      },
      {
        expression: {
          postgres: '"active_slot" IS NULL OR "active_slot" = 1',
          tidb: "`active_slot` IS NULL OR `active_slot` = 1",
        },
        name: "document_reindex_attempts_active_slot_ck",
      },
      {
        expression: { postgres: '"row_version" >= 0', tidb: "`row_version` >= 0" },
        name: "document_reindex_attempts_row_version_ck",
      },
      {
        expression: {
          postgres: '"expected_settings_head_revision" > 0',
          tidb: "`expected_settings_head_revision` > 0",
        },
        name: "document_reindex_attempts_expected_settings_head_revision_ck",
      },
      {
        expression: {
          postgres:
            '(("state" IN (\'queued\', \'running\') AND "active_slot" = 1 AND "completed_at" IS NULL) OR ("state" IN (\'succeeded\', \'failed\', \'canceled\') AND "active_slot" IS NULL AND "completed_at" IS NOT NULL))',
          tidb: "((`state` IN ('queued', 'running') AND `active_slot` = 1 AND `completed_at` IS NULL) OR (`state` IN ('succeeded', 'failed', 'canceled') AND `active_slot` IS NULL AND `completed_at` IS NOT NULL))",
        },
        name: "document_reindex_attempts_lifecycle_ck",
      },
      {
        expression: {
          postgres:
            '(("candidate_publication_id" IS NULL AND "candidate_fingerprint" IS NULL) OR ("candidate_publication_id" IS NOT NULL AND "candidate_fingerprint" IS NOT NULL))',
          tidb: "((`candidate_publication_id` IS NULL AND `candidate_fingerprint` IS NULL) OR (`candidate_publication_id` IS NOT NULL AND `candidate_fingerprint` IS NOT NULL))",
        },
        name: "document_reindex_attempts_candidate_pair_ck",
      },
    ],
    foreignKeys: [
      {
        columns: ["tenant_id", "knowledge_space_id", "document_id", "document_revision"],
        onDelete: "RESTRICT",
        referencedColumns: ["tenant_id", "knowledge_space_id", "document_id", "revision"],
        referencedTable: "document_revisions",
      },
      {
        columns: ["tenant_id", "knowledge_space_id", "document_id", "settings_revision"],
        onDelete: "RESTRICT",
        referencedColumns: ["tenant_id", "knowledge_space_id", "document_id", "revision"],
        referencedTable: "document_settings_revisions",
      },
    ],
    columns: [
      idColumn(),
      varcharColumn("tenant_id", 255),
      idColumn("knowledge_space_id"),
      idColumn("document_id"),
      integerColumn("document_revision"),
      integerColumn("settings_revision"),
      integerColumn("expected_settings_head_revision"),
      varcharColumn("state", 16),
      integerColumn("active_slot", true),
      idColumn("compilation_attempt_id"),
      idColumn("candidate_publication_id", true),
      varcharColumn("candidate_fingerprint", 86, true),
      integerColumn("row_version"),
      varcharColumn("error_code", 64, true),
      textColumn("error_message", true),
      timestampColumn("created_at"),
      timestampColumn("updated_at"),
      timestampColumn("completed_at", true),
    ],
  },
  {
    name: "document_compilation_outbox",
    checkConstraints: [
      {
        expression: {
          postgres: "\"event_type\" = 'document.compile'",
          tidb: "`event_type` = 'document.compile'",
        },
        name: "document_compilation_outbox_event_type_ck",
      },
      {
        expression: {
          postgres: '"schema_version" = 1',
          tidb: "`schema_version` = 1",
        },
        name: "document_compilation_outbox_schema_version_ck",
      },
      {
        expression: {
          postgres:
            "\"status\" IN ('pending', 'dispatching', 'dispatched', 'leased', 'completed', 'canceled', 'dead')",
          tidb: "`status` IN ('pending', 'dispatching', 'dispatched', 'leased', 'completed', 'canceled', 'dead')",
        },
        name: "document_compilation_outbox_status_ck",
      },
      {
        expression: {
          postgres: '"dispatch_attempts" >= 0',
          tidb: "`dispatch_attempts` >= 0",
        },
        name: "document_compilation_outbox_dispatch_attempts_ck",
      },
      {
        expression: {
          postgres:
            '(("status" = \'dispatching\' AND "locked_by" IS NOT NULL AND "lock_token" IS NOT NULL AND "locked_until" IS NOT NULL) OR ("status" <> \'dispatching\' AND "locked_by" IS NULL AND "lock_token" IS NULL AND "locked_until" IS NULL))',
          tidb: "((`status` = 'dispatching' AND `locked_by` IS NOT NULL AND `lock_token` IS NOT NULL AND `locked_until` IS NOT NULL) OR (`status` <> 'dispatching' AND `locked_by` IS NULL AND `lock_token` IS NULL AND `locked_until` IS NULL))",
        },
        name: "document_compilation_outbox_lock_state_ck",
      },
      nonzeroUuidCheck("document_compilation_outbox_lock_token_ck", "lock_token", true),
    ],
    foreignKeys: [
      {
        columns: ["attempt_id"],
        onDelete: "CASCADE",
        referencedColumns: ["id"],
        referencedTable: "document_compilation_attempts",
      },
    ],
    columns: [
      idColumn(),
      idColumn("attempt_id"),
      varcharColumn("event_type", 64),
      integerColumn("schema_version"),
      jsonColumn("payload"),
      varcharColumn("idempotency_key", 255),
      varcharColumn("status", 16),
      integerColumn("dispatch_attempts"),
      timestampColumn("available_at"),
      varcharColumn("locked_by", 255, true),
      idColumn("lock_token", true),
      timestampColumn("locked_until", true),
      varcharColumn("queue_job_id", 255, true),
      varcharColumn("external_job_id", 255, true),
      timestampColumn("delivered_at", true),
      textColumn("last_error", true),
      timestampColumn("created_at"),
      timestampColumn("updated_at"),
    ],
  },
  {
    name: "deletion_jobs",
    checkConstraints: [
      {
        expression: {
          postgres:
            "\"target_type\" IN ('knowledge_space', 'source', 'document_asset', 'logical_document') AND ((\"target_type\" = 'source' AND \"delete_mode\" IN ('keep', 'cascade') AND \"name_challenge_digest\" IS NULL) OR (\"target_type\" = 'knowledge_space' AND \"delete_mode\" = 'cascade' AND \"name_challenge_digest\" IS NOT NULL) OR (\"target_type\" IN ('document_asset', 'logical_document') AND \"delete_mode\" = 'cascade' AND \"name_challenge_digest\" IS NULL))",
          tidb: "`target_type` IN ('knowledge_space', 'source', 'document_asset', 'logical_document') AND ((`target_type` = 'source' AND `delete_mode` IN ('keep', 'cascade') AND `name_challenge_digest` IS NULL) OR (`target_type` = 'knowledge_space' AND `delete_mode` = 'cascade' AND `name_challenge_digest` IS NOT NULL) OR (`target_type` IN ('document_asset', 'logical_document') AND `delete_mode` = 'cascade' AND `name_challenge_digest` IS NULL))",
        },
        name: "deletion_jobs_target_ck",
      },
      {
        expression: {
          postgres:
            "\"checkpoint\" IN ('requested', 'quiescing', 'deleting_objects', 'deleting_derived_data', 'deleting_primary_data', 'completed')",
          tidb: "`checkpoint` IN ('requested', 'quiescing', 'deleting_objects', 'deleting_derived_data', 'deleting_primary_data', 'completed')",
        },
        name: "deletion_jobs_checkpoint_ck",
      },
      {
        expression: {
          postgres:
            "\"run_state\" IN ('dispatch_pending', 'queued', 'running', 'retry_wait', 'succeeded', 'failed', 'canceled')",
          tidb: "`run_state` IN ('dispatch_pending', 'queued', 'running', 'retry_wait', 'succeeded', 'failed', 'canceled')",
        },
        name: "deletion_jobs_run_state_ck",
      },
      {
        expression: {
          postgres: "\"access_channel\" IN ('interactive', 'service_api', 'mcp', 'agent')",
          tidb: "`access_channel` IN ('interactive', 'service_api', 'mcp', 'agent')",
        },
        name: "deletion_jobs_access_channel_ck",
      },
      {
        expression: {
          postgres:
            '(("api_key_id" IS NULL AND "api_key_revision" IS NULL AND "api_key_expires_at" IS NULL) OR ("api_key_id" IS NOT NULL AND "api_key_revision" >= 1 AND "access_channel" = \'service_api\'))',
          tidb: "((`api_key_id` IS NULL AND `api_key_revision` IS NULL AND `api_key_expires_at` IS NULL) OR (`api_key_id` IS NOT NULL AND `api_key_revision` >= 1 AND `access_channel` = 'service_api'))",
        },
        name: "deletion_jobs_api_key_binding_ck",
      },
      {
        expression: {
          postgres:
            '"target_revision" >= 1 AND "permission_snapshot_revision" >= 1 AND "row_version" >= 1 AND "execution_attempts" >= 0 AND "max_execution_attempts" >= 1 AND "execution_attempts" <= "max_execution_attempts" AND ("active_slot" IS NULL OR "active_slot" = 1)',
          tidb: "`target_revision` >= 1 AND `permission_snapshot_revision` >= 1 AND `row_version` >= 1 AND `execution_attempts` >= 0 AND `max_execution_attempts` >= 1 AND `execution_attempts` <= `max_execution_attempts` AND (`active_slot` IS NULL OR `active_slot` = 1)",
        },
        name: "deletion_jobs_positive_ck",
      },
      {
        expression: {
          postgres:
            "((\"run_state\" IN ('dispatch_pending', 'queued', 'running', 'retry_wait', 'failed') AND \"active_slot\" = 1 AND \"completed_at\" IS NULL) OR (\"run_state\" IN ('succeeded', 'canceled') AND \"active_slot\" IS NULL AND \"completed_at\" IS NOT NULL))",
          tidb: "((`run_state` IN ('dispatch_pending', 'queued', 'running', 'retry_wait', 'failed') AND `active_slot` = 1 AND `completed_at` IS NULL) OR (`run_state` IN ('succeeded', 'canceled') AND `active_slot` IS NULL AND `completed_at` IS NOT NULL))",
        },
        name: "deletion_jobs_lifecycle_ck",
      },
      {
        expression: {
          postgres:
            "((\"run_state\" = 'succeeded' AND \"checkpoint\" = 'completed') OR (\"run_state\" <> 'succeeded' AND \"checkpoint\" <> 'completed'))",
          tidb: "((`run_state` = 'succeeded' AND `checkpoint` = 'completed') OR (`run_state` <> 'succeeded' AND `checkpoint` <> 'completed'))",
        },
        name: "deletion_jobs_completion_ck",
      },
      {
        expression: {
          postgres:
            '(("run_state" = \'retry_wait\' AND "retry_at" IS NOT NULL) OR ("run_state" <> \'retry_wait\' AND "retry_at" IS NULL))',
          tidb: "((`run_state` = 'retry_wait' AND `retry_at` IS NOT NULL) OR (`run_state` <> 'retry_wait' AND `retry_at` IS NULL))",
        },
        name: "deletion_jobs_retry_ck",
      },
      {
        expression: {
          postgres:
            '(("run_state" = \'running\' AND "worker_id" IS NOT NULL AND "lease_token" IS NOT NULL AND "lease_expires_at" IS NOT NULL AND "heartbeat_at" IS NOT NULL) OR ("run_state" <> \'running\' AND "worker_id" IS NULL AND "lease_token" IS NULL AND "lease_expires_at" IS NULL AND "heartbeat_at" IS NULL))',
          tidb: "((`run_state` = 'running' AND `worker_id` IS NOT NULL AND `lease_token` IS NOT NULL AND `lease_expires_at` IS NOT NULL AND `heartbeat_at` IS NOT NULL) OR (`run_state` <> 'running' AND `worker_id` IS NULL AND `lease_token` IS NULL AND `lease_expires_at` IS NULL AND `heartbeat_at` IS NULL))",
        },
        name: "deletion_jobs_lease_ck",
      },
    ],
    columns: [
      idColumn(),
      varcharColumn("tenant_id", 255),
      idColumn("knowledge_space_id"),
      varcharColumn("target_type", 32),
      idColumn("target_id"),
      integerColumn("target_revision"),
      varcharColumn("delete_mode", 16),
      varcharColumn("requested_by_subject_id", 255),
      idColumn("permission_snapshot_id"),
      integerColumn("permission_snapshot_revision"),
      varcharColumn("access_channel", 16),
      idColumn("api_key_id", true),
      integerColumn("api_key_revision", true),
      timestampColumn("api_key_expires_at", true),
      varcharColumn("idempotency_key", 512),
      varcharColumn("request_fingerprint", 64),
      varcharColumn("name_challenge_digest", 64, true),
      varcharColumn("checkpoint", 32),
      varcharColumn("scan_phase", 64, true),
      varcharColumn("scan_cursor", 1024, true),
      boolColumn("inventory_complete"),
      varcharColumn("run_state", 16),
      integerColumn("active_slot", true),
      integerColumn("execution_attempts"),
      integerColumn("max_execution_attempts"),
      timestampColumn("retry_at", true),
      varcharColumn("worker_id", 255, true),
      idColumn("lease_token", true),
      timestampColumn("lease_expires_at", true),
      timestampColumn("heartbeat_at", true),
      varcharColumn("queue_job_id", 255, true),
      varcharColumn("last_error_code", 64, true),
      textColumn("last_error_message", true),
      integerColumn("row_version"),
      timestampColumn("created_at"),
      timestampColumn("updated_at"),
      timestampColumn("started_at", true),
      timestampColumn("completed_at", true),
    ],
  },
  {
    name: "deletion_tombstones",
    checkConstraints: [
      {
        expression: {
          postgres:
            "\"target_type\" IN ('knowledge_space', 'source', 'document_asset', 'logical_document')",
          tidb: "`target_type` IN ('knowledge_space', 'source', 'document_asset', 'logical_document')",
        },
        name: "deletion_tombstones_target_ck",
      },
      {
        expression: {
          postgres:
            '(("state" = \'active\' AND "completed_at" IS NULL) OR ("state" = \'completed\' AND "completed_at" IS NOT NULL))',
          tidb: "((`state` = 'active' AND `completed_at` IS NULL) OR (`state` = 'completed' AND `completed_at` IS NOT NULL))",
        },
        name: "deletion_tombstones_state_ck",
      },
      {
        expression: {
          postgres: '"target_revision" >= 1 AND "row_version" >= 1',
          tidb: "`target_revision` >= 1 AND `row_version` >= 1",
        },
        name: "deletion_tombstones_positive_ck",
      },
    ],
    columns: [
      idColumn(),
      idColumn("deletion_job_id"),
      varcharColumn("tenant_id", 255),
      idColumn("knowledge_space_id"),
      varcharColumn("target_type", 32),
      idColumn("target_id"),
      integerColumn("target_revision"),
      varcharColumn("state", 16),
      integerColumn("row_version"),
      timestampColumn("created_at"),
      timestampColumn("completed_at", true),
    ],
  },
  {
    name: "deletion_job_items",
    checkConstraints: [
      {
        expression: {
          postgres:
            "\"kind\" IN ('object', 'secret_ref', 'cache_key', 'document_cascade', 'document_detach')",
          tidb: "`kind` IN ('object', 'secret_ref', 'cache_key', 'document_cascade', 'document_detach')",
        },
        name: "deletion_job_items_kind_ck",
      },
      {
        expression: {
          postgres: "\"status\" IN ('pending', 'retry_wait', 'completed', 'dead')",
          tidb: "`status` IN ('pending', 'retry_wait', 'completed', 'dead')",
        },
        name: "deletion_job_items_status_ck",
      },
      {
        expression: {
          postgres:
            '"ordinal" >= 0 AND "attempts" >= 0 AND "max_attempts" >= 1 AND "attempts" <= "max_attempts" AND "row_version" >= 1',
          tidb: "`ordinal` >= 0 AND `attempts` >= 0 AND `max_attempts` >= 1 AND `attempts` <= `max_attempts` AND `row_version` >= 1",
        },
        name: "deletion_job_items_positive_ck",
      },
      {
        expression: {
          postgres:
            '(("status" = \'retry_wait\' AND "next_attempt_at" IS NOT NULL) OR ("status" <> \'retry_wait\' AND "next_attempt_at" IS NULL))',
          tidb: "((`status` = 'retry_wait' AND `next_attempt_at` IS NOT NULL) OR (`status` <> 'retry_wait' AND `next_attempt_at` IS NULL))",
        },
        name: "deletion_job_items_retry_ck",
      },
      {
        expression: {
          postgres:
            "((\"status\" IN ('completed', 'dead') AND \"completed_at\" IS NOT NULL) OR (\"status\" IN ('pending', 'retry_wait') AND \"completed_at\" IS NULL))",
          tidb: "((`status` IN ('completed', 'dead') AND `completed_at` IS NOT NULL) OR (`status` IN ('pending', 'retry_wait') AND `completed_at` IS NULL))",
        },
        name: "deletion_job_items_terminal_ck",
      },
      {
        expression: {
          postgres:
            '(("kind" = \'object\' AND "credential_ref" IS NULL AND "cache_key" IS NULL AND (("status" = \'completed\' AND "object_key" IS NULL AND "redacted_at" IS NOT NULL) OR ("status" <> \'completed\' AND "object_key" IS NOT NULL AND "redacted_at" IS NULL))) OR ("kind" = \'secret_ref\' AND "object_key" IS NULL AND "cache_key" IS NULL AND (("status" = \'completed\' AND "credential_ref" IS NULL AND "redacted_at" IS NOT NULL) OR ("status" <> \'completed\' AND "credential_ref" IS NOT NULL AND "redacted_at" IS NULL))) OR ("kind" = \'cache_key\' AND "object_key" IS NULL AND "credential_ref" IS NULL AND (("status" = \'completed\' AND "cache_key" IS NULL AND "redacted_at" IS NOT NULL) OR ("status" <> \'completed\' AND "cache_key" IS NOT NULL AND "redacted_at" IS NULL))) OR ("kind" IN (\'document_cascade\', \'document_detach\') AND "resource_id" IS NOT NULL AND "object_key" IS NULL AND "credential_ref" IS NULL AND "cache_key" IS NULL AND "redacted_at" IS NULL))',
          tidb: "((`kind` = 'object' AND `credential_ref` IS NULL AND `cache_key` IS NULL AND ((`status` = 'completed' AND `object_key` IS NULL AND `redacted_at` IS NOT NULL) OR (`status` <> 'completed' AND `object_key` IS NOT NULL AND `redacted_at` IS NULL))) OR (`kind` = 'secret_ref' AND `object_key` IS NULL AND `cache_key` IS NULL AND ((`status` = 'completed' AND `credential_ref` IS NULL AND `redacted_at` IS NOT NULL) OR (`status` <> 'completed' AND `credential_ref` IS NOT NULL AND `redacted_at` IS NULL))) OR (`kind` = 'cache_key' AND `object_key` IS NULL AND `credential_ref` IS NULL AND ((`status` = 'completed' AND `cache_key` IS NULL AND `redacted_at` IS NOT NULL) OR (`status` <> 'completed' AND `cache_key` IS NOT NULL AND `redacted_at` IS NULL))) OR (`kind` IN ('document_cascade', 'document_detach') AND `resource_id` IS NOT NULL AND `object_key` IS NULL AND `credential_ref` IS NULL AND `cache_key` IS NULL AND `redacted_at` IS NULL))",
        },
        name: "deletion_job_items_payload_ck",
      },
    ],
    foreignKeys: [
      {
        columns: ["deletion_job_id"],
        onDelete: "CASCADE",
        referencedColumns: ["id"],
        referencedTable: "deletion_jobs",
      },
    ],
    columns: [
      idColumn(),
      idColumn("deletion_job_id"),
      bigintColumn("ordinal"),
      varcharColumn("kind", 32),
      idColumn("resource_id", true),
      textColumn("object_key", true),
      {
        name: "credential_ref",
        nullable: true,
        type: { postgres: "TEXT", tidb: "VARCHAR(255)" },
      },
      textColumn("cache_key", true),
      varcharColumn("payload_digest", 64),
      varcharColumn("idempotency_key", 512),
      varcharColumn("status", 16),
      integerColumn("attempts"),
      integerColumn("max_attempts"),
      timestampColumn("next_attempt_at", true),
      varcharColumn("last_error_code", 64, true),
      textColumn("last_error_message", true),
      integerColumn("row_version"),
      timestampColumn("created_at"),
      timestampColumn("updated_at"),
      timestampColumn("completed_at", true),
      timestampColumn("redacted_at", true),
    ],
  },
  {
    name: "deletion_outbox",
    checkConstraints: [
      {
        expression: {
          postgres: "\"event_type\" = 'deletion.job'",
          tidb: "`event_type` = 'deletion.job'",
        },
        name: "deletion_outbox_event_ck",
      },
      {
        expression: { postgres: '"schema_version" = 1', tidb: "`schema_version` = 1" },
        name: "deletion_outbox_schema_ck",
      },
      {
        expression: {
          postgres:
            "\"status\" IN ('pending', 'dispatching', 'dispatched', 'leased', 'completed', 'canceled', 'dead')",
          tidb: "`status` IN ('pending', 'dispatching', 'dispatched', 'leased', 'completed', 'canceled', 'dead')",
        },
        name: "deletion_outbox_status_ck",
      },
      {
        expression: {
          postgres: '"delivery_revision" >= 1 AND "dispatch_attempts" >= 0',
          tidb: "`delivery_revision` >= 1 AND `dispatch_attempts` >= 0",
        },
        name: "deletion_outbox_positive_ck",
      },
      {
        expression: {
          postgres:
            '(("lock_token" IS NULL AND "locked_by" IS NULL AND "locked_until" IS NULL) OR ("lock_token" IS NOT NULL AND "locked_by" IS NOT NULL AND "locked_until" IS NOT NULL))',
          tidb: "((`lock_token` IS NULL AND `locked_by` IS NULL AND `locked_until` IS NULL) OR (`lock_token` IS NOT NULL AND `locked_by` IS NOT NULL AND `locked_until` IS NOT NULL))",
        },
        name: "deletion_outbox_lock_ck",
      },
    ],
    foreignKeys: [
      {
        columns: ["deletion_job_id"],
        onDelete: "CASCADE",
        referencedColumns: ["id"],
        referencedTable: "deletion_jobs",
      },
    ],
    columns: [
      idColumn(),
      idColumn("deletion_job_id"),
      integerColumn("delivery_revision"),
      varcharColumn("event_type", 32),
      integerColumn("schema_version"),
      varcharColumn("idempotency_key", 512),
      varcharColumn("request_idempotency_key", 512),
      varcharColumn("request_fingerprint", 64),
      jsonColumn("payload"),
      varcharColumn("status", 16),
      timestampColumn("available_at"),
      integerColumn("dispatch_attempts"),
      varcharColumn("locked_by", 255, true),
      timestampColumn("locked_until", true),
      idColumn("lock_token", true),
      varcharColumn("queue_job_id", 255, true),
      textColumn("last_error", true),
      timestampColumn("delivered_at", true),
      timestampColumn("created_at"),
      timestampColumn("updated_at"),
    ],
  },
  {
    name: "deletion_retry_audits",
    checkConstraints: [
      {
        expression: {
          postgres: "\"retry_authority\" IN ('original_requester', 'interactive_owner_rescue')",
          tidb: "`retry_authority` IN ('original_requester', 'interactive_owner_rescue')",
        },
        name: "deletion_retry_audits_authority_ck",
      },
      {
        expression: {
          postgres: "\"access_channel\" IN ('interactive', 'service_api', 'mcp', 'agent')",
          tidb: "`access_channel` IN ('interactive', 'service_api', 'mcp', 'agent')",
        },
        name: "deletion_retry_audits_access_channel_ck",
      },
      {
        expression: {
          postgres: '"permission_snapshot_revision" >= 1',
          tidb: "`permission_snapshot_revision` >= 1",
        },
        name: "deletion_retry_audits_positive_ck",
      },
      {
        expression: {
          postgres:
            '(("api_key_id" IS NULL AND "api_key_revision" IS NULL AND "api_key_expires_at" IS NULL) OR ("api_key_id" IS NOT NULL AND "api_key_revision" >= 1 AND "access_channel" = \'service_api\'))',
          tidb: "((`api_key_id` IS NULL AND `api_key_revision` IS NULL AND `api_key_expires_at` IS NULL) OR (`api_key_id` IS NOT NULL AND `api_key_revision` >= 1 AND `access_channel` = 'service_api'))",
        },
        name: "deletion_retry_audits_api_key_binding_ck",
      },
      {
        expression: {
          postgres:
            '("retry_authority" <> \'interactive_owner_rescue\' OR ("access_channel" = \'interactive\' AND "api_key_id" IS NULL AND "api_key_revision" IS NULL AND "api_key_expires_at" IS NULL))',
          tidb: "(`retry_authority` <> 'interactive_owner_rescue' OR (`access_channel` = 'interactive' AND `api_key_id` IS NULL AND `api_key_revision` IS NULL AND `api_key_expires_at` IS NULL))",
        },
        name: "deletion_retry_audits_owner_rescue_ck",
      },
    ],
    foreignKeys: [
      {
        columns: ["deletion_job_id"],
        onDelete: "CASCADE",
        referencedColumns: ["id"],
        referencedTable: "deletion_jobs",
      },
    ],
    columns: [
      idColumn(),
      idColumn("deletion_job_id"),
      idColumn("outbox_id"),
      varcharColumn("tenant_id", 255),
      idColumn("knowledge_space_id"),
      varcharColumn("retry_authority", 32),
      varcharColumn("actor_subject_id", 255),
      idColumn("permission_snapshot_id"),
      integerColumn("permission_snapshot_revision"),
      varcharColumn("access_channel", 16),
      idColumn("api_key_id", true),
      integerColumn("api_key_revision", true),
      timestampColumn("api_key_expires_at", true),
      varcharColumn("request_idempotency_key", 512),
      varcharColumn("request_fingerprint", 64),
      timestampColumn("created_at"),
    ],
  },
  {
    name: "legacy_space_publication_bootstraps",
    checkConstraints: [
      {
        expression: {
          postgres:
            "\"checkpoint\" IN ('pending_snapshot', 'snapshot_captured', 'rebuilding', 'verifying', 'published')",
          tidb: "`checkpoint` IN ('pending_snapshot', 'snapshot_captured', 'rebuilding', 'verifying', 'published')",
        },
        name: "legacy_space_bootstraps_checkpoint_ck",
      },
      {
        expression: {
          postgres: "\"run_state\" IN ('queued', 'running', 'succeeded', 'failed', 'canceled')",
          tidb: "`run_state` IN ('queued', 'running', 'succeeded', 'failed', 'canceled')",
        },
        name: "legacy_space_bootstraps_run_state_ck",
      },
      {
        expression: {
          postgres:
            '"total_documents" >= 0 AND "completed_documents" >= 0 AND "completed_documents" <= "total_documents"',
          tidb: "`total_documents` >= 0 AND `completed_documents` >= 0 AND `completed_documents` <= `total_documents`",
        },
        name: "legacy_space_bootstraps_counts_ck",
      },
      {
        expression: {
          postgres: '"row_version" >= 0',
          tidb: "`row_version` >= 0",
        },
        name: "legacy_space_bootstraps_row_version_ck",
      },
      {
        expression: {
          postgres:
            '(("run_state" = \'running\' AND "worker_id" IS NOT NULL AND "lease_token" IS NOT NULL AND "lease_expires_at" IS NOT NULL AND "heartbeat_at" IS NOT NULL AND "completed_at" IS NULL) OR ("run_state" <> \'running\' AND "worker_id" IS NULL AND "lease_token" IS NULL AND "lease_expires_at" IS NULL AND "heartbeat_at" IS NULL))',
          tidb: "((`run_state` = 'running' AND `worker_id` IS NOT NULL AND `lease_token` IS NOT NULL AND `lease_expires_at` IS NOT NULL AND `heartbeat_at` IS NOT NULL AND `completed_at` IS NULL) OR (`run_state` <> 'running' AND `worker_id` IS NULL AND `lease_token` IS NULL AND `lease_expires_at` IS NULL AND `heartbeat_at` IS NULL))",
        },
        name: "legacy_space_bootstraps_lease_state_ck",
      },
      {
        expression: {
          postgres:
            "((\"run_state\" IN ('succeeded', 'failed', 'canceled') AND \"completed_at\" IS NOT NULL) OR (\"run_state\" IN ('queued', 'running') AND \"completed_at\" IS NULL))",
          tidb: "((`run_state` IN ('succeeded', 'failed', 'canceled') AND `completed_at` IS NOT NULL) OR (`run_state` IN ('queued', 'running') AND `completed_at` IS NULL))",
        },
        name: "legacy_space_bootstraps_terminal_ck",
      },
      {
        dialects: ["postgres"],
        expression: {
          postgres:
            '(("run_state" = \'succeeded\' AND "checkpoint" = \'published\' AND "completed_documents" = "total_documents" AND ("total_documents" = 0 OR ("published_publication_id" IS NOT NULL AND "published_fingerprint" IS NOT NULL AND "published_head_revision" IS NOT NULL AND "published_head_revision" > 0))) OR "run_state" <> \'succeeded\')',
          tidb: "((`run_state` = 'succeeded' AND `checkpoint` = 'published' AND `completed_documents` = `total_documents` AND (`total_documents` = 0 OR (`published_publication_id` IS NOT NULL AND `published_fingerprint` IS NOT NULL AND `published_head_revision` IS NOT NULL AND `published_head_revision` > 0))) OR `run_state` <> 'succeeded')",
        },
        name: "legacy_space_bootstraps_publication_ck",
      },
      nonzeroUuidCheck("legacy_space_bootstraps_lease_token_ck", "lease_token", true),
    ],
    foreignKeys: [
      {
        columns: ["tenant_id", "knowledge_space_id"],
        onDelete: "CASCADE",
        referencedColumns: ["tenant_id", "id"],
        referencedTable: "knowledge_spaces",
      },
      {
        columns: [
          "tenant_id",
          "knowledge_space_id",
          "published_publication_id",
          "published_fingerprint",
        ],
        onDelete: "RESTRICT",
        referencedColumns: ["tenant_id", "knowledge_space_id", "id", "fingerprint"],
        referencedTable: "projection_set_publications",
      },
    ],
    columns: [
      idColumn(),
      varcharColumn("tenant_id", 255),
      idColumn("knowledge_space_id"),
      varcharColumn("idempotency_key", 255),
      varcharColumn("checkpoint", 32),
      varcharColumn("run_state", 16),
      integerColumn("total_documents"),
      integerColumn("completed_documents"),
      varcharColumn("worker_id", 255, true),
      idColumn("lease_token", true),
      timestampColumn("lease_expires_at", true),
      timestampColumn("heartbeat_at", true),
      varcharColumn("last_error_code", 64, true),
      textColumn("last_error_message", true),
      integerColumn("row_version"),
      idColumn("published_publication_id", true),
      varcharColumn("published_fingerprint", 86, true),
      integerColumn("published_head_revision", true),
      jsonColumn("snapshot_metadata"),
      timestampColumn("created_at"),
      timestampColumn("updated_at"),
      timestampColumn("completed_at", true),
    ],
  },
  {
    name: "legacy_space_publication_bootstrap_items",
    checkConstraints: [
      {
        expression: { postgres: '"document_version" > 0', tidb: "`document_version` > 0" },
        name: "legacy_space_bootstrap_items_version_ck",
      },
      {
        expression: { postgres: '"ordinal" >= 0', tidb: "`ordinal` >= 0" },
        name: "legacy_space_bootstrap_items_ordinal_ck",
      },
      {
        expression: {
          postgres: "\"status\" IN ('pending', 'running', 'succeeded', 'failed')",
          tidb: "`status` IN ('pending', 'running', 'succeeded', 'failed')",
        },
        name: "legacy_space_bootstrap_items_status_ck",
      },
    ],
    foreignKeys: [
      {
        columns: ["bootstrap_id"],
        onDelete: "CASCADE",
        referencedColumns: ["id"],
        referencedTable: "legacy_space_publication_bootstraps",
      },
    ],
    columns: [
      { ...idColumn("bootstrap_id"), primaryKey: true },
      { ...idColumn("document_asset_id"), primaryKey: true },
      integerColumn("document_version"),
      varcharColumn("document_sha256", 64),
      integerColumn("ordinal"),
      idColumn("compilation_attempt_id", true),
      varcharColumn("status", 16),
      textColumn("last_error", true),
      timestampColumn("created_at"),
      timestampColumn("updated_at"),
    ],
  },
  {
    name: "knowledge_space_mutation_leases",
    foreignKeys: [
      {
        columns: ["tenant_id", "knowledge_space_id"],
        onDelete: "CASCADE",
        referencedColumns: ["tenant_id", "id"],
        referencedTable: "knowledge_spaces",
      },
    ],
    columns: [
      idColumn(),
      varcharColumn("tenant_id", 255),
      idColumn("knowledge_space_id"),
      varcharColumn("operation", 64),
      timestampColumn("acquired_at"),
      // Nullable during rolling upgrade: old writers may still insert the pre-0017 shape. New
      // readers treat any NULL lease metadata as expired and reclaim it under the space lock.
      idColumn("lease_token", true),
      timestampColumn("heartbeat_at", true),
      timestampColumn("expires_at", true),
    ],
  },
  {
    name: "page_index_upgrade_backfills",
    checkConstraints: [
      {
        expression: {
          postgres: "\"run_state\" IN ('queued', 'running', 'succeeded', 'failed', 'superseded')",
          tidb: "`run_state` IN ('queued', 'running', 'succeeded', 'failed', 'superseded')",
        },
        name: "page_index_upgrade_backfills_state_ck",
      },
      {
        expression: {
          postgres:
            '"total_items" >= 0 AND "completed_items" >= 0 AND "completed_items" <= "total_items"',
          tidb: "`total_items` >= 0 AND `completed_items` >= 0 AND `completed_items` <= `total_items`",
        },
        name: "page_index_upgrade_backfills_counts_ck",
      },
      {
        expression: { postgres: '"head_revision" > 0', tidb: "`head_revision` > 0" },
        name: "page_index_upgrade_backfills_revision_ck",
      },
      {
        expression: {
          postgres: '"retry_count" >= 0 AND "row_version" >= 0',
          tidb: "`retry_count` >= 0 AND `row_version` >= 0",
        },
        name: "page_index_upgrade_backfills_versions_ck",
      },
      {
        expression: {
          postgres:
            '(("run_state" = \'running\' AND "worker_id" IS NOT NULL AND "lease_token" IS NOT NULL AND "lease_expires_at" IS NOT NULL AND "heartbeat_at" IS NOT NULL AND "completed_at" IS NULL) OR ("run_state" <> \'running\' AND "worker_id" IS NULL AND "lease_token" IS NULL AND "lease_expires_at" IS NULL AND "heartbeat_at" IS NULL))',
          tidb: "((`run_state` = 'running' AND `worker_id` IS NOT NULL AND `lease_token` IS NOT NULL AND `lease_expires_at` IS NOT NULL AND `heartbeat_at` IS NOT NULL AND `completed_at` IS NULL) OR (`run_state` <> 'running' AND `worker_id` IS NULL AND `lease_token` IS NULL AND `lease_expires_at` IS NULL AND `heartbeat_at` IS NULL))",
        },
        name: "page_index_upgrade_backfills_lease_ck",
      },
      {
        expression: {
          postgres:
            "((\"run_state\" IN ('succeeded', 'failed', 'superseded') AND \"completed_at\" IS NOT NULL) OR (\"run_state\" IN ('queued', 'running') AND \"completed_at\" IS NULL))",
          tidb: "((`run_state` IN ('succeeded', 'failed', 'superseded') AND `completed_at` IS NOT NULL) OR (`run_state` IN ('queued', 'running') AND `completed_at` IS NULL))",
        },
        name: "page_index_upgrade_backfills_terminal_ck",
      },
      nonzeroUuidCheck("page_index_upgrade_backfills_lease_token_ck", "lease_token", true),
    ],
    foreignKeys: [
      {
        columns: ["tenant_id", "knowledge_space_id"],
        onDelete: "CASCADE",
        referencedColumns: ["tenant_id", "id"],
        referencedTable: "knowledge_spaces",
      },
      {
        columns: ["tenant_id", "knowledge_space_id", "publication_id", "publication_fingerprint"],
        onDelete: "RESTRICT",
        referencedColumns: ["tenant_id", "knowledge_space_id", "id", "fingerprint"],
        referencedTable: "projection_set_publications",
      },
    ],
    columns: [
      idColumn(),
      varcharColumn("tenant_id", 255),
      idColumn("knowledge_space_id"),
      idColumn("publication_id"),
      varcharColumn("publication_fingerprint", 86),
      integerColumn("head_revision"),
      varcharColumn("run_state", 16),
      integerColumn("total_items"),
      integerColumn("completed_items"),
      varcharColumn("worker_id", 255, true),
      idColumn("lease_token", true),
      timestampColumn("lease_expires_at", true),
      timestampColumn("heartbeat_at", true),
      integerColumn("retry_count"),
      integerColumn("row_version"),
      varcharColumn("last_error_code", 64, true),
      textColumn("last_error_message", true),
      timestampColumn("created_at"),
      timestampColumn("updated_at"),
      timestampColumn("completed_at", true),
    ],
  },
  {
    name: "page_index_upgrade_backfill_items",
    checkConstraints: [
      publicationGenerationCheck(
        "page_index_upgrade_items_generation_ck",
        "publication_generation_id",
        false,
      ),
      {
        expression: { postgres: '"document_version" > 0', tidb: "`document_version` > 0" },
        name: "page_index_upgrade_items_version_ck",
      },
      {
        expression: { postgres: '"ordinal" >= 0', tidb: "`ordinal` >= 0" },
        name: "page_index_upgrade_items_ordinal_ck",
      },
      {
        expression: {
          postgres: "\"status\" IN ('pending', 'succeeded')",
          tidb: "`status` IN ('pending', 'succeeded')",
        },
        name: "page_index_upgrade_items_status_ck",
      },
    ],
    foreignKeys: [
      {
        columns: ["backfill_id"],
        onDelete: "CASCADE",
        referencedColumns: ["id"],
        referencedTable: "page_index_upgrade_backfills",
      },
    ],
    columns: [
      { ...idColumn("backfill_id"), primaryKey: true },
      { ...idColumn("document_outline_id"), primaryKey: true },
      idColumn("publication_generation_id"),
      idColumn("document_asset_id"),
      integerColumn("document_version"),
      integerColumn("ordinal"),
      varcharColumn("status", 16),
      timestampColumn("created_at"),
      timestampColumn("updated_at"),
    ],
  },
  {
    name: "embedding_models",
    columns: [
      idColumn(),
      varcharColumn("provider", 64),
      varcharColumn("model_id", 255),
      varcharColumn("version", 128),
      integerColumn("dimension"),
      textColumn("metric"),
      textColumn("tokenizer"),
      integerColumn("max_tokens"),
      varcharColumn("status", 16),
      jsonColumn("metadata"),
      timestampColumn("created_at"),
      timestampColumn("updated_at"),
    ],
  },
  {
    name: "knowledge_paths",
    checkConstraints: [
      publicationGenerationCheck(
        "knowledge_paths_pub_gen_nonzero_ck",
        "publication_generation_id",
        true,
      ),
    ],
    foreignKeys: [
      {
        columns: ["knowledge_space_id"],
        onDelete: "CASCADE",
        referencedColumns: ["id"],
        referencedTable: "knowledge_spaces",
      },
    ],
    columns: [
      idColumn(),
      idColumn("knowledge_space_id"),
      idColumn("publication_generation_id", true),
      varcharColumn("virtual_path", 384),
      varcharColumn("resource_type", 64),
      varcharColumn("target_id", 512),
      integerColumn("version", true),
      varcharColumn("view_type", 16),
      varcharColumn("view_name", 64),
      jsonColumn("metadata"),
      timestampColumn("updated_at", true),
      tidbGeneratedColumn(
        "publication_generation_key",
        "CHAR(36)",
        `COALESCE(\`publication_generation_id\`, '${PUBLICATION_GENERATION_ID_SENTINEL}')`,
      ),
    ],
  },
  {
    name: "evidence_bundles",
    checkConstraints: [
      {
        expression: {
          postgres:
            '("tenant_id" IS NULL AND "knowledge_space_id" IS NULL) OR ("tenant_id" IS NOT NULL AND "knowledge_space_id" IS NOT NULL)',
          tidb: "(`tenant_id` IS NULL AND `knowledge_space_id` IS NULL) OR (`tenant_id` IS NOT NULL AND `knowledge_space_id` IS NOT NULL)",
        },
        name: "evidence_bundles_scope_pair_ck",
      },
    ],
    foreignKeys: [
      {
        columns: ["tenant_id", "knowledge_space_id"],
        onDelete: "CASCADE",
        referencedColumns: ["tenant_id", "id"],
        referencedTable: "knowledge_spaces",
      },
    ],
    columns: [
      idColumn(),
      // Nullable only for the 0017 rolling backfill window. New writers always set both columns,
      // and public reads fail closed for an unscoped legacy row.
      varcharColumn("tenant_id", 255, true),
      idColumn("knowledge_space_id", true),
      idColumn("trace_id", true),
      textColumn("query"),
      varcharColumn("state", 16),
      jsonColumn("items"),
      jsonColumn("missing_evidence"),
      timestampColumn("created_at"),
      timestampColumn("updated_at", true),
    ],
  },
  {
    name: "golden_questions",
    checkConstraints: [
      {
        expression: {
          postgres:
            '("tenant_id" IS NULL AND "required_permission_scope" IS NULL) OR ("tenant_id" IS NOT NULL AND "required_permission_scope" IS NOT NULL AND jsonb_typeof("required_permission_scope") = \'array\')',
          tidb: "`scope_binding_complete` = 1",
        },
        name: "golden_questions_scope_json_ck",
      },
    ],
    foreignKeys: [
      {
        columns: ["tenant_id", "knowledge_space_id"],
        onDelete: "CASCADE",
        referencedColumns: ["tenant_id", "id"],
        referencedTable: "knowledge_spaces",
      },
    ],
    columns: [
      idColumn(),
      varcharColumn("tenant_id", 255, true),
      idColumn("knowledge_space_id"),
      textColumn("question"),
      jsonColumn("expected_evidence_ids"),
      jsonColumn("tags"),
      jsonColumn("metadata"),
      jsonColumn("required_permission_scope", true),
      timestampColumn("created_at"),
      timestampColumn("updated_at"),
      tidbGeneratedColumn(
        "scope_binding_complete",
        "TINYINT",
        "CASE WHEN (`tenant_id` IS NULL AND `required_permission_scope` IS NULL) OR (`tenant_id` IS NOT NULL AND `required_permission_scope` IS NOT NULL AND JSON_TYPE(`required_permission_scope`) = 'ARRAY') THEN 1 ELSE 0 END",
      ),
    ],
  },
  {
    name: "answer_traces",
    checkConstraints: [
      {
        expression: {
          postgres: `("permission_snapshot_id" IS NULL AND "permission_snapshot_revision" IS NULL AND "access_channel" IS NULL) OR ("subject_id" IS NOT NULL AND "permission_snapshot_id" IS NOT NULL AND "permission_snapshot_revision" >= 1 AND "access_channel" IN ('interactive', 'service_api', 'mcp', 'agent'))`,
          tidb: "(`permission_snapshot_id` IS NULL AND `permission_snapshot_revision` IS NULL AND `access_channel` IS NULL) OR (`subject_id` IS NOT NULL AND `permission_snapshot_id` IS NOT NULL AND `permission_snapshot_revision` >= 1 AND `access_channel` IN ('interactive', 'service_api', 'mcp', 'agent'))",
        },
        name: "answer_traces_permission_snapshot_binding_ck",
      },
    ],
    foreignKeys: [
      {
        columns: ["knowledge_space_id"],
        onDelete: "CASCADE",
        referencedColumns: ["id"],
        referencedTable: "knowledge_spaces",
      },
      {
        columns: ["evidence_bundle_id"],
        onDelete: "SET NULL",
        referencedColumns: ["id"],
        referencedTable: "evidence_bundles",
      },
      {
        columns: ["knowledge_space_id", "permission_snapshot_id", "subject_id", "access_channel"],
        onDelete: "RESTRICT",
        referencedColumns: ["knowledge_space_id", "id", "subject_id", "access_channel"],
        referencedTable: "knowledge_space_permission_snapshots",
      },
    ],
    columns: [
      idColumn(),
      idColumn("knowledge_space_id"),
      idColumn("evidence_bundle_id", true),
      textColumn("query"),
      textColumn("mode"),
      varcharColumn("subject_id", 255, true),
      idColumn("permission_snapshot_id", true),
      integerColumn("permission_snapshot_revision", true),
      varcharColumn("access_channel", 16, true),
      boolColumn("completed"),
      timestampColumn("created_at"),
    ],
  },
  {
    name: "answer_trace_steps",
    foreignKeys: [
      {
        columns: ["trace_id"],
        onDelete: "CASCADE",
        referencedColumns: ["id"],
        referencedTable: "answer_traces",
      },
    ],
    columns: [
      idColumn(),
      idColumn("trace_id"),
      varcharColumn("name", 64),
      varcharColumn("status", 16),
      jsonColumn("metadata"),
      timestampColumn("started_at"),
      timestampColumn("ended_at"),
      timestampColumn("updated_at", true),
    ],
  },
  {
    name: "graph_entities",
    checkConstraints: [
      publicationGenerationCheck(
        "graph_entities_pub_gen_nonzero_ck",
        "publication_generation_id",
        true,
      ),
    ],
    foreignKeys: [
      {
        columns: ["knowledge_space_id"],
        onDelete: "CASCADE",
        referencedColumns: ["id"],
        referencedTable: "knowledge_spaces",
      },
    ],
    columns: [
      idColumn(),
      idColumn("knowledge_space_id"),
      idColumn("publication_generation_id", true),
      varcharColumn("canonical_key", 512),
      varcharColumn("type", 64),
      varcharColumn("name", 255),
      jsonColumn("aliases"),
      doubleColumn("confidence"),
      jsonColumn("source_node_ids"),
      jsonColumn("permission_scope"),
      jsonColumn("metadata"),
      integerColumn("extraction_version"),
      timestampColumn("created_at"),
      timestampColumn("updated_at"),
      tidbGeneratedColumn(
        "publication_generation_key",
        "CHAR(36)",
        `COALESCE(\`publication_generation_id\`, '${PUBLICATION_GENERATION_ID_SENTINEL}')`,
      ),
    ],
  },
  {
    name: "graph_relations",
    checkConstraints: [
      publicationGenerationCheck(
        "graph_relations_pub_gen_nonzero_ck",
        "publication_generation_id",
        true,
      ),
    ],
    foreignKeys: [
      {
        columns: ["knowledge_space_id"],
        onDelete: "CASCADE",
        referencedColumns: ["id"],
        referencedTable: "knowledge_spaces",
      },
      {
        columns: ["subject_entity_id"],
        onDelete: "CASCADE",
        referencedColumns: ["id"],
        referencedTable: "graph_entities",
      },
      {
        columns: ["object_entity_id"],
        onDelete: "CASCADE",
        referencedColumns: ["id"],
        referencedTable: "graph_entities",
      },
    ],
    columns: [
      idColumn(),
      idColumn("knowledge_space_id"),
      idColumn("publication_generation_id", true),
      idColumn("subject_entity_id"),
      idColumn("object_entity_id"),
      varcharColumn("type", 64),
      doubleColumn("confidence"),
      jsonColumn("source_node_ids"),
      jsonColumn("permission_scope"),
      jsonColumn("metadata"),
      integerColumn("extraction_version"),
      timestampColumn("created_at"),
      timestampColumn("updated_at"),
      tidbGeneratedColumn(
        "publication_generation_key",
        "CHAR(36)",
        `COALESCE(\`publication_generation_id\`, '${PUBLICATION_GENERATION_ID_SENTINEL}')`,
      ),
    ],
  },
  {
    name: "failed_queries",
    checkConstraints: [
      {
        expression: {
          postgres: `(("tenant_id" IS NULL AND "requested_by_subject_id" IS NULL AND "access_channel" IS NULL AND "permission_snapshot_id" IS NULL AND "permission_snapshot_revision" IS NULL AND "required_permission_scope" IS NULL AND "revision" IS NULL) OR ("tenant_id" IS NOT NULL AND "requested_by_subject_id" IS NOT NULL AND "access_channel" IS NOT NULL AND "access_channel" IN ('interactive', 'service_api', 'mcp', 'agent') AND "permission_snapshot_id" IS NOT NULL AND "permission_snapshot_revision" IS NOT NULL AND "permission_snapshot_revision" >= 1 AND "required_permission_scope" IS NOT NULL AND jsonb_typeof("required_permission_scope") = 'array' AND "revision" IS NOT NULL AND "revision" >= 1))`,
          tidb: "`permission_binding_complete` = 1",
        },
        name: "failed_queries_permission_binding_ck",
      },
    ],
    foreignKeys: [
      {
        columns: ["knowledge_space_id"],
        onDelete: "CASCADE",
        referencedColumns: ["id"],
        referencedTable: "knowledge_spaces",
      },
      {
        columns: ["tenant_id", "knowledge_space_id"],
        onDelete: "CASCADE",
        referencedColumns: ["tenant_id", "id"],
        referencedTable: "knowledge_spaces",
      },
      {
        columns: [
          "tenant_id",
          "knowledge_space_id",
          "permission_snapshot_id",
          "requested_by_subject_id",
          "access_channel",
        ],
        onDelete: "RESTRICT",
        referencedColumns: [
          "tenant_id",
          "knowledge_space_id",
          "id",
          "subject_id",
          "access_channel",
        ],
        referencedTable: "knowledge_space_permission_snapshots",
      },
    ],
    columns: [
      idColumn(),
      varcharColumn("tenant_id", 255, true),
      idColumn("knowledge_space_id"),
      idColumn("answer_trace_id", true),
      textColumn("query"),
      textColumn("mode"),
      textColumn("trigger"),
      textColumn("status"),
      jsonColumn("metadata"),
      varcharColumn("requested_by_subject_id", 255, true),
      varcharColumn("access_channel", 16, true),
      idColumn("permission_snapshot_id", true),
      integerColumn("permission_snapshot_revision", true),
      jsonColumn("required_permission_scope", true),
      integerColumn("revision", true),
      timestampColumn("created_at"),
      timestampColumn("updated_at"),
      tidbGeneratedColumn(
        "permission_binding_complete",
        "TINYINT",
        "CASE WHEN (`tenant_id` IS NULL AND `requested_by_subject_id` IS NULL AND `access_channel` IS NULL AND `permission_snapshot_id` IS NULL AND `permission_snapshot_revision` IS NULL AND `required_permission_scope` IS NULL AND `revision` IS NULL) OR (`tenant_id` IS NOT NULL AND `requested_by_subject_id` IS NOT NULL AND `access_channel` IS NOT NULL AND `access_channel` IN ('interactive', 'service_api', 'mcp', 'agent') AND `permission_snapshot_id` IS NOT NULL AND `permission_snapshot_revision` IS NOT NULL AND `permission_snapshot_revision` >= 1 AND `required_permission_scope` IS NOT NULL AND JSON_TYPE(`required_permission_scope`) = 'ARRAY' AND `revision` IS NOT NULL AND `revision` >= 1) THEN 1 ELSE 0 END",
      ),
    ],
  },
  {
    name: "quality_replay_runs",
    checkConstraints: [
      {
        expression: {
          postgres: `"mode" IN ('fast', 'research', 'deep') AND "state" IN ('queued', 'running', 'passed', 'failed', 'canceled')`,
          tidb: "`mode` IN ('fast', 'research', 'deep') AND `state` IN ('queued', 'running', 'passed', 'failed', 'canceled')",
        },
        name: "quality_replay_runs_state_ck",
      },
      {
        expression: {
          postgres: `(("state" = 'running' AND "lease_owner" IS NOT NULL AND "lease_token" IS NOT NULL AND "lease_expires_at" IS NOT NULL AND "completed_at" IS NULL) OR ("state" <> 'running' AND "lease_owner" IS NULL AND "lease_token" IS NULL AND "lease_expires_at" IS NULL))`,
          tidb: "((`state` = 'running' AND `lease_owner` IS NOT NULL AND `lease_token` IS NOT NULL AND `lease_expires_at` IS NOT NULL AND `completed_at` IS NULL) OR (`state` <> 'running' AND `lease_owner` IS NULL AND `lease_token` IS NULL AND `lease_expires_at` IS NULL))",
        },
        name: "quality_replay_runs_lease_ck",
      },
      {
        expression: {
          postgres: `(("state" IN ('passed', 'failed', 'canceled') AND "completed_at" IS NOT NULL) OR ("state" IN ('queued', 'running') AND "completed_at" IS NULL))`,
          tidb: "((`state` IN ('passed', 'failed', 'canceled') AND `completed_at` IS NOT NULL) OR (`state` IN ('queued', 'running') AND `completed_at` IS NULL))",
        },
        name: "quality_replay_runs_terminal_ck",
      },
      {
        expression: {
          postgres: `"revision" >= 1 AND "attempt" >= 0 AND "permission_snapshot_revision" >= 1 AND "request_fingerprint" ~ '^sha256:[a-f0-9]{64}$'`,
          tidb: "`revision` >= 1 AND `attempt` >= 0 AND `permission_snapshot_revision` >= 1 AND `request_fingerprint` REGEXP '^sha256:[a-f0-9]{64}$'",
        },
        name: "quality_replay_runs_revision_ck",
      },
    ],
    foreignKeys: [
      {
        columns: ["tenant_id", "knowledge_space_id"],
        onDelete: "CASCADE",
        referencedColumns: ["tenant_id", "id"],
        referencedTable: "knowledge_spaces",
      },
      {
        columns: [
          "knowledge_space_id",
          "permission_snapshot_id",
          "requested_by_subject_id",
          "access_channel",
        ],
        onDelete: "RESTRICT",
        referencedColumns: ["knowledge_space_id", "id", "subject_id", "access_channel"],
        referencedTable: "knowledge_space_permission_snapshots",
      },
    ],
    columns: [
      idColumn(),
      varcharColumn("tenant_id", 255),
      idColumn("knowledge_space_id"),
      varcharColumn("idempotency_key", 255),
      varcharColumn("request_fingerprint", 71),
      varcharColumn("mode", 16),
      varcharColumn("state", 16),
      varcharColumn("requested_by_subject_id", 255),
      varcharColumn("access_channel", 16),
      idColumn("permission_snapshot_id"),
      integerColumn("permission_snapshot_revision"),
      jsonColumn("required_permission_scope"),
      jsonColumn("frozen_snapshot"),
      integerColumn("revision"),
      integerColumn("attempt"),
      varcharColumn("lease_owner", 255, true),
      idColumn("lease_token", true),
      timestampColumn("lease_expires_at", true),
      textColumn("error_message", true),
      timestampColumn("started_at", true),
      timestampColumn("completed_at", true),
      timestampColumn("created_at"),
      timestampColumn("updated_at"),
    ],
  },
  {
    name: "quality_replay_items",
    checkConstraints: [
      {
        expression: {
          postgres: `"ordinal" >= 1 AND "state" IN ('queued', 'running', 'passed', 'failed', 'canceled')`,
          tidb: "`ordinal` >= 1 AND `state` IN ('queued', 'running', 'passed', 'failed', 'canceled')",
        },
        name: "quality_replay_items_state_ck",
      },
    ],
    foreignKeys: [
      {
        columns: ["run_id"],
        onDelete: "CASCADE",
        referencedColumns: ["id"],
        referencedTable: "quality_replay_runs",
      },
    ],
    columns: [
      idColumn(),
      idColumn("run_id"),
      idColumn("golden_question_id"),
      integerColumn("ordinal"),
      textColumn("question"),
      jsonColumn("expected_evidence_ids"),
      varcharColumn("state", 16),
      { ...jsonColumn("result"), nullable: true },
      idColumn("trace_id", true),
      timestampColumn("created_at"),
      timestampColumn("updated_at"),
    ],
  },
  {
    name: "quality_replay_outbox",
    checkConstraints: [
      {
        expression: {
          postgres: `"delivery_revision" >= 1 AND "delivery_state" IN ('pending', 'claimed', 'delivered') AND "attempt" >= 0 AND (("delivery_state" = 'claimed' AND "lease_owner" IS NOT NULL AND "lease_token" IS NOT NULL AND "lease_expires_at" IS NOT NULL AND "delivered_at" IS NULL) OR ("delivery_state" <> 'claimed' AND "lease_owner" IS NULL AND "lease_token" IS NULL AND "lease_expires_at" IS NULL)) AND (("delivery_state" = 'delivered' AND "delivered_at" IS NOT NULL) OR ("delivery_state" <> 'delivered' AND "delivered_at" IS NULL))`,
          tidb: "`delivery_revision` >= 1 AND `delivery_state` IN ('pending', 'claimed', 'delivered') AND `attempt` >= 0 AND ((`delivery_state` = 'claimed' AND `lease_owner` IS NOT NULL AND `lease_token` IS NOT NULL AND `lease_expires_at` IS NOT NULL AND `delivered_at` IS NULL) OR (`delivery_state` <> 'claimed' AND `lease_owner` IS NULL AND `lease_token` IS NULL AND `lease_expires_at` IS NULL)) AND ((`delivery_state` = 'delivered' AND `delivered_at` IS NOT NULL) OR (`delivery_state` <> 'delivered' AND `delivered_at` IS NULL))",
        },
        name: "quality_replay_outbox_state_ck",
      },
    ],
    foreignKeys: [
      {
        columns: ["run_id"],
        onDelete: "CASCADE",
        referencedColumns: ["id"],
        referencedTable: "quality_replay_runs",
      },
    ],
    columns: [
      idColumn(),
      idColumn("run_id"),
      integerColumn("delivery_revision"),
      varcharColumn("event_type", 64),
      varcharColumn("delivery_state", 16),
      integerColumn("attempt"),
      varcharColumn("lease_owner", 255, true),
      idColumn("lease_token", true),
      timestampColumn("lease_expires_at", true),
      timestampColumn("delivered_at", true),
      timestampColumn("created_at"),
      timestampColumn("updated_at"),
    ],
  },
  {
    name: "quality_bad_cases",
    checkConstraints: [
      {
        expression: {
          postgres: `"status" IN ('open', 'replaying', 'fixed', 'dismissed') AND "revision" >= 1 AND ("status" <> 'replaying' OR "replay_run_id" IS NOT NULL)`,
          tidb: "`status` IN ('open', 'replaying', 'fixed', 'dismissed') AND `revision` >= 1 AND (`status` <> 'replaying' OR `replay_run_id` IS NOT NULL)",
        },
        name: "quality_bad_cases_state_ck",
      },
    ],
    foreignKeys: [
      {
        columns: ["tenant_id", "knowledge_space_id"],
        onDelete: "CASCADE",
        referencedColumns: ["tenant_id", "id"],
        referencedTable: "knowledge_spaces",
      },
      {
        columns: ["knowledge_space_id", "trace_id"],
        onDelete: "CASCADE",
        referencedColumns: ["knowledge_space_id", "id"],
        referencedTable: "answer_traces",
      },
      {
        columns: ["tenant_id", "knowledge_space_id", "replay_run_id"],
        onDelete: "RESTRICT",
        referencedColumns: ["tenant_id", "knowledge_space_id", "id"],
        referencedTable: "quality_replay_runs",
      },
    ],
    columns: [
      idColumn(),
      varcharColumn("tenant_id", 255),
      idColumn("knowledge_space_id"),
      idColumn("trace_id"),
      varcharColumn("status", 16),
      textColumn("reason"),
      jsonColumn("tags"),
      idColumn("replay_run_id", true),
      varcharColumn("actor_subject_id", 255),
      integerColumn("revision"),
      jsonColumn("required_permission_scope"),
      timestampColumn("created_at"),
      timestampColumn("updated_at"),
    ],
  },
  {
    name: "quality_missing_evidence_reviews",
    checkConstraints: [
      {
        expression: {
          postgres: `"status" IN ('active', 'dismissed') AND "revision" >= 1 AND "item_key" ~ '^sha256:[a-f0-9]{64}$'`,
          tidb: "`status` IN ('active', 'dismissed') AND `revision` >= 1 AND `item_key` REGEXP '^sha256:[a-f0-9]{64}$'",
        },
        name: "quality_missing_evidence_reviews_state_ck",
      },
    ],
    foreignKeys: [
      {
        columns: ["tenant_id", "knowledge_space_id"],
        onDelete: "CASCADE",
        referencedColumns: ["tenant_id", "id"],
        referencedTable: "knowledge_spaces",
      },
      {
        columns: ["knowledge_space_id", "trace_id"],
        onDelete: "CASCADE",
        referencedColumns: ["knowledge_space_id", "id"],
        referencedTable: "answer_traces",
      },
    ],
    columns: [
      idColumn(),
      varcharColumn("tenant_id", 255),
      idColumn("knowledge_space_id"),
      idColumn("trace_id"),
      varcharColumn("item_key", 71),
      varcharColumn("status", 16),
      textColumn("reason", true),
      varcharColumn("actor_subject_id", 255),
      integerColumn("revision"),
      jsonColumn("required_permission_scope"),
      timestampColumn("created_at"),
      timestampColumn("updated_at"),
    ],
  },
  {
    name: "quality_resource_history",
    checkConstraints: [
      {
        expression: {
          postgres: `"aggregate_type" IN ('bad-case', 'missing-evidence') AND "revision" >= 1`,
          tidb: "`aggregate_type` IN ('bad-case', 'missing-evidence') AND `revision` >= 1",
        },
        name: "quality_resource_history_type_ck",
      },
    ],
    foreignKeys: [
      {
        columns: ["tenant_id", "knowledge_space_id"],
        onDelete: "CASCADE",
        referencedColumns: ["tenant_id", "id"],
        referencedTable: "knowledge_spaces",
      },
    ],
    columns: [
      idColumn(),
      varcharColumn("tenant_id", 255),
      idColumn("knowledge_space_id"),
      varcharColumn("aggregate_type", 32),
      idColumn("aggregate_id"),
      varcharColumn("action", 32),
      varcharColumn("actor_subject_id", 255),
      varcharColumn("from_status", 16, true),
      varcharColumn("to_status", 16),
      textColumn("reason", true),
      integerColumn("revision"),
      timestampColumn("created_at"),
    ],
  },
  {
    name: "document_outlines",
    checkConstraints: [
      publicationGenerationCheck(
        "document_outlines_pub_gen_nonzero_ck",
        "publication_generation_id",
        true,
      ),
    ],
    foreignKeys: [
      {
        columns: ["knowledge_space_id"],
        onDelete: "CASCADE",
        referencedColumns: ["id"],
        referencedTable: "knowledge_spaces",
      },
    ],
    columns: [
      idColumn(),
      idColumn("knowledge_space_id"),
      idColumn("publication_generation_id", true),
      idColumn("document_asset_id"),
      idColumn("parse_artifact_id"),
      textColumn("artifact_hash"),
      textColumn("outline_version"),
      integerColumn("version"),
      jsonColumn("nodes"),
      jsonColumn("metadata"),
      timestampColumn("created_at"),
      timestampColumn("updated_at", true),
      tidbGeneratedColumn(
        "publication_generation_key",
        "CHAR(36)",
        `COALESCE(\`publication_generation_id\`, '${PUBLICATION_GENERATION_ID_SENTINEL}')`,
      ),
    ],
  },
  {
    name: "page_index_manifests",
    checkConstraints: [
      publicationGenerationCheck(
        "page_index_manifests_generation_nonzero_ck",
        "publication_generation_id",
        false,
      ),
      {
        expression: {
          postgres: `"status" IN ('building', 'ready')`,
          tidb: "`status` IN ('building', 'ready')",
        },
        name: "page_index_manifests_status_ck",
      },
      {
        expression: {
          postgres: '"node_count" >= 0 AND "term_count" >= 0',
          tidb: "`node_count` >= 0 AND `term_count` >= 0",
        },
        name: "page_index_manifests_counts_ck",
      },
    ],
    foreignKeys: [
      {
        columns: ["knowledge_space_id"],
        onDelete: "CASCADE",
        referencedColumns: ["id"],
        referencedTable: "knowledge_spaces",
      },
      {
        columns: ["document_outline_id"],
        onDelete: "CASCADE",
        referencedColumns: ["id"],
        referencedTable: "document_outlines",
      },
    ],
    columns: [
      idColumn(),
      idColumn("knowledge_space_id"),
      idColumn("publication_generation_id"),
      idColumn("document_asset_id"),
      idColumn("document_outline_id"),
      integerColumn("document_version"),
      varcharColumn("tokenizer_version", 64),
      varcharColumn("status", 16),
      integerColumn("node_count"),
      integerColumn("term_count"),
      varcharColumn("checksum", 64),
      timestampColumn("created_at"),
      timestampColumn("updated_at"),
    ],
  },
  {
    name: "page_index_nodes",
    checkConstraints: [
      {
        expression: { postgres: '"level" > 0', tidb: "`level` > 0" },
        name: "page_index_nodes_level_ck",
      },
      {
        expression: {
          postgres:
            '"start_offset" IS NULL OR "end_offset" IS NULL OR "end_offset" >= "start_offset"',
          tidb: "`start_offset` IS NULL OR `end_offset` IS NULL OR `end_offset` >= `start_offset`",
        },
        name: "page_index_nodes_range_ck",
      },
    ],
    foreignKeys: [
      {
        columns: ["manifest_id"],
        onDelete: "CASCADE",
        referencedColumns: ["id"],
        referencedTable: "page_index_manifests",
      },
    ],
    columns: [
      idColumn(),
      idColumn("manifest_id"),
      varcharColumn("outline_node_id", 512),
      varcharColumn("parent_outline_node_id", 512, true),
      textColumn("title"),
      textColumn("summary", true),
      jsonColumn("section_path"),
      jsonColumn("visited_node_ids"),
      integerColumn("level"),
      integerColumn("start_offset", true),
      integerColumn("end_offset", true),
      varcharColumn("toc_source", 32),
    ],
  },
  {
    name: "page_index_terms",
    checkConstraints: [
      {
        expression: {
          postgres: '"field_mask" BETWEEN 1 AND 7',
          tidb: "`field_mask` BETWEEN 1 AND 7",
        },
        name: "page_index_terms_field_mask_ck",
      },
    ],
    foreignKeys: [
      {
        columns: ["knowledge_space_id"],
        onDelete: "CASCADE",
        referencedColumns: ["id"],
        referencedTable: "knowledge_spaces",
      },
      {
        columns: ["manifest_id"],
        onDelete: "CASCADE",
        referencedColumns: ["id"],
        referencedTable: "page_index_manifests",
      },
      {
        columns: ["page_index_node_id"],
        onDelete: "CASCADE",
        referencedColumns: ["id"],
        referencedTable: "page_index_nodes",
      },
    ],
    columns: [
      idColumn(),
      idColumn("knowledge_space_id"),
      idColumn("manifest_id"),
      idColumn("page_index_node_id"),
      varcharColumn("term", 128),
      integerColumn("field_mask"),
    ],
  },
  {
    name: "knowledge_space_members",
    checkConstraints: [
      {
        expression: {
          postgres: `"role" IN ('owner', 'editor', 'viewer')`,
          tidb: "`role` IN ('owner', 'editor', 'viewer')",
        },
        name: "knowledge_space_members_role_ck",
      },
      {
        expression: { postgres: '"revision" >= 1', tidb: "`revision` >= 1" },
        name: "knowledge_space_members_revision_ck",
      },
    ],
    foreignKeys: [
      {
        columns: ["tenant_id", "knowledge_space_id"],
        onDelete: "CASCADE",
        referencedColumns: ["tenant_id", "id"],
        referencedTable: "knowledge_spaces",
      },
    ],
    columns: [
      idColumn(),
      varcharColumn("tenant_id", 255),
      idColumn("knowledge_space_id"),
      varcharColumn("subject_id", 255),
      varcharColumn("role", 16),
      integerColumn("revision"),
      varcharColumn("created_by_subject_id", 255),
      timestampColumn("created_at"),
      timestampColumn("updated_at"),
    ],
  },
  {
    name: "knowledge_space_access_policies",
    checkConstraints: [
      {
        expression: {
          postgres: `"visibility" IN ('only_me', 'all_members', 'partial_members')`,
          tidb: "`visibility` IN ('only_me', 'all_members', 'partial_members')",
        },
        name: "knowledge_space_access_policies_visibility_ck",
      },
      {
        expression: { postgres: '"revision" >= 1', tidb: "`revision` >= 1" },
        name: "knowledge_space_access_policies_revision_ck",
      },
    ],
    foreignKeys: [
      {
        columns: ["tenant_id", "knowledge_space_id"],
        onDelete: "CASCADE",
        referencedColumns: ["tenant_id", "id"],
        referencedTable: "knowledge_spaces",
      },
      {
        columns: ["tenant_id", "knowledge_space_id", "owner_subject_id"],
        onDelete: "RESTRICT",
        referencedColumns: ["tenant_id", "knowledge_space_id", "subject_id"],
        referencedTable: "knowledge_space_members",
      },
    ],
    columns: [
      idColumn(),
      varcharColumn("tenant_id", 255),
      idColumn("knowledge_space_id"),
      varcharColumn("visibility", 24),
      varcharColumn("owner_subject_id", 255),
      integerColumn("revision"),
      varcharColumn("updated_by_subject_id", 255),
      timestampColumn("created_at"),
      timestampColumn("updated_at"),
    ],
  },
  {
    name: "knowledge_space_access_policy_members",
    foreignKeys: [
      {
        columns: ["tenant_id", "knowledge_space_id", "access_policy_id"],
        onDelete: "CASCADE",
        referencedColumns: ["tenant_id", "knowledge_space_id", "id"],
        referencedTable: "knowledge_space_access_policies",
      },
      {
        columns: ["tenant_id", "knowledge_space_id", "subject_id"],
        onDelete: "CASCADE",
        referencedColumns: ["tenant_id", "knowledge_space_id", "subject_id"],
        referencedTable: "knowledge_space_members",
      },
    ],
    columns: [
      idColumn(),
      varcharColumn("tenant_id", 255),
      idColumn("knowledge_space_id"),
      idColumn("access_policy_id"),
      varcharColumn("subject_id", 255),
      timestampColumn("created_at"),
    ],
  },
  {
    name: "knowledge_space_api_access",
    checkConstraints: [
      {
        expression: { postgres: '"revision" >= 1', tidb: "`revision` >= 1" },
        name: "knowledge_space_api_access_revision_ck",
      },
      {
        expression: {
          postgres:
            '("enabled" AND "disabled_at" IS NULL) OR (NOT "enabled" AND "disabled_at" IS NOT NULL)',
          tidb: "(`enabled` AND `disabled_at` IS NULL) OR (NOT `enabled` AND `disabled_at` IS NOT NULL)",
        },
        name: "knowledge_space_api_access_disabled_ck",
      },
    ],
    foreignKeys: [
      {
        columns: ["tenant_id", "knowledge_space_id"],
        onDelete: "CASCADE",
        referencedColumns: ["tenant_id", "id"],
        referencedTable: "knowledge_spaces",
      },
    ],
    columns: [
      idColumn(),
      varcharColumn("tenant_id", 255),
      idColumn("knowledge_space_id"),
      boolColumn("enabled"),
      timestampColumn("disabled_at", true),
      integerColumn("revision"),
      varcharColumn("updated_by_subject_id", 255),
      timestampColumn("created_at"),
      timestampColumn("updated_at"),
    ],
  },
  {
    name: "knowledge_space_api_keys",
    checkConstraints: [
      {
        expression: {
          postgres: `"status" IN ('active', 'revoked')`,
          tidb: "`status` IN ('active', 'revoked')",
        },
        name: "knowledge_space_api_keys_status_ck",
      },
      {
        expression: { postgres: '"revision" >= 1', tidb: "`revision` >= 1" },
        name: "knowledge_space_api_keys_revision_ck",
      },
      {
        expression: {
          postgres: `("status" = 'active' AND "revoked_at" IS NULL) OR ("status" = 'revoked' AND "revoked_at" IS NOT NULL)`,
          tidb: "(`status` = 'active' AND `revoked_at` IS NULL) OR (`status` = 'revoked' AND `revoked_at` IS NOT NULL)",
        },
        name: "knowledge_space_api_keys_revocation_ck",
      },
    ],
    foreignKeys: [
      {
        columns: ["tenant_id", "knowledge_space_id"],
        onDelete: "CASCADE",
        referencedColumns: ["tenant_id", "id"],
        referencedTable: "knowledge_spaces",
      },
      {
        columns: ["tenant_id", "knowledge_space_id", "principal_subject_id"],
        onDelete: "CASCADE",
        referencedColumns: ["tenant_id", "knowledge_space_id", "subject_id"],
        referencedTable: "knowledge_space_members",
      },
    ],
    columns: [
      idColumn(),
      varcharColumn("tenant_id", 255),
      idColumn("knowledge_space_id"),
      varcharColumn("name", 160),
      varcharColumn("key_prefix", 24),
      varcharColumn("key_hash", 64),
      varcharColumn("principal_subject_id", 255),
      varcharColumn("status", 16),
      integerColumn("revision"),
      varcharColumn("created_by_subject_id", 255),
      timestampColumn("last_used_at", true),
      timestampColumn("expires_at", true),
      timestampColumn("revoked_at", true),
      timestampColumn("created_at"),
      timestampColumn("updated_at"),
    ],
  },
  {
    name: "knowledge_space_permission_snapshots",
    checkConstraints: [
      {
        expression: {
          postgres: `"role" IN ('owner', 'editor', 'viewer')`,
          tidb: "`role` IN ('owner', 'editor', 'viewer')",
        },
        name: "knowledge_space_permission_snapshots_role_ck",
      },
      {
        expression: {
          postgres: `"visibility" IN ('only_me', 'all_members', 'partial_members')`,
          tidb: "`visibility` IN ('only_me', 'all_members', 'partial_members')",
        },
        name: "knowledge_space_permission_snapshots_visibility_ck",
      },
      {
        expression: {
          postgres: `"access_channel" IN ('interactive', 'service_api', 'mcp', 'agent')`,
          tidb: "`access_channel` IN ('interactive', 'service_api', 'mcp', 'agent')",
        },
        name: "knowledge_space_permission_snapshots_channel_ck",
      },
      {
        expression: {
          postgres: `"status" IN ('active', 'revoked', 'expired')`,
          tidb: "`status` IN ('active', 'revoked', 'expired')",
        },
        name: "knowledge_space_permission_snapshots_status_ck",
      },
      {
        expression: {
          postgres:
            '"revision" >= 1 AND "member_revision" >= 1 AND "access_policy_revision" >= 1 AND "api_access_revision" >= 1',
          tidb: "`revision` >= 1 AND `member_revision` >= 1 AND `access_policy_revision` >= 1 AND `api_access_revision` >= 1",
        },
        name: "knowledge_space_permission_snapshots_revisions_ck",
      },
      {
        expression: {
          postgres: `("status" = 'revoked' AND "revoked_at" IS NOT NULL) OR ("status" <> 'revoked' AND "revoked_at" IS NULL)`,
          tidb: "(`status` = 'revoked' AND `revoked_at` IS NOT NULL) OR (`status` <> 'revoked' AND `revoked_at` IS NULL)",
        },
        name: "knowledge_space_permission_snapshots_revocation_ck",
      },
      {
        expression: {
          postgres: `("api_key_id" IS NULL AND "api_key_revision" IS NULL AND "api_key_expires_at" IS NULL) OR ("api_key_id" IS NOT NULL AND "api_key_revision" >= 1)`,
          tidb: "(`api_key_id` IS NULL AND `api_key_revision` IS NULL AND `api_key_expires_at` IS NULL) OR (`api_key_id` IS NOT NULL AND `api_key_revision` >= 1)",
        },
        name: "knowledge_space_permission_snapshots_api_key_binding_ck",
      },
    ],
    foreignKeys: [
      {
        columns: ["tenant_id", "knowledge_space_id"],
        onDelete: "CASCADE",
        referencedColumns: ["tenant_id", "id"],
        referencedTable: "knowledge_spaces",
      },
      {
        columns: ["tenant_id", "knowledge_space_id", "api_key_id"],
        onDelete: "RESTRICT",
        referencedColumns: ["tenant_id", "knowledge_space_id", "id"],
        referencedTable: "knowledge_space_api_keys",
      },
    ],
    columns: [
      idColumn(),
      varcharColumn("tenant_id", 255),
      idColumn("knowledge_space_id"),
      varcharColumn("subject_id", 255),
      varcharColumn("role", 16),
      varcharColumn("visibility", 24),
      varcharColumn("access_channel", 16),
      integerColumn("member_revision"),
      integerColumn("access_policy_revision"),
      integerColumn("api_access_revision"),
      idColumn("api_key_id", true),
      integerColumn("api_key_revision", true),
      timestampColumn("api_key_expires_at", true),
      jsonColumn("permission_scopes"),
      varcharColumn("status", 16),
      integerColumn("revision"),
      timestampColumn("expires_at"),
      timestampColumn("revoked_at", true),
      timestampColumn("created_at"),
      timestampColumn("updated_at"),
    ],
  },
  {
    name: "research_task_jobs",
    checkConstraints: [
      {
        expression: {
          postgres: `"stage" IN ('queued', 'planning', 'retrieving', 'analyzing', 'generating', 'paused', 'completed', 'failed', 'canceled')`,
          tidb: "`stage` IN ('queued', 'planning', 'retrieving', 'analyzing', 'generating', 'paused', 'completed', 'failed', 'canceled')",
        },
        name: "research_task_jobs_stage_ck",
      },
      {
        expression: {
          postgres: `"mode" IS NULL OR "mode" IN ('auto', 'fast', 'research', 'deep')`,
          tidb: "`mode` IS NULL OR `mode` IN ('auto', 'fast', 'research', 'deep')",
        },
        name: "research_task_jobs_mode_ck",
      },
      {
        expression: {
          postgres: `"access_channel" IN ('interactive', 'service_api', 'mcp', 'agent')`,
          tidb: "`access_channel` IN ('interactive', 'service_api', 'mcp', 'agent')",
        },
        name: "research_task_jobs_channel_ck",
      },
      {
        expression: {
          postgres:
            '"permission_snapshot_revision" >= 1 AND "row_version" >= 1 AND "execution_attempts" >= 0 AND "max_execution_attempts" >= 1 AND ("top_k" IS NULL OR "top_k" >= 1) AND ("budget_usd" IS NULL OR "budget_usd" >= 0)',
          tidb: "`permission_snapshot_revision` >= 1 AND `row_version` >= 1 AND `execution_attempts` >= 0 AND `max_execution_attempts` >= 1 AND (`top_k` IS NULL OR `top_k` >= 1) AND (`budget_usd` IS NULL OR `budget_usd` >= 0)",
        },
        name: "research_task_jobs_positive_ck",
      },
      {
        expression: {
          postgres:
            '("lease_token" IS NULL AND "worker_id" IS NULL AND "lease_expires_at" IS NULL) OR ("lease_token" IS NOT NULL AND "worker_id" IS NOT NULL AND "lease_expires_at" IS NOT NULL)',
          tidb: "(`lease_token` IS NULL AND `worker_id` IS NULL AND `lease_expires_at` IS NULL) OR (`lease_token` IS NOT NULL AND `worker_id` IS NOT NULL AND `lease_expires_at` IS NOT NULL)",
        },
        name: "research_task_jobs_lease_ck",
      },
    ],
    foreignKeys: [
      {
        columns: ["tenant_id", "knowledge_space_id"],
        onDelete: "CASCADE",
        referencedColumns: ["tenant_id", "id"],
        referencedTable: "knowledge_spaces",
      },
      {
        columns: [
          "tenant_id",
          "knowledge_space_id",
          "permission_snapshot_id",
          "subject_id",
          "access_channel",
        ],
        onDelete: "RESTRICT",
        referencedColumns: [
          "tenant_id",
          "knowledge_space_id",
          "id",
          "subject_id",
          "access_channel",
        ],
        referencedTable: "knowledge_space_permission_snapshots",
      },
    ],
    columns: [
      idColumn(),
      varcharColumn("tenant_id", 255),
      idColumn("knowledge_space_id"),
      varcharColumn("subject_id", 255),
      idColumn("permission_snapshot_id"),
      integerColumn("permission_snapshot_revision"),
      varcharColumn("access_channel", 16),
      textColumn("query"),
      varcharColumn("mode", 16, true),
      integerColumn("top_k", true),
      doubleColumn("budget_usd", true),
      jsonColumn("limits"),
      jsonColumn("metadata"),
      jsonColumn("cost"),
      varcharColumn("stage", 16),
      varcharColumn("paused_from_stage", 16, true),
      varcharColumn("queue_job_id", 255, true),
      textColumn("error", true),
      bigintColumn("resume_after", true),
      bigintColumn("paused_at", true),
      bigintColumn("completed_at", true),
      integerColumn("row_version"),
      integerColumn("execution_attempts"),
      integerColumn("max_execution_attempts"),
      varcharColumn("worker_id", 255, true),
      idColumn("lease_token", true),
      bigintColumn("lease_expires_at", true),
      bigintColumn("heartbeat_at", true),
      bigintColumn("retry_at", true),
      bigintColumn("created_at"),
      bigintColumn("updated_at"),
    ],
  },
  {
    name: "research_task_outbox",
    checkConstraints: [
      {
        expression: {
          postgres: `"event_type" = 'research.task'`,
          tidb: "`event_type` = 'research.task'",
        },
        name: "research_task_outbox_event_ck",
      },
      {
        expression: { postgres: '"schema_version" = 1', tidb: "`schema_version` = 1" },
        name: "research_task_outbox_schema_ck",
      },
      {
        expression: {
          postgres: `"status" IN ('pending', 'dispatching', 'dispatched', 'leased', 'completed', 'canceled', 'dead')`,
          tidb: "`status` IN ('pending', 'dispatching', 'dispatched', 'leased', 'completed', 'canceled', 'dead')",
        },
        name: "research_task_outbox_status_ck",
      },
      {
        expression: {
          postgres: '"delivery_revision" >= 1 AND "dispatch_attempts" >= 0',
          tidb: "`delivery_revision` >= 1 AND `dispatch_attempts` >= 0",
        },
        name: "research_task_outbox_positive_ck",
      },
      {
        expression: {
          postgres:
            '("lock_token" IS NULL AND "locked_by" IS NULL AND "locked_until" IS NULL) OR ("lock_token" IS NOT NULL AND "locked_by" IS NOT NULL AND "locked_until" IS NOT NULL)',
          tidb: "(`lock_token` IS NULL AND `locked_by` IS NULL AND `locked_until` IS NULL) OR (`lock_token` IS NOT NULL AND `locked_by` IS NOT NULL AND `locked_until` IS NOT NULL)",
        },
        name: "research_task_outbox_lock_ck",
      },
    ],
    foreignKeys: [
      {
        columns: ["research_task_job_id"],
        onDelete: "CASCADE",
        referencedColumns: ["id"],
        referencedTable: "research_task_jobs",
      },
    ],
    columns: [
      idColumn(),
      idColumn("research_task_job_id"),
      integerColumn("delivery_revision"),
      varcharColumn("event_type", 32),
      integerColumn("schema_version"),
      varcharColumn("idempotency_key", 512),
      jsonColumn("payload"),
      varcharColumn("status", 16),
      bigintColumn("available_at"),
      integerColumn("dispatch_attempts"),
      varcharColumn("locked_by", 255, true),
      bigintColumn("locked_until", true),
      idColumn("lock_token", true),
      varcharColumn("queue_job_id", 255, true),
      textColumn("last_error", true),
      bigintColumn("delivered_at", true),
      bigintColumn("created_at"),
      bigintColumn("updated_at"),
    ],
  },
  {
    name: "research_task_partial_results",
    foreignKeys: [
      {
        columns: ["research_task_job_id"],
        onDelete: "CASCADE",
        referencedColumns: ["id"],
        referencedTable: "research_task_jobs",
      },
      {
        columns: ["tenant_id", "knowledge_space_id"],
        onDelete: "CASCADE",
        referencedColumns: ["tenant_id", "id"],
        referencedTable: "knowledge_spaces",
      },
    ],
    columns: [
      idColumn(),
      varcharColumn("tenant_id", 255),
      idColumn("knowledge_space_id"),
      idColumn("research_task_job_id"),
      integerColumn("sequence"),
      varcharColumn("idempotency_key", 512),
      jsonColumn("evidence_bundle"),
      bigintColumn("created_at"),
    ],
  },
  {
    name: "research_task_progress_events",
    checkConstraints: [
      {
        expression: { postgres: '"sequence" >= 1', tidb: "`sequence` >= 1" },
        name: "research_task_progress_sequence_ck",
      },
      {
        expression: {
          postgres: `"event_type" IN ('research_task.canceled', 'research_task.failed', 'research_task.paused', 'research_task.resumed', 'research_task.stage_changed', 'research_task.started')`,
          tidb: "`event_type` IN ('research_task.canceled', 'research_task.failed', 'research_task.paused', 'research_task.resumed', 'research_task.stage_changed', 'research_task.started')",
        },
        name: "research_task_progress_event_ck",
      },
      {
        expression: {
          postgres: `"stage" IN ('queued', 'planning', 'retrieving', 'analyzing', 'generating', 'paused', 'completed', 'failed', 'canceled')`,
          tidb: "`stage` IN ('queued', 'planning', 'retrieving', 'analyzing', 'generating', 'paused', 'completed', 'failed', 'canceled')",
        },
        name: "research_task_progress_stage_ck",
      },
    ],
    foreignKeys: [
      {
        columns: ["tenant_id", "knowledge_space_id", "research_task_job_id"],
        onDelete: "CASCADE",
        referencedColumns: ["tenant_id", "knowledge_space_id", "id"],
        referencedTable: "research_task_jobs",
      },
    ],
    columns: [
      idColumn(),
      varcharColumn("tenant_id", 255),
      idColumn("knowledge_space_id"),
      idColumn("research_task_job_id"),
      integerColumn("sequence"),
      varcharColumn("idempotency_key", 512),
      varcharColumn("event_type", 64),
      varcharColumn("stage", 16),
      jsonColumn("payload"),
      bigintColumn("created_at"),
    ],
  },
  {
    name: "agent_workspace_snapshots",
    checkConstraints: [
      {
        expression: {
          postgres: `"access_channel" IN ('interactive', 'service_api', 'mcp', 'agent')`,
          tidb: "`access_channel` IN ('interactive', 'service_api', 'mcp', 'agent')",
        },
        name: "agent_workspace_snapshots_channel_ck",
      },
      {
        expression: {
          postgres: `"permission_snapshot_revision" >= 1`,
          tidb: "`permission_snapshot_revision` >= 1",
        },
        name: "agent_workspace_snapshots_revision_ck",
      },
      {
        expression: {
          postgres:
            '(("invalidated_at" IS NULL AND "invalidation_reason" IS NULL) OR ("invalidated_at" IS NOT NULL AND "invalidation_reason" IS NOT NULL))',
          tidb: "((`invalidated_at` IS NULL AND `invalidation_reason` IS NULL) OR (`invalidated_at` IS NOT NULL AND `invalidation_reason` IS NOT NULL))",
        },
        name: "agent_workspace_snapshots_invalidation_ck",
      },
    ],
    foreignKeys: [
      {
        columns: ["tenant_id", "knowledge_space_id"],
        onDelete: "CASCADE",
        referencedColumns: ["tenant_id", "id"],
        referencedTable: "knowledge_spaces",
      },
    ],
    columns: [
      idColumn(),
      varcharColumn("tenant_id", 255),
      idColumn("knowledge_space_id"),
      varcharColumn("subject_id", 255),
      varcharColumn("access_channel", 16),
      idColumn("permission_snapshot_id"),
      integerColumn("permission_snapshot_revision"),
      jsonColumn("permission_scopes"),
      varcharColumn("fingerprint", 80),
      jsonColumn("payload"),
      timestampColumn("invalidated_at", true),
      varcharColumn("invalidation_reason", 64, true),
      timestampColumn("created_at"),
    ],
  },
] as const satisfies readonly TableDefinition[];

const indexes = [
  {
    columns: ["tenant_id", "id"],
    name: "knowledge_spaces_tenant_id_uq",
    purpose: "Enforce tenant ownership in composite foreign keys",
    tableName: "knowledge_spaces",
    unique: true,
  },
  {
    columns: ["tenant_id", "slug"],
    name: "knowledge_spaces_tenant_slug_uq",
    purpose: "Resolve tenant-scoped spaces without scanning all tenants",
    tableName: "knowledge_spaces",
    unique: true,
  },
  {
    columns: ["tenant_id", "lifecycle_state", "updated_at", "id"],
    name: "knowledge_spaces_lifecycle_idx",
    purpose: "Exclude deleting spaces from ordinary tenant lists without scanning space history",
    tableName: "knowledge_spaces",
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "id"],
    name: "source_connections_scope_id_uq",
    purpose: "Enforce tenant/space ownership for source connection foreign keys",
    tableName: "source_connections",
    unique: true,
  },
  {
    columns: ["knowledge_space_id", "id"],
    name: "source_connections_space_id_uq",
    purpose: "Resolve a connection from a source-scoped composite foreign key",
    tableName: "source_connections",
    unique: true,
  },
  {
    columns: ["credential_ref"],
    name: "source_connections_credential_ref_uq",
    purpose: "Prevent a credential object from being activated by multiple connections",
    tableName: "source_connections",
    unique: true,
    where: { postgres: '"credential_ref" IS NOT NULL' },
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "status", "created_at", "id"],
    name: "source_connections_scope_status_idx",
    purpose: "Page connection state inside a tenant-scoped knowledge space",
    tableName: "source_connections",
  },
  {
    columns: ["state_hash"],
    name: "source_oauth_transactions_state_hash_uq",
    purpose: "Atomically claim one OAuth state token",
    tableName: "source_oauth_transactions",
    unique: true,
  },
  {
    columns: ["verifier_ref"],
    name: "source_oauth_transactions_verifier_ref_uq",
    purpose: "Bind each PKCE verifier object to one OAuth transaction",
    tableName: "source_oauth_transactions",
    unique: true,
  },
  {
    columns: ["status", "expires_at", "id"],
    name: "source_oauth_transactions_expiry_idx",
    purpose: "Expire pending and crashed OAuth exchanges without a full scan",
    tableName: "source_oauth_transactions",
  },
  {
    columns: ["credential_ref"],
    name: "source_connection_secret_refs_ref_uq",
    purpose: "Track one durable cleanup lifecycle per encrypted credential object",
    tableName: "source_connection_secret_refs",
    unique: true,
  },
  {
    columns: ["state", "next_attempt_at", "recover_after", "lease_expires_at", "id"],
    name: "source_connection_secret_refs_claim_idx",
    purpose: "Claim due secret cleanup leases without scanning the ledger",
    tableName: "source_connection_secret_refs",
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "connection_id", "state", "id"],
    name: "source_connection_secret_refs_scope_idx",
    purpose: "Inventory connection secrets for deletion and residue probes",
    tableName: "source_connection_secret_refs",
  },
  {
    columns: ["knowledge_space_id", "connection_id", "id"],
    name: "sources_connection_idx",
    purpose: "Resolve sources bound to a provider connection",
    tableName: "sources",
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "source_id"],
    name: "source_sync_policies_source_uq",
    purpose: "Persist one synchronization policy per tenant-scoped source",
    tableName: "source_sync_policies",
    unique: true,
  },
  {
    columns: ["enabled", "next_run_at", "id"],
    name: "source_sync_policies_due_idx",
    purpose: "Claim due source synchronization policies",
    tableName: "source_sync_policies",
  },
  {
    columns: ["idempotency_digest"],
    name: "source_workflow_runs_idempotency_digest_uq",
    purpose: "Deduplicate the length-prefixed tenant/space/caller/key digest within TiDB limits",
    tableName: "source_workflow_runs",
    unique: true,
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "id"],
    name: "source_workflow_runs_scope_id_uq",
    purpose: "Enforce workflow scope for bulk child foreign keys",
    tableName: "source_workflow_runs",
    unique: true,
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "source_scope", "active_slot"],
    name: "source_workflow_runs_active_uq",
    purpose: "Serialize active workflows for the same source scope",
    tableName: "source_workflow_runs",
    unique: true,
  },
  {
    columns: ["run_state", "lease_expires_at", "updated_at", "id"],
    name: "source_workflow_runs_claim_idx",
    purpose: "Claim queued or expired source workflow leases",
    tableName: "source_workflow_runs",
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "source_id", "created_at", "id"],
    name: "source_workflow_runs_history_idx",
    purpose: "Page source workflow history after ACL filtering",
    tableName: "source_workflow_runs",
  },
  {
    columns: ["run_id", "delivery_revision"],
    name: "source_workflow_outbox_delivery_uq",
    purpose: "Emit one durable workflow delivery per run revision",
    tableName: "source_workflow_outbox",
    unique: true,
  },
  {
    columns: ["status", "available_at", "locked_until", "id"],
    name: "source_workflow_outbox_claim_idx",
    purpose: "Claim due workflow outbox deliveries",
    tableName: "source_workflow_outbox",
  },
  {
    columns: ["run_id", "page_id"],
    name: "source_crawl_preview_pages_page_uq",
    purpose: "Deduplicate preview pages inside a crawl run",
    tableName: "source_crawl_preview_pages",
    unique: true,
  },
  {
    columns: ["run_id", "source_id"],
    name: "source_bulk_workflow_items_source_uq",
    purpose: "Run each bulk action once per source",
    tableName: "source_bulk_workflow_items",
    unique: true,
  },
  {
    columns: ["child_run_id"],
    name: "source_bulk_workflow_items_child_uq",
    purpose: "Bind one independent child workflow to exactly one bulk item",
    tableName: "source_bulk_workflow_items",
    unique: true,
  },
  {
    columns: ["deletion_job_id"],
    name: "source_bulk_workflow_items_deletion_job_uq",
    purpose: "Bind one durable source deletion job to exactly one bulk remove item",
    tableName: "source_bulk_workflow_items",
    unique: true,
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "run_id", "id"],
    name: "source_bulk_workflow_items_list_idx",
    purpose: "Page bulk workflow items inside a tenant-scoped run",
    tableName: "source_bulk_workflow_items",
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "id"],
    name: "knowledge_space_activity_scope_id_uq",
    purpose: "Keep append-only activity identities inside one tenant-scoped knowledge space",
    tableName: "knowledge_space_activity_events",
    unique: true,
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "occurred_at", "id"],
    name: "knowledge_space_activity_feed_idx",
    purpose: "Page recent product activity inside one space without a cross-tenant scan",
    tableName: "knowledge_space_activity_events",
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "action", "occurred_at"],
    name: "knowledge_space_activity_stats_idx",
    purpose: "Aggregate fixed product-statistics windows inside one tenant-scoped space",
    tableName: "knowledge_space_activity_events",
  },
  {
    columns: ["required_permission_scope"],
    dialects: ["postgres"],
    name: "knowledge_space_activity_scope_gin_idx",
    purpose: "Apply candidate permission containment before activity pagination",
    tableName: "knowledge_space_activity_events",
    using: { postgres: "GIN" },
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "issue_key"],
    name: "knowledge_space_attention_issue_uq",
    purpose: "Persist one CAS state per materialized attention rule/resource signal",
    tableName: "knowledge_space_attention_states",
    unique: true,
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "status", "updated_at", "id"],
    name: "knowledge_space_attention_list_idx",
    purpose: "List bounded attention state inside one tenant-scoped knowledge space",
    tableName: "knowledge_space_attention_states",
  },
  {
    columns: ["tenant_id", "knowledge_space_id"],
    name: "knowledge_space_manifests_tenant_space_uq",
    purpose: "Resolve the manifest for a tenant-scoped KnowledgeSpace without scanning manifests",
    tableName: "knowledge_space_manifests",
    unique: true,
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "kind", "revision"],
    name: "knowledge_space_profile_revisions_scope_revision_uq",
    purpose: "Guarantee one immutable revision number per tenant-scoped profile kind",
    tableName: "knowledge_space_profile_revisions",
    unique: true,
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "kind", "id", "revision"],
    name: "knowledge_space_profile_revisions_head_fk_uq",
    purpose: "Bind profile heads to the exact tenant, space, kind, id, and active revision",
    tableName: "knowledge_space_profile_revisions",
    unique: true,
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "kind", "id", "revision", "snapshot_digest"],
    name: "knowledge_space_profile_revisions_attempt_fk_uq",
    purpose: "Bind compilation attempts and publication tuples to an exact profile snapshot",
    tableName: "knowledge_space_profile_revisions",
    unique: true,
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "kind", "state", "revision", "id"],
    name: "knowledge_space_profile_revisions_scope_state_idx",
    purpose: "List candidate and historical profile revisions without scanning other spaces",
    tableName: "knowledge_space_profile_revisions",
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "kind"],
    name: "knowledge_space_profile_heads_scope_uq",
    purpose: "Guarantee one CAS-controlled active profile head per tenant-scoped kind",
    tableName: "knowledge_space_profile_heads",
    unique: true,
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "publication_id"],
    name: "knowledge_space_profile_publication_bindings_publication_uq",
    purpose: "Permit only one immutable embedding/retrieval tuple per publication",
    tableName: "knowledge_space_profile_publication_bindings",
    unique: true,
  },
  {
    columns: [
      "tenant_id",
      "knowledge_space_id",
      "activated_at",
      "embedding_profile_revision",
      "retrieval_profile_revision",
      "publication_id",
    ],
    name: "knowledge_space_profile_publication_bindings_activation_idx",
    purpose: "Resolve and audit activated publication/profile tuples without scanning history",
    tableName: "knowledge_space_profile_publication_bindings",
  },
  {
    columns: ["idempotency_digest"],
    name: "knowledge_space_profile_migration_runs_idempotency_digest_uq",
    purpose:
      "Make profile migration admission idempotent with a bounded collision-checked request digest",
    tableName: "knowledge_space_profile_migration_runs",
    unique: true,
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "active_slot"],
    name: "knowledge_space_profile_migration_runs_active_uq",
    purpose: "Fence embedding and retrieval migrations to one active run per space",
    tableName: "knowledge_space_profile_migration_runs",
    unique: true,
  },
  {
    columns: ["run_state", "lease_expires_at", "updated_at", "id"],
    name: "knowledge_space_profile_migration_runs_claim_idx",
    purpose: "Claim queued profile migrations and recover expired execution leases",
    tableName: "knowledge_space_profile_migration_runs",
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "created_at", "id"],
    name: "knowledge_space_profile_migration_runs_space_idx",
    purpose: "List profile migration history within one tenant-scoped knowledge space",
    tableName: "knowledge_space_profile_migration_runs",
  },
  {
    columns: ["run_id", "delivery_revision"],
    name: "knowledge_space_profile_migration_outbox_delivery_uq",
    purpose: "Guarantee one durable dispatch record per migration delivery revision",
    tableName: "knowledge_space_profile_migration_outbox",
    unique: true,
  },
  {
    columns: ["status", "available_at", "locked_until", "id"],
    name: "knowledge_space_profile_migration_outbox_claim_idx",
    purpose: "Claim available migration deliveries and recover expired outbox locks",
    tableName: "knowledge_space_profile_migration_outbox",
  },
  {
    columns: [
      "tenant_id",
      "knowledge_space_id",
      "kind",
      "source_manifest_version",
      "source_snapshot_digest",
    ],
    name: "knowledge_space_profile_backfills_source_uq",
    purpose:
      "Deduplicate one immutable legacy snapshot while allowing a changed manifest to enqueue a fresh job",
    tableName: "knowledge_space_profile_backfills",
    unique: true,
  },
  {
    columns: ["run_state", "lease_expires_at", "updated_at", "id"],
    name: "knowledge_space_profile_backfills_claim_idx",
    purpose: "Claim bounded legacy profile backfills and recover expired worker leases",
    tableName: "knowledge_space_profile_backfills",
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "id"],
    name: "knowledge_space_manifests_tenant_space_idx",
    purpose: "List tenant manifests with stable keyset pagination",
    tableName: "knowledge_space_manifests",
  },
  {
    columns: ["knowledge_space_id", "status"],
    name: "sources_space_status_idx",
    purpose: "List active or syncing sources by space",
    tableName: "sources",
  },
  {
    columns: ["credential_ref"],
    name: "sources_credential_ref_uq",
    purpose: "Prevent an opaque SecretStore reference from being attached to multiple sources",
    tableName: "sources",
    unique: true,
    where: { postgres: '"credential_ref" IS NOT NULL' },
  },
  {
    columns: ["id"],
    columnsByDialect: { tidb: ["credential_ref", "id"] },
    name: "sources_credential_backfill_discovery_idx",
    purpose: "Discover legacy credential rows in bounded source-id order without a full scan",
    tableName: "sources",
    where: { postgres: '"credential_ref" IS NULL' },
  },
  {
    columns: ["knowledge_space_id", "id"],
    name: "sources_space_id_uq",
    purpose: "Enforce source ownership in composite credential-backfill foreign keys",
    tableName: "sources",
    unique: true,
  },
  {
    columns: ["knowledge_space_id", "deletion_job_id", "id"],
    name: "sources_deletion_job_idx",
    purpose: "Resolve the durable deletion lifecycle attached to one source",
    tableName: "sources",
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "source_id"],
    name: "source_credential_backfills_source_uq",
    purpose: "Keep one durable legacy-credential migration ledger per source",
    tableName: "source_credential_backfills",
    unique: true,
  },
  {
    columns: ["candidate_credential_ref"],
    name: "source_credential_backfills_candidate_ref_uq",
    purpose: "Give every durable credential candidate an exclusive SecretStore address",
    tableName: "source_credential_backfills",
    unique: true,
  },
  {
    columns: ["run_state", "lease_expires_at", "updated_at", "id"],
    name: "source_credential_backfills_claim_idx",
    purpose: "Lease queued or expired source credential work without scanning job history",
    tableName: "source_credential_backfills",
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "source_id", "id"],
    name: "source_credential_backfills_scope_idx",
    purpose: "Resolve credential migration state only inside its tenant-scoped source",
    tableName: "source_credential_backfills",
  },
  {
    columns: ["credential_ref"],
    name: "source_secret_lifecycle_refs_ref_uq",
    purpose: "Give every opaque SecretStore reference one durable lifecycle state machine",
    tableName: "source_secret_lifecycle_refs",
    unique: true,
  },
  {
    columns: ["operation_id", "state", "id"],
    name: "source_secret_lifecycle_refs_operation_idx",
    purpose: "Recover an ambiguous lifecycle commit by its stable operation identity",
    tableName: "source_secret_lifecycle_refs",
  },
  {
    columns: ["state", "next_delete_at", "lease_expires_at", "updated_at", "id"],
    name: "source_secret_lifecycle_refs_claim_idx",
    purpose: "Lease one retired or expired deleting reference without scanning history",
    tableName: "source_secret_lifecycle_refs",
  },
  {
    columns: ["state", "recover_after", "id"],
    name: "source_secret_lifecycle_refs_recovery_idx",
    purpose: "Reconcile expired staged and candidate references in bounded order",
    tableName: "source_secret_lifecycle_refs",
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "source_id", "id"],
    name: "source_secret_lifecycle_refs_scope_idx",
    purpose: "Audit secret lifecycle history by its original tenant-scoped source",
    tableName: "source_secret_lifecycle_refs",
  },
  {
    columns: ["knowledge_space_id", "mount_path"],
    name: "resource_mounts_space_path_uq",
    purpose: "Resolve mounted SourceFS/KnowledgeFS roots by path without scanning mounts",
    tableName: "resource_mounts",
    unique: true,
  },
  {
    columns: ["knowledge_space_id", "resource_type", "mount_path", "id"],
    name: "resource_mounts_space_type_path_idx",
    purpose: "List mounted resources by type with stable keyset pagination",
    tableName: "resource_mounts",
  },
  {
    columns: ["permission_scope"],
    dialects: ["postgres"],
    name: "resource_mounts_permission_scope_idx",
    purpose: "Filter mounted resources by permission scope before command exposure",
    tableName: "resource_mounts",
    using: {
      postgres: "GIN",
    },
  },
  {
    columns: ["knowledge_space_id", "id", "version"],
    name: "document_assets_space_id_version_uq",
    purpose: "Enforce document version ownership in compilation foreign keys",
    tableName: "document_assets",
    unique: true,
  },
  {
    columns: ["knowledge_space_id", "source_id", "version", "id"],
    name: "document_assets_space_source_version_idx",
    purpose: "Fetch source assets in version order without per-source lookups",
    tableName: "document_assets",
  },
  {
    columns: ["knowledge_space_id", "parser_status", "created_at", "id"],
    name: "document_assets_space_status_created_idx",
    purpose: "List uploads and ingestion state by space without scanning all assets",
    tableName: "document_assets",
  },
  {
    columns: ["knowledge_space_id", "lifecycle_state", "source_id", "version", "id"],
    name: "document_assets_lifecycle_idx",
    purpose: "List only active documents and inventory source deletions in stable order",
    tableName: "document_assets",
  },
  {
    columns: ["document_asset_id", "version"],
    name: "parse_artifacts_asset_version_uq",
    purpose: "Load parse artifacts by asset version in one indexed query",
    tableName: "parse_artifacts",
    unique: true,
  },
  {
    columns: ["artifact_hash"],
    name: "parse_artifacts_hash_idx",
    purpose: "Reuse immutable parse artifacts by content hash",
    tableName: "parse_artifacts",
  },
  {
    columns: ["document_asset_id", "version", "publication_generation_id"],
    columnsByDialect: {
      tidb: ["document_asset_id", "version", "publication_generation_key"],
    },
    expressions: {
      postgres: {
        publication_generation_id: `COALESCE("publication_generation_id", '${PUBLICATION_GENERATION_ID_SENTINEL}'::uuid)`,
      },
    },
    name: "document_multimodal_manifests_asset_version_uq",
    purpose: "Reuse one enriched multimodal manifest per document version and build generation",
    tableName: "document_multimodal_manifests",
    unique: true,
  },
  {
    columns: ["knowledge_space_id", "document_asset_id", "id"],
    name: "document_multimodal_manifests_space_asset_idx",
    purpose: "Resolve document multimodal manifests for document reads",
    tableName: "document_multimodal_manifests",
  },
  {
    columns: ["parse_artifact_id", "segment_index"],
    name: "artifact_segments_artifact_index_uq",
    purpose: "Deduplicate segment indexes inside a parse artifact",
    tableName: "artifact_segments",
    unique: true,
  },
  {
    columns: ["knowledge_space_id", "parse_artifact_id", "segment_index", "id"],
    name: "artifact_segments_space_artifact_index_idx",
    purpose: "Read parse artifact segments in stable source order",
    tableName: "artifact_segments",
  },
  {
    columns: ["knowledge_space_id", "checksum", "id"],
    name: "artifact_segments_space_checksum_idx",
    purpose: "Find immutable artifact segments by checksum without full-space scans",
    tableName: "artifact_segments",
  },
  {
    columns: ["document_asset_id", "start_offset", "id"],
    name: "artifact_segments_document_source_idx",
    purpose: "Resolve parser output segments by source document location",
    tableName: "artifact_segments",
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "idempotency_key"],
    name: "knowledge_space_staged_commits_idempotency_uq",
    purpose: "Create staged commits idempotently without scanning commit history",
    tableName: "knowledge_space_staged_commits",
    unique: true,
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "status", "updated_at", "id"],
    name: "knowledge_space_staged_commits_status_updated_idx",
    purpose: "Recover or inspect staged commits by status with stable keyset pagination",
    tableName: "knowledge_space_staged_commits",
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "expires_at", "id"],
    name: "knowledge_space_staged_commits_expiry_idx",
    purpose: "Clean expired staged commits without full-space scans",
    tableName: "knowledge_space_staged_commits",
  },
  {
    columns: ["document_asset_id", "id"],
    name: "knowledge_space_staged_commits_document_idx",
    purpose: "Inspect staged commit history for a document without N+1 lookups",
    tableName: "knowledge_space_staged_commits",
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "expires_at", "id"],
    name: "knowledge_fs_sessions_space_expiry_idx",
    purpose: "List active KnowledgeFS sessions by space and expiry without full scans",
    tableName: "knowledge_fs_sessions",
  },
  {
    columns: ["tenant_id", "expires_at", "id"],
    name: "knowledge_fs_sessions_expiry_idx",
    purpose: "Sweep expired KnowledgeFS sessions per tenant with stable keyset pagination",
    tableName: "knowledge_fs_sessions",
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "status", "virtual_path", "expires_at", "id"],
    name: "knowledge_fs_leases_active_path_idx",
    purpose: "Detect active mutation leases on a KnowledgeFS path without full scans",
    tableName: "knowledge_fs_leases",
  },
  {
    columns: ["tenant_id", "expires_at", "id"],
    name: "knowledge_fs_leases_expiry_idx",
    purpose: "Sweep expired KnowledgeFS leases per tenant with stable keyset pagination",
    tableName: "knowledge_fs_leases",
  },
  {
    columns: ["tenant_id", "session_id", "status", "id"],
    name: "knowledge_fs_leases_session_idx",
    purpose: "Inspect active KnowledgeFS leases held by a session without N+1 lookups",
    tableName: "knowledge_fs_leases",
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "status", "expires_at", "id"],
    name: "retrieval_execution_leases_space_expiry_idx",
    purpose: "Drain or await live retrieval executions before durable deletion",
    tableName: "retrieval_execution_leases",
  },
  {
    columns: ["knowledge_space_id", "publication_generation_id", "document_asset_id", "kind", "id"],
    name: "knowledge_nodes_space_asset_kind_idx",
    purpose:
      "Batch-load one immutable node generation for assets without retained-row amplification",
    tableName: "knowledge_nodes",
  },
  {
    columns: [
      "knowledge_space_id",
      "parse_artifact_id",
      "publication_generation_id",
      "start_offset",
      "id",
    ],
    name: "knowledge_nodes_artifact_offset_idx",
    purpose: "Walk one immutable artifact generation in source order without sorting full tables",
    tableName: "knowledge_nodes",
  },
  {
    columns: [
      "knowledge_space_id",
      "parse_artifact_id",
      "kind",
      "start_offset",
      "end_offset",
      "publication_generation_id",
    ],
    columnsByDialect: {
      tidb: [
        "knowledge_space_id",
        "parse_artifact_id",
        "kind",
        "start_offset",
        "end_offset",
        "publication_generation_key",
      ],
    },
    expressions: {
      postgres: {
        publication_generation_id: `COALESCE("publication_generation_id", '${PUBLICATION_GENERATION_ID_SENTINEL}'::uuid)`,
      },
    },
    name: "knowledge_nodes_artifact_kind_offsets_uq",
    purpose: "Prevent duplicate logical nodes inside one immutable build generation",
    tableName: "knowledge_nodes",
    unique: true,
  },
  {
    columns: ["permission_scope"],
    dialects: ["postgres"],
    name: "knowledge_nodes_permission_scope_idx",
    purpose: "Filter retrieval candidates by permission scope before ranking",
    tableName: "knowledge_nodes",
    using: {
      postgres: "GIN",
    },
  },
  {
    columns: ["knowledge_space_id", "publication_generation_id", "type", "status", "node_id", "id"],
    name: "index_projections_space_type_status_idx",
    purpose: "Find ready projections by retrieval mode without scanning stale indexes",
    tableName: "index_projections",
  },
  {
    columns: ["node_id", "type", "projection_version"],
    name: "index_projections_node_type_version_idx",
    purpose: "Batch fetch node projections without one query per node",
    tableName: "index_projections",
  },
  {
    columns: ["node_id", "type", "projection_version", "model", "publication_generation_id"],
    columnsByDialect: {
      tidb: ["node_id", "type", "projection_version", "model_key", "publication_generation_key"],
    },
    expressions: {
      postgres: {
        model: `COALESCE("model", '')`,
        publication_generation_id: `COALESCE("publication_generation_id", '${PUBLICATION_GENERATION_ID_SENTINEL}'::uuid)`,
      },
    },
    name: "index_projections_node_type_version_model_uq",
    purpose: "Prevent duplicate logical projections inside one immutable build generation",
    tableName: "index_projections",
    unique: true,
  },
  {
    columns: ["fts_document"],
    dialects: ["postgres"],
    name: "index_projections_fts_document_idx",
    purpose: "Search FTS projections with database-native full-text indexes",
    tableName: "index_projections",
    using: {
      postgres: "GIN",
    },
  },
  {
    columns: ["knowledge_space_id", "id"],
    name: "index_projections_space_id_uq",
    purpose: "Bind projection-owned child records to their knowledge space",
    tableName: "index_projections",
    unique: true,
  },
  {
    columns: ["knowledge_space_id", "type", "id"],
    name: "index_projections_fts_backfill_idx",
    purpose: "Resume bounded TiDB lexical posting backfills inside one knowledge space",
    tableName: "index_projections",
  },
  {
    columns: ["projection_id", "tokenizer_version", "term_hash"],
    name: "index_projection_fts_postings_projection_term_uq",
    purpose: "Keep one deterministic tokenizer term per FTS projection",
    tableName: "index_projection_fts_postings",
    unique: true,
  },
  {
    columns: ["knowledge_space_id", "term_hash", "projection_id"],
    name: "index_projection_fts_postings_lookup_idx",
    purpose: "Bound TiDB lexical candidates by space and fixed-width term hash before ranking",
    tableName: "index_projection_fts_postings",
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "tokenizer_version"],
    name: "tidb_fts_posting_backfills_space_tokenizer_uq",
    purpose: "Create one durable lexical-posting repair ledger per tenant-scoped vector space",
    tableName: "tidb_fts_posting_backfills",
    unique: true,
  },
  {
    columns: ["run_state", "lease_expires_at", "updated_at", "id"],
    name: "tidb_fts_posting_backfills_claim_idx",
    purpose: "Lease queued or expired TiDB lexical-posting repair work without scanning history",
    tableName: "tidb_fts_posting_backfills",
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "tokenizer_version", "id"],
    name: "tidb_fts_posting_backfills_scope_idx",
    purpose: "Resolve TiDB lexical-posting readiness for one tenant-scoped knowledge space",
    tableName: "tidb_fts_posting_backfills",
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "fingerprint"],
    name: "projection_set_publications_space_fingerprint_uq",
    purpose: "Create one immutable projection publication per tenant-scoped fingerprint",
    tableName: "projection_set_publications",
    unique: true,
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "id"],
    name: "projection_set_publications_space_id_uq",
    purpose: "Enforce tenant and space ownership for publication-head foreign keys",
    tableName: "projection_set_publications",
    unique: true,
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "id", "fingerprint"],
    name: "projection_set_publications_space_id_fingerprint_uq",
    purpose: "Bind compilation candidates to their immutable publication fingerprint",
    tableName: "projection_set_publications",
    unique: true,
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "status", "updated_at", "fingerprint", "id"],
    name: "projection_set_publications_space_status_updated_idx",
    purpose: "List publication state and GC candidates without cross-tenant scans",
    tableName: "projection_set_publications",
  },
  {
    columns: ["tenant_id", "knowledge_space_id"],
    name: "projection_set_publication_heads_space_uq",
    purpose: "Guarantee one CAS-controlled published projection head per tenant-scoped space",
    tableName: "projection_set_publication_heads",
    unique: true,
  },
  {
    columns: ["publication_id"],
    name: "projection_set_publication_heads_publication_uq",
    purpose: "Prevent one projection publication from becoming the head of multiple spaces",
    tableName: "projection_set_publication_heads",
    unique: true,
  },
  {
    columns: ["publication_id", "component_type", "component_key"],
    name: "projection_set_publication_members_component_uq",
    purpose: "Bind each derived component once to an immutable publication",
    tableName: "projection_set_publication_members",
    unique: true,
  },
  {
    columns: [
      "tenant_id",
      "knowledge_space_id",
      "generation_id",
      "publication_id",
      "component_type",
      "component_key",
    ],
    name: "projection_set_publication_members_generation_idx",
    purpose: "Determine whether an immutable build generation is reachable from publications",
    tableName: "projection_set_publication_members",
  },
  {
    columns: [
      "tenant_id",
      "knowledge_space_id",
      "publication_id",
      "document_asset_id",
      "component_type",
      "component_key",
    ],
    name: "projection_set_publication_members_document_idx",
    purpose: "Replace one document's publication members without scanning the full space",
    tableName: "projection_set_publication_members",
  },
  {
    columns: [
      "tenant_id",
      "knowledge_space_id",
      "document_asset_id",
      "document_version",
      "active_slot",
    ],
    name: "document_compilation_attempts_scope_version_active_uq",
    purpose: "Guarantee one active durable compilation attempt per tenant-scoped document version",
    tableName: "document_compilation_attempts",
    unique: true,
  },
  {
    columns: ["run_state", "retry_at", "created_at", "id"],
    name: "document_compilation_attempts_run_schedule_idx",
    purpose: "Lease runnable or retryable compilation attempts without scanning attempt history",
    tableName: "document_compilation_attempts",
  },
  {
    columns: ["run_state", "lease_expires_at", "heartbeat_at", "id"],
    name: "document_compilation_attempts_lease_recovery_idx",
    purpose: "Recover expired compilation leases with stable keyset ordering",
    tableName: "document_compilation_attempts",
  },
  {
    columns: ["knowledge_space_id", "document_asset_id", "document_version", "id"],
    name: "document_compilation_attempts_document_version_idx",
    purpose: "Validate document-version ownership and cascade deletes without scanning attempts",
    tableName: "document_compilation_attempts",
  },
  {
    columns: [
      "tenant_id",
      "knowledge_space_id",
      "candidate_publication_id",
      "candidate_fingerprint",
      "id",
    ],
    name: "document_compilation_attempts_candidate_idx",
    purpose: "Validate candidate publication ownership and restricted deletes without full scans",
    tableName: "document_compilation_attempts",
  },
  {
    columns: ["tenant_id", "completed_at", "id"],
    name: "document_compilation_attempts_tenant_completed_idx",
    purpose: "Clean completed attempt history per tenant without scanning active rows",
    tableName: "document_compilation_attempts",
  },
  {
    columns: ["knowledge_space_id", "id"],
    name: "sources_space_id_uq",
    purpose: "Bind provider-backed logical documents to a source in the same knowledge space",
    tableName: "sources",
    unique: true,
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "id"],
    name: "document_compilation_attempts_scope_id_uq",
    purpose: "Resolve exact attempt-scoped logical mutations without crossing tenants or spaces",
    tableName: "document_compilation_attempts",
    unique: true,
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "created_at", "id"],
    name: "document_compilation_attempts_space_cursor_idx",
    purpose: "List document processing tasks with stable space-scoped keyset pagination",
    tableName: "document_compilation_attempts",
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "id"],
    name: "logical_documents_scope_id_uq",
    purpose: "Bind immutable revisions to one tenant-scoped logical document",
    tableName: "logical_documents",
    unique: true,
  },
  {
    columns: ["provider_item_digest"],
    name: "logical_documents_provider_item_uq",
    purpose:
      "Preserve one stable logical identity with a bounded collision-checked provider digest",
    tableName: "logical_documents",
    unique: true,
    where: {
      postgres: '"provider_item_digest" IS NOT NULL',
    },
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "created_at", "id"],
    name: "logical_documents_space_cursor_idx",
    purpose: "List logical documents with stable tenant and space isolation",
    tableName: "logical_documents",
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "document_id", "revision"],
    name: "document_revisions_scope_revision_uq",
    purpose: "Give every logical document revision one immutable scoped identity",
    tableName: "document_revisions",
    unique: true,
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "document_asset_id", "document_asset_version"],
    name: "document_revisions_asset_idx",
    purpose: "Resolve logical history that retains one physical asset version",
    tableName: "document_revisions",
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "compilation_attempt_id"],
    name: "document_revisions_compilation_attempt_uq",
    purpose: "Bind at most one logical candidate revision to an exact compilation attempt",
    tableName: "document_revisions",
    unique: true,
    where: { postgres: '"compilation_attempt_id" IS NOT NULL' },
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "document_id", "revision"],
    name: "document_revisions_history_idx",
    purpose: "Page immutable revision history without scanning another document",
    tableName: "document_revisions",
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "document_id", "document_revision", "id"],
    name: "document_revision_chunks_scope_id_uq",
    purpose: "Bind chunk state and parent references to one immutable document revision",
    tableName: "document_revision_chunks",
    unique: true,
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "document_id", "document_revision", "ordinal"],
    name: "document_revision_chunks_ordinal_uq",
    purpose: "Guarantee deterministic chunk ordering within an immutable revision",
    tableName: "document_revision_chunks",
    unique: true,
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "document_id", "document_revision", "id"],
    name: "document_revision_chunks_cursor_idx",
    purpose: "List immutable chunks with stable scoped keyset pagination",
    tableName: "document_revision_chunks",
  },
  {
    columns: [
      "tenant_id",
      "knowledge_space_id",
      "document_id",
      "document_revision",
      "chunk_id",
      "candidate_publication_id",
    ],
    name: "document_chunk_state_changes_candidate_uq",
    purpose: "Deduplicate a chunk state mutation within one candidate publication",
    tableName: "document_chunk_state_changes",
    unique: true,
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "compilation_attempt_id"],
    name: "document_chunk_state_changes_attempt_uq",
    purpose: "Bind one chunk-state candidate to an exact durable compilation attempt",
    tableName: "document_chunk_state_changes",
    unique: true,
  },
  {
    columns: ["chunk_id", "state", "activated_at", "id"],
    name: "document_chunk_state_changes_active_idx",
    purpose: "Resolve the active enablement state for a revision chunk",
    tableName: "document_chunk_state_changes",
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "document_id", "revision"],
    name: "document_settings_revisions_scope_revision_uq",
    purpose: "Give every immutable document-settings revision a scoped identity",
    tableName: "document_settings_revisions",
    unique: true,
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "document_id"],
    name: "document_settings_heads_scope_uq",
    purpose: "Guarantee one CAS-controlled active settings head per logical document",
    tableName: "document_settings_heads",
    unique: true,
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "document_id", "active_slot"],
    name: "document_reindex_attempts_active_uq",
    purpose: "Allow only one active settings reindex attempt per logical document",
    tableName: "document_reindex_attempts",
    unique: true,
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "document_id", "created_at", "id"],
    name: "document_reindex_attempts_cursor_idx",
    purpose: "List settings reindex history with stable document-scoped pagination",
    tableName: "document_reindex_attempts",
  },
  {
    columns: ["attempt_id", "event_type"],
    name: "document_compilation_outbox_attempt_event_uq",
    purpose: "Emit each durable attempt event at most once",
    tableName: "document_compilation_outbox",
    unique: true,
  },
  {
    columns: ["idempotency_key"],
    name: "document_compilation_outbox_idempotency_uq",
    purpose: "Deduplicate dispatcher retries independently of queue provider delivery IDs",
    tableName: "document_compilation_outbox",
    unique: true,
  },
  {
    columns: ["status", "available_at", "created_at", "id"],
    name: "document_compilation_outbox_delivery_due_idx",
    purpose: "Lease due or visibility-expired outbox deliveries without a full scan",
    tableName: "document_compilation_outbox",
  },
  {
    columns: ["status", "locked_until", "created_at", "id"],
    name: "document_compilation_outbox_lock_recovery_idx",
    purpose: "Recover expired dispatcher locks without scanning pending deliveries",
    tableName: "document_compilation_outbox",
  },
  {
    columns: ["tenant_id", "idempotency_key"],
    name: "deletion_jobs_idempotency_uq",
    purpose: "Return the exact durable deletion request for tenant-scoped retries",
    tableName: "deletion_jobs",
    unique: true,
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "id"],
    name: "deletion_jobs_scope_id_uq",
    purpose: "Bind Source bulk-removal observers to a deletion job in the same tenant and space",
    tableName: "deletion_jobs",
    unique: true,
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "target_type", "target_id", "active_slot"],
    name: "deletion_jobs_target_active_uq",
    purpose: "Allow only one active durable deletion workflow per target",
    tableName: "deletion_jobs",
    unique: true,
  },
  {
    columns: ["run_state", "retry_at", "lease_expires_at", "created_at", "id"],
    name: "deletion_jobs_claim_idx",
    purpose: "Lease runnable or expired deletion work without scanning job history",
    tableName: "deletion_jobs",
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "created_at", "id"],
    name: "deletion_jobs_scope_history_idx",
    purpose: "List durable deletion history within one tenant-scoped knowledge space",
    tableName: "deletion_jobs",
  },
  {
    columns: [
      "tenant_id",
      "knowledge_space_id",
      "requested_by_subject_id",
      "api_key_id",
      "api_key_revision",
      "created_at",
      "id",
    ],
    name: "deletion_jobs_requester_provenance_idx",
    purpose: "Authorize deletion status and retry using copied subject and API-key provenance",
    tableName: "deletion_jobs",
  },
  {
    columns: ["tenant_id", "target_type", "target_id"],
    name: "deletion_tombstones_target_uq",
    purpose: "Provide a permanent exact target fence after its resource row is deleted",
    tableName: "deletion_tombstones",
    unique: true,
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "target_type", "target_id"],
    name: "deletion_tombstones_space_target_idx",
    purpose: "Fence all writers and readers inside one deleting knowledge space",
    tableName: "deletion_tombstones",
  },
  {
    columns: ["deletion_job_id", "id"],
    name: "deletion_tombstones_job_idx",
    purpose: "Resolve the permanent tombstone created by a durable deletion job",
    tableName: "deletion_tombstones",
  },
  {
    columns: ["deletion_job_id", "idempotency_key"],
    name: "deletion_job_items_idempotency_uq",
    purpose: "Append external deletion inventory idempotently after crash recovery",
    tableName: "deletion_job_items",
    unique: true,
  },
  {
    columns: ["deletion_job_id", "ordinal"],
    name: "deletion_job_items_ordinal_uq",
    purpose: "Keep a deterministic bounded work order inside one deletion job",
    tableName: "deletion_job_items",
    unique: true,
  },
  {
    columns: ["deletion_job_id", "status", "next_attempt_at", "ordinal", "id"],
    name: "deletion_job_items_work_idx",
    purpose: "Resume due external deletion items without scanning completed inventory",
    tableName: "deletion_job_items",
  },
  {
    columns: ["deletion_job_id", "kind", "resource_id", "id"],
    name: "deletion_job_items_resource_idx",
    purpose: "Reconcile child document and exact external-key work by resource",
    tableName: "deletion_job_items",
  },
  {
    columns: ["idempotency_key"],
    name: "deletion_outbox_idempotency_uq",
    purpose: "Deduplicate deletion queue dispatch independently of broker IDs",
    tableName: "deletion_outbox",
    unique: true,
  },
  {
    columns: ["deletion_job_id", "delivery_revision"],
    name: "deletion_outbox_job_delivery_uq",
    purpose: "Emit each deletion job delivery revision at most once",
    tableName: "deletion_outbox",
    unique: true,
  },
  {
    columns: ["deletion_job_id", "request_idempotency_key"],
    name: "deletion_outbox_job_request_uq",
    purpose: "Replay or reject each failed-job retry request by its exact keyed fingerprint",
    tableName: "deletion_outbox",
    unique: true,
  },
  {
    columns: ["status", "available_at", "locked_until", "id"],
    name: "deletion_outbox_claim_idx",
    purpose: "Lease due or visibility-expired deletion outbox events",
    tableName: "deletion_outbox",
  },
  {
    columns: ["deletion_job_id", "request_idempotency_key"],
    name: "deletion_retry_audits_job_request_uq",
    purpose: "Persist one immutable actor audit for each manual retry request",
    tableName: "deletion_retry_audits",
    unique: true,
  },
  {
    columns: ["outbox_id"],
    name: "deletion_retry_audits_outbox_uq",
    purpose: "Bind every retry audit to exactly one durable outbox delivery",
    tableName: "deletion_retry_audits",
    unique: true,
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "actor_subject_id", "created_at", "id"],
    name: "deletion_retry_audits_actor_idx",
    purpose: "Review retry and owner-rescue actions by tenant-scoped actor",
    tableName: "deletion_retry_audits",
  },
  {
    columns: ["tenant_id", "knowledge_space_id"],
    name: "legacy_space_bootstraps_space_uq",
    purpose: "Keep one fail-closed legacy cutover ledger per tenant-scoped space",
    tableName: "legacy_space_publication_bootstraps",
    unique: true,
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "idempotency_key"],
    name: "legacy_space_bootstraps_idempotency_uq",
    purpose: "Deduplicate retries of the one-time legacy publication bootstrap",
    tableName: "legacy_space_publication_bootstraps",
    unique: true,
  },
  {
    columns: ["run_state", "lease_expires_at", "updated_at", "id"],
    name: "legacy_space_bootstraps_claim_idx",
    purpose: "Lease runnable or expired whole-space bootstrap jobs without scanning history",
    tableName: "legacy_space_publication_bootstraps",
  },
  {
    columns: ["bootstrap_id", "ordinal"],
    name: "legacy_space_bootstrap_items_ordinal_uq",
    purpose: "Freeze one deterministic document order inside a bootstrap snapshot",
    tableName: "legacy_space_publication_bootstrap_items",
    unique: true,
  },
  {
    columns: ["bootstrap_id", "status", "ordinal", "document_asset_id"],
    name: "legacy_space_bootstrap_items_next_idx",
    purpose: "Resume the next incomplete document without scanning completed bootstrap items",
    tableName: "legacy_space_publication_bootstrap_items",
  },
  {
    columns: ["compilation_attempt_id", "bootstrap_id", "document_asset_id"],
    name: "legacy_space_bootstrap_items_attempt_idx",
    purpose: "Reconcile retained compilation attempts back to their bootstrap item",
    tableName: "legacy_space_publication_bootstrap_items",
  },
  {
    columns: ["tenant_id", "knowledge_space_id"],
    name: "knowledge_space_mutation_leases_space_uq",
    purpose: "Serialize document mutations against whole-space bootstrap snapshot capture",
    tableName: "knowledge_space_mutation_leases",
    unique: true,
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "publication_id"],
    name: "page_index_upgrade_backfills_publication_uq",
    purpose: "Create one immutable PageIndex upgrade ledger for each frozen publication head",
    tableName: "page_index_upgrade_backfills",
    unique: true,
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "head_revision", "updated_at", "id"],
    name: "page_index_upgrade_backfills_scope_idx",
    purpose: "Resolve the PageIndex upgrade state for a tenant-scoped current head",
    tableName: "page_index_upgrade_backfills",
  },
  {
    columns: ["run_state", "lease_expires_at", "updated_at", "id"],
    name: "page_index_upgrade_backfills_claim_idx",
    purpose: "Recover and lease durable PageIndex upgrade work without scanning history",
    tableName: "page_index_upgrade_backfills",
  },
  {
    columns: ["backfill_id", "ordinal"],
    name: "page_index_upgrade_items_ordinal_uq",
    purpose: "Freeze a deterministic outline order inside one PageIndex upgrade job",
    tableName: "page_index_upgrade_backfill_items",
    unique: true,
  },
  {
    columns: ["backfill_id", "status", "ordinal", "document_outline_id"],
    name: "page_index_upgrade_items_next_idx",
    purpose: "Resume the next incomplete frozen PageIndex outline after a crash",
    tableName: "page_index_upgrade_backfill_items",
  },
  {
    columns: ["model_id", "version"],
    name: "embedding_models_model_version_uq",
    purpose: "Resolve versioned embedding model registry entries without scanning model history",
    tableName: "embedding_models",
    unique: true,
  },
  {
    columns: ["status", "provider", "model_id", "id"],
    name: "embedding_models_status_provider_idx",
    purpose: "List active or candidate embedding models with stable keyset pagination",
    tableName: "embedding_models",
  },
  {
    columns: ["status", "model_id", "id"],
    name: "embedding_models_status_model_idx",
    purpose:
      "List active or candidate embedding models across providers with stable keyset pagination",
    tableName: "embedding_models",
  },
  {
    columns: ["knowledge_space_id", "virtual_path", "publication_generation_id"],
    columnsByDialect: {
      tidb: ["knowledge_space_id", "virtual_path", "publication_generation_key"],
    },
    expressions: {
      postgres: {
        publication_generation_id: `COALESCE("publication_generation_id", '${PUBLICATION_GENERATION_ID_SENTINEL}'::uuid)`,
      },
    },
    name: "knowledge_paths_space_path_uq",
    purpose: "Resolve one KnowledgeFS virtual path per immutable build generation",
    tableName: "knowledge_paths",
    unique: true,
  },
  {
    columns: ["resource_type", "target_id"],
    name: "knowledge_paths_target_idx",
    purpose: "Find mounted paths for a resource without scanning path records",
    tableName: "knowledge_paths",
  },
  {
    columns: [
      "knowledge_space_id",
      "publication_generation_id",
      "view_type",
      "view_name",
      "virtual_path",
      "id",
    ],
    name: "knowledge_paths_space_view_path_idx",
    purpose: "List KnowledgeFS physical or semantic views with stable keyset pagination",
    tableName: "knowledge_paths",
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "created_at", "id"],
    name: "evidence_bundles_scope_created_idx",
    purpose: "Read and purge evidence bundles inside an exact tenant/space boundary",
    tableName: "evidence_bundles",
  },
  {
    columns: ["trace_id"],
    name: "evidence_bundles_trace_idx",
    purpose: "Load evidence bundles from answer traces without extra scans",
    tableName: "evidence_bundles",
  },
  {
    columns: ["state", "created_at", "id"],
    name: "evidence_bundles_state_created_idx",
    purpose: "Inspect answerability trends without full bundle scans",
    tableName: "evidence_bundles",
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "id"],
    name: "golden_questions_space_id_idx",
    purpose: "Resolve golden questions inside a tenant-scoped knowledge space",
    tableName: "golden_questions",
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "requested_by_subject_id", "created_at", "id"],
    name: "failed_queries_subject_created_idx",
    purpose: "Apply failed-query subject provenance before keyset pagination and aggregation",
    tableName: "failed_queries",
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "created_at", "id"],
    name: "golden_questions_space_created_idx",
    purpose: "List golden questions with stable keyset pagination",
    tableName: "golden_questions",
  },
  {
    columns: ["knowledge_space_id", "created_at", "id"],
    name: "answer_traces_space_created_idx",
    purpose: "List recent traces by knowledge space without scanning all tenants",
    tableName: "answer_traces",
  },
  {
    columns: ["knowledge_space_id", "id"],
    name: "answer_traces_space_id_uq",
    purpose: "Bind quality review records to an answer trace in the same knowledge space",
    tableName: "answer_traces",
    unique: true,
  },
  {
    columns: ["evidence_bundle_id"],
    name: "answer_traces_bundle_idx",
    purpose: "Join traces to evidence bundles without N+1 follow-up queries",
    tableName: "answer_traces",
  },
  {
    columns: ["knowledge_space_id", "subject_id", "created_at", "id"],
    name: "answer_traces_space_subject_created_idx",
    purpose: "Read member-owned trace evidence without scanning other members' traces",
    tableName: "answer_traces",
  },
  {
    columns: ["trace_id", "started_at", "id"],
    name: "answer_trace_steps_trace_started_idx",
    purpose: "Load trace steps in order with one indexed query",
    tableName: "answer_trace_steps",
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "id"],
    name: "quality_replay_runs_scope_id_uq",
    purpose: "Bind bad-case replay references to an exact tenant and knowledge space",
    tableName: "quality_replay_runs",
    unique: true,
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "idempotency_key"],
    name: "quality_replay_runs_idempotency_uq",
    purpose: "Deduplicate replay admission inside one exact tenant-space boundary",
    tableName: "quality_replay_runs",
    unique: true,
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "created_at", "id"],
    name: "quality_replay_runs_scope_created_idx",
    purpose: "List candidate-authorized replay history with bounded keyset pagination",
    tableName: "quality_replay_runs",
  },
  {
    columns: ["state", "lease_expires_at", "created_at", "id"],
    name: "quality_replay_runs_claim_idx",
    purpose: "Recover queued or expired durable replay work without a full scan",
    tableName: "quality_replay_runs",
  },
  {
    columns: ["run_id", "ordinal"],
    name: "quality_replay_items_run_ordinal_uq",
    purpose: "Checkpoint each golden question exactly once in deterministic replay order",
    tableName: "quality_replay_items",
    unique: true,
  },
  {
    columns: ["run_id", "golden_question_id"],
    name: "quality_replay_items_run_golden_uq",
    purpose: "Prevent duplicate golden questions inside one durable replay",
    tableName: "quality_replay_items",
    unique: true,
  },
  {
    columns: ["run_id", "delivery_revision"],
    name: "quality_replay_outbox_run_delivery_uq",
    purpose: "Issue each durable replay delivery revision exactly once",
    tableName: "quality_replay_outbox",
    unique: true,
  },
  {
    columns: ["delivery_state", "lease_expires_at", "created_at", "id"],
    name: "quality_replay_outbox_claim_idx",
    purpose: "Lease pending or expired quality replay outbox events without a full scan",
    tableName: "quality_replay_outbox",
  },
  {
    columns: ["run_id", "delivery_state", "id"],
    name: "quality_replay_outbox_run_idx",
    purpose: "Finalize and prove replay outbox delivery by run",
    tableName: "quality_replay_outbox",
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "status", "created_at", "id"],
    name: "quality_bad_cases_scope_status_idx",
    purpose: "List production bad cases by lifecycle with bounded keyset pagination",
    tableName: "quality_bad_cases",
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "trace_id", "item_key"],
    name: "quality_missing_reviews_item_uq",
    purpose: "Keep one CAS review state per immutable trace missing-evidence item",
    tableName: "quality_missing_evidence_reviews",
    unique: true,
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "aggregate_type", "aggregate_id", "revision"],
    name: "quality_resource_history_revision_uq",
    purpose: "Keep an append-only ordered audit history for quality review resources",
    tableName: "quality_resource_history",
    unique: true,
  },
  {
    columns: ["knowledge_space_id", "created_at", "id"],
    name: "failed_queries_space_created_idx",
    purpose: "Aggregate bounded failed-query trends without indexing the legacy TEXT mode column",
    tableName: "failed_queries",
  },
  {
    columns: ["knowledge_space_id", "canonical_key", "publication_generation_id"],
    columnsByDialect: {
      tidb: ["knowledge_space_id", "canonical_key", "publication_generation_key"],
    },
    expressions: {
      postgres: {
        publication_generation_id: `COALESCE("publication_generation_id", '${PUBLICATION_GENERATION_ID_SENTINEL}'::uuid)`,
      },
    },
    name: "graph_entities_space_key_uq",
    purpose: "Deduplicate canonical graph entities inside one immutable build generation",
    tableName: "graph_entities",
    unique: true,
  },
  {
    columns: ["knowledge_space_id", "publication_generation_id", "type", "name", "id"],
    name: "graph_entities_space_type_name_idx",
    purpose: "List graph entities by type and name with stable keyset pagination",
    tableName: "graph_entities",
  },
  {
    columns: ["permission_scope"],
    dialects: ["postgres"],
    name: "graph_entities_permission_scope_idx",
    purpose: "Filter graph entities by permission scope before semantic views",
    tableName: "graph_entities",
    using: {
      postgres: "GIN",
    },
  },
  {
    columns: [
      "knowledge_space_id",
      "subject_entity_id",
      "type",
      "object_entity_id",
      "extraction_version",
      "publication_generation_id",
    ],
    columnsByDialect: {
      tidb: [
        "knowledge_space_id",
        "subject_entity_id",
        "type",
        "object_entity_id",
        "extraction_version",
        "publication_generation_key",
      ],
    },
    expressions: {
      postgres: {
        publication_generation_id: `COALESCE("publication_generation_id", '${PUBLICATION_GENERATION_ID_SENTINEL}'::uuid)`,
      },
    },
    name: "graph_relations_space_edge_version_uq",
    purpose: "Deduplicate graph edges inside one extraction and immutable build generation",
    tableName: "graph_relations",
    unique: true,
  },
  {
    columns: [
      "knowledge_space_id",
      "publication_generation_id",
      "subject_entity_id",
      "type",
      "object_entity_id",
      "id",
    ],
    name: "graph_relations_subject_traversal_idx",
    purpose: "Traverse outgoing graph relations without scanning all edges",
    tableName: "graph_relations",
  },
  {
    columns: [
      "knowledge_space_id",
      "publication_generation_id",
      "object_entity_id",
      "type",
      "subject_entity_id",
      "id",
    ],
    name: "graph_relations_object_traversal_idx",
    purpose: "Traverse incoming graph relations without scanning all edges",
    tableName: "graph_relations",
  },
  {
    columns: ["permission_scope"],
    dialects: ["postgres"],
    name: "graph_relations_permission_scope_idx",
    purpose: "Filter graph relations by permission scope before traversal expansion",
    tableName: "graph_relations",
    using: {
      postgres: "GIN",
    },
  },
  {
    columns: ["document_asset_id", "version", "publication_generation_id"],
    columnsByDialect: {
      tidb: ["document_asset_id", "version", "publication_generation_key"],
    },
    expressions: {
      postgres: {
        publication_generation_id: `COALESCE("publication_generation_id", '${PUBLICATION_GENERATION_ID_SENTINEL}'::uuid)`,
      },
    },
    name: "document_outlines_asset_version_uq",
    purpose: "Store one outline per document version and immutable build generation",
    tableName: "document_outlines",
    unique: true,
  },
  {
    columns: ["knowledge_space_id", "document_outline_id", "publication_generation_id"],
    name: "page_index_manifests_outline_generation_uq",
    purpose: "Materialize one exact PageIndex for an immutable outline generation",
    tableName: "page_index_manifests",
    unique: true,
  },
  {
    columns: [
      "knowledge_space_id",
      "status",
      "document_outline_id",
      "publication_generation_id",
      "id",
    ],
    name: "page_index_manifests_ready_scope_idx",
    purpose: "Prove published outline PageIndex readiness without scanning manifests",
    tableName: "page_index_manifests",
  },
  {
    columns: ["document_asset_id", "publication_generation_id", "id"],
    name: "page_index_manifests_document_idx",
    purpose: "Delete all PageIndex manifests for one tombstoned document without a table scan",
    tableName: "page_index_manifests",
  },
  {
    columns: ["manifest_id", "outline_node_id"],
    name: "page_index_nodes_manifest_outline_node_uq",
    purpose: "Resolve an exact flattened outline node inside one PageIndex manifest",
    tableName: "page_index_nodes",
    unique: true,
  },
  {
    columns: ["manifest_id", "id"],
    name: "page_index_nodes_manifest_id_idx",
    purpose: "Validate and traverse one bounded flattened PageIndex manifest",
    tableName: "page_index_nodes",
  },
  {
    columns: ["manifest_id", "page_index_node_id", "term"],
    name: "page_index_terms_manifest_node_term_uq",
    purpose: "Store each exact normalized term once per PageIndex node",
    tableName: "page_index_terms",
    unique: true,
  },
  {
    columns: ["knowledge_space_id", "term", "page_index_node_id", "manifest_id", "field_mask"],
    name: "page_index_terms_exact_lookup_idx",
    purpose: "Find bounded PageIndex section candidates by exact normalized term",
    tableName: "page_index_terms",
  },
  {
    columns: ["knowledge_space_id", "manifest_id", "term", "page_index_node_id", "field_mask"],
    name: "page_index_terms_manifest_lookup_idx",
    purpose:
      "Bound exact-term candidates to immutable current-publication manifests before scoring",
    tableName: "page_index_terms",
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "subject_id"],
    name: "knowledge_space_members_scope_subject_uq",
    purpose: "Resolve exactly one role for a tenant-scoped knowledge-space subject",
    tableName: "knowledge_space_members",
    unique: true,
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "role", "subject_id", "id"],
    name: "knowledge_space_members_scope_role_idx",
    purpose: "List members and lock owners without scanning another tenant or space",
    tableName: "knowledge_space_members",
  },
  {
    columns: ["tenant_id", "knowledge_space_id"],
    name: "knowledge_space_access_policies_scope_uq",
    purpose: "Store exactly one CAS-versioned visibility policy per knowledge space",
    tableName: "knowledge_space_access_policies",
    unique: true,
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "id"],
    name: "knowledge_space_access_policies_scope_id_uq",
    purpose: "Anchor tenant-safe partial-policy membership foreign keys",
    tableName: "knowledge_space_access_policies",
    unique: true,
  },
  {
    columns: ["access_policy_id", "subject_id"],
    name: "knowledge_space_access_policy_members_policy_subject_uq",
    purpose: "Include each subject at most once in a partial-members visibility policy",
    tableName: "knowledge_space_access_policy_members",
    unique: true,
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "subject_id", "access_policy_id"],
    name: "knowledge_space_access_policy_members_scope_subject_idx",
    purpose: "Enforce partial-member authorization in SQL before pagination",
    tableName: "knowledge_space_access_policy_members",
  },
  {
    columns: ["tenant_id", "knowledge_space_id"],
    name: "knowledge_space_api_access_scope_uq",
    purpose: "Store exactly one CAS-versioned API-access switch per knowledge space",
    tableName: "knowledge_space_api_access",
    unique: true,
  },
  {
    columns: ["key_hash"],
    name: "knowledge_space_api_keys_hash_uq",
    purpose: "Authenticate API keys by a non-reversible digest without storing plaintext secrets",
    tableName: "knowledge_space_api_keys",
    unique: true,
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "status", "created_at", "id"],
    name: "knowledge_space_api_keys_scope_status_idx",
    purpose: "List and revoke active keys inside one tenant-scoped knowledge space",
    tableName: "knowledge_space_api_keys",
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "created_at", "id"],
    name: "knowledge_space_api_keys_scope_created_idx",
    purpose: "List every key with stable keyset pagination regardless of status",
    tableName: "knowledge_space_api_keys",
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "id"],
    name: "knowledge_space_api_keys_scope_id_uq",
    purpose: "Bind durable permission snapshots to an API key in the same tenant and space",
    tableName: "knowledge_space_api_keys",
    unique: true,
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "subject_id", "status", "expires_at", "id"],
    name: "knowledge_space_permission_snapshots_scope_subject_idx",
    purpose: "Revalidate or revoke active durable permission snapshots by subject and expiry",
    tableName: "knowledge_space_permission_snapshots",
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "api_key_id", "api_key_revision"],
    name: "knowledge_space_permission_snapshots_api_key_idx",
    purpose: "Revalidate durable grants against the exact API-key revision and expiry",
    tableName: "knowledge_space_permission_snapshots",
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "id", "subject_id", "access_channel"],
    name: "knowledge_space_permission_snapshots_provenance_uq",
    purpose: "Bind durable Research jobs to the exact tenant, space, subject, and caller channel",
    tableName: "knowledge_space_permission_snapshots",
    unique: true,
  },
  {
    columns: ["knowledge_space_id", "id", "subject_id", "access_channel"],
    name: "knowledge_space_permission_snapshots_trace_provenance_uq",
    purpose: "Bind AnswerTrace rows to the exact space, subject, and caller channel",
    tableName: "knowledge_space_permission_snapshots",
    unique: true,
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "id"],
    name: "knowledge_space_permission_snapshots_scope_id_uq",
    purpose: "Resolve a durable permission snapshot only inside its tenant and knowledge space",
    tableName: "knowledge_space_permission_snapshots",
    unique: true,
  },
  {
    columns: ["knowledge_space_id", "id"],
    name: "knowledge_space_permission_snapshots_space_id_uq",
    purpose: "Bind derived AnswerTrace rows to a snapshot in the same knowledge space",
    tableName: "knowledge_space_permission_snapshots",
    unique: true,
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "updated_at", "id"],
    name: "research_task_jobs_scope_updated_idx",
    purpose: "List durable Research tasks within one tenant-scoped knowledge space",
    tableName: "research_task_jobs",
  },
  {
    columns: ["queue_job_id", "id"],
    name: "research_task_jobs_queue_idx",
    purpose: "Fence a broker delivery to its current durable Research task",
    tableName: "research_task_jobs",
  },
  {
    columns: ["stage", "lease_expires_at", "retry_at", "id"],
    name: "research_task_jobs_lease_idx",
    purpose: "Recover expired Research executions and scheduled retries",
    tableName: "research_task_jobs",
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "id"],
    name: "research_task_jobs_scope_id_uq",
    purpose: "Enforce tenant and knowledge-space ownership for durable Research child rows",
    tableName: "research_task_jobs",
    unique: true,
  },
  {
    columns: ["idempotency_key"],
    name: "research_task_outbox_idempotency_uq",
    purpose: "Make Research broker dispatch idempotent across process restarts",
    tableName: "research_task_outbox",
    unique: true,
  },
  {
    columns: ["research_task_job_id", "delivery_revision"],
    name: "research_task_outbox_job_delivery_uq",
    purpose: "Persist exactly one delivery request for each Research resume revision",
    tableName: "research_task_outbox",
    unique: true,
  },
  {
    columns: ["status", "available_at", "locked_until", "id"],
    name: "research_task_outbox_claim_idx",
    purpose: "Claim pending or expired Research outbox rows without scanning completed events",
    tableName: "research_task_outbox",
  },
  {
    columns: ["research_task_job_id", "sequence"],
    name: "research_task_partials_job_sequence_uq",
    purpose: "Give each durable Research partial a stable monotonic sequence",
    tableName: "research_task_partial_results",
    unique: true,
  },
  {
    columns: ["research_task_job_id", "idempotency_key"],
    name: "research_task_partials_job_idempotency_uq",
    purpose: "Prevent duplicate evidence after a Research worker retry",
    tableName: "research_task_partial_results",
    unique: true,
  },
  {
    columns: ["tenant_id", "research_task_job_id", "sequence", "id"],
    name: "research_task_partials_scope_job_sequence_idx",
    purpose: "Page durable Research partials only inside the owning tenant and task",
    tableName: "research_task_partial_results",
  },
  {
    columns: ["research_task_job_id", "sequence"],
    name: "research_task_progress_job_sequence_uq",
    purpose: "Give each durable Research progress event a stable task-local sequence",
    tableName: "research_task_progress_events",
    unique: true,
  },
  {
    columns: ["research_task_job_id", "idempotency_key"],
    name: "research_task_progress_job_idempotency_uq",
    purpose: "Suppress duplicate Research progress events after worker replay",
    tableName: "research_task_progress_events",
    unique: true,
  },
  {
    columns: ["tenant_id", "research_task_job_id", "sequence", "id"],
    name: "research_task_progress_scope_job_sequence_idx",
    purpose: "Poll durable Research progress from a tenant-scoped task cursor",
    tableName: "research_task_progress_events",
  },
  {
    columns: ["tenant_id", "id", "invalidated_at"],
    name: "agent_workspace_snapshots_tenant_lookup_idx",
    purpose: "Resolve an active Agent workspace snapshot without replica-local state",
    tableName: "agent_workspace_snapshots",
  },
  {
    columns: ["tenant_id", "knowledge_space_id", "invalidated_at", "id"],
    name: "agent_workspace_snapshots_space_cleanup_idx",
    purpose: "Bound invalidation and deletion of Agent workspace snapshots during durable cleanup",
    tableName: "agent_workspace_snapshots",
  },
] as const satisfies readonly IndexDefinition[];

const performanceRequirements = indexes.map(({ name, purpose, tableName }) => ({
  indexName: name,
  purpose,
  tableName,
}));

export function getDatabaseSchema(): DatabaseSchemaCatalog {
  return {
    indexes,
    tables,
  };
}

export function assertPerformanceIndexes(schema: DatabaseSchemaCatalog): {
  readonly missing: readonly PerformanceIndexRequirement[];
  readonly ok: boolean;
} {
  const indexNames = new Set(schema.indexes.map((index) => index.name));
  const missing = performanceRequirements.filter(
    (requirement) => !indexNames.has(requirement.indexName),
  );

  return {
    missing,
    ok: missing.length === 0,
  };
}

export function renderCreateTableSql(dialect: DatabaseDialect, table: TableDefinition): string {
  const columnSql = [
    ...table.columns
      .filter((column) => !column.dialects || column.dialects.includes(dialect))
      .map((column) => {
        const constraints = [quoteIdentifier(dialect, column.name), column.type[dialect]];

        const generatedAs = column.generatedAs?.[dialect];
        if (generatedAs) {
          constraints.push(`GENERATED ALWAYS AS (${generatedAs}) VIRTUAL`);
        }

        if (column.primaryKey) {
          constraints.push("PRIMARY KEY");
        }

        if (!column.nullable && !generatedAs) {
          constraints.push("NOT NULL");
        }

        return constraints.join(" ");
      }),
    ...(table.checkConstraints ?? [])
      .filter((constraint) => !constraint.dialects || constraint.dialects.includes(dialect))
      .map((constraint) => renderCheckConstraintSql(dialect, constraint)),
    ...(table.primaryKey
      ? [
          `PRIMARY KEY (${table.primaryKey.map((column) => quoteIdentifier(dialect, column)).join(", ")})`,
        ]
      : []),
    ...(table.foreignKeys ?? [])
      .filter((foreignKey) => foreignKey.inline !== false)
      .map((foreignKey) => renderForeignKeySql(dialect, foreignKey)),
  ].join(", ");

  return `CREATE TABLE IF NOT EXISTS ${quoteIdentifier(dialect, table.name)} (${columnSql});`;
}

function renderCheckConstraintSql(
  dialect: DatabaseDialect,
  constraint: CheckConstraintDefinition,
): string {
  return `CONSTRAINT ${quoteIdentifier(dialect, constraint.name)} CHECK (${constraint.expression[dialect]})`;
}

function renderForeignKeySql(dialect: DatabaseDialect, foreignKey: ForeignKeyDefinition): string {
  const columns = foreignKey.columns.map((column) => quoteIdentifier(dialect, column)).join(", ");
  const referencedColumns = foreignKey.referencedColumns
    .map((column) => quoteIdentifier(dialect, column))
    .join(", ");
  // TiDB treats an explicit RESTRICT clause as a referential action. That makes a child column
  // ineligible for a CHECK constraint even though omitted ON DELETE has the same RESTRICT
  // semantics. Keep the catalog's intent while rendering the TiDB-compatible default form.
  const referentialAction = foreignKey.onDeleteByDialect?.[dialect] ?? foreignKey.onDelete;
  const onDelete =
    referentialAction && !(dialect === "tidb" && referentialAction === "RESTRICT")
      ? ` ON DELETE ${referentialAction}`
      : "";
  const deferrability = foreignKey.deferrability?.[dialect];
  const deferred = deferrability?.startsWith("DEFERRABLE") ? ` ${deferrability}` : "";
  const constraint = foreignKey.name
    ? `CONSTRAINT ${quoteIdentifier(dialect, foreignKey.name)} `
    : "";

  return `${constraint}FOREIGN KEY (${columns}) REFERENCES ${quoteIdentifier(dialect, foreignKey.referencedTable)} (${referencedColumns})${onDelete}${deferred}`;
}

export function renderCreateIndexSql(dialect: DatabaseDialect, index: IndexDefinition): string {
  if (index.dialects && !index.dialects.includes(dialect)) {
    throw new Error(`Index ${index.name} is not available for ${dialect}`);
  }
  const unique = index.unique ? "UNIQUE " : "";
  const using = index.using?.[dialect] ? ` USING ${index.using[dialect]}` : "";
  const operatorClasses = index.operatorClasses?.[dialect] ?? {};
  const expressions = index.expressions?.[dialect] ?? {};
  const columns = (index.columnsByDialect?.[dialect] ?? index.columns)
    .map((column) => {
      const expression = expressions[column];
      if (expression) {
        return `(${expression})`;
      }

      const operatorClass = operatorClasses[column];

      return operatorClass
        ? `${quoteIdentifier(dialect, column)} ${operatorClass}`
        : quoteIdentifier(dialect, column);
    })
    .join(", ");
  const where = index.where?.[dialect] ? ` WHERE ${index.where[dialect]}` : "";

  if (dialect === "postgres") {
    return `CREATE ${unique}INDEX IF NOT EXISTS ${quoteIdentifier(dialect, index.name)} ON ${quoteIdentifier(dialect, index.tableName)}${using} (${columns})${where};`;
  }

  if (index.using?.tidb === "FULLTEXT") {
    return `CREATE ${unique}FULLTEXT INDEX IF NOT EXISTS ${quoteIdentifier(dialect, index.name)} ON ${quoteIdentifier(dialect, index.tableName)} (${columns})${where};`;
  }

  return `CREATE ${unique}INDEX IF NOT EXISTS ${quoteIdentifier(dialect, index.name)} ON ${quoteIdentifier(dialect, index.tableName)} (${columns})${where};`;
}

export function renderMigrationSql(dialect: DatabaseDialect): readonly string[] {
  const schema = getDatabaseSchema();
  const preTableIndexNames = indexesRequiredByForeignKeys(schema);
  const renderedPreTableIndexes = new Set<string>();
  const statements: string[] = [];

  for (const table of schema.tables) {
    statements.push(renderCreateTableSql(dialect, table));

    for (const index of schema.indexes) {
      if (
        index.tableName === table.name &&
        preTableIndexNames.has(index.name) &&
        (!index.dialects || index.dialects.includes(dialect))
      ) {
        statements.push(renderCreateIndexSql(dialect, index));
        renderedPreTableIndexes.add(index.name);
      }
    }
  }

  return [
    ...statements,
    ...schema.indexes
      .filter(
        (index) =>
          !renderedPreTableIndexes.has(index.name) &&
          (!index.dialects || index.dialects.includes(dialect)),
      )
      .map((index) => renderCreateIndexSql(dialect, index)),
  ];
}

/**
 * Composite foreign keys need a matching unique key before the dependent table is created. Keep
 * the catalog's ordinary indexes deterministic while hoisting only those required for DDL validity.
 */
function indexesRequiredByForeignKeys(schema: DatabaseSchemaCatalog): ReadonlySet<string> {
  const required = new Set<string>();

  for (const table of schema.tables) {
    for (const foreignKey of table.foreignKeys ?? []) {
      if (foreignKey.inline === false) continue;
      const referencedTable = schema.tables.find(
        (candidate) => candidate.name === foreignKey.referencedTable,
      );
      const primaryKeyColumns =
        referencedTable?.columns
          .filter((column) => column.primaryKey)
          .map((column) => column.name) ?? [];

      if (sameColumns(primaryKeyColumns, foreignKey.referencedColumns)) {
        continue;
      }

      const supportingIndex = schema.indexes.find(
        (index) =>
          index.unique === true &&
          index.tableName === foreignKey.referencedTable &&
          sameColumns(index.columns, foreignKey.referencedColumns),
      );

      if (supportingIndex) {
        required.add(supportingIndex.name);
      }
    }
  }

  return required;
}

function sameColumns(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((column, index) => column === right[index]);
}

function quoteIdentifier(dialect: DatabaseDialect, identifier: string): string {
  return dialect === "postgres"
    ? `"${identifier.replaceAll('"', '""')}"`
    : `\`${identifier.replaceAll("`", "``")}\``;
}
