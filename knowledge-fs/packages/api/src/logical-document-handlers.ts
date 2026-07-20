import type { OpenAPIHono } from "@hono/zod-openapi";

import { candidatePermissionAllowsAsset } from "./candidate-content-authorization";
import { issueKnowledgeSpaceDurablePermission } from "./derived-result-authorization";
import type { DocumentAssetRepository } from "./document-asset-repository";
import type {
  DocumentChunkRepository,
  DocumentChunkStateService,
} from "./document-chunk-repository";
import type { DocumentCompilationJobStateMachine } from "./document-compilation-job";
import {
  type DocumentProcessingTask,
  type DocumentProcessingTaskRepository,
  documentTaskSseEvents,
  isTerminalTask,
} from "./document-processing-task-repository";
import type {
  DocumentSettingsHead,
  DocumentSettingsRepository,
} from "./document-settings-repository";
import type { KnowledgeGatewayEnv } from "./gateway-openapi-contracts";
import type { KnowledgeSpaceAccessService } from "./knowledge-space-access-control";
import {
  KnowledgeSpaceAuthorizationError,
  type KnowledgeSpaceAuthorizationGuard,
  type KnowledgeSpaceDurablePermissionReference,
} from "./knowledge-space-authorization";
import type { KnowledgeSpaceRepository } from "./knowledge-space-repository";
import {
  type DocumentRevision,
  LogicalDocumentConflictError,
  LogicalDocumentNotFoundError,
  type LogicalDocumentRepository,
  LogicalDocumentValidationError,
  type LogicalDocumentWithActiveRevision,
} from "./logical-document-repository";
import {
  cancelDocumentProcessingTaskRoute,
  changeDocumentChunkStateRoute,
  getDocumentChunkRoute,
  getDocumentProcessingTaskRoute,
  getDocumentSettingsRoute,
  getLogicalDocumentRoute,
  listDocumentChunksRoute,
  listDocumentProcessingTasksRoute,
  listDocumentRevisionsRoute,
  listLogicalDocumentsRoute,
  listSpaceProcessingTasksRoute,
  patchDocumentMetadataRoute,
  patchDocumentSettingsRoute,
  retryDocumentProcessingTaskRoute,
  rollbackDocumentRevisionRoute,
  streamDocumentProcessingTaskRoute,
} from "./logical-document-routes";

export interface DocumentRevisionRollbackCoordinator {
  request(input: {
    readonly documentId: string;
    readonly expectedActiveRevision: number;
    readonly expectedRowVersion: number;
    readonly knowledgeSpaceId: string;
    readonly permissionSnapshot?: KnowledgeSpaceDurablePermissionReference | undefined;
    readonly revision: number;
    readonly subjectId: string;
    readonly tenantId: string;
  }): Promise<DocumentProcessingTask>;
}

export interface DocumentSettingsChangeCoordinator {
  request(input: {
    readonly documentId: string;
    readonly expectedSettingsHeadRevision: number | null;
    readonly knowledgeSpaceId: string;
    readonly permissionSnapshot?: KnowledgeSpaceDurablePermissionReference | undefined;
    readonly settings: Parameters<DocumentSettingsRepository["requestChange"]>[0]["settings"];
    readonly subjectId: string;
    readonly tenantId: string;
  }): Promise<{
    readonly attemptId: string;
    readonly compilationAttemptId: string;
    readonly settingsRevision: number;
    readonly state: "running";
    readonly statusUrl: string;
  }>;
}

export interface RegisterLogicalDocumentHandlersOptions {
  readonly access: Pick<KnowledgeSpaceAccessService, "createPermissionSnapshot">;
  readonly app: OpenAPIHono<KnowledgeGatewayEnv>;
  readonly assets: Pick<DocumentAssetRepository, "get">;
  readonly authorization: KnowledgeSpaceAuthorizationGuard;
  readonly chunkState?: DocumentChunkStateService | undefined;
  readonly chunks?: DocumentChunkRepository | undefined;
  readonly compilationJobs?: DocumentCompilationJobStateMachine | undefined;
  readonly logicalDocuments?: LogicalDocumentRepository | undefined;
  readonly now?: (() => string) | undefined;
  readonly rollbackCoordinator?: DocumentRevisionRollbackCoordinator | undefined;
  readonly settings?: DocumentSettingsRepository | undefined;
  readonly settingsChangeCoordinator?: DocumentSettingsChangeCoordinator | undefined;
  readonly spaces: KnowledgeSpaceRepository;
  readonly taskSseHeartbeatMs?: number | undefined;
  readonly taskSseMaxDurationMs?: number | undefined;
  readonly taskSsePollIntervalMs?: number | undefined;
  readonly tasks?: DocumentProcessingTaskRepository | undefined;
}

