import type { DatabaseAdapter, DatabaseExecutor, DatabaseQueryValue } from "@knowledge/core";

import {
  createReusableDatabaseParameter,
  databasePlaceholder,
  jsonInsertPlaceholder,
  quoteDatabaseIdentifier,
} from "./database-sql-utils";

export interface EvidenceDeletionTarget {
  readonly deleteMode: "cascade" | "keep";
  readonly knowledgeSpaceId: string;
  readonly targetId: string;
  readonly targetType: "document_asset" | "knowledge_space" | "logical_document" | "source";
}

export interface GoldenQuestionDeletionAdmissionCandidate {
  readonly expectedEvidenceIds: readonly string[];
  readonly knowledgeSpaceId: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly tenantId: string;
}

export interface TargetDocumentSqlParameters {
  readonly space: () => string;
  readonly target: () => string;
}

interface EvidenceScopeSql {
  readonly documentMatches: (documentIdExpression: string, textComparison: boolean) => string;
  readonly space: () => string;
}

interface TargetGoldenQuestionQuery {
  readonly params: DatabaseQueryValue[];
  readonly predicateSql: string;
}

/**
 * Produces one correlated visibility predicate for Golden Question reads. The active-job lookup is
 * indexable by tenant/space/active_slot and the complete overlap test stays in the same statement,
 * so child-deletion admission cannot race a get/list response and list reads do not become N+1.
 */
export function goldenQuestionDeletionReadableSql(
  database: DatabaseAdapter,
  questionAlias: string,
): string {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const activeAlias = "active_golden_deletion";
  const tenantId = `${questionAlias}.${q("tenant_id")}`;
  const spaceId = `${questionAlias}.${q("knowledge_space_id")}`;
  const conflict = activeGoldenQuestionDeletionConflictSql(database, questionAlias, activeAlias);
  return `NOT EXISTS (SELECT 1 FROM ${q("deletion_jobs")} AS ${activeAlias} WHERE ${activeAlias}.${q("tenant_id")} = ${tenantId} AND ${activeAlias}.${q("knowledge_space_id")} = ${spaceId} AND ${activeAlias}.${q("active_slot")} = 1 AND ${conflict})`;
}

export function targetGoldenQuestionPredicateSql(
  database: DatabaseAdapter,
  job: EvidenceDeletionTarget,
  questionAlias: string,
  parameters?: TargetDocumentSqlParameters,
): string {
  if (job.targetType === "source" && job.deleteMode === "keep") return "1 = 0";
  if (job.targetType === "knowledge_space") return "1 = 1";
  return goldenQuestionPredicateForEvidenceScope(
    database,
    questionAlias,
    staticEvidenceScope(database, job, parameters),
  );
}

export function targetGoldenQuestionQuery(
  database: DatabaseAdapter,
  job: EvidenceDeletionTarget,
  questionAlias: string,
): TargetGoldenQuestionQuery {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const params: DatabaseQueryValue[] = [];
  const parameters: TargetDocumentSqlParameters = {
    space: createReusableDatabaseParameter(database, params, job.knowledgeSpaceId),
    target: createReusableDatabaseParameter(database, params, job.targetId),
  };
  const space = parameters.space();
  const target = targetGoldenQuestionPredicateSql(database, job, questionAlias, parameters);
  return {
    params,
    predicateSql: `${questionAlias}.${q("knowledge_space_id")} = ${space} AND ${target}`,
  };
}

export function targetDocumentQueryParams(job: EvidenceDeletionTarget): DatabaseQueryValue[] {
  return job.targetType === "knowledge_space"
    ? [job.knowledgeSpaceId]
    : [job.knowledgeSpaceId, job.targetId];
}

export function targetEvidenceBundlePredicateSql(
  database: DatabaseAdapter,
  job: EvidenceDeletionTarget,
  bundleAlias: string,
  parameters?: TargetDocumentSqlParameters,
): string {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  return evidenceItemsPredicateForScope(
    database,
    `${bundleAlias}.${q("items")}`,
    staticEvidenceScope(database, job, parameters),
  );
}

export function targetTraceEvidencePredicateSql(
  database: DatabaseAdapter,
  job: EvidenceDeletionTarget,
  traceAlias: string,
  parameters?: TargetDocumentSqlParameters,
): string {
  return traceEvidencePredicateForScope(
    database,
    traceAlias,
    staticEvidenceScope(database, job, parameters),
  );
}

