import { isDeepStrictEqual } from "node:util";

import type { DocumentAsset } from "@knowledge/core";

import type { CapabilityGrantProvenanceRepository } from "./capability-grant-provenance";
import { CapabilityPublicationFencedError } from "./capability-grant-provenance";
import type { DocumentAssetRepository } from "./document-asset-repository";
import type { DocumentCompilationJobStateMachine } from "./document-compilation-job";
import { buildDocumentKnowledgePath } from "./document-knowledge-paths";
import type { KnowledgePathRepository } from "./knowledge-path-repository";
import type { LogicalDocumentRepository } from "./logical-document-repository";
import {
  type UploadSessionCompletionPublisher,
  UploadSessionConflictError,
} from "./upload-session";

export interface CreateUploadSessionDocumentCompletionPublisherOptions {
  readonly assets: Pick<DocumentAssetRepository, "create" | "get">;
  readonly compilationJobs: Pick<DocumentCompilationJobStateMachine, "start"> & {
    readonly releaseDispatch: NonNullable<DocumentCompilationJobStateMachine["releaseDispatch"]>;
  };
  readonly grants: Pick<CapabilityGrantProvenanceRepository, "assertPublicationAllowed" | "get">;
  readonly logicalDocuments: Pick<
    LogicalDocumentRepository,
    "bindCompilationAttempt" | "createCandidateRevision"
  >;
  readonly now?: (() => string) | undefined;
  readonly paths: Pick<KnowledgePathRepository, "upsertMany">;
}

/**
 * Turns a verified upload object into a durable document candidate. Dispatch is deliberately
 * released only after the candidate revision is bound to the compilation attempt.
 */
export function createUploadSessionDocumentCompletionPublisher({
  assets,
  compilationJobs,
  grants,
  logicalDocuments,
  now = () => new Date().toISOString(),
  paths,
}: CreateUploadSessionDocumentCompletionPublisherOptions): UploadSessionCompletionPublisher {
  return {
    publish: async (input) => {
      const scope = {
        grantId: input.grantId,
        knowledgeSpaceId: input.knowledgeSpaceId,
        tenantId: input.tenantId,
      };
      await grants.assertPublicationAllowed(scope);
      const grant = await grants.get(scope);
      if (
        !grant ||
        grant.state !== "active" ||
        grant.action !== "upload_sessions.complete" ||
        grant.resource.type !== "upload_session" ||
        grant.resource.id !== input.uploadSessionId ||
        grant.resource.parentId !== input.knowledgeSpaceId
      ) {
        throw new CapabilityPublicationFencedError();
      }

      assertUploadObjectKey(input);
      const sha256 = canonicalSha256Hex(input.checksumSha256Base64);
      const metadata = {
        capabilityGrantId: grant.grantId,
        idempotencyKey: input.idempotencyKey,
        permissionScope: [...grant.contentScopeIds],
        tenantId: input.tenantId,
        traceId: grant.traceId,
        uploadSessionId: input.uploadSessionId,
        uploadedBy: grant.subjectId,
      };
      const asset = await createOrResolveAsset({ assets, input, metadata, sha256 });
      const timestamp = now();
      const candidate = await logicalDocuments.createCandidateRevision({
        capabilityGrantId: grant.grantId,
        contentHash: sha256,
        documentAssetId: asset.id,
        documentAssetVersion: asset.version,
        knowledgeSpaceId: input.knowledgeSpaceId,
        mimeType: input.contentType,
        now: timestamp,
        sizeBytes: input.expectedSizeBytes,
        systemMetadata: {
          provenance: {
            capabilityGrantId: grant.grantId,
            uploadSessionId: input.uploadSessionId,
          },
        },
        tenantId: input.tenantId,
        title: input.fileName,
      });

      await paths.upsertMany([
        buildDocumentKnowledgePath({
          asset,
          id: input.uploadSessionId,
          tenantId: input.tenantId,
        }),
      ]);
      const job = await compilationJobs.start({
        capabilityGrantId: grant.grantId,
        deferDispatch: true,
        documentAssetId: asset.id,
        knowledgeSpaceId: input.knowledgeSpaceId,
        tenantId: input.tenantId,
        version: asset.version,
      });
      await logicalDocuments.bindCompilationAttempt({
        attemptId: job.id,
        documentId: candidate.document.id,
        knowledgeSpaceId: input.knowledgeSpaceId,
        revision: candidate.revision.revision,
        tenantId: input.tenantId,
      });
      if (job.runState === "dispatch_pending") {
        await compilationJobs.releaseDispatch(job.id);
      }

      return {
        compilationJobId: job.id,
        documentAssetId: asset.id,
      };
    },
  };
}

async function createOrResolveAsset({
  assets,
  input,
  metadata,
  sha256,
}: {
  readonly assets: Pick<DocumentAssetRepository, "create" | "get">;
  readonly input: Parameters<UploadSessionCompletionPublisher["publish"]>[0];
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly sha256: string;
}): Promise<DocumentAsset> {
  let asset = await assets.get({
    id: input.uploadSessionId,
    knowledgeSpaceId: input.knowledgeSpaceId,
  });
  if (!asset) {
    try {
      asset = await assets.create({
        filename: input.fileName,
        id: input.uploadSessionId,
        knowledgeSpaceId: input.knowledgeSpaceId,
        metadata,
        mimeType: input.contentType,
        objectKey: input.objectKey,
        sha256,
        sizeBytes: input.expectedSizeBytes,
        tenantId: input.tenantId,
      });
    } catch (error) {
      asset = await assets.get({
        id: input.uploadSessionId,
        knowledgeSpaceId: input.knowledgeSpaceId,
      });
      if (!asset) throw error;
    }
  }

  if (
    asset.id !== input.uploadSessionId ||
    asset.knowledgeSpaceId !== input.knowledgeSpaceId ||
    asset.filename !== input.fileName ||
    asset.mimeType !== input.contentType ||
    asset.objectKey !== input.objectKey ||
    asset.sha256 !== sha256 ||
    asset.sizeBytes !== input.expectedSizeBytes ||
    !isDeepStrictEqual(asset.metadata, metadata)
  ) {
    throw new UploadSessionConflictError(
      "Upload session publication conflicts with an existing document asset",
    );
  }
  return asset;
}

function canonicalSha256Hex(checksumSha256Base64: string): string {
  if (!/^[A-Za-z0-9+/]{43}=$/u.test(checksumSha256Base64)) {
    throw new UploadSessionConflictError(
      "Upload session checksum must be canonical SHA-256 base64",
    );
  }
  const bytes = Buffer.from(checksumSha256Base64, "base64");
  if (bytes.byteLength !== 32 || bytes.toString("base64") !== checksumSha256Base64) {
    throw new UploadSessionConflictError(
      "Upload session checksum must be canonical SHA-256 base64",
    );
  }
  return bytes.toString("hex");
}

function assertUploadObjectKey(
  input: Parameters<UploadSessionCompletionPublisher["publish"]>[0],
): void {
  const expected = `namespaces/${encodeURIComponent(input.tenantId)}/spaces/${encodeURIComponent(
    input.knowledgeSpaceId,
  )}/uploads/${encodeURIComponent(input.uploadSessionId)}/source`;
  if (input.objectKey !== expected) {
    throw new UploadSessionConflictError("Upload session object key is outside its reserved scope");
  }
}
