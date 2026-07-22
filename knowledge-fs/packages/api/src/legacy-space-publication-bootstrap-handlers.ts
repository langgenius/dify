import type { OpenAPIHono } from "@hono/zod-openapi";

import type { KnowledgeGatewayEnv } from "./gateway-openapi-contracts";
import type { KnowledgeSpaceRepository } from "./knowledge-space-repository";
import {
  KnowledgeSpaceDocumentMutationLeaseActiveError,
  LegacySpacePublicationBootstrapAlreadyPublishedError,
  LegacySpacePublicationBootstrapCapacityExceededError,
  LegacySpacePublicationBootstrapTransitionError,
} from "./legacy-space-publication-bootstrap";
import {
  getLegacySpacePublicationBootstrapRoute,
  retryLegacySpacePublicationBootstrapRoute,
  startLegacySpacePublicationBootstrapRoute,
} from "./legacy-space-publication-bootstrap-routes";
import type { LegacySpacePublicationBootstrapService } from "./legacy-space-publication-bootstrap-runtime";

export interface RegisterLegacySpacePublicationBootstrapHandlersOptions {
  readonly app: OpenAPIHono<KnowledgeGatewayEnv>;
  readonly service?: LegacySpacePublicationBootstrapService | undefined;
  readonly spaces: KnowledgeSpaceRepository;
}

export function registerLegacySpacePublicationBootstrapHandlers({
  app,
  service,
  spaces,
}: RegisterLegacySpacePublicationBootstrapHandlersOptions): void {
  app.openapi(startLegacySpacePublicationBootstrapRoute, async (context) => {
    if (!service) {
      return context.json({ error: "Legacy publication bootstrap unavailable" }, 503);
    }
    const subject = context.get("subject");
    const knowledgeSpaceId = context.req.valid("param").id;
    const space = await spaces.get({ id: knowledgeSpaceId, tenantId: subject.tenantId });
    if (!space) {
      return context.json({ error: "Knowledge space not found" }, 404);
    }
    try {
      return context.json(
        await service.start({ knowledgeSpaceId, tenantId: subject.tenantId }),
        202,
      );
    } catch (error) {
      if (
        error instanceof LegacySpacePublicationBootstrapAlreadyPublishedError ||
        error instanceof LegacySpacePublicationBootstrapCapacityExceededError ||
        error instanceof KnowledgeSpaceDocumentMutationLeaseActiveError ||
        error instanceof LegacySpacePublicationBootstrapTransitionError
      ) {
        return context.json({ error: error.message }, 409);
      }
      throw error;
    }
  });

  app.openapi(getLegacySpacePublicationBootstrapRoute, async (context) => {
    if (!service) {
      return context.json({ error: "Legacy publication bootstrap unavailable" }, 503);
    }
    const subject = context.get("subject");
    const knowledgeSpaceId = context.req.valid("param").id;
    const space = await spaces.get({ id: knowledgeSpaceId, tenantId: subject.tenantId });
    if (!space) {
      return context.json({ error: "Knowledge space not found" }, 404);
    }
    const job = await service.get({ knowledgeSpaceId, tenantId: subject.tenantId });
    return job
      ? context.json(job, 200)
      : context.json({ error: "Legacy publication bootstrap not found" }, 404);
  });

  app.openapi(retryLegacySpacePublicationBootstrapRoute, async (context) => {
    if (!service) {
      return context.json({ error: "Legacy publication bootstrap unavailable" }, 503);
    }
    const subject = context.get("subject");
    const knowledgeSpaceId = context.req.valid("param").id;
    const space = await spaces.get({ id: knowledgeSpaceId, tenantId: subject.tenantId });
    if (!space) {
      return context.json({ error: "Knowledge space not found" }, 404);
    }
    try {
      return context.json(
        await service.retry({ knowledgeSpaceId, tenantId: subject.tenantId }),
        202,
      );
    } catch (error) {
      if (
        error instanceof LegacySpacePublicationBootstrapTransitionError ||
        (error instanceof Error && error.message === "Legacy publication bootstrap not found")
      ) {
        return context.json({ error: error.message }, 409);
      }
      throw error;
    }
  });
}
