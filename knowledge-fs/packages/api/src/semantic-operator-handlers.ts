import type { OpenAPIHono } from "@hono/zod-openapi";

import { currentCandidateGrants } from "./candidate-content-authorization";
import type { KnowledgeGatewayEnv } from "./gateway-openapi-contracts";
import type { KnowledgeSpaceRepository } from "./knowledge-space-repository";
import {
  SemanticCandidateClosureUnavailableError,
  SemanticCandidateVisibilityDeniedError,
} from "./semantic-candidate-authorization";
import type { SemanticOperator } from "./semantic-operator-actions";
import {
  extractSemanticEntitiesRoute,
  materializeSemanticCommunitiesRoute,
  materializeTopicViewRoute,
} from "./semantic-operator-routes";

const SEMANTIC_AUTHORIZATION_UNAVAILABLE = "Semantic authorization context is unavailable";

export interface RegisterSemanticOperatorHandlersOptions {
  readonly app: OpenAPIHono<KnowledgeGatewayEnv>;
  readonly operator: SemanticOperator;
  readonly spaces: KnowledgeSpaceRepository;
}

export function registerSemanticOperatorHandlers({
  app,
  operator,
  spaces,
}: RegisterSemanticOperatorHandlersOptions): void {
  app.openapi(materializeTopicViewRoute, async (context) => {
    const subject = context.get("subject");
    const params = context.req.valid("param");
    const body = context.req.valid("json");
    const space = await spaces.get({
      id: params.id,
      tenantId: subject.tenantId,
    });

    if (!space) {
      return context.json({ error: "Knowledge space not found" }, 404);
    }
    const candidateGrants = currentCandidateGrants({
      decision: context.get("authorizationDecision"),
      knowledgeSpaceId: params.id,
      subject,
    });
    if (!candidateGrants) {
      return context.json({ error: SEMANTIC_AUTHORIZATION_UNAVAILABLE }, 503);
    }

    let result: Awaited<ReturnType<SemanticOperator["materializeTopicView"]>>;
    try {
      result = await operator.materializeTopicView({
        ...body,
        candidateGrants,
        knowledgeSpaceId: params.id,
        tenantId: subject.tenantId,
      });
    } catch (error) {
      const response = semanticAuthorizationErrorResponse(context, error);
      if (response) {
        return response;
      }
      throw error;
    }

    return context.json(
      {
        documentCount: result.documentCount,
        generatedVersion: result.generatedVersion,
        knowledgeSpaceId: result.knowledgeSpaceId,
        pathCount: result.pathCount,
        topicName: result.topicName,
        topicSlug: result.topicSlug,
      },
      200,
    );
  });

  app.openapi(extractSemanticEntitiesRoute, async (context) => {
    const subject = context.get("subject");
    const params = context.req.valid("param");
    const body = context.req.valid("json");
    const space = await spaces.get({
      id: params.id,
      tenantId: subject.tenantId,
    });

    if (!space) {
      return context.json({ error: "Knowledge space not found" }, 404);
    }
    const candidateGrants = currentCandidateGrants({
      decision: context.get("authorizationDecision"),
      knowledgeSpaceId: params.id,
      subject,
    });
    if (!candidateGrants) {
      return context.json({ error: SEMANTIC_AUTHORIZATION_UNAVAILABLE }, 503);
    }

    let result: Awaited<ReturnType<SemanticOperator["extractEntities"]>>;
    try {
      result = await operator.extractEntities({
        ...body,
        candidateGrants,
        knowledgeSpaceId: params.id,
        tenantId: subject.tenantId,
        traceId: context.get("traceId"),
      });
    } catch (error) {
      const response = semanticAuthorizationErrorResponse(context, error);
      if (response) {
        return response;
      }
      if (isSemanticConfigurationError(error)) {
        return context.json({ error: error.message }, 400);
      }
      throw error;
    }

    return context.json(result, 200);
  });

  app.openapi(materializeSemanticCommunitiesRoute, async (context) => {
    const subject = context.get("subject");
    const params = context.req.valid("param");
    const body = context.req.valid("json");
    const space = await spaces.get({
      id: params.id,
      tenantId: subject.tenantId,
    });

    if (!space) {
      return context.json({ error: "Knowledge space not found" }, 404);
    }
    const candidateGrants = currentCandidateGrants({
      decision: context.get("authorizationDecision"),
      knowledgeSpaceId: params.id,
      subject,
    });
    if (!candidateGrants) {
      return context.json({ error: SEMANTIC_AUTHORIZATION_UNAVAILABLE }, 503);
    }

    let result: Awaited<ReturnType<SemanticOperator["materializeCommunities"]>>;
    try {
      result = await operator.materializeCommunities({
        ...body,
        candidateGrants,
        knowledgeSpaceId: params.id,
        tenantId: subject.tenantId,
      });
    } catch (error) {
      const response = semanticAuthorizationErrorResponse(context, error);
      if (response) {
        return response;
      }
      throw error;
    }

    return context.json(
      {
        communityCount: result.communityCount,
        documentCount: result.documentCount,
        entityCount: result.entityCount,
        generatedVersion: result.generatedVersion,
        knowledgeSpaceId: result.knowledgeSpaceId,
        pathCount: result.pathCount,
      },
      200,
    );
  });
}

function isSemanticConfigurationError(error: unknown): error is Error {
  return (
    error instanceof Error &&
    error.message === "Semantic entity extraction requires an LLM provider"
  );
}

function semanticAuthorizationErrorResponse(
  context: Parameters<Parameters<RegisterSemanticOperatorHandlersOptions["app"]["openapi"]>[1]>[0],
  error: unknown,
) {
  if (error instanceof SemanticCandidateVisibilityDeniedError) {
    return context.json({ error: error.message }, 403);
  }
  if (error instanceof SemanticCandidateClosureUnavailableError) {
    return context.json({ error: error.message }, 503);
  }
  return null;
}
