import type { OpenAPIHono } from "@hono/zod-openapi";
import type { CommandRegistry } from "@knowledge/core";

import {
  CANDIDATE_VISIBILITY_SCAN_BUDGET_EXCEEDED_MESSAGE,
  CandidateVisibilityScanBudgetExceededError,
  currentCandidateGrants,
} from "./candidate-content-authorization";
import { DeletionLifecycleFenceActiveError } from "./deletion-lifecycle-fence";
import { DeletionObjectWriteAdmissionError } from "./deletion-object-write-admission";
import { KnowledgeFsUnavailableError } from "./gateway-defaults";
import type { KnowledgeGatewayEnv } from "./gateway-openapi-contracts";
import { KnowledgeFsNotFoundError, KnowledgeFsValidationError } from "./knowledge-fs-errors";
import {
  appendKnowledgeFsRoute,
  catKnowledgeFsRoute,
  diffKnowledgeFsRoute,
  findKnowledgeFsRoute,
  grepKnowledgeFsRoute,
  listKnowledgeFsRoute,
  openNodeKnowledgeFsRoute,
  statKnowledgeFsRoute,
  treeKnowledgeFsRoute,
  writeKnowledgeFsRoute,
} from "./knowledge-fs-routes";
import type {
  KnowledgeFsCatResult,
  KnowledgeFsDiffResult,
  KnowledgeFsGrepResult,
  KnowledgeFsListResult,
  KnowledgeFsOpenNodeResult,
  KnowledgeFsStatResult,
  KnowledgeFsTreeResult,
  KnowledgeFsWriteResult,
} from "./knowledge-fs-types";
import { KnowledgePathListLimitExceededError } from "./knowledge-path-repository";
import type { KnowledgeSpaceRepository } from "./knowledge-space-repository";
import {
  KnowledgeSpaceDocumentMutationLeaseActiveError,
  LegacySpacePublicationBootstrapAdmissionError,
} from "./legacy-space-publication-bootstrap";

export interface RegisterKnowledgeFsHandlersOptions {
  readonly app: OpenAPIHono<KnowledgeGatewayEnv>;
  readonly fsCommands: CommandRegistry;
  readonly spaces: KnowledgeSpaceRepository;
}

