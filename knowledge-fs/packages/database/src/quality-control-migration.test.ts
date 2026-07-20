import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { getDatabaseSchema } from "./schema";

const root = resolve(import.meta.dirname, "../../..");
const postgres = readFileSync(
  resolve(root, "packages/database/migrations/0024_quality_control.postgres.sql"),
  "utf8",
);
const tidb = readFileSync(
  resolve(root, "packages/database/migrations/0024_quality_control.tidb.sql"),
  "utf8",
);

const qualityTables = [
  "quality_replay_runs",
  "quality_replay_items",
  "quality_replay_outbox",
  "quality_bad_cases",
  "quality_missing_evidence_reviews",
  "quality_resource_history",
] as const;

describe("quality-control migration", () => {
  it.each([
    ["postgres", postgres, '"'],
    ["tidb", tidb, "`"],
  ] as const)("creates the durable quality closure replay-safely on %s", (_dialect, sql, quote) => {
    for (const table of qualityTables) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${quote}${table}${quote}`);
    }
    expect(sql).toContain("request_fingerprint");
    expect(sql).toContain("permission_snapshot_revision");
    expect(sql).toContain("quality_replay_outbox_state_ck");
    expect(sql).toContain("delivery_revision");
    expect(sql).toContain("quality_replay_outbox_run_delivery_uq");
    expect(sql).toContain("delivery_state");
    expect(sql).toContain("delivered_at");
    expect(sql).toContain("quality_resource_history_revision_uq");
    expect(sql).toContain("failed_queries_space_created_idx");
    expect(sql).toContain("failed_queries_subject_created_idx");
    expect(sql).toContain("failed_queries_permission_binding_ck");
    expect(sql).toContain("answer_traces_space_id_uq");
    expect(sql).toContain("quality_bad_cases_trace_scope_fk");
    expect(sql).toContain("quality_missing_evidence_reviews_trace_scope_fk");
    expect(sql).toContain("golden_questions_scope_json_ck");
    expect(sql).toContain("golden_questions_scope_fk");
    expect(sql).toContain(`${quote}access_channel${quote} IS NOT NULL`);
    expect(sql).toContain(`${quote}permission_snapshot_revision${quote} IS NOT NULL`);
    expect(sql).toContain(`${quote}required_permission_scope${quote} IS NOT NULL`);
    expect(sql).toContain(`${quote}revision${quote} IS NOT NULL`);
    for (const column of [
      "tenant_id",
      "requested_by_subject_id",
      "access_channel",
      "permission_snapshot_id",
      "permission_snapshot_revision",
      "required_permission_scope",
      "revision",
    ]) {
      expect(sql).toContain(`ADD COLUMN IF NOT EXISTS ${quote}${column}${quote}`);
    }
    expect(sql).not.toContain("failed_queries_space_created_mode_idx");
  });

  it("does not build a TiDB key on the legacy failed_queries TEXT mode column", () => {
    expect(tidb).toContain("ON `failed_queries` (`knowledge_space_id`, `created_at`, `id`)");
    expect(tidb).not.toMatch(/ON `failed_queries` \([^)]*`mode`/u);
  });

  it("uses TiDB-safe CHECK guards and replay-safe parent keys", () => {
    expect(tidb).toContain("information_schema.tidb_check_constraints");
    expect(tidb).toContain("`scope_binding_complete` TINYINT GENERATED ALWAYS AS");
    expect(tidb).toContain("CHECK (`scope_binding_complete` = 1)");
    expect(tidb).toContain("`permission_binding_complete` TINYINT GENERATED ALWAYS AS");
    expect(tidb).toContain("CHECK (`permission_binding_complete` = 1)");
    expect(tidb).toContain(
      "UNIQUE KEY `quality_replay_runs_scope_id_uq` (`tenant_id`, `knowledge_space_id`, `id`)",
    );
    expect(tidb).not.toContain(
      "REFERENCES `quality_replay_runs` (`tenant_id`, `knowledge_space_id`, `id`) ON DELETE RESTRICT",
    );
    expect(tidb).toContain("ROW_NUMBER() OVER");
  });

  it("binds PostgreSQL constraint guards to the intended table", () => {
    expect(postgres).toContain("conrelid = 'failed_queries'::regclass");
    expect(postgres).toContain("conrelid = 'golden_questions'::regclass");
  });

  it("keeps the schema catalog aligned with the six tables and bounded keys", () => {
    const schema = getDatabaseSchema();
    for (const table of qualityTables) {
      expect(schema.tables.some((candidate) => candidate.name === table)).toBe(true);
    }
    expect(
      schema.indexes.find((index) => index.name === "quality_replay_runs_idempotency_uq"),
    ).toMatchObject({
      columns: ["tenant_id", "knowledge_space_id", "idempotency_key"],
      unique: true,
    });
    expect(
      schema.indexes.find((index) => index.name === "quality_replay_outbox_run_delivery_uq"),
    ).toMatchObject({ columns: ["run_id", "delivery_revision"], unique: true });
    expect(
      schema.indexes.find((index) => index.name === "answer_traces_space_id_uq"),
    ).toMatchObject({ columns: ["knowledge_space_id", "id"], unique: true });
    const goldenQuestions = schema.tables.find((table) => table.name === "golden_questions");
    expect(goldenQuestions?.columns.find((column) => column.name === "tenant_id")).toMatchObject({
      nullable: true,
    });
    expect(
      goldenQuestions?.columns.find((column) => column.name === "required_permission_scope"),
    ).toMatchObject({ nullable: true });
    expect(
      schema.indexes.find((index) => index.name === "failed_queries_space_created_idx"),
    ).toMatchObject({ columns: ["knowledge_space_id", "created_at", "id"] });
    expect(
      schema.indexes.find((index) => index.name === "failed_queries_subject_created_idx"),
    ).toMatchObject({
      columns: ["tenant_id", "knowledge_space_id", "requested_by_subject_id", "created_at", "id"],
    });

    const failedQueries = schema.tables.find((table) => table.name === "failed_queries");
    const bindingCheck = failedQueries?.checkConstraints?.find(
      (constraint) => constraint.name === "failed_queries_permission_binding_ck",
    );
    expect(bindingCheck).toBeDefined();
    expect(bindingCheck?.expression.postgres).toContain('"required_permission_scope" IS NOT NULL');
    expect(bindingCheck?.expression.tidb).toBe("`permission_binding_complete` = 1");
    expect(
      failedQueries?.columns.find((candidate) => candidate.name === "permission_binding_complete")
        ?.generatedAs?.tidb,
    ).toContain("`tenant_id` IS NOT NULL");
    for (const column of [
      "tenant_id",
      "requested_by_subject_id",
      "access_channel",
      "permission_snapshot_id",
      "permission_snapshot_revision",
      "required_permission_scope",
      "revision",
    ]) {
      expect(failedQueries?.columns.find((candidate) => candidate.name === column)).toMatchObject({
        nullable: true,
      });
    }

    expect(
      goldenQuestions?.checkConstraints?.find(
        (constraint) => constraint.name === "golden_questions_scope_json_ck",
      )?.expression.postgres,
    ).toContain('"required_permission_scope" IS NOT NULL');
    expect(
      goldenQuestions?.columns.find((column) => column.name === "scope_binding_complete")
        ?.generatedAs?.tidb,
    ).toContain("`tenant_id` IS NOT NULL");
  });
});
