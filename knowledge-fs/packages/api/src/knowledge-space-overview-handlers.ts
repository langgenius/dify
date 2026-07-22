import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AuthSubject } from "@knowledge/core";
import type { Context } from "hono";

import { currentCandidateGrants } from "./candidate-content-authorization";
import type { KnowledgeGatewayEnv } from "./gateway-openapi-contracts";
import {
  KnowledgeSpaceAccessError,
  type KnowledgeSpaceAccessService,
} from "./knowledge-space-access-control";
import {
  KnowledgeSpaceAuthorizationError,
  type KnowledgeSpaceAuthorizationGuard,
} from "./knowledge-space-authorization";
import { knowledgeSpaceAccessChannelForCallerKind } from "./knowledge-space-authorization";
import {
  type KnowledgeSpaceAttentionIssue,
  KnowledgeSpaceAttentionRevisionConflictError,
  KnowledgeSpaceOverviewLimitError,
  type KnowledgeSpaceOverviewRepository,
  decodeKnowledgeSpaceActivityCursor,
  encodeKnowledgeSpaceActivityCursor,
} from "./knowledge-space-overview";
import {
  getKnowledgeSpaceOverviewStatsRoute,
  getKnowledgeSpaceProductHealthRoute,
  listKnowledgeSpaceOverviewActivityRoute,
  listKnowledgeSpaceOverviewAttentionRoute,
  transitionKnowledgeSpaceOverviewAttentionRoute,
} from "./knowledge-space-overview-routes";
import type { KnowledgeSpaceRepository } from "./knowledge-space-repository";

const SOURCE_STALE_AFTER_MS = 7 * 24 * 60 * 60_000;
const WORKER_STALE_AFTER_MS = 5 * 60_000;

