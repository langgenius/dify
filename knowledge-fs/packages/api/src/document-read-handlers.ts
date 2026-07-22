import type { OpenAPIHono } from "@hono/zod-openapi";

import {
  CANDIDATE_VISIBILITY_SCAN_BUDGET_EXCEEDED_MESSAGE,
  CandidateVisibilityScanBudgetExceededError,
  candidatePermissionAllowsAsset,
  currentCandidateGrants,
} from "./candidate-content-authorization";
import type { DocumentAssetCursor } from "./document-asset-repository";
import type { DocumentAssetRepository } from "./document-asset-repository";
import type { DocumentMultimodalManifestBuilder } from "./document-multimodal-manifest-builder";
import type { DocumentMultimodalManifestEnhancer } from "./document-multimodal-manifest-enhancer";
import type { DocumentMultimodalManifestRepository } from "./document-multimodal-manifest-repository";
import type { DocumentOutlineRepository } from "./document-outline-repository";
import {
  getDocumentAssetRoute,
  getDocumentMultimodalAssetRoute,
  getDocumentMultimodalManifestRoute,
  getDocumentOutlineRoute,
  getParseArtifactRoute,
  listDocumentAssetsRoute,
} from "./document-read-routes";
import { DocumentOutlineResponseSchema } from "./document-response-schemas";
import type { KnowledgeGatewayEnv } from "./gateway-openapi-contracts";
import type { KnowledgeSpaceRepository } from "./knowledge-space-repository";
import type { ParseArtifactRepository } from "./parse-artifact-repository";

import type { DocumentAsset, DocumentMultimodalManifest, PlatformAdapter } from "@knowledge/core";

export interface RegisterDocumentReadHandlersOptions {
  readonly app: OpenAPIHono<KnowledgeGatewayEnv>;
  readonly artifacts: ParseArtifactRepository;
  readonly assets: DocumentAssetRepository;
  readonly multimodalManifestEnhancer?: DocumentMultimodalManifestEnhancer | undefined;
  readonly multimodalManifestBuilder: DocumentMultimodalManifestBuilder;
  readonly multimodalManifests: DocumentMultimodalManifestRepository;
  readonly objectStorage: PlatformAdapter["objectStorage"];
  readonly outlines: DocumentOutlineRepository;
  readonly spaces: KnowledgeSpaceRepository;
  /** Max bytes served from the multimodal asset route before returning 413. */
  readonly assetMaxReadBytes?: number | undefined;
}

const DEFAULT_ASSET_MAX_READ_BYTES = 25 * 1024 * 1024;
const DOCUMENT_LIST_MAX_SCAN_PAGES = 10;

