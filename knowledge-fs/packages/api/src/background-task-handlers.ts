import type { OpenAPIHono } from "@hono/zod-openapi";

import {
  type BackgroundTask,
  type BackgroundTaskCursor,
  bulkBackgroundTask,
  decodeBackgroundTaskCursor,
  documentBackgroundTask,
  encodeBackgroundTaskCursor,
  sourceBackgroundTask,
} from "./background-task";
import {
  cancelBackgroundTaskRoute,
  listBackgroundTasksRoute,
  retryBackgroundTaskRoute,
} from "./background-task-routes";
import { type BulkOperationRepository, canReadBulkOperation } from "./bulk-operation";
import { summarizeBulkOperation } from "./bulk-operation-summary";
import { currentCandidateGrants } from "./candidate-content-authorization";
import { issueKnowledgeSpaceDurablePermission } from "./derived-result-authorization";
import type {
  DocumentCompilationJobStateMachine,
  RetryDocumentCompilationJobInput,
} from "./document-compilation-job";
import type { DocumentProcessingTaskRepository } from "./document-processing-task-repository";
import type { KnowledgeGatewayEnv } from "./gateway-openapi-contracts";
import type { KnowledgeSpaceAccessService } from "./knowledge-space-access-control";
import {
  KnowledgeSpaceAuthorizationError,
  type KnowledgeSpaceAuthorizationGuard,
} from "./knowledge-space-authorization";
import type { KnowledgeSpaceRepository } from "./knowledge-space-repository";
import type {
  SourceProductWorkflowRepository,
  SourceProductWorkflowService,
  SourceWorkflowPrincipal,
} from "./source-product-workflow";

type CandidateSource = "bulk" | "document" | "source";

interface TaskCandidate {
  readonly cursor: { readonly createdAt: string; readonly id: string };
  readonly source: CandidateSource;
  readonly task: BackgroundTask;
}

export interface RegisterBackgroundTaskHandlersOptions {
  readonly access: Pick<KnowledgeSpaceAccessService, "createPermissionSnapshot">;
  readonly app: OpenAPIHono<KnowledgeGatewayEnv>;
  readonly authorization: KnowledgeSpaceAuthorizationGuard;
  readonly bulkOperations: BulkOperationRepository;
  readonly documentCompilationJobs?: DocumentCompilationJobStateMachine | undefined;
  readonly documentTasks?: DocumentProcessingTaskRepository | undefined;
  readonly sourceRepository?: SourceProductWorkflowRepository | undefined;
  readonly sourceWorkflows?: SourceProductWorkflowService | undefined;
  readonly spaces: KnowledgeSpaceRepository;
}

