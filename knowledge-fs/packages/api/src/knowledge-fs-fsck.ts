import {
  type IndexProjection,
  KnowledgeFsckReportSchema,
  type KnowledgeFsckIssue,
  type KnowledgeFsckReport,
  type KnowledgePath,
  type PlatformAdapter,
} from "@knowledge/core";

import type { ArtifactSegmentRepository } from "./artifact-segment-repository";
import type { DocumentAssetRepository, DocumentAssetCursor } from "./document-asset-repository";
import { sha256Hex } from "./document-upload-utils";
import type { IndexProjectionRepository } from "./index-projection-repository";
import type { KnowledgeNodeRepository } from "./knowledge-node-repository";
import type { KnowledgePathRepository } from "./knowledge-path-repository";
import type { ParseArtifactRepository } from "./parse-artifact-repository";

export interface KnowledgeFsRawObjectFsckInput {
  readonly cursor?: string | undefined;
  readonly knowledgeSpaceId: string;
  readonly tenantId: string;
}

export interface KnowledgeFsRawObjectFsckChecker {
  check(input: KnowledgeFsRawObjectFsckInput): Promise<KnowledgeFsckReport>;
}

export interface KnowledgeFsRawObjectFsckCheckerOptions {
  readonly assets: DocumentAssetRepository;
  readonly maxAssetsPerRun: number;
  readonly now?: () => string;
  readonly objectStorage: PlatformAdapter["objectStorage"];
}

export interface KnowledgeFsArtifactSegmentFsckInput {
  readonly cursor?: string | undefined;
  readonly knowledgeSpaceId: string;
  readonly tenantId: string;
}

export interface KnowledgeFsArtifactSegmentFsckChecker {
  check(input: KnowledgeFsArtifactSegmentFsckInput): Promise<KnowledgeFsckReport>;
}

export interface KnowledgeFsArtifactSegmentFsckCheckerOptions {
  readonly artifactSegments: ArtifactSegmentRepository;
  readonly assets: DocumentAssetRepository;
  readonly maxAssetsPerRun: number;
  readonly maxSegmentsPerArtifact: number;
  readonly now?: () => string;
  readonly objectStorage: PlatformAdapter["objectStorage"];
  readonly parseArtifacts: ParseArtifactRepository;
}

export interface KnowledgeFsReferenceFsckInput {
  readonly knowledgeSpaceId: string;
  readonly tenantId: string;
}

export interface KnowledgeFsReferenceFsckChecker {
  check(input: KnowledgeFsReferenceFsckInput): Promise<KnowledgeFsckReport>;
}

export interface KnowledgeFsReferenceFsckCheckerOptions {
  readonly assets: DocumentAssetRepository;
  readonly maxNodesPerRun: number;
  readonly maxPathsPerView: number;
  readonly maxProjectionsPerType: number;
  readonly nodes: KnowledgeNodeRepository;
  readonly now?: () => string;
  readonly parseArtifacts: ParseArtifactRepository;
  readonly paths: KnowledgePathRepository;
  readonly pathViewNames: readonly string[];
  readonly projections: IndexProjectionRepository;
  readonly projectionTypes: readonly IndexProjection["type"][];
}