export function targetEvidenceItemsPredicateSql(
  database: DatabaseAdapter,
  job: EvidenceDeletionTarget,
  items: string,
  parameters?: TargetDocumentSqlParameters,
): string {
  return evidenceItemsPredicateForScope(
    database,
    items,
    staticEvidenceScope(database, job, parameters),
  );
}

/**
 * Checks every active child-deletion target against a not-yet-written Golden Question. The caller
 * must hold the canonical space-row admission lock before invoking this helper.
 */
export async function hasActiveGoldenQuestionDeletionConflict(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: GoldenQuestionDeletionAdmissionCandidate,
): Promise<boolean> {
  return hasAnyActiveGoldenQuestionDeletionConflict(database, executor, [input]);
}

/**
 * Batch form used by Golden Question imports. It joins every candidate to every active job in one
 * bounded query, locks the first conflicting job, and therefore cannot miss a later matching job
 * after observing an unrelated or Source-keep deletion.
 */
export async function hasAnyActiveGoldenQuestionDeletionConflict(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  inputs: readonly GoldenQuestionDeletionAdmissionCandidate[],
): Promise<boolean> {
  const first = inputs[0];
  if (!first) return false;
  for (const input of inputs) {
    if (input.tenantId !== first.tenantId || input.knowledgeSpaceId !== first.knowledgeSpaceId) {
      throw new Error("Golden Question deletion admission candidates must share one space");
    }
  }
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const candidateAlias = "golden_candidate";
  const activeAlias = "active_golden_deletion";
  const serializedCandidates = JSON.stringify(
    inputs.map((input) => ({
      expected_evidence_ids: input.expectedEvidenceIds,
      metadata: input.metadata,
    })),
  );
  const candidateJson = jsonInsertPlaceholder(database, 1, "payload");
  const candidates =
    database.dialect === "postgres"
      ? `jsonb_to_recordset(${candidateJson}) AS ${candidateAlias}(${q("expected_evidence_ids")} jsonb, ${q("metadata")} jsonb)`
      : `JSON_TABLE(${candidateJson}, '$[*]' COLUMNS (${q("expected_evidence_ids")} JSON PATH '$.expected_evidence_ids', ${q("metadata")} JSON PATH '$.metadata')) AS ${candidateAlias}`;
  const conflict = activeGoldenQuestionDeletionConflictSql(database, candidateAlias, activeAlias);
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [serializedCandidates, first.tenantId, first.knowledgeSpaceId],
    sql: `SELECT ${activeAlias}.${q("id")} FROM ${q("deletion_jobs")} AS ${activeAlias} CROSS JOIN ${candidates} WHERE ${activeAlias}.${q("tenant_id")} = ${p(2)} AND ${activeAlias}.${q("knowledge_space_id")} = ${p(3)} AND ${activeAlias}.${q("active_slot")} = 1 AND ${conflict} LIMIT 1${database.dialect === "postgres" ? ` FOR UPDATE OF ${activeAlias}` : " FOR UPDATE"};`,
    tableName: "deletion_jobs",
  });
  return result.rows.length > 0;
}

function activeGoldenQuestionDeletionConflictSql(
  database: DatabaseAdapter,
  questionAlias: string,
  activeAlias: string,
): string {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const targetType = `${activeAlias}.${q("target_type")}`;
  const targetId = `${activeAlias}.${q("target_id")}`;
  const deleteMode = `${activeAlias}.${q("delete_mode")}`;
  const spaceId = `${activeAlias}.${q("knowledge_space_id")}`;
  const scope: EvidenceScopeSql = {
    documentMatches: (documentIdExpression, textComparison) =>
      dynamicTargetDocumentMembershipSql(database, {
        documentIdExpression,
        spaceExpression: spaceId,
        targetIdExpression: targetId,
        targetTypeExpression: targetType,
        textComparison,
      }),
    space: () => spaceId,
  };
  const childOverlap = goldenQuestionPredicateForEvidenceScope(database, questionAlias, scope);
  const supportedChild = `${targetType} IN ('source', 'logical_document', 'document_asset')`;
  const sourceDocumentsKept = `(${targetType} = 'source' AND COALESCE(${deleteMode}, 'cascade') = 'keep')`;
  const wholeSpace = `(${targetType} = 'knowledge_space' AND ${targetId} = ${spaceId})`;
  const unsupportedTarget = `${targetType} NOT IN ('knowledge_space', 'source', 'logical_document', 'document_asset')`;
  return `(${wholeSpace} OR ${unsupportedTarget} OR (${supportedChild} AND NOT ${sourceDocumentsKept} AND ${childOverlap}))`;
}

