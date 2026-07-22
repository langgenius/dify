import { type KnowledgeNode, type KnowledgePath, KnowledgePathSchema } from "@knowledge/core";

import { deterministicChildId, uniqueStrings } from "./api-shared-utils";
import {
  candidatePermissionAllowsAsset,
  candidatePermissionAllowsNode,
  candidatePermissionScopeAllows,
  candidatePermissionScopeSnapshot,
} from "./candidate-content-authorization";
import type { DocumentAssetRepository } from "./document-asset-repository";
import type { GraphEntity, GraphIndexRepository } from "./graph-index-repository";
import {
  KNOWLEDGE_FS_BY_COMMUNITY_ROOT,
  KNOWLEDGE_FS_BY_COMMUNITY_VIEW_NAME,
} from "./knowledge-fs-path-utils";
import type { KnowledgeNodeRepository } from "./knowledge-node-repository";
import { type KnowledgePathRepository, cloneKnowledgePath } from "./knowledge-path-repository";
import {
  SemanticCandidateClosureUnavailableError,
  SemanticCandidateVisibilityDeniedError,
} from "./semantic-candidate-authorization";

export interface SemanticCommunityMaterializerOptions {
  readonly assets?: DocumentAssetRepository | undefined;
  readonly graph: GraphIndexRepository;
  readonly maxCommunitiesPerRun: number;
  readonly maxEntitiesPerRun: number;
  readonly maxSourceNodesPerRun: number;
  readonly nodes: KnowledgeNodeRepository;
  readonly now?: () => string;
  readonly paths: KnowledgePathRepository;
  readonly summaryProvider?: SemanticCommunitySummaryProvider | undefined;
}

export interface SemanticCommunitySummaryProvider {
  summarize(input: SemanticCommunitySummaryInput): Promise<SemanticCommunitySummaryResult>;
}

export interface SemanticCommunitySummaryInput {
  readonly documentAssetIds: readonly string[];
  readonly entities: readonly SemanticCommunityEntitySummary[];
  readonly knowledgeSpaceId: string;
  readonly nodeTexts: readonly string[];
  readonly tenantId?: string | undefined;
}

export interface SemanticCommunityEntitySummary {
  readonly id: string;
  readonly name: string;
  readonly type: string;
}

export interface SemanticCommunitySummaryResult {
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  readonly model?: string | undefined;
  readonly summary: string;
  readonly title?: string | undefined;
}

export interface MaterializeSemanticCommunitiesInput {
  /** Current server-issued grants. Omitted only by trusted internal schedulers. */
  readonly candidateGrants?: readonly string[] | undefined;
  readonly generatedVersion?: string | undefined;
  readonly knowledgeSpaceId: string;
  readonly tenantId: string;
}

export interface MaterializeSemanticCommunitiesResult {
  readonly communityCount: number;
  readonly documentCount: number;
  readonly entityCount: number;
  readonly generatedVersion: string;
  readonly knowledgeSpaceId: string;
  readonly pathCount: number;
  readonly paths: readonly KnowledgePath[];
}

export interface SemanticCommunityMaterializer {
  materialize(
    input: MaterializeSemanticCommunitiesInput,
  ): Promise<MaterializeSemanticCommunitiesResult>;
}

interface SemanticCommunity {
  readonly documentAssetIds: readonly string[];
  readonly entities: readonly GraphEntity[];
  readonly nodeTexts: readonly string[];
  readonly permissionScope: readonly string[];
  readonly sourceNodeIds: readonly string[];
}

