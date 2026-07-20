export interface ApiGraphExpansionEnv {
  readonly KNOWLEDGE_GRAPH_EXPANSION?: string;
  readonly KNOWLEDGE_GRAPH_EXPANSION_FANOUT?: string;
  readonly KNOWLEDGE_GRAPH_EXPANSION_GRAPH_BOOST?: string;
  readonly KNOWLEDGE_GRAPH_EXPANSION_GRAPH_TOP_K?: string;
  readonly KNOWLEDGE_GRAPH_EXPANSION_MAX_DEPTH?: string;
  readonly KNOWLEDGE_GRAPH_EXPANSION_MAX_SEED_ENTITIES?: string;
  readonly KNOWLEDGE_GRAPH_EXPANSION_MAX_TRAVERSAL_NODES?: string;
  readonly KNOWLEDGE_GRAPH_EXPANSION_TIMEOUT_MS?: string;
}

export interface ApiGraphExpansionOptions {
  readonly fanout: number;
  readonly graphBoost: number;
  readonly graphTopK: number;
  readonly maxDepth: number;
  readonly maxSeedEntities: number;
  readonly maxTraversalNodes: number;
  readonly timeoutMs: number;
}

/** Deployment defaults; also the fallback when the env factory is not used (tests, embeds). */
export const DEFAULT_GRAPH_EXPANSION_OPTIONS: ApiGraphExpansionOptions = {
  fanout: 20,
  graphBoost: 0.2,
  graphTopK: 10,
  maxDepth: 2,
  maxSeedEntities: 5,
  maxTraversalNodes: 50,
  timeoutMs: 250,
};

/** Must stay aligned with the production hybrid repository/retrieval planner ceiling. */
export const MAX_GRAPH_EXPANSION_TOP_K = 100;

/**
 * Reads the graph-expanded-retrieval tuning knobs from the environment. Graph expansion is ON by
 * default whenever a graph repository is wired (Deep mode only — mode gating lives in
 * `shouldRunModeExtension`); set `KNOWLEDGE_GRAPH_EXPANSION=off|false|0` to disable it without
 * unwiring the graph. Returns `undefined` when disabled. Invalid values fail startup fast with the
 * offending variable named.
 */
export function createApiGraphExpansionOptions(
  env: ApiGraphExpansionEnv = process.env,
): ApiGraphExpansionOptions | undefined {
  if (graphExpansionDisabled(env.KNOWLEDGE_GRAPH_EXPANSION)) {
    return undefined;
  }

  return {
    fanout: boundedIntegerEnv(
      env.KNOWLEDGE_GRAPH_EXPANSION_FANOUT,
      DEFAULT_GRAPH_EXPANSION_OPTIONS.fanout,
      "KNOWLEDGE_GRAPH_EXPANSION_FANOUT",
    ),
    graphBoost: positiveNumberEnv(
      env.KNOWLEDGE_GRAPH_EXPANSION_GRAPH_BOOST,
      DEFAULT_GRAPH_EXPANSION_OPTIONS.graphBoost,
      "KNOWLEDGE_GRAPH_EXPANSION_GRAPH_BOOST",
    ),
    graphTopK: boundedIntegerEnv(
      env.KNOWLEDGE_GRAPH_EXPANSION_GRAPH_TOP_K,
      DEFAULT_GRAPH_EXPANSION_OPTIONS.graphTopK,
      "KNOWLEDGE_GRAPH_EXPANSION_GRAPH_TOP_K",
      MAX_GRAPH_EXPANSION_TOP_K,
    ),
    maxDepth: boundedIntegerEnv(
      env.KNOWLEDGE_GRAPH_EXPANSION_MAX_DEPTH,
      DEFAULT_GRAPH_EXPANSION_OPTIONS.maxDepth,
      "KNOWLEDGE_GRAPH_EXPANSION_MAX_DEPTH",
      // Graph traversal supports depth 1-2 (validateGraphTraversalInput); fail fast with the env name.
      2,
    ),
    maxSeedEntities: boundedIntegerEnv(
      env.KNOWLEDGE_GRAPH_EXPANSION_MAX_SEED_ENTITIES,
      DEFAULT_GRAPH_EXPANSION_OPTIONS.maxSeedEntities,
      "KNOWLEDGE_GRAPH_EXPANSION_MAX_SEED_ENTITIES",
    ),
    maxTraversalNodes: boundedIntegerEnv(
      env.KNOWLEDGE_GRAPH_EXPANSION_MAX_TRAVERSAL_NODES,
      DEFAULT_GRAPH_EXPANSION_OPTIONS.maxTraversalNodes,
      "KNOWLEDGE_GRAPH_EXPANSION_MAX_TRAVERSAL_NODES",
    ),
    timeoutMs: boundedIntegerEnv(
      env.KNOWLEDGE_GRAPH_EXPANSION_TIMEOUT_MS,
      DEFAULT_GRAPH_EXPANSION_OPTIONS.timeoutMs,
      "KNOWLEDGE_GRAPH_EXPANSION_TIMEOUT_MS",
    ),
  };
}

function graphExpansionDisabled(value: string | undefined): boolean {
  const normalized = trimmed(value)?.toLowerCase();

  return normalized === "0" || normalized === "false" || normalized === "off";
}

function boundedIntegerEnv(
  value: string | undefined,
  fallback: number,
  name: string,
  max?: number,
): number {
  const raw = trimmed(value);
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || (max !== undefined && parsed > max)) {
    throw new Error(
      max === undefined
        ? `${name} must be a positive integer`
        : `${name} must be an integer between 1 and ${max}`,
    );
  }

  return parsed;
}

function positiveNumberEnv(value: string | undefined, fallback: number, name: string): number {
  const raw = trimmed(value);
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a number greater than 0`);
  }

  return parsed;
}

function trimmed(value: string | undefined): string | undefined {
  const text = value?.trim();

  return text ? text : undefined;
}
