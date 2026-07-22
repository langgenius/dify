import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  LEGACY_AUTHORIZATION_TABLES,
  buildP9RemovalBundle,
  renderP9RemovalBundle,
  validateP9Catalog,
} from "./build-p9-removal-bundle.mjs";

const requestId = "00000000-0000-4000-8000-000000000001";

const requiredReferences = [
  ["answer_traces", "knowledge_space_permission_snapshots"],
  ["document_compilation_attempts", "knowledge_space_permission_snapshots"],
  ["failed_queries", "knowledge_space_permission_snapshots"],
  ["knowledge_space_profile_migration_runs", "knowledge_space_permission_snapshots"],
  ["quality_replay_runs", "knowledge_space_permission_snapshots"],
  ["research_task_jobs", "knowledge_space_permission_snapshots"],
  ["source_oauth_transactions", "knowledge_space_api_keys"],
  ["source_oauth_transactions", "knowledge_space_permission_snapshots"],
  ["source_sync_policies", "knowledge_space_permission_snapshots"],
  ["source_workflow_runs", "knowledge_space_permission_snapshots"],
];

function catalog(databaseEngine = "postgresql") {
  return {
    schemaVersion: 1,
    databaseEngine,
    databaseName: "knowledge_fs",
    capturedAt: "2026-07-21T16:00:00Z",
    workspaceCohortDigest: `sha256:${"a".repeat(64)}`,
    legacyRouteWindowStartedAt: "2026-07-14T16:00:00Z",
    legacyRouteWindowEndedAt: "2026-07-21T16:00:00Z",
    legacyRouteCalls: { access: 0, apiKey: 0, member: 0 },
    activeLegacyApiKeys: 0,
    activePermissionSnapshots: 0,
    nonterminalLegacyTasks: 0,
    legacyRowCounts: Object.fromEntries(
      LEGACY_AUTHORIZATION_TABLES.map((tableName, index) => [tableName, index]),
    ),
    foreignKeys: requiredReferences.map(([tableName, referencedTableName], index) => ({
      tableName,
      constraintName: `p9_fixture_fk_${index}`,
      columns: ["permission_snapshot_id"],
      referencedTableName,
      referencedColumns: ["id"],
      onDelete: "NO ACTION",
      onUpdate: "NO ACTION",
    })),
  };
}

test("P9 catalog is strict, zero-traffic, and complete for every legacy FK consumer", () => {
  assert.equal(validateP9Catalog(catalog()).foreignKeys.length, requiredReferences.length);

  assert.throws(
    () => validateP9Catalog({ ...catalog(), activeLegacyApiKeys: 1 }),
    /activeLegacyApiKeys must be zero/,
  );
  assert.throws(
    () =>
      validateP9Catalog({
        ...catalog(),
        foreignKeys: catalog().foreignKeys.slice(1),
      }),
    /catalog is missing answer_traces/,
  );
  assert.throws(
    () => validateP9Catalog({ ...catalog(), databaseName: "knowledge_fs;DROP" }),
    /safe SQL identifier/,
  );
});

for (const databaseEngine of ["postgresql", "tidb"]) {
  test(`P9 ${databaseEngine} bundle archives all legacy tables and has a data-only recovery path`, () => {
    const result = renderP9RemovalBundle(catalog(databaseEngine), requestId);

    assert.match(result.removalSqlDigest, /^sha256:[a-f0-9]{64}$/);
    assert.match(result.recoverySqlDigest, /^sha256:[a-f0-9]{64}$/);
    for (const tableName of LEGACY_AUTHORIZATION_TABLES) {
      assert.match(result.removalSql, new RegExp(tableName));
      assert.match(result.recoverySql, new RegExp(tableName));
    }
    for (const [tableName] of requiredReferences) {
      assert.match(result.removalSql, new RegExp(tableName));
    }
    assert.doesNotMatch(result.removalSql, /\bdatasets?\b|documents_segments|dataset_permissions/i);
    assert.match(result.recoverySql, /never re-enables legacy authorization traffic/);
  });
}

test("P9 builder writes a digest-bound manifest beside removal and recovery SQL", async () => {
  const directory = await mkdtemp(join(tmpdir(), "knowledge-fs-p9-bundle-"));
  const catalogPath = join(directory, "catalog.json");
  const outputDirectory = join(directory, "output");
  await writeFile(catalogPath, `${JSON.stringify(catalog())}\n`);

  const rendered = await buildP9RemovalBundle({ catalogPath, outputDirectory, requestId });
  const manifest = JSON.parse(
    await readFile(join(outputDirectory, "bundle-manifest.json"), "utf8"),
  );

  assert.equal(manifest.removalSqlDigest, rendered.removalSqlDigest);
  assert.equal(manifest.recoverySqlDigest, rendered.recoverySqlDigest);
  assert.equal(manifest.requestId, requestId);
  assert.equal(
    await readFile(join(outputDirectory, "remove-legacy-authorization.sql"), "utf8"),
    rendered.removalSql,
  );
});
