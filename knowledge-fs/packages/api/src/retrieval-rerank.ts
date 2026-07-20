import type { RerankerProvider } from "@knowledge/embeddings";

import { cloneJsonObject } from "./json-utils";
import { cloneRetrievalCitation } from "./retrieval-candidates";
import type { HybridRetrievalItem } from "./retrieval-fusion";

/**
 * A rerank-stage threshold is meaningful only when every provider obeys the
 * same documented score domain. Treat malformed/foreign results as a
 * capability failure instead of silently comparing incomparable scores.
 */
export class RerankScoreContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RerankScoreContractError";
  }
}

export async function rerankHybridRetrievalItems({
  items,
  limit,
  model,
  query,
  reranker,
  tenantId,
}: {
  readonly items: readonly HybridRetrievalItem[];
  readonly limit: number;
  readonly model: string;
  readonly query: string;
  readonly reranker: RerankerProvider;
  readonly tenantId?: string | undefined;
}): Promise<HybridRetrievalItem[]> {
  if (items.length === 0) {
    return [];
  }

  const originalById = new Map(items.map((item) => [item.nodeId, item]));
  const reranked = await reranker.rerank({
    documents: items.map((item) => ({
      id: item.nodeId,
      metadata: {
        projectionIds: [...item.projectionIds],
        sources: [...item.sources],
      },
      text: rerankTextForHybridItem(item),
    })),
    model,
    query,
    ...(tenantId ? { tenantId } : {}),
    topN: limit,
  });

  validateRerankResult({
    items,
    requestedModel: model,
    result: reranked,
  });

  return reranked.items
    .map((item): HybridRetrievalItem => {
      const original = originalById.get(item.document.id);

      if (!original) {
        // validateRerankResult guarantees this branch is unreachable. Keep the
        // explicit guard so future contract changes still fail closed.
        throw new RerankScoreContractError(
          `Reranker returned unknown document id ${item.document.id}`,
        );
      }

      return {
        citation: cloneRetrievalCitation(original.citation),
        metadata: {
          ...cloneJsonObject(original.metadata),
          rerankModel: reranked.model,
          rerankScore: item.score,
          retrievalScore: original.score,
        },
        nodeId: original.nodeId,
        ...(original.permissionScope === undefined
          ? {}
          : { permissionScope: [...original.permissionScope] }),
        projectionIds: [...original.projectionIds],
        score: item.score,
        sources: [...original.sources],
      };
    })
    .sort(
      (first, second) => second.score - first.score || first.nodeId.localeCompare(second.nodeId),
    )
    .slice(0, limit);
}

function validateRerankResult({
  items,
  requestedModel,
  result,
}: {
  readonly items: readonly HybridRetrievalItem[];
  readonly requestedModel: string;
  readonly result: Awaited<ReturnType<RerankerProvider["rerank"]>>;
}): void {
  const resultModel = result.model.trim();
  const metadataModel = result.metadata.model.trim();
  if (!resultModel || resultModel !== requestedModel || metadataModel !== resultModel) {
    throw new RerankScoreContractError(
      `Reranker model mismatch: requested=${requestedModel}, returned=${result.model}, metadata=${result.metadata.model}`,
    );
  }

  if (result.items.length > items.length) {
    throw new RerankScoreContractError(
      `Reranker returned ${result.items.length} items for ${items.length} candidates`,
    );
  }

  const inputById = new Map(items.map((item, index) => [item.nodeId, index] as const));
  const seen = new Set<string>();
  for (const item of result.items) {
    const expectedIndex = inputById.get(item.document.id);
    if (expectedIndex === undefined) {
      throw new RerankScoreContractError(
        `Reranker returned unknown document id ${item.document.id}`,
      );
    }
    if (seen.has(item.document.id)) {
      throw new RerankScoreContractError(
        `Reranker returned duplicate document id ${item.document.id}`,
      );
    }
    seen.add(item.document.id);

    if (!Number.isInteger(item.index) || item.index !== expectedIndex) {
      throw new RerankScoreContractError(
        `Reranker returned inconsistent index ${item.index} for document ${item.document.id}; expected ${expectedIndex}`,
      );
    }
    if (!Number.isFinite(item.score) || item.score < 0 || item.score > 1) {
      throw new RerankScoreContractError(
        `Reranker score for document ${item.document.id} must be finite and within [0, 1]`,
      );
    }
  }
}

export function rerankTextForHybridItem(item: HybridRetrievalItem): string {
  const ftsText = item.metadata.ftsText;
  if (typeof ftsText === "string" && ftsText.trim().length > 0) {
    return ftsText;
  }

  const text = item.metadata.text;
  if (typeof text === "string" && text.trim().length > 0) {
    return text;
  }

  const sectionText = item.citation.sectionPath.join(" ").trim();
  return sectionText || item.nodeId;
}

export function evidenceTextFromHybridItem(item: HybridRetrievalItem): string {
  const text = item.metadata.text;
  if (typeof text === "string" && text.trim().length > 0) {
    return text;
  }

  const ftsText = item.metadata.ftsText;
  if (typeof ftsText === "string" && ftsText.trim().length > 0) {
    return ftsText;
  }

  const sectionText = item.citation.sectionPath.join(" ").trim();
  return sectionText || item.nodeId;
}
