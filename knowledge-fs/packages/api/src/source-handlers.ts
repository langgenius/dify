import type { OpenAPIHono } from "@hono/zod-openapi";

import {
  CANDIDATE_VISIBILITY_SCAN_BUDGET_EXCEEDED_MESSAGE,
  CandidateVisibilityScanBudgetExceededError,
  candidatePermissionScopeAllows,
  currentCandidateGrants,
} from "./candidate-content-authorization";
import {
  mergeSourceMetadataPatch,
  redactSourceMetadata,
  toSourceResponse,
} from "./core-resource-response-schemas";
import { DeletionLifecycleFenceActiveError } from "./deletion-lifecycle-fence";
import { DeletionObjectWriteAdmissionError } from "./deletion-object-write-admission";
import type { KnowledgeGatewayEnv } from "./gateway-openapi-contracts";
import type { KnowledgeSpaceRepository } from "./knowledge-space-repository";
import type { OnlineDocumentConnector } from "./online-document-connector";
import type { OnlineDriveConnector } from "./online-drive-connector";
import type { SourceConnectionService } from "./source-connection";
import {
  SOURCE_DOCUMENT_REPLACEMENT_SAGA_REQUIRED,
  SOURCE_DOCUMENT_REPLACEMENT_SAGA_REQUIRED_MESSAGE,
  readCrawledState,
  syncCrawledPages,
} from "./source-crawl-sync";
import {
  SourceCredentialMutationError,
  type SourceCredentialService,
  SourceCredentialUnavailableError,
} from "./source-credential-service";
import type { SourceCredentialTester } from "./source-credential-tester";
import type {
  FailedSourceDocument,
  SourceDocumentInput,
  SourceDocumentMaterializer,
} from "./source-document-materializer";
import { safeSourceOperationError, sourceOperationFailureMetadata } from "./source-operation-error";
import {
  SourceCapacityExceededError,
  type SourceCursor,
  type SourceRepository,
  SourceVersionConflictError,
} from "./source-repository";
import {
  browseSourceFilesRoute,
  crawlSourceRoute,
  createSourceRoute,
  getSourceRoute,
  importSourceFilesRoute,
  importSourcePagesRoute,
  listSourcePagesRoute,
  listSourcesRoute,
  revokeSourceCredentialsRoute,
  rotateSourceCredentialsRoute,
  testSourceCredentialsRoute,
  updateSourceRoute,
} from "./source-routes";
import { SourceSyncPolicyError, parseSourceSyncPolicy } from "./source-sync-policy";
import type { WebsiteCrawlConnector } from "./website-crawl-connector";

import type { Source } from "@knowledge/core";

const SOURCE_LIST_MAX_SCAN_PAGES = 10;
const DIFY_MANAGED_CREDENTIALS_MESSAGE = "Datasource credentials are managed by Dify";

export interface RegisterSourceHandlersOptions {
  readonly app: OpenAPIHono<KnowledgeGatewayEnv>;
  readonly inlineSourceCredentialsAllowed?: boolean | undefined;
  readonly onlineDocumentConnector?: OnlineDocumentConnector | undefined;
  readonly onlineDriveConnector?: OnlineDriveConnector | undefined;
  readonly sourceCredentialTester?: SourceCredentialTester | undefined;
  readonly sourceConnections?: SourceConnectionService | undefined;
  readonly sourceCredentials?: SourceCredentialService | undefined;
  readonly sourceDocumentMaterializer?: SourceDocumentMaterializer | undefined;
  readonly sources: SourceRepository;
  readonly spaces: KnowledgeSpaceRepository;
  readonly websiteCrawlConnector?: WebsiteCrawlConnector | undefined;
  /** Compatibility-only synchronous mutation endpoints. Must be false with Source product. */
  readonly legacyMutationEndpointsEnabled?: boolean | undefined;
}