export function registerBackgroundTaskHandlers({
  access,
  app,
  authorization,
  bulkOperations,
  documentCompilationJobs,
  documentTasks,
  sourceRepository,
  sourceWorkflows,
  spaces,
}: RegisterBackgroundTaskHandlersOptions): void {
  // Hono's composed OpenAPI route union exceeds TypeScript's practical recursion limit.
  const register = app.openapi.bind(app) as (
    // biome-ignore lint/suspicious/noExplicitAny: bounded OpenAPI route adapter
    route: any,
    // biome-ignore lint/suspicious/noExplicitAny: bounded OpenAPI handler context
    handler: (context: any) => unknown,
  ) => void;

  register(listBackgroundTasksRoute, async (context) => {
    const params = context.req.valid("param");
    const query = context.req.valid("query");
    const grants = await authorizeAndResolveGrants(
      context,
      spaces,
      authorization,
      params.id,
      "read",
    );
    if (!grants) return context.json({ error: "Knowledge space access denied" }, 403);

    let cursor: BackgroundTaskCursor = { version: 1 };
    try {
      if (query.cursor) cursor = decodeBackgroundTaskCursor(query.cursor);
    } catch {
      return context.json({ error: "Invalid background task cursor" }, 400);
    }
    const subject = context.get("subject");
    const [documentPage, bulkPage, sourcePage] = await Promise.all([
      documentTasks
        ? documentTasks.list({
            candidateGrants: grants,
            ...(cursor.document ? { cursor: cursor.document } : {}),
            direction: "desc",
            knowledgeSpaceId: params.id,
            limit: query.limit,
            tenantId: subject.tenantId,
          })
        : Promise.resolve({ items: [] as const, nextCursor: undefined }),
      bulkOperations.list({
        candidateGrants: grants,
        ...(cursor.bulk ? { cursor: cursor.bulk } : {}),
        knowledgeSpaceId: params.id,
        limit: query.limit,
        requestedBySubjectId: subject.subjectId,
        tenantId: subject.tenantId,
      }),
      sourceRepository
        ? sourceRepository.listRecentRuns({
            candidateGrants: grants,
            ...(cursor.source ? { cursor: cursor.source } : {}),
            knowledgeSpaceId: params.id,
            limit: query.limit,
            tenantId: subject.tenantId,
          })
        : Promise.resolve({ items: [] as const, nextCursor: undefined }),
    ]);

    const bulkCandidates = await Promise.all(
      bulkPage.items.map(async (operation): Promise<TaskCandidate> => {
        const summary = await summarizeBulkOperation(operation, documentCompilationJobs);
        return {
          cursor: { createdAt: operation.createdAt, id: operation.id },
          source: "bulk",
          task: bulkBackgroundTask(operation, summary),
        };
      }),
    );
    const groupedCompilationIds = new Set(
      await bulkOperations.findGroupedCompilationJobIds({
        candidateGrants: grants,
        compilationJobIds: documentPage.items.map((task) => task.id),
        knowledgeSpaceId: params.id,
        requestedBySubjectId: subject.subjectId,
        tenantId: subject.tenantId,
      }),
    );
    const documentCandidates = documentPage.items
      .filter((task) => !groupedCompilationIds.has(task.id))
      .map(
        (task): TaskCandidate => ({
          cursor: { createdAt: task.createdAt, id: task.id },
          source: "document",
          task: documentBackgroundTask(task),
        }),
      );
    const sourceCandidates = sourcePage.items.map(
      (run): TaskCandidate => ({
        cursor: { createdAt: run.createdAt, id: run.id },
        source: "source",
        task: sourceBackgroundTask(run),
      }),
    );
    const candidates = [...bulkCandidates, ...documentCandidates, ...sourceCandidates].sort(
      compareCandidates,
    );
    const selected = candidates.slice(0, query.limit);
    let next = advanceCursor(cursor, selected);
    if (documentCandidates.length === 0 && documentPage.items.length > 0) {
      const last = documentPage.items.at(-1);
      if (last) {
        next = {
          ...next,
          document: { createdAt: last.createdAt, id: last.id },
        };
      }
    }
    const hasMore =
      candidates.length > query.limit ||
      Boolean(documentPage.nextCursor || bulkPage.nextCursor || sourcePage.nextCursor);
    return context.json(
      {
        items: selected.map((candidate) => candidate.task),
        ...(hasMore ? { nextCursor: encodeBackgroundTaskCursor(next) } : {}),
      },
      200,
    );
  });

  const control = async (
    // biome-ignore lint/suspicious/noExplicitAny: bounded OpenAPI handler context
    context: any,
    action: "cancel" | "retry",
  ) => {
    const params = context.req.valid("param") as {
      id: string;
      taskId: string;
      taskKind: "document" | "document_bulk" | "source";
    };
    const grants = await authorizeAndResolveGrants(
      context,
      spaces,
      authorization,
      params.id,
      "write",
    );
    if (!grants) return context.json({ error: "Knowledge space access denied" }, 403);
    try {
      const task =
        params.taskKind === "document"
          ? await controlDocumentTask({
              access,
              action,
              authorization,
              context,
              documentCompilationJobs,
              documentTasks,
              grants,
              knowledgeSpaceId: params.id,
              taskId: params.taskId,
            })
          : params.taskKind === "document_bulk"
            ? await controlBulkTask({
                access,
                action,
                authorization,
                bulkOperations,
                context,
                documentCompilationJobs,
                grants,
                knowledgeSpaceId: params.id,
                taskId: params.taskId,
              })
            : await controlSourceTask({
                action,
                context,
                knowledgeSpaceId: params.id,
                sourceWorkflows,
                taskId: params.taskId,
              });
      return task
        ? context.json(task, 200)
        : context.json({ error: "Background task not found" }, 404);
    } catch (error) {
      if (error instanceof KnowledgeSpaceAuthorizationError) {
        return context.json({ error: "Knowledge space access denied" }, 403);
      }
      return context.json(
        {
          error: `Background task cannot be ${action === "cancel" ? "canceled" : "retried"}`,
        },
        409,
      );
    }
  };

  register(cancelBackgroundTaskRoute, (context) => control(context, "cancel"));
  register(retryBackgroundTaskRoute, (context) => control(context, "retry"));
}

