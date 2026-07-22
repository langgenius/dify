import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import type {
  DatabaseExecuteInput,
  DatabaseExecuteResult,
  DatabaseQueryValue,
  DatabaseRow,
} from "@knowledge/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabaseHybridRetrievalRepository } from "./hybrid-retrieval";
import { createDatabaseTidbFtsPostingBackfillRepository } from "./tidb-fts-posting-backfill";

const runIntegration = process.env.RUN_TIDB_FTS_INTEGRATION === "1";
const databaseName = `kfs_fts_it_${process.pid}`;
const migrationsDirectory = resolve(import.meta.dirname, "../../database/migrations");
const memberProjectionId = "f0000000-0000-4000-8000-000000000001";
const readyNonmemberProjectionId = "e0000000-0000-4000-8000-000000000001";

describe.skipIf(!runIntegration)("TiDB indexed FTS integration", () => {
  beforeAll(() => {
    mysql(`DROP DATABASE IF EXISTS ${databaseName}; CREATE DATABASE ${databaseName};`);
    const migrationFiles = readdirSync(migrationsDirectory)
      .filter((filename) => filename.endsWith(".tidb.sql"))
      .sort((left, right) => left.localeCompare(right));
    const prePostingMigrations = migrationFiles
      .filter((filename) => filename < "0011_tidb_fts_postings.tidb.sql")
      .map((filename) => readFileSync(resolve(migrationsDirectory, filename), "utf8"))
      .join("\n");
    mysql(prePostingMigrations, databaseName);
    // Simulate an environment that recorded the historical baseline with TEXT projection keys.
    mysql(
      `DROP INDEX IF EXISTS index_projections_space_type_status_idx ON index_projections;
       DROP INDEX IF EXISTS index_projections_node_type_version_idx ON index_projections;
       DROP INDEX IF EXISTS index_projections_node_type_version_model_uq ON index_projections;
       DROP INDEX IF EXISTS \`\` ON index_projections;
       ALTER TABLE index_projections MODIFY COLUMN type TEXT NOT NULL,
         MODIFY COLUMN status TEXT NOT NULL;`,
      databaseName,
    );
    mysql(seedExistingFtsRowsSql(), databaseName);
    mysql(
      readFileSync(resolve(migrationsDirectory, "0011_tidb_fts_postings.tidb.sql"), "utf8"),
      databaseName,
    );
    mysql(
      readFileSync(resolve(migrationsDirectory, "0012_tidb_baseline_repair.tidb.sql"), "utf8"),
      databaseName,
    );
  }, 30_000);

  afterAll(() => {
    mysql(`DROP DATABASE IF EXISTS ${databaseName};`);
  });

  it("durably backfills active rows, ignores bad stale rows, and executes indexed retrieval", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const executor = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
      calls.push(input);
      const sql = bindTidbParams(input.sql, input.params);
      if (input.operation === "select") {
        return { rows: parseMysqlRows(mysql(sql, databaseName)), rowsAffected: 0 };
      }
      const affected = parseMysqlRows(
        mysql(`${sql}\nSELECT ROW_COUNT() AS rows_affected;`, databaseName),
      )[0]?.rows_affected;
      return { rows: [], rowsAffected: typeof affected === "number" ? affected : 0 };
    };
    const database = createSchemaDatabaseAdapter({
      executor,
      kind: "tidb",
      transaction: async (callback) => callback({ execute: executor }),
    });
    const backfills = createDatabaseTidbFtsPostingBackfillRepository({
      database,
      generateId: () => "a0000000-0000-4000-8000-000000000001",
      generateLeaseToken: () => "b0000000-0000-4000-8000-000000000001",
      maxClaimBatchSize: 10,
      maxDiscoveryBatchSize: 10,
    });
    await expect(
      backfills.assertReady({
        knowledgeSpaceId: "10000000-0000-4000-8000-000000000001",
        tenantId: "tenant-1",
      }),
    ).rejects.toMatchObject({ code: "TIDB_FTS_POSTINGS_NOT_READY" });
    await expect(
      backfills.discover({ limit: 10, now: "2026-07-14T00:00:00.000Z" }),
    ).resolves.toMatchObject({
      created: 1,
    });
    let job = (
      await backfills.claim({
        leaseExpiresAt: "2026-07-14T00:10:00.000Z",
        limit: 1,
        now: "2026-07-14T00:00:01.000Z",
        workerId: "integration-worker",
      })
    )[0];
    expect(job).toBeDefined();
    if (!job?.leaseToken) {
      throw new Error("Integration backfill claim did not return a lease token");
    }
    const claimedLeaseToken = job.leaseToken;
    for (let step = 0; step < 4 && job?.runState === "running"; step += 1) {
      const next = await backfills.processNext({
        expectedRowVersion: job.rowVersion,
        jobId: job.id,
        leaseToken: claimedLeaseToken,
        now: `2026-07-14T00:00:0${step + 2}.000Z`,
      });
      job = next.job;
    }
    expect(job).toMatchObject({
      runState: "succeeded",
      scannedProjections: 2,
      writtenPostings: 3,
    });
    await expect(
      backfills.assertReady({
        knowledgeSpaceId: "10000000-0000-4000-8000-000000000001",
        tenantId: "tenant-1",
      }),
    ).resolves.toBeUndefined();
    const repository = createDatabaseHybridRetrievalRepository({
      database,
      maxTopK: 10,
      requirePublishedSnapshot: true,
    });

    await expect(
      repository.searchFts({
        knowledgeSpaceId: "10000000-0000-4000-8000-000000000001",
        permissionScope: [],
        projectionSetPublicationId: "40000000-0000-4000-8000-000000000001",
        query: "policy renewal",
        tenantId: "tenant-1",
        topK: 3,
      }),
    ).resolves.toMatchObject([
      {
        projectionId: memberProjectionId,
        score: 1,
        source: "fts",
      },
    ]);

    const call = calls.find(
      (candidate) =>
        candidate.sql.includes("index_projection_fts_postings") &&
        candidate.sql.includes("projection_set_publication_members"),
    );
    expect(call?.sql.match(/\?/gu)?.length).toBe(call?.params.length);
    expect(call?.sql).toContain("index_projection_fts_postings");
    expect(call?.sql).not.toContain("INSTR(");

    const countsBeforeReplay = mysql(
      "SELECT COUNT(*) AS postings, SUM(term_frequency) AS frequencies FROM index_projection_fts_postings;",
      databaseName,
    );
    const postingMigration = readFileSync(
      resolve(migrationsDirectory, "0011_tidb_fts_postings.tidb.sql"),
      "utf8",
    );
    mysql(postingMigration, databaseName);
    expect(
      mysql(
        "SELECT COUNT(*) AS postings, SUM(term_frequency) AS frequencies FROM index_projection_fts_postings;",
        databaseName,
      ),
    ).toBe(countsBeforeReplay);
    expect(countsBeforeReplay).toContain("3\t3");
    expect(
      mysql(
        `SELECT term, term_frequency FROM index_projection_fts_postings
         WHERE projection_id = '${readyNonmemberProjectionId}';`,
        databaseName,
      ),
    ).toContain("policy\t1");
  }, 30_000);

  it("uses the fixed-width lookup index and enforces the publication status domain", () => {
    const explain = mysql(
      `EXPLAIN SELECT projection_id FROM index_projection_fts_postings
       WHERE knowledge_space_id = '10000000-0000-4000-8000-000000000001'
         AND term_hash = '816aff1073b705e4a4851c42824198a6ff0eb0adbae0504aa7f5597fd434e555'
       ORDER BY knowledge_space_id, term_hash, projection_id LIMIT 3;`,
      databaseName,
    );
    expect(explain).toContain("index_projection_fts_postings_lookup_idx");
    expect(() =>
      mysql(
        `UPDATE projection_set_publications SET status = 'building'
         WHERE id = '40000000-0000-4000-8000-000000000001';`,
        databaseName,
      ),
    ).toThrow();
    expect(() =>
      mysql(
        `UPDATE index_projection_fts_postings SET term_frequency = 0
         WHERE projection_id = '${memberProjectionId}' LIMIT 1;`,
        databaseName,
      ),
    ).toThrow();
    expect(() =>
      mysql(
        `INSERT INTO index_projection_fts_postings
           (id, knowledge_space_id, projection_id, tokenizer_version, term_hash, term,
            term_frequency, document_token_count)
         VALUES ('a0000000-0000-4000-8000-000000000001',
           '10000000-0000-4000-8000-000000000002', '${memberProjectionId}', 'mixed-nfkc-v1',
           REPEAT('f', 64), 'cross-space', 1, 1);`,
        databaseName,
      ),
    ).toThrow();
  });
});

