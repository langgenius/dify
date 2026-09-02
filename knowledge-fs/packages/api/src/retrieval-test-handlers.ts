import type { OpenAPIHono } from "@hono/zod-openapi";
import { validateKnowledgeSpaceRetrievalProfileForMode } from "@knowledge/core";

import { currentCandidateGrants } from "./candidate-content-authorization";
import type { KnowledgeGatewayEnv } from "./gateway-openapi-contracts";
import type { KnowledgeSpaceRepository } from "./knowledge-space-repository";
import {
  ModelCapabilitySnapshotSchema,
  type ModelInputModality,
} from "./model-capability-preflight";
import type { ModelInputModalityResolver } from "./model-input-modality-resolver";
import type { PublishedKnowledgeSpaceRuntimeSnapshotResolver } from "./published-knowledge-space-runtime-snapshot";
import { PublishedProjectionReadUnavailableError } from "./published-projection-read-snapshot";
import {
  KNOWLEDGE_FS_QUERY_IMAGE_GRANTS_HEADER,
  QueryImageResolutionError,
  type QueryImageResolutionReference,
  type QueryImageResolver,
  queryImageResolutionReferencesFromHeader,
} from "./query-images";
import {
  RetrievalExecutionAdmissionError,
  type RetrievalExecutionLeaseCoordinator,
  RetrievalExecutionLeaseLostError,
} from "./retrieval-execution-lease";
import { normalizeRetrievalMetadataFilters } from "./retrieval-filter-utils";
import {
  type RetrievalTestExecutor,
  RetrievalTestUnavailableError,
  assertRetrievalTestRuntimeCapabilities,
} from "./retrieval-test";
import { RetrievalTestResponseSchema, runRetrievalTestRoute } from "./retrieval-test-routes";

const RETRIEVAL_TEST_UNAVAILABLE = "Published retrieval test is unavailable";

export interface RegisterRetrievalTestHandlersOptions {
  readonly app: OpenAPIHono<KnowledgeGatewayEnv>;
  readonly executor?: RetrievalTestExecutor | undefined;
  readonly modelInputModalityResolver?: ModelInputModalityResolver | undefined;
  readonly queryImageResolver?: QueryImageResolver | undefined;
  readonly retrievalExecutionLeases?: RetrievalExecutionLeaseCoordinator | undefined;
  readonly runtimeSnapshotResolver?: PublishedKnowledgeSpaceRuntimeSnapshotResolver | undefined;
  readonly spaces: Pick<KnowledgeSpaceRepository, "get">;
}

