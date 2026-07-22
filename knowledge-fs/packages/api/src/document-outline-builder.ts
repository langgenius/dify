import { randomUUID } from "node:crypto";

import {
  type DocumentOutline,
  type DocumentOutlineNode,
  DocumentOutlineSchema,
  type DocumentOutlineTocSource,
  type ParseArtifact,
  ParseArtifactSchema,
  type ParseElement,
  PublicationGenerationIdSchema,
} from "@knowledge/core";

import { deterministicChildId } from "./api-shared-utils";
import {
  DOCUMENT_ELEMENT_SEPARATOR,
  DOCUMENT_ELEMENT_TEXT_NORMALIZATION,
  DOCUMENT_OFFSET_ENCODING,
  materializeDocumentElementByteSpan,
} from "./document-offsets";

export interface DocumentOutlineBuilderOptions {
  readonly generateId?: () => string;
  readonly largeSectionChars?: number | undefined;
  readonly maxElements: number;
  readonly maxNodes: number;
  readonly maxSummaryChars: number;
  readonly now?: () => string;
  readonly outlineVersion?: string | undefined;
}

export interface BuildDocumentOutlineInput {
  readonly knowledgeSpaceId: string;
  readonly parseArtifact: ParseArtifact;
  readonly publicationGenerationId?: string | undefined;
}

export interface DocumentOutlineBuilder {
  build(input: BuildDocumentOutlineInput): DocumentOutline;
}

interface ElementSpan {
  readonly element: ParseElement;
  readonly endOffset: number;
  readonly startOffset: number;
  readonly text: string;
}

interface OutlineNodeDraft {
  characterCount: number;
  childNodeIds: string[];
  children: OutlineNodeDraft[];
  endOffset?: number | undefined;
  endPage?: number | undefined;
  id: string;
  level: number;
  metadata: Record<string, unknown>;
  sectionPath: string[];
  sourceElementIds: string[];
  sourceNodeIds: string[];
  startOffset?: number | undefined;
  startPage?: number | undefined;
  summaryTexts: string[];
  title: string;
  titleLocation?: DocumentOutlineNode["titleLocation"] | undefined;
  tocSource: DocumentOutlineTocSource;
}

const sectionPathSeparator = "\u001f";

export function createDocumentOutlineBuilder({
  generateId = randomUUID,
  largeSectionChars = 12_000,
  maxElements,
  maxNodes,
  maxSummaryChars,
  now = () => new Date().toISOString(),
  outlineVersion = "document-outline-v1",
}: DocumentOutlineBuilderOptions): DocumentOutlineBuilder {
  validateDocumentOutlineBuilderOptions({
    largeSectionChars,
    maxElements,
    maxNodes,
    maxSummaryChars,
  });

  return {
    build: ({ knowledgeSpaceId, parseArtifact, publicationGenerationId }) => {
      if (!knowledgeSpaceId.trim()) {
        throw new Error("Document outline knowledgeSpaceId is required");
      }

      const artifact = ParseArtifactSchema.parse(parseArtifact);
      const generationId =
        publicationGenerationId === undefined
          ? undefined
          : PublicationGenerationIdSchema.parse(publicationGenerationId);
      if (artifact.elements.length > maxElements) {
        throw new Error(`Document outline element count exceeds maxElements=${maxElements}`);
      }

      let generationIdSequence = 0;
      const buildGenerateId = generationId
        ? () =>
            deterministicChildId(
              generationId,
              `document-outline:${artifact.documentAssetId}:${artifact.version}:${generationIdSequence++}`,
            )
        : generateId;
      const spans = materializeElementSpans(artifact.elements);
      const draftsByKey = new Map<string, OutlineNodeDraft>();
      const roots: OutlineNodeDraft[] = [];

      for (const span of spans) {
        const path = normalizeOutlineSectionPath(span);
        const draft = ensureOutlinePath({
          draftsByKey,
          generateId: buildGenerateId,
          roots,
          sectionPath: path,
          source: outlineTocSource(span),
          span,
        });
        applySpanToDraft(draft, span);
      }

      if (draftsByKey.size === 0) {
        const fallback = createOutlineDraft({
          generateId: buildGenerateId,
          level: 1,
          sectionPath: ["Document"],
          source: "fallback",
          span: spans[0],
          title: "Document",
        });

        for (const span of spans) {
          applySpanToDraft(fallback, span);
        }

        roots.push(fallback);
        draftsByKey.set(outlineSectionKey(fallback.sectionPath), fallback);
      }

      if (draftsByKey.size > maxNodes) {
        throw new Error(`Document outline node count exceeds maxNodes=${maxNodes}`);
      }

      const nodes = roots.map((draft) => finalizeOutlineNode(draft, maxSummaryChars));
      const quality = documentOutlineQuality({ largeSectionChars, nodes });

      return DocumentOutlineSchema.parse({
        artifactHash: artifact.artifactHash,
        createdAt: now(),
        documentAssetId: artifact.documentAssetId,
        id: buildGenerateId(),
        knowledgeSpaceId,
        metadata: {
          builder: "deterministic-parse-artifact",
          contentType: artifact.contentType,
          parser: artifact.parser,
          parserVersion: artifact.metadata.parserVersion,
          elementSeparator: DOCUMENT_ELEMENT_SEPARATOR,
          offsetEncoding: DOCUMENT_OFFSET_ENCODING,
          quality,
          sourceElementCount: artifact.elements.length,
          textNormalization: DOCUMENT_ELEMENT_TEXT_NORMALIZATION,
        },
        nodes,
        outlineVersion,
        parseArtifactId: artifact.id,
        ...(generationId ? { publicationGenerationId: generationId } : {}),
        version: artifact.version,
      });
    },
  };
}

