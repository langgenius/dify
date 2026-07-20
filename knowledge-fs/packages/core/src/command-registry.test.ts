import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  CommandNameSchema,
  type RegisteredCommandContext,
  createCommandRegistry,
} from "./command-registry";

const subject = {
  scopes: ["fs:read"],
  subjectId: "user-1",
  tenantId: "tenant-1",
};

describe("CommandRegistry", () => {
  it("registers allowlisted commands and executes validated handlers", async () => {
    const registry = createCommandRegistry({ maxCommands: 2 });
    const traceEvents: string[] = [];

    registry.register({
      cachePolicy: { strategy: "none" },
      defaultHandler: async ({ input }) => ({
        entries: [`${input.path}/child.md`],
      }),
      degradation: { strategy: "fail-closed" },
      estimateCost: () => ({ estimatedBytes: 256, estimatedRows: 1 }),
      inputSchema: z.object({ path: z.string().startsWith("/") }),
      name: "ls",
      permissionCheck: ({ subject }) => subject.scopes.includes("fs:read"),
      supportedResourceTypes: ["source", "document"],
      traceHook: ({ event }) => {
        traceEvents.push(event);
      },
    });

    const result = await registry.execute({
      context: {
        resourceType: "source",
        subject,
      },
      input: { path: "/sources/uploads" },
      name: "ls",
    });

    expect(result).toEqual({
      cost: { estimatedBytes: 256, estimatedRows: 1 },
      output: { entries: ["/sources/uploads/child.md"] },
    });
    expect(registry.list().map((command) => command.name)).toEqual(["ls"]);
    expect(traceEvents).toEqual(["command.start", "command.end"]);
    expect(CommandNameSchema.options).toContain("grep");
    expect(CommandNameSchema.options).toContain("write");
    expect(CommandNameSchema.options).toContain("append");
  });

  it("records bounded trace details and validates cost estimates before handlers run", async () => {
    const registry = createCommandRegistry({ maxCommands: 2 });
    const traceEvents: unknown[] = [];
    let handlerCalls = 0;

    registry.register({
      defaultHandler: async () => {
        handlerCalls += 1;
        return { ok: true };
      },
      estimateCost: () => ({ estimatedMs: 5, estimatedRows: 2 }),
      inputSchema: z.object({ path: z.string().startsWith("/") }),
      name: "grep",
      supportedResourceTypes: ["source"],
      traceHook: (event) => {
        traceEvents.push(event);
      },
    });

    await expect(
      registry.execute({
        context: { resourceType: "source", subject },
        input: { path: "/sources/uploads" },
        name: "grep",
      }),
    ).resolves.toEqual({
      cost: { estimatedMs: 5, estimatedRows: 2 },
      output: { ok: true },
    });
    expect(handlerCalls).toBe(1);
    expect(traceEvents).toEqual([
      expect.objectContaining({ event: "command.start", name: "grep" }),
      expect.objectContaining({
        cost: { estimatedMs: 5, estimatedRows: 2 },
        durationMs: expect.any(Number),
        event: "command.end",
        name: "grep",
      }),
    ]);

    let invalidCostHandlerCalls = 0;
    registry.register({
      defaultHandler: async () => {
        invalidCostHandlerCalls += 1;
        return { ok: false };
      },
      estimateCost: () => ({ estimatedRows: -1 }),
      inputSchema: z.object({ path: z.string().startsWith("/") }),
      name: "find",
      supportedResourceTypes: ["source"],
      traceHook: (event) => {
        traceEvents.push(event);
      },
    });

    await expect(
      registry.execute({
        context: { resourceType: "source", subject },
        input: { path: "/sources/uploads" },
        name: "find",
      }),
    ).rejects.toThrow("Command find cost estimate estimatedRows must be non-negative");
    expect(invalidCostHandlerCalls).toBe(0);
    expect(traceEvents.at(-1)).toEqual(
      expect.objectContaining({
        durationMs: expect.any(Number),
        event: "command.error",
        name: "find",
      }),
    );
  });

  it("uses resource and node-kind overrides without invoking host shell commands", async () => {
    const registry = createCommandRegistry({ maxCommands: 3 });
    const context = {
      nodeKind: "table",
      resourceType: "node",
      subject,
    } satisfies RegisteredCommandContext;

    registry.register({
      defaultHandler: async () => ({ format: "text" }),
      inputSchema: z.object({ path: z.string() }),
      name: "cat",
      nodeKindOverrides: {
        table: async () => ({ format: "json-table" }),
      },
      resourceTypeOverrides: {
        source: async () => ({ format: "source-text" }),
      },
      supportedResourceTypes: ["node", "source"],
    });

    await expect(
      registry.execute({
        context,
        input: { path: "/knowledge/by-type/table-1" },
        name: "cat",
      }),
    ).resolves.toEqual({
      output: { format: "json-table" },
    });

    await expect(
      registry.execute({
        context: {
          resourceType: "source",
          subject,
        },
        input: { path: "/sources/uploads/doc.md" },
        name: "cat",
      }),
    ).resolves.toEqual({
      output: { format: "source-text" },
    });
  });

  it("passes consistency class declarations through command context", async () => {
    const registry = createCommandRegistry({ maxCommands: 1 });

    registry.register({
      defaultHandler: async ({ context }) => ({
        consistencyClass: context.consistencyClass,
      }),
      inputSchema: z.object({
        consistencyClass: z.enum([
          "path-consistent",
          "snapshot-consistent",
          "cache-consistent",
          "eventual-preview",
        ]),
        path: z.string().startsWith("/"),
      }),
      name: "stat",
      supportedResourceTypes: ["source"],
    });

    await expect(
      registry.execute({
        context: {
          resourceType: "source",
          subject,
        },
        input: {
          consistencyClass: "snapshot-consistent",
          path: "/sources/uploads/readme.md",
        },
        name: "stat",
      }),
    ).resolves.toEqual({
      output: {
        consistencyClass: "snapshot-consistent",
      },
    });
  });

  it("validates command output when an output schema is configured", async () => {
    const registry = createCommandRegistry({ maxCommands: 3 });

    registry.register({
      defaultHandler: async () => ({ entries: ["/sources/uploads/readme.md"] }),
      inputSchema: z.object({ path: z.string() }),
      name: "ls",
      outputSchema: z.object({ entries: z.array(z.string().startsWith("/")) }),
      supportedResourceTypes: ["source"],
    });

    await expect(
      registry.execute({
        context: { resourceType: "source", subject },
        input: { path: "/sources/uploads" },
        name: "ls",
      }),
    ).resolves.toEqual({
      output: { entries: ["/sources/uploads/readme.md"] },
    });

    registry.register({
      defaultHandler: async () => ({ entries: ["relative.md"] }),
      inputSchema: z.object({ path: z.string() }),
      name: "tree",
      outputSchema: z.object({ entries: z.array(z.string().startsWith("/")) }),
      supportedResourceTypes: ["source"],
    });

    await expect(
      registry.execute({
        context: { resourceType: "source", subject },
        input: { path: "/sources/uploads" },
        name: "tree",
      }),
    ).rejects.toThrow("Command tree returned invalid output");
  });

  it("keeps existing output behavior for commands without an output schema", async () => {
    const registry = createCommandRegistry({ maxCommands: 1 });

    registry.register({
      defaultHandler: async () => ({ anything: ["goes", 1, true] }),
      inputSchema: z.object({ path: z.string() }),
      name: "cat",
      supportedResourceTypes: ["source"],
    });

    await expect(
      registry.execute({
        context: { resourceType: "source", subject },
        input: { path: "/sources/uploads/readme.md" },
        name: "cat",
      }),
    ).resolves.toEqual({
      output: { anything: ["goes", 1, true] },
    });
  });

  it("omits unconfigured policies and cost details from summaries and success traces", async () => {
    const registry = createCommandRegistry({ maxCommands: 1 });
    const traceEvents: unknown[] = [];

    registry.register({
      defaultHandler: async () => ({ entries: ["/sources/uploads/readme.md"] }),
      inputSchema: z.object({ path: z.string().startsWith("/") }),
      name: "ls",
      supportedResourceTypes: ["source"],
      traceHook: (event) => {
        traceEvents.push(event);
      },
    });

    expect(registry.get("ls")).toEqual({
      name: "ls",
      supportedResourceTypes: ["source"],
    });
    expect(registry.list()).toEqual([
      {
        name: "ls",
        supportedResourceTypes: ["source"],
      },
    ]);

    await expect(
      registry.execute({
        context: { resourceType: "source", subject },
        input: { path: "/sources/uploads" },
        name: "ls",
      }),
    ).resolves.toEqual({
      output: { entries: ["/sources/uploads/readme.md"] },
    });
    expect(traceEvents).toEqual([
      {
        context: { resourceType: "source", subject },
        event: "command.start",
        name: "ls",
      },
      {
        context: { resourceType: "source", subject },
        durationMs: expect.any(Number),
        event: "command.end",
        name: "ls",
      },
    ]);
  });

  it("rejects unsafe, duplicate, unauthorized, and invalid command executions", async () => {
    const registry = createCommandRegistry({ maxCommands: 1 });

    registry.register({
      defaultHandler: async () => ({ ok: true }),
      inputSchema: z.object({ path: z.string().startsWith("/") }),
      name: "stat",
      permissionCheck: () => false,
      supportedResourceTypes: ["source"],
    });

    expect(() =>
      registry.register({
        defaultHandler: async () => ({ ok: true }),
        inputSchema: z.object({ path: z.string() }),
        name: "stat",
        supportedResourceTypes: ["source"],
      }),
    ).toThrow("Command stat is already registered");
    expect(() =>
      registry.register({
        defaultHandler: async () => ({ ok: true }),
        inputSchema: z.object({ path: z.string() }),
        name: "grep",
        supportedResourceTypes: ["source"],
      }),
    ).toThrow("Command registry maxCommands=1 exceeded");
    await expect(
      registry.execute({
        context: { resourceType: "source", subject },
        input: { path: "/sources/uploads" },
        name: "stat",
      }),
    ).rejects.toThrow("Command stat permission denied");
    await expect(
      registry.execute({
        context: { resourceType: "source", subject: { ...subject, scopes: ["fs:read"] } },
        input: { path: "relative" },
        name: "stat",
      }),
    ).rejects.toThrow();
    await expect(
      registry.execute({
        context: { resourceType: "source", subject },
        input: { argv: ["rm", "-rf", "/"] },
        name: "shell" as "ls",
      }),
    ).rejects.toThrow("Command shell is not allowlisted");
  });

  it("rejects invalid command definitions before registration", () => {
    const registry = createCommandRegistry({ maxCommands: 4 });

    expect(() =>
      registry.register({
        defaultHandler: async () => ({ ok: true }),
        inputSchema: z.object({ path: z.string() }),
        name: "ls",
        supportedResourceTypes: [],
      }),
    ).toThrow("Command ls must support at least one resource type");

    expect(() =>
      registry.register({
        cachePolicy: { maxBytes: 0, strategy: "memory" },
        defaultHandler: async () => ({ ok: true }),
        inputSchema: z.object({ path: z.string() }),
        name: "cat",
        supportedResourceTypes: ["source"],
      }),
    ).toThrow("Command cat cachePolicy.maxBytes must be at least 1");

    expect(() =>
      registry.register({
        defaultHandler: async () => ({ ok: true }),
        inputSchema: z.object({ path: z.string() }),
        name: "stat",
        supportedResourceTypes: ["source", "source"],
      }),
    ).toThrow("Command stat has duplicate supported resource type source");
  });

  it("guards registry bounds, supported resource types, missing commands, and failure traces", async () => {
    expect(() => createCommandRegistry({ maxCommands: 0 })).toThrow(
      "maxCommands must be at least 1",
    );

    const registry = createCommandRegistry({ maxCommands: 2 });
    const traceEvents: string[] = [];

    registry.register({
      cachePolicy: { strategy: "memory", ttlSeconds: 30 },
      defaultHandler: async () => {
        throw new Error("backend unavailable");
      },
      degradation: { strategy: "fail-closed" },
      inputSchema: z.object({ path: z.string().startsWith("/") }),
      name: "find",
      supportedResourceTypes: ["source"],
      traceHook: ({ event }) => {
        traceEvents.push(event);
      },
    });

    expect(registry.get("find")).toEqual({
      cachePolicy: { strategy: "memory", ttlSeconds: 30 },
      degradation: { strategy: "fail-closed" },
      name: "find",
      supportedResourceTypes: ["source"],
    });
    expect(registry.get("grep")).toBeNull();

    const listed = registry.list();
    (listed[0]?.supportedResourceTypes as string[] | undefined)?.push("document");
    expect(registry.get("find")?.supportedResourceTypes).toEqual(["source"]);

    await expect(
      registry.execute({
        context: { resourceType: "document", subject },
        input: { path: "/sources/uploads" },
        name: "find",
      }),
    ).rejects.toThrow("Command find does not support resource type document");

    await expect(
      registry.execute({
        context: { resourceType: "source", subject },
        input: { path: "/sources/uploads" },
        name: "grep",
      }),
    ).rejects.toThrow("Command grep is not registered");

    await expect(
      registry.execute({
        context: { resourceType: "source", subject },
        input: { path: "/sources/uploads" },
        name: "find",
      }),
    ).rejects.toThrow("backend unavailable");
    expect(traceEvents).toEqual(["command.start", "command.error"]);
  });
});
