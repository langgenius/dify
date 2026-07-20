import { randomUUID } from "node:crypto";

import {
  type JobQueueAdapter,
  type JobRecord,
  type KnowledgeNode,
  type KnowledgePath,
  KnowledgePathSchema,
} from "@knowledge/core";

import { cloneJsonObject } from "./json-utils";
import {
  KNOWLEDGE_FS_BY_TOPIC_ROOT,
  KNOWLEDGE_FS_BY_TOPIC_VIEW_NAME,
} from "./knowledge-fs-path-utils";
import type { KnowledgeNodeRepository } from "./knowledge-node-repository";
import { type KnowledgePathRepository, cloneKnowledgePath } from "./knowledge-path-repository";

export interface SemanticTopicCluster {
  readonly documentAssetIds: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  readonly name: string;
  readonly slug: string;
}

export interface SemanticTopicClusterResult {
  readonly topics: readonly SemanticTopicCluster[];
}

export interface SemanticTopicClustererInput {
  readonly knowledgeSpaceId: string;
  readonly maxDocumentsPerTopic: number;
  readonly maxTopics: number;
  readonly summaryNodes: readonly KnowledgeNode[];
}

export interface SemanticTopicClusterer {
  cluster(input: SemanticTopicClustererInput): Promise<SemanticTopicClusterResult>;
}

export interface TopicViewMaterializationInput {
  readonly generatedVersion: string;
  readonly knowledgeSpaceId: string;
  readonly summaryNodeIds: readonly string[];
  readonly tenantId: string;
}

export interface TopicViewMaterializationResult {
  readonly pathCount: number;
  readonly paths: readonly KnowledgePath[];
  readonly topics: readonly SemanticTopicCluster[];
}

export interface KnowledgeFsTopicViewMaterializer {
  enqueue(input: TopicViewMaterializationInput): Promise<JobRecord>;
  process(input: TopicViewMaterializationInput): Promise<TopicViewMaterializationResult>;
}

export interface KnowledgeFsTopicViewMaterializerOptions {
  readonly clusterer: SemanticTopicClusterer;
  readonly generateId?: () => string;
  readonly jobs: Pick<JobQueueAdapter, "enqueue">;
  readonly maxDocumentsPerTopic: number;
  readonly maxSummaryNodes: number;
  readonly maxTopics: number;
  readonly nodes: KnowledgeNodeRepository;
  readonly now?: () => string;
  readonly paths: KnowledgePathRepository;
}

export function createKnowledgeFsTopicViewMaterializer({
  clusterer,
  generateId = randomUUID,
  jobs,
  maxDocumentsPerTopic,
  maxSummaryNodes,
  maxTopics,
  nodes,
  now = () => new Date().toISOString(),
  paths,
}: KnowledgeFsTopicViewMaterializerOptions): KnowledgeFsTopicViewMaterializer {
  validateTopicViewMaterializerBounds({
    maxDocumentsPerTopic,
    maxSummaryNodes,
    maxTopics,
  });

  return {
    enqueue: async (input) => {
      validateTopicViewMaterializationInput(input, maxSummaryNodes);

      return jobs.enqueue({
        idempotencyKey: `knowledgefs.topic-view:${input.knowledgeSpaceId}:${input.generatedVersion}`,
        payload: {
          generatedVersion: input.generatedVersion,
          knowledgeSpaceId: input.knowledgeSpaceId,
          summaryNodeIds: [...input.summaryNodeIds],
          tenantId: input.tenantId,
        },
        type: "knowledgefs.topic-view.materialize",
      });
    },
    process: async (input) => {
      validateTopicViewMaterializationInput(input, maxSummaryNodes);
      const summaryNodes = await nodes.getMany({
        ids: input.summaryNodeIds,
        knowledgeSpaceId: input.knowledgeSpaceId,
      });

      if (summaryNodes.length !== uniqueStrings(input.summaryNodeIds).length) {
        throw new Error("Topic view summary nodes are missing");
      }

      const clustered = await clusterer.cluster({
        knowledgeSpaceId: input.knowledgeSpaceId,
        maxDocumentsPerTopic,
        maxTopics,
        summaryNodes,
      });
      validateSemanticTopicClusters(clustered.topics, { maxDocumentsPerTopic, maxTopics });
      const generatedAt = now();
      const sourceSummaryNodeIds = uniqueStrings(summaryNodes.map((node) => node.id));
      const materializedPaths = clustered.topics.flatMap((topic) =>
        topic.documentAssetIds.map((documentAssetId) =>
          KnowledgePathSchema.parse({
            id: generateId(),
            knowledgeSpaceId: input.knowledgeSpaceId,
            metadata: {
              ...cloneJsonObject(topic.metadata ?? {}),
              semanticView: {
                buildStatus: "ready",
                generatedAt,
                generatedVersion: input.generatedVersion,
                staleStatus: "fresh",
              },
              sourceSummaryNodeIds,
              topicName: topic.name,
              topicSlug: topic.slug,
            },
            resourceType: "document",
            targetId: documentAssetId,
            viewName: KNOWLEDGE_FS_BY_TOPIC_VIEW_NAME,
            viewType: "semantic",
            virtualPath: `${KNOWLEDGE_FS_BY_TOPIC_ROOT}/${topic.slug}/${documentAssetId}`,
          }),
        ),
      );
      const upserted = materializedPaths.length ? await paths.upsertMany(materializedPaths) : [];

      return {
        pathCount: upserted.length,
        paths: upserted.map(cloneKnowledgePath),
        topics: clustered.topics.map((topic) => ({
          ...topic,
          documentAssetIds: [...topic.documentAssetIds],
          metadata: cloneJsonObject(topic.metadata ?? {}),
        })),
      };
    },
  };
}

