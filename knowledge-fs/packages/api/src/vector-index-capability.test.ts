import { describe, expect, it } from "vitest";

import {
  VECTOR_INDEX_CAPABILITY_REASONS,
  buildVectorIndexName,
  buildVectorIndexTableName,
  resolveVectorIndexCapability,
  verifyVectorIndexExplainPlan,
} from "./vector-index-capability";

const BINDING_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40";
const OTHER_BINDING_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c41";
const binding = { bindingId: BINDING_ID, projectionKind: "dense" as const };

function explainPlanFixture({
  bindingIdentity = binding,
  dialect = "postgres",
  dimension = 1536,
  indexName = buildVectorIndexName(bindingIdentity),
  metric = "cosine",
  operator,
  predicate,
  tableName = buildVectorIndexTableName(bindingIdentity, dialect),
}: {
  readonly bindingIdentity?: typeof binding;
  readonly dialect?: "postgres" | "tidb";
  readonly dimension?: number;
  readonly indexName?: string;
  readonly metric?: "cosine" | "dot" | "l2";
  readonly operator?: string;
  readonly predicate?: string;
  readonly tableName?: string;
} = {}): unknown {
  const vectorColumn =
    bindingIdentity.projectionKind === "dense" ? "dense_vector" : "visual_vector";
  const resolvedOperator =
    operator ??
    (dialect === "postgres"
      ? { cosine: "<=>", dot: "<#>", l2: "<->" }[metric]
      : {
          cosine: "VEC_COSINE_DISTANCE",
          dot: "VEC_NEGATIVE_INNER_PRODUCT",
          l2: "VEC_L2_DISTANCE",
        }[metric]);
  const dimensionFunction = dialect === "postgres" ? "vector_dims" : "VEC_DIMS";
  const resolvedPredicate =
    predicate ??
    `p.knowledge_space_id = 'space' AND p.model = 'model' AND p.status = 'ready' AND p.type = 'dense-vector' AND ${dimensionFunction}(p.${vectorColumn}) = ${dimension} AND p.${vectorColumn} IS NOT NULL`;
  const postgresVectorType = dimension <= 2_000 ? "vector" : "halfvec";

  return dialect === "postgres"
    ? [
        {
          Plan: {
            Filter: resolvedPredicate,
            "Index Name": indexName,
            "Node Type": "Index Scan",
            "Order By": `p.${vectorColumn}::${postgresVectorType}(${dimension}) ${resolvedOperator} '[0]'::${postgresVectorType}(${dimension})`,
            "Relation Name": tableName,
          },
        },
      ]
    : [
        {
          "access object": `table:${tableName}, index:${indexName}`,
          id: "VectorIndexReader_7",
          "operator info": `${resolvedOperator}(p.${vectorColumn}, CAST(? AS VECTOR(${dimension})))`,
          Predicate: resolvedPredicate,
          task: "cop[tiflash]",
        },
      ];
}

function verifiedPlan({
  bindingIdentity = binding,
  dialect = "postgres",
  dimension = 1536,
  metric = "cosine",
}: {
  readonly bindingIdentity?: typeof binding;
  readonly dialect?: "postgres" | "tidb";
  readonly dimension?: number;
  readonly metric?: "cosine" | "dot" | "l2";
} = {}) {
  const verification = verifyVectorIndexExplainPlan({
    binding: bindingIdentity,
    dialect,
    dimension,
    explainPlan: explainPlanFixture({ bindingIdentity, dialect, dimension, metric }),
    metric,
  });
  if (!verification) throw new Error("Expected fixture EXPLAIN plan to verify");
  return verification;
}