export function createKnowledgeFsRawObjectFsckChecker({
  assets,
  maxAssetsPerRun,
  now = () => new Date().toISOString(),
  objectStorage,
}: KnowledgeFsRawObjectFsckCheckerOptions): KnowledgeFsRawObjectFsckChecker {
  if (!Number.isSafeInteger(maxAssetsPerRun) || maxAssetsPerRun < 1) {
    throw new Error("KnowledgeFS raw object fsck maxAssetsPerRun must be at least 1");
  }

  return {
    async check({ cursor, knowledgeSpaceId, tenantId }) {
      const listed = await assets.list({
        cursor: cursor ? decodeAssetCursor(cursor) : undefined,
        knowledgeSpaceId,
        limit: maxAssetsPerRun,
      });
      const issues: KnowledgeFsckIssue[] = [];

      for (const asset of listed.items) {
        const metadata = await objectStorage.headObject(asset.objectKey);

        if (!metadata) {
          issues.push({
            code: "raw-object-missing",
            message: "Raw document object is missing",
            repairability: "manual",
            severity: "error",
            target: {
              documentAssetId: asset.id,
              objectKey: asset.objectKey,
              type: "raw-object",
            },
            type: "missing-raw-object",
          });
          continue;
        }

        if (metadata.metadata.sha256 && metadata.metadata.sha256 !== asset.sha256) {
          issues.push({
            code: "raw-object-checksum-mismatch",
            message: "Raw document object checksum does not match the document asset",
            repairability: "manual",
            severity: "critical",
            target: {
              documentAssetId: asset.id,
              objectKey: asset.objectKey,
              type: "raw-object",
            },
            type: "checksum-mismatch",
          });
        }

        if (metadata.sizeBytes !== asset.sizeBytes) {
          issues.push({
            code: "raw-object-size-mismatch",
            message: "Raw document object size does not match the document asset",
            repairability: "manual",
            severity: "warning",
            target: {
              documentAssetId: asset.id,
              objectKey: asset.objectKey,
              type: "raw-object",
            },
            type: "size-mismatch",
          });
        }
      }

      return KnowledgeFsckReportSchema.parse({
        ...(listed.nextCursor ? { cursor: encodeAssetCursor(listed.nextCursor) } : {}),
        issues,
        knowledgeSpaceId,
        scannedAt: now(),
        summary: summarizeIssues(issues, listed.items.length),
        tenantId,
      });
    },
  };
}

export function createKnowledgeFsArtifactSegmentFsckChecker({
  artifactSegments,
  assets,
  maxAssetsPerRun,
  maxSegmentsPerArtifact,
  now = () => new Date().toISOString(),
  objectStorage,
  parseArtifacts,
}: KnowledgeFsArtifactSegmentFsckCheckerOptions): KnowledgeFsArtifactSegmentFsckChecker {
  if (!Number.isSafeInteger(maxAssetsPerRun) || maxAssetsPerRun < 1) {
    throw new Error("KnowledgeFS artifact segment fsck maxAssetsPerRun must be at least 1");
  }

  if (!Number.isSafeInteger(maxSegmentsPerArtifact) || maxSegmentsPerArtifact < 1) {
    throw new Error(
      "KnowledgeFS artifact segment fsck maxSegmentsPerArtifact must be at least 1",
    );
  }

  return {
    async check({ cursor, knowledgeSpaceId, tenantId }) {
      const decodedCursor = cursor ? decodeArtifactSegmentCursor(cursor) : {};
      const issues: KnowledgeFsckIssue[] = [];
      let scanned = 0;
      let nextCursor: ArtifactSegmentFsckCursor | undefined;

      if (decodedCursor.activeAssetId) {
        const asset = await assets.get({
          id: decodedCursor.activeAssetId,
          knowledgeSpaceId,
        });

        if (asset) {
          const artifact = await parseArtifacts.getByDocumentVersion({
            documentAssetId: asset.id,
            version: asset.version,
          });

          if (artifact) {
            const result = await checkArtifactSegments({
              artifactHash: artifact.artifactHash,
              artifactId: artifact.id,
              cursor: decodedCursor.activeSegmentCursor,
              documentAssetId: asset.id,
              knowledgeSpaceId,
              limit: maxSegmentsPerArtifact,
              objectStorage,
              repository: artifactSegments,
            });
            issues.push(...result.issues);
            scanned += result.scanned;

            if (result.nextSegmentCursor !== undefined) {
              nextCursor = {
                activeAssetId: asset.id,
                activeSegmentCursor: result.nextSegmentCursor,
              };
            } else {
              nextCursor = {
                assetCursor: { id: asset.id },
              };
            }
          }
        }
      } else {
        const listed = await assets.list({
          cursor: decodedCursor.assetCursor,
          knowledgeSpaceId,
          limit: maxAssetsPerRun,
        });

        for (const asset of listed.items) {
          const artifact = await parseArtifacts.getByDocumentVersion({
            documentAssetId: asset.id,
            version: asset.version,
          });

          if (!artifact) {
            issues.push({
              code: "parse-artifact-missing",
              message: "Parse artifact is missing for the document asset version",
              repairability: "manual",
              severity: "error",
              target: {
                documentAssetId: asset.id,
                type: "artifact-object",
              },
              type: "missing-artifact-object",
            });
            continue;
          }

          const result = await checkArtifactSegments({
            artifactHash: artifact.artifactHash,
            artifactId: artifact.id,
            documentAssetId: asset.id,
            knowledgeSpaceId,
            limit: maxSegmentsPerArtifact,
            objectStorage,
            repository: artifactSegments,
          });
          issues.push(...result.issues);
          scanned += result.scanned;

          if (result.nextSegmentCursor !== undefined) {
            nextCursor = {
              activeAssetId: asset.id,
              activeSegmentCursor: result.nextSegmentCursor,
            };
            break;
          }
        }

        if (!nextCursor && listed.nextCursor) {
          nextCursor = { assetCursor: listed.nextCursor };
        }
      }

      return KnowledgeFsckReportSchema.parse({
        ...(nextCursor ? { cursor: encodeArtifactSegmentCursor(nextCursor) } : {}),
        issues,
        knowledgeSpaceId,
        scannedAt: now(),
        summary: summarizeIssues(issues, scanned),
        tenantId,
      });
    },
  };
}

