import type { OpenAPIHono } from "@hono/zod-openapi";

import type { KnowledgeGatewayEnv } from "./gateway-openapi-contracts";
import { provisionIntegratedKnowledgeSpaceRoute } from "./integrated-knowledge-space-provisioning-routes";
import { createWithOptionalKnowledgeSpaceSlug } from "./knowledge-space-creation";
import { createKnowledgeSpacePendingModelConfiguration } from "./knowledge-space-manifest-repository";
import {
  type IntegratedKnowledgeSpaceProvisioningRepository,
  KnowledgeSpaceProvisioningIdempotencyConflictError,
  KnowledgeSpaceProvisioningIncompleteReplayError,
} from "./knowledge-space-provisioning-repository";
import {
  DuplicateKnowledgeSpaceSlugError,
  KnowledgeSpaceCapacityExceededError,
} from "./knowledge-space-repository";

export function registerIntegratedKnowledgeSpaceProvisioningHandlers(input: {
  readonly app: OpenAPIHono<KnowledgeGatewayEnv>;
  readonly provisioning: IntegratedKnowledgeSpaceProvisioningRepository;
}): void {
  if (input.provisioning.provisioningMode !== "integrated") {
    throw new TypeError("The integrated provisioning route requires an integrated repository");
  }

  input.app.openapi(provisionIntegratedKnowledgeSpaceRoute, async (context) => {
    try {
      const subject = context.get("subject");
      const { embeddingProfile, idempotencyKey, retrievalProfile, ...createInput } =
        context.req.valid("json");
      const pendingModelConfiguration =
        embeddingProfile || retrievalProfile
          ? createKnowledgeSpacePendingModelConfiguration({
              ...(embeddingProfile ? { embeddingSelection: embeddingProfile } : {}),
              ...(retrievalProfile ? { retrievalProfile } : {}),
            })
          : undefined;
      const result = await createWithOptionalKnowledgeSpaceSlug(
        { ...createInput, tenantId: subject.tenantId },
        ({ description, iconRef, name, slug, tenantId }) =>
          input.provisioning.provision({
            createdBySubjectId: subject.subjectId,
            ...(description === undefined ? {} : { description }),
            ...(iconRef === undefined ? {} : { iconRef }),
            idempotencyKey,
            name,
            ...(pendingModelConfiguration ? { pendingModelConfiguration } : {}),
            slug,
            slugSource: createInput.slug === undefined ? "generated" : "explicit",
            tenantId,
          }),
      );
      return context.json(
        {
          ...result.space,
          configurationStatus: result.configurationStatus,
          replayed: result.replayed,
        },
        201,
      );
    } catch (error) {
      if (
        error instanceof DuplicateKnowledgeSpaceSlugError ||
        error instanceof KnowledgeSpaceProvisioningIdempotencyConflictError
      ) {
        return context.json(
          {
            ...(error instanceof KnowledgeSpaceProvisioningIdempotencyConflictError
              ? { code: error.code }
              : {}),
            error: error.message,
          },
          409,
        );
      }
      if (error instanceof KnowledgeSpaceCapacityExceededError) {
        return context.json({ error: error.message }, 429);
      }
      if (error instanceof KnowledgeSpaceProvisioningIncompleteReplayError) {
        return context.json({ code: error.code, error: error.message }, 503);
      }
      throw error;
    }
  });
}
