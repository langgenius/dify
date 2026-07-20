import type { OpenAPIHono } from "@hono/zod-openapi";

import type { KnowledgeGatewayEnv } from "./gateway-openapi-contracts";
import type { KnowledgeSpaceRepository } from "./knowledge-space-repository";
import { PageIndexUpgradeBackfillTransitionError } from "./page-index-upgrade-backfill";
import {
  getPageIndexUpgradeBackfillRoute,
  retryPageIndexUpgradeBackfillRoute,
  startPageIndexUpgradeBackfillRoute,
} from "./page-index-upgrade-backfill-routes";
import type { PageIndexUpgradeBackfillService } from "./page-index-upgrade-backfill-runtime";

export function registerPageIndexUpgradeBackfillHandlers(input: {
  readonly app: OpenAPIHono<KnowledgeGatewayEnv>;
  readonly service?: PageIndexUpgradeBackfillService | undefined;
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

  input.app.openapi(getPageIndexUpgradeBackfillRoute, async (context) => {
    if (!input.service) {
      return context.json({ error: "PageIndex upgrade unavailable" }, 503);
    }
    const lookup = await scope(context);
    if (!lookup) {
      return context.json({ error: "Knowledge space not found" }, 404);
    }
    const job = await input.service.get(lookup);
    return job
      ? context.json(job, 200)
      : context.json({ error: "PageIndex upgrade backfill not found" }, 404);
  });

  input.app.openapi(startPageIndexUpgradeBackfillRoute, async (context) => {
    if (!input.service) {
      return context.json({ error: "PageIndex upgrade unavailable" }, 503);
    }
    const lookup = await scope(context);
    if (!lookup) {
      return context.json({ error: "Knowledge space not found" }, 404);
    }
    try {
      const existing = await input.service.get(lookup);
      if (existing) {
        return context.json(existing, 200);
      }
      const job = await input.service.start(lookup);
      return job ? context.json(job, 202) : context.body(null, 204);
    } catch (error) {
      if (error instanceof PageIndexUpgradeBackfillTransitionError) {
        return context.json({ error: error.message }, 409);
      }
      throw error;
    }
  });

  input.app.openapi(retryPageIndexUpgradeBackfillRoute, async (context) => {
    if (!input.service) {
      return context.json({ error: "PageIndex upgrade unavailable" }, 503);
    }
    const lookup = await scope(context);
    if (!lookup) {
      return context.json({ error: "Knowledge space not found" }, 404);
    }
    try {
      return context.json(await input.service.retry(lookup), 202);
    } catch (error) {
      if (error instanceof PageIndexUpgradeBackfillTransitionError) {
        return context.json({ error: error.message }, 409);
      }
      throw error;
    }
  });
}
