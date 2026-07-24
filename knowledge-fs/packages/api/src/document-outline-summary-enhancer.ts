import {
  type DocumentOutline,
  type DocumentOutlineNode,
  DocumentOutlineSchema,
  type KnowledgeSpaceRetrievalProfile,
  type ParseArtifact,
  ParseArtifactSchema,
} from "@knowledge/core";

import { cloneJsonObject } from "./json-utils";

export interface DocumentOutlineSummaryProviderInput {
  readonly childSummaries: readonly string[];
  readonly documentAssetId: string;
  readonly knowledgeSpaceId: string;
  readonly maxSummaryChars: number;
  readonly outlineNodeId: string;
  readonly parseArtifactId: string;
  readonly promptVersion: string;
  readonly sectionPath: readonly string[];
  readonly signal?: AbortSignal | undefined;
  readonly text: string;
  readonly title: string;
  readonly traceId?: string | undefined;
}

export interface DocumentOutlineSummaryProviderResult {
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  readonly summary: string;
}

export interface DocumentOutlineSummaryProvider {
  summarize(
    input: DocumentOutlineSummaryProviderInput,
  ): Promise<DocumentOutlineSummaryProviderResult>;
}

export interface DocumentOutlineSummaryEnhancerOptions {
  /** Bounds provider calls across all branches of one outline tree. */
  readonly maxConcurrentSummaries?: number | undefined;
  readonly maxInputChars: number;
  readonly maxSummaryChars: number;
  readonly model: string;
  readonly promptVersion: string;
  readonly provider: DocumentOutlineSummaryProvider;
}

export interface EnhanceDocumentOutlineInput {
  readonly outline: DocumentOutline;
  readonly parseArtifact: ParseArtifact;
  /** Exact immutable retrieval profile frozen by a durable compilation attempt. */
  readonly retrievalProfile?: KnowledgeSpaceRetrievalProfile | undefined;
  readonly signal?: AbortSignal | undefined;
  /** Required by profile-aware enhancers; fixed legacy enhancers may omit it. */
  readonly tenantId?: string | undefined;
  readonly traceId?: string | undefined;
}

export interface DocumentOutlineSummaryEnhancer {
  enhance(input: EnhanceDocumentOutlineInput): Promise<DocumentOutline>;
}

export function createDocumentOutlineSummaryEnhancer({
  maxConcurrentSummaries = 4,
  maxInputChars,
  maxSummaryChars,
  model,
  promptVersion,
  provider,
}: DocumentOutlineSummaryEnhancerOptions): DocumentOutlineSummaryEnhancer {
  validateDocumentOutlineSummaryEnhancerOptions({
    maxConcurrentSummaries,
    maxInputChars,
    maxSummaryChars,
    model,
    promptVersion,
  });
  const summarize = createSummaryConcurrencyLimiter(maxConcurrentSummaries, (input) =>
    provider.summarize(input),
  );

  return {
    enhance: async ({ outline, parseArtifact, signal, traceId }) => {
      signal?.throwIfAborted();
      const parsedOutline = DocumentOutlineSchema.parse(outline);
      const artifact = ParseArtifactSchema.parse(parseArtifact);
      const nodes = await Promise.all(
        parsedOutline.nodes.map((node) =>
          enhanceDocumentOutlineNode({
            artifact,
            maxInputChars,
            maxSummaryChars,
            model,
            node,
            outline: parsedOutline,
            promptVersion,
            signal,
            summarize,
            traceId,
          }),
        ),
      );

      return DocumentOutlineSchema.parse({
        ...parsedOutline,
        metadata: {
          ...cloneJsonObject(parsedOutline.metadata),
          summary: {
            model,
            promptVersion,
            source: "provider",
          },
        },
        nodes,
      });
    },
  };
}

