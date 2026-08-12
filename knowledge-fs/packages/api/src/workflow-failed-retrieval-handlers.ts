import type { OpenAPIHono } from "@hono/zod-openapi";

import { currentCandidateGrants } from "./candidate-content-authorization";
import { CapabilityPublicationFencedError } from "./capability-grant-provenance";
import {
  FailedQueryWorkflowReplayConflictError,
  WORKFLOW_FAILED_RETRIEVAL_CAPTURE_ACTION,
} from "./failed-query-repository";
import type { KnowledgeGatewayEnv } from "./gateway-openapi-contracts";
import { KnowledgeSpaceAccessError } from "./knowledge-space-access-control";
import type { KnowledgeSpaceRepository } from "./knowledge-space-repository";
import {
  type WorkflowFailedRetrievalCaptureService,
  WorkflowFailedRetrievalReplayConflictError,
} from "./workflow-failed-retrieval";
import { captureWorkflowFailedRetrievalRoute } from "./workflow-failed-retrieval-routes";

export function registerWorkflowFailedRetrievalHandlers({
  app,
  service,
  spaces,
}: {
  readonly app: OpenAPIHono<KnowledgeGatewayEnv>;
  readonly service?: WorkflowFailedRetrievalCaptureService | undefined;
  readonly spaces: Pick<KnowledgeSpaceRepository, "get">;
}): void {
  app.openapi(captureWorkflowFailedRetrievalRoute, async (context) => {
    const subject = context.get("subject");
    const knowledgeSpaceId = context.req.valid("param").id;
    const grant = context.get("capabilityV2Grant");
    if (
      !grant ||
      grant.callerKind !== "workflow" ||
      grant.action !== WORKFLOW_FAILED_RETRIEVAL_CAPTURE_ACTION ||
      grant.namespaceId !== subject.tenantId ||
      grant.subject !== subject.subjectId ||
      grant.resource.type !== "knowledge_space" ||
      grant.resource.id !== knowledgeSpaceId ||
      grant.resource.parent_id !== null
    ) {
      return context.json({ error: "Workflow failed-retrieval capability required" }, 403);
    }
    const space = await spaces.get({ id: knowledgeSpaceId, tenantId: subject.tenantId });
    if (!space) return context.json({ error: "Knowledge space not found" }, 404);
    const candidateGrants = currentCandidateGrants({
      capabilityGrant: grant,
      decision: context.get("authorizationDecision"),
      knowledgeSpaceId,
      subject,
    });
    if (!candidateGrants || !service) {
      return context.json({ error: "Workflow failed-retrieval capture unavailable" }, 503);
    }
    const body = context.req.valid("json");
    try {
      return context.json(
        await service.capture({
          actorSubjectId: subject.subjectId,
          candidateGrants,
          capabilityGrantId: grant.grantId,
          eventId: body.eventId,
          knowledgeSpaceId,
          mode: body.mode,
          query: body.query,
          retrievalTraceId: body.retrievalTraceId,
          tenantId: subject.tenantId,
        }),
        200,
      );
    } catch (error) {
      if (
        error instanceof WorkflowFailedRetrievalReplayConflictError ||
        error instanceof FailedQueryWorkflowReplayConflictError
      ) {
        return context.json({ error: error.message }, 409);
      }
      if (
        error instanceof KnowledgeSpaceAccessError ||
        error instanceof CapabilityPublicationFencedError
      ) {
        return context.json(
          { error: "Workflow failed-retrieval capability is no longer valid" },
          403,
        );
      }
      return context.json({ error: "Workflow failed-retrieval capture unavailable" }, 503);
    }
  });
}