export function registerSourceHandlers({
  app,
  inlineSourceCredentialsAllowed = true,
  onlineDocumentConnector,
  onlineDriveConnector,
  sourceCredentialTester,
  sourceConnections,
  sourceCredentials,
  sourceDocumentMaterializer,
  sources,
  spaces,
  websiteCrawlConnector,
  legacyMutationEndpointsEnabled = true,
}: RegisterSourceHandlersOptions): void {
  app.openapi(createSourceRoute, async (context) => {
    const subject = context.get("subject");
    const params = context.req.valid("param");
    const body = context.req.valid("json");
    const space = await spaces.get({ id: params.id, tenantId: subject.tenantId });

    if (!space) {
      return context.json({ error: "Knowledge space not found" }, 404);
    }

    const candidateGrants = sourceCandidateGrants(context, params.id);
    if (!candidateGrants) {
      return context.json({ error: "Knowledge space access denied" }, 403);
    }
    if (!candidatePermissionScopeAllows(body.permissionScope ?? [], candidateGrants)) {
      return context.json({ error: "Source permission scope exceeds caller grants" }, 403);
    }

    try {
      if (body.metadata?.syncPolicy !== undefined) {
        parseSourceSyncPolicy(body.metadata.syncPolicy);
      }

      // Stamp the owning tenant so the background sync scheduler can run connectors for this
      // source without a request subject. Credentials are split into SecretStore before the source
      // row is created; the public DTO never receives the resulting opaque reference.
      const metadata = { ...(body.metadata ?? {}), tenantId: subject.tenantId };
      const credentials = body.credentials ?? readInlineCredentials(body.metadata);
      if (credentials && !inlineSourceCredentialsAllowed) {
        return context.json({ error: DIFY_MANAGED_CREDENTIALS_MESSAGE }, 400);
      }
      if (body.connectionId && credentials) {
        return context.json(
          { error: "Connection binding and inline credentials are mutually exclusive" },
          400,
        );
      }
      if (body.connectionId) {
        if (!sourceConnections) {
          return context.json({ error: "Source connection service is not configured" }, 503);
        }
        const connection = await sourceConnections.get({
          connectionId: body.connectionId,
          knowledgeSpaceId: params.id,
          tenantId: subject.tenantId,
        });
        if (!connection) return context.json({ error: "Source connection not found" }, 404);
        if (connection.status !== "active") {
          return context.json({ error: "Source connection is not active" }, 409);
        }
      }
      if (credentials && !sourceCredentials) {
        return context.json({ error: "Source SecretStore is not configured" }, 503);
      }
      const source = sourceCredentials
        ? await sourceCredentials.create({
            ...(body.connectionId ? { connectionId: body.connectionId } : {}),
            ...(credentials ? { credentials } : {}),
            knowledgeSpaceId: params.id,
            metadata,
            name: body.name,
            ...(body.permissionScope ? { permissionScope: body.permissionScope } : {}),
            ...(body.status ? { status: body.status } : {}),
            tenantId: subject.tenantId,
            type: body.type,
            uri: body.uri,
          })
        : await sources.create({
            ...(body.connectionId ? { connectionId: body.connectionId } : {}),
            knowledgeSpaceId: params.id,
            metadata: redactSourceMetadata(metadata),
            name: body.name,
            ...(body.permissionScope ? { permissionScope: body.permissionScope } : {}),
            ...(body.status ? { status: body.status } : {}),
            type: body.type,
            uri: body.uri,
          });

      return context.json(toSourceResponse(source), 201);
    } catch (error) {
      if (error instanceof SourceSyncPolicyError) {
        return context.json({ error: error.message }, 400);
      }

      if (error instanceof SourceCapacityExceededError) {
        return context.json({ error: error.message }, 429);
      }

      throw error;
    }
  });

  app.openapi(listSourcesRoute, async (context) => {
    const subject = context.get("subject");
    const params = context.req.valid("param");
    const query = context.req.valid("query");
    const space = await spaces.get({ id: params.id, tenantId: subject.tenantId });

    if (!space) {
      return context.json({ error: "Knowledge space not found" }, 404);
    }

    const candidateGrants = sourceCandidateGrants(context, params.id);
    if (!candidateGrants) {
      return context.json({ error: "Knowledge space access denied" }, 403);
    }

    let result: Awaited<ReturnType<typeof listReadableSources>>;
    try {
      result = await listReadableSources({
        ...(query.cursor ? { cursor: { id: query.cursor } } : {}),
        candidateGrants,
        knowledgeSpaceId: params.id,
        limit: query.limit,
        repository: sources,
      });
    } catch (error) {
      if (error instanceof CandidateVisibilityScanBudgetExceededError) {
        return context.json(
          { code: error.code, error: CANDIDATE_VISIBILITY_SCAN_BUDGET_EXCEEDED_MESSAGE },
          503,
        );
      }
      throw error;
    }

    return context.json(
      {
        items: result.items.map((source) => toSourceResponse(source)),
        ...(result.nextCursor ? { nextCursor: result.nextCursor.id } : {}),
      },
      200,
    );
  });

  app.openapi(getSourceRoute, async (context) => {
    const subject = context.get("subject");
    const params = context.req.valid("param");
    const space = await spaces.get({ id: params.id, tenantId: subject.tenantId });

    if (!space) {
      return context.json({ error: "Source not found" }, 404);
    }

    const candidateGrants = sourceCandidateGrants(context, params.id);
    if (!candidateGrants) {
      return context.json({ error: "Knowledge space access denied" }, 403);
    }

    const source = await readableSource(context, sources, params.id, params.sourceId);

    if (!source) {
      return context.json({ error: "Source not found" }, 404);
    }

    return context.json(toSourceResponse(source), 200);
  });

  app.openapi(updateSourceRoute, async (context) => {
    const subject = context.get("subject");
    const params = context.req.valid("param");
    const body = context.req.valid("json");
    const space = await spaces.get({ id: params.id, tenantId: subject.tenantId });

    if (!space) {
      return context.json({ error: "Source not found" }, 404);
    }

    const candidateGrants = sourceCandidateGrants(context, params.id);
    if (!candidateGrants) {
      return context.json({ error: "Knowledge space access denied" }, 403);
    }

    if (!inlineSourceCredentialsAllowed && readInlineCredentials(body.metadata)) {
      return context.json({ error: DIFY_MANAGED_CREDENTIALS_MESSAGE }, 400);
    }

    if (body.metadata?.syncPolicy !== undefined) {
      try {
        parseSourceSyncPolicy(body.metadata.syncPolicy);
      } catch (error) {
        if (error instanceof SourceSyncPolicyError) {
          return context.json({ error: error.message }, 400);
        }

        throw error;
      }
    }

    try {
      let source = null;
      const maxAttempts = body.expectedVersion === undefined ? 3 : 1;

      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const fresh = await sources.get({ id: params.sourceId, knowledgeSpaceId: params.id });

        if (!fresh) {
          break;
        }
        if (!candidatePermissionScopeAllows(fresh.permissionScope, candidateGrants)) {
          break;
        }

        if (body.expectedVersion !== undefined && body.expectedVersion !== fresh.version) {
          throw new SourceVersionConflictError(params.sourceId, body.expectedVersion);
        }

        try {
          source = await sources.update({
            expectedVersion: fresh.version,
            id: params.sourceId,
            knowledgeSpaceId: params.id,
            ...(body.metadata === undefined
              ? {}
              : {
                  metadata: {
                    ...mergeSourceMetadataPatch(fresh.metadata, body.metadata),
                    // Never trust a client-supplied tenant stamp.
                    tenantId: subject.tenantId,
                  },
                }),
            ...(body.name === undefined ? {} : { name: body.name }),
            ...(body.status === undefined ? {} : { status: body.status }),
          });
          break;
        } catch (error) {
          if (
            error instanceof SourceVersionConflictError &&
            body.expectedVersion === undefined &&
            attempt + 1 < maxAttempts
          ) {
            continue;
          }

          throw error;
        }
      }

      if (!source) {
        return context.json({ error: "Source not found" }, 404);
      }

      return context.json(toSourceResponse(source), 200);
    } catch (error) {
      if (
        error instanceof DeletionLifecycleFenceActiveError ||
        error instanceof DeletionObjectWriteAdmissionError
      ) {
        return context.json({ error: "Knowledge space or source deletion is active" }, 409);
      }
      if (error instanceof SourceVersionConflictError) {
        return context.json({ code: "SOURCE_VERSION_CONFLICT", error: error.message }, 409);
      }

      throw error;
    }
  });

  app.openapi(rotateSourceCredentialsRoute, async (context) => {
    const subject = context.get("subject");
    const params = context.req.valid("param");
    const body = context.req.valid("json");
    const space = await spaces.get({ id: params.id, tenantId: subject.tenantId });
    if (!space) {
      return context.json({ error: "Source not found" }, 404);
    }
    if (!(await readableSource(context, sources, params.id, params.sourceId))) {
      return context.json({ error: "Source not found" }, 404);
    }
    if (!inlineSourceCredentialsAllowed) {
      return context.json({ error: DIFY_MANAGED_CREDENTIALS_MESSAGE }, 409);
    }
    if (!sourceCredentials) {
      return context.json({ error: "Source SecretStore is not configured" }, 503);
    }
    try {
      const source = await sourceCredentials.rotate({
        credentials: body.credentials,
        expectedVersion: body.expectedVersion,
        knowledgeSpaceId: params.id,
        sourceId: params.sourceId,
        tenantId: subject.tenantId,
      });
      return source
        ? context.json(toSourceResponse(source), 200)
        : context.json({ error: "Source not found" }, 404);
    } catch (error) {
      if (
        error instanceof DeletionLifecycleFenceActiveError ||
        error instanceof DeletionObjectWriteAdmissionError
      ) {
        return context.json({ error: "Knowledge space or source deletion is active" }, 409);
      }
      if (error instanceof SourceVersionConflictError) {
        return context.json({ code: "SOURCE_VERSION_CONFLICT", error: error.message }, 409);
      }
      if (error instanceof SourceCredentialMutationError) {
        return context.json({ error: error.message }, 503);
      }
      throw error;
    }
  });

  app.openapi(revokeSourceCredentialsRoute, async (context) => {
    const subject = context.get("subject");
    const params = context.req.valid("param");
    const query = context.req.valid("query");
    const space = await spaces.get({ id: params.id, tenantId: subject.tenantId });
    if (!space) {
      return context.json({ error: "Source not found" }, 404);
    }
    if (!(await readableSource(context, sources, params.id, params.sourceId))) {
      return context.json({ error: "Source not found" }, 404);
    }
    if (!inlineSourceCredentialsAllowed) {
      return context.json({ error: DIFY_MANAGED_CREDENTIALS_MESSAGE }, 409);
    }
    if (!sourceCredentials) {
      return context.json({ error: "Source SecretStore is not configured" }, 503);
    }
    try {
      const source = await sourceCredentials.revoke({
        expectedVersion: query.expectedVersion,
        knowledgeSpaceId: params.id,
        sourceId: params.sourceId,
        tenantId: subject.tenantId,
      });
      return source
        ? context.json(toSourceResponse(source), 200)
        : context.json({ error: "Source not found" }, 404);
    } catch (error) {
      if (error instanceof SourceVersionConflictError) {
        return context.json({ code: "SOURCE_VERSION_CONFLICT", error: error.message }, 409);
      }
      if (error instanceof SourceCredentialMutationError) {
        return context.json({ error: error.message }, 503);
      }
      throw error;
    }
  });

  app.openapi(crawlSourceRoute, async (context) => {
    if (!legacyMutationEndpointsEnabled) {
      return context.json({ error: "Durable Source workflow endpoint is required" }, 409);
    }
    const subject = context.get("subject");
    const params = context.req.valid("param");
    const space = await spaces.get({ id: params.id, tenantId: subject.tenantId });

    if (!space) {
      return context.json({ error: "Source not found" }, 404);
    }

    const source = await readableSource(context, sources, params.id, params.sourceId);

    if (!source) {
      return context.json({ error: "Source not found" }, 404);
    }

    if (source.type !== "web") {
      return context.json({ error: "Source is not a website crawl source" }, 400);
    }

    if (!websiteCrawlConnector) {
      return context.json({ error: "Website crawl connector is not configured" }, 501);
    }

    let syncSource: Source;
    try {
      const claimed = await sources.update({
        expectedVersion: source.version,
        id: source.id,
        knowledgeSpaceId: params.id,
        status: "syncing",
      });
      if (!claimed) return context.json({ error: "Source not found" }, 404);
      syncSource = claimed;
    } catch (error) {
      if (error instanceof SourceVersionConflictError) {
        return context.json({ code: "SOURCE_VERSION_CONFLICT", error: error.message }, 409);
      }
      throw error;
    }

    try {
      const connectorSource = await resolveConnectorSource({
        sourceConnections,
        source: syncSource,
        sourceCredentials,
        tenantId: subject.tenantId,
      });
      const result = await websiteCrawlConnector.crawl({
        source: connectorSource,
        tenantId: subject.tenantId,
        userId: subject.subjectId,
        ...(context.req.raw.signal ? { signal: context.req.raw.signal } : {}),
      });

      const materialization = sourceDocumentMaterializer
        ? await syncCrawledPages(
            {
              pages: result.pages,
              source: syncSource,
              tenantId: subject.tenantId,
            },
            { sourceDocumentMaterializer },
          )
        : undefined;

      const committed = await sources.update({
        expectedVersion: syncSource.version,
        id: syncSource.id,
        knowledgeSpaceId: params.id,
        metadata: {
          ...syncSource.metadata,
          ...(materialization
            ? {
                crawled: {
                  ...readCrawledState(syncSource.metadata),
                  ...materialization.crawledState,
                },
              }
            : {}),
          sync: {
            completed: result.completed ?? null,
            failed: materialization ? materialization.failed.length : null,
            imported: materialization ? materialization.imported.length : null,
            pageCount: result.pages.length,
            replaced: materialization ? materialization.replaced : null,
            skipped: materialization ? materialization.skipped : null,
            status: result.status ?? null,
            total: result.total ?? null,
          },
        },
        status: "active",
      });
      if (!committed) return context.json({ error: "Source not found" }, 404);

      return context.json(
        {
          pages: result.pages.map((page) => ({
            content: page.content,
            ...(page.description === undefined ? {} : { description: page.description }),
            sourceUrl: page.sourceUrl,
            ...(page.title === undefined ? {} : { title: page.title }),
          })),
          ...(result.completed === undefined ? {} : { completed: result.completed }),
          ...(materialization ? { failed: materialization.failed.length } : {}),
          ...(materialization ? { imported: materialization.imported.length } : {}),
          ...(materialization ? { replaced: materialization.replaced } : {}),
          ...(materialization ? { skipped: materialization.skipped } : {}),
          ...(result.status === undefined ? {} : { status: result.status }),
          ...(result.total === undefined ? {} : { total: result.total }),
        },
        200,
      );
    } catch (error) {
      if (error instanceof SourceVersionConflictError) {
        return context.json({ code: "SOURCE_VERSION_CONFLICT", error: error.message }, 409);
      }
      const failure = safeSourceOperationError("websiteCrawl", error);
      await sources
        .update({
          expectedVersion: syncSource.version,
          id: syncSource.id,
          knowledgeSpaceId: params.id,
          metadata: {
            ...syncSource.metadata,
            sync: sourceOperationFailureMetadata(failure),
          },
          status: "error",
        })
        .catch(() => undefined);

      return context.json({ code: failure.code, error: failure.message }, 502);
    }
  });

  app.openapi(listSourcePagesRoute, async (context) => {
    const subject = context.get("subject");
    const params = context.req.valid("param");
    const query = context.req.valid("query");
    const space = await spaces.get({ id: params.id, tenantId: subject.tenantId });

    if (!space) {
      return context.json({ error: "Source not found" }, 404);
    }

    const source = await readableSource(context, sources, params.id, params.sourceId);

    if (!source) {
      return context.json({ error: "Source not found" }, 404);
    }

    if (source.type !== "connector") {
      return context.json({ error: "Source is not an online-document connector" }, 400);
    }

    if (!onlineDocumentConnector) {
      return context.json({ error: "Online-document connector is not configured" }, 501);
    }

    try {
      const connectorSource = await resolveConnectorSource({
        sourceConnections,
        source,
        sourceCredentials,
        tenantId: subject.tenantId,
      });
      const result = await onlineDocumentConnector.listPages({
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        limit: query.limit,
        source: connectorSource,
        tenantId: subject.tenantId,
        userId: subject.subjectId,
        ...(context.req.raw.signal ? { signal: context.req.raw.signal } : {}),
      });

      return context.json(
        {
          ...(result.nextCursor === undefined ? {} : { nextCursor: result.nextCursor }),
          workspaces: result.workspaces.map((workspace) => ({
            pages: workspace.pages.map((page) => ({
              ...(page.lastEditedTime === undefined ? {} : { lastEditedTime: page.lastEditedTime }),
              pageId: page.pageId,
              pageName: page.pageName,
              ...(page.parentId === undefined ? {} : { parentId: page.parentId }),
              type: page.type,
            })),
            ...(workspace.total === undefined ? {} : { total: workspace.total }),
            ...(workspace.workspaceId === undefined ? {} : { workspaceId: workspace.workspaceId }),
            ...(workspace.workspaceName === undefined
              ? {}
              : { workspaceName: workspace.workspaceName }),
          })),
        },
        200,
      );
    } catch (error) {
      const failure = safeSourceOperationError("onlineDocumentRequest", error);
      return context.json({ code: failure.code, error: failure.message }, 502);
    }
  });

  app.openapi(importSourcePagesRoute, async (context) => {
    if (!legacyMutationEndpointsEnabled) {
      return context.json({ error: "Durable Source workflow endpoint is required" }, 409);
    }
    const subject = context.get("subject");
    const params = context.req.valid("param");
    const body = context.req.valid("json");
    const space = await spaces.get({ id: params.id, tenantId: subject.tenantId });

    if (!space) {
      return context.json({ error: "Source not found" }, 404);
    }

    const source = await readableSource(context, sources, params.id, params.sourceId);

    if (!source) {
      return context.json({ error: "Source not found" }, 404);
    }

    if (source.type !== "connector") {
      return context.json({ error: "Source is not an online-document connector" }, 400);
    }

    if (!onlineDocumentConnector || !sourceDocumentMaterializer) {
      return context.json({ error: "Online-document connector is not configured" }, 501);
    }

    let syncSource: Source;
    try {
      const claimed = await sources.update({
        expectedVersion: source.version,
        id: source.id,
        knowledgeSpaceId: params.id,
        status: "syncing",
      });
      if (!claimed) return context.json({ error: "Source not found" }, 404);
      syncSource = claimed;
    } catch (error) {
      if (error instanceof SourceVersionConflictError) {
        return context.json({ code: "SOURCE_VERSION_CONFLICT", error: error.message }, 409);
      }
      throw error;
    }

    try {
      const connectorSource = await resolveConnectorSource({
        sourceConnections,
        source: syncSource,
        sourceCredentials,
        tenantId: subject.tenantId,
      });
      const importedState = readImportedState(syncSource.metadata);
      const documents: SourceDocumentInput[] = [];
      const failed: FailedSourceDocument[] = [];
      const skipped: string[] = [];
      const pending = new Map<string, { lastEditedTime?: string; pageId: string }>();

      for (const page of body.pages) {
        const prior = importedState[page.pageId];
        if (page.lastEditedTime !== undefined && prior?.lastEditedTime === page.lastEditedTime) {
          skipped.push(page.pageId);
          continue;
        }

        const filename = onlineDocumentFilename(page.name ?? page.pageId, page.pageId);
        if (prior) {
          failed.push({
            code: SOURCE_DOCUMENT_REPLACEMENT_SAGA_REQUIRED,
            error: SOURCE_DOCUMENT_REPLACEMENT_SAGA_REQUIRED_MESSAGE,
            filename,
          });
          continue;
        }

        try {
          const content = await onlineDocumentConnector.getPageContent({
            page: { pageId: page.pageId, type: page.type, workspaceId: page.workspaceId },
            source: connectorSource,
            tenantId: subject.tenantId,
            userId: subject.subjectId,
            ...(context.req.raw.signal ? { signal: context.req.raw.signal } : {}),
          });

          documents.push({
            body: textEncoder.encode(content.content),
            filename,
            metadata: {
              dataSourceInfo: {
                pageId: page.pageId,
                type: page.type,
                workspaceId: page.workspaceId,
              },
              dataSourceType: "online_document",
            },
            mimeType: "text/markdown",
          });
          pending.set(filename, {
            pageId: page.pageId,
            ...(page.lastEditedTime === undefined ? {} : { lastEditedTime: page.lastEditedTime }),
          });
        } catch (error) {
          const failure = safeSourceOperationError("onlineDocumentPageFetch", error);
          failed.push({ code: failure.code, error: failure.message, filename });
        }
      }

      const materialization = await sourceDocumentMaterializer.materialize({
        documents,
        knowledgeSpaceId: params.id,
        permissionScope: syncSource.permissionScope,
        sourceId: syncSource.id,
        tenantId: subject.tenantId,
      });
      const allFailed = [...failed, ...materialization.failed];
      const nextImported = { ...importedState };
      for (const materialized of materialization.documents) {
        const info = pending.get(materialized.filename);
        if (info) {
          nextImported[info.pageId] = {
            documentAssetId: materialized.documentAssetId,
            ...(info.lastEditedTime === undefined ? {} : { lastEditedTime: info.lastEditedTime }),
          };
        }
      }

      const committed = await sources.update({
        expectedVersion: syncSource.version,
        id: syncSource.id,
        knowledgeSpaceId: params.id,
        metadata: {
          ...syncSource.metadata,
          imported: { ...readImportedState(syncSource.metadata), ...nextImported },
          sync: {
            failed: allFailed.length,
            imported: materialization.documents.length,
            requested: body.pages.length,
            skipped: skipped.length,
          },
        },
        status: "active",
      });
      if (!committed) return context.json({ error: "Source not found" }, 404);

      return context.json(
        {
          documents: materialization.documents.map(({ documentAssetId, filename }) => ({
            documentAssetId,
            filename,
          })),
          failed: allFailed,
          skipped,
        },
        200,
      );
    } catch (error) {
      if (
        error instanceof DeletionLifecycleFenceActiveError ||
        error instanceof DeletionObjectWriteAdmissionError
      ) {
        return context.json({ error: "Knowledge space or source deletion is active" }, 409);
      }
      if (error instanceof SourceVersionConflictError) {
        return context.json({ code: "SOURCE_VERSION_CONFLICT", error: error.message }, 409);
      }
      const failure = safeSourceOperationError("onlineDocumentImport", error);
      await sources
        .update({
          expectedVersion: syncSource.version,
          id: syncSource.id,
          knowledgeSpaceId: params.id,
          metadata: {
            ...syncSource.metadata,
            sync: sourceOperationFailureMetadata(failure),
          },
          status: "error",
        })
        .catch(() => undefined);

      return context.json({ code: failure.code, error: failure.message }, 502);
    }
  });

  app.openapi(testSourceCredentialsRoute, async (context) => {
    const subject = context.get("subject");
    const params = context.req.valid("param");
    const space = await spaces.get({ id: params.id, tenantId: subject.tenantId });

    if (!space) {
      return context.json({ error: "Source not found" }, 404);
    }

    const source = await readableSource(context, sources, params.id, params.sourceId);

    if (!source) {
      return context.json({ error: "Source not found" }, 404);
    }

    if (!sourceCredentialTester) {
      return context.json({ error: "Source credential tester is not configured" }, 501);
    }

    try {
      const connectorSource = await resolveConnectorSource({
        sourceConnections,
        source,
        sourceCredentials,
        tenantId: subject.tenantId,
      });
      const result = await sourceCredentialTester.test({
        source: connectorSource,
        tenantId: subject.tenantId,
        userId: subject.subjectId,
        ...(context.req.raw.signal ? { signal: context.req.raw.signal } : {}),
      });

      if (result.valid || result.error === undefined) {
        return context.json({ valid: result.valid }, 200);
      }

      const failure = safeSourceOperationError("credentialTest", result.error);
      return context.json({ code: failure.code, error: failure.message, valid: result.valid }, 200);
    } catch (error) {
      const failure = safeSourceOperationError("credentialTest", error);
      return context.json({ code: failure.code, error: failure.message }, 502);
    }
  });

  app.openapi(browseSourceFilesRoute, async (context) => {
    const subject = context.get("subject");
    const params = context.req.valid("param");
    const query = context.req.valid("query");
    const space = await spaces.get({ id: params.id, tenantId: subject.tenantId });

    if (!space) {
      return context.json({ error: "Source not found" }, 404);
    }

    const source = await readableSource(context, sources, params.id, params.sourceId);

    if (!source) {
      return context.json({ error: "Source not found" }, 404);
    }

    if (source.type !== "connector") {
      return context.json({ error: "Source is not an online-drive connector" }, 400);
    }

    if (!onlineDriveConnector) {
      return context.json({ error: "Online-drive connector is not configured" }, 501);
    }

    try {
      const connectorSource = await resolveConnectorSource({
        sourceConnections,
        source,
        sourceCredentials,
        tenantId: subject.tenantId,
      });
      const result = await onlineDriveConnector.browse({
        source: connectorSource,
        tenantId: subject.tenantId,
        userId: subject.subjectId,
        ...(query.bucket === undefined ? {} : { bucket: query.bucket }),
        ...(query.continuationToken === undefined
          ? {}
          : { continuationToken: query.continuationToken }),
        ...(query.maxKeys === undefined ? {} : { maxKeys: query.maxKeys }),
        ...(query.prefix === undefined ? {} : { prefix: query.prefix }),
        ...(context.req.raw.signal ? { signal: context.req.raw.signal } : {}),
      });

      return context.json(
        {
          buckets: result.buckets.map((bucket) => ({
            ...(bucket.bucket === undefined ? {} : { bucket: bucket.bucket }),
            ...(bucket.continuationToken === undefined
              ? {}
              : { continuationToken: bucket.continuationToken }),
            files: bucket.files.map((file) => ({
              id: file.id,
              name: file.name,
              ...(file.size === undefined ? {} : { size: file.size }),
              type: file.type,
            })),
            ...(bucket.isTruncated === undefined ? {} : { isTruncated: bucket.isTruncated }),
          })),
        },
        200,
      );
    } catch (error) {
      const failure = safeSourceOperationError("onlineDriveRequest", error);
      return context.json({ code: failure.code, error: failure.message }, 502);
    }
  });

  app.openapi(importSourceFilesRoute, async (context) => {
    if (!legacyMutationEndpointsEnabled) {
      return context.json({ error: "Durable Source workflow endpoint is required" }, 409);
    }
    const subject = context.get("subject");
    const params = context.req.valid("param");
    const body = context.req.valid("json");
    const space = await spaces.get({ id: params.id, tenantId: subject.tenantId });

    if (!space) {
      return context.json({ error: "Source not found" }, 404);
    }

    const source = await readableSource(context, sources, params.id, params.sourceId);

    if (!source) {
      return context.json({ error: "Source not found" }, 404);
    }

    if (source.type !== "connector") {
      return context.json({ error: "Source is not an online-drive connector" }, 400);
    }

    if (!onlineDriveConnector || !sourceDocumentMaterializer) {
      return context.json({ error: "Online-drive connector is not configured" }, 501);
    }

    let syncSource: Source;
    try {
      const claimed = await sources.update({
        expectedVersion: source.version,
        id: source.id,
        knowledgeSpaceId: params.id,
        status: "syncing",
      });
      if (!claimed) return context.json({ error: "Source not found" }, 404);
      syncSource = claimed;
    } catch (error) {
      if (error instanceof SourceVersionConflictError) {
        return context.json({ code: "SOURCE_VERSION_CONFLICT", error: error.message }, 409);
      }
      throw error;
    }

    try {
      const connectorSource = await resolveConnectorSource({
        sourceConnections,
        source: syncSource,
        sourceCredentials,
        tenantId: subject.tenantId,
      });
      const documents: SourceDocumentInput[] = [];
      const failed: FailedSourceDocument[] = [];
      const importedFiles = readImportedFilesState(syncSource.metadata);
      const pending = new Map<string, ImportedFileState & { readonly id: string }>();

      for (const file of body.files) {
        if (importedFiles[file.id]) {
          failed.push({
            code: SOURCE_DOCUMENT_REPLACEMENT_SAGA_REQUIRED,
            error: SOURCE_DOCUMENT_REPLACEMENT_SAGA_REQUIRED_MESSAGE,
            filename: file.name,
          });
          continue;
        }
        try {
          const download = await onlineDriveConnector.download({
            file: { id: file.id, ...(file.bucket === undefined ? {} : { bucket: file.bucket }) },
            source: connectorSource,
            tenantId: subject.tenantId,
            userId: subject.subjectId,
            ...(context.req.raw.signal ? { signal: context.req.raw.signal } : {}),
          });

          documents.push({
            body: download.body,
            filename: file.name,
            metadata: {
              dataSourceInfo: {
                fileId: file.id,
                ...(file.bucket === undefined ? {} : { bucket: file.bucket }),
              },
              dataSourceType: "online_drive",
            },
            mimeType: file.mimeType ?? mimeTypeForFilename(file.name),
          });
          pending.set(file.name, {
            id: file.id,
            name: file.name,
            ...(file.bucket === undefined ? {} : { bucket: file.bucket }),
            ...(file.mimeType === undefined ? {} : { mimeType: file.mimeType }),
          });
        } catch (error) {
          const failure = safeSourceOperationError("onlineDriveFileDownload", error);
          failed.push({ code: failure.code, error: failure.message, filename: file.name });
        }
      }

      const materialization = await sourceDocumentMaterializer.materialize({
        documents,
        knowledgeSpaceId: params.id,
        permissionScope: syncSource.permissionScope,
        sourceId: syncSource.id,
        tenantId: subject.tenantId,
      });
      const allFailed = [...failed, ...materialization.failed];
      const nextImportedFiles = readImportedFilesState(syncSource.metadata);
      for (const materialized of materialization.documents) {
        const info = pending.get(materialized.filename);
        if (info) {
          const { id, ...state } = info;
          nextImportedFiles[id] = state;
        }
      }

      const committed = await sources.update({
        expectedVersion: syncSource.version,
        id: syncSource.id,
        knowledgeSpaceId: params.id,
        metadata: {
          ...syncSource.metadata,
          importedFiles: {
            ...readImportedFilesState(syncSource.metadata),
            ...nextImportedFiles,
          },
          sync: {
            failed: allFailed.length,
            imported: materialization.documents.length,
            requested: body.files.length,
          },
        },
        status: "active",
      });
      if (!committed) return context.json({ error: "Source not found" }, 404);

      return context.json(
        {
          documents: materialization.documents.map(({ documentAssetId, filename }) => ({
            documentAssetId,
            filename,
          })),
          failed: allFailed,
          skipped: [],
        },
        200,
      );
    } catch (error) {
      if (
        error instanceof DeletionLifecycleFenceActiveError ||
        error instanceof DeletionObjectWriteAdmissionError
      ) {
        return context.json({ error: "Knowledge space or source deletion is active" }, 409);
      }
      if (error instanceof SourceVersionConflictError) {
        return context.json({ code: "SOURCE_VERSION_CONFLICT", error: error.message }, 409);
      }
      const failure = safeSourceOperationError("onlineDriveImport", error);
      await sources
        .update({
          expectedVersion: syncSource.version,
          id: syncSource.id,
          knowledgeSpaceId: params.id,
          metadata: {
            ...syncSource.metadata,
            sync: sourceOperationFailureMetadata(failure),
          },
          status: "error",
        })
        .catch(() => undefined);

      return context.json({ code: failure.code, error: failure.message }, 502);
    }
  });
}

