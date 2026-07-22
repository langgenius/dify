import { execFileSync } from "node:child_process";

import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import {
  type DatabaseAdapter,
  type DatabaseExecuteInput,
  type DatabaseExecuteResult,
  type DatabaseQueryValue,
  PUBLICATION_GENERATION_ID_SENTINEL,
} from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  ProjectionSetPublicationComponentTypes,
  ProjectionSetPublicationMemberAttemptFenceConflictError,
  ProjectionSetPublicationMemberBatchSizeExceededError,
  ProjectionSetPublicationMemberIdentityConflictError,
  ProjectionSetPublicationMemberListLimitExceededError,
  ProjectionSetPublicationMemberWriteConflictError,
  createDatabaseProjectionSetPublicationMemberRepository,
} from "./projection-publication-member-repository";
import {
  ProjectionSetPublicationHeadConflictError,
  ProjectionSetPublicationKnowledgeSpaceNotFoundError,
  ProjectionSetPublicationTransitionError,
} from "./projection-publication-repository";

const tenantId = "tenant-1";
const otherTenantId = "tenant-2";
const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const otherKnowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c52";
const candidateFingerprint = `projection-set-sha256:${"a".repeat(64)}`;
const publishedFingerprint = `projection-set-sha256:${"b".repeat(64)}`;
const candidatePublicationId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";
const publishedPublicationId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44";
const attemptId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45";
const leaseToken = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c46";
const documentAssetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d01";
const otherDocumentAssetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d02";
const generationId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2e01";
const otherGenerationId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2e02";
const componentA = "018f0d60-7a49-7cc2-9c1b-5b36f18f2f01";
const componentB = "018f0d60-7a49-7cc2-9c1b-5b36f18f2f02";
const componentC = "018f0d60-7a49-7cc2-9c1b-5b36f18f2f03";

interface FakeMemberDatabase {
  readonly calls: Array<{
    readonly input: DatabaseExecuteInput;
    readonly lane: "outside" | "transaction";
  }>;
  readonly database: DatabaseAdapter;
  readonly transactionRollbackCount: () => number;
  readonly transactionCount: () => number;
}

interface FakeMemberDatabaseOptions {
  readonly attemptFenceValid?: boolean | readonly boolean[] | undefined;
  readonly candidateStatus?: string | undefined;
  readonly dialect?: DatabaseAdapter["dialect"] | undefined;
  readonly headRevision?: number | null | undefined;
  readonly mismatchedValueInsertAt?: number | undefined;
  readonly memberRows?: readonly Record<string, unknown>[] | undefined;
}

