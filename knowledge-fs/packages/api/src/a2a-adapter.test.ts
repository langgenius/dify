import { describe, expect, it } from "vitest";

import { createA2AAdapter } from "./a2a-adapter";

describe("createA2AAdapter", () => {
  it("serves an isolated agent card without requiring Knowledge gateway contracts", async () => {
    const app = createA2AAdapter({
      agentUrl: "https://knowledge.example/a2a",
      description: "Knowledge research agent",
      name: "KnowledgeFS Research",
      skills: [
        {
          description: "Runs bounded research against tenant-scoped knowledge spaces.",
          id: "knowledge-research",
          name: "Knowledge Research",
          tags: ["research", "knowledge"],
        },
      ],
      version: "0.1.0",
    });

    const response = await app.request("/.well-known/agent-card.json");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      capabilities: {
        streaming: false,
      },
      defaultInputModes: ["text/plain", "application/json"],
      defaultOutputModes: ["application/json"],
      description: "Knowledge research agent",
      name: "KnowledgeFS Research",
      preferredTransport: "JSONRPC",
      protocolVersion: "0.3.0",
      skills: [
        {
          id: "knowledge-research",
          name: "Knowledge Research",
          tags: ["research", "knowledge"],
        },
      ],
      url: "https://knowledge.example/a2a",
      version: "0.1.0",
    });
  });

  it("accepts bounded task submissions through an injected handler", async () => {
    const calls: string[] = [];
    const app = createA2AAdapter({
      agentUrl: "https://knowledge.example/a2a",
      generateTaskId: () => "a2a-task-1",
      maxMessageTextBytes: 64,
      now: () => "2026-05-12T18:00:00.000Z",
      taskHandler: async (input) => {
        calls.push(`${input.id}:${input.message.parts[0]?.text}:${input.metadata.traceId}`);
        input.metadata.mutated = true;
        return {
          artifacts: [
            {
              parts: [{ kind: "text", text: "Accepted" }],
            },
          ],
          id: input.id,
          metadata: { handled: true },
          status: {
            state: "completed",
            timestamp: "2026-05-12T18:00:01.000Z",
          },
        };
      },
    });

    const response = await app.request("/a2a/tasks", {
      body: JSON.stringify({
        message: {
          parts: [{ kind: "text", text: "Research vector drift" }],
          role: "user",
        },
        metadata: { traceId: "trace-1" },
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      artifacts: [{ parts: [{ text: "Accepted" }] }],
      id: "a2a-task-1",
      metadata: { handled: true },
      status: {
        state: "completed",
        timestamp: "2026-05-12T18:00:01.000Z",
      },
    });
    expect(calls).toEqual(["a2a-task-1:Research vector drift:trace-1"]);

    const second = await app.request("/a2a/tasks", {
      body: JSON.stringify({
        message: {
          parts: [{ kind: "text", text: "Check clone isolation" }],
          role: "user",
        },
        metadata: { traceId: "trace-2" },
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(second.status).toBe(202);
    expect(calls).toContain("a2a-task-1:Check clone isolation:trace-2");
  });

  it("rejects invalid or oversized task messages before invoking handlers", async () => {
    const calls: string[] = [];
    const app = createA2AAdapter({
      agentUrl: "https://knowledge.example/a2a",
      maxMessageTextBytes: 4,
      taskHandler: async (input) => {
        calls.push(input.id);
        return {
          artifacts: [],
          id: input.id,
          metadata: {},
          status: { state: "completed", timestamp: "2026-05-12T18:00:00.000Z" },
        };
      },
    });

    const invalid = await app.request("/a2a/tasks", {
      body: JSON.stringify({ message: { parts: [], role: "user" } }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(invalid.status).toBe(400);

    const oversized = await app.request("/a2a/tasks", {
      body: JSON.stringify({
        message: { parts: [{ kind: "text", text: "too long" }], role: "user" },
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(oversized.status).toBe(413);
    expect(calls).toEqual([]);
  });

  it("provides a bounded default handler and rejects invalid configuration", async () => {
    expect(() =>
      createA2AAdapter({
        agentUrl: "https://knowledge.example/a2a",
        maxMessageTextBytes: 0,
      }),
    ).toThrow("A2A adapter maxMessageTextBytes must be at least 1");
    expect(() =>
      createA2AAdapter({
        agentUrl: " ",
      }),
    ).toThrow("A2A adapter agentUrl is required");

    const app = createA2AAdapter({
      agentUrl: "https://knowledge.example/a2a",
      generateTaskId: () => "default-task-1",
      now: () => "2026-05-12T18:01:00.000Z",
    });

    const malformed = await app.request("/a2a/tasks", {
      body: "{",
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(malformed.status).toBe(400);

    const response = await app.request("/a2a/tasks", {
      body: JSON.stringify({
        message: { parts: [{ kind: "text", text: "hello" }], role: "user" },
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      artifacts: [],
      id: "default-task-1",
      status: {
        state: "submitted",
        timestamp: "2026-05-12T18:01:00.000Z",
      },
    });
  });
});
