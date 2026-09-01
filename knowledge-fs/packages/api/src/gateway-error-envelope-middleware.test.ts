import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { createKnowledgeFsErrorEnvelopeMiddleware } from "./gateway-error-envelope-middleware";

describe("createKnowledgeFsErrorEnvelopeMiddleware", () => {
  it("preserves compatible fields and adds an actionable failure", async () => {
    const app = new Hono<{ Variables: { traceId: string } }>();
    app.use(async (context, next) => {
      context.set("traceId", "trace-model");
      await next();
    });
    app.use(createKnowledgeFsErrorEnvelopeMiddleware());
    app.get("/model", (context) =>
      context.json(
        { code: "MODEL_SELECTION_NOT_FOUND", error: "provider payload must not escape" },
        422,
      ),
    );

    const response = await app.request("/model", {
      headers: { "X-KnowledgeFS-Error-Contract": "2" },
    });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      code: "MODEL_SELECTION_NOT_FOUND",
      error:
        "The selected model is no longer available in this workspace. Select another model before retrying.",
      failure: {
        action: "configure_model",
        category: "configuration",
        code: "MODEL_SELECTION_NOT_FOUND",
        message:
          "The selected model is no longer available in this workspace. Select another model before retrying.",
        retryPolicy: "after_configuration",
        traceId: "trace-model",
      },
    });
  });

  it("masks raw diagnostics on client errors as well as server errors", async () => {
    const app = new Hono();
    app.use(createKnowledgeFsErrorEnvelopeMiddleware());
    app.get("/invalid", (context) =>
      context.json(
        { code: "SOURCE_CREDENTIAL_CONFIG_INVALID", error: "Authorization: Bearer secret" },
        422,
      ),
    );

    const body = await (
      await app.request("/invalid", {
        headers: { "X-KnowledgeFS-Error-Contract": "2" },
      })
    ).json();

    expect(body).toMatchObject({
      code: "SOURCE_CREDENTIAL_CONFIG_INVALID",
      error: "The source credential configuration is invalid.",
      failure: {
        action: "configure_source",
        category: "configuration",
        retryPolicy: "after_configuration",
      },
    });
    expect(JSON.stringify(body)).not.toContain("secret");
  });

  it("masks legacy 5xx diagnostics and ignores non-JSON responses", async () => {
    const app = new Hono();
    app.use(createKnowledgeFsErrorEnvelopeMiddleware());
    app.get("/unsafe", (context) =>
      context.json({ error: "password=secret connection refused" }, 503),
    );
    app.get("/text", (context) => context.text("upstream secret", 503));

    const unsafe = await app.request("/unsafe", {
      headers: { "X-KnowledgeFS-Error-Contract": "2" },
    });
    const body = await unsafe.json();
    expect(body).toMatchObject({
      code: "KNOWLEDGE_FS_UNAVAILABLE",
      error: "KnowledgeFS is temporarily unavailable. Try again later.",
      failure: { code: "KNOWLEDGE_FS_UNAVAILABLE" },
    });
    expect(JSON.stringify(body)).not.toContain("secret");
    await expect(
      (
        await app.request("/text", {
          headers: { "X-KnowledgeFS-Error-Contract": "2" },
        })
      ).text(),
    ).resolves.toBe("upstream secret");
  });

  it("derives structured semantics from the HTTP status for unknown legacy codes", async () => {
    const app = new Hono();
    app.use(createKnowledgeFsErrorEnvelopeMiddleware());
    app.get("/forbidden", (context) =>
      context.json({ code: "FORBIDDEN", error: "membership lookup secret" }, 403),
    );

    const body = await (
      await app.request("/forbidden", {
        headers: { "X-KnowledgeFS-Error-Contract": "2" },
      })
    ).json();

    expect(body).toMatchObject({
      code: "FORBIDDEN",
      error: "You do not have permission to perform this KnowledgeFS operation.",
      failure: {
        category: "authorization",
        code: "KNOWLEDGE_FS_ACCESS_DENIED",
        retryPolicy: "never",
      },
    });
    expect(JSON.stringify(body)).not.toContain("secret");
  });

  it("preserves the actionable retrieval deletion conflict instead of collapsing it", async () => {
    const app = new Hono<{ Variables: { traceId: string } }>();
    app.use(async (context, next) => {
      context.set("traceId", "trace-retrieval-deletion");
      await next();
    });
    app.use(createKnowledgeFsErrorEnvelopeMiddleware());
    app.post("/queries", (context) =>
      context.json(
        {
          code: "RETRIEVAL_DELETION_IN_PROGRESS",
          error: "internal deletion admission detail",
        },
        409,
      ),
    );

    const response = await app.request("/queries", {
      headers: { "X-KnowledgeFS-Error-Contract": "2" },
      method: "POST",
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      code: "RETRIEVAL_DELETION_IN_PROGRESS",
      error: "This knowledge space is being deleted and cannot be searched.",
      failure: {
        category: "conflict",
        code: "RETRIEVAL_DELETION_IN_PROGRESS",
        message: "This knowledge space is being deleted and cannot be searched.",
        retryPolicy: "never",
        traceId: "trace-retrieval-deletion",
      },
    });
  });

  it("re-sanitizes pre-existing failure objects instead of trusting route payloads", async () => {
    const app = new Hono<{ Variables: { traceId: string } }>();
    app.use(async (context, next) => {
      context.set("traceId", "trusted-trace");
      await next();
    });
    app.use(createKnowledgeFsErrorEnvelopeMiddleware());
    app.get("/unsafe-failure", (context) =>
      context.json(
        {
          error: "Authorization: Bearer route-secret",
          failure: {
            action: "retry",
            category: "internal",
            code: "MODEL_CREDENTIAL_INVALID",
            message: "credential=route-secret",
            parameters: { attempt: 2, secret: "route-secret" },
            retryPolicy: "automatic",
            stage: "Authorization: Bearer route-secret",
            traceId: "spoofed-trace",
          },
        },
        422,
      ),
    );

    const body = await (
      await app.request("/unsafe-failure", {
        headers: { "X-KnowledgeFS-Error-Contract": "2" },
      })
    ).json();

    expect(body).toMatchObject({
      code: "MODEL_CREDENTIAL_INVALID",
      failure: {
        action: "configure_model",
        category: "configuration",
        code: "MODEL_CREDENTIAL_INVALID",
        parameters: { attempt: 2 },
        retryPolicy: "after_configuration",
        traceId: "trusted-trace",
      },
    });
    expect(JSON.stringify(body)).not.toContain("route-secret");
    expect(JSON.stringify(body)).not.toContain("spoofed-trace");
    expect(body.failure).not.toHaveProperty("stage");
  });

  it("keeps the legacy response shape unless the caller opts into version 2", async () => {
    const app = new Hono();
    app.use(createKnowledgeFsErrorEnvelopeMiddleware());
    app.get("/legacy", (context) => context.json({ error: "Legacy validation message" }, 400));

    await expect((await app.request("/legacy")).json()).resolves.toEqual({
      error: "Legacy validation message",
    });
  });
});
