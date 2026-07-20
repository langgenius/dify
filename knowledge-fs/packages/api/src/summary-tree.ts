import { createHash } from "node:crypto";

import { type KnowledgeNode, KnowledgeNodeSchema } from "@knowledge/core";

import { cloneJsonObject } from "./json-utils";
import {
  type KnowledgeNodeRepository,
  cloneKnowledgeNode,
  compareKnowledgeNodesByArtifactOffset,
} from "./knowledge-node-repository";

export type SummaryTreeLevel = "document" | "section";

export interface SummaryTreeProviderInput {
  readonly childNodes: readonly KnowledgeNode[];
  readonly level: SummaryTreeLevel;
  readonly maxSummaryChars: number;
  readonly model: string;
  readonly prompt: string;
  readonly promptVersion: string;
  readonly sectionPath: readonly string[];
}

export interface SummaryTreeProviderResult {
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  readonly text: string;
}

export interface SummaryTreeProvider {
  generate(input: SummaryTreeProviderInput): Promise<SummaryTreeProviderResult>;
}

export interface SummaryTreeBuilderOptions {
  readonly maxInputChars: number;
  readonly maxLeafNodes: number;
  readonly maxSections: number;
  readonly maxSummaryChars: number;
  readonly maxSummaryNodes: number;
  readonly model: string;
  readonly nodes: KnowledgeNodeRepository;
  readonly now?: () => string;
  readonly promptVersion?: string | undefined;
  readonly provider: SummaryTreeProvider;
}

export interface BuildSummaryTreeInput {
  readonly artifactHash: string;
  readonly documentAssetId: string;
  readonly knowledgeSpaceId: string;
  readonly leafNodeIds: readonly string[];
  readonly parseArtifactId: string;
  readonly traceId?: string | undefined;
}

export interface BuildSummaryTreeResult {
  readonly leafCount: number;
  readonly sectionCount: number;
  readonly summaryNodes: KnowledgeNode[];
}

export interface SummaryTreeBuilder {
  build(input: BuildSummaryTreeInput): Promise<BuildSummaryTreeResult>;
}

export interface SummaryTreeMaintenanceOptions extends SummaryTreeBuilderOptions {
  readonly maxChangedLeafNodes: number;
}

export interface RebuildChangedSummaryBranchesInput {
  readonly allLeafNodeIds: readonly string[];
  readonly artifactHash: string;
  readonly changedLeafNodeIds: readonly string[];
  readonly documentAssetId: string;
  readonly knowledgeSpaceId: string;
  readonly parseArtifactId: string;
  readonly leafNodeIds?: never;
  readonly traceId?: string | undefined;
}

export interface RebuildChangedSummaryBranchesResult {
  readonly rebuiltSectionCount: number;
  readonly reusedSectionCount: number;
  readonly reusedSectionNodeIds: readonly string[];
  readonly summaryNodes: KnowledgeNode[];
}

export interface SummaryTreeMaintenanceFlow {
  rebuildChangedBranches(
    input: RebuildChangedSummaryBranchesInput,
  ): Promise<RebuildChangedSummaryBranchesResult>;
}

