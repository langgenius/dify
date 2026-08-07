import type { DocumentOutline, DocumentOutlineNode } from "@knowledge/core";

import type { PageIndexDocumentValueHit } from "./page-index-document-selection";
import type { PageIndexNodeValuePrior } from "./page-index-whole-tree-selection";
import { normalizeRetrievalScoreSeries } from "./retrieval-fusion";

export interface PageIndexNodeValueAssignment {
  readonly candidateNodeId: string;
  readonly normalizedScore: number;
  readonly outlineNodeId: string;
  readonly projectionId: string;
}

export interface PageIndexNodeValuesResult {
  readonly assignments: readonly PageIndexNodeValueAssignment[];
  /** Openable nodes with direct hits, ordered for the Value lane. */
  readonly rankedOpenableNodeIds: readonly string[];
  readonly truncatedHitCount: number;
  readonly unassignedHitCount: number;
  readonly valuesByNodeId: ReadonlyMap<string, PageIndexNodeValuePrior>;
}

export interface BuildPageIndexNodeValuesInput {
  readonly hits: readonly PageIndexDocumentValueHit[];
  readonly maxHitsPerNode: number;
  readonly outline: DocumentOutline;
}

interface OutlineNodeRecord {
  readonly children: readonly OutlineNodeRecord[];
  readonly node: DocumentOutlineNode;
}

interface LocalNodeValue {
  readonly breadthValue: number;
  readonly hitCount: number;
  readonly peakValue: number;
}

/**
 * Maps dense chunk hits to the deepest matching outline nodes, computes a bounded local breadth
 * value, then propagates ancestor priors with max. Descendant count can therefore never inflate an
 * ancestor merely because a section contains more chunks.
 */
export function buildPageIndexNodeValues({
  hits,
  maxHitsPerNode,
  outline,
}: BuildPageIndexNodeValuesInput): PageIndexNodeValuesResult {
  validatePositiveInteger(maxHitsPerNode, "maxHitsPerNode");
  const roots = outline.nodes.map(buildRecord);
  const records = flattenRecords(roots);
  const mapped = new Map<string, PageIndexDocumentValueHit[]>();
  let unassignedHitCount = 0;

  for (const hit of hits) {
    validateHit(hit);
    if (hit.candidate.citation.documentAssetId !== outline.documentAssetId) {
      unassignedHitCount += 1;
      continue;
    }
    const matched = findBestNode(records, hit);
    if (!matched) {
      unassignedHitCount += 1;
      continue;
    }
    const nodeHits = mapped.get(matched.node.id) ?? [];
    nodeHits.push(hit);
    mapped.set(matched.node.id, nodeHits);
  }

  const retainedByNode = new Map<string, readonly PageIndexDocumentValueHit[]>();
  let truncatedHitCount = 0;
  for (const [nodeId, nodeHits] of mapped) {
    const deduped = dedupeHits(nodeHits);
    const retained = deduped.slice(0, maxHitsPerNode);
    retainedByNode.set(nodeId, retained);
    truncatedHitCount += deduped.length - retained.length;
  }

  const localRaw = [...retainedByNode.entries()].map(([nodeId, nodeHits]) => ({
    hitCount: nodeHits.length,
    nodeId,
    peakValue: Math.max(...nodeHits.map((hit) => hit.normalizedScore)),
    rawBreadth:
      nodeHits.reduce((total, hit) => total + hit.normalizedScore, 0) /
      Math.sqrt(nodeHits.length + 1),
  }));
  const normalizedBreadth = normalizeRetrievalScoreSeries(
    localRaw.map((entry) => entry.rawBreadth),
  );
  const localByNodeId = new Map<string, LocalNodeValue>(
    localRaw.map((entry, index) => [
      entry.nodeId,
      {
        breadthValue: normalizedBreadth[index] ?? 0,
        hitCount: entry.hitCount,
        peakValue: entry.peakValue,
      },
    ]),
  );
  const valuesByNodeId = new Map<string, PageIndexNodeValuePrior>();
  for (const root of roots) {
    propagateValues(root, localByNodeId, valuesByNodeId);
  }

  const assignments = [...retainedByNode.entries()]
    .flatMap(([outlineNodeId, nodeHits]) =>
      nodeHits.map(
        (hit): PageIndexNodeValueAssignment => ({
          candidateNodeId: hit.candidate.nodeId,
          normalizedScore: hit.normalizedScore,
          outlineNodeId,
          projectionId: hit.candidate.projectionId,
        }),
      ),
    )
    .sort(
      (left, right) =>
        left.candidateNodeId.localeCompare(right.candidateNodeId) ||
        left.projectionId.localeCompare(right.projectionId),
    );

  const recordsById = new Map(records.map((record) => [record.node.id, record]));
  const rankedOpenableNodeIds = [...localByNodeId.entries()]
    .filter(([nodeId]) => isOpenable(recordsById.get(nodeId)?.node))
    .sort(([leftId, left], [rightId, right]) => {
      const leftNode = recordsById.get(leftId)?.node;
      const rightNode = recordsById.get(rightId)?.node;
      return (
        right.peakValue - left.peakValue ||
        right.breadthValue - left.breadthValue ||
        (rightNode?.level ?? 0) - (leftNode?.level ?? 0) ||
        leftId.localeCompare(rightId)
      );
    })
    .map(([nodeId]) => nodeId);

  return {
    assignments,
    rankedOpenableNodeIds,
    truncatedHitCount,
    unassignedHitCount,
    valuesByNodeId,
  };
}

function buildRecord(node: DocumentOutlineNode): OutlineNodeRecord {
  return { children: node.children.map(buildRecord), node };
}