export function createSemanticCommunityMaterializer({
  assets,
  graph,
  maxCommunitiesPerRun,
  maxEntitiesPerRun,
  maxSourceNodesPerRun,
  nodes,
  now = () => new Date().toISOString(),
  paths,
  summaryProvider,
}: SemanticCommunityMaterializerOptions): SemanticCommunityMaterializer {
  validatePositiveInteger(maxCommunitiesPerRun, "Semantic community maxCommunitiesPerRun");
  validatePositiveInteger(maxEntitiesPerRun, "Semantic community maxEntitiesPerRun");
  validatePositiveInteger(maxSourceNodesPerRun, "Semantic community maxSourceNodesPerRun");

  return {
    materialize: async ({
      candidateGrants,
      generatedVersion = "operator-community-view-v1",
      knowledgeSpaceId,
      tenantId,
    }) => {
      if (!knowledgeSpaceId.trim()) {
        throw new Error("Semantic community knowledgeSpaceId is required");
      }

      if (!tenantId.trim()) {
        throw new Error("Semantic community tenantId is required");
      }

      const entityPage = await graph.listEntities({
        knowledgeSpaceId,
        limit: maxEntitiesPerRun,
      });
      if (candidateGrants !== undefined && entityPage.nextCursor) {
        throw new SemanticCandidateClosureUnavailableError();
      }
      const allEntities = entityPage.items;
      const sourceNodeIds = uniqueStrings(allEntities.flatMap((entity) => entity.sourceNodeIds));
      if (candidateGrants !== undefined && sourceNodeIds.length > maxSourceNodesPerRun) {
        throw new SemanticCandidateClosureUnavailableError();
      }
      const boundedSourceNodeIds = sourceNodeIds.slice(0, maxSourceNodesPerRun);
      const allLoadedNodes =
        boundedSourceNodeIds.length === 0
          ? []
          : await nodes.getMany({
              ids: boundedSourceNodeIds,
              knowledgeSpaceId,
            });
      if (candidateGrants !== undefined && allLoadedNodes.length !== boundedSourceNodeIds.length) {
        throw new SemanticCandidateClosureUnavailableError();
      }
      const authorizedClosure =
        candidateGrants === undefined
          ? {
              assetPermissionScopes: new Map<string, readonly string[]>(),
              nodes: allLoadedNodes,
            }
          : await authorizeSemanticCommunityNodes({
              assets,
              candidateGrants,
              knowledgeSpaceId,
              nodes: allLoadedNodes,
            });
      const authorizedSourceNodeIds = new Set(authorizedClosure.nodes.map((node) => node.id));
      const authorizedEntities = allEntities.filter(
        (entity) =>
          candidateGrants === undefined ||
          (candidatePermissionScopeAllows(entity.permissionScope, candidateGrants) &&
            entity.sourceNodeIds.length > 0 &&
            entity.sourceNodeIds.every((nodeId) => authorizedSourceNodeIds.has(nodeId))),
      );
      if (candidateGrants !== undefined && authorizedEntities.length !== allEntities.length) {
        throw new SemanticCandidateVisibilityDeniedError();
      }
      const entities = authorizedEntities.filter(isCommunityEntityCandidate);
      const loadedNodes =
        candidateGrants === undefined
          ? allLoadedNodes
          : authorizedClosure.nodes.filter((node) =>
              entities.some((entity) => entity.sourceNodeIds.includes(node.id)),
            );
      const nodesById = new Map(loadedNodes.map((node) => [node.id, node]));
      const relationPairs = await loadGraphRelationPairs({
        entities,
        graph,
        knowledgeSpaceId,
        maxEntitiesPerRun,
        ...(candidateGrants === undefined
          ? { permissionScope: [tenantId] }
          : {
              authorizedSourceNodeIds,
              permissionScope: candidateGrants,
            }),
      });
      const communities = buildCommunities({
        assetPermissionScopes: authorizedClosure.assetPermissionScopes,
        entities,
        nodesById,
        relationPairs,
      }).slice(0, maxCommunitiesPerRun);
      const generatedAt = now();
      if (candidateGrants === undefined) {
        await paths.deleteSemanticView({
          knowledgeSpaceId,
          maxPaths: maxCommunitiesPerRun * (maxSourceNodesPerRun + 1),
          viewName: KNOWLEDGE_FS_BY_COMMUNITY_VIEW_NAME,
        });
      }
      const materializedPaths = (
        await Promise.all(
          communities.flatMap((community) => [
            materializeCommunityPath({
              community,
              generatedAt,
              generatedVersion,
              knowledgeSpaceId,
              summaryProvider,
              tenantId,
            }),
            ...community.documentAssetIds.map((documentAssetId) =>
              materializeCommunityDocumentPath({
                community,
                documentAssetId,
                generatedAt,
                generatedVersion,
                knowledgeSpaceId,
                tenantId,
              }),
            ),
          ]),
        )
      ).filter((path): path is KnowledgePath => Boolean(path));
      const upserted = materializedPaths.length ? await paths.upsertMany(materializedPaths) : [];

      return {
        communityCount: communities.length,
        documentCount: uniqueStrings(communities.flatMap((community) => community.documentAssetIds))
          .length,
        entityCount: entities.length,
        generatedVersion,
        knowledgeSpaceId,
        pathCount: upserted.length,
        paths: upserted.map(cloneKnowledgePath),
      };
    },
  };
}

