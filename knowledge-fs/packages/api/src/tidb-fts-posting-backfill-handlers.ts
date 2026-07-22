import type { OpenAPIHono } from "@hono/zod-openapi";

import type { KnowledgeGatewayEnv } from "./gateway-openapi-contracts";
import type { KnowledgeSpaceRepository } from "./knowledge-space-repository";
import { TidbFtsPostingBackfillTransitionError } from "./tidb-fts-posting-backfill";
import {
  getTidbFtsPostingBackfillRoute,
  retryTidbFtsPostingBackfillRoute,
  startTidbFtsPostingBackfillRoute,
} from "./tidb-fts-posting-backfill-routes";
import type { TidbFtsPostingBackfillService } from "./tidb-fts-posting-backfill-runtime";

export function registerTidbFtsPostingBackfillHandlers(input: {
  readonly app: OpenAPIHono<KnowledgeGatewayEnv>;
  readonly service?: TidbFtsPostingBackfillService | undefined;
  readonly spaces: KnowledgeSpaceRepository;
}): void {
  const scope = async (context: {
    get(name: "subject"): { readonly tenantId: string };
    req: { valid(name: "param"): { readonly id: string } };
  }) => {
    const subject = context.get("subject");
    const knowledgeSpaceId = context.req.valid("param").id;
    const space = await input.spaces.get({ id: knowledgeSpaceId, tenantId: subject.tenantId });
    return space ? { knowledgeSpaceId, tenantId: subject.tenantId } : null;
  };

  input.app.openapi(getTidbFtsPostingBackfillRoute, async (context) => {
    if (!input.service) {
      return context.json({ error: "TiDB FTS posting backfill unavailable" }, 503);
    }
    const lookup = await scope(context);
    if (!lookup) {
      return context.json({ error: "Knowledge space not found" }, 404);
    }
    const job = await input.service.get(lookup);
    return job
      ? context.json(publicJob(job), 200)
      : context.json({ error: "TiDB FTS posting backfill not found" }, 404);
  });

  input.app.openapi(startTidbFtsPostingBackfillRoute, async (context) => {
    if (!input.service) {
      return context.json({ error: "TiDB FTS posting backfill unavailable" }, 503);
    }
    const lookup = await scope(context);
    if (!lookup) {
      return context.json({ error: "Knowledge space not found" }, 404);
    }
    try {
      const existing = await input.service.get(lookup);
      if (existing) {
        return context.json(publicJob(existing), 200);
      }
      const job = await input.service.start(lookup);
      return job ? context.json(publicJob(job), 202) : context.body(null, 204);
    } catch (error) {
      if (error instanceof TidbFtsPostingBackfillTransitionError) {
        return context.json({ error: error.message }, 409);
      }
      throw error;
    }
  });

  input.app.openapi(retryTidbFtsPostingBackfillRoute, async (context) => {
    if (!input.service) {
      return context.json({ error: "TiDB FTS posting backfill unavailable" }, 503);
    }
    const lookup = await scope(context);
    if (!lookup) {
      return context.json({ error: "Knowledge space not found" }, 404);
    }
    try {
      return context.json(publicJob(await input.service.retry(lookup)), 202);
    } catch (error) {
      if (error instanceof TidbFtsPostingBackfillTransitionError) {
        return context.json({ error: error.message }, 409);
      }
      throw error;
    }
  });
}

function publicJob<T extends { readonly leaseToken?: string | undefined }>(
  job: T,
): Omit<T, "leaseToken"> {
  const { leaseToken: _leaseToken, ...output } = job;
  return output;
}