function validateDocumentOutlineSummaryEnhancerOptions({
  maxConcurrentSummaries,
  maxInputChars,
  maxSummaryChars,
  model,
  promptVersion,
}: {
  readonly maxConcurrentSummaries: number;
  readonly maxInputChars: number;
  readonly maxSummaryChars: number;
  readonly model: string;
  readonly promptVersion: string;
}): void {
  if (!Number.isInteger(maxConcurrentSummaries) || maxConcurrentSummaries < 1) {
    throw new Error("Document outline summary maxConcurrentSummaries must be at least 1");
  }

  if (!Number.isInteger(maxInputChars) || maxInputChars < 1) {
    throw new Error("Document outline summary maxInputChars must be at least 1");
  }

  if (!Number.isInteger(maxSummaryChars) || maxSummaryChars < 1) {
    throw new Error("Document outline summary maxSummaryChars must be at least 1");
  }

  if (!model.trim()) {
    throw new Error("Document outline summary model is required");
  }

  if (!promptVersion.trim()) {
    throw new Error("Document outline summary promptVersion is required");
  }
}

async function enhanceDocumentOutlineNode({
  artifact,
  maxInputChars,
  maxSummaryChars,
  model,
  node,
  outline,
  promptVersion,
  signal,
  summarize,
  traceId,
}: {
  readonly artifact: ParseArtifact;
  readonly maxInputChars: number;
  readonly maxSummaryChars: number;
  readonly model: string;
  readonly node: DocumentOutlineNode;
  readonly outline: DocumentOutline;
  readonly promptVersion: string;
  readonly signal?: AbortSignal | undefined;
  readonly summarize: DocumentOutlineSummaryProvider["summarize"];
  readonly traceId?: string | undefined;
}): Promise<DocumentOutlineNode> {
  const children = await Promise.all(
    node.children.map((child) =>
      enhanceDocumentOutlineNode({
        artifact,
        maxInputChars,
        maxSummaryChars,
        model,
        node: child,
        outline,
        promptVersion,
        signal,
        summarize,
        traceId,
      }),
    ),
  );
  signal?.throwIfAborted();
  const providerResult = await summarize({
    childSummaries: children
      .map((child) => child.summary)
      .filter((summary): summary is string => Boolean(summary?.trim())),
    documentAssetId: outline.documentAssetId,
    knowledgeSpaceId: outline.knowledgeSpaceId,
    maxSummaryChars,
    outlineNodeId: node.id,
    parseArtifactId: outline.parseArtifactId,
    promptVersion,
    sectionPath: [...node.sectionPath],
    ...(signal ? { signal } : {}),
    text: truncateText(sectionText(artifact, node), maxInputChars),
    title: node.title,
    ...(traceId ? { traceId } : {}),
  });
  const summary = providerResult.summary.trim();

  if (!summary) {
    throw new Error("Document outline summary provider returned an empty summary");
  }

  return DocumentOutlineSchema.shape.nodes.element.parse({
    ...node,
    children,
    metadata: {
      ...cloneJsonObject(node.metadata),
      summary: {
        ...(providerResult.metadata ? { metadata: cloneJsonObject(providerResult.metadata) } : {}),
        model,
        promptVersion,
        source: "provider",
      },
    },
    summary: truncateText(summary, maxSummaryChars),
  });
}

function createSummaryConcurrencyLimiter(
  maxConcurrent: number,
  summarize: DocumentOutlineSummaryProvider["summarize"],
): DocumentOutlineSummaryProvider["summarize"] {
  let active = 0;
  const waiting: Array<() => void> = [];

  return async (input) => {
    if (active >= maxConcurrent) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    active += 1;
    try {
      return await summarize(input);
    } finally {
      active -= 1;
      waiting.shift()?.();
    }
  };
}

function sectionText(artifact: ParseArtifact, node: DocumentOutlineNode): string {
  return artifact.elements
    .filter((element) => elementSectionStartsWith(element.sectionPath, node.sectionPath))
    .map((element) => element.text?.trim() ?? "")
    .filter(Boolean)
    .join("\n\n");
}

function elementSectionStartsWith(
  elementSectionPath: readonly string[],
  selectedSectionPath: readonly string[],
): boolean {
  if (
    selectedSectionPath.length === 1 &&
    selectedSectionPath[0] === "Document" &&
    elementSectionPath.length === 0
  ) {
    return true;
  }

  return selectedSectionPath.every((segment, index) => elementSectionPath[index] === segment);
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }

  if (maxChars <= 3) {
    return text.slice(0, maxChars);
  }

  return `${text.slice(0, maxChars - 3)}...`;
}