export function createKnowledgeFsReferenceFsckChecker({
  assets,
  maxNodesPerRun,
  maxPathsPerView,
  maxProjectionsPerType,
  nodes,
  now = () => new Date().toISOString(),
  parseArtifacts,
  paths,
  pathViewNames,
  projections,
  projectionTypes,
}: KnowledgeFsReferenceFsckCheckerOptions): KnowledgeFsReferenceFsckChecker {
  validatePositiveLimit("maxPathsPerView", maxPathsPerView);
  validatePositiveLimit("maxNodesPerRun", maxNodesPerRun);
  validatePositiveLimit("maxProjectionsPerType", maxProjectionsPerType);

  return {
    async check({ knowledgeSpaceId, tenantId }) {
      const issues: KnowledgeFsckIssue[] = [];
      let scanned = 0;

      for (const viewName of pathViewNames) {
        const listedPaths = await paths.listPhysicalView({
          knowledgeSpaceId,
          limit: maxPathsPerView,
          viewName,
        });
        scanned += listedPaths.items.length;

        for (const path of listedPaths.items) {
          if (await pathTargetExists({ assets, nodes, parseArtifacts, path })) {
            continue;
          }

          issues.push({
            code: "knowledge-path-target-missing",
            message: "KnowledgeFS path target does not exist",
            repairability: "manual",
            severity: "error",
            target: {
              id: path.id,
              type: "knowledge-path",
              virtualPath: path.virtualPath,
            },
            type: "broken-path-target",
          });
        }
      }

      const listedNodes = await nodes.listBySpace({
        knowledgeSpaceId,
        limit: maxNodesPerRun,
      });
      scanned += listedNodes.items.length;

      for (const node of listedNodes.items) {
        const [asset, artifact] = await Promise.all([
          assets.get({
            id: node.documentAssetId,
            knowledgeSpaceId,
          }),
          parseArtifacts.getById({
            id: node.parseArtifactId,
          }),
        ]);

        if (asset && artifact && artifact.artifactHash === node.artifactHash) {
          continue;
        }

        issues.push({
          code: "knowledge-node-target-missing",
          message: "Knowledge node target document asset or parse artifact is missing",
          repairability: "manual",
          severity: "error",
          target: {
            documentAssetId: node.documentAssetId,
            id: node.id,
            parseArtifactId: node.parseArtifactId,
            type: "knowledge-node",
          },
          type: "missing-node-target",
        });
      }

      for (const type of projectionTypes) {
        const listedProjections = await projections.listReadyBySpace({
          knowledgeSpaceId,
          limit: maxProjectionsPerType,
          type,
        });
        scanned += listedProjections.items.length;

        for (const projection of listedProjections.items) {
          const node = await nodes.get({
            id: projection.nodeId,
            knowledgeSpaceId,
          });

          if (node) {
            continue;
          }

          issues.push({
            code: "index-projection-node-missing",
            message: "Ready index projection points to a missing knowledge node",
            repairability: "manual",
            severity: "error",
            target: {
              id: projection.id,
              type: "index-projection",
            },
            type: "stale-projection",
          });
        }
      }

      return KnowledgeFsckReportSchema.parse({
        issues,
        knowledgeSpaceId,
        scannedAt: now(),
        summary: summarizeIssues(issues, scanned),
        tenantId,
      });
    },
  };
}