function validateDocumentOutlineBuilderOptions({
  largeSectionChars,
  maxElements,
  maxNodes,
  maxSummaryChars,
}: {
  readonly largeSectionChars: number;
  readonly maxElements: number;
  readonly maxNodes: number;
  readonly maxSummaryChars: number;
}): void {
  if (!Number.isInteger(largeSectionChars) || largeSectionChars < 1) {
    throw new Error("Document outline largeSectionChars must be at least 1");
  }

  if (!Number.isInteger(maxElements) || maxElements < 1) {
    throw new Error("Document outline maxElements must be at least 1");
  }

  if (!Number.isInteger(maxNodes) || maxNodes < 1) {
    throw new Error("Document outline maxNodes must be at least 1");
  }

  if (!Number.isInteger(maxSummaryChars) || maxSummaryChars < 1) {
    throw new Error("Document outline maxSummaryChars must be at least 1");
  }
}

function materializeElementSpans(elements: readonly ParseElement[]): ElementSpan[] {
  const spans: ElementSpan[] = [];
  let cursor = 0;

  for (const element of elements) {
    const span = materializeDocumentElementByteSpan(element.text, cursor);

    if (!span) {
      continue;
    }

    spans.push({
      element,
      endOffset: span.endOffset,
      startOffset: span.startOffset,
      text: span.text,
    });
    cursor = span.nextOffset;
  }

  return spans;
}

function normalizeOutlineSectionPath(span: ElementSpan): string[] {
  const fromSectionPath = span.element.sectionPath.map((segment) => segment.trim()).filter(Boolean);

  if (fromSectionPath.length > 0) {
    return fromSectionPath;
  }

  if (span.element.type === "heading" || span.element.type === "title") {
    return [span.text];
  }

  return ["Document"];
}

function outlineTocSource(span: ElementSpan): DocumentOutlineTocSource {
  return span.element.type === "heading" || span.element.type === "title"
    ? "parser-heading"
    : "fallback";
}

function ensureOutlinePath({
  draftsByKey,
  generateId,
  roots,
  sectionPath,
  source,
  span,
}: {
  readonly draftsByKey: Map<string, OutlineNodeDraft>;
  readonly generateId: () => string;
  readonly roots: OutlineNodeDraft[];
  readonly sectionPath: readonly string[];
  readonly source: DocumentOutlineTocSource;
  readonly span: ElementSpan;
}): OutlineNodeDraft {
  let parent: OutlineNodeDraft | undefined;
  let current: OutlineNodeDraft | undefined;

  for (let index = 0; index < sectionPath.length; index += 1) {
    const prefix = sectionPath.slice(0, index + 1);
    const key = outlineSectionKey(prefix);
    current = draftsByKey.get(key);

    if (!current) {
      current = createOutlineDraft({
        generateId,
        level: index + 1,
        sectionPath: prefix,
        source: index === sectionPath.length - 1 ? source : "fallback",
        span,
        title: prefix.at(-1) ?? "Document",
      });
      draftsByKey.set(key, current);

      if (parent) {
        parent.childNodeIds.push(current.id);
        parent.children.push(current);
      } else {
        roots.push(current);
      }
    }

    parent = current;
  }

  return (
    current ??
    createOutlineDraft({
      generateId,
      level: 1,
      sectionPath: ["Document"],
      source: "fallback",
      span,
      title: "Document",
    })
  );
}