export function registerKnowledgeSpaceOverviewHandlers(input: {
  readonly access: Pick<KnowledgeSpaceAccessService, "createPermissionSnapshot">;
  readonly app: OpenAPIHono<KnowledgeGatewayEnv>;
  readonly authorization: KnowledgeSpaceAuthorizationGuard;
  readonly now: () => string;
  readonly overview?: KnowledgeSpaceOverviewRepository | undefined;
  readonly spaces: Pick<KnowledgeSpaceRepository, "get">;
}) {
  input.app.openapi(getKnowledgeSpaceOverviewStatsRoute, async (context) => {
    const scope = await authorizeOverview(input, context, context.req.valid("param").id, "read");
    if (scope instanceof Response) return scope;
    if (!input.overview)
      return context.json({ error: "Knowledge-space Overview is unavailable" }, 503);
    return context.json(
      await input.overview.getStats({
        candidateGrants: scope.candidateGrants,
        knowledgeSpaceId: scope.knowledgeSpaceId,
        now: input.now(),
        tenantId: scope.subject.tenantId,
      }),
      200,
    );
  });

  input.app.openapi(listKnowledgeSpaceOverviewActivityRoute, async (context) => {
    const scope = await authorizeOverview(input, context, context.req.valid("param").id, "read");
    if (scope instanceof Response) return scope;
    if (!input.overview)
      return context.json({ error: "Knowledge-space Overview is unavailable" }, 503);
    const query = context.req.valid("query");
    try {
      const result = await input.overview.listActivity({
        ...(query.action ? { action: query.action } : {}),
        candidateGrants: scope.candidateGrants,
        ...(query.cursor ? { cursor: decodeKnowledgeSpaceActivityCursor(query.cursor) } : {}),
        ...(query.from ? { from: query.from } : {}),
        knowledgeSpaceId: scope.knowledgeSpaceId,
        limit: query.limit,
        ...(query.resourceType ? { resourceType: query.resourceType } : {}),
        ...(query.result ? { result: query.result } : {}),
        tenantId: scope.subject.tenantId,
        ...(query.to ? { to: query.to } : {}),
      });
      return context.json(
        {
          items: result.items.map(toPublicActivity),
          ...(result.nextCursor
            ? { nextCursor: encodeKnowledgeSpaceActivityCursor(result.nextCursor) }
            : {}),
        },
        200,
      );
    } catch (error) {
      if (error instanceof KnowledgeSpaceOverviewLimitError || error instanceof URIError) {
        return context.json({ error: error.message }, 400);
      }
      if (error instanceof Error && error.message === "Invalid activity cursor") {
        return context.json({ error: error.message }, 400);
      }
      throw error;
    }
  });

  input.app.openapi(listKnowledgeSpaceOverviewAttentionRoute, async (context) => {
    const scope = await authorizeOverview(input, context, context.req.valid("param").id, "read");
    if (scope instanceof Response) return scope;
    if (!input.overview)
      return context.json({ error: "Knowledge-space Overview is unavailable" }, 503);
    const now = input.now();
    const query = context.req.valid("query");
    try {
      const issues = await input.overview.listAttention({
        candidateGrants: scope.candidateGrants,
        includeDismissed: query.includeDismissed,
        knowledgeSpaceId: scope.knowledgeSpaceId,
        limit: query.limit,
        now,
        staleBefore: new Date(Date.parse(now) - SOURCE_STALE_AFTER_MS).toISOString(),
        subjectId: scope.subject.subjectId,
        tenantId: scope.subject.tenantId,
      });
      return context.json({ items: issues.map(toPublicAttention) }, 200);
    } catch (error) {
      if (error instanceof KnowledgeSpaceOverviewLimitError) {
        return context.json({ error: error.message }, 400);
      }
      throw error;
    }
  });

  input.app.openapi(transitionKnowledgeSpaceOverviewAttentionRoute, async (context) => {
    const scope = await authorizeOverview(input, context, context.req.valid("param").id, "write");
    if (scope instanceof Response) return scope;
    if (!input.overview)
      return context.json({ error: "Knowledge-space Overview is unavailable" }, 503);
    const params = context.req.valid("param");
    const body = context.req.valid("json");
    try {
      const now = input.now();
      const permission = await issueOverviewPermission(context, input.access, scope, now);
      const issue = await input.overview.transitionAttention({
        actorSubjectId: scope.subject.subjectId,
        candidateGrants: scope.candidateGrants,
        ...(body.dismissedUntil ? { dismissedUntil: body.dismissedUntil } : {}),
        expectedRevision: body.expectedRevision,
        issueKey: params.issueKey,
        knowledgeSpaceId: scope.knowledgeSpaceId,
        now,
        permission,
        status: body.status,
        tenantId: scope.subject.tenantId,
      });
      return issue
        ? context.json(toPublicAttention(issue), 200)
        : context.json({ error: "Attention issue not found" }, 404);
    } catch (error) {
      if (error instanceof KnowledgeSpaceAccessError) {
        return context.json({ error: "Knowledge space access denied" }, 403);
      }
      if (error instanceof KnowledgeSpaceAttentionRevisionConflictError) {
        return context.json({ error: error.message }, 409);
      }
      throw error;
    }
  });

  input.app.openapi(getKnowledgeSpaceProductHealthRoute, async (context) => {
    const scope = await authorizeOverview(input, context, context.req.valid("param").id, "read");
    if (scope instanceof Response) return scope;
    if (!input.overview)
      return context.json({ error: "Knowledge-space Overview is unavailable" }, 503);
    const now = input.now();
    return context.json(
      toPublicHealth(
        await input.overview.getHealth({
          candidateGrants: scope.candidateGrants,
          knowledgeSpaceId: scope.knowledgeSpaceId,
          now,
          staleBefore: new Date(Date.parse(now) - SOURCE_STALE_AFTER_MS).toISOString(),
          tenantId: scope.subject.tenantId,
          workerStaleBefore: new Date(Date.parse(now) - WORKER_STALE_AFTER_MS).toISOString(),
        }),
      ),
      200,
    );
  });
}