export function targetDocumentMembershipAtSql(
  database: DatabaseAdapter,
  job: EvidenceDeletionTarget,
  documentIdExpression: string,
  textComparison: boolean,
  spaceParamPosition: number,
  targetParamPosition: number,
  parameters?: TargetDocumentSqlParameters,
): string {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const space = () => parameters?.space() ?? p(spaceParamPosition);
  const target = () => parameters?.target() ?? p(targetParamPosition);
  if (job.targetType === "document_asset") {
    const targetParameter = textComparison
      ? database.dialect === "postgres"
        ? `CAST(CAST(${target()} AS UUID) AS TEXT)`
        : `CAST(${target()} AS CHAR(36))`
      : target();
    return `${documentIdExpression} = ${targetParameter}`;
  }
  if (job.targetType === "logical_document") {
    const selectedRevisionAsset = textComparison
      ? database.dialect === "postgres"
        ? `CAST(owned_revision.${q("document_asset_id")} AS TEXT)`
        : `CAST(owned_revision.${q("document_asset_id")} AS CHAR(36))`
      : `owned_revision.${q("document_asset_id")}`;
    return `${documentIdExpression} IN (SELECT ${selectedRevisionAsset} FROM ${q("document_revisions")} owned_revision WHERE owned_revision.${q("knowledge_space_id")} = ${space()} AND owned_revision.${q("document_id")} = ${target()} AND NOT EXISTS (SELECT 1 FROM ${q("document_revisions")} external_revision WHERE external_revision.${q("knowledge_space_id")} = ${space()} AND external_revision.${q("document_id")} <> ${target()} AND external_revision.${q("document_asset_id")} = owned_revision.${q("document_asset_id")}))`;
  }
  const selectedDocumentId = textComparison
    ? database.dialect === "postgres"
      ? `CAST(target_document.${q("id")} AS TEXT)`
      : `CAST(target_document.${q("id")} AS CHAR(36))`
    : `target_document.${q("id")}`;
  return `${documentIdExpression} IN (SELECT ${selectedDocumentId} FROM ${q("document_assets")} AS target_document WHERE target_document.${q("knowledge_space_id")} = ${space()} AND target_document.${q("source_id")} = ${target()})`;
}

function staticEvidenceScope(
  database: DatabaseAdapter,
  job: EvidenceDeletionTarget,
  parameters?: TargetDocumentSqlParameters,
): EvidenceScopeSql {
  return {
    documentMatches: (documentIdExpression, textComparison) =>
      targetDocumentMembershipSql(database, job, documentIdExpression, textComparison, parameters),
    space: () => parameters?.space() ?? databasePlaceholder(database, 1),
  };
}

function goldenQuestionPredicateForEvidenceScope(
  database: DatabaseAdapter,
  questionAlias: string,
  scope: EvidenceScopeSql,
): string {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const metadata = `${questionAlias}.${q("metadata")}`;
  const expectedEvidence = `${questionAlias}.${q("expected_evidence_ids")}`;
  const contextItems =
    database.dialect === "postgres"
      ? `${metadata} -> 'evidenceContext' -> 'items'`
      : `JSON_EXTRACT(${metadata}, '$.evidenceContext.items')`;
  const expectedPredicate = goldenEvidenceIdArrayPredicateSql(
    database,
    expectedEvidence,
    "golden_expected",
    scope,
  );
  const contextExpected =
    database.dialect === "postgres"
      ? `${metadata} -> 'evidenceContext' -> 'expectedEvidenceIds'`
      : `JSON_EXTRACT(${metadata}, '$.evidenceContext.expectedEvidenceIds')`;
  const contextExpectedPredicate = goldenEvidenceIdArrayPredicateSql(
    database,
    contextExpected,
    "golden_context_expected",
    scope,
  );
  const evidenceMatchPredicate = goldenEvidenceMatchPredicateSql(database, metadata, scope);
  const missingEvidencePredicate = goldenMissingEvidencePredicateSql(database, metadata, scope);
  const traceId =
    database.dialect === "postgres"
      ? `COALESCE(${metadata} ->> 'traceId', ${metadata} ->> 'answerTraceId', ${metadata} -> 'evidenceContext' ->> 'traceId')`
      : `COALESCE(JSON_UNQUOTE(JSON_EXTRACT(${metadata}, '$.traceId')), JSON_UNQUOTE(JSON_EXTRACT(${metadata}, '$.answerTraceId')), JSON_UNQUOTE(JSON_EXTRACT(${metadata}, '$.evidenceContext.traceId')))`;
  const traceIdMatch =
    database.dialect === "postgres"
      ? `CAST(golden_trace.${q("id")} AS TEXT) = ${traceId}`
      : `CAST(golden_trace.${q("id")} AS CHAR(36)) = ${traceId}`;
  const contextItemsPredicate = evidenceItemsPredicateForScope(database, contextItems, scope);
  const relatedTrace = `EXISTS (SELECT 1 FROM ${q("answer_traces")} AS golden_trace WHERE golden_trace.${q("knowledge_space_id")} = ${scope.space()} AND ${traceIdMatch} AND ${traceEvidencePredicateForScope(database, "golden_trace", scope)})`;
  return `(${expectedPredicate} OR ${contextExpectedPredicate} OR ${evidenceMatchPredicate} OR ${missingEvidencePredicate} OR ${contextItemsPredicate} OR ${relatedTrace})`;
}

