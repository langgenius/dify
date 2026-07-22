import { timingSafeEqual } from "node:crypto";
import type { AuthSubject } from "@knowledge/core";

import {
  type KnowledgeSpaceApiKey,
  hashKnowledgeSpaceApiKey,
} from "./knowledge-space-access-control";
import type {
  KnowledgeSpaceAuthorizationDecision,
  KnowledgeSpaceAuthorizationGuard,
  KnowledgeSpaceRequiredAccess,
} from "./knowledge-space-authorization";

const apiKeyPattern =
  /^kfs_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_([A-Za-z0-9_-]{32,256})$/i;
const sha256HexPattern = /^[0-9a-f]{64}$/i;
const dummyHash = "0".repeat(64);

export type ActiveKnowledgeSpaceApiKey = KnowledgeSpaceApiKey;

export interface KnowledgeSpaceApiKeyAccessReader {
  findActiveApiKeyById(input: { readonly id: string }): Promise<ActiveKnowledgeSpaceApiKey | null>;
  markApiKeyUsed?(input: {
    readonly id: string;
    readonly knowledgeSpaceId: string;
    readonly tenantId: string;
    readonly usedAt: string;
  }): Promise<unknown>;
}

export interface KnowledgeSpaceApiKeyAuthenticationResult {
  readonly authorization: KnowledgeSpaceAuthorizationDecision;
  /** Server-issued credential identity carried into durable permission snapshots. */
  readonly apiKey: {
    readonly expiresAt?: string | undefined;
    readonly id: string;
    readonly revision: number;
  };
  /** @deprecated Prefer apiKey.id. Kept for source compatibility with existing consumers. */
  readonly keyId: string;
  readonly subject: AuthSubject;
}

export interface KnowledgeSpaceApiKeyAuthenticator {
  authenticate(input: {
    /** Optional route/body target. When present it must match the key's persisted space exactly. */
    readonly knowledgeSpaceId?: string | undefined;
    readonly requiredAccess: KnowledgeSpaceRequiredAccess;
    readonly token: string;
  }): Promise<KnowledgeSpaceApiKeyAuthenticationResult>;
}

export class KnowledgeSpaceApiKeyAuthenticationError extends Error {
  readonly code = "INVALID_KNOWLEDGE_SPACE_API_KEY" as const;

  constructor() {
    super("Invalid knowledge space API key");
    this.name = "KnowledgeSpaceApiKeyAuthenticationError";
  }
}

export interface CreateKnowledgeSpaceApiKeyAuthenticatorOptions {
  readonly access: KnowledgeSpaceApiKeyAccessReader;
  readonly authorization: KnowledgeSpaceAuthorizationGuard;
  readonly now?: (() => string) | undefined;
}

export function createKnowledgeSpaceApiKeyAuthenticator({
  access,
  authorization,
  now = () => new Date().toISOString(),
}: CreateKnowledgeSpaceApiKeyAuthenticatorOptions): KnowledgeSpaceApiKeyAuthenticator {
  return {
    async authenticate(rawInput) {
      const token = rawInput.token.trim();
      const parsed = parseKnowledgeSpaceApiKeyToken(token);
      const presentedHash = safeHashApiKey(token);
      const record = parsed ? await access.findActiveApiKeyById({ id: parsed.keyId }) : null;

      // Always execute the constant-time comparison, including malformed and unknown IDs.
      const hashMatches = constantTimeApiKeyHashMatches(
        record?.keyHash ?? dummyHash,
        presentedHash,
      );
      const authenticatedAt = now();
      if (
        !parsed ||
        !record ||
        !hashMatches ||
        record.id !== parsed.keyId ||
        (rawInput.knowledgeSpaceId !== undefined &&
          record.knowledgeSpaceId !== requiredString(rawInput.knowledgeSpaceId)) ||
        record.status !== "active" ||
        record.revokedAt !== undefined ||
        isExpired(record.expiresAt, authenticatedAt)
      ) {
        throw new KnowledgeSpaceApiKeyAuthenticationError();
      }
      const tenantId = requiredString(record.tenantId);
      const knowledgeSpaceId = requiredString(record.knowledgeSpaceId);

      const subject: AuthSubject = {
        scopes: [],
        subjectId: requiredString(record.principalSubjectId),
        tenantId,
      };
      const authorizationDecision = await authorization.authorize({
        callerKind: "api_key",
        knowledgeSpaceId,
        requiredAccess: rawInput.requiredAccess,
        subject,
      });

      await access.markApiKeyUsed?.({
        id: record.id,
        knowledgeSpaceId,
        tenantId,
        usedAt: authenticatedAt,
      });

      return {
        authorization: authorizationDecision,
        apiKey: {
          ...(record.expiresAt ? { expiresAt: record.expiresAt } : {}),
          id: record.id,
          revision: record.revision,
        },
        keyId: record.id,
        subject,
      };
    },
  };
}

export function parseKnowledgeSpaceApiKeyToken(token: string): { readonly keyId: string } | null {
  const match = token.match(apiKeyPattern);
  return match?.[1] ? { keyId: match[1].toLowerCase() } : null;
}

export function constantTimeApiKeyHashMatches(
  expectedHash: string,
  presentedHash: string,
): boolean {
  const expectedIsValid = sha256HexPattern.test(expectedHash);
  const presentedIsValid = sha256HexPattern.test(presentedHash);
  const expectedBytes = Buffer.from(expectedIsValid ? expectedHash : dummyHash, "hex");
  const presentedBytes = Buffer.from(presentedIsValid ? presentedHash : dummyHash, "hex");
  const matches = timingSafeEqual(expectedBytes, presentedBytes);
  return expectedIsValid && presentedIsValid && matches;
}

function safeHashApiKey(token: string): string {
  try {
    return hashKnowledgeSpaceApiKey(token);
  } catch {
    return dummyHash;
  }
}

function isExpired(expiresAt: string | undefined, now: string): boolean {
  if (expiresAt === undefined) {
    return false;
  }
  const expiresAtMs = Date.parse(expiresAt);
  const nowMs = Date.parse(now);
  return !Number.isFinite(expiresAtMs) || !Number.isFinite(nowMs) || expiresAtMs <= nowMs;
}

function requiredString(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new KnowledgeSpaceApiKeyAuthenticationError();
  }
  return normalized;
}
