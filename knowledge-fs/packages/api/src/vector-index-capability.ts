import { createHash } from "node:crypto";

export const POSTGRES_VECTOR_HNSW_MAX_DIMENSION = 2_000;
export const POSTGRES_HALFVEC_HNSW_MAX_DIMENSION = 4_000;
export const POSTGRES_VECTOR_STORAGE_MAX_DIMENSION = 16_000;
export const TIDB_VECTOR_STORAGE_MAX_DIMENSION = 16_383;

export const VECTOR_INDEX_CAPABILITY_REASONS = {
  ANN_INDEX_BINDING_NOT_CONFIGURED: "ann_index_binding_not_configured",
  ANN_READY: "ann_ready",
  ANN_RUNTIME_NOT_CONNECTED: "ann_runtime_not_connected",
  EXPLAIN_TARGET_INDEX_NOT_CONFIRMED: "ann_explain_target_index_not_confirmed",
  POSTGRES_DIMENSION_REQUIRES_EXACT: "postgres_dimension_requires_exact",
  POSTGRES_HALFVEC_OPT_IN_REQUIRED: "postgres_halfvec_opt_in_required",
  POSTGRES_STORAGE_DIMENSION_EXCEEDED: "postgres_vector_storage_dimension_exceeded",
  TIDB_ANN_PREFILTER_NOT_SUPPORTED: "tidb_ann_prefilter_not_supported",
  TIDB_FIXED_DIMENSION_ISOLATION_NOT_PROVEN: "tidb_fixed_dimension_physical_isolation_not_proven",
  TIDB_STORAGE_DIMENSION_EXCEEDED: "tidb_vector_storage_dimension_exceeded",
  TIDB_TIFLASH_REPLICA_NOT_PROVEN: "tidb_tiflash_replica_not_proven",
} as const;

export type VectorIndexCapabilityReason =
  (typeof VECTOR_INDEX_CAPABILITY_REASONS)[keyof typeof VECTOR_INDEX_CAPABILITY_REASONS];
export type VectorIndexMetric = "cosine" | "dot" | "l2";
export type VectorIndexProjectionKind = "dense" | "visual";
export type VectorIndexStrategy =
  | "exact"
  | "postgres_halfvec_hnsw"
  | "postgres_vector_hnsw"
  | "tidb_fixed_vector_tiflash_ann"
  | "unsupported";

export interface VectorIndexCapability {
  readonly dimension: number;
  readonly metric: VectorIndexMetric;
  readonly needsExactRescore: boolean;
  readonly reason: VectorIndexCapabilityReason;
  readonly status: "exact_fallback" | "ready" | "unsupported";
  readonly strategy: VectorIndexStrategy;
  readonly targetIndexName?: string | undefined;
}

export interface VectorIndexBindingIdentity {
  /** Durable, server-generated binding UUID. Never substitute a user-selected model or slug. */
  readonly bindingId: string;
  readonly projectionKind: VectorIndexProjectionKind;
}

export interface ResolveVectorIndexCapabilityInput {
  readonly binding?: VectorIndexBindingIdentity | undefined;
  readonly dialect: "postgres" | "tidb";
  readonly dimension: number;
  /** Lossy halfvec ANN is never selected without an explicit operator opt-in. */
  readonly enablePostgresHalfvecAnn?: boolean | undefined;
  readonly metric: VectorIndexMetric;
  readonly planVerification?: VerifiedVectorIndexExplainPlan | undefined;
}

const VERIFIED_EXPLAIN_PLAN_BRAND: unique symbol = Symbol("verified-vector-index-explain-plan");

export interface VerifiedVectorIndexExplainPlan {
  /** Nominal marker only. Resolver claims are read from a module-private WeakMap, never this object. */
  readonly [VERIFIED_EXPLAIN_PLAN_BRAND]: true;
  readonly verifiedBy: "explain";
}

export interface VerifyVectorIndexExplainPlanInput {
  readonly binding: VectorIndexBindingIdentity;
  readonly dialect: "postgres" | "tidb";
  readonly dimension: number;
  readonly explainPlan: unknown;
  readonly metric: VectorIndexMetric;
}