describe("database projection publication member repository", () => {
  it("supports every publication component type", () => {
    expect(ProjectionSetPublicationComponentTypes).toEqual([
      "index-projection",
      "document-outline",
      "multimodal-manifest",
      "knowledge-path",
      "graph-entity",
      "graph-relation",
    ]);
  });

  it("filters only requested keys in one bounded publication-member query", async () => {
    const fake = createFakeMemberDatabase({ memberRows: [memberRow()] });
    const repository = createDatabaseProjectionSetPublicationMemberRepository({
      database: fake.database,
      maxBatchSize: 2,
      maxListLimit: 10,
    });

    await expect(
      repository.filterComponentKeys({
        componentKeys: [componentA, componentB],
        componentType: "index-projection",
        knowledgeSpaceId,
        publicationId: candidatePublicationId,
        tenantId,
      }),
    ).resolves.toEqual([componentA]);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.input).toMatchObject({
      maxRows: 2,
      operation: "select",
      params: [
        tenantId,
        knowledgeSpaceId,
        candidatePublicationId,
        "index-projection",
        componentA,
        componentB,
      ],
      tableName: "projection_set_publication_members",
    });
    expect(fake.calls[0]?.input.sql).toContain('"component_key" IN ($5, $6)');

    await expect(
      repository.filterComponentKeys({
        componentKeys: [componentA, componentB, componentC],
        componentType: "index-projection",
        knowledgeSpaceId,
        publicationId: candidatePublicationId,
        tenantId,
      }),
    ).rejects.toBeInstanceOf(ProjectionSetPublicationMemberBatchSizeExceededError);
  });

  it("runs replace and inherit statements on one PostgreSQL transaction connection", async () => {
    const fake = createFakeMemberDatabase();
    const repository = createDatabaseProjectionSetPublicationMemberRepository({
      database: fake.database,
      maxBatchSize: 10,
      maxListLimit: 10,
    });

    await expect(
      repository.replaceCandidateComponents({
        ...mutation(),
        componentType: "index-projection",
        components: [
          { componentKey: componentA, documentAssetId, generationId },
          { componentKey: componentA, documentAssetId, generationId },
        ],
      }),
    ).resolves.toBe(1);
    expect(fake.transactionCount()).toBe(1);
    expect(fake.calls.every((call) => call.lane === "transaction")).toBe(true);
    expect(fake.calls.map((call) => call.input.tableName)).toEqual([
      "knowledge_spaces",
      "projection_set_publication_heads",
      "projection_set_publications",
      "projection_set_publication_members",
      "projection_set_publication_members",
    ]);
    expect(fake.calls[3]?.input.sql).toContain('"component_type" = $4');
    expect(fake.calls[4]?.input.sql).not.toContain("ON CONFLICT");
    expect(fake.calls[4]?.input.params).toHaveLength(8);

    fake.calls.length = 0;
    await expect(
      repository.replaceDocumentComponents({
        ...mutation(),
        components: [
          { componentKey: componentB, componentType: "document-outline", generationId },
          {
            componentKey: componentC,
            componentType: "graph-relation",
            generationId: otherGenerationId,
          },
        ],
        documentAssetId,
      }),
    ).resolves.toBe(2);
    expect(fake.calls.every((call) => call.lane === "transaction")).toBe(true);
    expect(fake.calls[3]?.input.sql).toContain('"document_asset_id" = $4');
    expect(fake.calls[4]?.input.params).toHaveLength(16);

    fake.calls.length = 0;
    await expect(
      repository.inheritFromPublished({
        ...mutation(),
        excludedComponentKeys: [componentA, componentA],
        excludedDocumentAssetId: otherDocumentAssetId,
      }),
    ).resolves.toBe(2);
    expect(fake.calls.every((call) => call.lane === "transaction")).toBe(true);
    const inherit = fake.calls.at(-1)?.input;
    expect(inherit?.sql).toContain("INSERT INTO");
    expect(inherit?.sql).toContain(" SELECT ");
    expect(inherit?.sql).toContain("NOT IN");
    expect(inherit?.sql).toContain("IS NULL OR");
    expect(inherit?.sql).toContain("ON CONFLICT");
    expect(fake.calls[3]?.input.params).toEqual([
      candidatePublicationId,
      tenantId,
      knowledgeSpaceId,
      publishedPublicationId,
      componentA,
      otherDocumentAssetId,
    ]);
    expect(inherit?.params).toEqual([
      candidatePublicationId,
      mutationDefaults().createdAt,
      tenantId,
      knowledgeSpaceId,
      publishedPublicationId,
      componentA,
      otherDocumentAssetId,
    ]);
  });

  it("chunks a large complete document replacement inside one candidate composition transaction", async () => {
    const fake = createFakeMemberDatabase();
    const repository = createDatabaseProjectionSetPublicationMemberRepository({
      database: fake.database,
      maxBatchSize: 10,
      maxListLimit: 10,
    });
    const components = Array.from({ length: 11 }, (_, index) => ({
      componentKey: indexedUuid(index),
      componentType: "index-projection" as const,
      generationId,
    }));

    await expect(
      repository.composeDocumentCandidate({
        ...mutation(),
        components,
        documentAssetId,
      }),
    ).resolves.toEqual({ inherited: 2, replaced: 11 });

    expect(fake.transactionCount()).toBe(1);
    expect(fake.calls.every((call) => call.lane === "transaction")).toBe(true);
    expect(fake.calls.map((call) => call.input.tableName)).toEqual([
      "knowledge_spaces",
      "document_compilation_attempts",
      "projection_set_publication_heads",
      "projection_set_publications",
      "projection_set_publication_members",
      "projection_set_publication_members",
      "projection_set_publication_members",
      "projection_set_publication_members",
      "projection_set_publication_members",
      "document_compilation_attempts",
    ]);
    expect(fake.calls[0]?.input.sql).toContain("FOR UPDATE");
    expect(fake.calls[1]?.input.operation).toBe("select");
    expect(fake.calls[1]?.input.sql).toContain("clock_timestamp()");
    expect(fake.calls[1]?.input.sql).toContain("FOR UPDATE");
    expect(fake.calls[1]?.input.params).toEqual([
      attemptId,
      tenantId,
      knowledgeSpaceId,
      documentAssetId,
      2,
      generationId,
      1,
      candidatePublicationId,
      candidateFingerprint,
      7,
      leaseToken,
    ]);
    expect(fake.calls[4]?.input.operation).toBe("delete");
    expect(fake.calls[4]?.input.params).toHaveLength(3);
    const valueInserts = fake.calls.filter(
      (call) =>
        call.input.tableName === "projection_set_publication_members" &&
        call.input.operation === "insert" &&
        !call.input.sql.includes(" SELECT "),
    );
    expect(valueInserts.map((call) => call.input.params.length)).toEqual([80, 8]);
  });

  it("rolls back the whole composition when a later transaction-local chunk is incomplete", async () => {
    const fake = createFakeMemberDatabase({ mismatchedValueInsertAt: 2 });
    const repository = createDatabaseProjectionSetPublicationMemberRepository({
      database: fake.database,
      maxBatchSize: 10,
      maxListLimit: 10,
    });
    const components = Array.from({ length: 11 }, (_, index) => ({
      componentKey: indexedUuid(index),
      componentType: "index-projection" as const,
      generationId,
    }));

    await expect(
      repository.composeDocumentCandidate({
        ...mutation(),
        components,
        documentAssetId,
      }),
    ).rejects.toBeInstanceOf(ProjectionSetPublicationMemberWriteConflictError);

    expect(fake.transactionCount()).toBe(1);
    expect(fake.transactionRollbackCount()).toBe(1);
    expect(
      fake.calls.filter(
        (call) => call.input.operation === "insert" && !call.input.sql.includes(" SELECT "),
      ),
    ).toHaveLength(2);
    expect(fake.calls.every((call) => call.lane === "transaction")).toBe(true);
  });

  it("detects a head conflict before deleting any candidate member", async () => {
    const fake = createFakeMemberDatabase({ headRevision: 2 });
    const repository = createDatabaseProjectionSetPublicationMemberRepository({
      database: fake.database,
      maxBatchSize: 10,
      maxListLimit: 10,
    });

    await expect(
      repository.composeDocumentCandidate({
        ...mutation(),
        components: [],
        documentAssetId,
      }),
    ).rejects.toBeInstanceOf(ProjectionSetPublicationHeadConflictError);
    expect(fake.transactionRollbackCount()).toBe(1);
    expect(fake.calls.map((call) => call.input.tableName)).toEqual([
      "knowledge_spaces",
      "document_compilation_attempts",
      "projection_set_publication_heads",
    ]);
  });

  it("rolls back before deleting candidate members when the durable attempt fence is stale", async () => {
    const fake = createFakeMemberDatabase({ attemptFenceValid: false });
    const repository = createDatabaseProjectionSetPublicationMemberRepository({
      database: fake.database,
      maxBatchSize: 10,
      maxListLimit: 10,
    });

    await expect(
      repository.composeDocumentCandidate({
        ...mutation(),
        components: [],
        documentAssetId,
      }),
    ).rejects.toBeInstanceOf(ProjectionSetPublicationMemberAttemptFenceConflictError);
    expect(fake.transactionRollbackCount()).toBe(1);
    expect(fake.calls.map((call) => call.input.tableName)).toEqual([
      "knowledge_spaces",
      "document_compilation_attempts",
    ]);
    expect(fake.calls.some((call) => call.input.operation === "delete")).toBe(false);
  });

  it.each(["postgres", "tidb"] as const)(
    "rolls back %s member writes when the end-of-transaction lease-expiry fence fails",
    async (dialect) => {
      const fake = createFakeMemberDatabase({ attemptFenceValid: [true, false], dialect });
      const repository = createDatabaseProjectionSetPublicationMemberRepository({
        database: fake.database,
        maxBatchSize: 10,
        maxListLimit: 10,
      });

      await expect(
        repository.composeDocumentCandidate({
          ...mutation(),
          components: [
            { componentKey: componentA, componentType: "document-outline", generationId },
          ],
          documentAssetId,
        }),
      ).rejects.toBeInstanceOf(ProjectionSetPublicationMemberAttemptFenceConflictError);
      expect(fake.transactionRollbackCount()).toBe(1);
      expect(
        fake.calls.filter((call) => call.input.tableName === "document_compilation_attempts"),
      ).toHaveLength(2);
      expect(fake.calls.some((call) => call.input.operation === "delete")).toBe(true);
      expect(fake.calls.some((call) => call.input.operation === "insert")).toBe(true);
      expect(fake.calls.at(-1)?.input.tableName).toBe("document_compilation_attempts");
      const attemptSql = fake.calls
        .filter((call) => call.input.tableName === "document_compilation_attempts")
        .map((call) => call.input.sql);
      if (dialect === "postgres") {
        expect(attemptSql.every((sql) => sql.includes("clock_timestamp()"))).toBe(true);
      } else {
        expect(attemptSql.every((sql) => sql.includes("CURRENT_TIMESTAMP(3)"))).toBe(true);
        expect(attemptSql.every((sql) => !sql.includes("clock_timestamp()"))).toBe(true);
      }
    },
  );

  it("executes TiDB compose, clone, and replace mutations on one connection transaction", async () => {
    const fake = createFakeMemberDatabase({ dialect: "tidb" });
    const repository = createDatabaseProjectionSetPublicationMemberRepository({
      database: fake.database,
      maxBatchSize: 10,
      maxListLimit: 10,
    });

    await expect(
      repository.replaceCandidateComponents({
        ...mutation(),
        componentType: "index-projection",
        components: [{ componentKey: componentA, documentAssetId, generationId }],
      }),
    ).resolves.toBe(1);
    expect(fake.transactionCount()).toBe(1);
    expect(fake.calls.every((call) => call.lane === "transaction")).toBe(true);
    expect(fake.calls[0]?.input.sql).toContain("`knowledge_spaces`");
    expect(fake.calls[0]?.input.sql).toContain("? ");
    expect(fake.calls.at(-1)?.input.sql).toContain("VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    expect(fake.calls.map((call) => call.input.params)).toEqual([
      [tenantId, knowledgeSpaceId],
      [tenantId, knowledgeSpaceId],
      [tenantId, knowledgeSpaceId, candidateFingerprint],
      [tenantId, knowledgeSpaceId, candidatePublicationId, "index-projection"],
      [
        tenantId,
        knowledgeSpaceId,
        candidatePublicationId,
        "index-projection",
        componentA,
        generationId,
        documentAssetId,
        mutationDefaults().createdAt,
      ],
    ]);
    expectTidbPlaceholderArity(fake.calls);

    fake.calls.length = 0;
    await expect(
      repository.replaceDocumentComponents({
        ...mutation(),
        components: [{ componentKey: componentB, componentType: "document-outline", generationId }],
        documentAssetId,
      }),
    ).resolves.toBe(1);
    expect(fake.transactionCount()).toBe(2);
    expect(fake.calls.every((call) => call.lane === "transaction")).toBe(true);
    expect(fake.calls[3]?.input.sql).toContain("`document_asset_id` = ?");
    expect(fake.calls.map((call) => call.input.params)).toEqual([
      [tenantId, knowledgeSpaceId],
      [tenantId, knowledgeSpaceId],
      [tenantId, knowledgeSpaceId, candidateFingerprint],
      [tenantId, knowledgeSpaceId, candidatePublicationId, documentAssetId],
      [
        tenantId,
        knowledgeSpaceId,
        candidatePublicationId,
        "document-outline",
        componentB,
        generationId,
        documentAssetId,
        mutationDefaults().createdAt,
      ],
    ]);
    expectTidbPlaceholderArity(fake.calls);

    fake.calls.length = 0;
    await expect(repository.inheritFromPublished(mutation())).resolves.toBe(2);
    expect(fake.transactionCount()).toBe(3);
    expect(fake.calls.every((call) => call.lane === "transaction")).toBe(true);
    const conflict = fake.calls.find(
      (call) =>
        call.input.tableName === "projection_set_publication_members" &&
        call.input.operation === "select",
    );
    const cloneInsert = fake.calls.find(
      (call) =>
        call.input.tableName === "projection_set_publication_members" &&
        call.input.operation === "insert",
    );
    expect(conflict?.input.sql).toContain("<=>");
    expect(conflict?.input.sql).not.toContain("IS DISTINCT FROM");
    expect(cloneInsert?.input.sql).toContain("NOT EXISTS");
    expect(cloneInsert?.input.sql).not.toContain("ON CONFLICT");
    expect(conflict?.input.params).toEqual([
      candidatePublicationId,
      tenantId,
      knowledgeSpaceId,
      publishedPublicationId,
    ]);
    expect(cloneInsert?.input.params).toEqual([
      candidatePublicationId,
      mutationDefaults().createdAt,
      tenantId,
      knowledgeSpaceId,
      publishedPublicationId,
      candidatePublicationId,
    ]);
    expectTidbPlaceholderArity(fake.calls);

    fake.calls.length = 0;
    await expect(
      repository.composeDocumentCandidate({
        ...mutation(),
        components: [{ componentKey: componentA, componentType: "document-outline", generationId }],
        documentAssetId,
      }),
    ).resolves.toEqual({ inherited: 2, replaced: 1 });
    expect(fake.transactionCount()).toBe(4);
    expect(fake.calls.every((call) => call.lane === "transaction")).toBe(true);
    expect(
      fake.calls.filter((call) => call.input.tableName === "document_compilation_attempts"),
    ).toHaveLength(2);
    expect(
      fake.calls
        .filter((call) => call.input.tableName === "document_compilation_attempts")
        .every((call) => call.input.sql.includes("CURRENT_TIMESTAMP(3)")),
    ).toBe(true);
    const expectedAttemptFenceParams = [
      attemptId,
      tenantId,
      knowledgeSpaceId,
      documentAssetId,
      2,
      generationId,
      1,
      candidatePublicationId,
      candidateFingerprint,
      7,
      leaseToken,
    ];
    expect(fake.calls.map((call) => call.input.params)).toEqual([
      [tenantId, knowledgeSpaceId],
      expectedAttemptFenceParams,
      [tenantId, knowledgeSpaceId],
      [tenantId, knowledgeSpaceId, candidateFingerprint],
      [tenantId, knowledgeSpaceId, candidatePublicationId],
      [candidatePublicationId, tenantId, knowledgeSpaceId, publishedPublicationId, documentAssetId],
      [
        candidatePublicationId,
        mutationDefaults().createdAt,
        tenantId,
        knowledgeSpaceId,
        publishedPublicationId,
        documentAssetId,
        candidatePublicationId,
      ],
      [
        tenantId,
        knowledgeSpaceId,
        candidatePublicationId,
        "document-outline",
        componentA,
        generationId,
        documentAssetId,
        mutationDefaults().createdAt,
      ],
      expectedAttemptFenceParams,
    ]);
    expectTidbPlaceholderArity(fake.calls);
    expect(fake.calls.at(-1)?.input.tableName).toBe("document_compilation_attempts");
  });

  it("fails inheritance before insert when an existing member has different ownership", async () => {
    const fake = createFakeMemberDatabase({
      memberRows: [{ component_key: componentA, generation_id: otherGenerationId }],
    });
    const repository = createDatabaseProjectionSetPublicationMemberRepository({
      database: fake.database,
      maxBatchSize: 10,
      maxListLimit: 10,
    });

    await expect(repository.inheritFromPublished(mutation())).rejects.toBeInstanceOf(
      ProjectionSetPublicationMemberIdentityConflictError,
    );
    expect(fake.calls.at(-1)?.input.operation).toBe("select");
    expect(fake.calls.some((call) => call.input.operation === "insert")).toBe(false);
  });

  it("lists members only after resolving the tenant-scoped fingerprint", async () => {
    const fake = createFakeMemberDatabase({
      memberRows: [memberRow()],
    });
    const repository = createDatabaseProjectionSetPublicationMemberRepository({
      database: fake.database,
      maxBatchSize: 10,
      maxListLimit: 2,
    });

    await expect(
      repository.listByFingerprint({
        fingerprint: candidateFingerprint,
        knowledgeSpaceId,
        tenantId,
      }),
    ).resolves.toEqual([
      {
        componentKey: componentA,
        componentType: "index-projection",
        createdAt: "2026-07-13T12:01:00.000Z",
        documentAssetId,
        generationId,
        knowledgeSpaceId,
        publicationId: candidatePublicationId,
        tenantId,
      },
    ]);
    expect(fake.calls.map((call) => call.input.tableName)).toEqual([
      "projection_set_publications",
      "projection_set_publication_members",
    ]);
    expect(fake.calls.every((call) => call.lane === "outside")).toBe(true);
    expect(fake.calls[1]?.input.params.slice(0, 3)).toEqual([
      tenantId,
      knowledgeSpaceId,
      candidatePublicationId,
    ]);

    const overflowing = createFakeMemberDatabase({
      memberRows: [memberRow(), memberRow({ component_key: componentB })],
    });
    const bounded = createDatabaseProjectionSetPublicationMemberRepository({
      database: overflowing.database,
      maxBatchSize: 10,
      maxListLimit: 1,
    });
    await expect(
      bounded.listByPublication({
        fingerprint: candidateFingerprint,
        knowledgeSpaceId,
        tenantId,
      }),
    ).rejects.toBeInstanceOf(ProjectionSetPublicationMemberListLimitExceededError);

    const corrupted = createFakeMemberDatabase({
      memberRows: [memberRow({ generation_id: PUBLICATION_GENERATION_ID_SENTINEL })],
    });
    const corruptedRepository = createDatabaseProjectionSetPublicationMemberRepository({
      database: corrupted.database,
      maxBatchSize: 10,
      maxListLimit: 2,
    });
    await expect(
      corruptedRepository.listByFingerprint({
        fingerprint: candidateFingerprint,
        knowledgeSpaceId,
        tenantId,
      }),
    ).rejects.toThrow("Publication generation ID must be a non-zero UUID");
  });

  it("rejects stale heads, non-candidates, cross-space lookup, and oversized batches", async () => {
    const stale = createFakeMemberDatabase({ headRevision: 2 });
    const staleRepository = createDatabaseProjectionSetPublicationMemberRepository({
      database: stale.database,
      maxBatchSize: 1,
      maxListLimit: 10,
    });
    await expect(
      staleRepository.replaceCandidateComponents({
        ...mutation(),
        componentType: "index-projection",
        components: [],
      }),
    ).rejects.toBeInstanceOf(ProjectionSetPublicationHeadConflictError);
    expect(stale.calls).toHaveLength(2);

    const publishedCandidate = createFakeMemberDatabase({ candidateStatus: "published" });
    const publishedRepository = createDatabaseProjectionSetPublicationMemberRepository({
      database: publishedCandidate.database,
      maxBatchSize: 1,
      maxListLimit: 10,
    });
    await expect(
      publishedRepository.replaceCandidateComponents({
        ...mutation(),
        componentType: "index-projection",
        components: [],
      }),
    ).rejects.toBeInstanceOf(ProjectionSetPublicationTransitionError);

    const scoped = createFakeMemberDatabase({ headRevision: null });
    const scopedRepository = createDatabaseProjectionSetPublicationMemberRepository({
      database: scoped.database,
      maxBatchSize: 1,
      maxListLimit: 10,
    });
    await expect(
      scopedRepository.replaceCandidateComponents({
        ...mutation({ knowledgeSpaceId: otherKnowledgeSpaceId, tenantId: otherTenantId }),
        expectedHeadRevision: 0,
        componentType: "index-projection",
        components: [],
      }),
    ).rejects.toBeInstanceOf(ProjectionSetPublicationKnowledgeSpaceNotFoundError);

    const callCount = stale.calls.length;
    await expect(
      staleRepository.replaceCandidateComponents({
        ...mutation(),
        componentType: "index-projection",
        components: [
          {
            componentKey: componentA,
            generationId: PUBLICATION_GENERATION_ID_SENTINEL,
          },
        ],
      }),
    ).rejects.toThrow("Publication generation ID must be a non-zero UUID");
    await expect(
      staleRepository.replaceDocumentComponents({
        ...mutation(),
        components: [
          {
            componentKey: componentA,
            componentType: "document-outline",
            generationId: PUBLICATION_GENERATION_ID_SENTINEL,
          },
        ],
        documentAssetId,
      }),
    ).rejects.toThrow("Publication generation ID must be a non-zero UUID");
    expect(stale.calls).toHaveLength(callCount);

    await expect(
      staleRepository.replaceCandidateComponents({
        ...mutation(),
        componentType: "index-projection",
        components: [
          { componentKey: componentA, generationId },
          { componentKey: componentB, generationId: otherGenerationId },
        ],
      }),
    ).rejects.toBeInstanceOf(ProjectionSetPublicationMemberBatchSizeExceededError);
    expect(stale.calls).toHaveLength(callCount);
  });

  it.each(["postgres", "tidb"] as const)(
    "fails closed for a %s adapter without a configured connection transaction",
    async (dialect) => {
      const database = createSchemaDatabaseAdapter({ kind: dialect });
      const repository = createDatabaseProjectionSetPublicationMemberRepository({
        database,
        maxBatchSize: 10,
        maxListLimit: 10,
      });
      await expect(
        repository.replaceCandidateComponents({
          ...mutation(),
          componentType: "index-projection",
          components: [],
        }),
      ).rejects.toThrow(`Database transactions are not configured for ${dialect}`);
    },
  );
});

