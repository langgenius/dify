import { createCommandRegistry } from "@knowledge/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createSafeShell } from "./safe-shell";

const subject = {
  scopes: ["knowledge-spaces:read"],
  subjectId: "user-1",
  tenantId: "tenant-1",
};
const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";

function createTextRegistry(text: string) {
  const registry = createCommandRegistry({ maxCommands: 2 });
  registry.register({
    defaultHandler: () => text,
    inputSchema: z.object({
      knowledgeSpaceId: z.string().uuid(),
      path: z.string().startsWith("/knowledge"),
    }),
    name: "cat",
    supportedResourceTypes: ["workspace"],
  });

  return registry;
}

describe("createSafeShell coverage", () => {
  it("defaults diff mode to line when --mode is omitted", () => {
    const shell = createSafeShell({ knowledgeSpaceId, registries: {}, subject });

    expect(shell.plan("diff /knowledge/docs/a.md /knowledge/docs/b.md").steps[0]).toMatchObject({
      command: "diff",
      input: {
        knowledgeSpaceId,
        mode: "line",
        newPath: "/knowledge/docs/b.md",
        oldPath: "/knowledge/docs/a.md",
      },
      kind: "registry",
    });
  });

  it("accepts --lines and defaults head/tail to 10 lines", () => {
    const shell = createSafeShell({ knowledgeSpaceId, registries: {}, subject });

    expect(shell.plan("cat /knowledge/docs/a.md | head --lines 3").steps[1]).toEqual({
      argv: ["--lines", "3"],
      command: "head",
      input: { lines: 3 },
      kind: "transform",
    });
    expect(shell.plan("cat /knowledge/docs/a.md | tail").steps[1]).toEqual({
      argv: [],
      command: "tail",
      input: { lines: 10 },
      kind: "transform",
    });
  });

  it("rejects a trailing -n flag without a value", () => {
    const shell = createSafeShell({ knowledgeSpaceId, registries: {}, subject });

    expect(() => shell.plan("cat /knowledge/docs/a.md | head -n")).toThrow(
      "Safe shell flag -n requires a value",
    );
  });

  it("applies line transforms to plain string outputs", async () => {
    const shell = createSafeShell({
      knowledgeSpaceId,
      registries: { workspace: createTextRegistry("line1\nline2\nline3") },
      subject,
    });

    await expect(shell.execute("cat /knowledge/docs/a.md | head -n 2")).resolves.toEqual({
      output: "line1\nline2",
      plan: shell.plan("cat /knowledge/docs/a.md | head -n 2"),
      truncated: false,
    });
    await expect(shell.execute("cat /knowledge/docs/a.md | tail -n 1")).resolves.toEqual({
      output: "line3",
      plan: shell.plan("cat /knowledge/docs/a.md | tail -n 1"),
      truncated: false,
    });
  });

  it("stringifies structured outputs without a text field for line transforms", async () => {
    const registry = createCommandRegistry({ maxCommands: 1 });
    const lsResult = {
      items: [{ path: "/knowledge/docs/a.md" }],
      path: "/knowledge/docs",
      truncated: false,
    };
    registry.register({
      defaultHandler: () => lsResult,
      inputSchema: z.object({
        knowledgeSpaceId: z.string().uuid(),
        limit: z.number().int().positive(),
        path: z.string().startsWith("/knowledge"),
      }),
      name: "ls",
      supportedResourceTypes: ["workspace"],
    });
    const shell = createSafeShell({
      knowledgeSpaceId,
      registries: { workspace: registry },
      subject,
    });

    await expect(shell.execute("ls /knowledge/docs --limit 2 | head -n 1")).resolves.toEqual({
      output: JSON.stringify(lsResult),
      plan: shell.plan("ls /knowledge/docs --limit 2 | head -n 1"),
      truncated: false,
    });
  });

  it("stringifies undefined pipeline input when a transform runs first", async () => {
    const shell = createSafeShell({ knowledgeSpaceId, registries: {}, subject });

    // "wc" as the sole step counts the JSON stringification of empty input ('""').
    await expect(shell.execute("wc")).resolves.toEqual({
      output: { bytes: 2, lines: 1, words: 1 },
      plan: shell.plan("wc"),
      truncated: false,
    });
  });

  it("counts empty output as zero lines, words, and bytes", async () => {
    const shell = createSafeShell({
      knowledgeSpaceId,
      registries: { workspace: createTextRegistry("") },
      subject,
    });

    await expect(shell.execute("cat /knowledge/docs/a.md | wc")).resolves.toEqual({
      output: { bytes: 0, lines: 0, words: 0 },
      plan: shell.plan("cat /knowledge/docs/a.md | wc"),
      truncated: false,
    });
  });

  it("returns null for jq array indexing into non-arrays and for missing keys", async () => {
    const registry = createCommandRegistry({ maxCommands: 1 });
    registry.register({
      defaultHandler: ({ input }) => ({
        path: input.path,
        text: "abc",
        truncated: false,
      }),
      inputSchema: z.object({
        knowledgeSpaceId: z.string().uuid(),
        path: z.string().startsWith("/knowledge"),
      }),
      name: "cat",
      supportedResourceTypes: ["workspace"],
    });
    const shell = createSafeShell({
      knowledgeSpaceId,
      registries: { workspace: registry },
      subject,
    });

    await expect(shell.execute("cat /knowledge/docs/a.md | jq .path[0]")).resolves.toMatchObject({
      output: null,
    });
    await expect(shell.execute("cat /knowledge/docs/a.md | jq .missing")).resolves.toMatchObject({
      output: null,
    });
  });
});
