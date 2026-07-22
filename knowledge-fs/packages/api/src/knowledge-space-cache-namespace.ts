import { createHash } from "node:crypto";

export const KnowledgeSpaceCacheKinds = [
  "contextual-enrichment",
  "evidence-bundle",
  "knowledge-path",
  "session-context",
] as const;
export type KnowledgeSpaceCacheKind = (typeof KnowledgeSpaceCacheKinds)[number];

/** V1 digest-only roots cannot be scoped to one space; deletion cleanup drains them globally. */
export const LegacySpaceCachePrefixes = [
  "contextual-enrichment:",
  "evidence-bundle:",
  "knowledge-path:",
  "query-normalization:",
  "session-context:",
] as const;

export type KnowledgeSpaceCacheNamespaceInput =
  | {
      readonly kind: "contextual-enrichment" | "evidence-bundle";
      readonly knowledgeSpaceId: string;
    }
  | {
      readonly kind: "knowledge-path" | "session-context";
      readonly knowledgeSpaceId: string;
      readonly tenantId: string;
    };

/**
 * Stable, non-secret namespace shared by cache writers and deletion cleanup. Versions and entry
 * digests are deliberately appended after this prefix so one deletion can invalidate every
 * generation of a space-scoped cache without exposing the raw tenant id.
 */
export function knowledgeSpaceCacheNamespace(input: KnowledgeSpaceCacheNamespaceInput): string {
  const space = cacheNamespaceSegment(input.knowledgeSpaceId, "knowledgeSpaceId");
  if ("tenantId" in input) {
    const tenantId = requiredValue(input.tenantId, "tenantId");
    const tenantDigest = createHash("sha256").update(tenantId).digest("hex");
    return `space-cache:v2:${input.kind}:tenant:${tenantDigest}:space:${space}:`;
  }
  return `space-cache:v2:${input.kind}:space:${space}:`;
}

/** All production space-scoped namespaces that a durable deletion job must drain. */
export function knowledgeSpaceCacheNamespaces(input: {
  readonly knowledgeSpaceId: string;
  readonly tenantId: string;
}): readonly string[] {
  return KnowledgeSpaceCacheKinds.map((kind) =>
    kind === "knowledge-path" || kind === "session-context"
      ? knowledgeSpaceCacheNamespace({ ...input, kind })
      : knowledgeSpaceCacheNamespace({ knowledgeSpaceId: input.knowledgeSpaceId, kind }),
  );
}

export function cacheNamespaceSegment(value: string, field: string): string {
  return encodeURIComponent(requiredValue(value, field));
}

function requiredValue(value: string, field: string): string {
  if (!value || value !== value.trim() || value.length > 512) {
    throw new Error(`Knowledge-space cache ${field} is invalid`);
  }
  return value;
}