describe.skipIf(process.env.RUN_TIDB_PUBLICATION_MEMBER_INTEGRATION !== "1")(
  "TiDB projection publication member integration",
  () => {
    it("executes inherited-member SQL atomically and remains idempotent on replay", async () => {
      const fake = createFakeMemberDatabase({ dialect: "tidb" });
      const repository = createDatabaseProjectionSetPublicationMemberRepository({
        database: fake.database,
        maxBatchSize: 10,
        maxListLimit: 10,
      });
      await expect(repository.inheritFromPublished(mutation())).resolves.toBe(2);
      expectTidbPlaceholderArity(fake.calls);

      const transactionSql = fake.calls
        .map((call) => bindTidbMemberParams(call.input.sql, call.input.params))
        .join("\n");
      const databaseName = `kfs_member_it_${process.pid}`;

      tidbMemberMysql(`DROP DATABASE IF EXISTS ${databaseName}; CREATE DATABASE ${databaseName};`);
      try {
        tidbMemberMysql(tidbMemberSchemaAndSeedSql(), databaseName);

        tidbMemberMysql(`START TRANSACTION;\n${transactionSql}\nROLLBACK;`, databaseName);
        expect(tidbMemberCandidateCount(databaseName)).toContain("member_count\n0");

        tidbMemberMysql(`START TRANSACTION;\n${transactionSql}\nCOMMIT;`, databaseName);
        const inherited = tidbMemberCandidateRows(databaseName);
        expect(inherited).toBe(
          [
            "component_key\tcomponent_type\tgeneration_id\tdocument_asset_id",
            `${componentA}\tindex-projection\t${generationId}\t${documentAssetId}`,
            `${componentB}\tdocument-outline\t${otherGenerationId}\tNULL`,
            "",
          ].join("\n"),
        );

        tidbMemberMysql(`START TRANSACTION;\n${transactionSql}\nCOMMIT;`, databaseName);
        expect(tidbMemberCandidateRows(databaseName)).toBe(inherited);
      } finally {
        tidbMemberMysql(`DROP DATABASE IF EXISTS ${databaseName};`);
      }
    }, 30_000);
  },
);