function mysql(sql: string, database?: string): string {
  const host = process.env.TIDB_FTS_INTEGRATION_HOST ?? "host.docker.internal";
  const port = process.env.TIDB_FTS_INTEGRATION_PORT ?? "54000";
  const args = [
    "run",
    "--rm",
    "-i",
    "mysql:8.4",
    "mysql",
    "--protocol=TCP",
    "-h",
    host,
    "-P",
    port,
    "-u",
    process.env.TIDB_FTS_INTEGRATION_USER ?? "root",
    "--batch",
    "--raw",
    ...(database ? [database] : []),
  ];

  return execFileSync("docker", args, {
    encoding: "utf8",
    input: sql,
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function bindTidbParams(sql: string, params: readonly DatabaseQueryValue[]): string {
  let index = 0;
  const bound = sql.replace(/\?/gu, () => {
    const value = params[index];
    index += 1;
    if (index > params.length) {
      throw new Error("TiDB integration query has more placeholders than parameters");
    }
    return mysqlLiteral(value);
  });
  if (index !== params.length) {
    throw new Error("TiDB integration query has more parameters than placeholders");
  }
  return bound;
}

function mysqlLiteral(value: DatabaseQueryValue | undefined): string {
  if (value === null) {
    return "NULL";
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("TiDB integration numeric parameter must be finite");
    }
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "TRUE" : "FALSE";
  }
  if (typeof value !== "string") {
    throw new Error("TiDB integration parameter is missing");
  }
  return `'${value.replaceAll("'", "''")}'`;
}

function parseMysqlRows(output: string): DatabaseRow[] {
  const lines = output.trim().split("\n");
  const header = lines[0]?.split("\t") ?? [];
  const numericColumns = new Set([
    "document_version",
    "end_offset",
    "retry_count",
    "row_version",
    "rows_affected",
    "scanned_projections",
    "score",
    "start_offset",
    "written_postings",
  ]);
  const dateColumns = new Set([
    "completed_at",
    "created_at",
    "heartbeat_at",
    "lease_expires_at",
    "updated_at",
  ]);

  return lines.slice(1).map((line) =>
    Object.fromEntries(
      line.split("\t").map((value, index) => {
        const column = header[index] ?? "";
        if (value === "NULL") {
          return [column, null];
        }
        if (numericColumns.has(column)) {
          return [column, Number(value)];
        }
        return [column, dateColumns.has(column) ? `${value.replace(" ", "T")}Z` : value];
      }),
    ),
  );
}

function seedExistingFtsRowsSql(): string {
  return `
SET SESSION cte_max_recursion_depth = 9000;
INSERT INTO knowledge_spaces
  (id, tenant_id, slug, name, created_at, updated_at)
VALUES
  ('10000000-0000-4000-8000-000000000001', 'tenant-1', 'fts-it', 'FTS', NOW(3), NOW(3)),
  ('10000000-0000-4000-8000-000000000002', 'tenant-1', 'fts-other', 'Other', NOW(3), NOW(3));
INSERT INTO document_assets
  (id, knowledge_space_id, filename, mime_type, object_key, sha256, size_bytes, version,
   parser_status, metadata, created_at)
VALUES ('50000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001', 'probe.txt', 'text/plain', 'probe.txt', REPEAT('a', 64),
  10, 1, 'parsed', JSON_OBJECT(), NOW(3));
INSERT INTO parse_artifacts
  (id, document_asset_id, version, parser, content_type, artifact_hash, elements, metadata, created_at)
VALUES ('60000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001', 1, 'probe', 'text/plain', REPEAT('b', 64),
  JSON_ARRAY(), JSON_OBJECT(), NOW(3));
INSERT INTO knowledge_nodes
  (id, knowledge_space_id, publication_generation_id, document_asset_id, parse_artifact_id, kind,
   text, start_offset, end_offset, source_location, permission_scope, artifact_hash, metadata)
VALUES ('20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001',
  'chunk', 'policy renewal', 0, 14, JSON_OBJECT('sectionPath', JSON_ARRAY('Probe')), JSON_ARRAY(),
  REPEAT('b', 64), JSON_OBJECT());
INSERT INTO index_projections
  (id, knowledge_space_id, publication_generation_id, node_id, type, status, projection_version,
   fts_document, metadata)
VALUES ('${memberProjectionId}', '10000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
  'fts', 'ready', 1, 'policy renewal', JSON_OBJECT('ftsText', 'policy renewal'));
INSERT INTO projection_set_publications
  (id, tenant_id, knowledge_space_id, fingerprint, projection_version, status, metadata,
   created_at, updated_at)
VALUES ('40000000-0000-4000-8000-000000000001', 'tenant-1',
  '10000000-0000-4000-8000-000000000001',
  'projection-set-sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  1, 'published', JSON_OBJECT(), NOW(3), NOW(3));
INSERT INTO projection_set_publication_heads
  (id, tenant_id, knowledge_space_id, publication_id, head_revision, created_at, updated_at)
VALUES ('70000000-0000-4000-8000-000000000001', 'tenant-1',
  '10000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001',
  1, NOW(3), NOW(3));
INSERT INTO projection_set_publication_members
  (tenant_id, knowledge_space_id, publication_id, component_type, component_key, generation_id,
   document_asset_id, created_at)
VALUES ('tenant-1', '10000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001', 'index-projection', '${memberProjectionId}',
  '30000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001', NOW(3));
INSERT INTO index_projections
  (id, knowledge_space_id, publication_generation_id, node_id, type, status, projection_version,
   fts_document, metadata)
VALUES
  ('${readyNonmemberProjectionId}', '10000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
    'fts', 'ready', 2, 'policy', JSON_OBJECT('ftsText', 'policy')),
  ('90000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001', 'fts', 'stale', 3, NULL,
    JSON_OBJECT('ftsText', 'malformed stale source')),
  ('90000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001', 'fts', 'failed', 4, '',
    JSON_OBJECT('ftsText', ''));
`;
}
