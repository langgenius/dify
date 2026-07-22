import type { DocumentAssetRepository } from "./document-asset-repository";
import {
  type KnowledgeSpaceManifestLookupInput,
  type KnowledgeSpaceManifestRepository,
  freezeKnowledgeSpaceEmbeddingProfile,
} from "./knowledge-space-manifest-repository";

export interface EmbeddingProfileFreezingDocumentAssetRepositoryOptions {
  readonly assets: DocumentAssetRepository;
  readonly ensureManifest?:
    | ((input: KnowledgeSpaceManifestLookupInput) => Promise<void>)
    | undefined;
  readonly manifests: KnowledgeSpaceManifestRepository;
  readonly now?: () => string;
}

export class DocumentAssetTenantContextRequiredError extends Error {
  constructor() {
    super("Document asset create requires a non-empty authenticated tenantId context");
    this.name = "DocumentAssetTenantContextRequiredError";
  }
}

export class DocumentAssetKnowledgeSpaceManifestNotFoundError extends Error {
  readonly knowledgeSpaceId: string;
  readonly tenantId: string;

  constructor({ knowledgeSpaceId, tenantId }: { knowledgeSpaceId: string; tenantId: string }) {
    super(
      `Cannot admit document asset because no manifest exists for tenantId=${tenantId} ` +
        `knowledgeSpaceId=${knowledgeSpaceId}`,
    );
    this.name = "DocumentAssetKnowledgeSpaceManifestNotFoundError";
    this.knowledgeSpaceId = knowledgeSpaceId;
    this.tenantId = tenantId;
  }
}

/**
 * Decorates only asset creation. Reads and lifecycle mutations remain exact pass-through methods.
 * The tenant is accepted only from the explicit authenticated admission context. The delegate
 * strips this non-persisted field when it validates or serializes the asset.
 */
export function createEmbeddingProfileFreezingDocumentAssetRepository({
  assets,
  ensureManifest,
  manifests,
  now = () => new Date().toISOString(),
}: EmbeddingProfileFreezingDocumentAssetRepositoryOptions): DocumentAssetRepository {
  return {
    ...assets,
    create: async (input) => {
      const rawTenantId = input.tenantId;
      const tenantId = typeof rawTenantId === "string" ? rawTenantId.trim() : "";

      if (!Object.hasOwn(input, "tenantId") || tenantId.length === 0) {
        throw new DocumentAssetTenantContextRequiredError();
      }

      const scope = {
        knowledgeSpaceId: input.knowledgeSpaceId,
        tenantId,
      };
      let frozenAt = await freezeKnowledgeSpaceEmbeddingProfile(manifests, { ...scope, now });

      if (!frozenAt && ensureManifest) {
        await ensureManifest(scope);
        frozenAt = await freezeKnowledgeSpaceEmbeddingProfile(manifests, { ...scope, now });
      }

      if (!frozenAt) {
        throw new DocumentAssetKnowledgeSpaceManifestNotFoundError({
          knowledgeSpaceId: input.knowledgeSpaceId,
          tenantId,
        });
      }

      return assets.create(input);
    },
  };
}
