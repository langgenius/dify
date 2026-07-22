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

describe("createSafeShell", () => {
  it("plans allowlisted filesystem pipelines without host shell syntax", () => {
    const shell = createSafeShell({
      knowledgeSpaceId,
      maxListLimit: 20,
      registries: {},
      subject,
    });

    expect(shell.plan("cat /knowledge/docs/readme.md | head -n 2 | wc")).toEqual({
      command: "cat /knowledge/docs/readme.md | head -n 2 | wc",
      steps: [
        {
          argv: ["/knowledge/docs/readme.md"],
          command: "cat",
          input: {
            knowledgeSpaceId,
            path: "/knowledge/docs/readme.md",
          },
          kind: "registry",
          resourceType: "workspace",
        },
        {
          argv: ["-n", "2"],
          command: "head",
          input: { lines: 2 },
          kind: "transform",
        },
        {
          argv: [],
          command: "wc",
          input: {},
          kind: "transform",
        },
      ],
    });
    expect(() => shell.plan("rm -rf /knowledge/docs")).toThrow(
      "Safe shell command rm is not allowlisted",
    );
    expect(() => shell.plan("cat /knowledge/docs/readme.md > /tmp/out")).toThrow(
      "Safe shell command contains unsupported host-shell syntax",
    );
  });

  it("executes registry commands and in-memory transforms with explicit bounds", async () => {
    const registry = createCommandRegistry({ maxCommands: 2 });
    const calls: unknown[] = [];
    registry.register({
      defaultHandler: ({ context, input }) => {
        calls.push({ context, input });
        return {
          contentType: "text/markdown",
          path: input.path,
          text: "alpha beta\nsecond line\nthird line",
          truncated: false,
        };
      },
      inputSchema: z.object({
        knowledgeSpaceId: z.string().uuid(),
        path: z.string().startsWith("/knowledge"),
      }),
      name: "cat",
      supportedResourceTypes: ["workspace"],
    });
    registry.register({
      defaultHandler: ({ input }) => ({
        items: [{ path: `${input.path}/a.md` }, { path: `${input.path}/b.md` }],
        path: input.path,
        truncated: false,
      }),
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
      maxListLimit: 10,
      maxOutputBytes: 1024,
      registries: { workspace: registry },
      subject,
      traceId: "trace-1",
    });

    await expect(shell.execute("cat /knowledge/docs/readme.md | head -n 1 | wc")).resolves.toEqual({
      output: {
        bytes: 10,
        lines: 1,
        words: 2,
      },
      plan: shell.plan("cat /knowledge/docs/readme.md | head -n 1 | wc"),
      truncated: false,
    });
    expect(calls).toEqual([
      {
        context: {
          resourceType: "workspace",
          subject,
          traceId: "trace-1",
        },
        input: {
          knowledgeSpaceId,
          path: "/knowledge/docs/readme.md",
        },
      },
    ]);

    await expect(
      shell.execute("ls /knowledge/docs --limit 2 | jq .items[0].path"),
    ).resolves.toEqual({
      output: "/knowledge/docs/a.md",
      plan: shell.plan("ls /knowledge/docs --limit 2 | jq .items[0].path"),
      truncated: false,
    });
    await expect(shell.execute("ls /knowledge/docs --limit 11")).rejects.toThrow(
      "Safe shell ls limit exceeds maxListLimit=10",
    );
  });

  it("routes SourceFS paths to source registries and rejects unsafe pipeline shapes", async () => {
    const sourceRegistry = createCommandRegistry({ maxCommands: 1 });
    sourceRegistry.register({
      defaultHandler: ({ input }) => ({
        contentType: "text/plain",
        path: input.path,
        text: "source body",
        truncated: false,
      }),
      inputSchema: z.object({
        knowledgeSpaceId: z.string().uuid(),
        path: z.string().startsWith("/sources"),
      }),
      name: "cat",
      supportedResourceTypes: ["source"],
    });
    const shell = createSafeShell({
      knowledgeSpaceId,
      maxPipelineCommands: 2,
      registries: { source: sourceRegistry },
      subject,
    });

    await expect(shell.execute("cat /sources/uploads/readme.txt | tail -n 1")).resolves.toEqual({
      output: {
        contentType: "text/plain",
        path: "/sources/uploads/readme.txt",
        text: "source body",
        truncated: false,
      },
      plan: shell.plan("cat /sources/uploads/readme.txt | tail -n 1"),
      truncated: false,
    });
    expect(() =>
      shell.plan("cat /sources/uploads/readme.txt | grep body /sources/uploads"),
    ).toThrow("Safe shell registry commands must be the first pipeline step");
    expect(() => shell.plan("cat /sources/uploads/readme.txt | head -n 1 | wc")).toThrow(
      "Safe shell pipeline exceeds maxPipelineCommands=2",
    );
    await expect(shell.execute("cat /knowledge/docs/readme.md")).rejects.toThrow(
      "Safe shell registry for resource type workspace is not configured",
    );
  });

  it("covers parser guards, resource routing, jq selectors, and output truncation", async () => {
    const registry = createCommandRegistry({ maxCommands: 5 });
    registry.register({
      defaultHandler: ({ input }) => ({ input }),
      inputSchema: z.object({
        depth: z.number().int().positive().optional(),
        knowledgeSpaceId: z.string().uuid(),
        limit: z.number().int().positive(),
        path: z.string().startsWith("/knowledge"),
      }),
      name: "tree",
      supportedResourceTypes: ["workspace"],
    });
    registry.register({
      defaultHandler: ({ input }) => ({ input }),
      inputSchema: z.object({
        knowledgeSpaceId: z.string().uuid(),
        limit: z.number().int().positive(),
        nameContains: z.string().optional(),
        path: z.string().startsWith("/knowledge"),
      }),
      name: "find",
      supportedResourceTypes: ["workspace"],
    });
    registry.register({
      defaultHandler: ({ input }) => ({ input }),
      inputSchema: z.object({
        knowledgeSpaceId: z.string().uuid(),
        mode: z.string(),
        newPath: z.string(),
        oldPath: z.string(),
      }),
      name: "diff",
      supportedResourceTypes: ["workspace"],
    });
    registry.register({
      defaultHandler: () => "abcdef",
      inputSchema: z.object({
        knowledgeSpaceId: z.string().uuid(),
        path: z.string().startsWith("/knowledge"),
      }),
      name: "cat",
      supportedResourceTypes: ["workspace"],
    });
    registry.register({
      defaultHandler: ({ input }) => ({
        matches: [{ path: input.path, snippet: input.q }],
        path: input.path,
        truncated: false,
      }),
      inputSchema: z.object({
        knowledgeSpaceId: z.string().uuid(),
        limit: z.number().int().positive(),
        path: z.string().startsWith("/knowledge"),
        q: z.string(),
      }),
      name: "grep",
      supportedResourceTypes: ["workspace"],
    });
    const shell = createSafeShell({
      defaultLimit: 3,
      knowledgeSpaceId,
      maxListLimit: 5,
      maxOutputBytes: 3,
      registries: { workspace: registry },
      subject,
    });

    expect(shell.plan("tree /knowledge/docs --limit 2 --depth 2").steps[0]).toMatchObject({
      input: {
        depth: 2,
        knowledgeSpaceId,
        limit: 2,
        path: "/knowledge/docs",
      },
      resourceType: "workspace",
    });
    expect(shell.plan("find /knowledge/docs --name-contains policy").steps[0]).toMatchObject({
      input: {
        knowledgeSpaceId,
        limit: 3,
        nameContains: "policy",
        path: "/knowledge/docs",
      },
    });
    expect(
      shell.plan("diff /knowledge/docs/a.md /knowledge/docs/b.md --mode word").steps[0],
    ).toMatchObject({
      input: {
        knowledgeSpaceId,
        mode: "word",
        newPath: "/knowledge/docs/b.md",
        oldPath: "/knowledge/docs/a.md",
      },
    });
    expect(shell.plan('grep "renewal policy" /knowledge/docs --limit 1').steps[0]).toMatchObject({
      input: {
        knowledgeSpaceId,
        limit: 1,
        path: "/knowledge/docs",
        q: "renewal policy",
      },
    });
    expect(shell.plan("ls /evidence/bundles --limit 1").steps[0]).toMatchObject({
      resourceType: "evidence",
    });

    await expect(shell.execute("cat /knowledge/docs/readme.md")).resolves.toEqual({
      output: "abc",
      plan: shell.plan("cat /knowledge/docs/readme.md"),
      truncated: true,
    });

    const objectRegistry = createCommandRegistry({ maxCommands: 1 });
    objectRegistry.register({
      defaultHandler: ({ input }) => ({
        path: input.path,
        text: "abcdef",
        truncated: false,
      }),
      inputSchema: z.object({
        knowledgeSpaceId: z.string().uuid(),
        path: z.string().startsWith("/knowledge"),
      }),
      name: "cat",
      supportedResourceTypes: ["workspace"],
    });
    const objectShell = createSafeShell({
      knowledgeSpaceId,
      maxOutputBytes: 3,
      registries: { workspace: objectRegistry },
      subject,
    });
    await expect(objectShell.execute("cat /knowledge/docs/readme.md")).resolves.toEqual({
      output: {
        path: "/knowledge/docs/readme.md",
        text: "abc",
        truncated: true,
      },
      plan: objectShell.plan("cat /knowledge/docs/readme.md"),
      truncated: true,
    });

    await expect(
      shell.execute("grep term /knowledge/docs --limit 1 | jq .matches[1].path"),
    ).resolves.toEqual({
      output: null,
      plan: shell.plan("grep term /knowledge/docs --limit 1 | jq .matches[1].path"),
      truncated: false,
    });
    await expect(
      shell.execute("grep term /knowledge/docs --limit 1 | jq .matches.path"),
    ).resolves.toEqual({
      output: null,
      plan: shell.plan("grep term /knowledge/docs --limit 1 | jq .matches.path"),
      truncated: false,
    });

    for (const command of ["", "cat /knowledge/docs |", "cat 'unterminated"]) {
      expect(() => shell.plan(command)).toThrow();
    }
    expect(() =>
      createSafeShell({ knowledgeSpaceId, maxOutputBytes: 0, registries: {}, subject }),
    ).toThrow("Safe shell maxOutputBytes must be an integer >= 1");
    expect(() => shell.plan("cat")).toThrow("Safe shell cat requires a path");
    expect(() => shell.plan("grep term")).toThrow("Safe shell grep requires query and path");
    expect(() => shell.plan("diff /knowledge/a.md")).toThrow(
      "Safe shell diff requires old and new paths",
    );
    expect(() => shell.plan("ls /knowledge/docs --limit")).toThrow(
      "Safe shell flag --limit requires a value",
    );
    expect(() => shell.plan("cat /knowledge/docs | head -n nope")).toThrow(
      "Safe shell flag n must be an integer >= 1",
    );
    expect(() => shell.plan("cat /knowledge/docs | jq")).toThrow(
      "Safe shell jq requires a selector",
    );
    await expect(shell.execute("cat /knowledge/docs/readme.md | jq items")).rejects.toThrow(
      "Safe shell jq selector must start with .",
    );
  });
});