function goldenEvidenceIdArrayPredicateSql(
  database: DatabaseAdapter,
  jsonArray: string,
  alias: string,
  scope: EvidenceScopeSql,
): string {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const evidenceId = `${alias}.evidence_id`;
  const directDocument = scope.documentMatches(evidenceId, true);
  const nodeDocument = scope.documentMatches(`golden_node.${q("document_asset_id")}`, false);
  const nodeIdMatch =
    database.dialect === "postgres"
      ? `CAST(golden_node.${q("id")} AS TEXT) = ${evidenceId}`
      : `CAST(golden_node.${q("id")} AS CHAR(36)) = ${evidenceId}`;
  const bundleIdMatch =
    database.dialect === "postgres"
      ? `CAST(golden_bundle.${q("id")} AS TEXT) = ${evidenceId}`
      : `CAST(golden_bundle.${q("id")} AS CHAR(36)) = ${evidenceId}`;
  const traceIdMatch =
    database.dialect === "postgres"
      ? `CAST(golden_expected_trace.${q("id")} AS TEXT) = ${evidenceId}`
      : `CAST(golden_expected_trace.${q("id")} AS CHAR(36)) = ${evidenceId}`;
  const bundlePredicate = evidenceBundlePredicateForScope(database, "golden_bundle", scope);
  const tracePredicate = traceEvidencePredicateForScope(database, "golden_expected_trace", scope);
  const target = `(${directDocument} OR EXISTS (SELECT 1 FROM ${q("knowledge_nodes")} AS golden_node WHERE golden_node.${q("knowledge_space_id")} = ${scope.space()} AND ${nodeIdMatch} AND ${nodeDocument}) OR EXISTS (SELECT 1 FROM ${q("evidence_bundles")} AS golden_bundle WHERE ${bundleIdMatch} AND ${bundlePredicate}) OR EXISTS (SELECT 1 FROM ${q("answer_traces")} AS golden_expected_trace WHERE golden_expected_trace.${q("knowledge_space_id")} = ${scope.space()} AND ${traceIdMatch} AND ${tracePredicate}))`;
  if (database.dialect === "postgres") {
    const safeArray = `CASE WHEN jsonb_typeof(${jsonArray}) = 'array' THEN ${jsonArray} ELSE '[]'::jsonb END`;
    return `EXISTS (SELECT 1 FROM jsonb_array_elements_text(${safeArray}) AS ${alias}(evidence_id) WHERE ${target})`;
  }
  return `EXISTS (SELECT 1 FROM JSON_TABLE(${jsonArray}, '$[*]' COLUMNS (evidence_id VARCHAR(255) PATH '$')) AS ${alias} WHERE ${target})`;
}