// Content types safe to render inline on the API origin. Everything else (svg, html, octet-stream)
// is served as a neutral attachment so stored bytes cannot execute as script on our origin.
const INLINE_SAFE_ASSET_CONTENT_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export function registerDocumentReadHandlers({
  app,
  artifacts,
  assets,
  assetMaxReadBytes = DEFAULT_ASSET_MAX_READ_BYTES,
  multimodalManifestEnhancer,
  multimodalManifestBuilder,
  multimodalManifests,
  objectStorage,
  outlines,
  spaces,
}: RegisterDocumentReadHandlersOptions): void {
  app.openapi(listDocumentAssetsRoute, async (context) => {
    const subject = context.get("subject");
    const params = context.req.valid("param");
    const query = context.req.valid("query");
    const space = await spaces.get({
      id: params.id,
      tenantId: subject.tenantId,
    });

    if (!space) {
      return context.json({ error: "Knowledge space not found" }, 404);
    }

    const candidateGrants = currentCandidateGrants({
      capabilityGrant: context.get("capabilityV2Grant"),
      decision: context.get("authorizationDecision"),
      knowledgeSpaceId: params.id,
      subject,
    });
    if (!candidateGrants) {
      return context.json({ error: "Knowledge space access denied" }, 403);
    }

    let result: Awaited<ReturnType<typeof listReadableDocumentAssets>>;
    try {
      result = await listReadableDocumentAssets({
        ...(query.cursor ? { cursor: decodeDocumentAssetCursor(query.cursor) } : {}),
        candidateGrants,
        knowledgeSpaceId: params.id,
        limit: query.limit,
        repository: assets,
      });
    } catch (error) {
      if (error instanceof CandidateVisibilityScanBudgetExceededError) {
        return context.json(
          { code: error.code, error: CANDIDATE_VISIBILITY_SCAN_BUDGET_EXCEEDED_MESSAGE },
          503,
        );
      }
      throw error;
    }

    return context.json(
      {
        items: result.items,
        ...(result.nextCursor ? { nextCursor: encodeDocumentAssetCursor(result.nextCursor) } : {}),
      },
      200,
    );
  });

  app.openapi(getDocumentAssetRoute, async (context) => {
    const subject = context.get("subject");
    const params = context.req.valid("param");
    const space = await spaces.get({
      id: params.id,
      tenantId: subject.tenantId,
    });

    if (!space) {
      return context.json({ error: "Document asset not found" }, 404);
    }

    const candidateGrants = currentCandidateGrants({
      capabilityGrant: context.get("capabilityV2Grant"),
      decision: context.get("authorizationDecision"),
      knowledgeSpaceId: params.id,
      subject,
    });
    if (!candidateGrants) {
      return context.json({ error: "Knowledge space access denied" }, 403);
    }

    const asset = await assets.get({
      id: params.documentId,
      knowledgeSpaceId: params.id,
    });

    if (!asset || !candidatePermissionAllowsAsset(asset, candidateGrants)) {
      return context.json({ error: "Document asset not found" }, 404);
    }

    return context.json(asset, 200);
  });

  app.openapi(getParseArtifactRoute, async (context) => {
    const subject = context.get("subject");
    const params = context.req.valid("param");
    const space = await spaces.get({
      id: params.id,
      tenantId: subject.tenantId,
    });

    if (!space) {
      return context.json({ error: "Parse artifact not found" }, 404);
    }

    const candidateGrants = currentCandidateGrants({
      capabilityGrant: context.get("capabilityV2Grant"),
      decision: context.get("authorizationDecision"),
      knowledgeSpaceId: params.id,
      subject,
    });
    if (!candidateGrants) {
      return context.json({ error: "Knowledge space access denied" }, 403);
    }

    const asset = await assets.get({
      id: params.documentId,
      knowledgeSpaceId: params.id,
    });

    if (!asset || !candidatePermissionAllowsAsset(asset, candidateGrants)) {
      return context.json({ error: "Parse artifact not found" }, 404);
    }

    const artifact = await artifacts.getByDocumentVersion({
      documentAssetId: asset.id,
      version: params.version,
    });

    if (!artifact) {
      return context.json({ error: "Parse artifact not found" }, 404);
    }

    return context.json(artifact, 200);
  });

  app.openapi(getDocumentOutlineRoute, async (context) => {
    const subject = context.get("subject");
    const params = context.req.valid("param");
    const space = await spaces.get({
      id: params.id,
      tenantId: subject.tenantId,
    });

    if (!space) {
      return context.json({ error: "Document outline not found" }, 404);
    }

    const candidateGrants = currentCandidateGrants({
      capabilityGrant: context.get("capabilityV2Grant"),
      decision: context.get("authorizationDecision"),
      knowledgeSpaceId: params.id,
      subject,
    });
    if (!candidateGrants) {
      return context.json({ error: "Knowledge space access denied" }, 403);
    }

    const asset = await assets.get({
      id: params.documentId,
      knowledgeSpaceId: params.id,
    });

    if (!asset || !candidatePermissionAllowsAsset(asset, candidateGrants)) {
      return context.json({ error: "Document outline not found" }, 404);
    }

    const outline = await outlines.getByDocumentVersion({
      documentAssetId: asset.id,
      version: asset.version,
    });

    if (!outline) {
      return context.json({ error: "Document outline not found" }, 404);
    }

    return context.json(DocumentOutlineResponseSchema.parse(outline), 200);
  });

  app.openapi(getDocumentMultimodalManifestRoute, async (context) => {
    const subject = context.get("subject");
    const params = context.req.valid("param");
    const space = await spaces.get({
      id: params.id,
      tenantId: subject.tenantId,
    });

    if (!space) {
      return context.json({ error: "Document multimodal manifest not found" }, 404);
    }

    const candidateGrants = currentCandidateGrants({
      capabilityGrant: context.get("capabilityV2Grant"),
      decision: context.get("authorizationDecision"),
      knowledgeSpaceId: params.id,
      subject,
    });
    if (!candidateGrants) {
      return context.json({ error: "Knowledge space access denied" }, 403);
    }

    const asset = await assets.get({
      id: params.documentId,
      knowledgeSpaceId: params.id,
    });

    if (!asset || !candidatePermissionAllowsAsset(asset, candidateGrants)) {
      return context.json({ error: "Document multimodal manifest not found" }, 404);
    }

    const artifact = await artifacts.getByDocumentVersion({
      documentAssetId: asset.id,
      version: asset.version,
    });

    if (!artifact) {
      return context.json({ error: "Document multimodal manifest not found" }, 404);
    }

    const manifest = await buildReadableDocumentMultimodalManifest({
      artifact,
      asset,
      multimodalManifestBuilder,
      multimodalManifestEnhancer,
      multimodalManifests,
      tenantId: subject.tenantId,
    });

    return context.json(manifest, 200);
  });

  app.openapi(getDocumentMultimodalAssetRoute, async (context) => {
    const subject = context.get("subject");
    const params = context.req.valid("param");
    const query = context.req.valid("query");
    const space = await spaces.get({
      id: params.id,
      tenantId: subject.tenantId,
    });

    if (!space) {
      return context.json({ error: "Document multimodal item asset not found" }, 404);
    }

    const candidateGrants = currentCandidateGrants({
      capabilityGrant: context.get("capabilityV2Grant"),
      decision: context.get("authorizationDecision"),
      knowledgeSpaceId: params.id,
      subject,
    });
    if (!candidateGrants) {
      return context.json({ error: "Knowledge space access denied" }, 403);
    }

    const asset = await assets.get({
      id: params.documentId,
      knowledgeSpaceId: params.id,
    });

    if (!asset || !candidatePermissionAllowsAsset(asset, candidateGrants)) {
      return context.json({ error: "Document multimodal item asset not found" }, 404);
    }

    const artifact = await artifacts.getByDocumentVersion({
      documentAssetId: asset.id,
      version: asset.version,
    });

    if (!artifact) {
      return context.json({ error: "Document multimodal item asset not found" }, 404);
    }

    const manifest = await buildReadableDocumentMultimodalManifest({
      artifact,
      asset,
      multimodalManifestBuilder,
      multimodalManifestEnhancer,
      multimodalManifests,
      tenantId: subject.tenantId,
    });
    const item = manifest.items.find((candidate) => candidate.id === params.itemId);
    const rootAssetRef = item?.assetRef;
    // Own-property lookup so `__proto__`/`constructor` cannot select a prototype object.
    const assetRef = query.variant
      ? rootAssetRef?.variants && Object.hasOwn(rootAssetRef.variants, query.variant)
        ? rootAssetRef.variants[query.variant]
        : undefined
      : rootAssetRef;

    if (!item || !assetRef) {
      return context.json({ error: "Document multimodal item asset not found" }, 404);
    }

    if (!assetRef.objectKey) {
      return context.json({ error: "Document multimodal item asset is external-only" }, 409);
    }

    if (
      !isTenantKnowledgeSpaceObjectKey({
        knowledgeSpaceId: params.id,
        objectKey: assetRef.objectKey,
        tenantId: subject.tenantId,
      })
    ) {
      return context.json({ error: "Document multimodal item asset not found" }, 404);
    }

    const metadata = await objectStorage.headObject(assetRef.objectKey);

    if (!metadata) {
      return context.json({ error: "Document multimodal item asset not found" }, 404);
    }

    // Reject oversized objects before buffering the whole body into memory.
    if (metadata.sizeBytes > assetMaxReadBytes) {
      return context.json({ error: "Document multimodal item asset is too large" }, 413);
    }

    const body = await objectStorage.getObject(assetRef.objectKey);

    if (!body) {
      return context.json({ error: "Document multimodal item asset not found" }, 404);
    }

    if (body.byteLength > assetMaxReadBytes) {
      return context.json({ error: "Document multimodal item asset is too large" }, 413);
    }

    const headers = buildAssetResponseHeaders({
      contentType: assetRef.contentType ?? metadata.contentType,
      itemId: item.id,
      sizeBytes: body.byteLength,
      ...(query.variant ? { variant: query.variant } : {}),
    });

    return new Response(arrayBufferFromBytes(body), { headers, status: 200 });
  });
}