export function createSummaryTreeBuilder({
  maxInputChars,
  maxLeafNodes,
  maxSections,
  maxSummaryChars,
  maxSummaryNodes,
  model,
  nodes,
  now = () => new Date().toISOString(),
  promptVersion = "summary-tree-v1",
  provider,
}: SummaryTreeBuilderOptions): SummaryTreeBuilder {
  validateSummaryTreeOptions({
    maxInputChars,
    maxLeafNodes,
    maxSections,
    maxSummaryChars,
    maxSummaryNodes,
    model,
    promptVersion,
  });

  return {
    build: async (input) => {
      validateSummaryTreeInput(input, maxLeafNodes);
      const leafNodeIds = uniqueStrings(input.leafNodeIds);
      const loadedLeaves = await nodes.getMany({
        ids: leafNodeIds,
        knowledgeSpaceId: input.knowledgeSpaceId,
      });
      const leavesById = new Map(loadedLeaves.map((node) => [node.id, node]));
      const missingLeafNodeIds = leafNodeIds.filter((id) => !leavesById.has(id));

      if (missingLeafNodeIds.length > 0) {
        throw new Error(`Summary tree missing leaf nodes: ${missingLeafNodeIds.join(",")}`);
      }

      const leafNodes = leafNodeIds
        .map((id) => leavesById.get(id))
        .filter((node): node is KnowledgeNode => Boolean(node))
        .map(cloneKnowledgeNode);

      validateSummaryTreeLeaves(input, leafNodes, maxInputChars);
      const sectionGroups = groupSummaryLeavesBySection(leafNodes);

      if (sectionGroups.length > maxSections) {
        throw new Error(`Summary tree section count exceeds maxSections=${maxSections}`);
      }

      if (sectionGroups.length + 1 > maxSummaryNodes) {
        throw new Error(`Summary tree output exceeds maxSummaryNodes=${maxSummaryNodes}`);
      }

      const sectionSummaryNodes: KnowledgeNode[] = [];

      for (const group of sectionGroups) {
        const summary = await generateSummaryTreeNode({
          artifactHash: input.artifactHash,
          childNodes: group.nodes,
          documentAssetId: input.documentAssetId,
          knowledgeSpaceId: input.knowledgeSpaceId,
          level: "section",
          maxSummaryChars,
          model,
          now,
          parseArtifactId: input.parseArtifactId,
          promptVersion,
          provider,
          sectionPath: group.sectionPath,
          traceId: input.traceId,
        });
        sectionSummaryNodes.push(summary);
      }

      const documentSummaryNode = await generateSummaryTreeNode({
        artifactHash: input.artifactHash,
        childNodes: sectionSummaryNodes,
        documentAssetId: input.documentAssetId,
        knowledgeSpaceId: input.knowledgeSpaceId,
        level: "document",
        maxSummaryChars,
        model,
        now,
        parseArtifactId: input.parseArtifactId,
        promptVersion,
        provider,
        sectionPath: [],
        traceId: input.traceId,
      });
      const created = await nodes.upsertMany([...sectionSummaryNodes, documentSummaryNode]);

      return {
        leafCount: leafNodes.length,
        sectionCount: sectionGroups.length,
        summaryNodes: created.map(cloneKnowledgeNode),
      };
    },
  };
}

