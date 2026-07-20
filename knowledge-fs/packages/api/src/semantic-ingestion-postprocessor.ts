import { type ParseArtifact, PublicationGenerationIdSchema } from "@knowledge/core";

import {
  type EntityExtractionFlow,
  extractedEntitiesFromNodeMetadata,
} from "./entity-extraction-flow";
import type { ExtractionQualityControlFlow } from "./extraction-quality-control-flow";
import type { GraphIndexRepository } from "./graph-index-repository";
import { createGraphIndexWriter } from "./graph-index-writer";
import type { KnowledgeNodeRepository } from "./knowledge-node-repository";
import type { RelationExtractionFlow } from "./relation-extraction-flow";
import type { SemanticCommunityMaterializer } from "./semantic-community-materializer";

export interface SemanticIngestionPostProcessorOptions {
  readonly communityMaterializer?: SemanticCommunityMaterializer | undefined;
  readonly entityExtraction: EntityExtractionFlow;
  readonly extractionQuality: ExtractionQualityControlFlow;
  readonly graph: GraphIndexRepository;
  readonly maxNodesPerArtifact: number;
  readonly nodes: KnowledgeNodeRepository;
  readonly relationExtraction?: RelationExtractionFlow | undefined;
}

export interface ProcessSemanticIngestionInput {
  readonly knowledgeSpaceId: string;
  readonly parseArtifact: Pick<ParseArtifact, "id">;
  readonly publicationGenerationId?: string | undefined;
  readonly tenantId?: string | undefined;
  readonly traceId?: string | undefined;
}

export interface SemanticIngestionPostProcessorResult {
  readonly entitiesExtracted: number;
  readonly graphEntityIds: readonly string[];
  readonly graphEntitiesIndexed: number;
  readonly graphRelationIds: readonly string[];
  readonly graphRelationsIndexed: number;
  readonly semanticCommunitiesMaterialized: number;
  readonly nodesScanned: number;
  readonly nodesUpdated: number;
  readonly parseArtifactId: string;
}

export interface SemanticIngestionPostProcessor {
  process(input: ProcessSemanticIngestionInput): Promise<SemanticIngestionPostProcessorResult>;
}

export function createSemanticIngestionPostProcessor({
  communityMaterializer,
  entityExtraction,
  extractionQuality,
  graph,
  maxNodesPerArtifact,
  nodes,
  relationExtraction,
}: SemanticIngestionPostProcessorOptions): SemanticIngestionPostProcessor {
  if (!Number.isInteger(maxNodesPerArtifact) || maxNodesPerArtifact < 1) {
    throw new Error("Semantic ingestion maxNodesPerArtifact must be at least 1");
  }

  const graphWriter = createGraphIndexWriter({
    extractionVersion: 1,
    graph,
    maxBatchSize: maxNodesPerArtifact,
    nodes,
  });

  return {
    process: async ({
      knowledgeSpaceId,
      parseArtifact,
      publicationGenerationId,
      tenantId,
      traceId,
    }) => {
      if (!knowledgeSpaceId.trim()) {
        throw new Error("Semantic ingestion knowledgeSpaceId is required");
      }

      if (!parseArtifact.id.trim()) {
        throw new Error("Semantic ingestion parseArtifact id is required");
      }

      const generationId =
        publicationGenerationId === undefined
          ? undefined
          : PublicationGenerationIdSchema.parse(publicationGenerationId);

      const page = await nodes.listByArtifact({
        knowledgeSpaceId,
        limit: maxNodesPerArtifact,
        parseArtifactId: parseArtifact.id,
        ...(generationId ? { publicationGenerationId: generationId } : {}),
      });

      if (page.nextCursor) {
        throw new Error(
          `Semantic ingestion node count exceeds maxNodesPerArtifact=${maxNodesPerArtifact}`,
        );
      }

      if (page.items.length === 0) {
        return {
          entitiesExtracted: 0,
          graphEntityIds: [],
          graphEntitiesIndexed: 0,
          graphRelationIds: [],
          graphRelationsIndexed: 0,
          nodesScanned: 0,
          nodesUpdated: 0,
          parseArtifactId: parseArtifact.id,
          semanticCommunitiesMaterialized: 0,
        };
      }

      const nodeIds = page.items.map((node) => node.id);
      const extracted = await entityExtraction.extract({
        knowledgeSpaceId,
        nodeIds,
        ...(generationId ? { publicationGenerationId: generationId } : {}),
        ...(tenantId ? { tenantId } : {}),
        traceId,
      });
      assertNoMissingSemanticNodes("entity extraction", extracted.missingNodeIds);
      let nodesWithRelations = extracted.extractedNodes;
      if (relationExtraction) {
        const relations = await relationExtraction.extract({
          knowledgeSpaceId,
          nodeIds: extracted.extractedNodes.map((node) => node.id),
          ...(generationId ? { publicationGenerationId: generationId } : {}),
          ...(tenantId ? { tenantId } : {}),
          traceId,
        });
        assertNoMissingSemanticNodes("relation extraction", relations.missingNodeIds);
        nodesWithRelations = relations.extractedNodes;
      }
      const controlled = await extractionQuality.apply({
        knowledgeSpaceId,
        nodeIds: nodesWithRelations.map((node) => node.id),
        ...(generationId ? { publicationGenerationId: generationId } : {}),
        traceId,
      });
      assertNoMissingSemanticNodes("extraction quality", controlled.missingNodeIds);
      const indexed =
        controlled.controlledNodes.length === 0
          ? {
              entities: [],
              missingNodeIds: [],
              relations: [],
              stats: { entitiesIndexed: 0, relationsIndexed: 0 },
            }
          : await graphWriter.index({
              knowledgeSpaceId,
              nodeIds: controlled.controlledNodes.map((node) => node.id),
              ...(generationId ? { publicationGenerationId: generationId } : {}),
              traceId,
            });
      assertNoMissingSemanticNodes("graph indexing", indexed.missingNodeIds);
      const communities =
        communityMaterializer && tenantId && generationId === undefined
          ? await communityMaterializer.materialize({
              generatedVersion: "ingestion-community-view-v1",
              knowledgeSpaceId,
              tenantId,
            })
          : undefined;

      return {
        entitiesExtracted: controlled.controlledNodes.reduce(
          (sum, node) => sum + extractedEntitiesFromNodeMetadata(node).length,
          0,
        ),
        graphEntityIds: indexed.entities.map((entity) => entity.id),
        graphEntitiesIndexed: indexed.stats.entitiesIndexed,
        graphRelationIds: indexed.relations.map((relation) => relation.id),
        graphRelationsIndexed: indexed.stats.relationsIndexed,
        nodesScanned: page.items.length,
        nodesUpdated: controlled.controlledNodes.length,
        parseArtifactId: parseArtifact.id,
        semanticCommunitiesMaterialized: communities?.communityCount ?? 0,
      };
    },
  };
}

function assertNoMissingSemanticNodes(stage: string, missingNodeIds: readonly string[]): void {
  if (missingNodeIds.length > 0) {
    throw new Error(
      `Semantic ingestion ${stage} lost ${missingNodeIds.length} generation-scoped node(s)`,
    );
  }
}