async function controlDocumentTask(input: {
  readonly access: Pick<KnowledgeSpaceAccessService, "createPermissionSnapshot">;
  readonly action: "cancel" | "retry";
  readonly authorization: KnowledgeSpaceAuthorizationGuard;
  // biome-ignore lint/suspicious/noExplicitAny: bounded OpenAPI handler context
  readonly context: any;
  readonly documentCompilationJobs?: DocumentCompilationJobStateMachine | undefined;
  readonly documentTasks?: DocumentProcessingTaskRepository | undefined;
  readonly grants: readonly string[];
  readonly knowledgeSpaceId: string;
  readonly taskId: string;
}): Promise<BackgroundTask | null> {
  if (!input.documentTasks?.getVisible || !input.documentCompilationJobs) {
    throw new Error("Document background tasks are unavailable");
  }
  const subject = input.context.get("subject");
  const task = await input.documentTasks.getVisible({
    candidateGrants: input.grants,
    knowledgeSpaceId: input.knowledgeSpaceId,
    taskId: input.taskId,
    tenantId: subject.tenantId,
  });
  if (!task) return null;
  const permission = await controlPermission(
    input.context,
    input.access,
    input.authorization,
    input.knowledgeSpaceId,
  );
  if (input.action === "cancel") {
    await input.documentCompilationJobs.cancel(input.taskId, "Canceled by request", permission);
  } else {
    if (!input.documentCompilationJobs.retry) throw new Error("Document retry is unavailable");
    await input.documentCompilationJobs.retry(input.taskId, permission);
  }
  const updated = await input.documentTasks.getVisible({
    candidateGrants: input.grants,
    knowledgeSpaceId: input.knowledgeSpaceId,
    taskId: input.taskId,
    tenantId: subject.tenantId,
  });
  return updated ? documentBackgroundTask(updated) : null;
}

async function controlBulkTask(input: {
  readonly access: Pick<KnowledgeSpaceAccessService, "createPermissionSnapshot">;
  readonly action: "cancel" | "retry";
  readonly authorization: KnowledgeSpaceAuthorizationGuard;
  readonly bulkOperations: BulkOperationRepository;
  // biome-ignore lint/suspicious/noExplicitAny: bounded OpenAPI handler context
  readonly context: any;
  readonly documentCompilationJobs?: DocumentCompilationJobStateMachine | undefined;
  readonly grants: readonly string[];
  readonly knowledgeSpaceId: string;
  readonly taskId: string;
}): Promise<BackgroundTask | null> {
  if (!input.documentCompilationJobs) throw new Error("Document background tasks are unavailable");
  const subject = input.context.get("subject");
  const operation = await input.bulkOperations.get({
    id: input.taskId,
    tenantId: subject.tenantId,
  });
  if (
    !operation ||
    operation.knowledgeSpaceId !== input.knowledgeSpaceId ||
    !canReadBulkOperation(operation, {
      candidateGrants: input.grants,
      requestedBySubjectId: subject.subjectId,
    })
  ) {
    return null;
  }
  const permission = await controlPermission(
    input.context,
    input.access,
    input.authorization,
    input.knowledgeSpaceId,
  );
  let changed = 0;
  for (const item of operation.items) {
    if (!item.compilationJobId) continue;
    const job = await input.documentCompilationJobs.get(item.compilationJobId);
    if (
      !job ||
      job.knowledgeSpaceId !== input.knowledgeSpaceId ||
      job.tenantId !== subject.tenantId
    ) {
      continue;
    }
    if (
      input.action === "cancel" &&
      job.stage !== "failed" &&
      job.stage !== "canceled" &&
      job.stage !== "published"
    ) {
      await input.documentCompilationJobs.cancel(
        job.id,
        "Bulk task canceled by request",
        permission,
      );
      changed += 1;
    }
    if (input.action === "retry" && (job.stage === "failed" || job.stage === "canceled")) {
      if (!input.documentCompilationJobs.retry) throw new Error("Document retry is unavailable");
      await input.documentCompilationJobs.retry(job.id, permission);
      changed += 1;
    }
  }
  if (changed === 0) throw new Error("Bulk task has no eligible items");
  return bulkBackgroundTask(
    operation,
    await summarizeBulkOperation(operation, input.documentCompilationJobs),
  );
}