type SourceRequestContext = Parameters<
  Parameters<OpenAPIHono<KnowledgeGatewayEnv>["openapi"]>[1]
>[0];

function sourceCandidateGrants(
  context: SourceRequestContext,
  knowledgeSpaceId: string,
): readonly string[] | null {
  const subject = context.get("subject");
  const capabilityGrant = context.get("capabilityV2Grant");
  return currentCandidateGrants({
    capabilityGrant,
    decision: context.get("authorizationDecision"),
    knowledgeSpaceId,
    subject,
  });
}

async function readableSource(
  context: SourceRequestContext,
  repository: SourceRepository,
  knowledgeSpaceId: string,
  sourceId: string,
): Promise<Source | null> {
  const candidateGrants = sourceCandidateGrants(context, knowledgeSpaceId);
  if (!candidateGrants) {
    return null;
  }
  const source = await repository.get({ id: sourceId, knowledgeSpaceId });
  return source && candidatePermissionScopeAllows(source.permissionScope, candidateGrants)
    ? source
    : null;
}

export async function listReadableSources({
  candidateGrants,
  cursor,
  knowledgeSpaceId,
  limit,
  repository,
}: {
  readonly candidateGrants: readonly string[];
  readonly cursor?: SourceCursor | undefined;
  readonly knowledgeSpaceId: string;
  readonly limit: number;
  readonly repository: SourceRepository;
}): Promise<{ readonly items: Source[]; readonly nextCursor?: SourceCursor }> {
  const readable: Source[] = [];
  let scanCursor = cursor;
  let reachedEnd = false;

  for (let scannedPages = 0; scannedPages < SOURCE_LIST_MAX_SCAN_PAGES; scannedPages += 1) {
    const page = await repository.list({
      ...(scanCursor ? { cursor: scanCursor } : {}),
      knowledgeSpaceId,
      limit,
    });
    for (const source of page.items) {
      if (candidatePermissionScopeAllows(source.permissionScope, candidateGrants)) {
        readable.push(source);
        if (readable.length > limit) {
          break;
        }
      }
    }
    if (readable.length > limit) {
      break;
    }
    if (!page.nextCursor) {
      reachedEnd = true;
      break;
    }
    scanCursor = page.nextCursor;
  }

  const items = readable.slice(0, limit);
  const lastItem = items.at(-1);
  if (readable.length <= limit && !reachedEnd) {
    throw new CandidateVisibilityScanBudgetExceededError();
  }
  return {
    items,
    ...(readable.length > limit && lastItem ? { nextCursor: { id: lastItem.id } } : {}),
  };
}

