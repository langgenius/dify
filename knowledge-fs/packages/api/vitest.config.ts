import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: [resolve(import.meta.dirname, "../../test/setup-dify-object-storage.ts")],
    coverage: {
      exclude: ["src/**/*.test.ts"],
      include: ["src/**/*.ts"],
      provider: "v8",
      reporter: ["text", "json-summary"],
      thresholds: {
        // Restored to 90 after the 2026-07-10 coverage campaign (branches 85.15% -> 93.51%).
        branches: 90,
        functions: 90,
        lines: 90,
        statements: 90,
      },
    },
  },
});