async function authorizeSemanticCommunityNodes({
  assets,
  candidateGrants,
  knowledgeSpaceId,
  nodes,
}: {
  readonly assets: DocumentAssetRepository | undefined;
  readonly candidateGrants: readonly string[];
  readonly knowledgeSpaceId: string;
  readonly nodes: readonly KnowledgeNode[];
}): Promise<{
  readonly assetPermissionScopes: ReadonlyMap<string, readonly string[]>;
  readonly nodes: readonly KnowledgeNode[];
}> {
  if (!assets) {
    throw new Error("Semantic community candidate authorization requires document assets");
  }

  const loadedAssets = await Promise.all(
    uniqueStrings(nodes.map((node) => node.documentAssetId)).map((id) =>
      assets.get({ id, knowledgeSpaceId }),
    ),
  );
  const assetPermissionScopes = new Map<string, readonly string[]>();
  for (const asset of loadedAssets) {
    if (!asset || !candidatePermissionAllowsAsset(asset, candidateGrants)) {
      continue;
    }
    const permissionScope = candidatePermissionScopeSnapshot(asset.metadata.permissionScope);
    if (permissionScope) {
      assetPermissionScopes.set(asset.id, permissionScope);
    }
  }

  return {
    assetPermissionScopes,
    nodes: nodes.filter(
      (node) =>
        assetPermissionScopes.has(node.documentAssetId) &&
        candidatePermissionAllowsNode(node, candidateGrants),
    ),
  };
}

function buildCommunities({
  assetPermissionScopes,
  entities,
  nodesById,
  relationPairs,
}: {
  readonly assetPermissionScopes: ReadonlyMap<string, readonly string[]>;
  readonly entities: readonly GraphEntity[];
  readonly nodesById: ReadonlyMap<string, KnowledgeNode>;
  readonly relationPairs: readonly SemanticCommunityRelationPair[];
}): SemanticCommunity[] {
  const entitiesById = new Map(entities.map((entity) => [entity.id, entity]));
  const neighbors = new Map<string, Set<string>>();
  const nodeEntities = new Map<string, string[]>();

  for (const entity of entities) {
    neighbors.set(entity.id, neighbors.get(entity.id) ?? new Set());
    for (const nodeId of entity.sourceNodeIds) {
      nodeEntities.set(nodeId, [...(nodeEntities.get(nodeId) ?? []), entity.id]);
    }
  }

  for (const entityIds of nodeEntities.values()) {
    const uniqueEntityIds = uniqueStrings(entityIds);
    for (const entityId of uniqueEntityIds) {
      const linked = neighbors.get(entityId);
      for (const otherEntityId of uniqueEntityIds) {
        if (entityId !== otherEntityId) {
          linked?.add(otherEntityId);
        }
      }
    }
  }

  for (const pair of relationPairs) {
    neighbors.get(pair.subjectEntityId)?.add(pair.objectEntityId);
    neighbors.get(pair.objectEntityId)?.add(pair.subjectEntityId);
  }

  const visited = new Set<string>();
  const communities: SemanticCommunity[] = [];

  for (const entity of entities) {
    if (visited.has(entity.id)) {
      continue;
    }

    const componentIds = collectComponent(entity.id, neighbors, visited);
    const componentEntities = componentIds
      .map((id) => entitiesById.get(id))
      .filter((item): item is GraphEntity => Boolean(item))
      .sort(compareCommunityEntities);
    const sourceNodeIds = uniqueStrings(
      componentEntities.flatMap((componentEntity) => componentEntity.sourceNodeIds),
    );
    const communityNodes = sourceNodeIds.flatMap((id) => {
      const node = nodesById.get(id);

      return node ? [node] : [];
    });
    const documentAssetIds = uniqueStrings(
      communityNodes.map((node) => node.documentAssetId),
    ).sort();

    if (componentEntities.length === 0 || documentAssetIds.length === 0) {
      continue;
    }

    communities.push({
      documentAssetIds,
      entities: componentEntities,
      nodeTexts: communityNodes.map((node) => node.text).filter((text) => text.trim()),
      permissionScope: uniqueStrings([
        ...componentEntities.flatMap((componentEntity) => componentEntity.permissionScope),
        ...communityNodes.flatMap((node) => node.permissionScope),
        ...documentAssetIds.flatMap((id) => assetPermissionScopes.get(id) ?? []),
      ]).sort(),
      sourceNodeIds,
    });
  }

  return communities.sort(compareCommunities);
}

