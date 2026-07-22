import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      include: [
        "lib/evaluation-dashboard.ts",
        "lib/failed-query-diagnostics.ts",
        "lib/retrieval-studio.ts",
        "lib/trace-comparison.ts",
      ],
      provider: "v8",
      reporter: ["text", "json-summary"],
      thresholds: {
        branches: 90,
        functions: 90,
        lines: 90,
        statements: 90,
      },
    },
  },
});