export function registerLogicalDocumentHandlers({
  access,
  app,
  assets,
  authorization,
  chunkState,
  chunks,
  compilationJobs,
  logicalDocuments,
  now = () => new Date().toISOString(),
  rollbackCoordinator,
  settings,
  settingsChangeCoordinator,
  spaces,
  taskSseHeartbeatMs = 5_000,
  taskSseMaxDurationMs = 25_000,
  taskSsePollIntervalMs = 1_000,
  tasks,
}: RegisterLogicalDocumentHandlersOptions): void {
  positiveDuration(taskSseHeartbeatMs, "taskSseHeartbeatMs");
  positiveDuration(taskSseMaxDurationMs, "taskSseMaxDurationMs");
  positiveDuration(taskSsePollIntervalMs, "taskSsePollIntervalMs");
  // Hono's route-union inference exceeds TypeScript's practical recursion limit for this composed
  // product surface. Every input is still runtime-validated by the route's Zod schema.
  const register = app.openapi.bind(app) as (
    // biome-ignore lint/suspicious/noExplicitAny: bounded OpenAPI route adapter
    route: any,
    // biome-ignore lint/suspicious/noExplicitAny: bounded OpenAPI handler context
    handler: (context: any) => unknown,
  ) => void;

  register(listLogicalDocumentsRoute, async (context) => {
    if (!logicalDocuments) return context.json({ error: "Logical documents unavailable" }, 404);
    const params = context.req.valid("param");
    const query = context.req.valid("query");
    if (!(await authorize(context, spaces, authorization, params.id, "read"))) {
      return context.json({ error: "Knowledge space access denied" }, 403);
    }
    const decision = context.get("authorizationDecision");
    const grants = decision?.permissionSnapshot.candidateGrants ?? [];
    let cursor: ReturnType<typeof decodePairCursor> | undefined;
    try {
      cursor = query.cursor ? decodePairCursor(query.cursor) : undefined;
    } catch (error) {
      if (error instanceof LogicalDocumentValidationError) {
        return context.json({ error: error.message }, 400);
      }
      throw error;
    }
    const result = await logicalDocuments.list({
      candidateGrants: grants,
      ...(cursor ? { cursor } : {}),
      knowledgeSpaceId: params.id,
      limit: query.limit,
      tenantId: context.get("subject").tenantId,
    });
    const visible: ReturnType<typeof toPublicDocument>[] = [];
    for (const document of result.items) {
      if (await canReadDocument(logicalDocuments, assets, document, grants)) {
        visible.push(toPublicDocument(document));
      }
    }
    return context.json(
      {
        items: visible,
        ...(result.nextCursor ? { nextCursor: encodePairCursor(result.nextCursor) } : {}),
      },
      200,
    );
  });

  register(getLogicalDocumentRoute, async (context) => {
    if (!logicalDocuments) return context.json({ error: "Logical document not found" }, 404);
    const params = context.req.valid("param");
    if (!(await authorize(context, spaces, authorization, params.id, "read"))) {
      return context.json({ error: "Knowledge space access denied" }, 403);
    }
    const document = await logicalDocuments.get({
      documentId: params.documentId,
      knowledgeSpaceId: params.id,
      tenantId: context.get("subject").tenantId,
    });
    const grants = context.get("authorizationDecision")?.permissionSnapshot.candidateGrants ?? [];
    if (!document || !(await canReadDocument(logicalDocuments, assets, document, grants))) {
      return context.json({ error: "Logical document not found" }, 404);
    }
    return context.json(toPublicDocument(document), 200);
  });

  register(listDocumentRevisionsRoute, async (context) => {
    if (!logicalDocuments) return context.json({ error: "Document not found" }, 404);
    const params = context.req.valid("param");
    const query = context.req.valid("query");
    if (!(await authorize(context, spaces, authorization, params.id, "read"))) {
      return context.json({ error: "Document not found" }, 404);
    }
    const document = await logicalDocuments.get({
      documentId: params.documentId,
      knowledgeSpaceId: params.id,
      tenantId: context.get("subject").tenantId,
    });
    if (!document) return context.json({ error: "Document not found" }, 404);
    const candidateGrants =
      context.get("authorizationDecision")?.permissionSnapshot.candidateGrants ?? [];
    let cursor: { readonly revision: number } | undefined;
    try {
      cursor = query.cursor ? { revision: decodeRevisionCursor(query.cursor) } : undefined;
    } catch (error) {
      if (error instanceof LogicalDocumentValidationError) {
        return context.json({ error: error.message }, 400);
      }
      throw error;
    }
    const result = await logicalDocuments.listRevisions({
      candidateGrants,
      ...(cursor ? { cursor } : {}),
      documentId: params.documentId,
      knowledgeSpaceId: params.id,
      limit: query.limit,
      tenantId: context.get("subject").tenantId,
    });
    const visible: DocumentRevision[] = [];
    for (const revision of result.items) {
      if (await canReadRevision(assets, revision, candidateGrants)) visible.push(revision);
    }
    return context.json(
      {
        items: visible.map(toPublicRevision),
        ...(result.nextCursor ? { nextCursor: String(result.nextCursor.revision) } : {}),
      },
      200,
    );
  });

  register(rollbackDocumentRevisionRoute, async (context) => {
    const params = context.req.valid("param");
    const body = context.req.valid("json");
    if (
      !logicalDocuments ||
      !(await authorizeVisibleDocument(
        context,
        params,
        "write",
        logicalDocuments,
        assets,
        authorization,
        spaces,
      )) ||
      !(await canReadTargetRevision(context, params, logicalDocuments, assets))
    ) {
      return context.json({ error: "Document not found" }, 404);
    }
    if (!rollbackCoordinator)
      return context.json({ error: "Rollback coordinator unavailable" }, 503);
    const permissionSnapshot = await issueMutationPermission(
      access,
      authorization,
      context,
      params.id,
    );
    if (!permissionSnapshot) return context.json({ error: "Knowledge space access denied" }, 403);
    try {
      return context.json(
        await rollbackCoordinator.request({
          documentId: params.documentId,
          expectedActiveRevision: body.expectedActiveRevision,
          expectedRowVersion: body.expectedRowVersion,
          knowledgeSpaceId: params.id,
          permissionSnapshot,
          revision: params.revision,
          subjectId: context.get("subject").subjectId,
          tenantId: context.get("subject").tenantId,
        }),
        202,
      );
    } catch (error) {
      if (error instanceof LogicalDocumentConflictError)
        return context.json({ error: error.message }, 409);
      throw error;
    }
  });

  register(patchDocumentMetadataRoute, async (context) => {
    const params = context.req.valid("param");
    const body = context.req.valid("json");
    if (
      !logicalDocuments ||
      !(await authorizeVisibleDocument(
        context,
        params,
        "write",
        logicalDocuments,
        assets,
        authorization,
        spaces,
      ))
    ) {
      return context.json({ error: "Document not found" }, 404);
    }
    const permissionSnapshot = await issueMutationPermission(
      access,
      authorization,
      context,
      params.id,
    );
    if (!permissionSnapshot) return context.json({ error: "Document not found" }, 404);
    try {
      const updated = await logicalDocuments.patchUserMetadata({
        documentId: params.documentId,
        expectedRowVersion: body.expectedRowVersion,
        knowledgeSpaceId: params.id,
        now: now(),
        patch: body.patch,
        permissionSnapshot,
        requestedBySubjectId: context.get("subject").subjectId,
        tenantId: context.get("subject").tenantId,
      });
      const full = await logicalDocuments.get({
        documentId: updated.id,
        knowledgeSpaceId: updated.knowledgeSpaceId,
        tenantId: updated.tenantId,
      });
      if (!full) return context.json({ error: "Document not found" }, 404);
      return context.json(toPublicDocument(full), 200);
    } catch (error) {
      if (error instanceof LogicalDocumentConflictError)
        return context.json({ error: error.message }, 409);
      if (error instanceof LogicalDocumentValidationError)
        return context.json({ error: error.message }, 400);
      if (error instanceof LogicalDocumentNotFoundError)
        return context.json({ error: "Document not found" }, 404);
      throw error;
    }
  });

  register(listDocumentChunksRoute, async (context) => {
    if (!chunks || !logicalDocuments)
      return context.json({ error: "Document chunks not found" }, 404);
    const params = context.req.valid("param");
    const query = context.req.valid("query");
    if (
      !(await authorizeVisibleRevision(
        context,
        params,
        "read",
        logicalDocuments,
        assets,
        authorization,
        spaces,
      ))
    ) {
      return context.json({ error: "Document chunks not found" }, 404);
    }
    const result = await chunks.list({
      candidateGrants:
        context.get("authorizationDecision")?.permissionSnapshot.candidateGrants ?? [],
      ...(query.cursor ? { cursor: { id: query.cursor } } : {}),
      documentId: params.documentId,
      documentRevision: params.revision,
      knowledgeSpaceId: params.id,
      limit: query.limit,
      ...(query.query ? { query: query.query } : {}),
      tenantId: context.get("subject").tenantId,
    });
    return context.json(
      {
        items: result.items.map(toPublicChunk),
        ...(result.nextCursor ? { nextCursor: result.nextCursor.id } : {}),
      },
      200,
    );
  });

  register(getDocumentChunkRoute, async (context) => {
    if (!chunks || !logicalDocuments)
      return context.json({ error: "Document chunk not found" }, 404);
    const params = context.req.valid("param");
    if (
      !(await authorizeVisibleRevision(
        context,
        params,
        "read",
        logicalDocuments,
        assets,
        authorization,
        spaces,
      ))
    ) {
      return context.json({ error: "Document chunk not found" }, 404);
    }
    const chunk = await chunks.get({
      chunkId: params.chunkId,
      documentId: params.documentId,
      documentRevision: params.revision,
      knowledgeSpaceId: params.id,
      tenantId: context.get("subject").tenantId,
    });
    return chunk
      ? context.json(toPublicChunk(chunk), 200)
      : context.json({ error: "Document chunk not found" }, 404);
  });

  register(changeDocumentChunkStateRoute, async (context) => {
    if (!chunkState || !logicalDocuments)
      return context.json({ error: "Chunk publication coordinator unavailable" }, 503);
    const params = context.req.valid("param");
    if (
      !(await authorizeVisibleRevision(
        context,
        params,
        "write",
        logicalDocuments,
        assets,
        authorization,
        spaces,
      ))
    ) {
      return context.json({ error: "Document chunk not found" }, 404);
    }
    const permissionSnapshot = await issueMutationPermission(
      access,
      authorization,
      context,
      params.id,
    );
    if (!permissionSnapshot) return context.json({ error: "Knowledge space access denied" }, 403);
    try {
      const change = await chunkState.request({
        chunkId: params.chunkId,
        documentId: params.documentId,
        documentRevision: params.revision,
        enabled: context.req.valid("json").enabled,
        knowledgeSpaceId: params.id,
        now: now(),
        permissionSnapshot,
        requestedBySubjectId: context.get("subject").subjectId,
        tenantId: context.get("subject").tenantId,
      });
      const { activatedAt: _activatedAt, tenantId: _tenantId, ...publicChange } = change;
      return context.json(
        {
          ...publicChange,
          statusUrl: `/knowledge-spaces/${params.id}/documents/${params.documentId}/processing-tasks/${change.compilationAttemptId}`,
        } as typeof publicChange & { readonly state: "candidate"; readonly statusUrl: string },
        202,
      );
    } catch (error) {
      if (error instanceof LogicalDocumentValidationError)
        return context.json({ error: error.message }, 400);
      throw error;
    }
  });

  const listTasks = async (
    // biome-ignore lint/suspicious/noExplicitAny: bounded OpenAPI handler context
    context: any,
    documentId?: string,
  ) => {
    if (!tasks) return context.json({ error: "Processing tasks unavailable" }, 404);
    const params = context.req.valid("param") as { id: string };
    const query = context.req.valid("query") as { cursor?: string; limit: number };
    if (!(await authorize(context, spaces, authorization, params.id, "read"))) {
      return context.json({ error: "Knowledge space access denied" }, 403);
    }
    const candidateGrants =
      context.get("authorizationDecision")?.permissionSnapshot.candidateGrants ?? [];
    let cursor: ReturnType<typeof decodePairCursor> | undefined;
    try {
      cursor = query.cursor ? decodePairCursor(query.cursor) : undefined;
    } catch (error) {
      if (error instanceof LogicalDocumentValidationError) {
        return context.json({ error: error.message }, 400);
      }
      throw error;
    }
    const result = await tasks.list({
      candidateGrants,
      ...(cursor ? { cursor } : {}),
      ...(documentId ? { documentId } : {}),
      knowledgeSpaceId: params.id,
      limit: query.limit,
      tenantId: context.get("subject").tenantId,
    });
    const visible: DocumentProcessingTask[] = [];
    for (const task of result.items) {
      const revision = logicalDocuments
        ? await logicalDocuments.getRevision({
            documentId: task.documentId,
            knowledgeSpaceId: params.id,
            revision: task.documentRevision,
            tenantId: context.get("subject").tenantId,
          })
        : null;
      if (revision && (await canReadRevision(assets, revision, candidateGrants)))
        visible.push(task);
    }
    return context.json(
      {
        items: visible,
        ...(result.nextCursor ? { nextCursor: encodePairCursor(result.nextCursor) } : {}),
      },
      200,
    );
  };

  register(listSpaceProcessingTasksRoute, (context) => listTasks(context));
  register(listDocumentProcessingTasksRoute, (context) =>
    listTasks(context, context.req.valid("param").documentId),
  );

  const getVisibleTask = async (
    // biome-ignore lint/suspicious/noExplicitAny: bounded OpenAPI handler context
    context: any,
    requiredAccess: "read" | "write",
  ) => {
    if (!tasks || !logicalDocuments) return null;
    const params = context.req.valid("param") as { documentId: string; id: string; taskId: string };
    if (!(await authorize(context, spaces, authorization, params.id, requiredAccess))) return null;
    const task = await tasks.get({
      documentId: params.documentId,
      knowledgeSpaceId: params.id,
      taskId: params.taskId,
      tenantId: context.get("subject").tenantId,
    });
    if (!task) return null;
    const revision = await logicalDocuments.getRevision({
      documentId: task.documentId,
      knowledgeSpaceId: params.id,
      revision: task.documentRevision,
      tenantId: context.get("subject").tenantId,
    });
    return revision &&
      (await canReadRevision(
        assets,
        revision,
        context.get("authorizationDecision")?.permissionSnapshot.candidateGrants ?? [],
      ))
      ? task
      : null;
  };

  register(getDocumentProcessingTaskRoute, async (context) => {
    const task = await getVisibleTask(context, "read");
    return task
      ? context.json(task, 200)
      : context.json({ error: "Processing task not found" }, 404);
  });

  register(streamDocumentProcessingTaskRoute, async (context) => {
    const task = await getVisibleTask(context, "read");
    if (!task) return context.json({ error: "Processing task not found" }, 404);
    const requestSignal = context.req.raw.signal;
    const lastEventId = context.req.header("last-event-id");
    let canceled = false;
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      cancel: () => {
        canceled = true;
      },
      start: (controller) => {
        void (async () => {
          const startedAt = Date.now();
          const deadline = startedAt + taskSseMaxDurationMs;
          let lastHeartbeatAt = startedAt;
          let lastSentEventId = lastEventId;
          let current: DocumentProcessingTask | null = task;
          try {
            while (!canceled && !requestSignal.aborted && Date.now() < deadline) {
              if (!current) break;
              for (const event of documentTaskSseEvents(current)) {
                if (event.id === lastSentEventId) continue;
                if (
                  !(await waitForSseCapacity(controller, requestSignal, () => canceled, deadline))
                ) {
                  break;
                }
                controller.enqueue(encoder.encode(formatTaskSseEvent(event)));
                lastSentEventId = event.id;
              }
              if (isTerminalTask(current) || canceled || requestSignal.aborted) break;
              const elapsedSinceHeartbeat = Date.now() - lastHeartbeatAt;
              if (elapsedSinceHeartbeat >= taskSseHeartbeatMs) {
                if (
                  !(await waitForSseCapacity(controller, requestSignal, () => canceled, deadline))
                ) {
                  break;
                }
                controller.enqueue(encoder.encode(`: heartbeat ${new Date().toISOString()}\n\n`));
                lastHeartbeatAt = Date.now();
              }
              await cancellableDelay(
                taskSsePollIntervalMs,
                requestSignal,
                () => canceled,
                deadline,
              );
              if (canceled || requestSignal.aborted || Date.now() >= deadline) break;
              // Re-authorize and reload on every poll. Permission revocation closes the stream
              // without emitting the now-hidden task.
              current = await settleBeforeSseDeadline(
                getVisibleTask(context, "read"),
                deadline,
                requestSignal,
              );
            }
          } catch (error) {
            if (!canceled && !requestSignal.aborted) controller.error(error);
            return;
          }
          if (!canceled) controller.close();
        })();
      },
    });
    return new Response(stream, {
      headers: {
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "content-type": "text/event-stream; charset=utf-8",
        "x-accel-buffering": "no",
      },
      status: 200,
    });
  });

  register(cancelDocumentProcessingTaskRoute, async (context) => {
    const task = await getVisibleTask(context, "write");
    if (!task) return context.json({ error: "Processing task not found" }, 404);
    if (!compilationJobs) return context.json({ error: "Processing task cannot be canceled" }, 409);
    const permissionSnapshot = await issueMutationPermission(
      access,
      authorization,
      context,
      task.knowledgeSpaceId,
    );
    if (!permissionSnapshot) {
      return context.json({ error: "Knowledge space access denied" }, 403);
    }
    try {
      await compilationJobs.cancel(task.id, "Canceled by request", {
        permissionSnapshot,
        requestedBySubjectId: context.get("subject").subjectId,
      });
      return context.json((await getVisibleTask(context, "read")) ?? task, 200);
    } catch {
      return context.json({ error: "Processing task cannot be canceled" }, 409);
    }
  });

  register(retryDocumentProcessingTaskRoute, async (context) => {
    const task = await getVisibleTask(context, "write");
    if (!task) return context.json({ error: "Processing task not found" }, 404);
    if (!compilationJobs?.retry)
      return context.json({ error: "Processing task cannot be retried" }, 409);
    const permissionSnapshot = await issueMutationPermission(
      access,
      authorization,
      context,
      task.knowledgeSpaceId,
    );
    if (!permissionSnapshot) {
      return context.json({ error: "Knowledge space access denied" }, 403);
    }
    try {
      await compilationJobs.retry(task.id, {
        permissionSnapshot,
        requestedBySubjectId: context.get("subject").subjectId,
      });
      return context.json((await getVisibleTask(context, "read")) ?? task, 200);
    } catch {
      return context.json({ error: "Processing task cannot be retried" }, 409);
    }
  });

  register(getDocumentSettingsRoute, async (context) => {
    if (!settings || !logicalDocuments)
      return context.json({ error: "Document settings not found" }, 404);
    const params = context.req.valid("param");
    if (
      !(await authorizeVisibleDocument(
        context,
        params,
        "read",
        logicalDocuments,
        assets,
        authorization,
        spaces,
      ))
    ) {
      return context.json({ error: "Document settings not found" }, 404);
    }
    const head = await settings.getHead({
      documentId: params.documentId,
      knowledgeSpaceId: params.id,
      tenantId: context.get("subject").tenantId,
    });
    return head
      ? context.json(toPublicSettingsHead(head), 200)
      : context.json({ error: "Document settings not found" }, 404);
  });

  register(patchDocumentSettingsRoute, async (context) => {
    if (
      !logicalDocuments ||
      !(await authorizeVisibleDocument(
        context,
        context.req.valid("param"),
        "write",
        logicalDocuments,
        assets,
        authorization,
        spaces,
      ))
    ) {
      return context.json({ error: "Document not found" }, 404);
    }
    if (!settingsChangeCoordinator)
      return context.json({ error: "Settings reindex coordinator unavailable" }, 503);
    const params = context.req.valid("param");
    const body = context.req.valid("json");
    const permissionSnapshot = await issueMutationPermission(
      access,
      authorization,
      context,
      params.id,
    );
    if (!permissionSnapshot) return context.json({ error: "Knowledge space access denied" }, 403);
    try {
      return context.json(
        await settingsChangeCoordinator.request({
          documentId: params.documentId,
          expectedSettingsHeadRevision: body.expectedSettingsHeadRevision,
          knowledgeSpaceId: params.id,
          permissionSnapshot,
          settings: body.settings,
          subjectId: context.get("subject").subjectId,
          tenantId: context.get("subject").tenantId,
        }),
        202,
      );
    } catch (error) {
      if (error instanceof LogicalDocumentConflictError)
        return context.json({ error: error.message }, 409);
      throw error;
    }
  });
}

