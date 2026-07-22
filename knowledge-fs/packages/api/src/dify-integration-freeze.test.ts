import { createHash } from "node:crypto";

import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import {
  type DifyIntegrationFreezeRepository,
  computeDifyIntegrationFreezeId,
  createDifyIntegrationFreezeMiddleware,
  decideDifyIntegrationFreeze,
} from "./dify-integration-freeze";
import type { KnowledgeGatewayEnv } from "./gateway-openapi-contracts";

const digest = `sha256:${"a".repeat(64)}`;

describe("Dify Workspace maintenance freeze", () => {
  it("computes the same canonical evidence digest as Dify", () => {
    const canonicalJson = JSON.stringify({
      freezeRevision: 7,
      namespaceId: "tenant-a",
      sourceRevisionDigest: digest,
      sourceTaskWatermark: 12,
    });

    expect(
      computeDifyIntegrationFreezeId({
        freezeRevision: 7,
        namespaceId: "tenant-a",
        sourceRevisionDigest: digest,
        sourceTaskWatermark: 12,
      }),
    ).toBe(`sha256:${createHash("sha256").update(canonicalJson, "utf8").digest("hex")}`);
  });

  it("replays exact evidence and rejects a conflicting revision", () => {
    const input = freezeInput();
    const inserted = decideDifyIntegrationFreeze(null, input, "2026-07-21T12:00:00.000Z");
    expect(inserted.kind).toBe("insert");
    expect(
      decideDifyIntegrationFreeze(inserted.result.state, input, "2026-07-21T12:01:00.000Z").kind,
    ).toBe("replay");
    const conflictingEvidence = { ...input, sourceTaskWatermark: 13 };
    expect(() =>
      decideDifyIntegrationFreeze(
        inserted.result.state,
        {
          ...conflictingEvidence,
          freezeId: computeDifyIntegrationFreezeId(conflictingEvidence),
        },
        "2026-07-21T12:01:00.000Z",
      ),
    ).toThrow(/conflicts/u);
  });

  it("blocks legacy mutations and new task admission after freeze while preserving reads", async () => {
    const repository = frozenRepository();
    const app = new Hono<KnowledgeGatewayEnv>();
    app.use("*", async (context, next) => {
      context.set("subject", {
        scopes: ["knowledge-spaces:*"],
        subjectId: "legacy-user",
        tenantId: "tenant-a",
      });
      context.set("callerKind", "interactive");
      await next();
    });
    app.use("*", createDifyIntegrationFreezeMiddleware(repository));
    app.all("*", (context) => context.body(null, 204));

    expect((await app.request("/knowledge-spaces/space-a/members")).status).toBe(204);
    expect(
      (
        await app.request("/knowledge-spaces/space-a/members", {
          method: "POST",
        })
      ).status,
    ).toBe(423);
    expect((await app.request("/research-tasks", { method: "POST" })).status).toBe(423);
  });

  it("records only legacy access/member/api-key traffic without resource identifiers", async () => {
    const metrics = { record: vi.fn() };
    const app = new Hono<KnowledgeGatewayEnv>();
    app.use("*", async (context, next) => {
      context.set("subject", {
        scopes: ["knowledge-spaces:*"],
        subjectId: "legacy-user",
        tenantId: "tenant-a",
      });
      context.set("callerKind", "interactive");
      await next();
    });
    app.use("*", createDifyIntegrationFreezeMiddleware(frozenRepository(), metrics));
    app.all("*", (context) => context.body(null, 204));

    await app.request("/knowledge-spaces/space-a/api-keys");
    await app.request("/knowledge-spaces/space-a/documents");

    expect(metrics.record).toHaveBeenCalledTimes(1);
    expect(metrics.record).toHaveBeenCalledWith({ method: "GET", routeKind: "api_key" });
  });
});

function freezeInput() {
  const evidence = {
    freezeRevision: 7,
    namespaceId: "tenant-a",
    sourceRevisionDigest: digest,
    sourceTaskWatermark: 12,
  };
  return { ...evidence, freezeId: computeDifyIntegrationFreezeId(evidence) };
}

function frozenRepository(): DifyIntegrationFreezeRepository {
  const input = freezeInput();
  return {
    freeze: vi.fn(),
    get: vi.fn(async () => ({
      ...input,
      frozenAt: "2026-07-21T12:00:00.000Z",
      updatedAt: "2026-07-21T12:00:00.000Z",
    })),
  };
}