function createFakeMemberDatabase({
  attemptFenceValid = true,
  candidateStatus = "candidate",
  dialect = "postgres",
  headRevision = 1,
  mismatchedValueInsertAt,
  memberRows = [],
}: FakeMemberDatabaseOptions = {}): FakeMemberDatabase {
  const base = createSchemaDatabaseAdapter({ kind: dialect });
  const calls: FakeMemberDatabase["calls"] = [];
  let transactions = 0;
  let transactionRollbacks = 0;
  let valueInserts = 0;
  let attemptFenceChecks = 0;

  const execute = async (
    input: DatabaseExecuteInput,
    lane: "outside" | "transaction",
  ): Promise<DatabaseExecuteResult> => {
    calls.push({ input: { ...input, params: [...input.params] }, lane });

    if (input.tableName === "knowledge_spaces") {
      const scoped = input.params[0] === tenantId && input.params[1] === knowledgeSpaceId;
      return {
        rows: scoped ? [{ id: knowledgeSpaceId }] : [],
        rowsAffected: scoped ? 1 : 0,
      };
    }

    if (input.tableName === "projection_set_publication_heads") {
      const scoped = input.params[0] === tenantId && input.params[1] === knowledgeSpaceId;
      return {
        rows:
          scoped && headRevision !== null
            ? [{ head_revision: headRevision, publication_id: publishedPublicationId }]
            : [],
        rowsAffected: scoped && headRevision !== null ? 1 : 0,
      };
    }

    if (input.tableName === "projection_set_publications") {
      const scoped = input.params[0] === tenantId && input.params[1] === knowledgeSpaceId;
      const fingerprint = input.params[2];
      const row =
        scoped && fingerprint === candidateFingerprint
          ? { id: candidatePublicationId, status: candidateStatus }
          : scoped && fingerprint === publishedFingerprint
            ? { id: publishedPublicationId, status: "published" }
            : undefined;
      return { rows: row ? [row] : [], rowsAffected: row ? 1 : 0 };
    }

    if (input.tableName === "document_compilation_attempts") {
      const configured = Array.isArray(attemptFenceValid)
        ? attemptFenceValid[Math.min(attemptFenceChecks, attemptFenceValid.length - 1)]
        : attemptFenceValid;
      attemptFenceChecks += 1;
      return {
        rows: configured ? [{ id: attemptId }] : [],
        rowsAffected: configured ? 1 : 0,
      };
    }

    if (input.tableName === "projection_set_publication_members") {
      if (input.operation === "select") {
        const scoped = input.sql.includes("INNER JOIN")
          ? input.params[0] === candidatePublicationId &&
            input.params[1] === tenantId &&
            input.params[2] === knowledgeSpaceId
          : input.params[0] === tenantId &&
            input.params[1] === knowledgeSpaceId &&
            input.params[2] === candidatePublicationId;
        return { rows: scoped ? memberRows : [], rowsAffected: scoped ? memberRows.length : 0 };
      }
      if (input.operation === "insert") {
        const isSelectInsert = input.sql.includes(" SELECT ");
        if (!isSelectInsert) {
          valueInserts += 1;
        }
        const expectedRows = input.params.length / 8;
        return {
          rows: [],
          rowsAffected: isSelectInsert
            ? 2
            : mismatchedValueInsertAt === valueInserts
              ? expectedRows - 1
              : expectedRows,
        };
      }
      if (input.operation === "delete") {
        return { rows: [], rowsAffected: 1 };
      }
    }

    throw new Error(
      `Unexpected fake member database operation ${input.tableName}/${input.operation}`,
    );
  };

  const database: DatabaseAdapter = {
    ...base,
    execute: (input) => execute(input, "outside"),
    transaction: async (callback) => {
      transactions += 1;
      try {
        return await callback({ execute: (input) => execute(input, "transaction") });
      } catch (error) {
        transactionRollbacks += 1;
        throw error;
      }
    },
  };

  return {
    calls,
    database,
    transactionCount: () => transactions,
    transactionRollbackCount: () => transactionRollbacks,
  };
}