interface SemanticCommunityRelationPair {
  readonly objectEntityId: string;
  readonly subjectEntityId: string;
}

async function loadGraphRelationPairs({
  authorizedSourceNodeIds,
  entities,
  graph,
  knowledgeSpaceId,
  maxEntitiesPerRun,
  permissionScope,
}: {
  readonly authorizedSourceNodeIds?: ReadonlySet<string> | undefined;
  readonly entities: readonly GraphEntity[];
  readonly graph: GraphIndexRepository;
  readonly knowledgeSpaceId: string;
  readonly maxEntitiesPerRun: number;
  readonly permissionScope: readonly string[];
}): Promise<SemanticCommunityRelationPair[]> {
  const entityIds = new Set(entities.map((entity) => entity.id));
  const traversals = await Promise.all(
    entities.map((entity) =>
      graph.traverse({
        fanout: 20,
        knowledgeSpaceId,
        maxDepth: 1,
        maxNodes: maxEntitiesPerRun,
        permissionScope,
        startEntityId: entity.id,
        timeoutMs: 250,
      }),
    ),
  );

  return traversals.flatMap((traversal) =>
    traversal.relations.flatMap((relation) =>
      entityIds.has(relation.subjectEntityId) &&
      entityIds.has(relation.objectEntityId) &&
      (authorizedSourceNodeIds === undefined ||
        (candidatePermissionScopeAllows(relation.permissionScope, permissionScope) &&
          relation.sourceNodeIds.length > 0 &&
          relation.sourceNodeIds.every((nodeId) => authorizedSourceNodeIds.has(nodeId))))
        ? [
            {
              objectEntityId: relation.objectEntityId,
              subjectEntityId: relation.subjectEntityId,
            },
          ]
        : [],
    ),
  );
}

function collectComponent(
  startId: string,
  neighbors: ReadonlyMap<string, ReadonlySet<string>>,
  visited: Set<string>,
): string[] {
  const stack = [startId];
  const component: string[] = [];

  while (stack.length > 0) {
    const id = stack.pop();
    if (!id || visited.has(id)) {
      continue;
    }

    visited.add(id);
    component.push(id);

    for (const neighbor of neighbors.get(id) ?? []) {
      if (!visited.has(neighbor)) {
        stack.push(neighbor);
      }
    }
  }

  return component;
}

async function materializeCommunityPath({
  community,
  generatedAt,
  generatedVersion,
  knowledgeSpaceId,
  summaryProvider,
  tenantId,
}: {
  readonly community: SemanticCommunity;
  readonly generatedAt: string;
  readonly generatedVersion: string;
  readonly knowledgeSpaceId: string;
  readonly summaryProvider?: SemanticCommunitySummaryProvider | undefined;
  readonly tenantId: string;
}): Promise<KnowledgePath> {
  const fallbackSummary = deterministicCommunitySummary(community);
  const summary = summaryProvider
    ? await summaryProvider.summarize({
        documentAssetIds: community.documentAssetIds,
        entities: community.entities.map((entity) => ({
          id: entity.id,
          name: entity.name,
          type: entity.type,
        })),
        knowledgeSpaceId,
        nodeTexts: community.nodeTexts,
        ...(tenantId ? { tenantId } : {}),
      })
    : fallbackSummary;
  const title = sanitizeSummaryTitle(summary.title) ?? fallbackSummary.title;
  const communityId = deterministicCommunityId(knowledgeSpaceId, community);
  const slug = communitySlug({ communityId, title: fallbackSummary.title });

  return KnowledgePathSchema.parse({
    id: deterministicChildId(knowledgeSpaceId, `semantic-community-path:${communityId}`),
    knowledgeSpaceId,
    metadata: {
      communityId,
      documentAssetIds: community.documentAssetIds,
      documentCount: community.documentAssetIds.length,
      entityCount: community.entities.length,
      entityIds: community.entities.map((entity) => entity.id),
      entityNames: community.entities.map((entity) => entity.name),
      permissionScope: community.permissionScope,
      semanticView: {
        buildStatus: "ready",
        generatedAt,
        generatedVersion,
        operatorAction: "community-materialize",
        staleStatus: "fresh",
      },
      sourceNodeCount: community.sourceNodeIds.length,
      summary: summary.summary.trim(),
      ...(summary.model ? { summaryModel: summary.model } : {}),
      ...(summary.metadata ? { summaryProviderMetadata: summary.metadata } : {}),
      tenantId,
      title,
    },
    resourceType: "workspace",
    targetId: knowledgeSpaceId,
    viewName: KNOWLEDGE_FS_BY_COMMUNITY_VIEW_NAME,
    viewType: "semantic",
    virtualPath: `${KNOWLEDGE_FS_BY_COMMUNITY_ROOT}/${slug}`,
  });
}

