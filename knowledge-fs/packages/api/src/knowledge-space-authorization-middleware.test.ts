import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import type { KnowledgeGatewayEnv } from "./gateway-openapi-contracts";
import { createKnowledgeSpaceAuthorizationMiddleware } from "./knowledge-space-authorization-middleware";

const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const subject = {
  scopes: ["knowledge-spaces:*"],
  subjectId: "member-1",
  tenantId: "tenant-1",
};
const existingSpaces = {
  get: async () => ({ id: knowledgeSpaceId }),
};

describe("knowledge-space authorization middleware", () => {
  it.each([
    ["GET", `/knowledge-spaces/${knowledgeSpaceId}/sources`, "read"],
    ["GET", `/knowledge-spaces/${knowledgeSpaceId}/model-catalog`, "read"],
    ["POST", `/knowledge-spaces/${knowledgeSpaceId}/documents`, "write"],
    ["GET", `/knowledge-spaces/${knowledgeSpaceId}/failed-queries`, "write"],
    ["PUT", `/knowledge-spaces/${knowledgeSpaceId}/embedding-profile`, "admin"],
    ["PUT", `/knowledge-spaces/${knowledgeSpaceId}/retrieval-profile`, "admin"],
    ["POST", `/knowledge-spaces/${knowledgeSpaceId}/retrieval-tests`, "admin"],
    ["POST", `/knowledge-spaces/${knowledgeSpaceId}/model-preflights`, "admin"],
    ["GET", `/knowledge-spaces/${knowledgeSpaceId}/members`, "admin"],
    ["GET", `/knowledge-spaces/${knowledgeSpaceId}/status`, "admin"],
    ["GET", `/knowledge-spaces/${knowledgeSpaceId}/leases/active`, "admin"],
    ["GET", `/knowledge-spaces/${knowledgeSpaceId}/staged-commits`, "admin"],
    ["GET", `/knowledge-spaces/${knowledgeSpaceId}/profiles/embedding/revisions`, "admin"],
  ] as const)("maps %s %s to %s access", async (method, path, expectedAccess) => {
    const authorize = vi.fn(async () => ({
      accessContext: {},
      permissionSnapshot: {},
    }));
    const app = new Hono<KnowledgeGatewayEnv>();
    app.use("*", async (context, next) => {
      context.set("subject", subject);
      context.set("callerKind", "service_api");
      await next();
    });
    app.use(
      "/knowledge-spaces/*",
      createKnowledgeSpaceAuthorizationMiddleware({
        authorization: { authorize } as never,
        spaces: existingSpaces as never,
      }),
    );
    app.all("*", (context) => context.json({ ok: true }));

    expect((await app.request(path, { method })).status).toBe(200);
    expect(authorize).toHaveBeenCalledWith({
      callerKind: "service_api",
      knowledgeSpaceId,
      requiredAccess: expectedAccess,
      subject,
    });
  });

  it.each([
    `/knowledge-spaces/${knowledgeSpaceId}`,
    `/knowledge-spaces/${knowledgeSpaceId}/sources/018f0d60-7a49-7cc2-9c1b-5b36f18f2c43`,
    `/knowledge-spaces/${knowledgeSpaceId}/documents/018f0d60-7a49-7cc2-9c1b-5b36f18f2c44`,
    `/knowledge-spaces/${knowledgeSpaceId}/documents/bulk`,
  ])("delegates durable DELETE %s to its replay-aware service", async (path) => {
    const authorize = vi.fn();
    const get = vi.fn(async () => null);
    const app = new Hono<KnowledgeGatewayEnv>();
    app.use("*", async (context, next) => {
      context.set("subject", subject);
      await next();
    });
    app.use(
      "/knowledge-spaces/*",
      createKnowledgeSpaceAuthorizationMiddleware({
        authorization: { authorize },
        spaces: { get },
      }),
    );
    app.delete("*", (context) => context.json({ delegated: true }));

    const response = await app.request(path, { method: "DELETE" });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ delegated: true });
    expect(get).not.toHaveBeenCalled();
    expect(authorize).not.toHaveBeenCalled();
  });

  it("does not authorize the collection create/list endpoint", async () => {
    const authorize = vi.fn();
    const app = new Hono<KnowledgeGatewayEnv>();
    app.use("*", async (context, next) => {
      context.set("subject", subject);
      await next();
    });
    app.use(
      "/knowledge-spaces/*",
      createKnowledgeSpaceAuthorizationMiddleware({
        authorization: { authorize },
        spaces: existingSpaces as never,
      }),
    );
    app.all("*", (context) => context.json({ ok: true }));

    expect((await app.request("/knowledge-spaces")).status).toBe(200);
    expect(authorize).not.toHaveBeenCalled();
  });

  it("returns tenant-scoped 404 before ACL evaluation when the space is not visible", async () => {
    const authorize = vi.fn();
    const get = vi.fn(async () => null);
    const app = new Hono<KnowledgeGatewayEnv>();
    app.use("*", async (context, next) => {
      context.set("subject", subject);
      await next();
    });
    app.use(
      "/knowledge-spaces/*",
      createKnowledgeSpaceAuthorizationMiddleware({
        authorization: { authorize },
        spaces: { get },
      }),
    );
    app.all("*", (context) => context.json({ ok: true }));

    const response = await app.request(`/knowledge-spaces/${knowledgeSpaceId}/documents`);
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Knowledge space not found" });
    expect(get).toHaveBeenCalledWith({ id: knowledgeSpaceId, tenantId: subject.tenantId });
    expect(authorize).not.toHaveBeenCalled();
  });
});