function validateTopicViewMaterializerBounds({
  maxDocumentsPerTopic,
  maxSummaryNodes,
  maxTopics,
}: {
  readonly maxDocumentsPerTopic: number;
  readonly maxSummaryNodes: number;
  readonly maxTopics: number;
}) {
  if (!Number.isInteger(maxSummaryNodes) || maxSummaryNodes < 1) {
    throw new Error("Topic view maxSummaryNodes must be at least 1");
  }

  if (!Number.isInteger(maxTopics) || maxTopics < 1) {
    throw new Error("Topic view maxTopics must be at least 1");
  }

  if (!Number.isInteger(maxDocumentsPerTopic) || maxDocumentsPerTopic < 1) {
    throw new Error("Topic view maxDocumentsPerTopic must be at least 1");
  }
}

function validateTopicViewMaterializationInput(
  input: TopicViewMaterializationInput,
  maxSummaryNodes: number,
) {
  if (!input.knowledgeSpaceId.trim()) {
    throw new Error("Topic view knowledgeSpaceId is required");
  }

  if (!input.tenantId.trim()) {
    throw new Error("Topic view tenantId is required");
  }

  if (!input.generatedVersion.trim()) {
    throw new Error("Topic view generatedVersion is required");
  }

  if (input.summaryNodeIds.length < 1) {
    throw new Error("Topic view summaryNodeIds must contain at least 1 node id");
  }

  if (input.summaryNodeIds.length > maxSummaryNodes) {
    throw new Error(`Topic view summaryNodeIds exceeds maxSummaryNodes=${maxSummaryNodes}`);
  }

  for (const nodeId of input.summaryNodeIds) {
    if (!nodeId.trim()) {
      throw new Error("Topic view summaryNodeIds must be non-empty strings");
    }
  }
}

function validateSemanticTopicClusters(
  topics: readonly SemanticTopicCluster[],
  {
    maxDocumentsPerTopic,
    maxTopics,
  }: {
    readonly maxDocumentsPerTopic: number;
    readonly maxTopics: number;
  },
) {
  if (topics.length > maxTopics) {
    throw new Error(`Topic view cluster count exceeds maxTopics=${maxTopics}`);
  }

  for (const topic of topics) {
    if (!topic.name.trim() || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(topic.slug)) {
      throw new Error("Topic view cluster name and slug are required");
    }

    if (topic.documentAssetIds.length > maxDocumentsPerTopic) {
      throw new Error(
        `Topic view cluster documents exceed maxDocumentsPerTopic=${maxDocumentsPerTopic}`,
      );
    }

    for (const documentAssetId of topic.documentAssetIds) {
      if (!documentAssetId.trim() || documentAssetId.includes("/")) {
        throw new Error("Topic view document asset ids must be path-safe strings");
      }
    }
  }
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}
