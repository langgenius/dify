import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  // splitting: false,
  treeshake: true,
  outDir: "dist",
  target: false,
});