function createOutlineDraft({
  generateId,
  level,
  sectionPath,
  source,
  span,
  title,
}: {
  readonly generateId: () => string;
  readonly level: number;
  readonly sectionPath: readonly string[];
  readonly source: DocumentOutlineTocSource;
  readonly span: ElementSpan | undefined;
  readonly title: string;
}): OutlineNodeDraft {
  const titleLocation =
    span && (span.element.type === "heading" || span.element.type === "title")
      ? {
          confidence: 1,
          endOffset: span.endOffset,
          matchedText: span.text,
          ...(span.element.pageNumber ? { pageNumber: span.element.pageNumber } : {}),
          source,
          startOffset: span.startOffset,
        }
      : undefined;

  return {
    characterCount: 0,
    childNodeIds: [],
    children: [],
    id: generateId(),
    level,
    metadata: {},
    sectionPath: [...sectionPath],
    sourceElementIds: [],
    sourceNodeIds: [],
    summaryTexts: [],
    title,
    ...(titleLocation ? { titleLocation } : {}),
    tocSource: source,
  };
}

function applySpanToDraft(draft: OutlineNodeDraft, span: ElementSpan): void {
  draft.characterCount += Array.from(span.text).length;
  draft.startOffset =
    draft.startOffset === undefined
      ? span.startOffset
      : Math.min(draft.startOffset, span.startOffset);
  draft.endOffset =
    draft.endOffset === undefined ? span.endOffset : Math.max(draft.endOffset, span.endOffset);

  if (span.element.pageNumber !== undefined) {
    draft.startPage =
      draft.startPage === undefined
        ? span.element.pageNumber
        : Math.min(draft.startPage, span.element.pageNumber);
    draft.endPage =
      draft.endPage === undefined
        ? span.element.pageNumber
        : Math.max(draft.endPage, span.element.pageNumber);
  }

  if (!draft.sourceElementIds.includes(span.element.id)) {
    draft.sourceElementIds.push(span.element.id);
  }

  if (span.element.type !== "heading" && span.element.type !== "title") {
    draft.summaryTexts.push(span.text);
  }

  if (!draft.titleLocation && (span.element.type === "heading" || span.element.type === "title")) {
    draft.titleLocation = {
      confidence: 1,
      endOffset: span.endOffset,
      matchedText: span.text,
      ...(span.element.pageNumber ? { pageNumber: span.element.pageNumber } : {}),
      source: "parser-heading",
      startOffset: span.startOffset,
    };
  }
}

function finalizeOutlineNode(
  draft: OutlineNodeDraft,
  maxSummaryChars: number,
): DocumentOutlineNode {
  const children = draft.children.map((child) => finalizeOutlineNode(child, maxSummaryChars));
  const offsets = [
    ...(draft.startOffset === undefined ? [] : [draft.startOffset]),
    ...(draft.endOffset === undefined ? [] : [draft.endOffset]),
    ...children.flatMap((child) => [
      ...(child.startOffset === undefined ? [] : [child.startOffset]),
      ...(child.endOffset === undefined ? [] : [child.endOffset]),
    ]),
  ];
  const pages = [
    ...(draft.startPage === undefined ? [] : [draft.startPage]),
    ...(draft.endPage === undefined ? [] : [draft.endPage]),
    ...children.flatMap((child) => [
      ...(child.startPage === undefined ? [] : [child.startPage]),
      ...(child.endPage === undefined ? [] : [child.endPage]),
    ]),
  ];
  const startOffset = offsets.length > 0 ? Math.min(...offsets) : undefined;
  const endOffset = offsets.length > 0 ? Math.max(...offsets) : undefined;
  const startPage = pages.length > 0 ? Math.min(...pages) : undefined;
  const endPage = pages.length > 0 ? Math.max(...pages) : undefined;
  const canonicalCharacterCount =
    draft.characterCount +
    children.reduce((total, child) => total + outlineNodeCharacterCount(child), 0);

  return {
    childNodeIds: [...draft.childNodeIds],
    children,
    ...(endOffset === undefined ? {} : { endOffset }),
    ...(endPage === undefined ? {} : { endPage }),
    id: draft.id,
    level: draft.level,
    metadata: { ...draft.metadata, canonicalCharacterCount },
    sectionPath: [...draft.sectionPath],
    sourceElementIds: [...draft.sourceElementIds],
    sourceNodeIds: [...draft.sourceNodeIds],
    ...(startOffset === undefined ? {} : { startOffset }),
    ...(startPage === undefined ? {} : { startPage }),
    summary: summarizeOutlineTexts({
      children,
      maxSummaryChars,
      texts: draft.summaryTexts,
      title: draft.title,
    }),
    title: draft.title,
    ...(draft.titleLocation ? { titleLocation: { ...draft.titleLocation } } : {}),
    tocSource: draft.tocSource,
  };
}

