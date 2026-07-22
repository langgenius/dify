import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { getDatabaseSchema } from "./schema";

const root = resolve(import.meta.dirname, "../../..");
const postgres = readFileSync(
  resolve(root, "packages/database/migrations/0027_upload_sessions.postgres.sql"),
  "utf8",
);
const tidb = readFileSync(
  resolve(root, "packages/database/migrations/0027_upload_sessions.tidb.sql"),
  "utf8",
);

describe("upload session migration", () => {
  it.each([
    ["postgres", postgres, '"'],
    ["tidb", tidb, "`"],
  ] as const)(
    "keeps quota, lifecycle, and Capability fences symmetric on %s",
    (_dialect, sql, quote) => {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${quote}upload_sessions${quote}`);
      expect(sql).toContain("upload_sessions_state_ck");
      expect(sql).toContain("upload_sessions_bounds_ck");
      expect(sql).toContain("upload_sessions_multipart_ck");
      expect(sql).toContain("upload_sessions_terminal_ck");
      expect(sql).toContain("upload_sessions_completion_grant_ck");
      expect(sql).toContain("upload_sessions_scope_idempotency_uq");
      expect(sql).toContain("upload_sessions_object_key_uq");
      expect(sql).toContain("upload_sessions_expiry_idx");
      expect(sql).toContain("upload_sessions_grant_status_idx");
      expect(sql).toContain("upload_sessions_completion_grant_status_idx");
      expect(sql).toContain("capability_grants");
      expect(sql.toLowerCase()).not.toContain("bearer_token");
      expect(sql.toLowerCase()).not.toContain("presigned_url");
      expect(sql.toLowerCase()).not.toContain("raw_jti");
    },
  );

  it("keeps the schema catalog aligned with idempotency, expiry, and grant indexes", () => {
    const schema = getDatabaseSchema();
    const table = schema.tables.find((candidate) => candidate.name === "upload_sessions");

    expect(table?.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "grant_id",
        "completion_grant_id",
        "idempotency_key",
        "object_key",
        "reserved_bytes",
        "completion_parts",
        "row_version",
      ]),
    );
    expect(table?.foreignKeys).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          columns: ["tenant_id", "knowledge_space_id", "grant_id"],
          referencedTable: "capability_grants",
        }),
        expect.objectContaining({
          columns: ["tenant_id", "knowledge_space_id", "completion_grant_id"],
          referencedTable: "capability_grants",
        }),
      ]),
    );
    expect(
      schema.indexes.find((index) => index.name === "upload_sessions_scope_idempotency_uq"),
    ).toMatchObject({
      columns: ["tenant_id", "knowledge_space_id", "idempotency_key"],
      unique: true,
    });
  });
});
