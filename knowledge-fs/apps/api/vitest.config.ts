import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: [resolve(import.meta.dirname, "../../test/setup-dify-object-storage.ts")],
  },
});