interface VerifiedVectorIndexExplainClaims {
  readonly bindingId: string;
  readonly dialect: "postgres" | "tidb";
  readonly dimension: number;
  readonly metric: VectorIndexMetric;
  readonly projectionKind: VectorIndexProjectionKind;
  readonly targetIndexName: string;
  readonly targetTableName: string;
}

const verifiedExplainPlans = new WeakMap<
  VerifiedVectorIndexExplainPlan,
  VerifiedVectorIndexExplainClaims
>();
const INTERNAL_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const GENERATED_INDEX_NAME_PATTERN = /^kfs_ann_(?:dense|visual)_[0-9a-f]{32}$/u;
const GENERATED_TABLE_NAME_PATTERN = /^kfs_ann_table_(?:dense|visual)_[0-9a-f]{32}$/u;
const MAX_EXPLAIN_PLAN_NODES = 10_000;
const POSTGRES_VECTOR_INDEX_TABLE_NAME = "index_projections";

/**
 * Resolves an honest vector-search capability. EXPLAIN evidence is necessary for a future ANN
 * strategy, while the current exact-only runtime remains explicitly reported as exact fallback.
 */
export function resolveVectorIndexCapability(
  input: ResolveVectorIndexCapabilityInput,
): VectorIndexCapability {
  validateCapabilityInput(input);
  const targetIndexName = input.binding ? buildVectorIndexName(input.binding) : undefined;

  if (input.dialect === "postgres") {
    return resolvePostgresCapability(input, targetIndexName);
  }

  return resolveTidbCapability(input, targetIndexName);
}

/**
 * Generates a bounded SQL identifier exclusively from a validated server-side binding UUID. The
 * raw identifier is hashed and can never be interpolated into DDL or EXPLAIN SQL.
 */
export function buildVectorIndexName(identity: VectorIndexBindingIdentity): string {
  validateBindingIdentity(identity);
  const normalizedBindingId = identity.bindingId.toLowerCase();
  const digest = createHash("sha256")
    .update(`${normalizedBindingId}:${identity.projectionKind}`)
    .digest("hex")
    .slice(0, 32);
  return `kfs_ann_${identity.projectionKind}_${digest}`;
}

/** Returns the physical table an ANN binding is allowed to target. */
export function buildVectorIndexTableName(
  identity: VectorIndexBindingIdentity,
  dialect: "postgres" | "tidb",
): string {
  validateBindingIdentity(identity);
  validateDialect(dialect);
  if (dialect === "postgres") {
    return POSTGRES_VECTOR_INDEX_TABLE_NAME;
  }

  const normalizedBindingId = identity.bindingId.toLowerCase();
  const digest = createHash("sha256")
    .update(`${normalizedBindingId}:${identity.projectionKind}`)
    .digest("hex")
    .slice(0, 32);
  return `kfs_ann_table_${identity.projectionKind}_${digest}`;
}

/**
 * Consumes bounded EXPLAIN JSON/tabular output and returns opaque in-process evidence only when one
 * ANN node proves the generated table/index, scan engine, metric operator, fixed dimension, and
 * vector-space predicates together. The returned object's visible fields are never trusted.
 */
export function verifyVectorIndexExplainPlan(
  input: VerifyVectorIndexExplainPlanInput,
): VerifiedVectorIndexExplainPlan | null {
  validateExplainVerificationInput(input);
  const targetIndexName = buildVectorIndexName(input.binding);
  const targetTableName = buildVectorIndexTableName(input.binding, input.dialect);
  const vectorColumn = input.binding.projectionKind === "dense" ? "dense_vector" : "visual_vector";
  if (
    !explainPlanProvesAnnContract(input.explainPlan, {
      dialect: input.dialect,
      dimension: input.dimension,
      metric: input.metric,
      targetIndexName,
      targetTableName,
      vectorColumn,
    })
  ) {
    return null;
  }

  const verification: VerifiedVectorIndexExplainPlan = Object.freeze({
    [VERIFIED_EXPLAIN_PLAN_BRAND]: true as const,
    verifiedBy: "explain" as const,
  });
  verifiedExplainPlans.set(
    verification,
    Object.freeze({
      bindingId: input.binding.bindingId.toLowerCase(),
      dialect: input.dialect,
      dimension: input.dimension,
      metric: input.metric,
      projectionKind: input.binding.projectionKind,
      targetIndexName,
      targetTableName,
    }),
  );
  return verification;
}

