import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("generation code health guardrails", () => {
  it("uses shared stable JSON rendering", () => {
    const source = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");

    expect(source).toContain("stableJson,");
    expect(source).toContain('} from "@knowledge/core"');
    expect(source).not.toContain("function stableJson");
  });
});
