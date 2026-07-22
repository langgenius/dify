import type { ComputeRuntime } from "@knowledge/compute";

export interface GatewayComponentHealthOptions {
  readonly embedding?: GatewayComponentHealthSource | undefined;
  readonly llm?: GatewayComponentHealthSource | undefined;
  readonly parser?: GatewayComponentHealthSource | undefined;
  readonly reranker?: GatewayComponentHealthSource | undefined;
}

export interface GatewayHealthCollectionOptions extends GatewayComponentHealthOptions {
  readonly compute: Pick<ComputeRuntime, "countTokens" | "rrfFuse">;
}

export interface GatewayComponentHealthSource {
  health?: (() => Promise<boolean> | boolean) | undefined;
  models?: (() => Promise<readonly unknown[]> | readonly unknown[]) | undefined;
}

export async function collectGatewayComponentHealth({
  compute,
  embedding,
  llm,
  parser,
  reranker,
}: GatewayHealthCollectionOptions): Promise<
  Record<"compute" | "embedding" | "llm" | "parser" | "reranker", boolean>
> {
  const [computeHealthy, parserHealthy, embeddingHealthy, rerankerHealthy, llmHealthy] =
    await Promise.all([
      checkGatewayComputeHealth(compute),
      checkGatewayComponentHealth(parser, true),
      checkGatewayComponentHealth(embedding, false),
      checkGatewayComponentHealth(reranker, false),
      checkGatewayComponentHealth(llm, false),
    ]);

  return {
    compute: computeHealthy,
    embedding: embeddingHealthy,
    llm: llmHealthy,
    parser: parserHealthy,
    reranker: rerankerHealthy,
  };
}

function checkGatewayComputeHealth(
  compute: Pick<ComputeRuntime, "countTokens" | "rrfFuse">,
): boolean {
  const probeId = "knowledge-fs-compute-health";

  try {
    const tokenCount = compute.countTokens(probeId);
    if (!Number.isSafeInteger(tokenCount) || tokenCount < 1) {
      return false;
    }

    const fused = compute.rrfFuse({
      config: {
        k: 60,
        limit: 1,
        maxInputBytes: 1_024,
        maxItemsPerList: 1,
        maxLists: 1,
        maxOutputItems: 1,
      },
      rankedLists: [{ items: [{ id: probeId }], weight: 1 }],
    });
    const first = fused[0];

    return (
      fused.length === 1 &&
      first?.id === probeId &&
      Number.isFinite(first.score) &&
      first.score > 0 &&
      first.ranks.length === 1 &&
      first.ranks[0]?.listIndex === 0 &&
      first.ranks[0]?.rank === 1
    );
  } catch {
    return false;
  }
}

async function checkGatewayComponentHealth(
  source: GatewayComponentHealthSource | undefined,
  defaultWhenMissing: boolean,
): Promise<boolean> {
  if (!source) {
    return defaultWhenMissing;
  }

  try {
    if (source.health) {
      return Boolean(await source.health());
    }

    if (source.models) {
      await source.models();
      return true;
    }

    return true;
  } catch {
    return false;
  }
}
