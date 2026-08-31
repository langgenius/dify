import {
  type AnswerTrace,
  type EvidenceBundle,
  EvidenceBundleSchema,
  type EvidenceItem,
  type MissingEvidence,
} from "@knowledge/core";

import {
  TRACE_EVIDENCE_AVAILABILITY_METADATA_KEY,
  TRACE_UNAVAILABLE_EVIDENCE_TEXT,
  type TraceEvidenceUnavailableReason,
} from "./answer-trace-evidence-availability";
import {
  candidatePermissionAllowsAsset,
  candidatePermissionAllowsNode,
} from "./candidate-content-authorization";
import type { DocumentAssetRepository } from "./document-asset-repository";
import type { KnowledgeNodeRepository } from "./knowledge-node-repository";
import { evidenceBundleFromAnswerTrace } from "./query-virtual-entries";

export interface AnswerTraceEvidenceProjection {
  readonly bundle: EvidenceBundle | null;
  readonly trace: AnswerTrace;
}

const MaxTraceEvidenceReferences = 1_000;

/**
 * Revalidates each historical evidence item independently against the current document and
 * permission closure. Unavailable items become content-free tombstones so one deleted document
 * cannot hide an otherwise useful trace or leak content after access is revoked.
 */
export async function projectAnswerTraceEvidence({
  assets,
  candidateGrants,
  nodes,
  trace,
}: {
  readonly assets: Pick<DocumentAssetRepository, "get" | "getManyByIds">;
  readonly candidateGrants: readonly string[];
  readonly nodes: Pick<KnowledgeNodeRepository, "getManyByIdsAcrossGenerations">;
  readonly trace: AnswerTrace;
}): Promise<AnswerTraceEvidenceProjection | null> {
  const bundle = evidenceBundleFromAnswerTrace(trace);
  if (!bundle) {
    return trace.evidenceBundleId ? null : { bundle: null, trace };
  }

  const nodeIds = [
    ...new Set([
      ...bundle.items.map((item) => item.nodeId),
      ...bundle.items.flatMap((item) =>
        item.conflicts.flatMap((conflict) => (conflict.withNodeId ? [conflict.withNodeId] : [])),
      ),
      ...bundle.missingEvidence.flatMap((item) =>
        item.expectedEvidenceId ? [item.expectedEvidenceId] : [],
      ),
    ]),
  ];
  const citedAssetIds = [
    ...new Set(
      bundle.items.flatMap((item) => item.citations.map((citation) => citation.documentAssetId)),
    ),
  ];
  if (
    nodeIds.length > MaxTraceEvidenceReferences ||
    citedAssetIds.length > MaxTraceEvidenceReferences
  ) {
    return answerTraceEvidenceProjection(
      trace,
      unavailableEvidenceBundle(bundle, "evidence-unavailable"),
    );
  }
  const foundNodes = await nodes.getManyByIdsAcrossGenerations({
    ids: nodeIds,
    knowledgeSpaceId: trace.knowledgeSpaceId,
  });
  const nodesById = new Map(foundNodes.map((node) => [node.id, node]));
  const assetIds = [
    ...new Set([...foundNodes.map((node) => node.documentAssetId), ...citedAssetIds]),
  ];
  if (assetIds.length > MaxTraceEvidenceReferences) {
    return answerTraceEvidenceProjection(
      trace,
      unavailableEvidenceBundle(bundle, "evidence-unavailable"),
    );
  }
  const foundAssets = assets.getManyByIds
    ? (await assets.getManyByIds({ ids: assetIds, knowledgeSpaceId: trace.knowledgeSpaceId })).map(
        (asset) => [asset.id, asset] as const,
      )
    : await Promise.all(
        assetIds.map(
          async (id) =>
            [id, await assets.get({ id, knowledgeSpaceId: trace.knowledgeSpaceId })] as const,
        ),
      );
  const assetsById = new Map(foundAssets);

  const assetReason = (assetId: string): TraceEvidenceUnavailableReason | null => {
    const asset = assetsById.get(assetId);
    if (!asset) return "document-deleted-or-unavailable";
    return candidatePermissionAllowsAsset(asset, candidateGrants) ? null : "permission-denied";
  };
  const nodeReason = (nodeId: string): TraceEvidenceUnavailableReason | null => {
    const node = nodesById.get(nodeId);
    if (!node) return "evidence-unavailable";
    if (!candidatePermissionAllowsNode(node, candidateGrants)) return "permission-denied";
    return assetReason(node.documentAssetId);
  };

  const projectedBundle: EvidenceBundle = {
    ...bundle,
    items: bundle.items.map((item) => {
      const reason = firstUnavailableReason([
        nodeReason(item.nodeId),
        ...item.citations.map((citation) => assetReason(citation.documentAssetId)),
      ]);
      if (reason) return unavailableEvidenceItem(item, reason);

      return {
        ...item,
        conflicts: item.conflicts.map((conflict) =>
          conflict.withNodeId && nodeReason(conflict.withNodeId) !== null
            ? { ...conflict, reason: TRACE_UNAVAILABLE_EVIDENCE_TEXT }
            : conflict,
        ),
      };
    }),
    missingEvidence: bundle.missingEvidence.map((item) => {
      if (!item.expectedEvidenceId) return item;
      const reason = nodeReason(item.expectedEvidenceId);
      return reason ? unavailableMissingEvidence(item, reason) : item;
    }),
  };

  return answerTraceEvidenceProjection(trace, projectedBundle);
}