function goldenMissingEvidencePredicateSql(
  database: DatabaseAdapter,
  metadata: string,
  scope: EvidenceScopeSql,
): string {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const evidenceId = "golden_missing.evidence_id";
  const directDocument = scope.documentMatches(evidenceId, true);
  const nodeDocument = scope.documentMatches(
    `golden_missing_node.${q("document_asset_id")}`,
    false,
  );
  const nodeIdMatch =
    database.dialect === "postgres"
      ? `CAST(golden_missing_node.${q("id")} AS TEXT) = ${evidenceId}`
      : `CAST(golden_missing_node.${q("id")} AS CHAR(36)) = ${evidenceId}`;
  const target = `(${directDocument} OR EXISTS (SELECT 1 FROM ${q("knowledge_nodes")} AS golden_missing_node WHERE golden_missing_node.${q("knowledge_space_id")} = ${scope.space()} AND ${nodeIdMatch} AND ${nodeDocument}))`;
  if (database.dialect === "postgres") {
    const missing = `${metadata} -> 'evidenceContext' -> 'missingEvidence'`;
    const safeMissing = `CASE WHEN jsonb_typeof(${missing}) = 'array' THEN ${missing} ELSE '[]'::jsonb END`;
    return `EXISTS (SELECT 1 FROM jsonb_array_elements(${safeMissing}) AS golden_missing_item(value) CROSS JOIN LATERAL (SELECT golden_missing_item.value ->> 'expectedEvidenceId' AS evidence_id) AS golden_missing WHERE ${target})`;
  }
  return `EXISTS (SELECT 1 FROM JSON_TABLE(${metadata}, '$.evidenceContext.missingEvidence[*]' COLUMNS (evidence_id VARCHAR(255) PATH '$.expectedEvidenceId')) AS golden_missing WHERE ${target})`;
}

function goldenEvidenceMatchPredicateSql(
  database: DatabaseAdapter,
  metadata: string,
  scope: EvidenceScopeSql,
): string {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const documentAssetId =
    database.dialect === "postgres"
      ? `${metadata} -> 'evidenceMatch' ->> 'documentAssetId'`
      : `JSON_UNQUOTE(JSON_EXTRACT(${metadata}, '$.evidenceMatch.documentAssetId'))`;
  const nodeId =
    database.dialect === "postgres"
      ? `${metadata} -> 'evidenceMatch' ->> 'nodeId'`
      : `JSON_UNQUOTE(JSON_EXTRACT(${metadata}, '$.evidenceMatch.nodeId'))`;
  const nodeIdMatch =
    database.dialect === "postgres"
      ? `CAST(golden_match_node.${q("id")} AS TEXT) = ${nodeId}`
      : `CAST(golden_match_node.${q("id")} AS CHAR(36)) = ${nodeId}`;
  const directDocument = scope.documentMatches(documentAssetId, true);
  const nodeDocument = scope.documentMatches(`golden_match_node.${q("document_asset_id")}`, false);
  return `(${directDocument} OR EXISTS (SELECT 1 FROM ${q("knowledge_nodes")} AS golden_match_node WHERE golden_match_node.${q("knowledge_space_id")} = ${scope.space()} AND ${nodeIdMatch} AND ${nodeDocument}))`;
}

function evidenceBundlePredicateForScope(
  database: DatabaseAdapter,
  bundleAlias: string,
  scope: EvidenceScopeSql,
): string {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  return evidenceItemsPredicateForScope(database, `${bundleAlias}.${q("items")}`, scope);
}

function traceEvidencePredicateForScope(
  database: DatabaseAdapter,
  traceAlias: string,
  scope: EvidenceScopeSql,
): string {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const bundleAlias = "target_bundle";
  const stepAlias = "target_inline_evidence_step";
  const inlineItems =
    database.dialect === "postgres"
      ? `${stepAlias}.${q("metadata")} -> 'evidenceBundle' -> 'items'`
      : `COALESCE(JSON_EXTRACT(${stepAlias}.${q("metadata")}, '$.evidenceBundle.items'), JSON_ARRAY())`;
  const persistedBundle = `EXISTS (SELECT 1 FROM ${q("evidence_bundles")} AS ${bundleAlias} WHERE (${bundleAlias}.${q("id")} = ${traceAlias}.${q("evidence_bundle_id")} OR ${bundleAlias}.${q("trace_id")} = ${traceAlias}.${q("id")}) AND ${evidenceBundlePredicateForScope(database, bundleAlias, scope)})`;
  const inlineBundle = `EXISTS (SELECT 1 FROM ${q("answer_trace_steps")} AS ${stepAlias} WHERE ${stepAlias}.${q("trace_id")} = ${traceAlias}.${q("id")} AND ${evidenceItemsPredicateForScope(database, inlineItems, scope)})`;
  return `(${persistedBundle} OR ${inlineBundle})`;
}

