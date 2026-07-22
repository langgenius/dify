import { describe, expect, it } from "vitest";

import {
  databasePlaceholder,
  indexProjectionInsertPlaceholder,
  jsonInsertPlaceholder,
  qualifiedDatabaseIdentifier,
  quoteDatabaseIdentifier,
} from "./database-sql-utils";

const postgres = { dialect: "postgres" as const };
const tidb = { dialect: "tidb" as const };

describe("database-sql-utils", () => {
  it("quotes identifiers with dialect escaping", () => {
    expect(quoteDatabaseIdentifier(postgres, 'table"name')).toBe('"table""name"');
    expect(quoteDatabaseIdentifier(tidb, "table`name")).toBe("`table``name`");
    expect(qualifiedDatabaseIdentifier(postgres, "n", "id")).toBe('n."id"');
  });

  it("renders dialect placeholders", () => {
    expect(databasePlaceholder(postgres, 3)).toBe("$3");
    expect(databasePlaceholder(tidb, 3)).toBe("?");
  });

  it("casts JSON placeholders for JSON columns only", () => {
    expect(jsonInsertPlaceholder(postgres, 2, "metadata")).toBe("$2::jsonb");
    expect(jsonInsertPlaceholder(tidb, 2, "metadata")).toBe("CAST(? AS JSON)");
    expect(jsonInsertPlaceholder(postgres, 3, "permission_scope")).toBe("$3::jsonb");
    expect(jsonInsertPlaceholder(tidb, 3, "permission_scope")).toBe("CAST(? AS JSON)");
    expect(jsonInsertPlaceholder(postgres, 4, "nodes")).toBe("$4::jsonb");
    expect(jsonInsertPlaceholder(tidb, 4, "nodes")).toBe("CAST(? AS JSON)");
    expect(jsonInsertPlaceholder(postgres, 5, "source_location")).toBe("$5::jsonb");
    expect(jsonInsertPlaceholder(tidb, 5, "source_location")).toBe("CAST(? AS JSON)");
    expect(jsonInsertPlaceholder(postgres, 2, "name")).toBe("$2");
  });

  it("renders vector and FTS projection placeholders", () => {
    expect(indexProjectionInsertPlaceholder(postgres, 1, "dense_vector")).toBe("$1::vector");
    expect(indexProjectionInsertPlaceholder(tidb, 1, "dense_vector")).toBe("CAST(? AS VECTOR)");
    expect(indexProjectionInsertPlaceholder(postgres, 3, "visual_vector")).toBe("$3::vector");
    expect(indexProjectionInsertPlaceholder(tidb, 3, "visual_vector")).toBe("CAST(? AS VECTOR)");
    expect(indexProjectionInsertPlaceholder(postgres, 2, "fts_document")).toBe(
      "to_tsvector('simple', $2)",
    );
    expect(indexProjectionInsertPlaceholder(tidb, 2, "fts_document")).toBe("?");
  });
});