function materializeCommunityDocumentPath({
  community,
  documentAssetId,
  generatedAt,
  generatedVersion,
  knowledgeSpaceId,
  tenantId,
}: {
  readonly community: SemanticCommunity;
  readonly documentAssetId: string;
  readonly generatedAt: string;
  readonly generatedVersion: string;
  readonly knowledgeSpaceId: string;
  readonly tenantId: string;
}): KnowledgePath {
  const communityId = deterministicCommunityId(knowledgeSpaceId, community);
  const title = deterministicCommunitySummary(community).title;
  const slug = communitySlug({ communityId, title });

  return KnowledgePathSchema.parse({
    id: deterministicChildId(
      knowledgeSpaceId,
      `semantic-community-document:${communityId}:${documentAssetId}`,
    ),
    knowledgeSpaceId,
    metadata: {
      communityId,
      entityIds: community.entities.map((entity) => entity.id),
      permissionScope: community.permissionScope,
      semanticView: {
        buildStatus: "ready",
        generatedAt,
        generatedVersion,
        operatorAction: "community-materialize",
        staleStatus: "fresh",
      },
      tenantId,
      title,
    },
    resourceType: "document",
    targetId: documentAssetId,
    viewName: KNOWLEDGE_FS_BY_COMMUNITY_VIEW_NAME,
    viewType: "semantic",
    virtualPath: `${KNOWLEDGE_FS_BY_COMMUNITY_ROOT}/${slug}/${documentAssetId}`,
  });
}

function deterministicCommunitySummary(
  community: SemanticCommunity,
): SemanticCommunitySummaryResult & {
  readonly title: string;
} {
  const primaryEntities = community.entities.slice(0, 4).map((entity) => entity.name);
  const title = primaryEntities.slice(0, 2).join(" + ") || "Knowledge community";
  const summary = [
    `Community around ${primaryEntities.join(", ") || "related entities"}.`,
    `Covers ${community.documentAssetIds.length} document(s), ${community.entities.length} entity/entities, and ${community.sourceNodeIds.length} source node(s).`,
  ].join(" ");

  return { summary, title };
}

function deterministicCommunityId(knowledgeSpaceId: string, community: SemanticCommunity): string {
  return deterministicChildId(
    knowledgeSpaceId,
    `semantic-community:${community.entities
      .map((entity) => entity.id)
      .sort()
      .join("|")}`,
  );
}

function communitySlug({
  communityId,
  title,
}: {
  readonly communityId: string;
  readonly title: string;
}): string {
  const slug = title
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 72);
  const suffix = communityId.slice(0, 8);

  return `${slug || "community"}-${suffix}`;
}

function sanitizeSummaryTitle(value: string | undefined): string | undefined {
  const trimmed = value?.trim();

  return trimmed ? trimmed.slice(0, 120) : undefined;
}

function compareCommunityEntities(left: GraphEntity, right: GraphEntity): number {
  return (
    right.sourceNodeIds.length - left.sourceNodeIds.length || left.name.localeCompare(right.name)
  );
}

function compareCommunities(left: SemanticCommunity, right: SemanticCommunity): number {
  return (
    right.documentAssetIds.length - left.documentAssetIds.length ||
    right.entities.length - left.entities.length ||
    left.entities[0]?.name.localeCompare(right.entities[0]?.name ?? "") ||
    0
  );
}

function isCommunityEntityCandidate(entity: GraphEntity): boolean {
  if (entity.type === "date" || entity.type === "metric") {
    return false;
  }

  const name = entity.name.trim();
  if (isBareNumber(name) || isUuidLike(name) || name.length < 3) {
    return false;
  }

  return true;
}

function isBareNumber(value: string): boolean {
  return /^\d+(?:\.\d+)?%?$/u.test(value);
}

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(value);
}

function validatePositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${label} must be at least 1`);
  }
}