function evidenceItemsPredicateForScope(
  database: DatabaseAdapter,
  items: string,
  scope: EvidenceScopeSql,
): string {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const itemTargetDocument = scope.documentMatches(
    database.dialect === "postgres"
      ? `target_citation.value ->> 'documentAssetId'`
      : "target_citation.document_asset_id",
    true,
  );
  const nodeTargetDocument = scope.documentMatches(`target_node.${q("document_asset_id")}`, false);
  if (database.dialect === "postgres") {
    const safeItems = `CASE WHEN jsonb_typeof(${items}) = 'array' THEN ${items} ELSE '[]'::jsonb END`;
    const citations = `target_item.value -> 'citations'`;
    const safeCitations = `CASE WHEN jsonb_typeof(${citations}) = 'array' THEN ${citations} ELSE '[]'::jsonb END`;
    return `EXISTS (SELECT 1 FROM jsonb_array_elements(${safeItems}) AS target_item(value) WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(${safeCitations}) AS target_citation(value) WHERE ${itemTargetDocument}) OR EXISTS (SELECT 1 FROM ${q("knowledge_nodes")} AS target_node WHERE target_node.${q("knowledge_space_id")} = ${scope.space()} AND CAST(target_node.${q("id")} AS TEXT) = target_item.value ->> 'nodeId' AND ${nodeTargetDocument}))`;
  }
  return `(EXISTS (SELECT 1 FROM JSON_TABLE(${items}, '$[*].citations[*]' COLUMNS (document_asset_id VARCHAR(255) PATH '$.documentAssetId')) AS target_citation WHERE ${itemTargetDocument}) OR EXISTS (SELECT 1 FROM JSON_TABLE(${items}, '$[*]' COLUMNS (node_id VARCHAR(255) PATH '$.nodeId')) AS target_item INNER JOIN ${q("knowledge_nodes")} AS target_node ON CAST(target_node.${q("id")} AS CHAR(36)) = target_item.node_id WHERE target_node.${q("knowledge_space_id")} = ${scope.space()} AND ${nodeTargetDocument}))`;
}

function targetDocumentMembershipSql(
  database: DatabaseAdapter,
  job: EvidenceDeletionTarget,
  documentIdExpression: string,
  textComparison: boolean,
  parameters?: TargetDocumentSqlParameters,
): string {
  return targetDocumentMembershipAtSql(
    database,
    job,
    documentIdExpression,
    textComparison,
    1,
    2,
    parameters,
  );
}

function dynamicTargetDocumentMembershipSql(
  database: DatabaseAdapter,
  input: {
    readonly documentIdExpression: string;
    readonly spaceExpression: string;
    readonly targetIdExpression: string;
    readonly targetTypeExpression: string;
    readonly textComparison: boolean;
  },
): string {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const targetDocument = input.textComparison
    ? database.dialect === "postgres"
      ? `CAST(${input.targetIdExpression} AS TEXT)`
      : `CAST(${input.targetIdExpression} AS CHAR(36))`
    : input.targetIdExpression;
  const selectedRevisionAsset = input.textComparison
    ? database.dialect === "postgres"
      ? `CAST(owned_revision.${q("document_asset_id")} AS TEXT)`
      : `CAST(owned_revision.${q("document_asset_id")} AS CHAR(36))`
    : `owned_revision.${q("document_asset_id")}`;
  const selectedSourceAsset = input.textComparison
    ? database.dialect === "postgres"
      ? `CAST(target_document.${q("id")} AS TEXT)`
      : `CAST(target_document.${q("id")} AS CHAR(36))`
    : `target_document.${q("id")}`;
  const asset = `(${input.targetTypeExpression} = 'document_asset' AND ${input.documentIdExpression} = ${targetDocument})`;
  const logicalDocument = `(${input.targetTypeExpression} = 'logical_document' AND ${input.documentIdExpression} IN (SELECT ${selectedRevisionAsset} FROM ${q("document_revisions")} owned_revision WHERE owned_revision.${q("knowledge_space_id")} = ${input.spaceExpression} AND owned_revision.${q("document_id")} = ${input.targetIdExpression} AND NOT EXISTS (SELECT 1 FROM ${q("document_revisions")} external_revision WHERE external_revision.${q("knowledge_space_id")} = ${input.spaceExpression} AND external_revision.${q("document_id")} <> ${input.targetIdExpression} AND external_revision.${q("document_asset_id")} = owned_revision.${q("document_asset_id")})))`;
  const source = `(${input.targetTypeExpression} = 'source' AND ${input.documentIdExpression} IN (SELECT ${selectedSourceAsset} FROM ${q("document_assets")} AS target_document WHERE target_document.${q("knowledge_space_id")} = ${input.spaceExpression} AND target_document.${q("source_id")} = ${input.targetIdExpression}))`;
  return `(${asset} OR ${logicalDocument} OR ${source})`;
}
