/** Explicit lifecycle ownership: API construction must not implicitly start worker loops. */
export const BackgroundOperationNames = [
  "document.dispatch",
  "document.execute",
  "document.reconcile",
  "document.semantic",
  "page-index.findability",
  "page-index.repair",
  "page-index.upgrade",
  "legacy.bootstrap",
  "profile.migrate",
  "profile.backfill",
  "fts.backfill",
  "research.execute",
  "deletion.dispatch",
  "deletion.execute",
  "upload.cleanup",
  "source.execute",
  "source.schedule",
  "source.preview",
  "source.legacy-sync",
  "quality.replay",
] as const;

export type BackgroundOperationName = (typeof BackgroundOperationNames)[number];
export interface BackgroundOperation {
  tick(): Promise<unknown>;
  start?(): unknown;
  stop?(): unknown;
}

export interface BackgroundRuntimeController {
  register(name: BackgroundOperationName, operation: BackgroundOperation): void;
  execute(name: BackgroundOperationName): Promise<unknown>;
  names(): readonly BackgroundOperationName[];
  stop(): Promise<void>;
}

export function createBackgroundRuntimeController(autostart: boolean): BackgroundRuntimeController {
  const operations = new Map<BackgroundOperationName, BackgroundOperation>();
  return {
    register(name, operation) {
      if (operations.has(name)) throw new Error(`Duplicate background operation: ${name}`);
      operations.set(name, operation);
      if (autostart) operation.start?.();
    },
    async execute(name) {
      const operation = operations.get(name);
      if (!operation) return { unavailable: true };
      return operation.tick();
    },
    names: () => [...operations.keys()],
    async stop() {
      await Promise.all([...operations.values()].map((operation) => operation.stop?.()));
    },
  };
}