function flattenRecords(roots: readonly OutlineNodeRecord[]): readonly OutlineNodeRecord[] {
  const records: OutlineNodeRecord[] = [];
  const visit = (nodes: readonly OutlineNodeRecord[]) => {
    for (const record of nodes) {
      records.push(record);
      visit(record.children);
    }
  };
  visit(roots);
  return records;
}

function findBestNode(
  records: readonly OutlineNodeRecord[],
  hit: PageIndexDocumentValueHit,
): OutlineNodeRecord | undefined {
  return records
    .map((record) => ({ record, score: nodeMatchScore(record.node, hit) }))
    .filter((entry) => entry.score.matched)
    .sort((left, right) => compareNodeMatches(left, right))[0]?.record;
}

interface NodeMatchScore {
  readonly commonPath: number;
  readonly exactPath: boolean;
  readonly matched: boolean;
  readonly rangeMatch: boolean;
  readonly sourceMatch: boolean;
}

function nodeMatchScore(node: DocumentOutlineNode, hit: PageIndexDocumentValueHit): NodeMatchScore {
  const citation = hit.candidate.citation;
  const sourceMatch = node.sourceNodeIds.includes(hit.candidate.nodeId);
  const commonPath = commonPrefixLength(node.sectionPath, citation.sectionPath);
  const exactPath = samePath(node.sectionPath, citation.sectionPath);
  const rangeMatch = rangesOverlap(
    node.startOffset,
    node.endOffset,
    citation.startOffset,
    citation.endOffset,
  );
  return {
    commonPath,
    exactPath,
    matched: sourceMatch || exactPath || rangeMatch || commonPath > 0,
    rangeMatch,
    sourceMatch,
  };
}

function compareNodeMatches(
  left: { readonly record: OutlineNodeRecord; readonly score: NodeMatchScore },
  right: { readonly record: OutlineNodeRecord; readonly score: NodeMatchScore },
): number {
  return (
    Number(right.score.sourceMatch) - Number(left.score.sourceMatch) ||
    Number(right.score.exactPath) - Number(left.score.exactPath) ||
    Number(right.score.rangeMatch) - Number(left.score.rangeMatch) ||
    right.score.commonPath - left.score.commonPath ||
    right.record.node.level - left.record.node.level ||
    nodeRangeWidth(left.record.node) - nodeRangeWidth(right.record.node) ||
    left.record.node.id.localeCompare(right.record.node.id)
  );
}

function dedupeHits(
  hits: readonly PageIndexDocumentValueHit[],
): readonly PageIndexDocumentValueHit[] {
  const byCandidateNodeId = new Map<string, PageIndexDocumentValueHit>();
  for (const hit of hits) {
    const existing = byCandidateNodeId.get(hit.candidate.nodeId);
    if (
      !existing ||
      hit.normalizedScore > existing.normalizedScore ||
      (hit.normalizedScore === existing.normalizedScore &&
        hit.candidate.projectionId.localeCompare(existing.candidate.projectionId) < 0)
    ) {
      byCandidateNodeId.set(hit.candidate.nodeId, hit);
    }
  }
  return [...byCandidateNodeId.values()].sort(
    (left, right) =>
      right.normalizedScore - left.normalizedScore ||
      left.candidate.nodeId.localeCompare(right.candidate.nodeId) ||
      left.candidate.projectionId.localeCompare(right.candidate.projectionId),
  );
}

function propagateValues(
  record: OutlineNodeRecord,
  localByNodeId: ReadonlyMap<string, LocalNodeValue>,
  output: Map<string, PageIndexNodeValuePrior>,
): PageIndexNodeValuePrior {
  const local = localByNodeId.get(record.node.id);
  let breadthValue = local?.breadthValue ?? 0;
  let peakValue = local?.peakValue ?? 0;
  for (const child of record.children) {
    const childValue = propagateValues(child, localByNodeId, output);
    breadthValue = Math.max(breadthValue, childValue.breadthValue);
    peakValue = Math.max(peakValue, childValue.peakValue);
  }
  const value = { breadthValue, peakValue };
  output.set(record.node.id, value);
  return value;
}

function commonPrefixLength(left: readonly string[], right: readonly string[]): number {
  const maximum = Math.min(left.length, right.length);
  let length = 0;
  while (length < maximum && normalizeSegment(left[length]) === normalizeSegment(right[length])) {
    length += 1;
  }
  return length;
}

function samePath(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length > 0 &&
    left.length === right.length &&
    commonPrefixLength(left, right) === left.length
  );
}

function normalizeSegment(value: string | undefined): string {
  return value?.trim().toLocaleLowerCase() ?? "";
}

function rangesOverlap(
  leftStart: number | undefined,
  leftEnd: number | undefined,
  rightStart: number | undefined,
  rightEnd: number | undefined,
): boolean {
  return (
    leftStart !== undefined &&
    leftEnd !== undefined &&
    rightStart !== undefined &&
    rightEnd !== undefined &&
    leftStart < rightEnd &&
    leftEnd > rightStart
  );
}

function nodeRangeWidth(node: DocumentOutlineNode): number {
  return node.startOffset === undefined || node.endOffset === undefined
    ? Number.MAX_SAFE_INTEGER
    : node.endOffset - node.startOffset;
}

function isOpenable(node: DocumentOutlineNode | undefined): boolean {
  return (
    node !== undefined &&
    node.startOffset !== undefined &&
    node.endOffset !== undefined &&
    node.endOffset > node.startOffset
  );
}

function validateHit(hit: PageIndexDocumentValueHit): void {
  if (!Number.isFinite(hit.normalizedScore) || hit.normalizedScore < 0 || hit.normalizedScore > 1) {
    throw new Error("PageIndex node values normalized hit scores must be within [0, 1]");
  }
}

function validatePositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`PageIndex node values ${name} must be a positive integer`);
  }
}