function answerTraceEvidenceProjection(
  trace: AnswerTrace,
  bundle: EvidenceBundle,
): AnswerTraceEvidenceProjection {
  return {
    bundle,
    trace: {
      ...trace,
      steps: trace.steps.map((step) => {
        const embedded = EvidenceBundleSchema.safeParse(step.metadata.evidenceBundle);
        if (!embedded.success || embedded.data.id !== bundle.id) return step;
        return { ...step, metadata: { ...step.metadata, evidenceBundle: bundle } };
      }),
    },
  };
}

function unavailableEvidenceBundle(
  bundle: EvidenceBundle,
  reason: TraceEvidenceUnavailableReason,
): EvidenceBundle {
  return {
    ...bundle,
    items: bundle.items.map((item) => unavailableEvidenceItem(item, reason)),
    missingEvidence: bundle.missingEvidence.map((item) => unavailableMissingEvidence(item, reason)),
  };
}

function firstUnavailableReason(
  reasons: readonly (TraceEvidenceUnavailableReason | null)[],
): TraceEvidenceUnavailableReason | null {
  if (reasons.includes("permission-denied")) return "permission-denied";
  if (reasons.includes("document-deleted-or-unavailable")) {
    return "document-deleted-or-unavailable";
  }
  return (
    reasons.find((reason): reason is TraceEvidenceUnavailableReason => reason !== null) ?? null
  );
}

function unavailableEvidenceItem(
  item: EvidenceItem,
  reason: TraceEvidenceUnavailableReason,
): EvidenceItem {
  return {
    ...item,
    citations: item.citations.map((citation) => ({
      documentAssetId: citation.documentAssetId,
      documentVersion: citation.documentVersion,
      sectionPath: [],
    })),
    conflicts: [],
    freshness: { status: "unknown" },
    metadata: unavailableMetadata(reason),
    text: TRACE_UNAVAILABLE_EVIDENCE_TEXT,
  };
}

function unavailableMissingEvidence(
  item: MissingEvidence,
  reason: TraceEvidenceUnavailableReason,
): MissingEvidence {
  return {
    ...item,
    metadata: unavailableMetadata(reason),
    text: TRACE_UNAVAILABLE_EVIDENCE_TEXT,
  };
}

function unavailableMetadata(reason: TraceEvidenceUnavailableReason): Record<string, unknown> {
  return {
    [TRACE_EVIDENCE_AVAILABILITY_METADATA_KEY]: {
      reason,
      status: "unavailable",
    },
  };
}