function expectTidbPlaceholderArity(calls: FakeMemberDatabase["calls"]): void {
  for (const call of calls) {
    expect(call.input.sql.match(/\?/gu)?.length ?? 0).toBe(call.input.params.length);
  }
}

function bindTidbMemberParams(sql: string, params: readonly DatabaseQueryValue[]): string {
  let index = 0;
  const bound = sql.replace(/\?/gu, () => {
    const value = params[index];
    index += 1;
    if (index > params.length) {
      throw new Error("TiDB member integration query has more placeholders than parameters");
    }
    return tidbMemberMysqlLiteral(value);
  });
  if (index !== params.length) {
    throw new Error("TiDB member integration query has more parameters than placeholders");
  }
  return bound;
}

function tidbMemberMysqlLiteral(value: DatabaseQueryValue | undefined): string {
  if (value === null) {
    return "NULL";
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("TiDB member integration numeric parameter must be finite");
    }
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "TRUE" : "FALSE";
  }
  if (typeof value !== "string") {
    throw new Error("TiDB member integration parameter is missing");
  }
  return `'${value.replaceAll("'", "''")}'`;
}

function tidbMemberMysql(sql: string, database?: string): string {
  const args = [
    "run",
    "--rm",
    "-i",
    "mysql:8.4",
    "mysql",
    "--protocol=TCP",
    "-h",
    process.env.TIDB_PUBLICATION_MEMBER_INTEGRATION_HOST ?? "host.docker.internal",
    "-P",
    process.env.TIDB_PUBLICATION_MEMBER_INTEGRATION_PORT ?? "54000",
    "-u",
    process.env.TIDB_PUBLICATION_MEMBER_INTEGRATION_USER ?? "root",
    "--batch",
    "--raw",
    ...(database ? [database] : []),
  ];
  return execFileSync("docker", args, {
    encoding: "utf8",
    input: sql,
    maxBuffer: 4 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function tidbMemberCandidateCount(database: string): string {
  return tidbMemberMysql(
    `SELECT COUNT(*) AS member_count FROM projection_set_publication_members
     WHERE tenant_id = '${tenantId}' AND knowledge_space_id = '${knowledgeSpaceId}'
       AND publication_id = '${candidatePublicationId}';`,
    database,
  );
}

function tidbMemberCandidateRows(database: string): string {
  return tidbMemberMysql(
    `SELECT component_key, component_type, generation_id, document_asset_id
     FROM projection_set_publication_members
     WHERE tenant_id = '${tenantId}' AND knowledge_space_id = '${knowledgeSpaceId}'
       AND publication_id = '${candidatePublicationId}'
     ORDER BY component_key;`,
    database,
  );
}

function tidbMemberSchemaAndSeedSql(): string {
  return `
CREATE TABLE knowledge_spaces (
  id CHAR(36) PRIMARY KEY NOT NULL,
  tenant_id VARCHAR(255) NOT NULL
);
CREATE TABLE projection_set_publications (
  id CHAR(36) PRIMARY KEY NOT NULL,
  tenant_id VARCHAR(255) NOT NULL,
  knowledge_space_id CHAR(36) NOT NULL,
  fingerprint VARCHAR(128) NOT NULL,
  status VARCHAR(16) NOT NULL
);
CREATE TABLE projection_set_publication_heads (
  tenant_id VARCHAR(255) NOT NULL,
  knowledge_space_id CHAR(36) NOT NULL,
  publication_id CHAR(36) NOT NULL,
  head_revision BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, knowledge_space_id)
);
CREATE TABLE projection_set_publication_members (
  tenant_id VARCHAR(255) NOT NULL,
  knowledge_space_id CHAR(36) NOT NULL,
  publication_id CHAR(36) NOT NULL,
  component_type VARCHAR(64) NOT NULL,
  component_key CHAR(36) NOT NULL,
  generation_id CHAR(36) NOT NULL,
  document_asset_id CHAR(36),
  created_at DATETIME(3) NOT NULL,
  UNIQUE KEY projection_set_publication_members_component_uq
    (publication_id, component_type, component_key)
);
INSERT INTO knowledge_spaces (id, tenant_id)
VALUES ('${knowledgeSpaceId}', '${tenantId}');
INSERT INTO projection_set_publications
  (id, tenant_id, knowledge_space_id, fingerprint, status)
VALUES
  ('${publishedPublicationId}', '${tenantId}', '${knowledgeSpaceId}', '${publishedFingerprint}', 'published'),
  ('${candidatePublicationId}', '${tenantId}', '${knowledgeSpaceId}', '${candidateFingerprint}', 'candidate');
INSERT INTO projection_set_publication_heads
  (tenant_id, knowledge_space_id, publication_id, head_revision)
VALUES ('${tenantId}', '${knowledgeSpaceId}', '${publishedPublicationId}', 1);
INSERT INTO projection_set_publication_members
  (tenant_id, knowledge_space_id, publication_id, component_type, component_key, generation_id,
   document_asset_id, created_at)
VALUES
  ('${tenantId}', '${knowledgeSpaceId}', '${publishedPublicationId}', 'index-projection',
   '${componentA}', '${generationId}', '${documentAssetId}', NOW(3)),
  ('${tenantId}', '${knowledgeSpaceId}', '${publishedPublicationId}', 'document-outline',
   '${componentB}', '${otherGenerationId}', NULL, NOW(3));`;
}

function mutation(overrides: Partial<ReturnType<typeof mutationDefaults>> = {}) {
  return { ...mutationDefaults(), ...overrides };
}

function mutationDefaults() {
  return {
    attemptFence: {
      attemptId,
      candidatePublicationId,
      documentVersion: 2,
      expectedRowVersion: 7,
      leaseToken,
      publicationGenerationId: generationId,
    },
    candidateFingerprint,
    createdAt: "2026-07-13T12:01:00.000Z",
    expectedHeadRevision: 1,
    knowledgeSpaceId,
    tenantId,
  };
}

function memberRow(overrides: Record<string, unknown> = {}) {
  return {
    component_key: componentA,
    component_type: "index-projection",
    created_at: "2026-07-13T12:01:00.000Z",
    document_asset_id: documentAssetId,
    generation_id: generationId,
    knowledge_space_id: knowledgeSpaceId,
    publication_id: candidatePublicationId,
    tenant_id: tenantId,
    ...overrides,
  };
}

function indexedUuid(index: number): string {
  return `018f0d60-7a49-7cc2-9c1b-${(0x100 + index).toString(16).padStart(12, "0")}`;
}
