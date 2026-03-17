// src/editor-worker-main.ts
import { start } from "./editor-worker.mjs";
self.onmessage = (e) => {
  start(() => ({}));
};
