import type {
  ResearchTaskDirectStreamCloseReason,
  ResearchTaskDirectStreamOptions,
} from "@knowledge/api";

import { parseDirectAllowedOrigins } from "./direct-transport-security";

export interface ApiResearchTaskDirectStreamEnv {
  readonly KNOWLEDGE_DIRECT_STREAM_ALLOWED_ORIGINS?: string | undefined;
  readonly KNOWLEDGE_DIRECT_STREAM_ENABLED?: string | undefined;
  readonly KNOWLEDGE_DIRECT_STREAM_MAX_CONNECTION_MS?: string | undefined;
  readonly NODE_ENV?: string | undefined;
}

export interface ApiResearchTaskDirectStreamMetricsSnapshot {
  readonly activeConnections: number;
  readonly closedTotal: number;
  readonly closeReasons: Readonly<Record<ResearchTaskDirectStreamCloseReason, number>>;
  readonly openedTotal: number;
  readonly reconnectedTotal: number;
}

export interface ApiResearchTaskDirectStreamAssembly {
  readonly options: ResearchTaskDirectStreamOptions;
  snapshot(): ApiResearchTaskDirectStreamMetricsSnapshot;
}

export type ApiResearchTaskDirectStreamMetric =
  | {
      readonly activeConnections: number;
      readonly connection: "initial" | "reconnect";
      readonly event: "knowledge_fs.research_direct_stream.opened";
    }
  | {
      readonly activeConnections: number;
      readonly event: "knowledge_fs.research_direct_stream.closed";
      readonly reason: ResearchTaskDirectStreamCloseReason;
    };

const closeReasons = [
  "disconnect",
  "error",
  "limit",
  "permission_revoked",
  "terminal",
  "timeout",
] as const satisfies readonly ResearchTaskDirectStreamCloseReason[];

export function createApiResearchTaskDirectStreamAssembly({
  emit,
  env = process.env,
}: {
  readonly emit?: ((metric: ApiResearchTaskDirectStreamMetric) => void) | undefined;
  readonly env?: ApiResearchTaskDirectStreamEnv | undefined;
}): ApiResearchTaskDirectStreamAssembly | undefined {
  if (!enabled(env.KNOWLEDGE_DIRECT_STREAM_ENABLED)) return undefined;

  const allowedOrigins = parseDirectAllowedOrigins({
    environment: env.NODE_ENV,
    name: "KNOWLEDGE_DIRECT_STREAM_ALLOWED_ORIGINS",
    value: env.KNOWLEDGE_DIRECT_STREAM_ALLOWED_ORIGINS,
  });
  const maxConnectionMs = boundedInteger(
    env.KNOWLEDGE_DIRECT_STREAM_MAX_CONNECTION_MS,
    5 * 60_000,
    "KNOWLEDGE_DIRECT_STREAM_MAX_CONNECTION_MS",
    10,
    3_600_000,
  );
  let activeConnections = 0;
  let openedTotal = 0;
  let reconnectedTotal = 0;
  let closedTotal = 0;
  const counts = Object.fromEntries(closeReasons.map((reason) => [reason, 0])) as Record<
    ResearchTaskDirectStreamCloseReason,
    number
  >;

  return {
    options: {
      allowedOrigins,
      maxConnectionMs,
      observer: {
        onClose(scope) {
          activeConnections = Math.max(0, activeConnections - 1);
          closedTotal = increment(closedTotal);
          counts[scope.reason] = increment(counts[scope.reason]);
          safelyEmit(emit, {
            activeConnections,
            event: "knowledge_fs.research_direct_stream.closed",
            reason: scope.reason,
          });
        },
        onOpen(scope) {
          activeConnections = increment(activeConnections);
          openedTotal = increment(openedTotal);
          if (scope.reconnected) reconnectedTotal = increment(reconnectedTotal);
          safelyEmit(emit, {
            activeConnections,
            connection: scope.reconnected ? "reconnect" : "initial",
            event: "knowledge_fs.research_direct_stream.opened",
          });
        },
      },
    },
    snapshot: () => ({
      activeConnections,
      closedTotal,
      closeReasons: { ...counts },
      openedTotal,
      reconnectedTotal,
    }),
  };
}

function enabled(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === "0" || normalized === "false" || normalized === "off") {
    return false;
  }
  if (normalized === "1" || normalized === "true" || normalized === "on") return true;
  throw new Error("KNOWLEDGE_DIRECT_STREAM_ENABLED must be on/true/1 or off/false/0");
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  name: string,
  min: number,
  max: number,
): number {
  const raw = value?.trim();
  const parsed = raw ? Number(raw) : fallback;
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be a safe integer between ${min} and ${max}`);
  }
  return parsed;
}

function increment(value: number): number {
  return value === Number.MAX_SAFE_INTEGER ? value : value + 1;
}

function safelyEmit(
  emit: ((metric: ApiResearchTaskDirectStreamMetric) => void) | undefined,
  metric: ApiResearchTaskDirectStreamMetric,
): void {
  try {
    emit?.(metric);
  } catch {
    // Metrics must not own the connection lifecycle.
  }
}
