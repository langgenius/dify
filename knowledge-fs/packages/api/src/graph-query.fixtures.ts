import type { GraphEntity, GraphRelation } from "./graph-index-repository";
import type {
  GraphQueryPlan,
  GraphQueryRepository,
  GraphSemanticSearchResult,
} from "./graph-query-contracts";
import type { RetrieveHybridInput } from "./retrieval-types";

export const graphId = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const graphScope = {
  permissionScope: ["team:read"],
  snapshot: {
    tenantId: "tenant-graph",
    knowledgeSpaceId: graphId(1),
    publicationId: graphId(2),
    fingerprint: `projection-set-sha256:${"a".repeat(64)}`,
    projectionVersion: 1,
    headRevision: 1,
  },
};
export const graphEmbeddingProfile = {
  dimension: 2,
  model: "embed",
  pluginId: "test/embed",
  provider: "test",
  revision: 1,
  vectorSpaceId: `embedding-space-sha256:${"b".repeat(64)}`,
};
export const graphRetrievalInput: RetrieveHybridInput = {
  ...graphScope,
  projectionSnapshot: graphScope.snapshot,
  knowledgeSpaceId: graphId(1),
  tenantId: "tenant-graph",
  query: "服务 A 间接依赖什么？",
  queryVector: [1, 0],
  topK: 10,
  limit: 10,
  mode: "deep",
  embeddingProfile: graphEmbeddingProfile,
  retrievalProfile: {
    revision: 1,
    defaultMode: "deep",
    topK: 10,
    reasoningModel: { model: "reason", pluginId: "test/reason", provider: "test" },
    rerank: { enabled: true, model: { model: "rank", pluginId: "test/rank", provider: "test" } },
    scoreThreshold: { enabled: false, stage: "rerank" },
  },
};
export function graphEntity(n: number, overrides: Partial<GraphEntity> = {}): GraphEntity {
  return {
    id: graphId(n),
    name: `Service ${n}`,
    canonicalKey: `product:service-${n}`,
    type: "product",
    aliases: [],
    confidence: 0.9,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    extractionVersion: 1,
    knowledgeSpaceId: graphId(1),
    publicationGenerationId: graphId(3),
    permissionScope: ["team:read"],
    sourceNodeIds: [graphId(n + 100)],
    metadata: {},
    ...overrides,
  };
}
export function graphRelation(
  n: number,
  from: number,
  to: number,
  overrides: Partial<GraphRelation> = {},
): GraphRelation {
  return {
    id: graphId(n),
    subjectEntityId: graphId(from),
    objectEntityId: graphId(to),
    type: "depends_on",
    confidence: 0.9,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    extractionVersion: 1,
    knowledgeSpaceId: graphId(1),
    publicationGenerationId: graphId(3),
    permissionScope: ["team:read"],
    sourceNodeIds: [graphId(from + 100), graphId(to + 100)],
    metadata: {},
    ...overrides,
  };
}
export const graphPlan: GraphQueryPlan = {
  status: "ready",
  startEntityIds: [graphId(10)],
  steps: [
    {
      relationTypes: ["depends_on"],
      direction: "outgoing",
      minHops: 1,
      maxHops: 3,
      targetEntityIds: [],
      targetTypes: [],
    },
  ],
};
export const graphCandidates: GraphSemanticSearchResult = {
  entities: [graphEntity(10), graphEntity(11)].map((entity) => ({
    id: entity.id,
    name: entity.name,
    type: entity.type,
    description: "",
    score: 0.9,
    matchedBy: ["vector"],
  })),
  relations: [
    {
      id: "depends_on",
      name: "depends_on",
      type: "depends_on",
      description: "A requires B",
      score: 0.8,
      matchedBy: ["vector"],
    },
  ],
  semanticCoverage: "complete",
};

export function graphRepository(
  entities = [graphEntity(10), graphEntity(11), graphEntity(12)],
  relations = [graphRelation(20, 10, 11), graphRelation(21, 11, 12)],
): GraphQueryRepository {
  return {
    search: async () => graphCandidates,
    loadEntities: async ({ ids, permissionScope }) =>
      entities.filter(
        (entity) =>
          ids.includes(entity.id) &&
          entity.permissionScope.every((scope) => permissionScope.includes(scope)),
      ),
    loadEdges: async ({ frontier, step, permissionScope }) => ({
      edges: relations.flatMap((relation) => {
        if (
          !step.relationTypes.includes(relation.type) ||
          !relation.permissionScope.every((scope) => permissionScope.includes(scope))
        )
          return [];
        return (["outgoing", "incoming"] as const).flatMap((direction) => {
          if (step.direction !== "either" && step.direction !== direction) return [];
          const from =
            direction === "outgoing" ? relation.subjectEntityId : relation.objectEntityId;
          const to = direction === "outgoing" ? relation.objectEntityId : relation.subjectEntityId;
          const entity = entities.find(
            (entity) =>
              entity.id === to &&
              entity.permissionScope.every((scope) => permissionScope.includes(scope)),
          );
          return frontier.includes(from) && entity
            ? [{ entity, edge: { fromEntityId: from, toEntityId: to, relation } }]
            : [];
        });
      }),
      truncated: false,
    }),
  };
}
