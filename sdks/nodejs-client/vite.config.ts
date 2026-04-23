import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: ["src/index.ts"],
    format: ["esm"],
    platform: "node",
    dts: true,
    clean: true,
    sourcemap: true,
    // splitting: false,
    treeshake: true,
    outDir: "dist",
    target: false,
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.*", "src/**/*.spec.*"],
    },
  },
});
