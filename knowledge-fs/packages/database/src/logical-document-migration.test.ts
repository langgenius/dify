import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { getDatabaseSchema } from "./schema";

const root = resolve(import.meta.dirname, "../../..");
const postgres = readFileSync(
  resolve(root, "packages/database/migrations/0022_logical_document_revisions.postgres.sql"),
  "utf8",
);
const tidb = readFileSync(
  resolve(root, "packages/database/migrations/0022_logical_document_revisions.tidb.sql"),
  "utf8",
);

describe("logical document migration", () => {
  it("is replay-safe if TiDB commits a target CHECK drop before its replacement", () => {
    expect(tidb.match(/FROM information_schema\.tidb_check_constraints/g)).toHaveLength(4);
    expect(tidb.match(/check_clause NOT LIKE '%logical_document%'/g)).toHaveLength(2);
    expect(tidb.match(/^PREPARE kfs_0022_[^\s]+/gmu)).toHaveLength(4);
    expect(tidb.match(/^EXECUTE kfs_0022_[^;]+;/gmu)).toHaveLength(4);
    expect(tidb.match(/^DEALLOCATE PREPARE kfs_0022_[^;]+;/gmu)).toHaveLength(4);
    expect(tidb.match(/'DO 0'/g)).toHaveLength(4);
    expect(tidb).not.toMatch(/^ALTER TABLE `deletion_(?:jobs|tombstones)` DROP CHECK/gmu);

    for (const table of ["deletion_jobs", "deletion_tombstones"]) {
      const drop = tidb.indexOf(`@kfs_0022_${table}_target_drop_sql`);
      const add = tidb.indexOf(`@kfs_0022_${table}_target_add_sql`);
      expect(drop).toBeGreaterThanOrEqual(0);
      expect(add).toBeGreaterThan(drop);
      expect(tidb.slice(drop, add)).toContain("DROP CHECK");
      expect(tidb.slice(add)).toContain(`ADD CONSTRAINT \`${table}_target_ck\``);
    }
  });

  it("keeps both dialects aligned on logical deletion and child-first chunk cleanup", () => {
    expect(postgres).toContain('DROP CONSTRAINT IF EXISTS "deletion_jobs_target_ck"');
    for (const sql of [postgres, tidb]) {
      expect(sql).toContain("logical_document");
      expect(sql).toContain("logical_documents_deletion_lifecycle_ck");
      const chunkTable = sql.slice(
        sql.indexOf("document_revision_chunks"),
        sql.indexOf("document_chunk_state_changes", sql.indexOf("document_revision_chunks")),
      );
      expect(chunkTable).toContain("parent_chunk_id");
      expect(chunkTable).toMatch(/parent_chunk_id[^;]+ON DELETE CASCADE/su);
      expect(chunkTable).not.toMatch(/parent_chunk_id[^;]+ON DELETE RESTRICT/su);
    }
  });

  it("uses a bounded provider digest and collision evidence instead of an overlong key", () => {
    for (const sql of [postgres, tidb]) {
      expect(sql).toContain("provider_item_digest");
      expect(sql).toMatch(/logical_documents_provider_item_uq[^;]+provider_item_digest/su);
      expect(sql).not.toMatch(/logical_documents_provider_item_uq[^;]+provider_item_id/su);
    }
    expect(tidb).toContain(
      "UNIQUE KEY `logical_documents_scope_id_uq` (`tenant_id`, `knowledge_space_id`, `id`)",
    );
  });

  it("keeps the TiDB compatibility bridge error-visible and maps all parser states", () => {
    expect(tidb).not.toContain("INSERT IGNORE");
    expect(tidb.match(/ON DUPLICATE KEY UPDATE/g)).toHaveLength(2);
    for (const sql of [postgres, tidb]) {
      expect(sql).toContain("parser_status");
      expect(sql).toContain("'parsed' THEN 'ready'");
      expect(sql).toContain("'failed' THEN 'failed'");
      expect(sql).toContain("ELSE 'pending'");
      expect(sql).toContain("document_reindex_attempts_expected_settings_head_revision_ck");
    }
  });

  it("catalogs the cyclic active-revision FK with dialect-specific deferral semantics", () => {
    const schema = getDatabaseSchema();
    const documents = schema.tables.find((table) => table.name === "logical_documents");
    expect(
      documents?.columns.find((column) => column.name === "provider_item_digest"),
    ).toMatchObject({ nullable: true });
    expect(documents?.foreignKeys).toContainEqual(
      expect.objectContaining({
        deferrability: {
          postgres: "DEFERRABLE INITIALLY DEFERRED",
          tidb: "NOT DEFERRABLE",
        },
        name: "logical_documents_active_revision_fk",
        onDeleteByDialect: { postgres: "NO ACTION", tidb: "RESTRICT" },
        referencedTable: "document_revisions",
      }),
    );
    expect(
      schema.indexes.find((index) => index.name === "logical_documents_provider_item_uq"),
    ).toMatchObject({ columns: ["provider_item_digest"], unique: true });
  });
});