function resolvePostgresCapability(
  input: ResolveVectorIndexCapabilityInput,
  targetIndexName: string | undefined,
): VectorIndexCapability {
  if (input.dimension > POSTGRES_VECTOR_STORAGE_MAX_DIMENSION) {
    return unsupportedCapability(
      input,
      VECTOR_INDEX_CAPABILITY_REASONS.POSTGRES_STORAGE_DIMENSION_EXCEEDED,
    );
  }

  if (input.dimension > POSTGRES_HALFVEC_HNSW_MAX_DIMENSION) {
    return exactCapability(
      input,
      VECTOR_INDEX_CAPABILITY_REASONS.POSTGRES_DIMENSION_REQUIRES_EXACT,
    );
  }

  if (
    input.dimension > POSTGRES_VECTOR_HNSW_MAX_DIMENSION &&
    input.enablePostgresHalfvecAnn !== true
  ) {
    return exactCapability(input, VECTOR_INDEX_CAPABILITY_REASONS.POSTGRES_HALFVEC_OPT_IN_REQUIRED);
  }

  return resolveAnnCandidate({
    input,
    targetIndexName,
  });
}

function resolveTidbCapability(
  input: ResolveVectorIndexCapabilityInput,
  targetIndexName: string | undefined,
): VectorIndexCapability {
  if (input.dimension > TIDB_VECTOR_STORAGE_MAX_DIMENSION) {
    return unsupportedCapability(
      input,
      VECTOR_INDEX_CAPABILITY_REASONS.TIDB_STORAGE_DIMENSION_EXCEEDED,
    );
  }

  return resolveAnnCandidate({
    input,
    targetIndexName,
  });
}

function resolveAnnCandidate(input: {
  readonly input: ResolveVectorIndexCapabilityInput;
  readonly targetIndexName: string | undefined;
}): VectorIndexCapability {
  if (!input.targetIndexName) {
    return exactCapability(
      input.input,
      VECTOR_INDEX_CAPABILITY_REASONS.ANN_INDEX_BINDING_NOT_CONFIGURED,
    );
  }

  if (!isVerifiedForTarget(input.input.planVerification, input.input, input.targetIndexName)) {
    return {
      ...exactCapability(
        input.input,
        VECTOR_INDEX_CAPABILITY_REASONS.EXPLAIN_TARGET_INDEX_NOT_CONFIRMED,
      ),
      targetIndexName: input.targetIndexName,
    };
  }

  // The database retrieval repositories still execute their exact distance SQL and do not consume
  // this ANN binding. A valid catalog/EXPLAIN proof is necessary but cannot make an unwired runtime
  // ready. Keep this fail-closed latch until the concrete query adapter supplies ANN candidates.
  return {
    ...exactCapability(input.input, VECTOR_INDEX_CAPABILITY_REASONS.ANN_RUNTIME_NOT_CONNECTED),
    targetIndexName: input.targetIndexName,
  };
}

function exactCapability(
  input: Pick<ResolveVectorIndexCapabilityInput, "dimension" | "metric">,
  reason: VectorIndexCapabilityReason,
): VectorIndexCapability {
  return {
    dimension: input.dimension,
    metric: input.metric,
    needsExactRescore: false,
    reason,
    status: "exact_fallback",
    strategy: "exact",
  };
}

function unsupportedCapability(
  input: Pick<ResolveVectorIndexCapabilityInput, "dimension" | "metric">,
  reason: VectorIndexCapabilityReason,
): VectorIndexCapability {
  return {
    dimension: input.dimension,
    metric: input.metric,
    needsExactRescore: false,
    reason,
    status: "unsupported",
    strategy: "unsupported",
  };
}

