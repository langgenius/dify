import { describe, expect, it } from "vitest";

import {
  LegacySpaceCachePrefixes,
  knowledgeSpaceCacheNamespace,
  knowledgeSpaceCacheNamespaces,
} from "./knowledge-space-cache-namespace";

describe("knowledge-space cache namespaces", () => {
  it("provides deletion-stable prefixes without exposing raw tenant identity", () => {
    const input = { knowledgeSpaceId: "space/one", tenantId: "tenant/private" } as const;
    const namespace = knowledgeSpaceCacheNamespace({ ...input, kind: "knowledge-path" });

    expect(namespace).toContain("space-cache:v2:knowledge-path:tenant:");
    expect(namespace).toContain("space:space%2Fone:");
    expect(namespace).not.toContain(input.tenantId);
    expect(
      knowledgeSpaceCacheNamespace({ ...input, kind: "knowledge-path", tenantId: "tenant-2" }),
    ).not.toBe(namespace);
  });

  it("enumerates every production space-scoped cache for durable cleanup", () => {
    const namespaces = knowledgeSpaceCacheNamespaces({
      knowledgeSpaceId: "space-1",
      tenantId: "tenant-1",
    });

    expect(namespaces).toHaveLength(4);
    expect(namespaces.map((namespace) => namespace.split(":")[2])).toEqual([
      "contextual-enrichment",
      "evidence-bundle",
      "knowledge-path",
      "session-context",
    ]);
    expect(new Set(namespaces).size).toBe(namespaces.length);
    expect(LegacySpaceCachePrefixes).toContain("query-normalization:");
  });
});
