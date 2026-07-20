import type { OpenAPIHono } from "@hono/zod-openapi";
import { validateKnowledgeSpaceRetrievalProfileForMode } from "@knowledge/core";

import { currentCandidateGrants } from "./candidate-content-authorization";
import type { KnowledgeGatewayEnv } from "./gateway-openapi-contracts";
import type { KnowledgeSpaceRepository } from "./knowledge-space-repository";
import type { PublishedKnowledgeSpaceRuntimeSnapshotResolver } from "./published-knowledge-space-runtime-snapshot";
import { PublishedProjectionReadUnavailableError } from "./published-projection-read-snapshot";
import {
  RetrievalExecutionAdmissionError,
  type RetrievalExecutionLeaseCoordinator,
  RetrievalExecutionLeaseLostError,
} from "./retrieval-execution-lease";
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
  readonly retrievalExecutionLeases?: RetrievalExecutionLeaseCoordinator | undefined;
  readonly runtimeSnapshotResolver?: PublishedKnowledgeSpaceRuntimeSnapshotResolver | undefined;
  readonly spaces: Pick<KnowledgeSpaceRepository, "get">;
}

export function registerRetrievalTestHandlers({
  app,
  executor,
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

        const result = await executor.execute({
          ...(runtimeSnapshot.embeddingProfile
            ? { embeddingProfile: runtimeSnapshot.embeddingProfile }
            : {}),
          knowledgeSpaceId,
          mode,
          permissionScope,
          projectionSnapshot: runtimeSnapshot.projectionSnapshot,
          query: body.query,
          retrievalProfile: runtimeSnapshot.retrievalProfile,
          signal: executionLease.signal,
          subject,
          traceId,
        });
        await executionLease.assertActive();
        const embeddingCapabilityStatus: "not-required" | "verified" =
          mode === "research" ? "not-required" : "verified";
        const rerankCapabilityStatus: "disabled" | "not-required" | "verified" = !runtimeSnapshot
          .retrievalProfile.rerank.enabled
          ? "disabled"
          : mode === "research"
            ? "not-required"
            : "verified";

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
