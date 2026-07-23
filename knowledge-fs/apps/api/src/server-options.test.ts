import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { resolveApiPort } from "./server-options";

describe("resolveApiPort", () => {
  it("uses PORT first, then API_PORT, then the source-development default", () => {
    expect(resolveApiPort({ API_PORT: "8788", PORT: "8789" })).toBe(8789);
    expect(resolveApiPort({ API_PORT: "8788" })).toBe(8788);
    expect(resolveApiPort({})).toBe(8788);
  });

  it("rejects invalid or unsafe port values", () => {
    expect(() => resolveApiPort({ PORT: "0" })).toThrow("API port must be between 1 and 65535");
    expect(() => resolveApiPort({ PORT: "65536" })).toThrow("API port must be between 1 and 65535");
    expect(() => resolveApiPort({ PORT: "abc" })).toThrow("API port must be an integer");
  });
});

describe("API Dockerfile production runtime", () => {
  it("runs compiled JavaScript as a non-root user instead of tsx", () => {
    const dockerfile = readFileSync(resolve(import.meta.dirname, "../Dockerfile"), "utf8");

    expect(dockerfile).toContain('CMD ["node", "server.mjs"]');
    expect(dockerfile).toContain("dist/migrate.mjs ./migrate.mjs");
    expect(dockerfile).toContain("USER node");
    expect(dockerfile).not.toContain('"tsx"');
  });

  it("builds the self-contained TypeScript API without a native toolchain", () => {
    const dockerfile = readFileSync(resolve(import.meta.dirname, "../Dockerfile"), "utf8");

    expect(dockerfile).toContain("FROM node:22-bookworm-slim AS builder");
    expect(dockerfile).toContain("COPY packages/compute packages/compute");
    expect(dockerfile).toContain(
      "COPY packages/dify-datasource-runtime-client packages/dify-datasource-runtime-client",
    );
    expect(dockerfile).toContain(
      "COPY packages/dify-model-runtime-client packages/dify-model-runtime-client",
    );
    expect(dockerfile).not.toContain("packages/plugin-daemon-client");
    expect(dockerfile).not.toMatch(/\b(?:rustup|cargo|wasm-bindgen|knowledge_compute)\b/);
  });
});

describe("API source dev script", () => {
  it("loads the infra local env file before starting the source server", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(import.meta.dirname, "../package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.dev).toContain("--env-file-if-exists=../../infra/local/.env");
    expect(packageJson.scripts?.dev).toContain("--import tsx");
    expect(packageJson.scripts?.dev).toContain("--watch src/server.ts");
  });

  it("builds the production bundle with createRequire for bundled CommonJS dependencies", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(import.meta.dirname, "../package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.["build:prod"]).toContain("--format=esm");
    expect(packageJson.scripts?.["build:prod"]).toContain("createRequire");
    expect(packageJson.scripts?.["build:prod"]).toContain("src/migrate.ts");
  });
});