async function issueOverviewPermission(
  context: Context<KnowledgeGatewayEnv>,
  access: Pick<KnowledgeSpaceAccessService, "createPermissionSnapshot">,
  scope: Exclude<Awaited<ReturnType<typeof authorizeOverview>>, Response>,
  now: string,
) {
  const callerKind = context.get("callerKind") ?? "interactive";
  const apiKey = context.get("authenticatedApiKey");
  const currentTime = Date.parse(now);
  const expiresAt = Math.min(
    currentTime + 24 * 60 * 60_000,
    apiKey?.expiresAt ? Date.parse(apiKey.expiresAt) : Number.POSITIVE_INFINITY,
  );
  const snapshot = await access.createPermissionSnapshot({
    accessChannel: knowledgeSpaceAccessChannelForCallerKind(callerKind),
    ...(apiKey ? { apiKey } : {}),
    expiresAt: new Date(expiresAt).toISOString(),
    knowledgeSpaceId: scope.knowledgeSpaceId,
    subjectId: scope.subject.subjectId,
    tenantId: scope.subject.tenantId,
  });
  return {
    accessChannel: snapshot.accessChannel,
    candidateGrants: [...snapshot.permissionScopes],
    permissionSnapshotId: snapshot.id,
    permissionSnapshotRevision: snapshot.revision,
    requestedBySubjectId: scope.subject.subjectId,
  };
}

async function authorizeOverview(
  input: {
    readonly authorization: KnowledgeSpaceAuthorizationGuard;
    readonly spaces: Pick<KnowledgeSpaceRepository, "get">;
  },
  context: Context<KnowledgeGatewayEnv>,
  knowledgeSpaceId: string,
  requiredAccess: "read" | "write",
) {
  const subject = context.get("subject") as AuthSubject;
  const space = await input.spaces.get({ id: knowledgeSpaceId, tenantId: subject.tenantId });
  if (!space) return context.json({ error: "Knowledge space not found" }, 404);
  try {
    const decision = await input.authorization.authorize({
      callerKind: context.get("callerKind") ?? "interactive",
      knowledgeSpaceId,
      requiredAccess,
      subject,
    });
    context.set("authorizationDecision", decision);
    const candidateGrants = currentCandidateGrants({ decision, knowledgeSpaceId, subject });
    if (!candidateGrants) return context.json({ error: "Knowledge space access denied" }, 403);
    return { candidateGrants, knowledgeSpaceId, subject };
  } catch (error) {
    if (error instanceof KnowledgeSpaceAuthorizationError) {
      return context.json({ code: error.code, error: error.message }, 403);
    }
    throw error;
  }
}

function toPublicActivity(
  event: Awaited<ReturnType<KnowledgeSpaceOverviewRepository["appendActivity"]>>,
) {
  return {
    action: event.action,
    actor: event.actor,
    details: event.details,
    id: event.id,
    occurredAt: event.occurredAt,
    resource: event.resource,
    result: event.result,
  };
}

function toPublicAttention(issue: KnowledgeSpaceAttentionIssue) {
  const { requiredPermissionScope: _requiredPermissionScope, ...publicIssue } = issue;
  return {
    ...publicIssue,
    action: { ...publicIssue.action },
    evidence: publicIssue.evidence.map((item) => ({ ...item })),
    resource: { ...publicIssue.resource },
  };
}

function toPublicHealth(
  health: Awaited<ReturnType<KnowledgeSpaceOverviewRepository["getHealth"]>>,
) {
  return {
    ...health,
    components: Object.fromEntries(
      Object.entries(health.components).map(([key, value]) => [
        key,
        { codes: [...value.codes], state: value.state },
      ]),
    ) as unknown as {
      [K in keyof typeof health.components]: {
        codes: string[];
        state: (typeof health.components)[K]["state"];
      };
    },
  };
}
