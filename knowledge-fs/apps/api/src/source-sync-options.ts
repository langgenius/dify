export interface ApiSourceSyncEnv {
  readonly KNOWLEDGE_SOURCE_SYNC?: string;
  readonly KNOWLEDGE_SOURCE_SYNC_MAX_SOURCES_PER_TICK?: string;
  readonly KNOWLEDGE_SOURCE_SYNC_TICK_MS?: string;
}

export interface ApiSourceSyncOptions {
  readonly sourceSync: {
    readonly intervalMs: number;
    readonly maxSourcesPerTick: number;
  };
}

/**
 * Reads the scheduled source-sync scheduler config. On by default (a tick is one cheap source
 * scan per minute; sources without a `metadata.syncPolicy` are ignored); set
 * `KNOWLEDGE_SOURCE_SYNC=off|false|0` to disable. Invalid values fail startup fast.
 */
export function createApiSourceSyncOptions(
  env: ApiSourceSyncEnv = process.env,
): ApiSourceSyncOptions | undefined {
  const normalized = env.KNOWLEDGE_SOURCE_SYNC?.trim().toLowerCase();

  if (normalized === "0" || normalized === "false" || normalized === "off") {
    return undefined;
  }

  return {
    sourceSync: {
      intervalMs: boundedIntegerEnv(
        env.KNOWLEDGE_SOURCE_SYNC_TICK_MS,
        60_000,
        "KNOWLEDGE_SOURCE_SYNC_TICK_MS",
        1_000,
      ),
      maxSourcesPerTick: boundedIntegerEnv(
        env.KNOWLEDGE_SOURCE_SYNC_MAX_SOURCES_PER_TICK,
        200,
        "KNOWLEDGE_SOURCE_SYNC_MAX_SOURCES_PER_TICK",
        1,
      ),
    },
  };
}

function boundedIntegerEnv(
  value: string | undefined,
  fallback: number,
  name: string,
  min: number,
): number {
  const raw = value?.trim();
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < min) {
    throw new Error(`${name} must be an integer of at least ${min}`);
  }

  return parsed;
}