export function createSummaryTreeMaintenanceFlow({
  maxChangedLeafNodes,
  maxInputChars,
  maxLeafNodes,
  maxSections,
  maxSummaryChars,
  maxSummaryNodes,
  model,
  nodes,
  now = () => new Date().toISOString(),
  promptVersion = "summary-tree-v1",
  provider,
}: SummaryTreeMaintenanceOptions): SummaryTreeMaintenanceFlow {
  validateSummaryTreeOptions({
    maxInputChars,
    maxLeafNodes,
    maxSections,
    maxSummaryChars,
    maxSummaryNodes,
    model,
    promptVersion,
  });

  if (!Number.isInteger(maxChangedLeafNodes) || maxChangedLeafNodes < 1) {
    throw new Error("Summary tree maxChangedLeafNodes must be at least 1");
  }

  return {
    rebuildChangedBranches: async (input) => {
      validateSummaryTreeInput(
        {
          artifactHash: input.artifactHash,
          documentAssetId: input.documentAssetId,
          knowledgeSpaceId: input.knowledgeSpaceId,
          leafNodeIds: input.allLeafNodeIds,
          parseArtifactId: input.parseArtifactId,
          traceId: input.traceId,
        },
        maxLeafNodes,
      );
      validateChangedSummaryLeafNodeIds(input.changedLeafNodeIds, maxChangedLeafNodes);
      const changedLeafNodeIds = uniqueStrings(input.changedLeafNodeIds);
      const allLeafNodeIds = uniqueStrings(input.allLeafNodeIds);
      const allLeafNodeIdSet = new Set(allLeafNodeIds);

      for (const nodeId of changedLeafNodeIds) {
        if (!allLeafNodeIdSet.has(nodeId)) {
          throw new Error("Summary tree changedLeafNodeIds must be included in allLeafNodeIds");
        }
      }

      const loadedLeaves = await nodes.getMany({
        ids: allLeafNodeIds,
        knowledgeSpaceId: input.knowledgeSpaceId,
      });
      const leavesById = new Map(loadedLeaves.map((node) => [node.id, node]));
      const missingLeafNodeIds = allLeafNodeIds.filter((id) => !leavesById.has(id));

      if (missingLeafNodeIds.length > 0) {
        throw new Error(`Summary tree missing leaf nodes: ${missingLeafNodeIds.join(",")}`);
      }

      const leafNodes = allLeafNodeIds
        .map((id) => leavesById.get(id))
        .filter((node): node is KnowledgeNode => Boolean(node))
        .map(cloneKnowledgeNode);

      validateSummaryTreeLeaves(input, leafNodes, maxInputChars);
      const sectionGroups = groupSummaryLeavesBySection(leafNodes);

      if (sectionGroups.length > maxSections) {
        throw new Error(`Summary tree section count exceeds maxSections=${maxSections}`);
      }

      if (sectionGroups.length + 1 > maxSummaryNodes) {
        throw new Error(`Summary tree output exceeds maxSummaryNodes=${maxSummaryNodes}`);
      }

      const changedLeafSet = new Set(changedLeafNodeIds);
      const affectedSectionKeys = new Set(
        leafNodes
          .filter((node) => changedLeafSet.has(node.id))
          .map((node) => summarySectionKey(node.sourceLocation.sectionPath)),
      );
      const reusableSectionGroups = sectionGroups.filter(
        (group) => !affectedSectionKeys.has(summarySectionKey(group.sectionPath)),
      );
      const reusableSectionIds = reusableSectionGroups.map((group) =>
        summaryTreeNodeId({
          childNodes: group.nodes,
          level: "section",
          parseArtifactId: input.parseArtifactId,
          sectionPath: group.sectionPath,
        }),
      );
      const reusableSectionNodes =
        reusableSectionIds.length === 0
          ? []
          : await nodes.getMany({
              ids: reusableSectionIds,
              knowledgeSpaceId: input.knowledgeSpaceId,
            });
      const reusableById = new Map(reusableSectionNodes.map((node) => [node.id, node]));
      const rebuiltSectionNodes: KnowledgeNode[] = [];
      const orderedSectionNodes: KnowledgeNode[] = [];

      for (const group of sectionGroups) {
        const sectionKey = summarySectionKey(group.sectionPath);
        const sectionId = summaryTreeNodeId({
          childNodes: group.nodes,
          level: "section",
          parseArtifactId: input.parseArtifactId,
          sectionPath: group.sectionPath,
        });
        const reusable = reusableById.get(sectionId);

        if (!affectedSectionKeys.has(sectionKey) && reusable) {
          orderedSectionNodes.push(cloneKnowledgeNode(reusable));
          continue;
        }

        const rebuilt = await generateSummaryTreeNode({
          artifactHash: input.artifactHash,
          childNodes: group.nodes,
          documentAssetId: input.documentAssetId,
          knowledgeSpaceId: input.knowledgeSpaceId,
          level: "section",
          maxSummaryChars,
          model,
          now,
          parseArtifactId: input.parseArtifactId,
          promptVersion,
          provider,
          sectionPath: group.sectionPath,
          traceId: input.traceId,
        });
        rebuiltSectionNodes.push(rebuilt);
        orderedSectionNodes.push(rebuilt);
      }

      const documentSummaryNode = await generateSummaryTreeNode({
        artifactHash: input.artifactHash,
        childNodes: orderedSectionNodes,
        documentAssetId: input.documentAssetId,
        knowledgeSpaceId: input.knowledgeSpaceId,
        level: "document",
        maxSummaryChars,
        model,
        now,
        parseArtifactId: input.parseArtifactId,
        promptVersion,
        provider,
        sectionPath: [],
        traceId: input.traceId,
      });
      const updated = await nodes.upsertMany([...rebuiltSectionNodes, documentSummaryNode]);
      const reusedSectionNodeIds = reusableSectionNodes
        .filter((node) => orderedSectionNodes.some((ordered) => ordered.id === node.id))
        .map((node) => node.id);

      return {
        rebuiltSectionCount: rebuiltSectionNodes.length,
        reusedSectionCount: reusedSectionNodeIds.length,
        reusedSectionNodeIds,
        summaryNodes: updated.map(cloneKnowledgeNode),
      };
    },
  };
}

function validateSummaryTreeOptions({
  maxInputChars,
  maxLeafNodes,
  maxSections,
  maxSummaryChars,
  maxSummaryNodes,
  model,
  promptVersion,
}: {
  readonly maxInputChars: number;
  readonly maxLeafNodes: number;
  readonly maxSections: number;
  readonly maxSummaryChars: number;
  readonly maxSummaryNodes: number;
  readonly model: string;
  readonly promptVersion: string;
}): void {
  if (!Number.isInteger(maxLeafNodes) || maxLeafNodes < 1) {
    throw new Error("Summary tree maxLeafNodes must be at least 1");
  }

  if (!Number.isInteger(maxSections) || maxSections < 1) {
    throw new Error("Summary tree maxSections must be at least 1");
  }

  if (!Number.isInteger(maxSummaryNodes) || maxSummaryNodes < 2) {
    throw new Error("Summary tree maxSummaryNodes must be at least 2");
  }

  if (!Number.isInteger(maxInputChars) || maxInputChars < 1) {
    throw new Error("Summary tree maxInputChars must be at least 1");
  }

  if (!Number.isInteger(maxSummaryChars) || maxSummaryChars < 1) {
    throw new Error("Summary tree maxSummaryChars must be at least 1");
  }

  if (!model.trim()) {
    throw new Error("Summary tree model is required");
  }

  if (!promptVersion.trim()) {
    throw new Error("Summary tree promptVersion is required");
  }
}

