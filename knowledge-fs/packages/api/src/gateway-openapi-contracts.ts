import type { AuthSubject } from "@knowledge/core";
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
