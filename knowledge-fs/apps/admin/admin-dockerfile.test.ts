import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Admin Dockerfile production runtime", () => {
  const dockerfile = readFileSync(resolve(import.meta.dirname, "Dockerfile"), "utf8");

  it("builds the standalone Next output from the admin workspace package", () => {
    expect(dockerfile).toContain("FROM node:22-bookworm-slim AS builder");
    expect(dockerfile).toContain("RUN corepack enable");
    expect(dockerfile).toContain("COPY apps/admin/package.json apps/admin/package.json");
    expect(dockerfile).toContain("pnpm install --frozen-lockfile --filter @knowledge/admin...");
    expect(dockerfile).toContain("COPY apps/admin apps/admin");
    expect(dockerfile).toContain("pnpm --filter @knowledge/admin build");
  });

  it("runs the built standalone server without a bind-mounted repository", () => {
    expect(dockerfile).toContain("ENV NODE_ENV=production");
    expect(dockerfile).toContain("ENV PORT=3000");
    expect(dockerfile).toContain("ENV HOSTNAME=0.0.0.0");
    expect(dockerfile).toContain("COPY --from=builder /workspace/apps/admin/.next/standalone ./");
    expect(dockerfile).toContain(
      "COPY --from=builder /workspace/apps/admin/.next/static ./apps/admin/.next/static",
    );
    expect(dockerfile).toContain('CMD ["node", "apps/admin/server.js"]');
    expect(dockerfile).toContain("USER node");
  });
});

describe("Admin source dev script", () => {
  it("loads the infra local env file before starting the Next dev server", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(import.meta.dirname, "package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.dev).toContain("--env-file-if-exists=../../infra/local/.env");
    expect(packageJson.scripts?.dev).toContain("node_modules/next/dist/bin/next");
    expect(packageJson.scripts?.dev).toContain("dev");
  });
});