const textEncoder = new TextEncoder();

// Includes the page id so filenames are unique per page (used to fold materialized documents back
// into the imported state, and to avoid object-key-independent name collisions).
export function onlineDocumentFilename(name: string, pageId: string): string {
  const base = slugPart(name).slice(0, 90);
  const suffix = slugPart(pageId).slice(0, 40);
  const combined = suffix ? `${base}-${suffix}` : base;

  return `${combined.replace(/^-+/u, "") || "page"}.md`;
}

function slugPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "");
}

const MIME_TYPES_BY_EXTENSION: Readonly<Record<string, string>> = {
  csv: "text/csv",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  htm: "text/html",
  html: "text/html",
  json: "application/json",
  markdown: "text/markdown",
  md: "text/markdown",
  pdf: "application/pdf",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xml: "application/xml",
};

export function mimeTypeForFilename(filename: string): string {
  const extension = /\.([a-zA-Z0-9]+)$/u.exec(filename)?.[1]?.toLowerCase();

  return (extension && MIME_TYPES_BY_EXTENSION[extension]) || "application/octet-stream";
}

export interface ImportedPageState {
  readonly documentAssetId?: string | undefined;
  readonly lastEditedTime?: string | undefined;
}

export function readImportedState(
  metadata: Readonly<Record<string, unknown>>,
): Record<string, ImportedPageState> {
  const value = metadata.imported;

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const result: Record<string, ImportedPageState> = {};

  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      const record = raw as Record<string, unknown>;
      result[key] = {
        ...(typeof record.documentAssetId === "string"
          ? { documentAssetId: record.documentAssetId }
          : {}),
        ...(typeof record.lastEditedTime === "string"
          ? { lastEditedTime: record.lastEditedTime }
          : {}),
      };
    }
  }

  return result;
}

