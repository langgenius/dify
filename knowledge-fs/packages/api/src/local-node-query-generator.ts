import type { KnowledgeNode } from "@knowledge/core";

import type { QueryGenerationEvent, QueryGenerator } from "./gateway-sse-responses";
import type { KnowledgeNodeRepository } from "./knowledge-node-repository";

export interface LocalNodeQueryGeneratorOptions {
  readonly maxAnswerChars: number;
  readonly maxNodes: number;
  readonly maxPageSize?: number | undefined;
  readonly nodes: KnowledgeNodeRepository;
}

interface ScoredNode {
  readonly node: KnowledgeNode;
  readonly score: number;
}

const MAX_SELECTED_NODES = 3;

export function createLocalNodeQueryGenerator({
  maxAnswerChars,
  maxNodes,
  maxPageSize = Math.min(maxNodes, 100),
  nodes,
}: LocalNodeQueryGeneratorOptions): QueryGenerator {
  validateLocalNodeQueryGeneratorBounds({ maxAnswerChars, maxNodes, maxPageSize });

  return {
    stream: async function* (input): AsyncGenerator<QueryGenerationEvent> {
      const { items, truncated } = await listCandidateNodes({
        knowledgeSpaceId: input.knowledgeSpaceId,
        maxNodes,
        maxPageSize,
        nodes,
      });
      const selected = selectLocalEvidence(items, input.query);

      if (selected.length === 0) {
        yield {
          delta: "I could not find local evidence for that query in the indexed nodes.",
          type: "delta",
        };
        yield {
          finishReason: "no-local-evidence",
          metadata: {
            generator: "local-node-query",
            nodeCount: 0,
          },
          type: "done",
        };
        return;
      }

      yield {
        delta: truncateAnswer(localEvidenceAnswer(selected), maxAnswerChars),
        type: "delta",
      };
      yield {
        finishReason: "local-evidence",
        metadata: {
          citations: selected.map(({ node }) => localNodeCitation(node)),
          generator: "local-node-query",
          nodeCount: selected.length,
          truncated,
        },
        type: "done",
      };
    },
  };
}

async function listCandidateNodes({
  knowledgeSpaceId,
  maxNodes,
  maxPageSize,
  nodes,
}: {
  readonly knowledgeSpaceId: string;
  readonly maxNodes: number;
  readonly maxPageSize: number;
  readonly nodes: KnowledgeNodeRepository;
}): Promise<{ readonly items: readonly KnowledgeNode[]; readonly truncated: boolean }> {
  const items: KnowledgeNode[] = [];
  let cursor: { readonly id: string } | undefined;

  while (items.length < maxNodes) {
    const page = await nodes.listBySpace({
      ...(cursor ? { cursor } : {}),
      knowledgeSpaceId,
      limit: Math.min(maxPageSize, maxNodes - items.length),
    });

    items.push(...page.items);

    if (!page.nextCursor || page.items.length === 0) {
      return { items, truncated: false };
    }

    cursor = page.nextCursor;
  }

  return { items, truncated: cursor !== undefined };
}

function selectLocalEvidence(
  nodes: readonly KnowledgeNode[],
  query: string,
): readonly ScoredNode[] {
  const terms = queryTerms(query);
  const scored = nodes
    .map((node) => ({
      node,
      score: scoreNode(node, terms),
    }))
    .filter((item) => item.score > 0)
    .sort(compareScoredNodes);

  return scored.slice(0, MAX_SELECTED_NODES);
}

function scoreNode(node: KnowledgeNode, terms: readonly string[]): number {
  if (terms.length === 0) {
    return 0;
  }

  const text = node.text.toLowerCase();

  return terms.reduce((score, term) => score + (text.includes(term) ? 1 : 0), 0);
}

function compareScoredNodes(left: ScoredNode, right: ScoredNode): number {
  return (
    right.score - left.score ||
    left.node.documentAssetId.localeCompare(right.node.documentAssetId) ||
    left.node.startOffset - right.node.startOffset ||
    left.node.id.localeCompare(right.node.id)
  );
}

function localEvidenceAnswer(selected: readonly ScoredNode[]): string {
  const lines = selected.map(({ node }, index) => {
    const section = node.sourceLocation.sectionPath.join(" / ") || "Document";

    return `${index + 1}. ${section}: ${node.text}`;
  });

  return `Local evidence answer:\n${lines.join("\n")}`;
}

function localNodeCitation(node: KnowledgeNode): Record<string, unknown> {
  return {
    documentAssetId: node.documentAssetId,
    label: `node:${node.id}`,
    nodeId: node.id,
    parseArtifactId: node.parseArtifactId,
    sectionPath: [...node.sourceLocation.sectionPath],
  };
}

function queryTerms(query: string): readonly string[] {
  return Array.from(
    new Set(
      query
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .map((term) => term.trim())
        .filter((term) => term.length >= 3),
    ),
  ).slice(0, 16);
}

function truncateAnswer(answer: string, maxAnswerChars: number): string {
  const chars = Array.from(answer);

  return chars.length > maxAnswerChars ? chars.slice(0, maxAnswerChars).join("") : answer;
}

function validateLocalNodeQueryGeneratorBounds({
  maxAnswerChars,
  maxNodes,
  maxPageSize,
}: {
  readonly maxAnswerChars: number;
  readonly maxNodes: number;
  readonly maxPageSize: number;
}): void {
  if (!Number.isInteger(maxNodes) || maxNodes < 1) {
    throw new Error("Local node query maxNodes must be at least 1");
  }

  if (!Number.isInteger(maxPageSize) || maxPageSize < 1) {
    throw new Error("Local node query maxPageSize must be at least 1");
  }

  if (!Number.isInteger(maxAnswerChars) || maxAnswerChars < 1) {
    throw new Error("Local node query maxAnswerChars must be at least 1");
  }
}