function validateSummaryTreeInput(input: BuildSummaryTreeInput, maxLeafNodes: number): void {
  if (!input.knowledgeSpaceId.trim()) {
    throw new Error("Summary tree knowledgeSpaceId is required");
  }

  if (!input.documentAssetId.trim()) {
    throw new Error("Summary tree documentAssetId is required");
  }

  if (!input.parseArtifactId.trim()) {
    throw new Error("Summary tree parseArtifactId is required");
  }

  if (!input.artifactHash.trim()) {
    throw new Error("Summary tree artifactHash is required");
  }

  if (input.leafNodeIds.length < 1) {
    throw new Error("Summary tree leafNodeIds must contain at least 1 node id");
  }

  if (input.leafNodeIds.length > maxLeafNodes) {
    throw new Error(`Summary tree leafNodeIds exceeds maxLeafNodes=${maxLeafNodes}`);
  }

  for (const nodeId of input.leafNodeIds) {
    if (!nodeId.trim()) {
      throw new Error("Summary tree leafNodeIds must be non-empty strings");
    }
  }
}

function validateChangedSummaryLeafNodeIds(
  changedLeafNodeIds: readonly string[],
  maxChangedLeafNodes: number,
): void {
  if (changedLeafNodeIds.length < 1) {
    throw new Error("Summary tree changedLeafNodeIds must contain at least 1 node id");
  }

  if (changedLeafNodeIds.length > maxChangedLeafNodes) {
    throw new Error(
      `Summary tree changedLeafNodeIds exceeds maxChangedLeafNodes=${maxChangedLeafNodes}`,
    );
  }

  for (const nodeId of changedLeafNodeIds) {
    if (!nodeId.trim()) {
      throw new Error("Summary tree changedLeafNodeIds must be non-empty strings");
    }
  }
}

function validateSummaryTreeLeaves(
  input: {
    readonly artifactHash: string;
    readonly documentAssetId: string;
    readonly knowledgeSpaceId: string;
    readonly parseArtifactId: string;
  },
  leafNodes: readonly KnowledgeNode[],
  maxInputChars: number,
): void {
  let totalChars = 0;

  for (const node of leafNodes) {
    if (
      node.knowledgeSpaceId !== input.knowledgeSpaceId ||
      node.documentAssetId !== input.documentAssetId ||
      node.parseArtifactId !== input.parseArtifactId ||
      node.artifactHash !== input.artifactHash
    ) {
      throw new Error("Summary tree leaf nodes must belong to one document artifact");
    }

    if (node.kind === "summary") {
      throw new Error("Summary tree leaf nodes must not already be summary nodes");
    }

    totalChars += node.text.length;
  }

  if (totalChars > maxInputChars) {
    throw new Error(`Summary tree input exceeds maxInputChars=${maxInputChars}`);
  }
}

interface SummarySectionGroup {
  readonly nodes: readonly KnowledgeNode[];
  readonly sectionPath: readonly string[];
}

function groupSummaryLeavesBySection(leafNodes: readonly KnowledgeNode[]): SummarySectionGroup[] {
  const groups = new Map<string, { nodes: KnowledgeNode[]; sectionPath: string[] }>();
  const sortedLeaves = [...leafNodes].sort(compareKnowledgeNodesByArtifactOffset);

  for (const node of sortedLeaves) {
    const sectionPath = node.sourceLocation.sectionPath;
    const key = summarySectionKey(sectionPath);
    const group = groups.get(key);

    if (group) {
      group.nodes.push(cloneKnowledgeNode(node));
    } else {
      groups.set(key, {
        nodes: [cloneKnowledgeNode(node)],
        sectionPath: [...sectionPath],
      });
    }
  }

  return [...groups.values()].map((group) => ({
    nodes: group.nodes.map(cloneKnowledgeNode),
    sectionPath: [...group.sectionPath],
  }));
}

