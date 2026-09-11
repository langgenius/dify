import { type OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
  AgentInvestigationConflictError,
  AgentKnowledgeInvestigationSchema,
  type createAgentKnowledgeInvestigationService,
} from "./agent-knowledge-investigation";
import { currentCandidateGrants } from "./candidate-content-authorization";
import { AGENT_INVESTIGATION_CAPTURE_ACTION } from "./failed-query-repository";
import type { KnowledgeGatewayEnv } from "./gateway-openapi-contracts";
import { ErrorResponseSchema } from "./gateway-route-schemas";
import type { KnowledgeSpaceRepository } from "./knowledge-space-repository";

const captureErrorResponse = {
  description: "Investigation unavailable",
  content: { "application/json": { schema: ErrorResponseSchema } },
};

export const captureAgentKnowledgeInvestigationRoute = createRoute({
  method: "post",
  operationId: "captureAgentKnowledgeInvestigation",
  path: "/knowledge-spaces/{id}/agent-investigations",
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: {
      required: true,
      content: { "application/json": { schema: AgentKnowledgeInvestigationSchema } },
    },
  },
  responses: {
    200: {
      description: "Investigation recorded and classified once",
      content: {
        "application/json": {
          schema: z.object({
            traceId: z.string().uuid(),
            outcome: z.string(),
            records: z.array(
              z.object({
                failedQueryId: z.string().uuid(),
                badCaseId: z.string().uuid().optional(),
                verdict: z.string(),
              }),
            ),
          }),
        },
      },
    },
    403: captureErrorResponse,
    404: captureErrorResponse,
    409: captureErrorResponse,
    503: captureErrorResponse,
  },
});

export function registerAgentKnowledgeInvestigationHandlers(options: {
  app: OpenAPIHono<KnowledgeGatewayEnv>;
  spaces: Pick<KnowledgeSpaceRepository, "get">;
  service?: ReturnType<typeof createAgentKnowledgeInvestigationService> | undefined;
}) {
  options.app.openapi(captureAgentKnowledgeInvestigationRoute, async (context) => {
    const subject = context.get("subject");
    const knowledgeSpaceId = context.req.valid("param").id;
    const grant = context.get("capabilityV2Grant");
    if (
      !grant ||
      !["agent", "workflow", "interactive"].includes(grant.callerKind) ||
      grant.action !== AGENT_INVESTIGATION_CAPTURE_ACTION ||
      grant.namespaceId !== subject.tenantId ||
      grant.subject !== subject.subjectId ||
      grant.resource.type !== "knowledge_space" ||
      grant.resource.id !== knowledgeSpaceId ||
      grant.resource.parent_id !== null
    ) {
      return context.json({ error: "Agent investigation capability required" }, 403);
    }
    if (!(await options.spaces.get({ id: knowledgeSpaceId, tenantId: subject.tenantId }))) {
      return context.json({ error: "Knowledge space not found" }, 404);
    }
    const candidateGrants = currentCandidateGrants({
      capabilityGrant: grant,
      decision: context.get("authorizationDecision"),
      knowledgeSpaceId,
      subject,
    });
    if (!candidateGrants || !options.service)
      return context.json({ error: "Investigation runtime unavailable" }, 503);
    if (
      context.req
        .valid("json")
        .attempts.some((attempt) => attempt.control_space_id !== grant.controlSpaceId)
    ) {
      return context.json({ error: "Investigation contains another knowledge space" }, 403);
    }
    try {
      return context.json(
        await options.service.capture({
          ...context.req.valid("json"),
          tenantId: subject.tenantId,
          knowledgeSpaceId,
          actorSubjectId: subject.subjectId,
          capabilityGrantId: grant.grantId,
          candidateGrants,
        }),
        200,
      );
    } catch (error) {
      if (error instanceof AgentInvestigationConflictError)
        return context.json({ error: error.message }, 409);
      return context.json({ error: "Investigation capture unavailable" }, 503);
    }
  });
}