function isVerifiedForTarget(
  verification: VerifiedVectorIndexExplainPlan | undefined,
  input: ResolveVectorIndexCapabilityInput,
  targetIndexName: string,
): boolean {
  if (verification === undefined || input.binding === undefined) {
    return false;
  }
  const claims = verifiedExplainPlans.get(verification);
  return Boolean(
    claims &&
      claims.bindingId === input.binding.bindingId.toLowerCase() &&
      claims.projectionKind === input.binding.projectionKind &&
      claims.dialect === input.dialect &&
      claims.dimension === input.dimension &&
      claims.metric === input.metric &&
      claims.targetIndexName === targetIndexName &&
      claims.targetTableName === buildVectorIndexTableName(input.binding, input.dialect),
  );
}

function validateCapabilityInput(input: ResolveVectorIndexCapabilityInput): void {
  if (input.dialect !== "postgres" && input.dialect !== "tidb") {
    throw new Error("Vector index dialect must be postgres or tidb");
  }
  if (!Number.isSafeInteger(input.dimension) || input.dimension < 1) {
    throw new Error("Vector index dimension must be a positive safe integer");
  }
  if (input.metric !== "cosine" && input.metric !== "dot" && input.metric !== "l2") {
    throw new Error("Vector index metric must be cosine, dot, or l2");
  }
  if (
    input.enablePostgresHalfvecAnn !== undefined &&
    typeof input.enablePostgresHalfvecAnn !== "boolean"
  ) {
    throw new Error("Vector index halfvec opt-in must be boolean");
  }
  if (input.binding) {
    validateBindingIdentity(input.binding);
  }
}

function validateBindingIdentity(identity: VectorIndexBindingIdentity): void {
  if (
    !identity ||
    typeof identity !== "object" ||
    !INTERNAL_UUID_PATTERN.test(identity.bindingId)
  ) {
    throw new Error("Vector index bindingId must be an internal UUID");
  }
  if (identity.projectionKind !== "dense" && identity.projectionKind !== "visual") {
    throw new Error("Vector index projectionKind must be dense or visual");
  }
}

function validateDialect(dialect: unknown): asserts dialect is "postgres" | "tidb" {
  if (dialect !== "postgres" && dialect !== "tidb") {
    throw new Error("Vector index dialect must be postgres or tidb");
  }
}

function validateExplainVerificationInput(input: VerifyVectorIndexExplainPlanInput): void {
  if (!input || typeof input !== "object") {
    throw new Error("Vector index EXPLAIN verification input is required");
  }
  validateDialect(input.dialect);
  validateBindingIdentity(input.binding);
  if (!Number.isSafeInteger(input.dimension) || input.dimension < 1) {
    throw new Error("Vector index dimension must be a positive safe integer");
  }
  if (input.metric !== "cosine" && input.metric !== "dot" && input.metric !== "l2") {
    throw new Error("Vector index metric must be cosine, dot, or l2");
  }
}

function assertGeneratedVectorIndexName(indexName: string): void {
  if (!GENERATED_INDEX_NAME_PATTERN.test(indexName)) {
    throw new Error("Vector index name must be a generated internal identifier");
  }
}

function assertVectorIndexTableName(tableName: string, dialect: "postgres" | "tidb"): void {
  if (
    (dialect === "postgres" && tableName !== POSTGRES_VECTOR_INDEX_TABLE_NAME) ||
    (dialect === "tidb" && !GENERATED_TABLE_NAME_PATTERN.test(tableName))
  ) {
    throw new Error("Vector index table name must be the generated physical target");
  }
}

interface ExplainPlanExpectation {
  readonly dialect: "postgres" | "tidb";
  readonly dimension: number;
  readonly metric: VectorIndexMetric;
  readonly targetIndexName: string;
  readonly targetTableName: string;
  readonly vectorColumn: "dense_vector" | "visual_vector";
}