/** Per-file provenance recorded by online-drive imports so scheduled sync can re-download. */
export interface ImportedFileState {
  readonly bucket?: string | undefined;
  readonly mimeType?: string | undefined;
  readonly name: string;
}

export function readImportedFilesState(
  metadata: Readonly<Record<string, unknown>>,
): Record<string, ImportedFileState> {
  const value = metadata.importedFiles;

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const result: Record<string, ImportedFileState> = {};

  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      const record = raw as Record<string, unknown>;

      if (typeof record.name === "string" && record.name) {
        result[key] = {
          name: record.name,
          ...(typeof record.bucket === "string" ? { bucket: record.bucket } : {}),
          ...(typeof record.mimeType === "string" ? { mimeType: record.mimeType } : {}),
        };
      }
    }
  }

  return result;
}

function readInlineCredentials(
  metadata: Readonly<Record<string, unknown>> | undefined,
): Record<string, unknown> | undefined {
  const credentials = metadata?.credentials;
  if (!credentials || typeof credentials !== "object" || Array.isArray(credentials)) {
    return undefined;
  }
  return { ...(credentials as Record<string, unknown>) };
}

async function resolveConnectorSource(input: {
  readonly source: Source;
  readonly sourceConnections?: Pick<SourceConnectionService, "resolve"> | undefined;
  readonly sourceCredentials?: SourceCredentialService | undefined;
  readonly tenantId: string;
}): Promise<Source> {
  if (input.source.connectionId) {
    if (!input.sourceConnections) throw new SourceCredentialUnavailableError();
    return input.sourceConnections.resolve({ source: input.source, tenantId: input.tenantId });
  }
  if (input.sourceCredentials) {
    return input.sourceCredentials.resolve({ source: input.source, tenantId: input.tenantId });
  }
  if (input.source.credentialRef) {
    throw new SourceCredentialUnavailableError();
  }
  return input.source;
}
