import type { ParseArtifact } from "@knowledge/core";
import type { ParserRouteHints } from "@knowledge/parsers";
import { isPlainObject } from "./json-utils";
import type { KnowledgeSpaceProfileRepository } from "./knowledge-space-profile-repository";
import type { ModelInputModality } from "./model-capability-preflight";
import type { ModelInputModalityResolver } from "./model-input-modality-resolver";

export type DocumentMediaCapabilityResolver = (input: {
  readonly knowledgeSpaceId: string;
  readonly tenantId: string;
  readonly signal?: AbortSignal | undefined;
}) => Promise<{
  readonly imageExtractionEnabled: boolean;
  readonly visualEmbeddingEnabled: boolean;
}>;

/** Legacy synchronous ingestion has no publication attempt: freeze its two heads before parsing. */
export function createProfileDocumentMediaCapabilityResolver(input: {
  readonly profiles: Pick<KnowledgeSpaceProfileRepository, "getHead">;
  readonly modalities: ModelInputModalityResolver;
}): DocumentMediaCapabilityResolver {
  return async ({ knowledgeSpaceId, tenantId, signal }) => {
    signal?.throwIfAborted();
    const [embedding, retrieval] = await Promise.all([
      input.profiles.getHead({ knowledgeSpaceId, tenantId, kind: "embedding" }),
      input.profiles.getHead({ knowledgeSpaceId, tenantId, kind: "retrieval" }),
    ]);
    const [embeddingModalities, reasoningModalities] = await Promise.all([
      embedding
        ? input.modalities.resolve({
            snapshot: embedding.profile.capabilitySnapshot,
            tenantId,
            signal,
          })
        : ([] as readonly ModelInputModality[]),
      retrieval?.profile.capabilitySnapshot.reasoning
        ? input.modalities.resolve({
            snapshot: retrieval.profile.capabilitySnapshot.reasoning,
            tenantId,
            signal,
          })
        : ([] as readonly ModelInputModality[]),
    ]);
    signal?.throwIfAborted();
    const visualEmbeddingEnabled = embeddingModalities.includes("image");
    return Object.freeze({
      imageExtractionEnabled: visualEmbeddingEnabled || reasoningModalities.includes("image"),
      visualEmbeddingEnabled,
    });
  };
}

export interface DocumentMediaExecutionPlan {
  readonly version: "document-media-v1";
  readonly preserveSourceReferences: true;
  readonly materializeImages: boolean;
  readonly requestParserImages: boolean;
  readonly rasterizePdf: boolean;
  readonly generateVariants: boolean;
  readonly visualEmbedding: boolean;
}

/** Capabilities are captured once; installed tools must not override an explicit text-only profile. */
export function createDocumentMediaExecutionPlan(input: {
  readonly profileImageExtractionEnabled?: boolean | undefined;
  readonly hasPdfRasterizer: boolean;
  readonly hasImageVariantGenerator: boolean;
  readonly visualEmbeddingEnabled: boolean;
}): DocumentMediaExecutionPlan {
  const materializeImages = input.profileImageExtractionEnabled !== false;
  return Object.freeze({
    version: "document-media-v1",
    preserveSourceReferences: true,
    materializeImages,
    requestParserImages:
      input.profileImageExtractionEnabled ??
      Boolean(
        input.hasPdfRasterizer || input.hasImageVariantGenerator || input.visualEmbeddingEnabled,
      ),
    rasterizePdf: materializeImages && input.hasPdfRasterizer,
    generateVariants: materializeImages && input.hasImageVariantGenerator,
    visualEmbedding: materializeImages && input.visualEmbeddingEnabled,
  });
}

export function documentParserHints(input: {
  readonly assetMetadata: Readonly<Record<string, unknown>>;
  readonly imagesHandledExternally: boolean;
  readonly requiresImages: boolean;
}): ParserRouteHints {
  const language =
    typeof input.assetMetadata.language === "string" ? input.assetMetadata.language.trim() : "";
  const layoutComplexity =
    input.assetMetadata.layoutComplexity === "complex" ||
    input.assetMetadata.layoutComplexity === "simple"
      ? input.assetMetadata.layoutComplexity
      : undefined;
  return Object.freeze({
    imagesHandledExternally: input.imagesHandledExternally,
    ...(language ? { language } : {}),
    ...(layoutComplexity ? { layoutComplexity } : {}),
    requiresImages: input.requiresImages,
    ...(input.assetMetadata.requiresOcr === true ? { requiresOcr: true } : {}),
    ...(input.assetMetadata.requiresTables === true ? { requiresTables: true } : {}),
  });
}

export function withDocumentMediaExecutionPlan(
  artifact: ParseArtifact,
  plan: DocumentMediaExecutionPlan,
): ParseArtifact {
  const coverage = isPlainObject(artifact.metadata.parseCoverage)
    ? artifact.metadata.parseCoverage
    : {};
  return {
    ...artifact,
    metadata: {
      ...artifact.metadata,
      mediaExecutionPlan: { ...plan },
      ...(!plan.materializeImages
        ? {
            parseCoverage: {
              ...coverage,
              media: { status: "not-requested", reasons: ["profile-text-only"] },
            },
          }
        : {}),
    },
  };
}
