import type { OpenAPIHono } from "@hono/zod-openapi";
import type { ComputeRuntime } from "@knowledge/compute";
import type { PlatformAdapter } from "@knowledge/core";
import type { ParserAdapter } from "@knowledge/parsers";

import { collectGatewayComponentHealth } from "./gateway-health";
import type { KnowledgeGatewayEnv } from "./gateway-openapi-contracts";
import type { KnowledgeGatewayOptions } from "./gateway-options";
import { healthRoute } from "./gateway-system-routes";

export interface RegisterGatewaySystemHandlersOptions {
  readonly adapter: PlatformAdapter;
  readonly app: OpenAPIHono<KnowledgeGatewayEnv>;
  readonly componentHealth?: KnowledgeGatewayOptions["componentHealth"] | undefined;
  readonly computeRuntime: ComputeRuntime;
  readonly documentParser: ParserAdapter;
}

export function registerGatewaySystemHandlers({
  adapter,
  app,
  componentHealth,
  computeRuntime,
  documentParser,
}: RegisterGatewaySystemHandlersOptions): void {
  app.openapi(healthRoute, async (context) => {
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
}
