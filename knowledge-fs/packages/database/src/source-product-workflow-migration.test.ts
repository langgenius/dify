import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { getDatabaseSchema } from "./schema";

const root = resolve(import.meta.dirname, "../../..");
const postgres = readFileSync(
  resolve(root, "packages/database/migrations/0021_source_product_workflows.postgres.sql"),
  "utf8",
);
const tidb = readFileSync(
  resolve(root, "packages/database/migrations/0021_source_product_workflows.tidb.sql"),
  "utf8",
);

const sourceTables = [
  "source_connections",
  "source_oauth_transactions",
  "source_connection_secret_refs",
  "source_sync_policies",
  "source_workflow_runs",
  "source_workflow_outbox",
  "source_crawl_preview_pages",
  "source_bulk_workflow_items",
] as const;

describe("0021 source-product workflow migration", () => {
  it.each([
    ["postgres", postgres, '"'],
    ["tidb", tidb, "`"],
  ] as const)("keeps every table and index creation replay safe for %s", (_dialect, sql, quote) => {
    for (const table of sourceTables) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${quote}${table}${quote}`);
    }
    expect(sql).not.toMatch(/CREATE (?:UNIQUE )?INDEX (?!IF NOT EXISTS)/u);
    expect(sql).toContain(`ALTER TABLE ${quote}sources${quote} ADD COLUMN IF NOT EXISTS`);
    expect(sql).toContain("sources_connection_fk");
  });

  it("guards the existing sources foreign key in both dialects after marker loss", () => {
    expect(postgres).toContain("IF NOT EXISTS (");
    expect(postgres).toContain("FROM pg_constraint");
    expect(postgres).toContain("$kfs_source_connection_fk$");

    expect(tidb).toContain("FROM information_schema.table_constraints");
    expect(tidb).toContain("@source_connection_fk_exists = 0");
    expect(tidb).toContain("'DO 0'");
    expect(tidb).toContain("DEALLOCATE PREPARE source_connection_fk_statement");
    expect(tidb).not.toMatch(/^ALTER TABLE `sources` ADD CONSTRAINT `sources_connection_fk`/gmu);
  });

  it.each([postgres, tidb])(
    "freezes ACL provenance and durable bulk-child aggregation in both dialects",
    (sql) => {
      expect(sql).toContain("required_permission_scope");
      expect(sql).toContain("permission_snapshot_revision");
      expect(sql).toContain("source_workflow_runs_idempotency_digest_uq");
      expect(sql).toContain("idempotency_digest");
      expect(sql).toContain("source_workflow_outbox_delivery_uq");
      expect(sql).toContain("child_run_id");
      expect(sql).toContain("deletion_job_id");
      expect(sql).toContain("source_bulk_workflow_items_child_ck");
      expect(sql).toContain("source_bulk_workflow_items_child_uq");
      expect(sql).toContain("source_bulk_workflow_items_deletion_job_uq");
      expect(sql).toContain("deletion_jobs_scope_id_uq");
      expect(sql).toContain("'eligible', 'skipped', 'failed'");
      expect(sql).toContain("'disable'");
      expect(sql).toContain("'running'");
      expect(sql).toMatch(/child_run_id[^;]+source_workflow_runs/su);
      expect(sql).toMatch(/deletion_job_id[^;]+deletion_jobs/su);

      const tableStart =
        sql.indexOf('source_bulk_workflow_items" (') >= 0
          ? sql.indexOf('source_bulk_workflow_items" (')
          : sql.indexOf("source_bulk_workflow_items` (");
      const tableEnd = sql.indexOf("source_bulk_workflow_items_source_uq", tableStart);
      const bulkTableSql = sql.slice(tableStart, tableEnd);
      expect(bulkTableSql).not.toMatch(
        /FOREIGN KEY \([`"]knowledge_space_id[`"], [`"]source_id[`"]\)/u,
      );
    },
  );

  it("uses a fixed digest index and retains the original workflow idempotency key", () => {
    expect(postgres).toContain("encode(sha256(convert_to(");
    expect(tidb).toContain("SHA2(CONCAT(");
    for (const sql of [postgres, tidb]) {
      expect(sql).toContain("idempotency_key");
      expect(sql).toContain("idempotency_digest");
      expect(sql).toMatch(/DROP INDEX IF EXISTS [`"]source_workflow_runs_idempotency_uq[`"]?/u);
      expect(sql).toMatch(/source_workflow_runs_idempotency_digest_uq[^;]+idempotency_digest/su);
      expect(sql).not.toMatch(
        /source_workflow_runs_idempotency_digest_uq[^;]+requested_by_subject_id/su,
      );
    }
  });

  it("models remove children independently from sync runs and preserves source audit identity", () => {
    const schema = getDatabaseSchema();
    const table = schema.tables.find(
      (candidate) => candidate.name === "source_bulk_workflow_items",
    );
    expect(table?.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(["source_id", "child_run_id", "deletion_job_id"]),
    );
    expect(table?.foreignKeys).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          columns: ["tenant_id", "knowledge_space_id", "deletion_job_id"],
          onDelete: "RESTRICT",
          referencedTable: "deletion_jobs",
        }),
      ]),
    );
    expect(table?.foreignKeys).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          columns: ["knowledge_space_id", "source_id"],
          referencedTable: "sources",
        }),
      ]),
    );
    expect(schema.indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          columns: ["tenant_id", "knowledge_space_id", "id"],
          name: "deletion_jobs_scope_id_uq",
          unique: true,
        }),
        expect.objectContaining({
          columns: ["deletion_job_id"],
          name: "source_bulk_workflow_items_deletion_job_uq",
          unique: true,
        }),
      ]),
    );
  });

  it("uses TiDB's implicit RESTRICT action for child identities referenced by a CHECK", () => {
    const tableStart = tidb.indexOf("source_bulk_workflow_items` (");
    const tableEnd = tidb.indexOf("source_bulk_workflow_items_source_uq", tableStart);
    const bulkTableSql = tidb.slice(tableStart, tableEnd);

    expect(bulkTableSql).toContain(
      "FOREIGN KEY (`tenant_id`, `knowledge_space_id`, `child_run_id`)",
    );
    expect(bulkTableSql).toContain(
      "FOREIGN KEY (`tenant_id`, `knowledge_space_id`, `deletion_job_id`)",
    );
    expect(bulkTableSql).not.toMatch(/child_run_id[^,;]+ON DELETE RESTRICT/su);
    expect(bulkTableSql).not.toMatch(/deletion_job_id[^,;]+ON DELETE RESTRICT/su);
  });

  it("inlines TiDB parent keys needed by inbound foreign keys for marker-loss replay", () => {
    const connectionsStart = tidb.indexOf("CREATE TABLE IF NOT EXISTS `source_connections`");
    const connectionsEnd = tidb.indexOf(
      "CREATE UNIQUE INDEX IF NOT EXISTS `source_connections_scope_id_uq`",
      connectionsStart,
    );
    const connectionsTableSql = tidb.slice(connectionsStart, connectionsEnd);
    expect(connectionsTableSql).toContain(
      "UNIQUE KEY `source_connections_scope_id_uq` (`tenant_id`, `knowledge_space_id`, `id`)",
    );
    expect(connectionsTableSql).toContain(
      "UNIQUE KEY `source_connections_space_id_uq` (`knowledge_space_id`, `id`)",
    );

    const runsStart = tidb.indexOf("CREATE TABLE IF NOT EXISTS `source_workflow_runs`");
    const runsEnd = tidb.indexOf(
      "CREATE UNIQUE INDEX IF NOT EXISTS `source_workflow_runs_idempotency_digest_uq`",
      runsStart,
    );
    const runsTableSql = tidb.slice(runsStart, runsEnd);
    expect(runsTableSql).toContain(
      "UNIQUE KEY `source_workflow_runs_scope_id_uq` (`tenant_id`, `knowledge_space_id`, `id`)",
    );
  });
});