export function registerKnowledgeFsHandlers({
  app,
  fsCommands,
  spaces,
}: RegisterKnowledgeFsHandlersOptions): void {
  app.openapi(listKnowledgeFsRoute, async (context) => {
    try {
      const subject = context.get("subject");
      const params = context.req.valid("param");
      const space = await spaces.get({
        id: params.id,
        tenantId: subject.tenantId,
      });

      if (!space) {
        return context.json({ error: "KnowledgeFS path not found" }, 404);
      }

      const candidatePermissionScope = currentCandidateGrants({
        decision: context.get("authorizationDecision"),
        knowledgeSpaceId: params.id,
        subject,
      });
      if (!candidatePermissionScope) {
        return context.json({ error: "Knowledge space access denied" }, 403);
      }

      const result = await fsCommands.execute<KnowledgeFsListResult>({
        context: {
          resourceType: "workspace",
          subject,
          traceId: context.get("traceId"),
        },
        input: {
          ...context.req.valid("query"),
          candidatePermissionScope,
          knowledgeSpaceId: params.id,
        },
        name: "ls",
      });

      return context.json(result.output, 200);
    } catch (error) {
      if (error instanceof CandidateVisibilityScanBudgetExceededError) {
        return context.json(
          { code: error.code, error: CANDIDATE_VISIBILITY_SCAN_BUDGET_EXCEEDED_MESSAGE },
          503,
        );
      }
      if (error instanceof KnowledgeFsNotFoundError) {
        return context.json({ error: "KnowledgeFS path not found" }, 404);
      }

      if (
        error instanceof KnowledgePathListLimitExceededError ||
        error instanceof KnowledgeFsValidationError
      ) {
        return context.json({ error: error.message }, 400);
      }

      /* v8 ignore next 2 -- unexpected KnowledgeFS list failures should escape to Hono. */
      throw error;
    }
  });

  app.openapi(treeKnowledgeFsRoute, async (context) => {
    try {
      const subject = context.get("subject");
      const params = context.req.valid("param");
      const space = await spaces.get({
        id: params.id,
        tenantId: subject.tenantId,
      });

      if (!space) {
        return context.json({ error: "KnowledgeFS path not found" }, 404);
      }

      const candidatePermissionScope = currentCandidateGrants({
        decision: context.get("authorizationDecision"),
        knowledgeSpaceId: params.id,
        subject,
      });
      if (!candidatePermissionScope) {
        return context.json({ error: "Knowledge space access denied" }, 403);
      }

      const result = await fsCommands.execute<KnowledgeFsTreeResult>({
        context: {
          resourceType: "workspace",
          subject,
          traceId: context.get("traceId"),
        },
        input: {
          ...context.req.valid("query"),
          candidatePermissionScope,
          knowledgeSpaceId: params.id,
        },
        name: "tree",
      });

      return context.json(result.output, 200);
    } catch (error) {
      if (error instanceof CandidateVisibilityScanBudgetExceededError) {
        return context.json(
          { code: error.code, error: CANDIDATE_VISIBILITY_SCAN_BUDGET_EXCEEDED_MESSAGE },
          503,
        );
      }
      if (error instanceof KnowledgeFsNotFoundError) {
        return context.json({ error: "KnowledgeFS path not found" }, 404);
      }

      if (
        error instanceof KnowledgePathListLimitExceededError ||
        error instanceof KnowledgeFsValidationError
      ) {
        return context.json({ error: error.message }, 400);
      }

      /* v8 ignore next 2 -- unexpected KnowledgeFS tree failures should escape to Hono. */
      throw error;
    }
  });

  app.openapi(grepKnowledgeFsRoute, async (context) => {
    try {
      const subject = context.get("subject");
      const params = context.req.valid("param");
      const space = await spaces.get({
        id: params.id,
        tenantId: subject.tenantId,
      });

      if (!space) {
        return context.json({ error: "KnowledgeFS path not found" }, 404);
      }

      const candidatePermissionScope = currentCandidateGrants({
        decision: context.get("authorizationDecision"),
        knowledgeSpaceId: params.id,
        subject,
      });
      if (!candidatePermissionScope) {
        return context.json({ error: "Knowledge space access denied" }, 403);
      }

      const result = await fsCommands.execute<KnowledgeFsGrepResult>({
        context: {
          resourceType: "workspace",
          subject,
          traceId: context.get("traceId"),
        },
        input: {
          ...context.req.valid("query"),
          candidatePermissionScope,
          knowledgeSpaceId: params.id,
        },
        name: "grep",
      });

      return context.json(result.output, 200);
    } catch (error) {
      if (error instanceof CandidateVisibilityScanBudgetExceededError) {
        return context.json(
          { code: error.code, error: CANDIDATE_VISIBILITY_SCAN_BUDGET_EXCEEDED_MESSAGE },
          503,
        );
      }
      if (error instanceof KnowledgeFsNotFoundError) {
        return context.json({ error: "KnowledgeFS path not found" }, 404);
      }

      if (
        error instanceof KnowledgePathListLimitExceededError ||
        error instanceof KnowledgeFsValidationError
      ) {
        return context.json({ error: error.message }, 400);
      }

      /* v8 ignore next 2 -- unexpected KnowledgeFS grep failures should escape to Hono. */
      throw error;
    }
  });

  app.openapi(findKnowledgeFsRoute, async (context) => {
    try {
      const subject = context.get("subject");
      const params = context.req.valid("param");
      const space = await spaces.get({
        id: params.id,
        tenantId: subject.tenantId,
      });

      if (!space) {
        return context.json({ error: "KnowledgeFS path not found" }, 404);
      }

      const candidatePermissionScope = currentCandidateGrants({
        decision: context.get("authorizationDecision"),
        knowledgeSpaceId: params.id,
        subject,
      });
      if (!candidatePermissionScope) {
        return context.json({ error: "Knowledge space access denied" }, 403);
      }

      const result = await fsCommands.execute<KnowledgeFsListResult>({
        context: {
          resourceType: "workspace",
          subject,
          traceId: context.get("traceId"),
        },
        input: {
          ...context.req.valid("query"),
          candidatePermissionScope,
          knowledgeSpaceId: params.id,
        },
        name: "find",
      });

      return context.json(result.output, 200);
    } catch (error) {
      if (error instanceof CandidateVisibilityScanBudgetExceededError) {
        return context.json(
          { code: error.code, error: CANDIDATE_VISIBILITY_SCAN_BUDGET_EXCEEDED_MESSAGE },
          503,
        );
      }
      if (error instanceof KnowledgeFsNotFoundError) {
        return context.json({ error: "KnowledgeFS path not found" }, 404);
      }

      if (
        error instanceof KnowledgePathListLimitExceededError ||
        error instanceof KnowledgeFsValidationError
      ) {
        return context.json({ error: error.message }, 400);
      }

      /* v8 ignore next 2 -- unexpected KnowledgeFS find failures should escape to Hono. */
      throw error;
    }
  });

  app.openapi(diffKnowledgeFsRoute, async (context) => {
    try {
      const subject = context.get("subject");
      const params = context.req.valid("param");
      const space = await spaces.get({
        id: params.id,
        tenantId: subject.tenantId,
      });

      if (!space) {
        return context.json({ error: "KnowledgeFS path not found" }, 404);
      }

      const candidatePermissionScope = currentCandidateGrants({
        decision: context.get("authorizationDecision"),
        knowledgeSpaceId: params.id,
        subject,
      });
      if (!candidatePermissionScope) {
        return context.json({ error: "Knowledge space access denied" }, 403);
      }

      const result = await fsCommands.execute<KnowledgeFsDiffResult>({
        context: {
          resourceType: "workspace",
          subject,
          traceId: context.get("traceId"),
        },
        input: {
          ...context.req.valid("query"),
          candidatePermissionScope,
          knowledgeSpaceId: params.id,
        },
        name: "diff",
      });

      return context.json(result.output, 200);
    } catch (error) {
      if (error instanceof KnowledgeFsNotFoundError) {
        return context.json({ error: "KnowledgeFS path not found" }, 404);
      }

      if (error instanceof KnowledgeFsUnavailableError) {
        return context.json({ error: error.message }, 503);
      }

      /* v8 ignore next 2 -- unexpected KnowledgeFS diff failures should escape to Hono. */
      throw error;
    }
  });

  app.openapi(openNodeKnowledgeFsRoute, async (context) => {
    const subject = context.get("subject");
    const params = context.req.valid("param");
    const space = await spaces.get({
      id: params.id,
      tenantId: subject.tenantId,
    });

    if (!space) {
      return context.json({ error: "KnowledgeFS node not found" }, 404);
    }

    const candidatePermissionScope = currentCandidateGrants({
      decision: context.get("authorizationDecision"),
      knowledgeSpaceId: params.id,
      subject,
    });
    if (!candidatePermissionScope) {
      return context.json({ error: "Knowledge space access denied" }, 403);
    }

    try {
      const result = await fsCommands.execute<KnowledgeFsOpenNodeResult>({
        context: {
          resourceType: "workspace",
          subject,
          traceId: context.get("traceId"),
        },
        input: {
          ...context.req.valid("query"),
          candidatePermissionScope,
          knowledgeSpaceId: params.id,
        },
        name: "open_node",
      });

      return context.json(result.output, 200);
    } catch (error) {
      if (error instanceof KnowledgeFsNotFoundError) {
        return context.json({ error: "KnowledgeFS node not found" }, 404);
      }

      /* v8 ignore next 2 -- unexpected KnowledgeFS open_node failures should escape to Hono. */
      throw error;
    }
  });

  app.openapi(catKnowledgeFsRoute, async (context) => {
    const subject = context.get("subject");
    const params = context.req.valid("param");
    const space = await spaces.get({
      id: params.id,
      tenantId: subject.tenantId,
    });

    if (!space) {
      return context.json({ error: "KnowledgeFS path not found" }, 404);
    }

    const candidatePermissionScope = currentCandidateGrants({
      decision: context.get("authorizationDecision"),
      knowledgeSpaceId: params.id,
      subject,
    });
    if (!candidatePermissionScope) {
      return context.json({ error: "Knowledge space access denied" }, 403);
    }

    try {
      const result = await fsCommands.execute<KnowledgeFsCatResult>({
        context: {
          resourceType: "workspace",
          subject,
          traceId: context.get("traceId"),
        },
        input: {
          ...context.req.valid("query"),
          candidatePermissionScope,
          knowledgeSpaceId: params.id,
        },
        name: "cat",
      });

      return context.json(result.output, 200);
    } catch (error) {
      if (error instanceof KnowledgeFsNotFoundError) {
        return context.json({ error: "KnowledgeFS path not found" }, 404);
      }

      /* v8 ignore next 2 -- unexpected KnowledgeFS cat failures should escape to Hono. */
      throw error;
    }
  });

  app.openapi(statKnowledgeFsRoute, async (context) => {
    const subject = context.get("subject");
    const params = context.req.valid("param");
    const space = await spaces.get({
      id: params.id,
      tenantId: subject.tenantId,
    });

    if (!space) {
      return context.json({ error: "KnowledgeFS path not found" }, 404);
    }

    const candidatePermissionScope = currentCandidateGrants({
      decision: context.get("authorizationDecision"),
      knowledgeSpaceId: params.id,
      subject,
    });
    if (!candidatePermissionScope) {
      return context.json({ error: "Knowledge space access denied" }, 403);
    }

    try {
      const result = await fsCommands.execute<KnowledgeFsStatResult>({
        context: {
          resourceType: "workspace",
          subject,
          traceId: context.get("traceId"),
        },
        input: {
          ...context.req.valid("query"),
          candidatePermissionScope,
          knowledgeSpaceId: params.id,
        },
        name: "stat",
      });

      return context.json(result.output, 200);
    } catch (error) {
      if (error instanceof KnowledgeFsNotFoundError) {
        return context.json({ error: "KnowledgeFS path not found" }, 404);
      }

      /* v8 ignore next 2 -- unexpected KnowledgeFS stat failures should escape to Hono. */
      throw error;
    }
  });

  app.openapi(writeKnowledgeFsRoute, async (context) => {
    const subject = context.get("subject");
    const params = context.req.valid("param");
    const space = await spaces.get({
      id: params.id,
      tenantId: subject.tenantId,
    });

    if (!space) {
      return context.json({ error: "KnowledgeFS path not found" }, 404);
    }

    const candidatePermissionScope = currentCandidateGrants({
      decision: context.get("authorizationDecision"),
      knowledgeSpaceId: params.id,
      subject,
    });
    if (!candidatePermissionScope) {
      return context.json({ error: "Knowledge space access denied" }, 403);
    }

    try {
      const result = await fsCommands.execute<KnowledgeFsWriteResult>({
        context: {
          resourceType: "workspace",
          subject,
          traceId: context.get("traceId"),
        },
        input: {
          ...context.req.valid("json"),
          candidatePermissionScope,
          knowledgeSpaceId: params.id,
        },
        name: "write",
      });

      return context.json(result.output, 200);
    } catch (error) {
      if (error instanceof KnowledgeFsNotFoundError) {
        return context.json({ error: "KnowledgeFS path not found" }, 404);
      }

      if (error instanceof KnowledgeFsValidationError) {
        return context.json({ error: error.message }, 400);
      }

      if (
        error instanceof DeletionLifecycleFenceActiveError ||
        error instanceof DeletionObjectWriteAdmissionError
      ) {
        return context.json({ error: "Knowledge space deletion is active" }, 409);
      }

      if (
        error instanceof LegacySpacePublicationBootstrapAdmissionError ||
        error instanceof KnowledgeSpaceDocumentMutationLeaseActiveError
      ) {
        return context.json({ error: "Knowledge space publication bootstrap is active" }, 409);
      }

      throw error;
    }
  });

  app.openapi(appendKnowledgeFsRoute, async (context) => {
    const subject = context.get("subject");
    const params = context.req.valid("param");
    const space = await spaces.get({
      id: params.id,
      tenantId: subject.tenantId,
    });

    if (!space) {
      return context.json({ error: "KnowledgeFS path not found" }, 404);
    }

    const candidatePermissionScope = currentCandidateGrants({
      decision: context.get("authorizationDecision"),
      knowledgeSpaceId: params.id,
      subject,
    });
    if (!candidatePermissionScope) {
      return context.json({ error: "Knowledge space access denied" }, 403);
    }

    try {
      const result = await fsCommands.execute<KnowledgeFsWriteResult>({
        context: {
          resourceType: "workspace",
          subject,
          traceId: context.get("traceId"),
        },
        input: {
          ...context.req.valid("json"),
          candidatePermissionScope,
          knowledgeSpaceId: params.id,
        },
        name: "append",
      });

      return context.json(result.output, 200);
    } catch (error) {
      if (error instanceof KnowledgeFsNotFoundError) {
        return context.json({ error: "KnowledgeFS path not found" }, 404);
      }

      if (error instanceof KnowledgeFsValidationError) {
        return context.json({ error: error.message }, 400);
      }

      if (
        error instanceof DeletionLifecycleFenceActiveError ||
        error instanceof DeletionObjectWriteAdmissionError
      ) {
        return context.json({ error: "Knowledge space deletion is active" }, 409);
      }

      if (
        error instanceof LegacySpacePublicationBootstrapAdmissionError ||
        error instanceof KnowledgeSpaceDocumentMutationLeaseActiveError
      ) {
        return context.json({ error: "Knowledge space publication bootstrap is active" }, 409);
      }

      throw error;
    }
  });
}
