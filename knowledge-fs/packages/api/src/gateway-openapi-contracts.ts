import type { AuthSubject } from "@knowledge/core";
import type { DifyCapabilityV2SanitizedGrant } from "./dify-capability-v2-grant";
import type { KnowledgeSpaceApiKeyAuthenticationResult } from "./knowledge-space-api-key-authentication";
import type {
  KnowledgeSpaceAuthorizationDecision,
  KnowledgeSpaceCallerKind,
} from "./knowledge-space-authorization";

import { ErrorResponseSchema } from "./gateway-route-schemas";

export type KnowledgeGatewayEnv = {
  Variables: {
    /** Non-secret identity of the API key authenticated for this request. */
    authenticatedApiKey?: KnowledgeSpaceApiKeyAuthenticationResult["apiKey"];
    /** Persisted space binding for an authenticated knowledge-space API key. */
    authenticatedApiKeyKnowledgeSpaceId?: string;
    authorizationDecision?: KnowledgeSpaceAuthorizationDecision;
    callerKind?: KnowledgeSpaceCallerKind;
    /** Sanitized signed provenance for durable task admission; never contains bearer/raw jti. */
    capabilityV2Grant?: DifyCapabilityV2SanitizedGrant;
    rateLimitChecked: boolean;
    subject: AuthSubject;
    traceId: string;
  };
};

export const UnauthorizedResponse = {
  content: {
    "application/json": {
      schema: ErrorResponseSchema,
    },
  },
  description: "Unauthorized",
} as const;

export const ForbiddenResponse = {
  content: {
    "application/json": {
      schema: ErrorResponseSchema,
    },
  },
  description: "Forbidden",
} as const;