function formatTaskSseEvent(event: ReturnType<typeof documentTaskSseEvents>[number]): string {
  return `id: ${event.id}\nevent: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
}

async function waitForSseCapacity(
  controller: ReadableStreamDefaultController<Uint8Array>,
  signal: AbortSignal,
  canceled: () => boolean,
  deadline: number,
): Promise<boolean> {
  while (
    (controller.desiredSize ?? 1) <= 0 &&
    !signal.aborted &&
    !canceled() &&
    Date.now() < deadline
  ) {
    await cancellableDelay(10, signal, canceled, deadline);
  }
  return !signal.aborted && !canceled() && Date.now() < deadline;
}

async function cancellableDelay(
  milliseconds: number,
  signal: AbortSignal,
  canceled: () => boolean,
  deadline = Number.POSITIVE_INFINITY,
): Promise<void> {
  if (signal.aborted || canceled()) return;
  const delay = Math.min(milliseconds, Math.max(0, deadline - Date.now()));
  if (delay === 0) return;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(finish, delay);
    signal.addEventListener("abort", finish, { once: true });
    function finish() {
      clearTimeout(timeout);
      signal.removeEventListener("abort", finish);
      resolve();
    }
  });
}

async function settleBeforeSseDeadline<T>(
  operation: Promise<T>,
  deadline: number,
  signal: AbortSignal,
): Promise<T | null> {
  const remaining = deadline - Date.now();
  if (remaining <= 0 || signal.aborted) return null;
  return new Promise<T | null>((resolve, reject) => {
    let settled = false;
    const finish = (value: T | null, error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      if (error !== undefined) reject(error);
      else resolve(value);
    };
    const abort = () => finish(null);
    const timeout = setTimeout(() => finish(null), remaining);
    signal.addEventListener("abort", abort, { once: true });
    void operation.then(
      (value) => finish(value),
      (error) => finish(null, error),
    );
  });
}

function positiveDuration(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > 60_000) {
    throw new Error(`${label} must be an integer between 1 and 60000`);
  }
}

async function issueMutationPermission(
  access: Pick<KnowledgeSpaceAccessService, "createPermissionSnapshot">,
  authorization: KnowledgeSpaceAuthorizationGuard,
  // biome-ignore lint/suspicious/noExplicitAny: shared bounded Hono context adapter
  context: any,
  knowledgeSpaceId: string,
): Promise<KnowledgeSpaceDurablePermissionReference | null> {
  const authenticatedApiKey = context.get("authenticatedApiKey");
  const expiresAt = Math.min(
    Date.now() + 60 * 60_000,
    authenticatedApiKey?.expiresAt
      ? Date.parse(authenticatedApiKey.expiresAt)
      : Number.POSITIVE_INFINITY,
  );
  try {
    const snapshot = await issueKnowledgeSpaceDurablePermission({
      access,
      ...(authenticatedApiKey ? { apiKey: authenticatedApiKey } : {}),
      authorization,
      callerKind: context.get("callerKind") ?? "interactive",
      expiresAt: new Date(expiresAt).toISOString(),
      knowledgeSpaceId,
      requiredAccess: "write",
      subject: context.get("subject"),
    });
    return {
      accessChannel: snapshot.accessChannel,
      id: snapshot.id,
      revision: snapshot.revision,
    };
  } catch (error) {
    if (error instanceof KnowledgeSpaceAuthorizationError) return null;
    throw error;
  }
}

async function authorize(
  // biome-ignore lint/suspicious/noExplicitAny: bounded OpenAPI handler context
  context: any,
  spaces: KnowledgeSpaceRepository,
  authorization: KnowledgeSpaceAuthorizationGuard,
  knowledgeSpaceId: string,
  requiredAccess: "read" | "write",
): Promise<boolean> {
  const subject = context.get("subject");
  if (!(await spaces.get({ id: knowledgeSpaceId, tenantId: subject.tenantId }))) return false;
  try {
    const decision = await authorization.authorize({
      callerKind: context.get("callerKind") ?? "interactive",
      knowledgeSpaceId,
      requiredAccess,
      subject,
    });
    context.set("authorizationDecision", decision);
    return true;
  } catch {
    return false;
  }
}

async function authorizeVisibleDocument(
  // biome-ignore lint/suspicious/noExplicitAny: bounded OpenAPI handler context
  context: any,
  params: { readonly documentId: string; readonly id: string },
  requiredAccess: "read" | "write",
  logicalDocuments: LogicalDocumentRepository,
  assets: Pick<DocumentAssetRepository, "get">,
  authorization: KnowledgeSpaceAuthorizationGuard,
  spaces: KnowledgeSpaceRepository,
): Promise<boolean> {
  if (!(await authorize(context, spaces, authorization, params.id, requiredAccess))) return false;
  const document = await logicalDocuments.get({
    documentId: params.documentId,
    knowledgeSpaceId: params.id,
    tenantId: context.get("subject").tenantId,
  });
  return Boolean(
    document &&
      (await canReadDocument(
        logicalDocuments,
        assets,
        document,
        context.get("authorizationDecision")?.permissionSnapshot.candidateGrants ?? [],
      )),
  );
}

async function authorizeVisibleRevision(
  // biome-ignore lint/suspicious/noExplicitAny: bounded OpenAPI handler context
  context: any,
  params: { readonly documentId: string; readonly id: string; readonly revision: number },
  requiredAccess: "read" | "write",
  logicalDocuments: LogicalDocumentRepository,
  assets: Pick<DocumentAssetRepository, "get">,
  authorization: KnowledgeSpaceAuthorizationGuard,
  spaces: KnowledgeSpaceRepository,
): Promise<boolean> {
  if (!(await authorize(context, spaces, authorization, params.id, requiredAccess))) return false;
  return canReadTargetRevision(context, params, logicalDocuments, assets);
}

async function canReadTargetRevision(
  // biome-ignore lint/suspicious/noExplicitAny: bounded OpenAPI handler context
  context: any,
  params: { readonly documentId: string; readonly id: string; readonly revision: number },
  logicalDocuments: LogicalDocumentRepository,
  assets: Pick<DocumentAssetRepository, "get">,
): Promise<boolean> {
  const revision = await logicalDocuments.getRevision({
    documentId: params.documentId,
    knowledgeSpaceId: params.id,
    revision: params.revision,
    tenantId: context.get("subject").tenantId,
  });
  return Boolean(
    revision &&
      (await canReadRevision(
        assets,
        revision,
        context.get("authorizationDecision")?.permissionSnapshot.candidateGrants ?? [],
      )),
  );
}

async function canReadDocument(
  logicalDocuments: LogicalDocumentRepository,
  assets: Pick<DocumentAssetRepository, "get">,
  document: LogicalDocumentWithActiveRevision,
  candidateGrants: readonly string[],
): Promise<boolean> {
  if (document.active) return canReadRevision(assets, document.active, candidateGrants);
  const latestVisible = await logicalDocuments.listRevisions({
    candidateGrants,
    documentId: document.id,
    knowledgeSpaceId: document.knowledgeSpaceId,
    limit: 1,
    tenantId: document.tenantId,
  });
  const revision = latestVisible.items[0];
  return Boolean(revision && (await canReadRevision(assets, revision, candidateGrants)));
}

async function canReadRevision(
  assets: Pick<DocumentAssetRepository, "get">,
  revision: DocumentRevision,
  candidateGrants: readonly string[],
): Promise<boolean> {
  const asset = await assets.get({
    id: revision.documentAssetId,
    knowledgeSpaceId: revision.knowledgeSpaceId,
  });
  return Boolean(
    asset &&
      asset.version === revision.documentAssetVersion &&
      candidatePermissionAllowsAsset(asset, candidateGrants),
  );
}

function toPublicDocument(document: LogicalDocumentWithActiveRevision) {
  return {
    ...(document.activeRevision ? { activeRevision: document.activeRevision } : {}),
    active: document.active ? toPublicRevision(document.active) : null,
    createdAt: document.createdAt,
    id: document.id,
    knowledgeSpaceId: document.knowledgeSpaceId,
    ...(document.providerItemId ? { providerItemId: document.providerItemId } : {}),
    rowVersion: document.rowVersion,
    ...(document.sourceId ? { sourceId: document.sourceId } : {}),
    status: document.status,
    title: document.title,
    updatedAt: document.updatedAt,
    userMetadata: document.userMetadata,
  };
}

function toPublicRevision(revision: DocumentRevision) {
  return {
    ...(revision.activatedAt ? { activatedAt: revision.activatedAt } : {}),
    contentHash: revision.contentHash,
    createdAt: revision.createdAt,
    documentAssetId: revision.documentAssetId,
    documentAssetVersion: revision.documentAssetVersion,
    documentId: revision.documentId,
    knowledgeSpaceId: revision.knowledgeSpaceId,
    mimeType: revision.mimeType,
    revision: revision.revision,
    sizeBytes: revision.sizeBytes,
    state: revision.state,
  };
}

function toPublicChunk(chunk: Awaited<ReturnType<DocumentChunkRepository["get"]>> & {}) {
  if (!chunk) throw new Error("Chunk is required");
  const { systemMetadata: _systemMetadata, tenantId: _tenantId, ...publicChunk } = chunk;
  return publicChunk;
}

function toPublicSettingsHead(head: DocumentSettingsHead) {
  return {
    activeRevision: head.activeRevision,
    profile: {
      ...(head.profile.activatedAt ? { activatedAt: head.profile.activatedAt } : {}),
      createdAt: head.profile.createdAt,
      revision: head.profile.revision,
      settings: head.profile.settings,
      state: "active" as const,
    },
    rowVersion: head.rowVersion,
    updatedAt: head.updatedAt,
  };
}

function encodePairCursor(cursor: { readonly createdAt: string; readonly id: string }): string {
  return `${encodeURIComponent(cursor.createdAt)}|${encodeURIComponent(cursor.id)}`;
}

function decodePairCursor(cursor: string): { readonly createdAt: string; readonly id: string } {
  const [createdAt, id, extra] = cursor.split("|");
  if (!createdAt || !id || extra !== undefined)
    throw new LogicalDocumentValidationError("Invalid cursor");
  return { createdAt: decodeURIComponent(createdAt), id: decodeURIComponent(id) };
}

function decodeRevisionCursor(cursor: string): number {
  const revision = Number(cursor);
  if (!Number.isSafeInteger(revision) || revision < 1)
    throw new LogicalDocumentValidationError("Invalid revision cursor");
  return revision;
}