async function buildReadableDocumentMultimodalManifest({
  artifact,
  asset,
  multimodalManifestBuilder,
  multimodalManifestEnhancer,
  multimodalManifests,
  tenantId,
}: {
  readonly artifact: Parameters<DocumentMultimodalManifestBuilder["build"]>[0]["artifact"];
  readonly asset: DocumentAsset;
  readonly multimodalManifestBuilder: DocumentMultimodalManifestBuilder;
  readonly multimodalManifestEnhancer?: DocumentMultimodalManifestEnhancer | undefined;
  readonly multimodalManifests: DocumentMultimodalManifestRepository;
  readonly tenantId?: string | undefined;
}): Promise<DocumentMultimodalManifest> {
  const deterministicManifest = multimodalManifestBuilder.build({
    artifact,
    knowledgeSpaceId: asset.knowledgeSpaceId,
  });

  if (multimodalManifestEnhancer) {
    return multimodalManifestEnhancer.enhance({
      manifest: deterministicManifest,
      parseArtifact: artifact,
      ...(tenantId ? { tenantId } : {}),
    });
  }

  const persisted = await multimodalManifests.getByDocumentVersion({
    documentAssetId: asset.id,
    version: asset.version,
  });
  if (
    persisted &&
    persisted.artifactHash === artifact.artifactHash &&
    persisted.parseArtifactId === artifact.id &&
    persisted.manifestVersion === deterministicManifest.manifestVersion
  ) {
    return persisted;
  }

  // Lazily backfill documents compiled before durable manifest persistence was introduced.
  return multimodalManifests.upsert(deterministicManifest);
}

