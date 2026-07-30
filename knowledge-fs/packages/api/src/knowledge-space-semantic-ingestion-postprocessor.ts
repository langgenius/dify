import {
  type KnowledgeSpaceModelSelection,
  KnowledgeSpaceRetrievalProfileSchema,
} from "@knowledge/core";

import { type EntityExtractionFlow, createEntityExtractionFlow } from "./entity-extraction-flow";
import {
  type ExtractionQualityControlFlow,
  createExtractionQualityControlFlow,
} from "./extraction-quality-control-flow";
import type { GraphIndexRepository } from "./graph-index-repository";
import type { KnowledgeNodeRepository } from "./knowledge-node-repository";
import type { KnowledgeSpaceManifestRepository } from "./knowledge-space-manifest-repository";
import {
  type EntityExtractionTextProvider,
  createLlmEntityExtractionProvider,
} from "./llm-entity-extraction-provider";
import {
  type RelationExtractionTextProvider,
  createLlmRelationExtractionProvider,
} from "./llm-relation-extraction-provider";
import { ReasoningCapabilityUnavailableError } from "./profile-aware-query-generator";
import {
  type RelationExtractionFlow,
  createRelationExtractionFlow,
} from "./relation-extraction-flow";
import type { SemanticCommunityMaterializer } from "./semantic-community-materializer";
import {
  type SemanticIngestionPostProcessor,
  createSemanticIngestionPostProcessor,
} from "./semantic-ingestion-postprocessor";

export type KnowledgeSpaceSemanticExtractionTextProvider = EntityExtractionTextProvider &
  RelationExtractionTextProvider;

export interface KnowledgeSpaceSemanticIngestionPostProcessorOptions {
  readonly communityMaterializer?: SemanticCommunityMaterializer | undefined;
  readonly graph: GraphIndexRepository;
  readonly manifests: Pick<KnowledgeSpaceManifestRepository, "get">;
  readonly maxEntitiesPerNode: number;
  readonly maxNodesPerArtifact: number;
  readonly maxOutputTokens: number;
  readonly maxRelationsPerNode: number;
  readonly nodes: KnowledgeNodeRepository;
  readonly now?: () => string;
  readonly providerFactory: (
    selection: KnowledgeSpaceModelSelection,
  ) => KnowledgeSpaceSemanticExtractionTextProvider;
}

export interface ResolveKnowledgeSpaceSemanticExtractionFlowsInput {
  readonly knowledgeSpaceId: string;
  readonly retrievalProfile?:
    | Parameters<SemanticIngestionPostProcessor["process"]>[0]["retrievalProfile"]
    | undefined;
  readonly tenantId?: string | undefined;
}

export interface KnowledgeSpaceSemanticExtractionFlows {
  readonly entityExtraction: EntityExtractionFlow;
  readonly extractionQuality: ExtractionQualityControlFlow;
  readonly relationExtraction: RelationExtractionFlow;
}

export interface KnowledgeSpaceSemanticExtractionFlowResolver {
  resolve(
    input: ResolveKnowledgeSpaceSemanticExtractionFlowsInput,
  ): Promise<KnowledgeSpaceSemanticExtractionFlows>;
}

export type KnowledgeSpaceSemanticExtractionFlowResolverOptions = Omit<
  KnowledgeSpaceSemanticIngestionPostProcessorOptions,
  "communityMaterializer" | "graph"
>;

export function createKnowledgeSpaceSemanticExtractionFlowResolver({
  manifests,
  maxEntitiesPerNode,
  maxNodesPerArtifact,
  maxOutputTokens,
  maxRelationsPerNode,
  nodes,
  now = () => new Date().toISOString(),
  providerFactory,
}: KnowledgeSpaceSemanticExtractionFlowResolverOptions): KnowledgeSpaceSemanticExtractionFlowResolver {
  assertPositiveInteger(maxEntitiesPerNode, "maxEntitiesPerNode");
  assertPositiveInteger(maxNodesPerArtifact, "maxNodesPerArtifact");
  assertPositiveInteger(maxOutputTokens, "maxOutputTokens");
  assertPositiveInteger(maxRelationsPerNode, "maxRelationsPerNode");

  return {
    resolve: async (input) => {
      if (!input.tenantId?.trim()) {
        throw new ReasoningCapabilityUnavailableError(
          "Knowledge-space semantic ingestion requires a tenant scope",
        );
      }

      const frozenProfile = input.retrievalProfile
        ? KnowledgeSpaceRetrievalProfileSchema.parse(input.retrievalProfile)
        : undefined;
      const manifest = frozenProfile
        ? undefined
        : await manifests.get({
            knowledgeSpaceId: input.knowledgeSpaceId,
            tenantId: input.tenantId,
          });
      const selection = frozenProfile?.reasoningModel ?? manifest?.retrievalProfile?.reasoningModel;

      if (!selection) {
        throw new ReasoningCapabilityUnavailableError(
          "Knowledge-space semantic ingestion requires a configured reasoning model",
        );
      }

      const provider = providerFactory(selection);

      return {
        entityExtraction: createEntityExtractionFlow({
          maxBatchSize: maxNodesPerArtifact,
          maxEntitiesPerNode,
          model: selection.model,
          nodes,
          now,
          provider: createLlmEntityExtractionProvider({
            maxOutputTokens,
            provider,
          }),
        }),
        extractionQuality: createExtractionQualityControlFlow({
          maxBatchSize: maxNodesPerArtifact,
          maxEligibleEntitiesPerNode: maxEntitiesPerNode,
          nodes,
          now,
        }),
        relationExtraction: createRelationExtractionFlow({
          maxBatchSize: maxNodesPerArtifact,
          maxRelationsPerNode,
          model: selection.model,
          nodes,
          now,
          provider: createLlmRelationExtractionProvider({
            maxOutputTokens,
            provider,
          }),
        }),
      };
    },
  };
}

/**
 * Resolves graph extraction from the owning knowledge space's reasoning-model selection.
 *
 * Durable compilation passes its frozen retrieval profile so one candidate cannot mix model
 * revisions. Synchronous and source ingestion resolve the current manifest under tenant scope.
 */
export function createKnowledgeSpaceSemanticIngestionPostProcessor({
  communityMaterializer,
  graph,
  manifests,
  maxEntitiesPerNode,
  maxNodesPerArtifact,
  maxOutputTokens,
  maxRelationsPerNode,
  nodes,
  now = () => new Date().toISOString(),
  providerFactory,
}: KnowledgeSpaceSemanticIngestionPostProcessorOptions): SemanticIngestionPostProcessor {
  const flowResolver = createKnowledgeSpaceSemanticExtractionFlowResolver({
    manifests,
    maxEntitiesPerNode,
    maxNodesPerArtifact,
    maxOutputTokens,
    maxRelationsPerNode,
    nodes,
    now,
    providerFactory,
  });

  return {
    process: async (input) => {
      const flows = await flowResolver.resolve(input);
      const processor = createSemanticIngestionPostProcessor({
        ...(communityMaterializer ? { communityMaterializer } : {}),
        entityExtraction: flows.entityExtraction,
        extractionQuality: flows.extractionQuality,
        graph,
        maxNodesPerArtifact,
        nodes,
        relationExtraction: flows.relationExtraction,
      });

      return processor.process(input);
    },
  };
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`Knowledge-space semantic ingestion ${name} must be at least 1`);
  }
}