async function checkArtifactSegments({
  artifactHash,
  artifactId,
  cursor,
  documentAssetId,
  knowledgeSpaceId,
  limit,
  objectStorage,
  repository,
}: {
  readonly artifactHash: string;
  readonly artifactId: string;
  readonly cursor?: number | undefined;
  readonly documentAssetId: string;
  readonly knowledgeSpaceId: string;
  readonly limit: number;
  readonly objectStorage: PlatformAdapter["objectStorage"];
  readonly repository: ArtifactSegmentRepository;
}): Promise<{
  readonly issues: readonly KnowledgeFsckIssue[];
  readonly nextSegmentCursor?: number | undefined;
  readonly scanned: number;
}> {
  const listed = await repository.listByArtifact({
    ...(cursor === undefined ? {} : { cursor }),
    knowledgeSpaceId,
    limit,
    parseArtifactId: artifactId,
  });
  const issues: KnowledgeFsckIssue[] = [];

  for (const segment of listed.items) {
    if (segment.artifactHash !== artifactHash) {
      issues.push({
        code: "segment-artifact-hash-mismatch",
        message: "Artifact segment hash does not match its parse artifact",
        repairability: "manual",
        severity: "error",
        target: {
          documentAssetId,
          id: segment.id,
          parseArtifactId: artifactId,
          type: "artifact-segment",
        },
        type: "segment-hash-mismatch",
      });
    }

    if (segment.inlineText !== undefined) {
      const checksum = await sha256Hex(new TextEncoder().encode(segment.inlineText));

      if (checksum !== segment.checksum) {
        issues.push({
          code: "inline-segment-checksum-mismatch",
          message: "Inline artifact segment checksum does not match its content",
          repairability: "manual",
          severity: "error",
          target: {
            documentAssetId,
            id: segment.id,
            parseArtifactId: artifactId,
            type: "artifact-segment",
          },
          type: "segment-hash-mismatch",
        });
      }
    }

    if (segment.objectKey !== undefined) {
      const objectMetadata = await objectStorage.headObject(segment.objectKey);

      if (!objectMetadata) {
        issues.push({
          code: "artifact-segment-object-missing",
          message: "Artifact segment object is missing",
          repairability: "manual",
          severity: "error",
          target: {
            documentAssetId,
            id: segment.id,
            objectKey: segment.objectKey,
            parseArtifactId: artifactId,
            type: "artifact-segment",
          },
          type: "missing-artifact-object",
        });
        continue;
      }

      if (objectMetadata.metadata.sha256 && objectMetadata.metadata.sha256 !== segment.checksum) {
        issues.push({
          code: "artifact-segment-object-checksum-mismatch",
          message: "Artifact segment object checksum does not match segment metadata",
          repairability: "manual",
          severity: "error",
          target: {
            documentAssetId,
            id: segment.id,
            objectKey: segment.objectKey,
            parseArtifactId: artifactId,
            type: "artifact-segment",
          },
          type: "segment-hash-mismatch",
        });
      }

      if (segment.sizeBytes !== undefined && objectMetadata.sizeBytes !== segment.sizeBytes) {
        issues.push({
          code: "artifact-segment-object-size-mismatch",
          message: "Artifact segment object size does not match segment metadata",
          repairability: "manual",
          severity: "warning",
          target: {
            documentAssetId,
            id: segment.id,
            objectKey: segment.objectKey,
            parseArtifactId: artifactId,
            type: "artifact-segment",
          },
          type: "size-mismatch",
        });
      }
    }
  }

  return {
    issues,
    ...(listed.nextCursor !== undefined ? { nextSegmentCursor: listed.nextCursor } : {}),
    scanned: listed.items.length,
  };
}

