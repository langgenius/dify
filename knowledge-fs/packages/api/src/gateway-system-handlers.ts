import type { OpenAPIHono } from "@hono/zod-openapi";
import type { ComputeRuntime } from "@knowledge/compute";
import type { PlatformAdapter } from "@knowledge/core";
import type { ParserAdapter } from "@knowledge/parsers";

import { collectGatewayComponentHealth } from "./gateway-health";
import type { KnowledgeGatewayEnv } from "./gateway-openapi-contracts";
import type { GatewayReadinessChecks, KnowledgeGatewayOptions } from "./gateway-options";
import { healthRoute, readinessRoute } from "./gateway-system-routes";

export interface RegisterGatewaySystemHandlersOptions {
  readonly adapter: PlatformAdapter;
  readonly app: OpenAPIHono<KnowledgeGatewayEnv>;
  readonly componentHealth?: KnowledgeGatewayOptions["componentHealth"] | undefined;
  readonly computeRuntime: ComputeRuntime;
  readonly documentParser: ParserAdapter;
  readonly readinessChecks?: GatewayReadinessChecks | undefined;
}

export function registerGatewaySystemHandlers({
  adapter,
  app,
  componentHealth,
  computeRuntime,
  documentParser,
  readinessChecks,
}: RegisterGatewaySystemHandlersOptions): void {
  app.openapi(healthRoute, async (context) => {
    const { gatewayComponents, platformHealth } = await collectSystemHealth({
      adapter,
      componentHealth,
      computeRuntime,
      documentParser,
    });

    return context.json(
      {
        ...platformHealth,
        components: {
          ...platformHealth.components,
          ...gatewayComponents,
        },
      },
      200,
    );
  });

  app.openapi(readinessRoute, async (context) => {
    const [{ gatewayComponents, platformHealth }, deploymentChecks] = await Promise.all([
      collectSystemHealth({ adapter, componentHealth, computeRuntime, documentParser }),
      collectReadinessChecks(readinessChecks),
    ]);
    const components = {
      ...platformHealth.components,
      compute: gatewayComponents.compute,
      parser: gatewayComponents.parser,
      ...deploymentChecks,
    };
    const status = {
      components,
      ok: platformHealth.ok && Object.values(components).every(Boolean),
      runtime: platformHealth.runtime,
    };

    return status.ok ? context.json(status, 200) : context.json(status, 503);
  });
}

async function collectSystemHealth({
  adapter,
  componentHealth,
  computeRuntime,
  documentParser,
}: Omit<RegisterGatewaySystemHandlersOptions, "app" | "readinessChecks">) {
  const [platformHealth, gatewayComponents] = await Promise.all([
    adapter.health(),
    collectGatewayComponentHealth({
      compute: computeRuntime,
      embedding: componentHealth?.embedding,
      llm: componentHealth?.llm,
      parser: componentHealth?.parser ?? { health: () => Boolean(documentParser.kind) },
      reranker: componentHealth?.reranker,
    }),
  ]);

  return { gatewayComponents, platformHealth };
}

async function collectReadinessChecks(
  checks: GatewayReadinessChecks | undefined,
): Promise<Record<string, boolean>> {
  const entries = await Promise.all(
    Object.entries(checks ?? {}).map(async ([name, check]) => {
      try {
        return [name, Boolean(await check())] as const;
      } catch {
        return [name, false] as const;
      }
    }),
  );

  return Object.fromEntries(entries);
}