function explainPlanProvesAnnContract(plan: unknown, expectation: ExplainPlanExpectation): boolean {
  assertGeneratedVectorIndexName(expectation.targetIndexName);
  assertVectorIndexTableName(expectation.targetTableName, expectation.dialect);
  const pending: unknown[] = [plan];
  const visited = new WeakSet<object>();
  let visitedNodes = 0;

  while (pending.length > 0 && visitedNodes < MAX_EXPLAIN_PLAN_NODES) {
    const value = pending.pop();
    visitedNodes += 1;
    if (!value || typeof value !== "object") continue;
    if (visited.has(value)) continue;
    visited.add(value);

    if (Array.isArray(value)) {
      pending.push(...value);
      continue;
    }

    const record = value as Record<string, unknown>;
    if (planNodeProvesAnnContract(record, expectation)) {
      return true;
    }
    for (const child of Object.values(record)) {
      pending.push(child);
    }
  }

  return false;
}

function planNodeProvesAnnContract(
  record: Readonly<Record<string, unknown>>,
  expectation: ExplainPlanExpectation,
): boolean {
  const normalized = normalizedPlanFields(record);
  const accessObjects = stringPlanFields(normalized, ["accessobject"]);
  const hasIndex =
    stringPlanFields(normalized, ["indexname"]).includes(expectation.targetIndexName) ||
    accessObjects.some((value) =>
      tidbAccessObjectUsesNamedObject(value, "index", expectation.targetIndexName),
    );
  if (!hasIndex) return false;

  const hasTable =
    stringPlanFields(normalized, ["relationname", "tablename"]).includes(
      expectation.targetTableName,
    ) ||
    accessObjects.some((value) =>
      tidbAccessObjectUsesNamedObject(value, "table", expectation.targetTableName),
    );
  if (!hasTable || !planNodeIsAnnScan(normalized, expectation.dialect)) return false;

  const operatorText = canonicalSql(
    stringPlanFields(normalized, ["indexcond", "operator", "operatorinfo", "orderby"]).join(" "),
  );
  if (!operatorMatchesMetric(operatorText, expectation)) return false;

  const predicateText = canonicalSql(
    stringPlanFields(normalized, [
      "accessconditions",
      "attachedcondition",
      "filter",
      "indexcond",
      "operatorinfo",
      "otherconditions",
      "predicate",
    ]).join(" "),
  );
  return predicateMatchesBinding(predicateText, expectation);
}

function normalizedPlanFields(
  record: Readonly<Record<string, unknown>>,
): ReadonlyMap<string, readonly unknown[]> {
  const fields = new Map<string, unknown[]>();
  for (const [key, value] of Object.entries(record)) {
    const normalizedKey = key.toLowerCase().replace(/[\s_-]/gu, "");
    const values = fields.get(normalizedKey) ?? [];
    values.push(value);
    fields.set(normalizedKey, values);
  }
  return fields;
}

function stringPlanFields(
  fields: ReadonlyMap<string, readonly unknown[]>,
  keys: readonly string[],
): string[] {
  const result: string[] = [];
  for (const key of keys) {
    for (const value of fields.get(key) ?? []) {
      if (typeof value === "string") result.push(value);
    }
  }
  return result;
}

function planNodeIsAnnScan(
  fields: ReadonlyMap<string, readonly unknown[]>,
  dialect: "postgres" | "tidb",
): boolean {
  if (dialect === "postgres") {
    return stringPlanFields(fields, ["nodetype"]).some((value) => {
      const nodeType = value.toLowerCase().replace(/[\s_-]/gu, "");
      return nodeType === "indexscan" || nodeType === "indexonlyscan";
    });
  }

  const vectorReader = stringPlanFields(fields, ["id", "nodetype", "operator"]).some((value) =>
    value
      .toLowerCase()
      .replace(/[\s_-]/gu, "")
      .includes("vectorindex"),
  );
  const tiflash = stringPlanFields(fields, ["engine", "store", "task"]).some((value) =>
    value.toLowerCase().includes("tiflash"),
  );
  return vectorReader && tiflash;
}