function documentOutlineQuality({
  largeSectionChars,
  nodes,
}: {
  readonly largeSectionChars: number;
  readonly nodes: readonly DocumentOutlineNode[];
}): Record<string, unknown> {
  const allNodes = flattenOutlineNodes(nodes);
  const nodeCount = allNodes.length;
  const fallbackNodeCount = allNodes.filter((node) => node.tocSource === "fallback").length;
  const titleLocationCount = allNodes.filter((node) => node.titleLocation !== undefined).length;
  const largeSectionCandidates = allNodes
    .map((node) => {
      const estimatedChars = outlineNodeCharacterCount(node);

      if (estimatedChars <= largeSectionChars) {
        return null;
      }

      return {
        endOffset: node.endOffset,
        estimatedChars,
        nodeId: node.id,
        sectionPath: [...node.sectionPath],
        startOffset: node.startOffset,
        title: node.title,
      };
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
    .slice(0, 100);
  const warnings = [
    ...(fallbackNodeCount === nodeCount && nodeCount > 0 ? ["outline-derived-from-fallback"] : []),
    ...(largeSectionCandidates.length > 0 ? ["large-sections-need-recursive-subdivision"] : []),
    ...(titleLocationCount < nodeCount ? ["some-title-locations-missing"] : []),
  ];

  return {
    fallbackNodeCount,
    headingCoverageRatio:
      nodeCount === 0 ? 0 : roundRatio((nodeCount - fallbackNodeCount) / nodeCount),
    largeSectionCandidates,
    largeSectionChars,
    nodeCount,
    offsetRangeValid: allNodes.every(outlineNodeOffsetRangeValid),
    pageRangeValid: allNodes.every(outlineNodePageRangeValid),
    titleLocationCoverageRatio: nodeCount === 0 ? 0 : roundRatio(titleLocationCount / nodeCount),
    warnings,
  };
}

function outlineNodeCharacterCount(node: DocumentOutlineNode): number {
  const value = node.metadata.canonicalCharacterCount;

  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}

function flattenOutlineNodes(nodes: readonly DocumentOutlineNode[]): DocumentOutlineNode[] {
  return nodes.flatMap((node) => [node, ...flattenOutlineNodes(node.children)]);
}

function outlineNodeOffsetRangeValid(node: DocumentOutlineNode): boolean {
  return (
    node.startOffset === undefined ||
    node.endOffset === undefined ||
    node.endOffset >= node.startOffset
  );
}

function outlineNodePageRangeValid(node: DocumentOutlineNode): boolean {
  return (
    node.startPage === undefined || node.endPage === undefined || node.endPage >= node.startPage
  );
}

function roundRatio(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function summarizeOutlineTexts({
  children,
  maxSummaryChars,
  texts,
  title,
}: {
  readonly children: readonly DocumentOutlineNode[];
  readonly maxSummaryChars: number;
  readonly texts: readonly string[];
  readonly title: string;
}): string {
  const ownText = texts.join(" ").replaceAll(/\s+/gu, " ").trim();
  const childSummary = children
    .map((child) => child.summary)
    .filter((summary): summary is string => Boolean(summary?.trim()))
    .join(" ")
    .replaceAll(/\s+/gu, " ")
    .trim();
  const summary = ownText || childSummary || title;

  if (summary.length <= maxSummaryChars) {
    return summary;
  }

  if (maxSummaryChars <= 3) {
    return summary.slice(0, maxSummaryChars);
  }

  return `${summary.slice(0, maxSummaryChars - 3)}...`;
}

function outlineSectionKey(sectionPath: readonly string[]): string {
  return sectionPath.join(sectionPathSeparator);
}