async function controlSourceTask(input: {
  readonly action: "cancel" | "retry";
  // biome-ignore lint/suspicious/noExplicitAny: bounded OpenAPI handler context
  readonly context: any;
  readonly knowledgeSpaceId: string;
  readonly sourceWorkflows?: SourceProductWorkflowService | undefined;
  readonly taskId: string;
}): Promise<BackgroundTask | null> {
  if (!input.sourceWorkflows) throw new Error("Source background tasks are unavailable");
  const principal = sourcePrincipal(input.context);
  const run =
    input.action === "cancel"
      ? await input.sourceWorkflows.cancel({
          ...principal,
          knowledgeSpaceId: input.knowledgeSpaceId,
          reason: "Canceled by request",
          runId: input.taskId,
        })
      : await input.sourceWorkflows.retry({
          ...principal,
          knowledgeSpaceId: input.knowledgeSpaceId,
          runId: input.taskId,
        });
  return run ? sourceBackgroundTask(run) : null;
}

async function controlPermission(
  // biome-ignore lint/suspicious/noExplicitAny: bounded OpenAPI handler context
  context: any,
  access: Pick<KnowledgeSpaceAccessService, "createPermissionSnapshot">,
  authorization: KnowledgeSpaceAuthorizationGuard,
  knowledgeSpaceId: string,
): Promise<RetryDocumentCompilationJobInput> {
  const capability = context.get("capabilityV2Grant");
  if (capability) return { capabilityGrantId: capability.grantId };
  const subject = context.get("subject");
  const snapshot = await issueKnowledgeSpaceDurablePermission({
    access,
    ...(context.get("authenticatedApiKey") ? { apiKey: context.get("authenticatedApiKey") } : {}),
    authorization,
    callerKind: context.get("callerKind") ?? "interactive",
    expiresAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
    knowledgeSpaceId,
    requiredAccess: "write",
    subject,
  });
  return {
    permissionSnapshot: {
      accessChannel: snapshot.accessChannel,
      id: snapshot.id,
      revision: snapshot.revision,
    },
    requestedBySubjectId: subject.subjectId,
  };
}

async function authorizeAndResolveGrants(
  // biome-ignore lint/suspicious/noExplicitAny: bounded OpenAPI handler context
  context: any,
  spaces: KnowledgeSpaceRepository,
  authorization: KnowledgeSpaceAuthorizationGuard,
  knowledgeSpaceId: string,
  requiredAccess: "read" | "write",
): Promise<readonly string[] | null> {
  const subject = context.get("subject");
  if (!(await spaces.get({ id: knowledgeSpaceId, tenantId: subject.tenantId }))) return null;
  const capability = context.get("capabilityV2Grant");
  if (capability) {
    return currentCandidateGrants({
      capabilityGrant: capability,
      decision: undefined,
      knowledgeSpaceId,
      subject,
    });
  }
  try {
    const decision = await authorization.authorize({
      callerKind: context.get("callerKind") ?? "interactive",
      knowledgeSpaceId,
      requiredAccess,
      subject,
    });
    context.set("authorizationDecision", decision);
    return currentCandidateGrants({
      decision,
      knowledgeSpaceId,
      subject,
    });
  } catch (error) {
    if (error instanceof KnowledgeSpaceAuthorizationError) return null;
    throw error;
  }
}

function sourcePrincipal(
  // biome-ignore lint/suspicious/noExplicitAny: bounded OpenAPI handler context
  context: any,
): SourceWorkflowPrincipal {
  const apiKey = context.get("authenticatedApiKey");
  const capability = context.get("capabilityV2Grant");
  return {
    ...(apiKey ? { apiKey } : {}),
    ...(capability
      ? {
          capability: {
            contentScopeIds: capability.contentScopeIds,
            grantId: capability.grantId,
          },
        }
      : {}),
    callerKind: context.get("callerKind") ?? "interactive",
    subject: context.get("subject"),
  };
}

function compareCandidates(left: TaskCandidate, right: TaskCandidate): number {
  return (
    right.task.createdAt.localeCompare(left.task.createdAt) ||
    right.source.localeCompare(left.source) ||
    right.task.id.localeCompare(left.task.id)
  );
}

function advanceCursor(
  current: BackgroundTaskCursor,
  selected: readonly TaskCandidate[],
): BackgroundTaskCursor {
  const next: {
    bulk?: { createdAt: string; id: string };
    document?: { createdAt: string; id: string };
    source?: { createdAt: string; id: string };
    version: 1;
  } = {
    ...(current.bulk ? { bulk: current.bulk } : {}),
    ...(current.document ? { document: current.document } : {}),
    ...(current.source ? { source: current.source } : {}),
    version: 1,
  };
  for (const candidate of selected) next[candidate.source] = candidate.cursor;
  return next;
}