function isTenantKnowledgeSpaceObjectKey({
  knowledgeSpaceId,
  objectKey,
  tenantId,
}: {
  readonly knowledgeSpaceId: string;
  readonly objectKey: string;
  readonly tenantId: string;
}): boolean {
  return objectKey.startsWith(`${tenantId}/spaces/${knowledgeSpaceId}/`);
}

export function buildAssetResponseHeaders({
  contentType,
  itemId,
  sizeBytes,
  variant,
}: {
  readonly contentType?: string | undefined;
  readonly itemId: string;
  readonly sizeBytes: number;
  readonly variant?: string | undefined;
}): Headers {
  const normalizedType = contentType?.trim().toLowerCase();
  const inlineSafe =
    normalizedType !== undefined && INLINE_SAFE_ASSET_CONTENT_TYPES.has(normalizedType);

  return new Headers({
    "cache-control": "private, max-age=60",
    // Neutralize any inline execution regardless of the served type (defense in depth for images).
    "content-disposition": inlineSafe ? "inline" : "attachment",
    "content-length": String(sizeBytes),
    "content-security-policy": "default-src 'none'; sandbox",
    // Non-allowlisted types (svg/html/unknown) are served as an opaque download, never as their
    // stored content type, so attacker-controlled bytes cannot run as script on the API origin.
    "content-type": inlineSafe && normalizedType ? normalizedType : "application/octet-stream",
    "x-content-type-options": "nosniff",
    "x-document-multimodal-item-id": itemId,
    ...(variant ? { "x-document-multimodal-asset-variant": variant } : {}),
  });
}

function arrayBufferFromBytes(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function decodeDocumentAssetCursor(cursor: string): DocumentAssetCursor {
  return { id: cursor };
}

function encodeDocumentAssetCursor(cursor: DocumentAssetCursor): string {
  return cursor.id;
}

export async function listReadableDocumentAssets({
  candidateGrants,
  cursor,
  knowledgeSpaceId,
  limit,
  repository,
}: {
  readonly candidateGrants: readonly string[];
  readonly cursor?: DocumentAssetCursor | undefined;
  readonly knowledgeSpaceId: string;
  readonly limit: number;
  readonly repository: DocumentAssetRepository;
}): Promise<{ readonly items: DocumentAsset[]; readonly nextCursor?: DocumentAssetCursor }> {
  const readable: DocumentAsset[] = [];
  let scanCursor = cursor;
  let reachedEnd = false;

  for (let scannedPages = 0; scannedPages < DOCUMENT_LIST_MAX_SCAN_PAGES; scannedPages += 1) {
    const page = await repository.list({
      ...(scanCursor ? { cursor: scanCursor } : {}),
      knowledgeSpaceId,
      limit,
    });

    for (const asset of page.items) {
      if (candidatePermissionAllowsAsset(asset, candidateGrants)) {
        readable.push(asset);
        if (readable.length > limit) {
          break;
        }
      }
    }

    if (readable.length > limit) {
      break;
    }
    if (!page.nextCursor) {
      reachedEnd = true;
      break;
    }
    scanCursor = page.nextCursor;
  }

  const items = readable.slice(0, limit);
  const lastItem = items.at(-1);
  if (readable.length <= limit && !reachedEnd) {
    throw new CandidateVisibilityScanBudgetExceededError();
  }
  return {
    items,
    ...(readable.length > limit && lastItem ? { nextCursor: { id: lastItem.id } } : {}),
  };
}