describe("vector index capability", () => {
  it.each([384, 1536])(
    "keeps PostgreSQL dimension=%s exact while the ANN runtime is not connected",
    (dimension) => {
      expect(
        resolveVectorIndexCapability({
          binding,
          dialect: "postgres",
          dimension,
          metric: "cosine",
          planVerification: verifiedPlan({ dimension }),
        }),
      ).toMatchObject({
        dimension,
        metric: "cosine",
        needsExactRescore: false,
        reason: VECTOR_INDEX_CAPABILITY_REASONS.ANN_RUNTIME_NOT_CONNECTED,
        status: "exact_fallback",
        strategy: "exact",
      });
    },
  );

  it("requires explicit halfvec opt-in but does not claim the unwired runtime is ready", () => {
    expect(
      resolveVectorIndexCapability({
        binding,
        dialect: "postgres",
        dimension: 3072,
        metric: "dot",
        planVerification: verifiedPlan({ dimension: 3072, metric: "dot" }),
      }),
    ).toEqual({
      dimension: 3072,
      metric: "dot",
      needsExactRescore: false,
      reason: VECTOR_INDEX_CAPABILITY_REASONS.POSTGRES_HALFVEC_OPT_IN_REQUIRED,
      status: "exact_fallback",
      strategy: "exact",
    });

    expect(
      resolveVectorIndexCapability({
        binding,
        dialect: "postgres",
        dimension: 3072,
        enablePostgresHalfvecAnn: true,
        metric: "dot",
        planVerification: verifiedPlan({ dimension: 3072, metric: "dot" }),
      }),
    ).toMatchObject({
      dimension: 3072,
      metric: "dot",
      needsExactRescore: false,
      reason: VECTOR_INDEX_CAPABILITY_REASONS.ANN_RUNTIME_NOT_CONNECTED,
      status: "exact_fallback",
      strategy: "exact",
    });
  });

  it("uses exact PostgreSQL search above the ANN dimension limit", () => {
    expect(
      resolveVectorIndexCapability({
        binding,
        dialect: "postgres",
        dimension: 4096,
        enablePostgresHalfvecAnn: true,
        metric: "l2",
        planVerification: verifiedPlan({ dimension: 4096, metric: "l2" }),
      }),
    ).toEqual({
      dimension: 4096,
      metric: "l2",
      needsExactRescore: false,
      reason: VECTOR_INDEX_CAPABILITY_REASONS.POSTGRES_DIMENSION_REQUIRES_EXACT,
      status: "exact_fallback",
      strategy: "exact",
    });
  });

  it("falls back to exact when EXPLAIN misses or verifies a different target index", () => {
    const targetIndexName = buildVectorIndexName(binding);
    const planMiss = verifyVectorIndexExplainPlan({
      binding,
      dialect: "postgres",
      dimension: 1536,
      explainPlan: [{ Plan: { "Node Type": "Seq Scan" } }],
      metric: "cosine",
    });
    expect(planMiss).toBeNull();

    const wrongTargetVerification = verifiedPlan({
      bindingIdentity: {
        bindingId: OTHER_BINDING_ID,
        projectionKind: "dense",
      },
    });
    const forgedVerification = Object.freeze({
      verifiedBy: "explain" as const,
    }) as unknown as NonNullable<
      Parameters<typeof resolveVectorIndexCapability>[0]["planVerification"]
    >;
    for (const planVerification of [
      undefined,
      planMiss ?? undefined,
      wrongTargetVerification,
      forgedVerification,
    ]) {
      expect(
        resolveVectorIndexCapability({
          binding,
          dialect: "postgres",
          dimension: 1536,
          metric: "cosine",
          ...(planVerification ? { planVerification } : {}),
        }),
      ).toMatchObject({
        reason: VECTOR_INDEX_CAPABILITY_REASONS.EXPLAIN_TARGET_INDEX_NOT_CONFIRMED,
        status: "exact_fallback",
        strategy: "exact",
        targetIndexName,
      });
    }
  });

  it("keeps TiDB exact without a module-issued complete plan proof", () => {
    expect(
      resolveVectorIndexCapability({
        binding,
        dialect: "tidb",
        dimension: 1536,
        metric: "cosine",
      }),
    ).toMatchObject({
      reason: VECTOR_INDEX_CAPABILITY_REASONS.EXPLAIN_TARGET_INDEX_NOT_CONFIRMED,
      status: "exact_fallback",
      strategy: "exact",
    });
  });

  it("validates a TiDB fixed-table TiFlash plan but keeps the unwired runtime exact", () => {
    const capability = resolveVectorIndexCapability({
      binding,
      dialect: "tidb",
      dimension: 1536,
      metric: "cosine",
      planVerification: verifiedPlan({ dialect: "tidb" }),
    });

    expect(capability).toMatchObject({
      needsExactRescore: false,
      reason: VECTOR_INDEX_CAPABILITY_REASONS.ANN_RUNTIME_NOT_CONNECTED,
      status: "exact_fallback",
      strategy: "exact",
    });
  });

  it.each(["postgres", "tidb"] as const)(
    "rejects incomplete or mismatched %s ANN EXPLAIN evidence",
    (dialect) => {
      const targetIndexName = buildVectorIndexName(binding);
      const verify = (explainPlan: unknown, metric: "cosine" | "dot" | "l2" = "cosine") =>
        verifyVectorIndexExplainPlan({
          binding,
          dialect,
          dimension: 1536,
          explainPlan,
          metric,
        });
      const wrongOperator = dialect === "postgres" ? "<->" : "VEC_L2_DISTANCE";
      const dimensionFunction = dialect === "postgres" ? "vector_dims" : "VEC_DIMS";
      const wrongPredicate = `p.other_knowledge_space_id = 'space' AND p.model = 'model' AND p.status = 'ready' AND p.type = 'dense-vector' AND ${dimensionFunction}(p.dense_vector) = 1536 AND p.dense_vector IS NOT NULL`;
      const plans = [
        // An arbitrary Index Name alone is not an ANN proof.
        [{ Plan: { "Index Name": targetIndexName, "Node Type": "Index Scan" } }],
        explainPlanFixture({ dialect, tableName: "wrong_vector_table" }),
        explainPlanFixture({ dialect, operator: wrongOperator }),
        explainPlanFixture({ dialect, dimension: 3072 }),
        explainPlanFixture({ dialect, predicate: wrongPredicate }),
        explainPlanFixture({
          bindingIdentity: { bindingId: OTHER_BINDING_ID, projectionKind: "dense" },
          dialect,
        }),
      ];

      for (const plan of plans) expect(verify(plan)).toBeNull();
      expect(verify(explainPlanFixture({ dialect }), "l2")).toBeNull();
      expect(verify(explainPlanFixture({ dialect }))).not.toBeNull();
    },
  );

  it("binds proof tokens to dialect, dimension, metric, and binding claims", () => {
    const postgresProof = verifiedPlan();
    for (const input of [
      { binding, dialect: "tidb" as const, dimension: 1536, metric: "cosine" as const },
      { binding, dialect: "postgres" as const, dimension: 384, metric: "cosine" as const },
      { binding, dialect: "postgres" as const, dimension: 1536, metric: "l2" as const },
      {
        binding: { bindingId: OTHER_BINDING_ID, projectionKind: "dense" as const },
        dialect: "postgres" as const,
        dimension: 1536,
        metric: "cosine" as const,
      },
    ]) {
      expect(
        resolveVectorIndexCapability({ ...input, planVerification: postgresProof }),
      ).toMatchObject({
        reason: VECTOR_INDEX_CAPABILITY_REASONS.EXPLAIN_TARGET_INDEX_NOT_CONFIRMED,
        status: "exact_fallback",
      });
    }
  });

  it("returns unsupported beyond backend storage bounds without imposing a 1536 default", () => {
    expect(
      resolveVectorIndexCapability({ dialect: "postgres", dimension: 16_001, metric: "cosine" }),
    ).toMatchObject({
      reason: VECTOR_INDEX_CAPABILITY_REASONS.POSTGRES_STORAGE_DIMENSION_EXCEEDED,
      status: "unsupported",
    });
    expect(
      resolveVectorIndexCapability({ dialect: "tidb", dimension: 16_384, metric: "cosine" }),
    ).toMatchObject({
      reason: VECTOR_INDEX_CAPABILITY_REASONS.TIDB_STORAGE_DIMENSION_EXCEEDED,
      status: "unsupported",
    });
  });

  it("generates stable bounded index names and rejects injectable internal identifiers", () => {
    const name = buildVectorIndexName(binding);
    expect(name).toMatch(/^kfs_ann_dense_[0-9a-f]{32}$/u);
    expect(name.length).toBeLessThanOrEqual(63);
    expect(buildVectorIndexName(binding)).toBe(name);
    expect(buildVectorIndexTableName(binding, "postgres")).toBe("index_projections");
    expect(buildVectorIndexTableName(binding, "tidb")).toMatch(
      /^kfs_ann_table_dense_[0-9a-f]{32}$/u,
    );
    expect(buildVectorIndexName({ bindingId: BINDING_ID, projectionKind: "visual" })).not.toBe(
      name,
    );

    expect(() =>
      buildVectorIndexName({
        bindingId: 'safe"; DROP INDEX knowledge_spaces_tenant_slug_uq;--',
        projectionKind: "dense",
      }),
    ).toThrow("bindingId must be an internal UUID");
    expect(() =>
      verifyVectorIndexExplainPlan({
        binding: {
          bindingId: 'safe"; DROP TABLE x;--',
          projectionKind: "dense",
        },
        dialect: "postgres",
        dimension: 1536,
        explainPlan: [],
        metric: "cosine",
      }),
    ).toThrow("bindingId must be an internal UUID");
  });

  it("rejects invalid dimensions instead of silently coercing them", () => {
    expect(() =>
      resolveVectorIndexCapability({ dialect: "postgres", dimension: 0, metric: "cosine" }),
    ).toThrow("positive safe integer");
    expect(() =>
      resolveVectorIndexCapability({ dialect: "postgres", dimension: 1536.5, metric: "cosine" }),
    ).toThrow("positive safe integer");
  });
});