function operatorMatchesMetric(operatorText: string, expectation: ExplainPlanExpectation): boolean {
  if (!mentionsSqlIdentifier(operatorText, expectation.vectorColumn)) return false;
  if (!operatorExpressionHasDimension(operatorText, expectation)) return false;
  if (expectation.dialect === "postgres") {
    const operator = { cosine: "<=>", dot: "<#>", l2: "<->" }[expectation.metric];
    return operatorText.includes(operator);
  }

  const operator = {
    cosine: "vec_cosine_distance",
    dot: "vec_negative_inner_product",
    l2: "vec_l2_distance",
  }[expectation.metric];
  return mentionsSqlIdentifier(operatorText, operator);
}

function operatorExpressionHasDimension(
  operatorText: string,
  expectation: ExplainPlanExpectation,
): boolean {
  if (expectation.dialect === "tidb") {
    return new RegExp(`\\bas\\s+vector\\s*\\(\\s*${expectation.dimension}\\s*\\)`, "u").test(
      operatorText,
    );
  }

  const vectorColumn = escapeRegExp(expectation.vectorColumn);
  const vectorType =
    expectation.dimension <= POSTGRES_VECTOR_HNSW_MAX_DIMENSION ? "vector" : "halfvec";
  return new RegExp(
    `(?:^|[^a-z0-9_])(?:[a-z_][a-z0-9_]*\\.)?${vectorColumn}\\s*::\\s*${vectorType}\\s*\\(\\s*${expectation.dimension}\\s*\\)`,
    "u",
  ).test(operatorText);
}

function predicateMatchesBinding(
  predicateText: string,
  expectation: ExplainPlanExpectation,
): boolean {
  if (!predicateHasEquality(predicateText, "knowledge_space_id")) return false;
  if (!predicateHasEquality(predicateText, "model")) return false;
  if (!predicateHasLiteral(predicateText, "status", "ready")) return false;
  if (!predicateHasLiteral(predicateText, "type", "dense-vector")) return false;

  const vectorColumn = escapeRegExp(expectation.vectorColumn);
  const qualifiedColumn = `(?:[a-z_][a-z0-9_]*\\.)?${vectorColumn}`;
  const nonNull = new RegExp(
    `(?:^|[^a-z0-9_])${qualifiedColumn}\\s+is\\s+not\\s+null(?:$|[^a-z0-9_])`,
    "u",
  ).test(predicateText);
  if (!nonNull) return false;

  const dimensionFunction = expectation.dialect === "postgres" ? "vector_dims" : "vec_dims";
  return new RegExp(
    `(?:^|[^a-z0-9_])${dimensionFunction}\\s*\\(\\s*${qualifiedColumn}\\s*\\)\\s*=\\s*${expectation.dimension}(?:$|[^0-9])`,
    "u",
  ).test(predicateText);
}

function predicateHasEquality(predicateText: string, column: string): boolean {
  const escapedColumn = escapeRegExp(column);
  return new RegExp(
    `(?:^|[^a-z0-9_])(?:[a-z_][a-z0-9_]*\\.)?${escapedColumn}\\s*=\\s*(?!null(?:$|[^a-z0-9_]))[^\\s)]+`,
    "u",
  ).test(predicateText);
}

function predicateHasLiteral(predicateText: string, column: string, literal: string): boolean {
  const escapedColumn = escapeRegExp(column);
  const escapedLiteral = escapeRegExp(literal);
  return new RegExp(
    `(?:^|[^a-z0-9_])(?:[a-z_][a-z0-9_]*\\.)?${escapedColumn}\\s*=\\s*'${escapedLiteral}'(?:$|[^a-z0-9_-])`,
    "u",
  ).test(predicateText);
}

function mentionsSqlIdentifier(text: string, identifier: string): boolean {
  const escaped = escapeRegExp(identifier);
  return new RegExp(`(?:^|[^a-z0-9_])${escaped}(?:$|[^a-z0-9_])`, "u").test(text);
}

function canonicalSql(value: string): string {
  return value
    .toLowerCase()
    .replace(/\x22/gu, "")
    .replace(/[`]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function tidbAccessObjectUsesNamedObject(
  accessObject: string,
  kind: "index" | "table",
  targetName: string,
): boolean {
  const escapedTarget = escapeRegExp(targetName);
  return new RegExp(`(?:^|[,\\s])${kind}:${escapedTarget}(?:$|[,\\s(])`, "iu").test(accessObject);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