export function registerRetrievalTestHandlers({
  app,
  executor,
  modelInputModalityResolver,
  queryImageResolver,
  retrievalExecutionLeases,
  runtimeSnapshotResolver,
  spaces,
}: RegisterRetrievalTestHandlersOptions): void {
  app.openapi(runRetrievalTestRoute, async (context) => {
    const subject = context.get("subject");
    const knowledgeSpaceId = context.req.valid("param").id;
    const body = context.req.valid("json");
    const space = await spaces.get({ id: knowledgeSpaceId, tenantId: subject.tenantId });
    if (!space) {
      return context.json({ error: "Knowledge space not found" }, 404);
    }

    const permissionScope = currentCandidateGrants({
      capabilityGrant: context.get("capabilityV2Grant"),
      decision: context.get("authorizationDecision"),
      knowledgeSpaceId,
      subject,
    });
    if (!permissionScope || !executor || !runtimeSnapshotResolver || !retrievalExecutionLeases) {
      return context.json(
        { code: "RETRIEVAL_TEST_UNAVAILABLE", error: RETRIEVAL_TEST_UNAVAILABLE },
        503,
      );
    }

    const traceId = context.get("traceId");
    let executionLease: Awaited<ReturnType<RetrievalExecutionLeaseCoordinator["acquire"]>>;
    try {
      executionLease = await retrievalExecutionLeases.acquire({
        knowledgeSpaceId,
        subjectId: subject.subjectId,
        tenantId: subject.tenantId,
        traceId,
      });
    } catch (error) {
      if (error instanceof RetrievalExecutionAdmissionError) {
        return context.json({ code: error.code, error: error.message }, 409);
      }
      return context.json(
        { code: "RETRIEVAL_TEST_UNAVAILABLE", error: RETRIEVAL_TEST_UNAVAILABLE },
        503,
      );
    }

    try {
      let runtimeSnapshot: Awaited<
        ReturnType<PublishedKnowledgeSpaceRuntimeSnapshotResolver["resolve"]>
      >;
      try {
        runtimeSnapshot = await runtimeSnapshotResolver.resolve({
          knowledgeSpaceId,
          tenantId: subject.tenantId,
        });
      } catch {
        return context.json(
          { code: "RETRIEVAL_TEST_UNAVAILABLE", error: RETRIEVAL_TEST_UNAVAILABLE },
          503,
        );
      }

      const mode = body.mode ?? runtimeSnapshot.retrievalProfile.defaultMode;
      const profileError = validateKnowledgeSpaceRetrievalProfileForMode(
        runtimeSnapshot.retrievalProfile,
        mode,
      );
      if (profileError) {
        return context.json(
          {
            code: profileError.code,
            error: profileError.message,
            mode: profileError.mode,
          },
          400,
        );
      }

      try {
        assertRetrievalTestRuntimeCapabilities({
          ...(runtimeSnapshot.embeddingCapabilitySnapshot
            ? { embeddingCapabilitySnapshot: runtimeSnapshot.embeddingCapabilitySnapshot }
            : {}),
          ...(runtimeSnapshot.embeddingProfile
            ? { embeddingProfile: runtimeSnapshot.embeddingProfile }
            : {}),
          mode,
          retrievalCapabilitySnapshot: runtimeSnapshot.retrievalCapabilitySnapshot,
          retrievalProfile: runtimeSnapshot.retrievalProfile,
        });
        await runtimeSnapshotResolver.assertReady({
          knowledgeSpaceId,
          resolvedMode: mode,
          tenantId: subject.tenantId,
        });
        await executionLease.assertActive();
        const executionSignal = AbortSignal.any([executionLease.signal, context.req.raw.signal]);
        let queryImageReferences: readonly QueryImageResolutionReference[];
        try {
          queryImageReferences = queryImageResolutionReferencesFromHeader({
            encodedGrants: context.req.header(KNOWLEDGE_FS_QUERY_IMAGE_GRANTS_HEADER),
            references: body.queryImages,
            subjectId: subject.subjectId,
          });
        } catch (error) {
          if (error instanceof QueryImageResolutionError) {
            return context.json({ code: error.code, error: error.message }, error.status);
          }
          throw error;
        }
        const [embeddingInputModalities, reasoningInputModalities] = modelInputModalityResolver
          ? await Promise.all([
              modelInputModalityResolver.resolve({
                signal: executionSignal,
                snapshot: runtimeSnapshot.embeddingCapabilitySnapshot,
                tenantId: subject.tenantId,
              }),
              modelInputModalityResolver.resolve({
                signal: executionSignal,
                snapshot: runtimeSnapshot.retrievalCapabilitySnapshot.reasoning,
                tenantId: subject.tenantId,
              }),
            ])
          : [
              snapshotInputModalities(runtimeSnapshot.embeddingCapabilitySnapshot),
              snapshotInputModalities(runtimeSnapshot.retrievalCapabilitySnapshot.reasoning),
            ];
        let resolvedQueryImages: Awaited<ReturnType<QueryImageResolver["resolve"]>> = [];
        const spaceUsesQueryImageBytes =
          embeddingInputModalities.includes("image") || reasoningInputModalities.includes("image");
        if (body.queryImages.length > 0 && spaceUsesQueryImageBytes) {
          if (!queryImageResolver) {
            return context.json(
              {
                code: "QUERY_IMAGE_RESOLVER_UNAVAILABLE",
                error: "Query image resolution is unavailable",
              },
              503,
            );
          }
          try {
            resolvedQueryImages = await queryImageResolver.resolve({
              references: queryImageReferences,
              signal: executionSignal,
              subjectId: subject.subjectId,
              tenantId: subject.tenantId,
            });
          } catch (error) {
            if (error instanceof QueryImageResolutionError) {
              return context.json({ code: error.code, error: error.message }, error.status);
            }
            throw error;
          }
        }

        const result = await executor.execute({
          ...(runtimeSnapshot.embeddingProfile
            ? { embeddingProfile: runtimeSnapshot.embeddingProfile }
            : {}),
          embeddingInputModalities,
          knowledgeSpaceId,
          ...(body.filters ? { filters: normalizeRetrievalMetadataFilters(body.filters) } : {}),
          includeText: body.includeText,
          mode,
          permissionScope,
          projectionSnapshot: runtimeSnapshot.projectionSnapshot,
          query: body.query,
          queryImageReferenceCount: body.queryImages.length,
          ...(resolvedQueryImages.length > 0
            ? {
                queryImages: resolvedQueryImages,
              }
            : {}),
          reasoningInputModalities,
          retrievalProfile: runtimeSnapshot.retrievalProfile,
          signal: executionSignal,
          subject,
          traceId,
        });
        await executionLease.assertActive();
        const embeddingCapabilityStatus = "verified" as const;
        const rerankCapabilityStatus: "disabled" | "verified" = runtimeSnapshot.retrievalProfile
          .rerank.enabled
          ? "verified"
          : "disabled";

        const response = RetrievalTestResponseSchema.parse({
          capabilityStatus: {
            embedding: embeddingCapabilityStatus,
            reasoning: "verified" as const,
            rerank: rerankCapabilityStatus,
          },
          ...(runtimeSnapshot.embeddingProfile
            ? { embeddingProfile: runtimeSnapshot.embeddingProfile }
            : {}),
          items: result.items,
          metrics: result.metrics,
          mode,
          plan: result.plan,
          projectionSnapshot: {
            fingerprint: runtimeSnapshot.projectionSnapshot.fingerprint,
            headRevision: runtimeSnapshot.projectionSnapshot.headRevision,
            projectionVersion: runtimeSnapshot.projectionSnapshot.projectionVersion,
            publicationId: runtimeSnapshot.projectionSnapshot.publicationId,
          },
          retrievalProfile: runtimeSnapshot.retrievalProfile,
          stages: result.stages,
          traceId,
        });
        return context.json(response, 200);
      } catch (error) {
        if (error instanceof RetrievalExecutionLeaseLostError) {
          return context.json({ code: error.code, error: error.message }, 409);
        }
        if (
          error instanceof RetrievalTestUnavailableError ||
          error instanceof PublishedProjectionReadUnavailableError
        ) {
          return context.json(
            { code: "RETRIEVAL_TEST_UNAVAILABLE", error: RETRIEVAL_TEST_UNAVAILABLE },
            503,
          );
        }
        return context.json(
          { code: "RETRIEVAL_TEST_UNAVAILABLE", error: RETRIEVAL_TEST_UNAVAILABLE },
          503,
        );
      }
    } finally {
      await executionLease.release().catch(() => undefined);
    }
  });
}

function snapshotInputModalities(value: unknown): readonly ModelInputModality[] {
  const parsed = ModelCapabilitySnapshotSchema.safeParse(value);
  return parsed.success ? (parsed.data.inputModalities ?? ["text"]) : ["text"];
}
