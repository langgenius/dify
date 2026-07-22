import type { ArtifactSegmentRepository } from "./artifact-segment-repository";
import type { DocumentAssetRepository } from "./document-asset-repository";
import type { IndexProjectionRepository } from "./index-projection-repository";
import type { KnowledgeNodeRepository } from "./knowledge-node-repository";
import type { ParseArtifactRepository } from "./parse-artifact-repository";

export interface KnowledgeSpaceQuotaUsageInput {
  readonly knowledgeSpaceId: string;
  readonly projectionVersion: number;
}

export interface KnowledgeSpaceQuotaUsage {
  readonly artifactBytes: number;
  readonly artifactCount: number;
  readonly documentCount: number;
  readonly nodeCount: number;
  readonly projectionCount: number;
  readonly rawDocumentBytes: number;
  readonly segmentCount: number;
  readonly truncated: boolean;
}

export interface KnowledgeSpaceQuotaUsageReader {
  read(input: KnowledgeSpaceQuotaUsageInput): Promise<KnowledgeSpaceQuotaUsage>;
}

export interface KnowledgeSpaceQuotaUsageReaderOptions {
  readonly artifactSegments: ArtifactSegmentRepository;
  readonly assets: DocumentAssetRepository;
  readonly maxAssetsPerRead: number;
  readonly maxNodesPerRead: number;
  readonly maxSegmentsPerArtifact: number;
  readonly nodes: KnowledgeNodeRepository;
  readonly parseArtifacts: ParseArtifactRepository;
  readonly projections: IndexProjectionRepository;
}

export function createKnowledgeSpaceQuotaUsageReader({
  artifactSegments,
  assets,
  maxAssetsPerRead,
  maxNodesPerRead,
  maxSegmentsPerArtifact,
  nodes,
  parseArtifacts,
  projections,
}: KnowledgeSpaceQuotaUsageReaderOptions): KnowledgeSpaceQuotaUsageReader {
  validatePositiveLimit("maxAssetsPerRead", maxAssetsPerRead);
  validatePositiveLimit("maxNodesPerRead", maxNodesPerRead);
  validatePositiveLimit("maxSegmentsPerArtifact", maxSegmentsPerArtifact);

  return {
    async read({ knowledgeSpaceId, projectionVersion }) {
      validatePositiveLimit("projectionVersion", projectionVersion);

      const [storageUsage, listedAssets, listedNodes, projectionCount] = await Promise.all([
        assets.getStorageUsage({ knowledgeSpaceId }),
        assets.list({ knowledgeSpaceId, limit: maxAssetsPerRead }),
        nodes.listBySpace({ knowledgeSpaceId, limit: maxNodesPerRead }),
        readProjectionCount({ knowledgeSpaceId, projectionVersion, projections }),
      ]);
      let artifactBytes = 0;
      let artifactCount = 0;
      let segmentCount = 0;
      let truncated = Boolean(listedAssets.nextCursor) || Boolean(listedNodes.nextCursor);

      for (const asset of listedAssets.items) {
        const artifact = await parseArtifacts.getByDocumentVersion({
          documentAssetId: asset.id,
          version: asset.version,
        });

        if (!artifact) {
          continue;
        }

        artifactCount += 1;

        const segments = await artifactSegments.listByArtifact({
          knowledgeSpaceId,
          limit: maxSegmentsPerArtifact,
          parseArtifactId: artifact.id,
        });
        segmentCount += segments.items.length;
        artifactBytes += segments.items.reduce((total, segment) => {
          if (segment.sizeBytes !== undefined) {
            return total + segment.sizeBytes;
          }

          return total + new TextEncoder().encode(segment.inlineText ?? "").byteLength;
        }, 0);
        truncated = truncated || segments.nextCursor !== undefined;
      }

      return {
        artifactBytes,
        artifactCount,
        documentCount: storageUsage.documentCount,
        nodeCount: listedNodes.items.length,
        projectionCount,
        rawDocumentBytes: storageUsage.rawDocumentBytes,
        segmentCount,
        truncated,
      };
    },
  };
}

async function readProjectionCount({
  knowledgeSpaceId,
  projectionVersion,
  projections,
}: {
  readonly knowledgeSpaceId: string;
  readonly projectionVersion: number;
  readonly projections: IndexProjectionRepository;
}): Promise<number> {
  const summaries = await Promise.all(
    (["dense-vector", "fts", "metadata", "graph"] as const).map((type) =>
      projections.summarizeVersion({
        knowledgeSpaceId,
        projectionVersion,
        type,
      }),
    ),
  );

  return summaries.reduce((total, summary) => total + summary.total, 0);
}

function validatePositiveLimit(label: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`KnowledgeSpace quota usage ${label} must be at least 1`);
  }
}