async function generateSummaryTreeNode({
  artifactHash,
  childNodes,
  documentAssetId,
  knowledgeSpaceId,
  level,
  maxSummaryChars,
  model,
  now,
  parseArtifactId,
  promptVersion,
  provider,
  sectionPath,
  traceId,
}: {
  readonly artifactHash: string;
  readonly childNodes: readonly KnowledgeNode[];
  readonly documentAssetId: string;
  readonly knowledgeSpaceId: string;
  readonly level: SummaryTreeLevel;
  readonly maxSummaryChars: number;
  readonly model: string;
  readonly now: () => string;
  readonly parseArtifactId: string;
  readonly promptVersion: string;
  readonly provider: SummaryTreeProvider;
  readonly sectionPath: readonly string[];
  readonly traceId?: string | undefined;
}): Promise<KnowledgeNode> {
  const orderedChildren = [...childNodes].sort(compareKnowledgeNodesByArtifactOffset);
  const result = await provider.generate({
    childNodes: orderedChildren.map(cloneKnowledgeNode),
    level,
    maxSummaryChars,
    model,
    prompt: summaryTreePrompt({ childNodes: orderedChildren, level, sectionPath }),
    promptVersion,
    sectionPath: [...sectionPath],
  });
  const text = result.text.trim();

  if (!text) {
    throw new Error("Summary tree provider returned empty text");
  }

  if (text.length > maxSummaryChars) {
    throw new Error(`Summary tree provider output exceeds maxSummaryChars=${maxSummaryChars}`);
  }

  const startOffset = Math.min(...orderedChildren.map((node) => node.startOffset));
  const endOffset = Math.max(...orderedChildren.map((node) => node.endOffset));

  return KnowledgeNodeSchema.parse({
    artifactHash,
    documentAssetId,
    endOffset,
    id: summaryTreeNodeId({
      childNodes: orderedChildren,
      level,
      parseArtifactId,
      sectionPath,
    }),
    kind: "summary",
    knowledgeSpaceId,
    metadata: {
      ...cloneJsonObject(result.metadata ?? {}),
      childNodeIds: orderedChildren.map((node) => node.id),
      childNodeKinds: orderedChildren.map((node) => node.kind),
      generatedAt: now(),
      model,
      promptVersion,
      summaryLevel: level,
      ...(traceId ? { traceId } : {}),
    },
    parseArtifactId,
    permissionScope: mergePermissionScopes(orderedChildren),
    sourceLocation: {
      endOffset,
      sectionPath: [...sectionPath],
      startOffset,
    },
    startOffset,
    text,
  });
}

function summaryTreeNodeId({
  childNodes,
  level,
  parseArtifactId,
  sectionPath,
}: {
  readonly childNodes: readonly KnowledgeNode[];
  readonly level: SummaryTreeLevel;
  readonly parseArtifactId: string;
  readonly sectionPath: readonly string[];
}): string {
  const orderedChildIds = [...childNodes]
    .sort(compareKnowledgeNodesByArtifactOffset)
    .map((node) => node.id)
    .join(",");

  return deterministicChildId(
    parseArtifactId,
    `summary:${level}:${summarySectionKey(sectionPath)}:${orderedChildIds}`,
  );
}

function summaryTreePrompt({
  childNodes,
  level,
  sectionPath,
}: {
  readonly childNodes: readonly KnowledgeNode[];
  readonly level: SummaryTreeLevel;
  readonly sectionPath: readonly string[];
}): string {
  const title = sectionPath.length > 0 ? sectionPath.join(" > ") : "Document";

  return [
    `Write a concise ${level} summary for ${title}.`,
    "Preserve specific facts, constraints, and decisions.",
    ...childNodes.map((node, index) => `${index + 1}. ${node.text}`),
  ].join("\n");
}

function summarySectionKey(sectionPath: readonly string[]): string {
  return sectionPath.length === 0 ? "__document__" : sectionPath.join("\u001f");
}

function mergePermissionScopes(nodes: readonly KnowledgeNode[]): string[] {
  return [...new Set(nodes.flatMap((node) => node.permissionScope))].sort();
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function deterministicChildId(parentId: string, seed: string): string {
  const hex = createHash("sha256").update(`${parentId}:${seed}`).digest("hex");
  const variant = ((Number.parseInt(hex[16] ?? "8", 16) & 0x3) | 0x8).toString(16);

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `${variant}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}
