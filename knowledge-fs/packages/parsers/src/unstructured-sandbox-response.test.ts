import { describe, expect, it, vi } from "vitest";
import { createUnstructuredParserClient } from "./index";
import { classifyUnstructuredResourceResponse } from "./unstructured-sandbox-response";

const payload = (reason: string) => ({
  detail: {
    code: "PARSER_RESOURCE_REJECTED",
    reason,
    revision: "knowledgefs-unstructured-sandbox-v1",
  },
});

describe("sandbox response resource classification", () => {
  it.each([
    [413, "memory_bytes", "input"],
    [422, "attachments", "input"],
    [504, "wall_seconds", "timeout"],
  ] as const)(
    "classifies known %s %s without transport ambiguity",
    async (status, reason, kind) => {
      await expect(
        classifyUnstructuredResourceResponse(
          Response.json(payload(reason), { status }),
          new AbortController().signal,
        ),
      ).resolves.toEqual({ kind, reason });
    },
  );

  it.each([
    [504, payload("attachments")],
    [413, payload("wall_seconds")],
    [422, payload("arbitrary-untrusted-text")],
    [503, payload("memory_bytes")],
    [429, payload("memory_bytes")],
    [422, { detail: { ...payload("attachments").detail, revision: "unknown-v2" } }],
    [422, { detail: { ...payload("attachments").detail, extra: true } }],
    [422, { detail: "attachments" }],
    [422, null],
  ])("does not reinterpret unknown contracts %s %j", async (status, value) => {
    await expect(
      classifyUnstructuredResourceResponse(
        Response.json(value, { status: status as number }),
        new AbortController().signal,
      ),
    ).resolves.toBeUndefined();
  });

  it.each([
    [413, "memory_bytes", "provider_input"],
    [422, "attachments", "provider_input"],
    [504, "wall_seconds", "provider_timeout"],
  ] as const)("does not retry confirmed worker rejections %s", async (status, reason, code) => {
    const fetchImpl = vi.fn(async () => Response.json(payload(reason), { status }));
    const parser = createUnstructuredParserClient({
      endpoint: "https://parser.invalid",
      fetch: fetchImpl,
      maxRetries: 2,
    });
    await expect(
      parser.parse({
        body: new TextEncoder().encode("body"),
        documentAssetId: "asset",
        filename: "sample.pdf",
        mimeType: "application/pdf",
        version: 1,
      }),
    ).rejects.toMatchObject({ code, retryable: false, requestOutcomeAmbiguous: false });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
