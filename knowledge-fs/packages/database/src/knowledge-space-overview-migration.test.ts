import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { getDatabaseSchema } from "./schema";

const root = resolve(import.meta.dirname, "../../..");
const postgres = readFileSync(
  resolve(root, "packages/database/migrations/0023_knowledge_space_overview.postgres.sql"),
  "utf8",
);
const tidb = readFileSync(
  resolve(root, "packages/database/migrations/0023_knowledge_space_overview.tidb.sql"),
  "utf8",
);

describe("knowledge-space overview migration", () => {
  it("keeps icon DDL marker-loss replay safe in both dialects", () => {
    expect(postgres).toContain('ADD COLUMN IF NOT EXISTS "icon_ref"');
    expect(postgres).toContain("IF NOT EXISTS (");
    expect(postgres).toContain("knowledge_spaces_icon_ref_ck");

    expect(tidb).toContain("ADD COLUMN IF NOT EXISTS `icon_ref`");
    expect(tidb).toContain("FROM information_schema.tidb_check_constraints");
    expect(tidb).toContain("@knowledge_spaces_icon_ref_ck_exists = 0");
    expect(tidb).toContain("'DO 0'");
    expect(tidb).toContain("DEALLOCATE PREPARE knowledge_spaces_icon_ref_ck_statement");
    expect(tidb).not.toMatch(
      /^ALTER TABLE `knowledge_spaces` ADD CONSTRAINT `knowledge_spaces_icon_ref_ck`/gmu,
    );
  });

  it("keeps the activity and attention contracts aligned with the schema catalog", () => {
    for (const sql of [postgres, tidb]) {
      expect(sql).toContain("knowledge_space_activity_events");
      expect(sql).toContain("knowledge_space_attention_states");
      expect(sql).toContain("knowledge_space_activity_feed_idx");
      expect(sql).toContain("knowledge_space_attention_issue_uq");
      expect(sql).toContain("required_permission_scope");
      expect(sql).toContain("updated_by_subject_id");
    }

    const schema = getDatabaseSchema();
    const activity = schema.tables.find(
      (table) => table.name === "knowledge_space_activity_events",
    );
    const attention = schema.tables.find(
      (table) => table.name === "knowledge_space_attention_states",
    );
    expect(activity?.foreignKeys).toContainEqual(
      expect.objectContaining({ onDelete: "CASCADE", referencedTable: "knowledge_spaces" }),
    );
    expect(attention?.foreignKeys).toContainEqual(
      expect.objectContaining({ onDelete: "CASCADE", referencedTable: "knowledge_spaces" }),
    );
    expect(
      schema.indexes.find((index) => index.name === "knowledge_space_attention_issue_uq"),
    ).toMatchObject({ unique: true });
  });
});