function summarizeIssues(
  issues: readonly KnowledgeFsckIssue[],
  scanned: number,
): KnowledgeFsckReport["summary"] {
  return {
    critical: issues.filter((issue) => issue.severity === "critical").length,
    error: issues.filter((issue) => issue.severity === "error").length,
    info: issues.filter((issue) => issue.severity === "info").length,
    repairable: issues.filter((issue) => issue.repairability === "auto-repairable").length,
    scanned,
    warning: issues.filter((issue) => issue.severity === "warning").length,
  };
}

async function pathTargetExists({
  assets,
  nodes,
  parseArtifacts,
  path,
}: {
  readonly assets: DocumentAssetRepository;
  readonly nodes: KnowledgeNodeRepository;
  readonly parseArtifacts: ParseArtifactRepository;
  readonly path: KnowledgePath;
}): Promise<boolean> {
  switch (path.resourceType) {
    case "document":
      return Boolean(
        await assets.get({
          id: path.targetId,
          knowledgeSpaceId: path.knowledgeSpaceId,
        }),
      );
    case "node":
      return Boolean(
        await nodes.get({
          id: path.targetId,
          knowledgeSpaceId: path.knowledgeSpaceId,
        }),
      );
    case "artifact":
      return Boolean(await parseArtifacts.getById({ id: path.targetId }));
    default:
      return true;
  }
}

function validatePositiveLimit(label: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`KnowledgeFS reference fsck ${label} must be at least 1`);
  }
}

function encodeAssetCursor(cursor: DocumentAssetCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeAssetCursor(cursor: string): DocumentAssetCursor {
  try {
    const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
      id?: unknown;
    };

    if (typeof decoded.id === "string") {
      return { id: decoded.id };
    }
  } catch {
    // Fall through to the stable validation error below.
  }

  throw new Error("KnowledgeFS raw object fsck cursor is invalid");
}

interface ArtifactSegmentFsckCursor {
  readonly activeAssetId?: string | undefined;
  readonly activeSegmentCursor?: number | undefined;
  readonly assetCursor?: DocumentAssetCursor | undefined;
}

function encodeArtifactSegmentCursor(cursor: ArtifactSegmentFsckCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeArtifactSegmentCursor(cursor: string): ArtifactSegmentFsckCursor {
  try {
    const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
      activeAssetId?: unknown;
      activeSegmentCursor?: unknown;
      assetCursor?: { id?: unknown };
    };

    return {
      ...(typeof decoded.activeAssetId === "string"
        ? { activeAssetId: decoded.activeAssetId }
        : {}),
      ...(typeof decoded.activeSegmentCursor === "number"
        ? { activeSegmentCursor: decoded.activeSegmentCursor }
        : {}),
      ...(typeof decoded.assetCursor?.id === "string"
        ? { assetCursor: { id: decoded.assetCursor.id } }
        : {}),
    };
  } catch {
    // Fall through to the stable validation error below.
  }

  throw new Error("KnowledgeFS artifact segment fsck cursor is invalid");
}
